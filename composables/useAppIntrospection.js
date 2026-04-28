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
//     and a child formKey. **Critical correction (2026-04-28):** every
//     declared output spawns a child gadget regardless of whether the user
//     ever placed that field on the form layout. So the presence of a
//     child gadget is NOT evidence the output is displayed — it's just
//     metadata. Whether a child is actually rendered to the user requires
//     the form's layout structure, which we don't currently fetch (see
//     TODO at the bottom). We track auto-spawned children separately as
//     informational metadata, distinct from real consumers.
//   - `details.inputFields` is keyed by integration param name. Each entry
//     is `{ required, type, value }` where `type` is "form" (value points
//     at another formKey via `value: { id, type }`) or "static" (value is
//     the raw string). When integration B's inputFields point at
//     `data.A.<path>`, that IS a real consumer of A's output.
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
    const schema = app?.formContainer?.schema;
    const gadgetIndex = indexGadgets(schema);
    const topLevelIntegrations = collectIntegrationGadgets(schema, gadgetIndex);

    // Walk the template tree to collect placement info AND any Repeater-
    // scoped integrations (which never appear in formContainer.schema).
    const layout = walkTemplate(app?.formContainer?.template);

    // Lift each Repeater integration into the same shape as a top-level one
    // so downstream code (rendering, owner-prefix matching) can treat them
    // uniformly. The repeaterContext travels along so the render layer can
    // group them visually under their parent Repeater. `details` is kept
    // on the object so the form-side consumer scan can walk it directly
    // (Repeater integrations aren't in formContainer.schema).
    const repeaterIntegrations = layout.repeaterIntegrations.map((g) => {
      const outputs = extractOutputs(g.details?.outputFields);
      const outputsByPath = new Map();
      for (const out of outputs) outputsByPath.set(out.path, out);
      return {
        integrationId: g.details?.id || '',
        integrationLabel: g.details?.label || '',
        gadgetId: g.id,
        formKey: g.formKey,
        gadgetType: g.type,
        gadgetLabel: g.label,
        headless: Boolean(g.details?.headless),
        inputs: extractInputs(g.details?.inputFields),
        outputs,
        outputsByPath,
        details: g.details,
        repeaterContext: g.repeaterContext,
      };
    });

    const integrations = [...topLevelIntegrations, ...repeaterIntegrations];
    if (integrations.length === 0) {
      return { integrations: [], gadgetIndex, layout, totals: { form: 0, workflow: 0 } };
    }

    for (const integration of integrations) {
      // Top-level integrations are placed iff their gadget id is in the
      // template tree. Repeater integrations are definitionally placed —
      // they only exist because they appeared in the template.
      integration.placedOnForm = integration.repeaterContext
        ? true
        : layout.placedIds.has(integration.gadgetId);
    }

    // Each integration carries a map of output-path -> consumers. Pre-populate
    // it from declared outputFields so we can flag declared-but-unconsumed.
    //
    // Gadgets in Kuali have TWO addressable identities: a `formKey` (used in
    // the schema's data path) and an `id` (used in inputFields refs and
    // DataLink parentIds). They're different strings — `data.6QTB1QxYvO`
    // (formKey) and `data.DCBhnVJxs` (id) refer to the same gadget. Register
    // each integration under both prefixes so references in either form
    // resolve to the same owner.
    //
    // Integrations inside a Repeater also need wildcard-prefix registration:
    // conditional visibility refs use `data.<repeater-fk>.data.*.data.<X>`
    // while sibling refs (inputFields, DataLink parentIds) keep the plain
    // `data.<X>` form. Register all four variants so any addressing scheme
    // resolves to the same owner.
    const ownerByPrefix = new Map();
    for (const integration of integrations) {
      const fkPrefix = integration.formKey;
      const idPrefix = integration.gadgetId ? `data.${integration.gadgetId}` : null;
      ownerByPrefix.set(fkPrefix, integration);
      if (idPrefix) ownerByPrefix.set(idPrefix, integration);
      if (integration.repeaterContext?.repeaterFormKey) {
        const rfk = integration.repeaterContext.repeaterFormKey;
        const bareFormKey = fkPrefix.startsWith('data.') ? fkPrefix.slice(5) : fkPrefix;
        ownerByPrefix.set(`data.${rfk}.data.*.data.${bareFormKey}`, integration);
        if (integration.gadgetId) {
          ownerByPrefix.set(`data.${rfk}.data.*.data.${integration.gadgetId}`, integration);
        }
      }
      for (const out of integration.outputs) {
        out.consumers = []; // form-side and workflow-side consumers land here
      }
    }

    let formConsumerCount = 0;
    let workflowConsumerCount = 0;

    // Auto-spawned children — every declared output spawns a child gadget
    // in the schema. The schema tells us NOTHING about whether the user
    // actually placed that field on the form layout. The template tree does:
    // a placed output appears as a DataLink with parentId pointing at the
    // integration's formKey and selectedOutputField.path matching the
    // output's path. We use that to flag each output as placedOnForm.
    for (const gadget of gadgetIndex.list) {
      if (gadget.isIntegrationGadget) continue;
      const match = matchOwner(gadget.formKey, ownerByPrefix);
      if (!match) continue;
      const outputPath = relativePath(gadget.formKey, match.prefix);
      const out = match.owner.outputsByPath.get(outputPath) || ensureUndeclaredOutput(match.owner, outputPath);
      out.autoSpawned = {
        gadgetLabel: gadget.label || '',
        gadgetType: gadget.type || '',
        formKey: gadget.formKey,
        // Auto-spawned-child ids (e.g. "DCBhnVJxs.label") rarely appear in
        // the template directly — placement usually shows up as a DataLink
        // sibling instead — but we check both for completeness.
        placedById: gadget.id ? layout.placedIds.has(gadget.id) : false,
      };
    }

    // Placement via DataLink: layout.dataLinks is the canonical signal.
    // Each entry is `{ parentFormKey, outputPath, label, dataLinkId }`.
    for (const link of layout.dataLinks) {
      const owner = ownerByPrefix.get(link.parentFormKey);
      if (!owner) continue;
      const out = owner.outputsByPath.get(link.outputPath) || ensureUndeclaredOutput(owner, link.outputPath);
      out.placedOnForm = true;
      // Keep the DataLink's display label so the render can say
      // "placed as 'Created By' (DataLink)" rather than just "placed".
      out.placedAs = link.label || out.placedAs || '';
    }
    // Backfill: an output is placed if either a DataLink targets it OR the
    // auto-spawned child gadget id is itself in the template tree.
    for (const integration of integrations) {
      for (const out of integration.outputs) {
        if (out.placedOnForm) continue;
        if (out.autoSpawned?.placedById) {
          out.placedOnForm = true;
          out.placedAs = out.autoSpawned.gadgetLabel || '';
        }
      }
    }

    // Form-side consumers: walk every gadget in the schema and collect every
    // formKey-shaped reference inside its `details`. Any reference that
    // resolves under another integration's owner prefix is a real consumer.
    // Covers (a) chained inputs — integration B's inputFields point at
    // `data.A.<path>`; (b) conditional visibility rules; (c) default values;
    // (d) anything else that ends up as a formKey-shaped string in details.
    // Self-references (an integration's own children) are skipped.
    //
    // Sources scanned: top-level schema entries AND every gadget inside any
    // Repeater (Repeater children don't appear in formContainer.schema, so
    // chained inputs and visibility rules between siblings would otherwise
    // be invisible).
    const consumerSources = [];
    if (Array.isArray(schema)) {
      for (const entry of schema) {
        if (!entry?.formKey || !entry?.details) continue;
        consumerSources.push(entry);
      }
    }
    for (const child of layout.repeaterChildGadgets) {
      // Any of these fields can carry refs — keep the node if at least one
      // is non-empty. Pure presentational nodes with nothing to scan are
      // dropped here so the loop below stays cheap.
      if (!child.details && !child.conditionalVisibility && !child.defaultValue && !child.description) continue;
      consumerSources.push(child);
    }
    // Repeater integrations themselves also need scanning — their inputFields
    // commonly chain to sibling integration outputs in the same row.
    for (const integration of repeaterIntegrations) {
      if (!integration.details) continue;
      consumerSources.push({
        formKey: integration.formKey,
        label: integration.gadgetLabel,
        type: integration.gadgetType,
        details: integration.details,
      });
    }

    for (const entry of consumerSources) {
      if (!entry?.formKey) continue;
      // Scan multiple top-level fields, not just `details`. Conditional
      // visibility, default values, and rich-text descriptions all live at
      // the gadget root, alongside details — and any of them can hold
      // `formKey:`-shaped values or `{{data.X.Y}}` placeholders. Walking
      // each field with its name as the root fieldPath also gives the
      // evidence inferer the right context (visibility / default / etc).
      const refs = [
        ...collectTaggedFormRefs(entry.details, ['details']),
        ...collectTaggedFormRefs(entry.conditionalVisibility, ['conditionalVisibility']),
        ...collectTaggedFormRefs(entry.defaultValue, ['defaultValue']),
        ...collectTaggedFormRefs(entry.description, ['description']),
      ];
      if (refs.length === 0) continue;
      const seen = new Set();
      for (const ref of refs) {
        const match = matchOwner(ref.formKey, ownerByPrefix);
        if (!match) continue;
        const { owner, prefix } = match;
        // Skip self-references — an integration gadget pointing at its own
        // child outputs is internal plumbing, not a downstream consumer.
        if (owner.formKey === entry.formKey) continue;
        if (ref.formKey === entry.formKey) continue;
        if (entry.formKey.startsWith(owner.formKey + '.')) continue;

        const outputPath = relativePath(ref.formKey, prefix);
        // Empty path = ref to the integration gadget itself (e.g. an
        // IsNotEmpty visibility rule on the integration's root). That
        // signals "the integration was selected", not "output X was
        // consumed", so it doesn't belong on the per-output list. The
        // integration's placedOnForm flag already conveys it. Track on
        // the integration instead so the render can surface it later
        // if useful.
        if (outputPath === '') {
          if (!owner.selectionConsumers) owner.selectionConsumers = [];
          const sKey = `${entry.formKey}|${ref.evidence}`;
          if (!owner.selectionConsumers.some((c) => c._dedupe === sKey)) {
            owner.selectionConsumers.push({
              side: 'form',
              evidence: ref.evidence,
              gadgetLabel: entry.label || '(unnamed)',
              gadgetType: entry.type || '',
              formKey: entry.formKey,
              _dedupe: sKey,
            });
          }
          continue;
        }
        const out = owner.outputsByPath.get(outputPath) || ensureUndeclaredOutput(owner, outputPath);
        const dedupeKey = `${entry.formKey}|${ref.evidence}`;
        if (seen.has(`${owner.formKey}|${outputPath}|${dedupeKey}`)) continue;
        seen.add(`${owner.formKey}|${outputPath}|${dedupeKey}`);
        out.consumers.push({
          side: 'form',
          evidence: ref.evidence,
          gadgetLabel: entry.label || '(unnamed)',
          gadgetType: entry.type || '',
          formKey: entry.formKey,
        });
        formConsumerCount++;
      }
    }

    // Workflow-side consumers: walk every step and tag each formKey-shaped
    // reference with the field path it was found in (rule / template / config).
    walkWorkflow(app?.workflow, (step, stepPath, references) => {
      for (const ref of references) {
        const match = matchOwner(ref.formKey, ownerByPrefix);
        if (!match) continue;
        const { owner, prefix } = match;
        const outputPath = relativePath(ref.formKey, prefix);
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

    // Resolve every input's source-formKey to a human gadget label. Inputs
    // are id-based (`data.<gadgetId>.<path>`), so try the id index first
    // and fall back to the formKey index for completeness.
    for (const integration of integrations) {
      for (const input of integration.inputs) {
        if (input.sourceType === 'form' && input.pointsAt) {
          const target = gadgetIndex.byId.get(input.pointsAt) || gadgetIndex.byFormKey.get(input.pointsAt);
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
      layout,
      totals: { form: formConsumerCount, workflow: workflowConsumerCount },
    };
  };

  return { introspect };
}

// ---------- Form schema indexing ----------

function indexGadgets(schema) {
  const list = [];
  const byFormKey = new Map();
  const byId = new Map(); // keyed by `data.<gadget.id>` so inputFields refs resolve directly
  if (Array.isArray(schema)) {
    for (const entry of schema) {
      if (!entry || typeof entry !== 'object' || !entry.formKey) continue;
      const node = {
        id: entry.id || '',
        formKey: entry.formKey,
        type: entry.type || '',
        label: entry.label || '',
        isIntegrationGadget: isIntegrationGadget(entry),
      };
      list.push(node);
      byFormKey.set(node.formKey, node);
      if (node.id) byId.set(`data.${node.id}`, node);
    }
  }
  return { list, byFormKey, byId };
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
      gadgetId: entry.id || '',
      formKey: entry.formKey,
      gadgetType: entry.type,
      gadgetLabel: entry.label || '',
      headless: Boolean(entry.details.headless),
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
    placedOnForm: false,
    placedAs: '',
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
    placedOnForm: false,
    placedAs: '',
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

// Form-side counterpart of the workflow walker's tagged collector. Walks an
// arbitrary subtree (details / conditionalVisibility / etc) and yields
// every formKey-shaped reference it finds, with an evidence tag derived
// from the field path it sat under. The initialFieldPath seeds the
// fieldPath so the evidence inferer can tell visibility refs from
// default-value refs at the root of each scan.
function collectTaggedFormRefs(node, initialFieldPath = []) {
  const out = [];
  const visit = (n, fieldPath) => {
    if (!n) return;
    if (typeof n === 'string') {
      // Strings can carry `{{data.X.Y}}` template placeholders too — same
      // convention the workflow side uses. Tag with the surrounding field
      // path (rule/visibility/etc) so the render layer can explain why.
      const evidence = inferFormEvidence(fieldPath);
      for (const m of n.matchAll(TEMPLATE_FORMKEY_RE)) {
        out.push({ formKey: m[1], evidence, fieldPath });
      }
      return;
    }
    if (Array.isArray(n)) {
      n.forEach((item, idx) => visit(item, [...fieldPath, String(idx)]));
      return;
    }
    if (typeof n !== 'object') return;
    for (const [k, v] of Object.entries(n)) {
      // `formKey` and the `id` inside an `inputFields[*].value` block both
      // hold formKey-shaped strings.
      if ((k === 'formKey' || k === 'id') && typeof v === 'string' && v.startsWith('data.')) {
        out.push({ formKey: v, evidence: inferFormEvidence([...fieldPath, k]), fieldPath: [...fieldPath, k] });
      } else {
        visit(v, [...fieldPath, k]);
      }
    }
  };
  visit(node, initialFieldPath);
  return out;
}

function inferFormEvidence(fieldPath) {
  const joined = fieldPath.join('.').toLowerCase();
  // The most common case: another integration's inputFields pointing at
  // this output. Worth its own evidence tag because it's the strongest
  // possible signal that the output is being chained downstream.
  if (joined.includes('inputfields')) return 'integration-input';
  if (joined.includes('visible') || joined.includes('conditional') || joined.includes('rule') || joined.includes('condition')) return 'visibility';
  if (joined.includes('default')) return 'default';
  if (joined.includes('column') || joined.includes('source') || joined.includes('options')) return 'data-source';
  return 'config';
}

// ---------- Helpers ----------

// Returns `{ owner, prefix }` so callers can compute relativePath against
// whichever prefix matched (formKey-based vs id-based — see the
// "two addressable identities" note in introspect()).
function matchOwner(reference, ownerByPrefix) {
  for (const [prefix, owner] of ownerByPrefix) {
    if (reference === prefix || reference.startsWith(prefix + '.')) {
      return { owner, prefix };
    }
  }
  return null;
}

function relativePath(fullKey, prefix) {
  if (fullKey === prefix) return '';
  if (fullKey.startsWith(prefix + '.')) return fullKey.slice(prefix.length + 1);
  return fullKey;
}

// ---------- Template walking ----------
//
// `formContainer.template` is the layout tree the user actually built — a
// recursive structure of containers (Section, Row, Column, Repeater) and
// gadgets. A gadget is in the template iff the user placed it on the form.
// Auto-spawned schema entries that the user never placed do NOT appear here.
//
// Outputs from the walk:
//   - `placedIds`: the set of every gadget id encountered. Used to mark an
//     integration's primary gadget as placed-on-form.
//   - `dataLinks`: every DataLink gadget, the canonical "show output X from
//     integration Y" element. Each carries `parentId` (the integration's
//     id-prefixed addressing, e.g. "data.nKKmlhYUn") and
//     `selectedOutputField.path` (the output's path, matching
//     `outputFields[*].path` on the integration). Mapped to
//     `{ parentFormKey, outputPath, label, dataLinkId }` so the introspect
//     step can mark the matching output as placedOnForm.
//   - `repeaterIntegrations`: integration gadgets nested inside any Repeater
//     `childrenTemplate`. These do NOT appear in `formContainer.schema` (the
//     schema only flattens top-level entries), so the schema-walking logic
//     would miss them entirely. We extract them from the template, give
//     them a `repeaterContext`, and treat them as a separate group that
//     gets placement, consumer detection, and rendering on equal footing
//     with top-level integrations.
//   - `repeaterChildGadgets`: every non-integration gadget inside any
//     Repeater. We need these so the form-side consumer scan can catch
//     refs like "this sibling in the same row points at integration X's
//     output". Without scanning Repeater children, chained inputs and
//     visibility rules between siblings would be invisible to the walker.
//
// Containers carry their children under `children` (Section/Row/Column) or
// `childrenTemplate` (Repeater). Both are recursed.
function walkTemplate(template) {
  const placedIds = new Set();
  const dataLinks = [];
  const repeaterIntegrations = [];
  const repeaterChildGadgets = [];

  const visit = (node, repeaterContext) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, repeaterContext);
      return;
    }
    if (typeof node.id === 'string' && node.id) placedIds.add(node.id);

    if (node.type === 'DataLink' && node.details) {
      const parentFormKey = node.details.parentId;
      const sel = node.details.selectedOutputField;
      if (typeof parentFormKey === 'string' && sel && typeof sel.path === 'string') {
        dataLinks.push({
          parentFormKey,
          outputPath: sel.path,
          label: node.label || sel.label || '',
          dataLinkId: node.id || '',
          repeaterContext: repeaterContext || null,
        });
      }
    }

    // Repeater entry: stash the context so descendants know which
    // wildcard prefix applies. Template formKeys/ids inside a Repeater
    // don't carry the data. prefix or the repeater path — the walker
    // applies it lazily for owner registration.
    if (node.type === 'Repeater') {
      const childContext = {
        repeaterId: node.id || '',
        repeaterFormKey: node.formKey || '',
        repeaterLabel: node.label || '(unnamed repeater)',
      };
      if (Array.isArray(node.children)) for (const c of node.children) visit(c, childContext);
      if (Array.isArray(node.childrenTemplate)) for (const c of node.childrenTemplate) visit(c, childContext);
      return;
    }

    // Inside a Repeater: catalogue integration gadgets and any other node
    // the form-side consumer scan will need to inspect. Non-integration
    // nodes go to repeaterChildGadgets even if they lack a formKey
    // (Spacers, Sections, Rows, Columns) — they often carry
    // conditionalVisibility refs that point at integration outputs, and
    // missing those would silently under-count consumers.
    if (repeaterContext) {
      if (typeof node.formKey === 'string' && node.formKey && isIntegrationGadget(node)) {
        repeaterIntegrations.push({
          // Mirror the schema convention: prepend "data." so owner-prefix
          // strings line up with how matchOwner expects them.
          formKey: `data.${node.formKey}`,
          id: node.id || '',
          type: node.type || '',
          label: node.label || '',
          details: node.details,
          repeaterContext,
        });
      } else if (node.id || node.details || node.conditionalVisibility || node.description) {
        repeaterChildGadgets.push({
          // Synthesize a stable identity for self-reference skipping. Real
          // gadgets keep their actual formKey; presentational gadgets get
          // an `__id.<id>` string that won't ever match an owner prefix.
          formKey: node.formKey ? `data.${node.formKey}` : `__id.${node.id || ''}`,
          id: node.id || '',
          type: node.type || '',
          label: node.label || '',
          details: node.details || null,
          conditionalVisibility: node.conditionalVisibility || null,
          defaultValue: node.defaultValue || null,
          description: node.description || null,
          repeaterContext,
        });
      }
    }

    if (Array.isArray(node.children)) for (const c of node.children) visit(c, repeaterContext);
    if (Array.isArray(node.childrenTemplate)) for (const c of node.childrenTemplate) visit(c, repeaterContext);
  };
  visit(template, null);
  return { placedIds, dataLinks, repeaterIntegrations, repeaterChildGadgets };
}
