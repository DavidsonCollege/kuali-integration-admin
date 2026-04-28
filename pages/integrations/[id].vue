<template>
  <div>
    <NuxtLink to="/" class="text-sm text-muted">&larr; All integrations</NuxtLink>

    <div v-if="error" class="card border-accent p-4 text-accent mt-4">
      {{ error }}
    </div>

    <div v-else-if="loading" class="mt-6" aria-label="Loading integration">
      <div class="skeleton h-9 w-2/3"></div>
      <div class="skeleton h-4 w-1/2 mt-3"></div>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-6 mt-8 pt-6 border-t border-rule">
        <div v-for="n in 4" :key="n" class="space-y-2">
          <div class="skeleton h-3 w-16"></div>
          <div class="skeleton h-7 w-12"></div>
        </div>
      </div>
      <ul class="space-y-2 mt-10">
        <li v-for="n in 4" :key="n" class="card p-3">
          <div class="skeleton h-4 w-1/3"></div>
        </li>
      </ul>
    </div>

    <div v-else-if="integration" class="mt-4">
      <header class="mb-8">
        <div class="flex items-baseline justify-between gap-6">
          <h1 class="text-3xl">{{ integration.name }}</h1>
          <div
            v-if="integration.kuali"
            class="font-display uppercase tracking-wider text-[10px] border border-ink/20 px-1.5 py-0.5 text-ink shrink-0"
          >
            Kuali-managed
          </div>
        </div>
        <p v-if="integration.description" class="text-muted mt-2">
          {{ integration.description }}
        </p>

        <dl class="grid grid-cols-2 md:grid-cols-4 gap-6 mt-8 pt-6 border-t border-rule">
          <div class="stat">
            <dt>Apps using it</dt>
            <dd>{{ integration.appsUsing?.length || 0 }}</dd>
          </div>
          <div class="stat">
            <dt>Sharing</dt>
            <dd class="text-base">{{ sharingTypeLabel }}</dd>
          </div>
          <div class="stat">
            <dt>Type</dt>
            <dd class="text-base">{{ typeLabel || '—' }}</dd>
          </div>
          <div class="stat">
            <dt>Home space</dt>
            <dd class="text-base">{{ homeSpaceName || '—' }}</dd>
          </div>
        </dl>
      </header>

      <section>
        <!-- Section header sticks while the apps list scrolls. -->
        <div class="sticky top-0 -mx-6 px-6 pt-2 pb-3 bg-surface/95 backdrop-blur-sm z-10 border-b border-rule mb-4 flex items-end justify-between gap-4 flex-wrap">
          <h2 class="text-xl">Apps with access</h2>
          <div v-if="combinedApps.length" class="flex items-center gap-2">
            <input
              ref="appsSearchEl"
              v-model="appsSearch"
              type="search"
              placeholder="Search apps… ( / )"
              class="w-56 text-sm"
            />
            <select v-model="appsSort" aria-label="Sort apps" class="text-sm">
              <option value="name-asc">Name (A–Z)</option>
              <option value="name-desc">Name (Z–A)</option>
            </select>
          </div>
        </div>

        <p v-if="appsSearch && combinedApps.length" class="text-xs text-subtle mb-3">
          {{ visibleApps.length }} of {{ combinedApps.length }} matching "{{ appsSearch }}"
        </p>

        <div v-if="!combinedApps.length" class="text-subtle text-sm">
          No apps reference this integration.
        </div>

        <div v-else-if="!visibleApps.length" class="text-subtle text-sm">
          No apps match "{{ appsSearch }}".
        </div>

        <ul v-else class="space-y-2">
          <li v-for="app in visibleApps" :key="app.id">
            <NuxtLink
              :to="`/apps/${app.id}`"
              class="card p-3 block hover:border-ink/30 transition-colors no-underline text-ink flex items-center justify-between gap-3"
            >
              <span class="font-medium truncate">{{ app.name }}</span>
              <span class="flex items-center gap-3 shrink-0">
                <span
                  class="font-display uppercase tracking-wider text-[10px] px-1.5 py-0.5 border"
                  :class="app.status === 'using'
                    ? 'border-ink/30 text-ink'
                    : 'border-rule text-muted'"
                >
                  {{ app.status === 'using' ? 'Using' : 'Has access' }}
                </span>
                <span class="text-xs text-subtle">View details &rarr;</span>
              </span>
            </NuxtLink>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<script setup>
