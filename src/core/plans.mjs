// Plan records: atomic creation of a dependency DAG plus its task files.
// preparePlan is read-only; applyPlan (bootstrap) performs exclusive writes.
// Stored plans and tasks are validated on every read; dependency readiness
// is computed from actual task state, never cached.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { err } from './errors.mjs';
import { decodeUtf8Strict, lstatOrNull, readFileLimited } from './fsx.mjs';
import {
  assertDestination, resolveInside,
} from './paths.mjs';
import { loadPolicy, loadLimits } from './policy.mjs';
import {
  buildTaskRecord, getTask, normalizeTaskInput, validateTaskShape,
} from './tasks.mjs';
import { canonicalDigest, canonicalJSON } from './digests.mjs';
import { getArtifact } from './artifacts.mjs';
import { getSpecification } from './specifications.mjs';
import { allScenarioRefs } from './methodology-data.mjs';
import {
  applyPlan as applyExclusiveFiles, preflightPlan,
} from './bootstrap.mjs';
import {
  applyJournaledRecordCreation, applyJournaledRecordUpdate,
} from './journal.mjs';
import {
  assertRecordObject, authorizeScope, bindOwnedStore, cloneRecordJSON,
  normalizeOwnedInput, ownedDocumentBytes, ownedScope, parseOwnedJson,
  readOwnedCurrent, resolveWorkspaceState, sha256Hex,
  validateChainOwnership, walkOwnedIndex,
} from './owned-chain.mjs';

const KEY_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PLAN_INPUT_KEYS = new Set(
  ['key', 'title', 'authorContext', 'tasks', 'specId', 'designId']);
const PLAN_TASK_KEYS = new Set(
  ['key', 'title', 'contract', 'scope', 'dependsOn', 'scenarioRefs']);
const PLAN_KEYS = new Set([
  'schemaVersion', 'key', 'title', 'authorContext', 'inputDigest',
  'tasks', 'createdAt', 'specId', 'designId',
]);
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUUID = (v) => typeof v === 'string' && UUID_RE.test(v);

export function plansDirAbs(ctx) {
  return resolveInside(ctx.projectRoot, ctx.config.paths.plans, 'paths.plans');
}

export function planFileAbs(ctx, key) {
  return path.join(plansDirAbs(ctx), `${key}.json`);
}

function requireKey(value, label) {
  if (typeof value !== 'string' || !KEY_RE.test(value)) {
    throw err('INVALID_VALUE',
      `${label} must match ${KEY_RE}`);
  }
  return value;
}

