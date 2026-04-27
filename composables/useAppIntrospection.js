// Walks an app's form schema and workflow JSON to surface every integration
// the app consumes — where it's used, what feeds in, and what comes back out.
//
// Form-schema shape (confirmed against a real Davidson app, 2026-04-26):
//   - `formContainer.schema` is a FLAT array. Nesting is encoded in dotted
//     `formKey` strings (e.g. `data.VQnO6zWt3R.data.first_name`), not in
//     children arrays.
//   - A real integration use is a gadget whose `type` starts with
//     "Integration" AND whose `details.id` is a non-empty string. Two
//     types seen so far: IntegrationFill, IntegrationTypeahead.
//   - Linked-gadget spawns (the Text/Email entries auto-derived from an
//     IntegrationFill's outputFields) have `details: null` or `details: {}`
//     and a child formKey. They are presentation, not a separate use, so
//     we skip them.
//   - `details.inputFields` is keyed by integration param name. Each entry
//     is `{ required, type, value }` where `type` is "form" (value points
//     at another formKey via `value: { id, type }`) or "static" (value is
//     the raw string).
//   - `details.outputFields` is an array of `{ label, path, type }` —
//     the contract for what flows back into the form.
//
// Workflow shape (confirmed against the Add/Drop Form, 2026-04-27):
//   - `workflow` is a JSON object. Top-level `workflow.schema` is a *copy*
//     of the form schema — IGNORE it (we already cover the form side).
//   - The actual workflow tree lives at `workflow.steps`. Each step has
//     `_id`, `type`, `stepName`. Container steps (`conditional`, `approval`)
//     carry `subflows: [{ rule?, steps: [...] }]`. Recurse into
//     `subflows[].steps`.
//   - Step types observed: formfill, conditional, approval, notification.
//     The sample app has no `integration` step type — we still match it as
//     a future-proofing hook, since the introspection schema includes
//     `InvokeSendIntegrationInput`.
//   - Workflow integrations are usually *indirect*: a conditional rule, a
//     notification template, or an assignee value referencing a `formKey`
//     that lives under an integration gadget's namespace. We detect these
//     by collecting every `formKey:` value AND every `{{data.X.Y}}`
//     template placeholder inside a step, then checking whether the
//     reference falls under an integration gadget's owner prefix (the
//     formKey of an IntegrationFill/IntegrationTypeahead gadget). The
//     form walker is the source of truth for those owner prefixes.

export function useAppIntrospection() {
  const introspect = (app) => {
    const form = walkFormSchema(app?.formContainer?.schema);
    const workflow = walkWorkflow(app?.workflow, form);
    return {
      form,
      workflow,
      grouped: groupByIntegration([...form, ...workflow]),
    };
  };

  return { introspect };
}

function walkFormSchema(schema) {
  if (!Array.isArray(schema)) return [];
  const refs = [];
  for (const entry of schema) {
    if (!isIntegrationGadget(entry)) continue;
    refs.push({
      source: 'form',
      formKey: entry.formKey,
      gadgetType: entry.type,
      gadgetLabel: entry.label || '',
      integrationId: entry.details.id,
      integrationLabel: entry.details.label || '',
      inputs: extractInputs(entry.details.inputFields),
      outputs: extractOutputs(entry.details.outputFields),
    });
  }
  return refs;
}

function isIntegrationGadget(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (typeof entry.type !== 'string' || !entry.type.startsWith('Integration')) return false;
  const id = entry.details && entry.details.id;
  return typeof id === 'string' && id.length > 0;
}

function extractInputs(inputFields) {
  if (!inputFields || typeof inputFields !== 'object') return [];
  return Object.entries(inputFields).map(([name, conf]) => {
    const sourceType = conf?.type || 'unknown';
    let pointsAt = null;
    if (sourceType === 'form') {
      pointsAt = conf?.value?.id ?? null;
    } else if (sourceType === 'static') {
      pointsAt = conf?.value ?? null;
    }
    return {
      name,
      sourceType,
      required: Boolean(conf?.required),
      pointsAt,
    };
  });
}

function extractOutputs(outputFields) {
  if (!Array.isArray(outputFields)) return [];
  return outputFields.map((f) => ({
    label: f?.label || '',
    path: f?.path || '',
    type: f?.type || '',
  }));
}

