<template>
  <div>
    <NuxtLink to="/" class="text-sm text-muted">&larr; All integrations</NuxtLink>

    <div v-if="error" class="card border-accent p-4 text-accent mt-4">
      {{ error }}
    </div>

    <div v-else-if="loading" class="mt-6 text-subtle">Loading integration…</div>

    <div v-else-if="integration" class="mt-4">
      <header class="mb-8">
        <div class="flex items-baseline justify-between gap-6">
          <h1 class="text-3xl">{{ integration.name }}</h1>
          <div v-if="integration.kuali" class="text-xs text-subtle">Kuali-managed</div>
        </div>
        <p v-if="integration.description" class="text-muted mt-2">
          {{ integration.description }}
        </p>

        <dl class="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 text-sm">
          <div>
            <dt class="text-subtle">Sharing type</dt>
            <dd>{{ integration.sharedWithOthers?.type || '—' }}</dd>
          </div>
          <div>
            <dt class="text-subtle">Type</dt>
            <dd>{{ integrationType || '—' }}</dd>
          </div>
          <div>
            <dt class="text-subtle">Home space</dt>
            <dd class="font-mono text-xs">{{ homeSpaceId || '—' }}</dd>
          </div>
          <div>
            <dt class="text-subtle">Apps using it</dt>
            <dd>{{ integration.appsUsing?.length || 0 }}</dd>
          </div>
        </dl>
      </header>

      <section>
        <div class="flex items-end justify-between gap-4 mb-4 flex-wrap">
          <h2 class="text-xl">Apps using this integration</h2>
          <div v-if="integration.appsUsing?.length" class="flex items-center gap-2">
            <input
              v-model="appsSearch"
              type="search"
              placeholder="Search apps…"
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
              class="card p-3 block hover:border-accent transition-colors no-underline text-ink flex items-center justify-between"
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
import { getIntegration } from '~/graphql/queries';

const route = useRoute();
const { request } = useGraphQL();
const { hasApiKey } = useApiKey();

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

// `data` is a JSON blob — pull a couple of useful fields out for the header.
const integrationType = computed(() => integration.value?.data?.__type);
const homeSpaceId = computed(() => integration.value?.data?.__spaceId);

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
    const result = await request(getIntegration, { id: route.params.id });
    integration.value = result.integration;
  } catch (e) {
    error.value = e.message || 'Failed to load integration.';
  } finally {
    loading.value = false;
  }
};

onMounted(load);
</script>