// Strict input validation + DAG check. Pure: no file access beyond scope
// resolution inside the project root.
export function validatePlanInput(ctx, input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw err('INVALID_PLAN', 'plan input must be an object');
  }
  for (const k of Object.keys(input)) {
    if (!PLAN_INPUT_KEYS.has(k)) {
      throw err('UNKNOWN_KEY', `plan input has unknown key '${k}'`);
    }
  }
  const key = requireKey(input.key, 'plan.key');
  const title = typeof input.title === 'string' && input.title.trim() !== ''
    ? input.title
    : (() => { throw err('INVALID_VALUE', 'plan.title must be non-empty'); })();
  const authorContext =
    typeof input.authorContext === 'string' && input.authorContext.trim() !== ''
      ? input.authorContext
      : (() => { throw err('INVALID_VALUE', 'plan.authorContext must be non-empty'); })();
  // Optional formal pair: both UUIDs together, design bound to the spec at
  // its current digest — resolved at prepare, stored at V2.
  const hasPair = input.specId !== undefined || input.designId !== undefined;
  let spec = null;
  let design = null;
  if (hasPair) {
    if (!isUUID(input.specId) || !isUUID(input.designId)) {
      throw err('INVALID_ID', 'plan specId and designId must both be UUIDs');
    }
    spec = getSpecification(ctx, input.specId);
    design = getArtifact(ctx, 'design', input.designId);
    if (design.schemaVersion !== 2 || design.data === undefined
        || design.data.specId.toLowerCase() !== spec.id.toLowerCase()
        || design.data.specDigest !== canonicalDigest(spec)) {
      throw err('INVALID_PLAN',
        'design must belong to the referenced spec at its current digest');
    }
  }
  const maxTasks = loadLimits().maxPlanTasks;
  if (!Array.isArray(input.tasks)
      || input.tasks.length === 0 || input.tasks.length > maxTasks) {
    throw err('INVALID_PLAN', `plan.tasks must contain 1..${maxTasks} tasks`);
  }

  const seen = new Set();
  const tasks = input.tasks.map((t, i) => {
    if (t === null || typeof t !== 'object' || Array.isArray(t)) {
      throw err('INVALID_PLAN', `tasks[${i}] is not an object`);
    }
    for (const k of Object.keys(t)) {
      if (!PLAN_TASK_KEYS.has(k)) {
        throw err('UNKNOWN_KEY', `tasks[${i}] has unknown key '${k}'`);
      }
    }
    const tkey = requireKey(t.key, `tasks[${i}].key`);
    if (seen.has(tkey)) {
      throw err('INVALID_PLAN', `duplicate task key '${tkey}'`);
    }
    seen.add(tkey);
    // scenarioRefs requires the plan pair — reject before normalization.
    if (!hasPair && t.scenarioRefs !== undefined) {
      throw err('METHODOLOGY_REQUIRED',
        `tasks[${i}].scenarioRefs requires plan specId+designId`);
    }
    const clean = normalizeTaskInput(ctx, {
      title: t.title, contract: t.contract,
      authorContext, scope: t.scope === undefined ? [] : t.scope,
      ...(hasPair ? {
        methodology: null, specId: input.specId, designId: input.designId,
        planKey: key, scenarioRefs: t.scenarioRefs,
      } : {}),
    });
    const dependsOn = t.dependsOn === undefined ? [] : t.dependsOn;
    if (!Array.isArray(dependsOn)) {
      throw err('INVALID_PLAN', `tasks[${i}].dependsOn must be an array`);
    }
    const deps = dependsOn.map((d) => requireKey(d, `tasks[${i}].dependsOn`));
    return { key: tkey, ...clean, dependsOn: deps };
  });

  validateDag(tasks.map((t) => ({ key: t.key, dependsOn: t.dependsOn })),
    'plan input', seen);
  // Formal coverage: union of task assignments must cover the whole spec —
  // overlaps allowed, no holes. (Membership/live-union re-check is a gate.)
  if (hasPair) {
    const all = allScenarioRefs(spec);
    const union = new Set();
    for (const t of tasks) {
      for (const r of t.scenarioRefs) {
        union.add(`${r.requirementId}/${r.scenarioId}`);
      }
    }
    for (const { requirementId, scenarioId } of all) {
      if (!union.has(`${requirementId}/${scenarioId}`)) {
        throw err('INVALID_PLAN',
          `plan leaves scenario ${requirementId}/${scenarioId} uncovered`);
      }
    }
  }
  return { key, title, authorContext, tasks,
    specId: spec?.id, designId: design?.id };
}

// Shared DAG check used by input validation AND stored-record validation:
// unknown refs, self-deps and cycles are all rejected.
export function validateDag(entries, label, seenSet = null) {
  const known = seenSet || new Set(entries.map((t) => t.key));
  const depsOf = new Map(entries.map((t) => [t.key, t.dependsOn]));
  for (const [tkey, deps] of depsOf) {
    for (const d of deps) {
      if (d === tkey) {
        throw err('INVALID_PLAN', `${label}: task '${tkey}' depends on itself`);
      }
      if (!known.has(d)) {
        throw err('INVALID_PLAN',
          `${label}: task '${tkey}' depends on unknown key '${d}'`);
      }
    }
  }
  const state = new Map(); // 0=visiting 1=done
  const visit = (k, chain) => {
    if (state.get(k) === 1) return;
    if (state.get(k) === 0) {
      throw err('INVALID_PLAN',
        `${label}: dependency cycle through '${[...chain, k].join('->')}'`);
    }
    state.set(k, 0);
    for (const d of depsOf.get(k)) visit(d, [...chain, k]);
    state.set(k, 1);
  };
  for (const k of depsOf.keys()) visit(k, []);
}

function planDigest(input) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(input)).digest('hex');
}

