<template>
  <div>
    <!-- API key entry — shown until the user has connected. -->
    <section v-if="!hasApiKey" class="max-w-md mx-auto mt-12 card p-8">
      <h1 class="text-2xl mb-2">Connect to Kuali Build</h1>
      <p class="text-sm text-muted mb-6">
        Provide your tenant URL and an API token. Both are stored only in this browser's localStorage —
        nothing is sent to a server other than your own Kuali instance.
      </p>
      <div v-if="authError" class="card border-accent bg-accent/10 p-3 text-sm text-accent mb-4">
        {{ authError }}
      </div>
      <form class="space-y-4" @submit.prevent="onConnect">
        <div>
          <label class="block text-sm font-medium mb-1" for="baseUrl">Kuali Build URL</label>
          <input
            id="baseUrl"
            v-model="form.baseUrl"
            type="url"
            required
            placeholder="https://your-tenant.kualibuild.com"
            class="w-full"
          />
        </div>
        <div>
          <label class="block text-sm font-medium mb-1" for="apiKey">API Token</label>
          <input
            id="apiKey"
            v-model="form.apiKey"
            type="password"
            required
            placeholder="Paste your bearer token"
            class="w-full"
          />
          <p class="text-xs text-subtle mt-1">
            Generate a personal API token in your Kuali Build profile settings.
          </p>
        </div>
        <button type="submit" class="btn-primary w-full" :disabled="connecting">
          {{ connecting ? 'Connecting…' : 'Connect' }}
        </button>
        <p v-if="connectError" class="text-sm text-accent">{{ connectError }}</p>
      </form>
    </section>

    <!-- Integrations browser — main UI once connected. -->
    <section v-else>
      <div class="flex items-end justify-between gap-6 mb-4">
        <div>
          <h1 class="text-3xl">Integrations</h1>
          <p class="text-sm text-muted mt-1">
            <span v-if="loading && !integrations.length">
              Loading integrations across {{ spaces.length || '…' }} space{{ spaces.length === 1 ? '' : 's' }}…
            </span>
            <span v-else-if="filtersActive && integrations.length">
              {{ visibleIntegrations.length }} of {{ integrations.length }} match{{ visibleIntegrations.length === 1 ? 'es' : '' }}
            </span>
            <span v-else-if="integrations.length">
              {{ integrations.length }} integration{{ integrations.length === 1 ? '' : 's' }} across
              {{ spaces.length }} space{{ spaces.length === 1 ? '' : 's' }}
            </span>
            <span v-else>Browse the integrations in this tenant.</span>
          </p>
          <p v-if="lastFetchedAgo" class="text-xs text-subtle mt-1">
            Refreshed {{ lastFetchedAgo }} ·
            <button
              class="underline-offset-2 hover:text-accent hover:underline"
              :disabled="loading"
              @click="loadAllIntegrations({ force: true })"
            >
              {{ loading ? 'Refreshing…' : 'Refresh' }}
            </button>
          </p>
        </div>
        <div class="flex items-center gap-2">
          <input
            v-model="search"
            type="search"
            placeholder="Search integrations…"
            class="w-64"
          />
          <select v-model="sort" aria-label="Sort integrations" class="text-sm">
            <option value="name-asc">Name (A–Z)</option>
            <option value="name-desc">Name (Z–A)</option>
          </select>
        </div>
      </div>

      <!-- Filter row: Kuali/Custom chips + space filter. -->
      <div v-if="integrations.length" class="flex flex-wrap items-center gap-2 mb-4 text-sm">
        <span class="text-subtle">Show</span>
        <button
          v-for="opt in kualiFilterOptions"
          :key="opt.value"
          type="button"
          class="px-3 py-1 border transition-colors"
          :class="kualiFilter === opt.value
            ? 'border-accent text-accent bg-accent/5'
            : 'border-rule text-muted hover:border-accent'"
          @click="kualiFilter = opt.value"
        >
          {{ opt.label }}
          <span v-if="opt.count !== null" class="text-xs text-subtle ml-1">({{ opt.count }})</span>
        </button>

        <span v-if="spaces.length > 1" class="text-subtle ml-2">in</span>
        <select
          v-if="spaces.length > 1"
          v-model="spaceFilter"
          aria-label="Filter by space"
          class="text-sm"
        >
          <option value="">All spaces</option>
          <option v-for="s in spaces" :key="s.id" :value="s.name">{{ s.name }}</option>
        </select>

        <button
          v-if="filtersActive"
          type="button"
          class="ml-auto text-xs text-muted hover:text-accent underline-offset-2 hover:underline"
          @click="clearFilters"
        >
          Clear filters
        </button>
      </div>

      <div v-if="error" class="card border-accent p-4 text-accent mb-4">
        <p>{{ error }}</p>
        <button class="btn-secondary mt-3" :disabled="loading" @click="loadAllIntegrations({ force: true })">
          {{ loading ? 'Retrying…' : 'Try again' }}
        </button>
      </div>

      <div v-if="loading && !integrations.length" class="text-subtle">
        Loading integrations…
      </div>

      <div v-else-if="!loading && !visibleIntegrations.length" class="text-subtle">
        {{ filtersActive ? 'No integrations match the current filters.' : 'No integrations found.' }}
      </div>

      <ul v-else class="space-y-2">
        <li v-for="integration in visibleIntegrations" :key="integration.id">
          <NuxtLink
            :to="`/integrations/${integration.id}`"
            class="card p-4 block hover:border-ink/30 transition-colors no-underline text-ink"
          >
            <div class="font-medium">{{ integration.name }}</div>
            <div
              v-if="integration.spaces?.length || integration.kuali"
              class="flex flex-wrap items-center gap-2 mt-1.5 text-xs text-subtle"
            >
              <span
                v-for="space in integration.spaces"
                :key="space"
                class="border border-rule px-1.5 py-0.5"
              >
                {{ space }}
              </span>
              <span
                v-if="integration.kuali"
                class="font-display uppercase tracking-wider text-[10px] border border-ink/20 px-1.5 py-0.5 text-ink"
              >
                Kuali-managed
              </span>
            </div>
            <div v-if="integration.description" class="text-sm text-muted mt-2">
              {{ integration.description }}
            </div>
          </NuxtLink>
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup>
import { getIntegrations, getSpaces, getViewer } from '~/graphql/queries';

