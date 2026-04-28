<template>
  <div>
    <NuxtLink to="/" class="text-sm text-muted">&larr; All integrations</NuxtLink>

    <div v-if="error" class="card border-accent p-4 text-accent mt-4">
      {{ error }}
    </div>

    <div v-else-if="loading" class="mt-6" aria-label="Loading app">
      <div class="skeleton h-9 w-1/2"></div>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-6 mt-8 pt-6 border-t border-rule">
        <div v-for="n in 4" :key="n" class="space-y-2">
          <div class="skeleton h-3 w-16"></div>
          <div class="skeleton h-7 w-12"></div>
        </div>
      </div>
    </div>

    <div v-else-if="app" class="mt-4">
      <header class="mb-8">
        <h1 class="text-3xl">{{ app.name }}</h1>

        <dl class="grid grid-cols-2 md:grid-cols-4 gap-6 mt-8 pt-6 border-t border-rule">
          <div class="stat">
            <dt>Submissions</dt>
            <dd>{{ submissionCount }}</dd>
          </div>
          <div class="stat">
            <dt>Published</dt>
            <dd class="text-base">{{ app.dataset?.isPublished ? 'Yes' : 'No' }}</dd>
          </div>
          <div class="stat">
            <dt>Last submission</dt>
            <dd class="text-base">{{ lastSubmittedAt || '—' }}</dd>
          </div>
          <div class="stat">
            <dt>Last edited</dt>
            <dd class="text-base">{{ formatDate(app.updatedAt) || '—' }}</dd>
          </div>
        </dl>
        <dl class="grid grid-cols-2 gap-6 mt-6 text-sm">
          <div>
            <dt class="text-subtle text-xs">Created by</dt>
            <dd>{{ app.createdBy?.displayName || app.updatedBy?.displayName || 'Unknown' }}</dd>
          </div>
          <div>
            <dt class="text-subtle text-xs">Last edited by</dt>
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
          <div v-if="introspection.integrations.length === 0" class="card p-4 text-sm text-muted">
            No integration references found in this app's form or workflow.
          </div>

          <!-- Two-column pivot: list on the left, selected integration on the
               right. Keeps the demo focused on one integration at a time. -->
          <div v-else class="grid md:grid-cols-[18rem_1fr] gap-6">
            <!-- Left: integration list -->
            <aside>
              <ul class="card divide-y divide-rule">
                <li v-for="integration in introspection.integrations" :key="integration.formKey">
                  <button
                    type="button"
                    class="w-full text-left px-3 py-2.5 transition-colors block"
                    :class="selectedKey === integration.formKey
                      ? 'bg-accent/5 border-l-2 border-accent -ml-px'
                      : 'border-l-2 border-transparent hover:bg-ink/[0.02]'"
                    @click="selectedKey = integration.formKey"
                  >
                    <div class="text-sm font-medium truncate">
                      {{ integration.integrationLabel || integration.gadgetLabel || integration.integrationId }}
                    </div>
                    <div class="text-xs text-subtle mt-0.5">
                      {{ integration.outputs.length }} output{{ integration.outputs.length === 1 ? '' : 's' }}
                      · {{ placedOutputCount(integration) }} placed
                      · {{ totalConsumers(integration) }} consumer{{ totalConsumers(integration) === 1 ? '' : 's' }}
                    </div>
                  </button>
                </li>
              </ul>
              <p class="mt-3 text-xs text-subtle italic">
                {{ introspection.totals.form }} form ref{{ introspection.totals.form === 1 ? '' : 's' }}
                · {{ introspection.totals.workflow }} workflow ref{{ introspection.totals.workflow === 1 ? '' : 's' }}
              </p>
            </aside>

            <!-- Right: selected integration detail -->
            <article v-if="selected" class="card p-5">
              <header class="flex items-baseline justify-between gap-3 flex-wrap">
                <div>
                  <h3 class="text-lg">
                    <NuxtLink
                      :to="`/integrations/${selected.integrationId}`"
                      class="text-accent hover:underline"
                    >
                      {{ selected.integrationLabel || selected.gadgetLabel || selected.integrationId }}
                    </NuxtLink>
                  </h3>
                  <p class="text-xs text-subtle mt-1">
                    {{ selected.gadgetType }} · gadget "{{ selected.gadgetLabel || '(unnamed)' }}"
                    <span v-if="selected.headless" class="ml-1">· headless</span>
                    <span class="ml-1">·</span>
                    <span v-if="selected.placedOnForm" class="text-ink">placed on form</span>
                    <span v-else>in schema only</span>
                    · <code class="font-mono">{{ selected.formKey }}</code>
                  </p>
                </div>
                <div class="text-xs text-subtle text-right">
                  {{ selected.outputs.length }} output{{ selected.outputs.length === 1 ? '' : 's' }}
                  · {{ placedOutputCount(selected) }} placed
                  · {{ totalConsumers(selected) }} consumer{{ totalConsumers(selected) === 1 ? '' : 's' }}
                </div>
              </header>

              <!-- Inputs: what feeds the integration. -->
              <div v-if="selected.inputs.length" class="mt-5">
                <h4 class="text-xs uppercase tracking-wider text-subtle mb-2">Inputs</h4>
                <ul class="text-sm divide-y divide-rule border border-rule">
                  <li
                    v-for="(input, i) in selected.inputs"
                    :key="i"
                    class="px-3 py-2 flex items-baseline gap-3"
                  >
                    <code class="font-mono text-xs shrink-0 min-w-[10rem]">{{ input.name }}</code>
                    <span class="text-subtle text-xs shrink-0">←</span>
                    <span class="flex-1 text-sm">
                      <template v-if="input.sourceType === 'form'">
                        <span v-if="input.pointsAtLabel">
                          Form field <span class="font-medium">"{{ input.pointsAtLabel }}"</span>
                          <span v-if="input.pointsAtType" class="text-subtle text-xs ml-1">({{ input.pointsAtType }})</span>
                        </span>
                        <span v-else class="text-muted">
                          Form reference <code class="font-mono text-xs">{{ input.pointsAt || '—' }}</code>
                        </span>
                      </template>
                      <template v-else-if="input.sourceType === 'static'">
                        Static <span class="font-mono text-xs">"{{ input.pointsAt }}"</span>
                      </template>
                      <template v-else>
                        <span class="text-subtle">{{ input.sourceType }}</span>
                      </template>
                    </span>
                    <span v-if="input.required" class="text-[10px] uppercase tracking-wider text-subtle shrink-0">required</span>
                  </li>
                </ul>
              </div>

              <!-- Outputs pivoted on consumers — the headline view. -->
              <div class="mt-5">
                <h4 class="text-xs uppercase tracking-wider text-subtle mb-2">
                  Outputs &amp; where they're used
                </h4>
                <div v-if="!selected.outputs.length" class="text-sm text-muted">
                  This integration declares no output fields.
                </div>
                <ul v-else class="space-y-3">
                  <li
                    v-for="output in selected.outputs"
                    :key="output.path"
                    class="border-l-2 pl-3"
                    :class="outputBorderClass(output)"
                  >
                    <div class="flex items-baseline justify-between gap-3 flex-wrap">
                      <div>
                        <span class="font-medium text-sm">
                          {{ output.label || output.path }}
                        </span>
                        <code class="font-mono text-xs text-subtle ml-2">{{ output.path }}</code>
                        <span v-if="output.type" class="text-xs text-subtle ml-2">({{ output.type }})</span>
                        <span v-if="!output.declared" class="text-xs text-accent ml-2">undeclared</span>
                      </div>
                      <div class="text-xs flex items-center gap-2">
                        <span
                          v-if="output.placedOnForm"
                          class="font-display uppercase tracking-wider text-[10px] border border-ink/30 px-1.5 py-0.5 text-ink"
                        >
                          On form
                        </span>
                        <span class="text-subtle">
                          {{ output.consumers.length }} consumer{{ output.consumers.length === 1 ? '' : 's' }}
                        </span>
                      </div>
                    </div>

                    <p v-if="output.placedOnForm" class="mt-1 text-xs text-muted">
                      Placed on form
                      <template v-if="output.placedAs">
                        as <span class="text-ink">"{{ output.placedAs }}"</span>
                      </template>
                    </p>

                    <ul v-if="output.consumers.length" class="mt-2 space-y-1 text-sm">
                      <li
                        v-for="(consumer, i) in output.consumers"
                        :key="i"
                        class="flex items-baseline gap-2 text-muted"
                      >
                        <span class="text-xs uppercase tracking-wider w-20 shrink-0 text-subtle">
                          {{ consumer.side }}
                        </span>
                        <span>
                          <template v-if="consumer.side === 'form'">
                            Gadget <span class="font-medium text-ink">"{{ consumer.gadgetLabel }}"</span>
                            <span class="text-xs text-subtle ml-1">({{ consumer.gadgetType }})</span>
                            <span class="text-xs text-subtle ml-1">— via {{ consumer.evidence }}</span>
                          </template>
                          <template v-else>
                            <span class="font-medium text-ink">{{ consumer.stepType }}</span>
                            step <span class="font-medium text-ink">"{{ consumer.stepName }}"</span>
                            <span class="text-xs text-subtle ml-1">— via {{ consumer.evidence }}</span>
                            <div v-if="consumer.stepPath && consumer.stepPath !== consumer.stepName" class="text-xs text-subtle">
                              {{ consumer.stepPath }}
                            </div>
                          </template>
                        </span>
                      </li>
                    </ul>

                    <p
                      v-if="!output.consumers.length && !output.placedOnForm && output.declared"
                      class="mt-1 text-xs text-muted italic"
                    >
                      Declared but unused — not placed on the form layout, not chained into another integration, and not referenced by any workflow step.
                    </p>
                  </li>
                </ul>
              </div>
            </article>
          </div>
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
const introspection = ref({ integrations: [], gadgetIndex: { list: [], byFormKey: new Map() }, totals: { form: 0, workflow: 0 } });
const selectedKey = ref(null);

const selected = computed(() =>
  introspection.value.integrations.find((i) => i.formKey === selectedKey.value) || null
);

const totalConsumers = (integration) =>
  integration.outputs.reduce((acc, o) => acc + o.consumers.length, 0);

const placedOutputCount = (integration) =>
  integration.outputs.reduce((acc, o) => acc + (o.placedOnForm ? 1 : 0), 0);

const outputBorderClass = (output) => {
  // Strongest signal first: a placed output is the headline finding the
  // demo wants to highlight. A consumer-only (chained / workflow) output is
  // a real but quieter signal. Everything else is dim rule.
  if (output.placedOnForm) return 'border-ink/40';
  if (output.consumers.length) return 'border-ink/40';
  return 'border-rule';
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
    // Auto-select the first integration so the right pane isn't blank.
    selectedKey.value = introspection.value.integrations[0]?.formKey ?? null;
  } finally {
    introspecting.value = false;
  }
};

onMounted(load);
</script>
