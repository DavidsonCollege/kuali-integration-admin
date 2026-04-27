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
          <h2 class="text-xl">Apps using this integration</h2>
          <div v-if="integration.appsUsing?.length" class="flex items-center gap-2">
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

        <p v-if="appsSearch && integration.appsUsing?.length" class="text-xs text-subtle mb-3">
          {{ visibleAppsUsing.length }} of {{ integration.appsUsing.length }} matching "{{ appsSearch }}"
        </p>

        <div v-if="!integration.appsUsing?.length" class="text-subtle text-sm">
          No apps reference this integration.
        </div>

        <div v-else-if="!visibleAppsUsing.length" class="text-subtle text-sm">
          No apps match "{{ appsSearch }}".
        </div>

        <ul v-else class="space-y-2">
          <li v-for="app in visibleAppsUsing" :key="app.id">
            <NuxtLink
              :to="`/apps/${app.id}`"
              class="card p-3 block hover:border-ink/30 transition-colors no-underline text-ink flex items-center justify-between"
            >
              <span class="font-medium">{{ app.name }}</span>
              <span class="text-xs text-subtle">View details &rarr;</span>
            </NuxtLink>
          </li>
        </ul>
      </section>

      <section v-if="integration.sharedWithOthers?.apps?.length" class="mt-10">
        <div class="flex items-end justify-between gap-4 mb-3 flex-wrap">
          <h2 class="text-xl">Apps with sharing access</h2>
          <div class="flex items-center gap-2">
            <input
              v-model="sharedSearch"
              type="search"
              placeholder="Search apps…"
              class="w-56 text-sm"
            />
            <select v-model="sharedSort" aria-label="Sort sharing apps" class="text-sm">
              <option value="name-asc">Name (A–Z)</option>
              <option value="name-desc">Name (Z–A)</option>
            </select>
          </div>
        </div>
        <p class="text-sm text-muted mb-3">
          Apps explicitly granted access via the integration's sharing settings.
        </p>
        <div v-if="!visibleSharedApps.length" class="text-subtle text-sm">
          No apps match "{{ sharedSearch }}".
        </div>
        <ul v-else class="space-y-1 text-sm">
          <li v-for="app in visibleSharedApps" :key="app.id" class="text-muted">
            {{ app.name }}
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

// Search/sort state for the two app lists on this page. Kept independent so a
// filter on "Apps using" doesn't also filter "Apps with sharing access".
const appsSearch = ref('');
const appsSort = ref('name-asc');
const sharedSearch = ref('');
const sharedSort = ref('name-asc');
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

const visibleAppsUsing = computed(() =>
  filterAndSort(integration.value?.appsUsing || [], appsSearch.value, appsSort.value)
);

const visibleSharedApps = computed(() =>
  filterAndSort(integration.value?.sharedWithOthers?.apps || [], sharedSearch.value, sharedSort.value)
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