// Read-only plan build: returns {plan, files} where files covers the plan
// document plus every task document, each preflighted by the caller.
export function preparePlan(ctx, input) {
  const clean = validatePlanInput(ctx, input);
  const policy = loadPolicy();
  const at = new Date().toISOString();
  const tasks = [];
  const files = [];
  const maxBytes = loadLimits().maxDocumentBytes;
  const assertDoc = (content, label) => {
    if (Buffer.byteLength(content, 'utf8') > maxBytes) {
      throw err('DOCUMENT_TOO_LARGE',
        `${label} would exceed ${maxBytes} bytes`);
    }
    return content;
  };
  for (const t of clean.tasks) {
    const id = crypto.randomUUID();
    const record = buildTaskRecord(t, { id, at, initial: policy.initial });
    validateTaskShape(record, `plan task '${t.key}'`);
    tasks.push({ key: t.key, id, dependsOn: t.dependsOn });
    const rel = `${ctx.config.paths.tasks}/${id}.json`;
    files.push({
      rel,
      abs: resolveInside(ctx.projectRoot, rel, 'task file'),
      content: assertDoc(JSON.stringify(record, null, 2) + '\n', 'task'),
    });
  }
  const plan = {
    schemaVersion: clean.specId !== undefined ? 2 : 1,
    key: clean.key,
    title: clean.title,
    authorContext: clean.authorContext,
    inputDigest: planDigest(input),
    tasks,
    createdAt: at,
    ...(clean.specId !== undefined
      ? { specId: clean.specId, designId: clean.designId } : {}),
  };
  validatePlanShape(plan, 'prepared plan');
  const planRel = `${ctx.config.paths.plans}/${clean.key}.json`;
  files.push({
    rel: planRel,
    abs: planFileAbs(ctx, clean.key),
    content: assertDoc(JSON.stringify(plan, null, 2) + '\n', 'plan'),
  });
  return { plan, files };
}

export function validatePlanShape(plan, label = 'plan') {
  if (plan === null || typeof plan !== 'object' || Array.isArray(plan)) {
    throw err('PLAN_MALFORMED', `${label} is not an object`);
  }
  for (const k of Object.keys(plan)) {
    if (!PLAN_KEYS.has(k)) {
      throw err('PLAN_MALFORMED', `${label} has unknown key '${k}'`);
    }
  }
  const maxTasks = loadLimits().maxPlanTasks;
  const iso = (v) => typeof v === 'string' && v !== ''
    && !Number.isNaN(Date.parse(v))
    && new Date(Date.parse(v)).toISOString() === v;
  if ((plan.schemaVersion !== 1 && plan.schemaVersion !== 2)
      || (plan.schemaVersion === 2
        && (!isUUID(plan.specId) || !isUUID(plan.designId)))
      || (plan.schemaVersion === 1
        && (plan.specId !== undefined || plan.designId !== undefined))
      || typeof plan.title !== 'string' || plan.title.trim() === ''
      || typeof plan.authorContext !== 'string'
      || plan.authorContext.trim() === ''
      || typeof plan.inputDigest !== 'string'
      || !/^[0-9a-f]{64}$/i.test(plan.inputDigest)
      || !iso(plan.createdAt)) {
    throw err('PLAN_MALFORMED', `${label} has invalid required fields`);
  }
  requireKey(plan.key, `${label}.key`);
  if (!Array.isArray(plan.tasks) || plan.tasks.length === 0
      || plan.tasks.length > maxTasks) {
    throw err('PLAN_MALFORMED', `${label}.tasks must contain 1..${maxTasks}`);
  }
  const keys = new Set();
  const ids = new Set();
  for (const [i, t] of plan.tasks.entries()) {
    if (t === null || typeof t !== 'object' || Array.isArray(t)) {
      throw err('PLAN_MALFORMED', `${label}.tasks[${i}] is not an object`);
    }
    for (const k of Object.keys(t)) {
      if (!['key', 'id', 'dependsOn'].includes(k)) {
        throw err('PLAN_MALFORMED', `${label}.tasks[${i}] has unknown key '${k}'`);
      }
    }
    requireKey(t.key, `${label}.tasks[${i}].key`);
    if (keys.has(t.key)) {
      throw err('PLAN_MALFORMED', `${label} duplicates task key '${t.key}'`);
    }
    keys.add(t.key);
    if (!isUUID(t.id)) {
      throw err('PLAN_MALFORMED', `${label}.tasks[${i}].id is not a UUID`);
    }
    const lid = t.id.toLowerCase();
    if (ids.has(lid)) {
      throw err('PLAN_MALFORMED', `${label} duplicates task id ${t.id}`);
    }
    ids.add(lid);
    if (!Array.isArray(t.dependsOn)
        || !t.dependsOn.every((d) => KEY_RE.test(d))) {
      throw err('PLAN_MALFORMED', `${label}.tasks[${i}].dependsOn invalid`);
    }
  }
  // Stored records get the same DAG check as inputs: self, missing, cycles.
  try {
    validateDag(plan.tasks.map((t) => ({
      key: t.key, dependsOn: t.dependsOn,
    })), label, keys);
  } catch (e) {
    if (e && e.code === 'INVALID_PLAN') {
      throw err('PLAN_MALFORMED', e.message);
    }
    throw e;
  }
  return plan;
}