const { hasApiKey, setApiKey, authError, apiKey, baseUrl, viewer } = useApiKey();
const { request } = useGraphQL();

// ---------- Connect form ----------
const form = reactive({
  baseUrl: 'https://davidson.kualibuild.com',
  apiKey: ''
});
const connecting = ref(false);
const connectError = ref(null);

const onConnect = async () => {
  connecting.value = true;
  connectError.value = null;
  authError.value = null;
  setApiKey(form.apiKey, form.baseUrl);
  try {
    // Sanity check the credentials before we let the user in. Stash the
    // viewer payload so the footer can show whose token is loaded.
    const v = await request(getViewer);
    viewer.value = v?.viewer?.user || null;
    await loadAllIntegrations();
  } catch (e) {
    connectError.value = `Could not authenticate: ${e.message || e}`;
    setApiKey('', form.baseUrl);
  } finally {
    connecting.value = false;
  }
};

// ---------- Integrations list ----------
// `integrationsConnection` returns only home-space integrations without a
// spaceId, so we fetch the space list and fan out one call per space, then
// merge. Search is client-side filtering against the merged list — keeps
// keystrokes instant and avoids re-firing N requests per character.
//
// Cache: state is held in `useState` so navigating away and back doesn't
// re-run the fan-out. Refresh is user-controlled — manual button + a "last
// refreshed N ago" indicator so staleness is visible. The cache key is
// `baseUrl + apiKey` so reconnecting with a different token (or to a
// different tenant) starts fresh.
const integrations = useState('integrationsList', () => []);
const spaces = useState('integrationsSpaces', () => []);
const lastFetchedAt = useState('integrationsFetchedAt', () => null);
const cacheKey = useState('integrationsCacheKey', () => null);
const loading = ref(false);
const error = ref(null);
const search = ref('');
const sort = ref('name-asc'); // 'name-asc' | 'name-desc'
const kualiFilter = ref('all'); // 'all' | 'kuali' | 'custom'
const spaceFilter = ref(''); // empty = all spaces

const filtersActive = computed(() =>
  Boolean(search.value)
  || kualiFilter.value !== 'all'
  || spaceFilter.value !== ''
  || sort.value !== 'name-asc'
);

const kualiCounts = computed(() => {
  let kuali = 0;
  let custom = 0;
  for (const i of integrations.value) {
    if (i.kuali) kuali++;
    else custom++;
  }
  return { kuali, custom, all: integrations.value.length };
});

