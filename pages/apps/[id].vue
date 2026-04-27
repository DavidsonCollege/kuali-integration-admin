<template>
  <div>
    <NuxtLink to="/" class="text-sm text-muted">&larr; All integrations</NuxtLink>

    <div v-if="error" class="card border-accent p-4 text-accent mt-4">
      {{ error }}
    </div>

    <div v-else-if="loading" class="mt-6 text-subtle">Loading app…</div>

    <div v-else-if="app" class="mt-4">
      <header class="mb-8">
        <h1 class="text-3xl">{{ app.name }}</h1>

        <dl class="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 text-sm">
          <div>
            <dt class="text-subtle">Published</dt>
            <dd>{{ app.dataset?.isPublished ? 'Yes' : 'No' }}</dd>
          </div>
          <div>
            <dt class="text-subtle">Submissions</dt>
            <dd>{{ submissionCount }}</dd>
          </div>
          <div>
            <dt class="text-subtle">Last submission</dt>
            <dd>{{ lastSubmittedAt || '—' }}</dd>
          </div>
          <div>
            <dt class="text-subtle">Last edited</dt>
            <dd>{{ formatDate(app.updatedAt) || '—' }}</dd>
          </div>
          <div class="col-span-2">
            <dt class="text-subtle">Created by</dt>
            <dd>{{ app.createdBy?.displayName || app.updatedBy?.displayName || 'Unknown' }}</dd>
          </div>
          <div class="col-span-2">
            <dt class="text-subtle">Last edited by</dt>
            <dd>{{ app.updatedBy?.displayName || '—' }}</dd>
          </div>
        </dl>
      </header>

      <section class="mb-8">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-xl">Integration usage in this app</h2>
          <button class="btn-secondary" :disabled="introspecting" @click="onIntrospect">
            {{ introspecting ? 'Introspecting…' : 'Introspect schema + workflow' }}
          </button>
        </div>

        <p v-if="!introspectionRun" class="text-sm text-muted">
          Click "Introspect" to scan the form schema and workflow JSON for references to integration outputs.
          We don't run this automatically because it walks the full form definition and workflow tree, which
          can be heavy on bigger apps.
        </p>

        <div v-else>
          <div v-if="introspection.grouped.length === 0" class="card p-4 text-sm text-muted">
            No integration references found in this app's form or workflow.
          </div>

          <div v-else class="space-y-4">
            <article
              v-for="g in introspection.grouped"
              :key="g.integrationId"
              class="card p-4"
            >
              <header class="flex items-baseline justify-between gap-3">
                <h3 class="text-lg">
                  <NuxtLink
                    :to="`/integrations/${g.integrationId}`"
                    class="text-accent hover:underline"
                  >
                    {{ g.integrationLabel || g.integrationId }}
                  </NuxtLink>
                </h3>
                <code class="text-xs text-subtle">{{ g.integrationId }}</code>
              </header>
              <p class="text-sm text-muted mt-1">
                Used in {{ g.uses.length }} place{{ g.uses.length === 1 ? '' : 's' }}
              </p>

              <ul class="mt-3 space-y-3">
                <li
                  v-for="(use, i) in g.uses"
                  :key="i"
                  class="border-l-2 border-rule pl-3"
                >
                  <div class="flex items-baseline justify-between gap-2">
                    <span class="text-sm">
                      <span class="font-medium">{{ use.gadgetLabel || '(unnamed)' }}</span>
                      <span class="ml-2 text-xs text-subtle">{{ useLocation(use) }}</span>
                    </span>
                    <code class="text-xs text-subtle">{{ use.formKey }}</code>
                  </div>

                  <div v-if="use.inputs.length" class="mt-1 text-xs text-muted">
                    <span class="text-subtle">Inputs:</span>
                    <span
                      v-for="(inp, j) in use.inputs"
                      :key="j"
                      class="ml-2"
                    >
                      <code class="font-mono">{{ inp.name }}</code>
                      <span class="text-subtle">
                        ←
                        <template v-if="inp.sourceType === 'form'">form {{ inp.pointsAt || '—' }}</template>
                        <template v-else-if="inp.sourceType === 'static'">static "{{ inp.pointsAt }}"</template>
                        <template v-else>{{ inp.sourceType }}</template>
                      </span>
                      <span v-if="inp.required" class="text-accent">*</span><span v-if="j < use.inputs.length - 1">,</span>
                    </span>
                  </div>

                  <div v-if="use.outputs.length" class="mt-1 text-xs text-muted">
                    <span class="text-subtle">Outputs ({{ use.outputs.length }}):</span>
                    <span
                      v-for="(o, k) in use.outputs.slice(0, 6)"
                      :key="k"
                      class="ml-2"
                    >
                      <code class="font-mono">{{ o.path }}</code><span v-if="k < Math.min(use.outputs.length, 6) - 1">,</span>
                    </span>
                    <span v-if="use.outputs.length > 6" class="ml-1 text-subtle">
                      … +{{ use.outputs.length - 6 }} more
                    </span>
                  </div>
                </li>
              </ul>
            </article>
          </div>

          <p class="mt-3 text-xs text-subtle italic">
            Form scan: {{ introspection.form.length }} reference{{ introspection.form.length === 1 ? '' : 's' }}
            · Workflow scan: {{ introspection.workflow.length }} reference{{ introspection.workflow.length === 1 ? '' : 's' }}
          </p>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { getApp } from '~/graphql/queries';

const route = useRoute();
const { request } = useGraphQL();
const { hasApiKey } = useApiKey();
const { introspect } = useAppIntrospection();

if (!hasApiKey.value) {
  await navigateTo('/');
}

const app = ref(null);
const loading = ref(true);
const error = ref(null);

const introspecting = ref(false);
const introspectionRun = ref(false);
const introspection = ref({ form: [], workflow: [], grouped: [] });

const useLocation = (use) => {
  if (use.source === 'form') return `form · ${use.gadgetType}`;
  if (use.source === 'workflow') {
    const kind = use.gadgetType || 'step';
    return use.stepPath ? `workflow · ${kind} · ${use.stepPath}` : `workflow · ${kind}`;
  }
  return use.gadgetType || use.source;
};

const submissionCount = computed(() => app.value?.documentConnection?.totalCount ?? 0);
const lastSubmittedAt = computed(() => {
  const ts = app.value?.documentConnection?.edges?.[0]?.node?.createdAt;
  return formatDate(ts);
});

const formatDate = (value) => {
  if (!value) return null;
  const ms = typeof value === 'string' ? Number(value) || Date.parse(value) : Number(value);
  if (!Number.isFinite(ms)) return value;
  return new Date(ms).toLocaleString();
};

const load = async () => {
  loading.value = true;
  error.value = null;
  try {
    const result = await request(getApp, { id: route.params.id });
    app.value = result.app;
  } catch (e) {
    error.value = e.message || 'Failed to load app.';
  } finally {
    loading.value = false;
  }
};

const onIntrospect = async () => {
  introspecting.value = true;
  try {
    introspection.value = introspect(app.value);
    introspectionRun.value = true;
  } finally {
    introspecting.value = false;
  }
};

onMounted(load);
</script>