export function getPlan(ctx, key) {
  requireKey(key, 'plan key');
  const file = planFileAbs(ctx, key);
  const st = lstatOrNull(file);
  if (!st) throw err('PLAN_NOT_FOUND', `plan not found: ${key}`);
  if (st.isSymbolicLink() || !st.isFile()) {
    throw err('SYMLINK_REJECTED', `plan file may not be a link: ${key}`);
  }
  const limited = readFileLimited(file, loadLimits().maxDocumentBytes);
  if (limited.exceeded) {
    throw err('PLAN_MALFORMED', `plan ${key} exceeds document limit`);
  }
  const text = decodeUtf8Strict(
    limited.content, 'PLAN_MALFORMED', `plan ${key}`);
  let plan;
  try {
    plan = JSON.parse(text);
  } catch {
    throw err('PLAN_MALFORMED', `plan ${key} contains malformed JSON`);
  }
  try {
    plan = validatePlanShape(plan, `plan ${key}`);
  } catch (e) {
    if (e && e.code === 'PLAN_MALFORMED') throw e;
    throw err('PLAN_MALFORMED', `plan ${key} failed validation: ${e.message}`);
  }
  if (plan.key !== key) {
    throw err('PLAN_MALFORMED', `plan key ${plan.key} does not match filename`);
  }
  return plan;
}

export function listPlans(ctx) {
  const dir = plansDirAbs(ctx);
  const out = { plans: [], malformed: [] };
  const st = lstatOrNull(dir);
  if (!st) return out;
  if (st.isSymbolicLink() || !st.isDirectory()) {
    throw err('INVALID_PATH', 'plans path is not a real directory');
  }
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(dir, name);
    const fst = lstatOrNull(file);
    if (!fst || fst.isSymbolicLink() || !fst.isFile()) continue;
    const key = name.slice(0, -'.json'.length);
    try {
      out.plans.push(getPlan(ctx, key));
    } catch (e) {
      out.malformed.push({
        file: name,
        error: { code: e.code || 'INTERNAL', message: e.message },
      });
    }
  }
  return out;
}

// Dependency readiness from ACTUAL stored task state: ready = PLAN with
// every dependency CLOSE; closed = CLOSE; blocked = PLAN with unfinished
// deps; anything else = active. Missing/malformed tasks are errors.
// The ancestor walk mirrors the ACT gate (checkDependencies in
// methodology.mjs): transitive, so a closed direct dependency cannot hide
// an unfinished ancestor and 'ready' is exactly 'would pass the gate now'.
// getPlan re-validates the stored DAG, so `seen` only bounds each walk to
// the plan's own task count (maxPlanTasks) as a defensive measure.
export function nextPlanTasks(ctx, key) {
  const plan = getPlan(ctx, key);
  const states = new Map();
  for (const t of plan.tasks) {
    const task = getTask(ctx, t.id);
    states.set(t.key, task);
  }
  const depsOf = new Map(plan.tasks.map((t) => [t.key, t.dependsOn]));
  return plan.tasks.map((t) => {
    const task = states.get(t.key);
    const unfinished = [];
    const seen = new Set();
    const pending = [...t.dependsOn];
    while (pending.length > 0) {
      const d = pending.pop();
      if (seen.has(d)) continue;
      seen.add(d);
      if (states.get(d).state !== 'CLOSE') unfinished.push(d);
      const deps = depsOf.get(d); // keys/DAG re-validated by getPlan
      if (deps) pending.push(...deps);
    }
    let status;
    if (task.state === 'CLOSE') status = 'closed';
    else if (task.state === 'PLAN' && unfinished.length === 0) status = 'ready';
    else if (task.state === 'PLAN') status = 'blocked';
    else status = 'active';
    return {
      key: t.key, id: task.id, state: task.state, status,
      blockedBy: unfinished,
    };
  });
}

// ---------------------------------------------------------------------------
// Owned plans: opt-in journal-backed mutable plan documents.
//
// The owned record is the plan DOCUMENT plus a mutable 'plan-ownership'
// sidecar. Creation commits a two-event create op (plan + sidecar rev0);
// membership/state evolution commits two-event update ops (CAS on both
// files) through applyJournaledRecordUpdate. The sidecar carries the
// append-only operations list the kernel does not index, so reads can
// rebuild and verify the whole chain. Member task files stay in the task
// domain: they are created by the legacy all-or-nothing writer and are
// never adopted, deleted or rewritten by this store. Readiness
// (nextPlanTasks) is a derived read over live task files and is
// deliberately NOT part of the proof. The legacy writers above are
// byte-identical and unchanged.
// ---------------------------------------------------------------------------