const kualiFilterOptions = computed(() => [
  { value: 'all', label: 'All', count: kualiCounts.value.all },
  { value: 'kuali', label: 'Kuali-managed', count: kualiCounts.value.kuali },
  { value: 'custom', label: 'Custom', count: kualiCounts.value.custom }
]);

const clearFilters = () => {
  search.value = '';
  kualiFilter.value = 'all';
  spaceFilter.value = '';
  sort.value = 'name-asc';
};

const currentCacheKey = computed(() => `${baseUrl.value || ''}|${apiKey.value || ''}`);

// Reactive "now" so the "X ago" label re-renders without manual nudges.
const now = ref(Date.now());
let nowTimer;

const lastFetchedAgo = computed(() => {
  if (!lastFetchedAt.value) return null;
  const ms = now.value - lastFetchedAt.value;
  if (ms < 60_000) return 'just now';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
});

const visibleIntegrations = computed(() => {
  const q = search.value.trim().toLowerCase();
  const filtered = integrations.value.filter((i) => {
    if (kualiFilter.value === 'kuali' && !i.kuali) return false;
    if (kualiFilter.value === 'custom' && i.kuali) return false;
    if (spaceFilter.value && !(i.spaces || []).includes(spaceFilter.value)) return false;
    if (q) {
      const hay = `${i.name || ''} ${i.description || ''} ${(i.spaces || []).join(' ')}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const dir = sort.value === 'name-desc' ? -1 : 1;
  return filtered.sort((a, b) =>
    dir * (a.name || '').localeCompare(b.name || '')
  );
});

const loadAllIntegrations = async ({ force = false } = {}) => {
  // Reuse the cache when the user navigates back to /, unless they explicitly
  // refresh or the credentials have changed.
  if (!force
      && integrations.value.length > 0
      && cacheKey.value === currentCacheKey.value) {
    return;
  }
  loading.value = true;
  error.value = null;
  try {
    const spacesRes = await request(getSpaces);
    // Skip spaces with no integrations — `integrationCount` is on the
    // GetSpaces payload, so we know up front there's nothing to fetch and
    // can drop those requests entirely.
    spaces.value = (spacesRes?.spaces || [])
      .filter((s) => s?.id && (s.integrationCount ?? 0) > 0);

    if (spaces.value.length === 0) {
      // No spaces returned — fall back to a single home-space query so the
      // dashboard still shows something rather than failing closed.
      const fallback = await request(getIntegrations, { sort: 'name', query: null, spaceId: null });
      integrations.value = (fallback?.integrationsConnection?.edges || [])
        .map(({ node }) => ({ ...node, spaces: [] }));
    } else {
      // Fan out one call per space. Promise.allSettled so a single failing
      // space (e.g. one the token can't read) doesn't kill the whole list.
      const settled = await Promise.allSettled(
        spaces.value.map((s) => request(getIntegrations, {
          spaceId: s.id,
          sort: 'name',
          query: null,
        }))
      );
      const byId = new Map();
      settled.forEach((res, idx) => {
        if (res.status !== 'fulfilled') return;
        const space = spaces.value[idx];
        const edges = res.value?.integrationsConnection?.edges || [];
        for (const { node } of edges) {
          const existing = byId.get(node.id);
          if (existing) {
            if (!existing.spaces.includes(space.name)) existing.spaces.push(space.name);
          } else {
            byId.set(node.id, { ...node, spaces: [space.name] });
          }
        }
      });
      integrations.value = [...byId.values()].sort((a, b) =>
        (a.name || '').localeCompare(b.name || '')
      );
    }
    lastFetchedAt.value = Date.now();
    cacheKey.value = currentCacheKey.value;
  } catch (e) {
    error.value = e.message || 'Failed to load integrations.';
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  if (hasApiKey.value) {
    loadAllIntegrations();
    // Backfill viewer info on a warm reload (token was already in
    // localStorage, so we skipped the connect-form path).
    if (!viewer.value) {
      request(getViewer)
        .then((v) => { viewer.value = v?.viewer?.user || null; })
        .catch(() => {}); // 401 handling is centralized in useGraphQL
    }
  }
  nowTimer = setInterval(() => { now.value = Date.now(); }, 30_000);
});

onUnmounted(() => {
  if (nowTimer) clearInterval(nowTimer);
});
</script>
