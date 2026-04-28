<template>
  <li class="border-l-2 pl-3" :class="borderClass">
    <div class="flex items-baseline justify-between gap-3 flex-wrap">
      <div>
        <span class="font-medium text-sm">
          {{ output.label || output.path }}
        </span>
        <code class="font-mono text-xs text-subtle ml-2">{{ output.path }}</code>
        <span v-if="output.type" class="text-xs text-subtle ml-2">({{ output.type }})</span>
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
  </li>
</template>

<script setup>
const props = defineProps({
  output: { type: Object, required: true },
});

const borderClass = computed(() => {
  if (props.output.placedOnForm) return 'border-ink/40';
  if (props.output.consumers.length) return 'border-ink/40';
  return 'border-rule';
});
</script>