const OWNED_PLAN_INPUT = 'INVALID_OWNED_PLAN_INPUT';
const OWNED_PLAN_UPDATE_KEYS = ['key', 'expectedRevision', 'plan'];
const OWNED_PLAN_KIND = 'plan-ownership';

function ownedPlanMalformed(message) {
  throw err('OWNED_PLAN_MALFORMED', message);
}

const ownedPlanBytes = ownedDocumentBytes;
const ownedPlanSha = sha256Hex;

// Closed 11-field mutable ownership sidecar. sourceRevision tracks the
// plan document revision (0 at create, +1 per committed update op) and
// operations lists every op that produced a revision, in order.
function validatePlanOwnership(value, label = 'plan ownership') {
  return validateChainOwnership(value, {
    sourceKind: OWNED_PLAN_KIND,
    recordIdOk: (id) => typeof id === 'string' && KEY_RE.test(id),
    indexKey: 'operations', updatedAt: true, indexUnique: false,
    code: 'OWNED_PLAN_MALFORMED', label });
}

// Single serializer for the sidecar: fixed key order so the proof can
// byte-rebuild the expected document for any chain prefix.
function buildPlanOwnership(fields) {
  const scope = fields.scope;
  return {
    schemaVersion: 1, sourceKind: OWNED_PLAN_KIND,
    recordId: fields.recordId, sourceRevision: fields.sourceRevision,
    sourceRel: fields.sourceRel, sourceHash: fields.sourceHash,
    operationId: fields.operationId, operations: [...fields.operations],
    scope: {
      workspaceId: scope.workspaceId, projectId: scope.projectId,
      repositoryId: scope.repositoryId, areaIds: [...scope.areaIds],
    },
    createdAt: fields.createdAt, updatedAt: fields.updatedAt,
  };
}

