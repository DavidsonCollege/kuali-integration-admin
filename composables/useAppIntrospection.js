// Walks an app's form schema and workflow JSON to surface every integration
// the app consumes, and — importantly — which gadgets and workflow steps
// actually consume each integration *output*. The render layer pivots on
// outputs ("for this integration's `email` field, who reads it?"), so this
// composable is responsible for resolving raw formKeys to human labels and
// for tracing every reference back to its consumer.
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
//     and a child formKey. They aren't a separate integration use, but
//     they ARE the form-side consumers of an output — we keep them in a
//     gadget index so the output map can name them.
//   - `details.inputFields` is keyed by integration param name. Each entry
//     is `{ required, type, value }` where `type` is "form" (value points
//     at another formKey via `value: { id, type }`) or "static" (value is
//     the raw string).
//   - `details.outputFields` is an array of `{ label, path, type }` —
//     the contract for what flows back into the form.
//
// Workflow shape (confirmed against the Add/Drop Form, 2026-04-27):
//   - `workflow.steps` is the recursive tree. IGNORE `workflow.schema` —
//     it's a duplicate of the form schema.
//   - Container steps `conditional` and `approval` carry
//     `subflows: [{ rule?, steps: [...] }]`. Recurse into subflows.
//   - Step types observed: formfill, conditional, approval, notification.
//     We also keep a future-proofing branch for an explicit `integration`
//     step type (the schema has `InvokeSendIntegrationInput`).
//   - Workflow integrations are usually *indirect*: a notification subject
//     references `{{data.X.email}}`, a conditional rule reads `data.X.major`,
//     etc. We collect every formKey-style reference inside each step (with
//     a tag for whether it came from a `rule`, a `template` placeholder, or
//     somewhere else) and match each one to an integration owner prefix.

export function useAppIntrospection() {
  const introspect = (app) => {
    const gadgetIndex = indexGadgets(app?.formContainer?.schema);
    const integrations = collectIntegrationGadgets(app?.formContainer?.schema, gadgetIndex);
    if (integrations.length === 0) {
      return { integrations: [], gadgetIndex, totals: { form: 0, workflow: 0 } };
    }

    // Each integration carries a map of output-path -> consumers. Pre-populate
    // it from declared outputFields so we can flag declared-but-unconsumed.
    const ownerByPrefix = new Map();
    for (const integration of integrations) {
      ownerByPrefix.set(integration.formKey, integration);
      for (const out of integration.outputs) {
        out.consumers = []; // form-side and workflow-side consumers land here
      }
    }

    let formConsumerCount = 0;
    let workflowConsumerCount = 0;

    // Form-side consumers: any non-integration gadget whose formKey lives
    // under an integration's owner prefix is a child consumer of that
    // integration's output. The auto-spawned Text/Email gadgets land here.
    for (const gadget of gadgetIndex.list) {
      if (gadget.isIntegrationGadget) continue;
      const owner = matchOwner(gadget.formKey, ownerByPrefix);
      if (!owner) continue;
      const outputPath = relativePath(gadget.formKey, owner.formKey);
      const out = owner.outputsByPath.get(outputPath) || ensureUndeclaredOutput(owner, outputPath);
      out.consumers.push({
        side: 'form',
        evidence: 'spawned-gadget',
        gadgetLabel: gadget.label || '(unnamed)',
        gadgetType: gadget.type,
        formKey: gadget.formKey,
      });
      formConsumerCount++;
    }

    // Workflow-side consumers: walk every step and tag each formKey-shaped
    // reference with the field path it was found in (rule / template / config).
    walkWorkflow(app?.workflow, (step, stepPath, references) => {
      for (const ref of references) {
        const owner = matchOwner(ref.formKey, ownerByPrefix);
        if (!owner) continue;
        const outputPath = relativePath(ref.formKey, owner.formKey);
        const out = owner.outputsByPath.get(outputPath) || ensureUndeclaredOutput(owner, outputPath);
        // Dedupe — a single step often references the same path several
        // times (subject + body + assignee). One consumer entry per
        // {step, evidence} is plenty.
        const key = `${step._id || step.stepName}|${ref.evidence}`;
        if (out.consumers.some((c) => c._dedupe === key)) continue;
        out.consumers.push({
          side: 'workflow',
          evidence: ref.evidence,
          stepName: step.stepName || '(unnamed step)',
          stepType: step.type,
          stepPath,
          formKey: ref.formKey,
          _dedupe: key,
        });
        workflowConsumerCount++;
      }

      // Future-proofing: explicit `integration` step type counts as a direct
      // workflow consumer of every output of that integration.
      if (step.type === 'integration') {
        const integrationId = step.integrationId || step.details?.id || step.config?.integrationId;
        const integration = integrations.find((i) => i.integrationId === integrationId);
        if (integration) {
          for (const out of integration.outputs) {
            out.consumers.push({
              side: 'workflow',
              evidence: 'integration-step',
              stepName: step.stepName || '(unnamed step)',
              stepType: step.type,
              stepPath,
              formKey: '',
            });
            workflowConsumerCount++;
          }
        }
      }
    });

    // Resolve every input's source-formKey to a human gadget label.
    for (const integration of integrations) {
      for (const input of integration.inputs) {
        if (input.sourceType === 'form' && input.pointsAt) {
          const target = gadgetIndex.byFormKey.get(input.pointsAt);
          if (target) {
            input.pointsAtLabel = target.label || '';
            input.pointsAtType = target.type || '';
          }
        }
      }
    }

    return {
      integrations,
      gadgetIndex,
      totals: { form: formConsumerCount, workflow: workflowConsumerCount },
    };
  };

  return { introspect };
}