// Match `{{data.something[0].deeper}}` template placeholders in notification
// bodies / subjects. Captures the formKey-style path so we can match it
// against integration gadget owner prefixes.
const TEMPLATE_FORMKEY_RE = /\{\{\s*(data\.[A-Za-z0-9_.\[\]\-]+)\s*\}\}/g;

function walkWorkflow(workflow, formRefs) {
  if (!workflow || typeof workflow !== 'object') return [];
  const steps = Array.isArray(workflow.steps) ? workflow.steps : [];
  if (steps.length === 0) return [];

  // Build a lookup so workflow references like `data.VQnO6zWt3R.data.email`
  // can be traced back to the IntegrationFill at `data.VQnO6zWt3R`.
  const owners = (formRefs || []).map((r) => ({
    prefix: r.formKey,
    integrationId: r.integrationId,
    integrationLabel: r.integrationLabel,
  }));

  const refs = [];
  const visit = (step, locationPath) => {
    if (!step || typeof step !== 'object') return;
    const path = [...locationPath, step.stepName || step.type || 'step'];

    // Future-proofing: if Kuali ever ships an `integration` step type, treat
    // it as an explicit invoke. Look for a few plausible id field names.
    if (step.type === 'integration') {
      const integrationId = step.integrationId || step.details?.id || step.config?.integrationId;
      if (integrationId) {
        refs.push({
          source: 'workflow',
          formKey: '',
          gadgetType: step.type,
          gadgetLabel: step.stepName || '',
          stepPath: path.join(' › '),
          integrationId,
          integrationLabel: step.label || step.details?.label || '',
          inputs: [],
          outputs: [],
        });
      }
    }

    // Indirect references: any formKey/template placeholder inside this step
    // that falls under an integration gadget's namespace.
    if (owners.length > 0) {
      const seen = new Set();
      for (const fk of collectFormKeyRefs(step)) {
        const owner = matchOwner(fk, owners);
        if (!owner) continue;
        const dedupeKey = owner.integrationId + '|' + fk;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        refs.push({
          source: 'workflow',
          formKey: fk,
          gadgetType: step.type,
          gadgetLabel: step.stepName || '',
          stepPath: path.join(' › '),
          integrationId: owner.integrationId,
          integrationLabel: owner.integrationLabel,
          inputs: [],
          outputs: [],
        });
      }
    }

    // Recurse — `conditional` and `approval` steps both carry subflows.
    if (Array.isArray(step.subflows)) {
      for (const sub of step.subflows) {
        if (Array.isArray(sub?.steps)) {
          for (const child of sub.steps) visit(child, path);
        }
      }
    }
  };

  for (const step of steps) visit(step, []);
  return refs;
}

// Walk an arbitrary subtree and yield every formKey-shaped reference inside
// it: structured `formKey: "data.X.Y"` values AND `{{data.X.Y}}` placeholders
// found in any string field. Used by walkWorkflow to find integration uses
// that are encoded as data references rather than as explicit step config.
function collectFormKeyRefs(node) {
  const out = [];
  const visit = (n) => {
    if (!n) return;
    if (typeof n === 'string') {
      for (const m of n.matchAll(TEMPLATE_FORMKEY_RE)) out.push(m[1]);
      return;
    }
    if (Array.isArray(n)) { n.forEach(visit); return; }
    if (typeof n !== 'object') return;
    for (const [k, v] of Object.entries(n)) {
      // `formKey` is the canonical pointer name; `id` inside an
      // `inputFields[*].value` block also holds a formKey-shaped string.
      if ((k === 'formKey' || k === 'id') && typeof v === 'string' && v.startsWith('data.')) {
        out.push(v);
      } else {
        visit(v);
      }
    }
  };
  visit(node);
  return out;
}

function matchOwner(formKey, owners) {
  for (const o of owners) {
    if (formKey === o.prefix || formKey.startsWith(o.prefix + '.')) return o;
  }
  return null;
}

function groupByIntegration(refs) {
  const map = new Map();
  for (const ref of refs) {
    const key = ref.integrationId;
    if (!map.has(key)) {
      map.set(key, {
        integrationId: key,
        integrationLabel: ref.integrationLabel,
        uses: [],
      });
    }
    const group = map.get(key);
    if (!group.integrationLabel && ref.integrationLabel) {
      group.integrationLabel = ref.integrationLabel;
    }
    group.uses.push(ref);
  }
  return [...map.values()];
}