export function createOwnedPlanStore(ctx, options) {
  const { privateCtx, bound } = bindOwnedStore(ctx, options,
    OWNED_PLAN_INPUT, 'owned plan store');
  const plansRel = assertDestination(privateCtx.config.paths.plans,
    'paths.plans');
  const stateRel = assertDestination(privateCtx.config.paths.state,
    'paths.state');
  const planRelFor = (key) => `${plansRel}/${key}.json`;
  const ownershipRelFor = (key) =>
    `${stateRel}/plan-ownership/${key}.json`;

  function scope(areaIds) {
    return ownedScope(bound, areaIds);
  }

  function requirePlanKey(value, label) {
    if (typeof value !== 'string' || !KEY_RE.test(value)) {
      throw err(OWNED_PLAN_INPUT,
        `${label} must match ${KEY_RE}`);
    }
    return value;
  }

  function parseStoredPlan(bytes, key) {
    const parsed = parseOwnedJson(bytes, 'OWNED_PLAN_MALFORMED',
      'plan source');
    let record;
    try {
      record = validatePlanShape(parsed, `owned plan ${key}`);
    } catch (e) {
      ownedPlanMalformed(
        `stored plan failed validation: ${e.message}`);
    }
    if (record.key !== key) {
      ownedPlanMalformed('plan document key does not match its proof');
    }
    return record;
  }

  // Full chain proof shared by get and update: sidecar first, scope
  // authorization before any content, then every claimed operation must
  // be committed, shaped and chained, with each op's sidecar snapshot
  // byte-equal to the expected document for its prefix. Tip post-images
  // must equal the current bytes. No listing, adoption or fallback.
  function proveOwnership(key) {
    const planRel = planRelFor(key);
    const ownershipRel = ownershipRelFor(key);
    const sidecarBytes = readOwnedCurrent(bound, ownershipRel, {
      missingCode: 'OWNED_PLAN_NOT_FOUND',
      nonRegularCode: 'OWNED_PLAN_MALFORMED', label: 'plan ownership' });
    const owned = validatePlanOwnership(
      parseOwnedJson(sidecarBytes, 'OWNED_PLAN_MALFORMED',
        'plan ownership'));
    if (owned.recordId !== key || owned.sourceRel !== planRel) {
      ownedPlanMalformed('plan ownership does not name this record');
    }
    authorizeScope(bound, owned.scope);
    const scopeJson = canonicalJSON(owned.scope);
    let genesisAt = null;
    let tipPlanEvent = null;
    let tipPlanSnapshot = null;
    let tipSidecarSnapshot = null;
    for (const hop of walkOwnedIndex(bound, owned.operations, {
      sourceKind: 'plan', sidecarKind: OWNED_PLAN_KIND,
      recordId: key, sourceRel: planRel, sidecarRel: ownershipRel,
      scopeJson, code: 'OWNED_PLAN_MALFORMED',
      notCommittedCode: 'OWNED_PLAN_NOT_COMMITTED',
      label: 'plan' })) {
      if (hop.index === 0) genesisAt = hop.loaded.intent.createdAt;
      const expected = ownedPlanBytes(validatePlanOwnership(
        buildPlanOwnership({
          recordId: key, sourceRevision: hop.index, sourceRel: planRel,
          sourceHash: hop.source.sourceHash,
          operationId: hop.operationId,
          operations: owned.operations.slice(0, hop.index + 1),
          scope: owned.scope, createdAt: genesisAt,
          updatedAt: hop.loaded.intent.createdAt }),
        'plan ownership'), 'plan ownership');
      if (!hop.sidecarSnapshot.equals(expected)) {
        ownedPlanMalformed(
          'plan ownership chain does not match its operations');
      }
      tipPlanEvent = hop.source;
      tipPlanSnapshot = hop.sourceSnapshot;
      tipSidecarSnapshot = hop.sidecarSnapshot;
    }
    if (!tipSidecarSnapshot.equals(sidecarBytes)) {
      throw err('OWNED_PLAN_SOURCE_CHANGED',
        'current plan ownership differs from its snapshot');
    }
    const currentPlan = readOwnedCurrent(bound, planRel, {
      missingCode: 'OWNED_PLAN_NOT_FOUND',
      nonRegularCode: 'OWNED_PLAN_SOURCE_CHANGED', label: 'owned plan' });
    if (!currentPlan.equals(tipPlanSnapshot)) {
      throw err('OWNED_PLAN_SOURCE_CHANGED',
        'current plan source differs from its snapshot');
    }
    return {
      record: parseStoredPlan(Buffer.from(tipPlanSnapshot), key),
      ownership: owned, tipPlanEvent, tipPlanSnapshot,
      currentPlanBytes: currentPlan, currentSidecarBytes: sidecarBytes,
    };
  }

  function normalizeCreateInput(input) {
    return normalizeOwnedInput(input, 'plan', OWNED_PLAN_INPUT,
      'owned plan input');
  }

  // Update-time domain rules on the caller's next document: stored shape
  // + DAG (validatePlanShape), immutable provenance fields, stable member
  // ids for surviving keys, existing files for new member ids and, for
  // V2 plans, formal member refs plus full scenario coverage.
  function validateNextPlanDoc(key, doc, current) {
    validatePlanShape(doc, 'owned plan update');
    if (doc.key !== key) {
      throw err(OWNED_PLAN_INPUT,
        'plan update key does not match the record');
    }
    if (doc.schemaVersion !== current.schemaVersion
        || doc.authorContext !== current.authorContext
        || doc.inputDigest !== current.inputDigest
        || doc.createdAt !== current.createdAt
        || (doc.specId ?? null) !== (current.specId ?? null)
        || (doc.designId ?? null) !== (current.designId ?? null)) {
      throw err(OWNED_PLAN_INPUT,
        'plan update cannot change immutable provenance fields');
    }
    const oldByKey = new Map(current.tasks.map((t) => [t.key, t]));
    for (const t of doc.tasks) {
      const prev = oldByKey.get(t.key);
      if (prev && prev.id.toLowerCase() !== t.id.toLowerCase()) {
        throw err(OWNED_PLAN_INPUT,
          `member '${t.key}' cannot be rebound to another task id`);
      }
    }
    const oldIds = new Set(current.tasks.map((t) => t.id.toLowerCase()));
    for (const t of doc.tasks) {
      if (!oldIds.has(t.id.toLowerCase())) {
        getTask(privateCtx, t.id); // TASK_NOT_FOUND/TASK_MALFORMED propagate
      }
    }
    if (current.schemaVersion === 2) {
      const spec = getSpecification(privateCtx, current.specId);
      const union = new Set();
      for (const t of doc.tasks) {
        const member = getTask(privateCtx, t.id);
        if (member.schemaVersion !== 2
            || typeof member.specId !== 'string'
            || typeof member.designId !== 'string'
            || member.specId.toLowerCase() !== current.specId.toLowerCase()
            || member.designId.toLowerCase() !== current.designId.toLowerCase()
            || member.planKey !== key) {
          throw err('PLAN_MEMBERSHIP_INVALID',
            `member '${t.key}' lacks matching V2 formal refs`);
        }
        for (const r of member.scenarioRefs) {
          union.add(`${r.requirementId}/${r.scenarioId}`);
        }
      }
      for (const { requirementId, scenarioId } of allScenarioRefs(spec)) {
        if (!union.has(`${requirementId}/${scenarioId}`)) {
          throw err('INVALID_PLAN',
            `plan leaves scenario ${requirementId}/${scenarioId} uncovered`);
        }
      }
    }
    // Re-emit in the canonical stored field order (same shape the create
    // serializer produces) so byte identity is stable across updates.
    return {
      schemaVersion: doc.schemaVersion, key: doc.key, title: doc.title,
      authorContext: doc.authorContext, inputDigest: doc.inputDigest,
      tasks: doc.tasks.map((t) => ({ key: t.key, id: t.id,
        dependsOn: [...t.dependsOn] })),
      createdAt: doc.createdAt,
      ...(doc.schemaVersion === 2
        ? { specId: doc.specId, designId: doc.designId } : {}),
    };
  }

  function prepare(input) {
    const normalized = normalizeCreateInput(input);
    authorizeScope(bound, scope(normalized.areaIds));
    const prepared = preparePlan(privateCtx, normalized.plan);
    const record = prepared.plan;
    const planRel = planRelFor(record.key);
    const ownershipRel = ownershipRelFor(record.key);
    const { projectRoot } = resolveWorkspaceState(bound);
    resolveInside(projectRoot, planRel, 'plan source');
    resolveInside(projectRoot, ownershipRel, 'plan ownership');
    const planFile = prepared.files.at(-1);
    if (planFile.rel !== planRel) {
      throw err('INTERNAL', 'prepared plan file does not match its path');
    }
    const planBytes = Buffer.from(planFile.content, 'utf8');
    ownedPlanBytes(record, 'plan source');
    const probeOwnership = ownedPlanBytes(validatePlanOwnership(
      buildPlanOwnership({
        recordId: record.key, sourceRevision: 0, sourceRel: planRel,
        sourceHash: ownedPlanSha(planBytes),
        operationId: '00000000-0000-0000-0000-000000000000',
        operations: ['00000000-0000-0000-0000-000000000000'],
        scope: scope(normalized.areaIds),
        createdAt: record.createdAt, updatedAt: record.createdAt }),
      'plan ownership'), 'plan ownership');
    const planned = preflightPlan(projectRoot, [
      ...prepared.files.map((f) => ({ rel: f.rel, content: f.content })),
      { rel: ownershipRel, content: probeOwnership },
    ]);
    return { mode: 'dry-run', record, sourceRel: planRel, ownershipRel,
      files: planned.map((f) => ({ path: f.rel, action: f.action })),
      reservesIds: false };
  }

  function create(input) {
    const normalized = normalizeCreateInput(input);
    authorizeScope(bound, scope(normalized.areaIds));
    const { projectRoot } = resolveWorkspaceState(bound);
    const prepared = preparePlan(privateCtx, normalized.plan);
    const record = prepared.plan;
    const planRel = planRelFor(record.key);
    const ownershipRel = ownershipRelFor(record.key);
    // Fail before the task leg when either owned destination exists.
    for (const rel of [planRel, ownershipRel]) {
      const abs = resolveInside(projectRoot, rel,
        'owned plan destination');
      if (lstatOrNull(abs)) {
        throw err('OWNED_PLAN_CONFLICT',
          `owned plan destination exists: ${rel}`);
      }
    }
    // Member task files stay in the task domain: legacy all-or-nothing
    // writer, byte-identical. A failed journal op afterwards can leave
    // inert unreferenced task files - never a committed plan missing
    // them (the reverse ordering is strictly worse).
    const taskFiles = prepared.files.filter((f) => f.rel !== planRel);
    const appliedTasks = applyExclusiveFiles(projectRoot, taskFiles);
    let built = null;
    const journal = applyJournaledRecordCreation(bound, (identity) => {
      const planFile = prepared.files.at(-1);
      const sourceBytes = Buffer.from(planFile.content, 'utf8');
      const owned = validatePlanOwnership(buildPlanOwnership({
        recordId: record.key, sourceRevision: 0, sourceRel: planRel,
        sourceHash: ownedPlanSha(sourceBytes),
        operationId: identity.operationId,
        operations: [identity.operationId],
        scope: scope(normalized.areaIds),
        createdAt: identity.createdAt, updatedAt: identity.createdAt }),
        'plan ownership');
      const sidecarBytes = ownedPlanBytes(owned, 'plan ownership');
      built = { record, sourceRel: planRel, ownershipRel };
      return [
        { sourceKind: 'plan', recordId: record.key, sourceRevision: 0,
          areaIds: [...normalized.areaIds],
          file: { rel: planRel, content: sourceBytes } },
        { sourceKind: OWNED_PLAN_KIND, recordId: record.key,
          sourceRevision: 0, areaIds: [...normalized.areaIds],
          file: { rel: ownershipRel, content: sidecarBytes } },
      ];
    });
    return { mode: 'applied', record: built.record,
      sourceRel: built.sourceRel, ownershipRel: built.ownershipRel,
      taskFiles: appliedTasks.files,
      ownershipConfirmed: journal.status === 'committed'
        && journal.journalState === 'confirmed',
      journal };
  }

  function update(input) {
    assertRecordObject(input, OWNED_PLAN_UPDATE_KEYS,
      OWNED_PLAN_UPDATE_KEYS, OWNED_PLAN_INPUT, 'owned plan update input');
    const key = requirePlanKey(input.key, 'owned plan update key');
    if (!Number.isSafeInteger(input.expectedRevision)
        || input.expectedRevision < 0) {
      throw err(OWNED_PLAN_INPUT,
        'owned plan update expectedRevision must be an integer >= 0');
    }
    const next = cloneRecordJSON(input.plan);
    // Prove the current chain first: a forged or lagging sidecar is
    // rejected before any new op, never adopted into the history.
    const proven = proveOwnership(key);
    if (input.expectedRevision !== proven.ownership.sourceRevision) {
      throw err('REVISION_MISMATCH',
        `expected revision ${input.expectedRevision} but stored `
        + proven.ownership.sourceRevision);
    }
    const planRel = planRelFor(key);
    const ownershipRel = ownershipRelFor(key);
    const doc = validateNextPlanDoc(key, next, proven.record);
    const nextBytes = ownedPlanBytes(doc, 'plan source');
    const currentBytes = proven.currentPlanBytes;
    if (nextBytes.equals(currentBytes)) {
      return { mode: 'unchanged', record: proven.record,
        sourceRel: planRel, ownershipRel,
        sourceRevision: proven.ownership.sourceRevision };
    }
    const areaIds = [...proven.ownership.scope.areaIds];
    const previousRevision = proven.ownership.sourceRevision;
    let built = null;
    const journal = applyJournaledRecordUpdate(bound, (identity) => {
      const owned = validatePlanOwnership(buildPlanOwnership({
        recordId: key, sourceRevision: previousRevision + 1,
        sourceRel: planRel, sourceHash: ownedPlanSha(nextBytes),
        operationId: identity.operationId,
        operations: [...proven.ownership.operations,
          identity.operationId],
        scope: proven.ownership.scope,
        createdAt: proven.ownership.createdAt,
        updatedAt: identity.createdAt }), 'plan ownership');
      const sidecarBytes = ownedPlanBytes(owned, 'plan ownership');
      built = { record: doc };
      return [
        { sourceKind: 'plan', recordId: key,
          sourceRevision: previousRevision,
          previousHash: ownedPlanSha(currentBytes), areaIds: [...areaIds],
          file: { rel: planRel, content: nextBytes } },
        { sourceKind: OWNED_PLAN_KIND, recordId: key,
          sourceRevision: previousRevision,
          previousHash: ownedPlanSha(proven.currentSidecarBytes),
          areaIds: [...areaIds],
          file: { rel: ownershipRel, content: sidecarBytes } },
      ];
    });
    return { mode: 'applied', record: built.record,
      sourceRel: planRel, ownershipRel,
      sourceRevision: previousRevision + 1,
      updateConfirmed: journal.status === 'committed'
        && journal.journalState === 'confirmed',
      journal };
  }

  function get(key) {
    requirePlanKey(key, 'owned plan key');
    const proven = proveOwnership(key);
    return { record: proven.record, ownership: proven.ownership,
      locator: { operationId: proven.ownership.operationId,
        eventId: proven.tipPlanEvent.eventId },
      sourceRevision: proven.ownership.sourceRevision,
      isCurrentSource: true, memoryConsulted: false };
  }

  return Object.freeze({ prepare, create, get, update });
}