import { getIntegration, getSpaces } from '~/graphql/queries';

const route = useRoute();
const { request } = useGraphQL();
const { hasApiKey } = useApiKey();

// Sharing-type values seen on the Build API. SPECIFIC means a curated list of
// apps; ALL means open to every app in the tenant. Anything else (no sharing
// block at all, or NONE/DISABLED if the API ever surfaces those) reads as
// disabled. Unknown future enum values fall through to their raw string so the
// UI doesn't lie.
const SHARING_TYPE_LABELS = {
  SPECIFIC: 'Limited',
  ALL: 'Public',
  NONE: 'Disabled',
  DISABLED: 'Disabled',
};

if (!hasApiKey.value) {
  // No key — bounce home so the user can connect.
  await navigateTo('/');
}

const integration = ref(null);
const loading = ref(true);
const error = ref(null);

// Search/sort state for the combined apps list (using + sharing-only).
const appsSearch = ref('');
const appsSort = ref('name-asc');
const appsSearchEl = ref(null);
useSearchHotkey(appsSearchEl);

// `data` is a JSON blob. `__type` is a `{id, label}` object; surface just the
// label. `__spaceId` is a raw id; resolve it to the human space name using
// the index page's cached spaces list (and backfill on a deep-link load).
const cachedSpaces = useState('integrationsSpaces', () => []);

const typeLabel = computed(() => {
  const t = integration.value?.data?.__type;
  if (!t) return null;
  if (typeof t === 'string') return t;
  return t.label || t.id || null;
});

const homeSpaceName = computed(() => {
  const id = integration.value?.data?.__spaceId;
  if (!id) return null;
  const match = cachedSpaces.value.find((s) => s.id === id);
  return match?.name || id;
});

const sharingTypeLabel = computed(() => {
  const sharing = integration.value?.sharedWithOthers;
  if (!sharing || !sharing.type) return 'Disabled';
  return SHARING_TYPE_LABELS[sharing.type] || sharing.type;
});

const filterAndSort = (list, search, sort) => {
  const q = (search || '').trim().toLowerCase();
  const filtered = q
    ? list.filter((a) => (a.name || '').toLowerCase().includes(q))
    : [...list];
  const dir = sort === 'name-desc' ? -1 : 1;
  return filtered.sort((a, b) => dir * (a.name || '').localeCompare(b.name || ''));
};

// Merge `appsUsing` (apps actively referencing the integration) with
// `sharedWithOthers.apps` (apps explicitly granted access). Unpublished apps
// only show up in the sharing list — combining surfaces them. Tag each entry
// so the UI can distinguish active use from access-only.
const combinedApps = computed(() => {
  const using = integration.value?.appsUsing || [];
  const shared = integration.value?.sharedWithOthers?.apps || [];
  const usingIds = new Set(using.map((a) => a.id));
  return [
    ...using.map((a) => ({ ...a, status: 'using' })),
    ...shared.filter((a) => !usingIds.has(a.id)).map((a) => ({ ...a, status: 'shared' })),
  ];
});

const visibleApps = computed(() =>
  filterAndSort(combinedApps.value, appsSearch.value, appsSort.value)
);

const load = async () => {
  loading.value = true;
  error.value = null;
  try {
    // Fan out: integration is the headline payload; spaces is a backfill so
    // the home-space cell can show a name on a deep-link load. The spaces
    // call is fire-and-forget — if it fails, homeSpaceName falls back to id.
    const [result] = await Promise.all([
      request(getIntegration, { id: route.params.id }),
      cachedSpaces.value.length === 0
        ? request(getSpaces).then((res) => {
            cachedSpaces.value = res?.spaces || [];
          }).catch(() => {})
        : Promise.resolve(),
    ]);
    integration.value = result.integration;
  } catch (e) {
    error.value = e.message || 'Failed to load integration.';
  } finally {
    loading.value = false;
  }
};

onMounted(load);
</script>