// ---------- Form schema indexing ----------

function indexGadgets(schema) {
  const list = [];
  const byFormKey = new Map();
  if (Array.isArray(schema)) {
    for (const entry of schema) {
      if (!entry || typeof entry !== 'object' || !entry.formKey) continue;
      const node = {
        formKey: entry.formKey,
        type: entry.type || '',
        label: entry.label || '',
        isIntegrationGadget: isIntegrationGadget(entry),
      };
      list.push(node);
      byFormKey.set(node.formKey, node);
    }
  }
  return { list, byFormKey };
}

function collectIntegrationGadgets(schema, gadgetIndex) {
  if (!Array.isArray(schema)) return [];
  const integrations = [];
  for (const entry of schema) {
    if (!isIntegrationGadget(entry)) continue;
    const outputs = extractOutputs(entry.details.outputFields);
    const outputsByPath = new Map();
    for (const out of outputs) outputsByPath.set(out.path, out);
    integrations.push({
      integrationId: entry.details.id,
      integrationLabel: entry.details.label || '',
      formKey: entry.formKey,
      gadgetType: entry.type,
      gadgetLabel: entry.label || '',
      inputs: extractInputs(entry.details.inputFields),
      outputs,
      outputsByPath,
    });
  }
  return integrations;
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
    if (sourceType === 'form') pointsAt = conf?.value?.id ?? null;
    else if (sourceType === 'static') pointsAt = conf?.value ?? null;
    return {
      name,
      sourceType,
      required: Boolean(conf?.required),
      pointsAt,
      pointsAtLabel: '',
      pointsAtType: '',
    };
  });
}

function extractOutputs(outputFields) {
  if (!Array.isArray(outputFields)) return [];
  return outputFields.map((f) => ({
    label: f?.label || '',
    path: f?.path || '',
    type: f?.type || '',
    declared: true,
    consumers: [],
  }));
}

function ensureUndeclaredOutput(integration, path) {
  // A reference points at `<owner>.<path>` for which the integration didn't
  // declare an outputField. We still track the consumer — surfacing it as
  // "undeclared output" is a real finding (probably a stale form field, or a
  // schema drift in the integration). Render side decides how to flag it.
  const out = {
    label: '',
    path,
    type: '',
    declared: false,
    consumers: [],
  };
  integration.outputs.push(out);
  integration.outputsByPath.set(path, out);
  return out;
}

// ---------- Workflow walking ----------

// Match `{{ data.something[0].deeper }}` template placeholders.
const TEMPLATE_FORMKEY_RE = /\{\{\s*(data\.[A-Za-z0-9_.\[\]\-]+)\s*\}\}/g;

function walkWorkflow(workflow, onStep) {
  if (!workflow || typeof workflow !== 'object') return;
  const steps = Array.isArray(workflow.steps) ? workflow.steps : [];
  if (steps.length === 0) return;

  const visit = (step, locationPath) => {
    if (!step || typeof step !== 'object') return;
    const stepPath = [...locationPath, step.stepName || step.type || 'step'].join(' › ');

    // Tagged collection: walk every nested string/object and label each
    // reference by the *field name path* it came from. Lets the render layer
    // say "rule" vs "template" vs "config" instead of just "workflow".
    const references = [];
    collectTaggedRefs(step, [], references);

    onStep(step, stepPath, references);

    if (Array.isArray(step.subflows)) {
      for (const sub of step.subflows) {
        if (Array.isArray(sub?.steps)) {
          for (const child of sub.steps) visit(child, [...locationPath, step.stepName || step.type || 'step']);
        }
      }
    }
  };

  for (const step of steps) visit(step, []);
}

function collectTaggedRefs(node, fieldPath, out) {
  if (!node) return;
  if (typeof node === 'string') {
    const evidence = inferEvidence(fieldPath);
    for (const m of node.matchAll(TEMPLATE_FORMKEY_RE)) {
      out.push({ formKey: m[1], evidence, fieldPath });
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, idx) => collectTaggedRefs(item, [...fieldPath, String(idx)], out));
    return;
  }
  if (typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    if ((k === 'formKey' || k === 'id') && typeof v === 'string' && v.startsWith('data.')) {
      out.push({ formKey: v, evidence: inferEvidence([...fieldPath, k]), fieldPath: [...fieldPath, k] });
    } else {
      collectTaggedRefs(v, [...fieldPath, k], out);
    }
  }
}

function inferEvidence(fieldPath) {
  const joined = fieldPath.join('.').toLowerCase();
  if (joined.includes('rule') || joined.includes('condition')) return 'rule';
  if (joined.includes('template') || joined.includes('subject') || joined.includes('body') || joined.includes('message')) return 'template';
  if (joined.includes('assignee') || joined.includes('approver') || joined.includes('recipient')) return 'assignee';
  return 'config';
}

// ---------- Helpers ----------

function matchOwner(formKey, ownerByPrefix) {
  for (const [prefix, owner] of ownerByPrefix) {
    if (formKey === prefix || formKey.startsWith(prefix + '.')) return owner;
  }
  return null;
}

function relativePath(fullKey, prefix) {
  if (fullKey === prefix) return '';
  if (fullKey.startsWith(prefix + '.')) return fullKey.slice(prefix.length + 1);
  return fullKey;
}
