// Locked CAS transitions and action checks over stored task state.
// The owned-task store adds an opt-in journal-backed writer/reader for
// the same records: creates pair the task document with an ownership
// sidecar in one recoverable operation, transitions commit one CAS
// update operation over BOTH files (task source first, sidecar second,
// the sibling ordering convention), and reads prove the current bytes
// by walking the sidecar's per-record operation chain - a dense array
// indexed by revision (the approvals pattern; this sidecar already
// lived under record-ownership/ where that convention is established).
// The journal operations directory is never enumerated: reads are
// O(record revisions), bounded by maxSessionEvents like siblings.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { err } from './errors.mjs';
import {
  decodeUtf8Strict, lstatOrNull, mkdirpSync, readFileLimited,
  removeIfExists, writeFileExclusive,
} from './fsx.mjs';
import {
  isTransitionAllowed, knownActions, knownStates, loadLimits,
} from './policy.mjs';
import {
  assertDestination, resolveInside, toCanonicalRelative,
} from './paths.mjs';
import {
  getTask, prepareTask, taskFilePath, validateTaskShape,
} from './tasks.mjs';
import { validateReview, validateVerification } from './evidence.mjs';
import { evaluateMethodology, evaluateTaskActions } from './methodology.mjs';
import { canonicalJSON } from './digests.mjs';
import {
  applyJournaledRecordCreation, applyJournaledRecordUpdate,
  getJournalOperation, readJournalSnapshot,
} from './journal.mjs';
import {
  authorizeScope, bindWorkspace, resolveWorkspaceState,
} from './workspaces.mjs';
import {
  assertRecordObject, cloneRecordJSON, isRecordTime, isRecordUUID,
  recordAreaIds, validateRecordScope,
} from './record-ownership-data.mjs';
import { validateRecordTransition } from './record-history.mjs';

const TRANSITION_KEYS = new Set([
  'id', 'to', 'expectedRevision', 'verification', 'review',
]);

function acquireLock(taskFile) {
  const lockPath = taskFile + '.lock';
  try {
    writeFileExclusive(lockPath, '');
    return lockPath;
  } catch (e) {
    if (e && e.code === 'EEXIST') {
      throw err('TASK_LOCKED',
        'task lock exists; refusing to recover it automatically');
    }
    if (e && e.code === 'ENOENT') {
      throw err('TASK_NOT_FOUND', 'task directory does not exist');
    }
    throw e;
  }
}

// Pre-lock input gate shared by the legacy writer and the owned store:
// closed DTO, known target state, safe expected revision and the
// ACT+evidence rule. Domain codes are part of the contract.
export function validateTransitionInput(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw err('INVALID_ARGS', 'transitionTask input must be an object');
  }
  for (const key of Object.keys(input)) {
    if (!TRANSITION_KEYS.has(key)) {
      throw err('UNKNOWN_KEY', `transitionTask received unknown key '${key}'`);
    }
  }
  const { to, expectedRevision } = input;
  if (!knownStates().includes(to)) {
    throw err('INVALID_STATE', `unknown target state '${String(to)}'`);
  }
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw err('REVISION_MISMATCH',
      'expectedRevision must be a non-negative safe integer');
  }
  const attachingEvidence = input.verification !== undefined
    || input.review !== undefined;
  if (to === 'ACT' && attachingEvidence) {
    throw err('INVALID_EVIDENCE',
      'evidence cannot be attached on a transition to ACT');
  }
}

// All transition decision logic given the current stored record: revision
// CAS, workflow edge, evidence merge, ACCEPT gates, next-record shape and
// the ACT/ACCEPT methodology gate, ending in the serialized bytes. Pure
// with respect to the task file itself - callers own the write path
// (legacy tmp+rename, or a journaled CAS update). `at` defaults to now;
// journal-backed callers align it to the operation identity instead.
export function evaluateTaskTransition(ctx, task, input,
    at = new Date().toISOString()) {
  const { id, to, expectedRevision } = input;
  if (task.revision !== expectedRevision) {
    throw err('REVISION_MISMATCH',
      `expected revision ${expectedRevision} but stored ${task.revision}`);
  }
  if (!isTransitionAllowed(task.state, to)) {
    throw err('INVALID_TRANSITION',
      `transition ${task.state} -> ${to} is not allowed by workflow policy`);
  }

  let verification = task.verification;
  let review = task.review;
  if (input.verification !== undefined) {
    verification = validateVerification(input.verification);
    if (input.review === undefined) review = null; // new verification voids review
  }
  if (input.review !== undefined) {
    review = validateReview(input.review, task);
  }
  if (to === 'ACT') {
    verification = null; // returning to implementation voids evidence
    review = null;
  }
  if (to === 'ACCEPT') {
    if (!verification) {
      throw err('ACCEPT_REQUIRES_EVIDENCE',
        'ACCEPT requires non-empty passing verification evidence');
    }
    if (!review) {
      throw err('ACCEPT_REQUIRES_REVIEW',
        'ACCEPT requires a fresh review or an explicit owner waiver');
    }
    // Always re-validate the effective payloads, including ones that were
    // stored by an earlier transition.
    verification = validateVerification(verification);
    review = validateReview(review, task);
  }

  const next = {
    ...task,
    state: to,
    revision: task.revision + 1,
    verification,
    review,
    updatedAt: at,
    history: [...task.history, {
      at, event: 'transition', from: task.state, to,
      revision: task.revision + 1,
    }],
  };
  validateTaskShape(next, `task ${id}`);
  if (to === 'ACT' || to === 'ACCEPT') {
    const result = evaluateMethodology(ctx, next, {
      to, previousRevision: task.revision,
    });
    if (!result.allowed) {
      const e = err('METHODOLOGY_BLOCKED',
        `methodology gate blocked ${to}: ${result.issues[0].code}: ${result.issues[0].message}`);
      e.issues = result.issues;
      e.result = result;
      throw e;
    }
  }
  const serialized = JSON.stringify(next, null, 2) + '\n';
  const maxBytes = loadLimits().maxDocumentBytes;
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    throw err('DOCUMENT_TOO_LARGE',
      `task record would exceed ${maxBytes} bytes`);
  }
  return { next, serialized };
}

export function transitionTask(ctx, input) {
  validateTransitionInput(input);
  const file = taskFilePath(ctx, input.id);
  const lockPath = acquireLock(file);
  let tmpPath = null;
  let tmpOwned = false;
  try {
    const task = getTask(ctx, input.id);
    const { next, serialized } = evaluateTaskTransition(ctx, task, input);
    mkdirpSync(path.dirname(file));
    tmpPath = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    writeFileExclusive(tmpPath, serialized); // cleans itself on write failure
    tmpOwned = true;
    fs.renameSync(tmpPath, file);
    tmpOwned = false;
    return next;
  } finally {
    removeIfExists(lockPath); // only the lock file created above
    if (tmpOwned) removeIfExists(tmpPath); // rename path only
  }
}

// checkAction reports whether an action is permitted by policy in the task's
// current stored state. It does not intercept native host tool calls.
export function checkAction(ctx, taskId, action) {
  if (typeof action !== 'string' || !knownActions().has(action)) {
    throw err('INVALID_ACTION', `unknown action '${String(action)}'`);
  }
  const task = getTask(ctx, taskId);
  const { permitted } = evaluateTaskActions(ctx, task);
  return {
    id: task.id,
    state: task.state,
    action,
    allowed: permitted.includes(action),
    permitted,
  };
}

// ---------------------------------------------------------------------------
// Owned task store (opt-in, journal-backed mutable records)
//
// The record is mutable, so the store follows the sibling mutable-store
// pattern: create emits one two-event create op (task + record-ownership
// sidecar, both revision 0); each transition emits one two-event CAS
// update op in the same [source, sidecar] order as sessions, whose
// sidecar event advances the sidecar as the per-record chain head. The
// sidecar keeps the shared rev0 fields plus `chain`, a dense array of
// operation ids indexed by revision (chain[k] produced revision k, the
// tip last) - the approvals indexing pattern, chosen over the sessions
// linked-list (previousOperationId/createOperationId) because this
// sidecar already lived under record-ownership/ where approvals
// established the mutable-companion convention, and the 9-key shape
// grows by a single field instead of three. Reads walk the chain
// through getJournalOperation only - bounded by maxSessionEvents - and
// each revision's sidecar snapshot re-proves its prefix. No listing, no
// history fallback and no adoption of plausible files.
//
// Placement note: the store lives here, not in tasks.mjs, because the
// transition path needs evaluateMethodology (methodology.mjs imports
// tasks.mjs) - hosting it in tasks.mjs would create a module cycle.
// tasks.mjs stays byte-identical.
// ---------------------------------------------------------------------------

const OWNED_INPUT = 'INVALID_OWNED_TASK_INPUT';
const OWNED_PROOF = {
  missing: 'OWNED_TASK_NOT_FOUND',
  malformed: 'OWNED_TASK_MALFORMED',
  notCommitted: 'OWNED_TASK_NOT_COMMITTED',
  sourceChanged: 'OWNED_TASK_SOURCE_CHANGED',
};
const OWNED_OPTION_KEYS = ['areaIds'];
const OWNED_CREATE_KEYS = ['areaIds', 'task'];
const OWNED_TRANSITION_KEYS = ['areaIds', 'transition'];
const OWNED_SIDECAR_KEYS = [
  'schemaVersion', 'sourceKind', 'recordId', 'sourceRevision', 'sourceRel',
  'sourceHash', 'operationId', 'scope', 'createdAt', 'chain',
];
const HASH_RE = /^[0-9a-f]{64}$/;
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

function ownedMalformed(message) {
  throw err(OWNED_PROOF.malformed, message);
}

function ownedBytes(value, label) {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8');
  if (bytes.length > loadLimits().maxDocumentBytes) {
    throw err('DOCUMENT_TOO_LARGE', `${label} exceeds document limit`);
  }
  return bytes;
}

function sha256Hex(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

// Ten-field mutable ownership sidecar for the 'task' kind: the shared
// nine-key rev0 contract plus `chain`, the per-record operation index
// (approvals pattern). record-ownership-data.mjs only admits the
// immutable kinds and is outside this change's ownership. Revision is
// no longer pinned: chain.length === sourceRevision + 1 and the tip
// entry must equal operationId; sourceRevision stays under the
// maxSessionEvents bound like the sibling stores.
function validateTaskOwnership(value, label = 'task ownership') {
  const code = OWNED_PROOF.malformed;
  assertRecordObject(value, OWNED_SIDECAR_KEYS, OWNED_SIDECAR_KEYS, code, label);
  if (value.schemaVersion !== 1 || value.sourceKind !== 'task'
      || !isRecordUUID(value.recordId)
      || !Number.isSafeInteger(value.sourceRevision)
      || value.sourceRevision < 0
      || value.sourceRevision >= loadLimits().maxSessionEvents
      || typeof value.sourceHash !== 'string' || !HASH_RE.test(value.sourceHash)
      || !isRecordUUID(value.operationId)
      || !isRecordTime(value.createdAt)) {
    throw err(code, `${label} has invalid fields`);
  }
  let rel;
  try {
    if (typeof value.sourceRel !== 'string' || value.sourceRel.includes('\\')) {
      throw new Error('not canonical');
    }
    rel = toCanonicalRelative(value.sourceRel, `${label} sourceRel`);
  } catch {
    throw err(code, `${label} sourceRel is not a canonical relative path`);
  }
  if (rel !== value.sourceRel) {
    throw err(code, `${label} sourceRel is not canonical`);
  }
  validateRecordScope(value.scope, code, `${label} scope`);
  const chain = recordAreaIds(value.chain, code, `${label} chain`);
  if (chain.length !== value.sourceRevision + 1
      || chain[chain.length - 1] !== value.operationId) {
    throw err(code, `${label} chain does not match its revision`);
  }
  return cloneRecordJSON(value);
}

// Bounded current-file read under a revalidated binding: containment,
// no link ancestors, regular file, document limit.
function readCurrentFile(bound, rel, nonRegularCode) {
  const { projectRoot } = resolveWorkspaceState(bound);
  const abs = resolveInside(projectRoot, rel, 'task file');
  const st = lstatOrNull(abs);
  if (!st) throw err(OWNED_PROOF.missing, `task file not found: ${rel}`);
  if (!st.isFile()) {
    throw err(nonRegularCode, `task file is not regular: ${rel}`);
  }
  const limited = readFileLimited(abs, loadLimits().maxDocumentBytes);
  if (limited.exceeded) {
    throw err('DOCUMENT_TOO_LARGE', `task file exceeds limit: ${rel}`);
  }
  return limited.content;
}

// Proven bytes -> validated task record. Anything not a well-formed
// task for THIS record id is a malformed proof, never a partial read.
function parseTaskBytes(bytes, recordId, label = 'task source') {
  const text = decodeUtf8Strict(bytes, OWNED_PROOF.malformed, label);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    ownedMalformed(`${label} is not JSON`);
  }
  try {
    validateTaskShape(parsed, `task ${recordId}`);
  } catch (e) {
    ownedMalformed(`${label} failed validation: ${e.message}`);
  }
  if (parsed.id.toLowerCase() !== recordId) {
    ownedMalformed(`${label} does not match its proof`);
  }
  return parsed;
}

function eventScope(event) {
  return {
    workspaceId: event.workspaceId, projectId: event.projectId,
    repositoryId: event.repositoryId, areaIds: event.areaIds,
  };
}

// Strict sidecar bytes -> validated ten-field document, shared by the
// current-file read and each revision's journaled snapshot.
function parseTaskOwnership(bytes) {
  let parsed;
  try {
    parsed = JSON.parse(
      decodeUtf8Strict(bytes, OWNED_PROOF.malformed, 'task ownership'));
  } catch (e) {
    if (e && e.code === OWNED_PROOF.malformed) throw e;
    ownedMalformed('task ownership is not JSON');
  }
  return validateTaskOwnership(parsed);
}

// Full mutable proof, fixed order, fail closed: canonical sidecar ->
// scope authorization -> the chain's committed two-event operations in
// revision order (a two-create rev0 op, then coherent update pairs on
// BOTH event streams, each revision's sidecar snapshot re-proving the
// chain prefix) -> tip sidecar snapshot equals current sidecar bytes ->
// tip source snapshot equals current source bytes -> record.revision
// equals the proven tip revision. The journal operations directory is
// never enumerated: the sidecar's `chain` is the per-record index.
function proveOwnedTask(bound, recordId, sourceRel, ownershipRel) {
  const sidecarBytes = readCurrentFile(bound, ownershipRel,
    OWNED_PROOF.malformed);
  const owned = parseTaskOwnership(sidecarBytes);
  if (owned.recordId !== recordId || owned.sourceRel !== sourceRel) {
    ownedMalformed('task ownership does not name this record');
  }
  // Grants are validated before any record content is produced.
  authorizeScope(bound, owned.scope);
  const scopeJson = canonicalJSON(owned.scope);
  let prevSource = null;
  let prevSidecar = null;
  let tipSource = null;
  let tipSnapshot = null;
  let tipSidecarSnapshot = null;
  let createRecord = null;
  for (let k = 0; k < owned.chain.length; k += 1) {
    const operationId = owned.chain[k];
    const loaded = getJournalOperation(bound, operationId);
    if (loaded.state !== 'committed') {
      throw err(OWNED_PROOF.notCommitted,
        'task owning operation is not committed');
    }
    const events = loaded.intent.events;
    if (events.length !== 2) {
      ownedMalformed('task operation is not two events');
    }
    const source = events.find((e) => e.sourceKind === 'task');
    const sidecar = events.find((e) => e.sourceKind === 'record-ownership');
    if (!source || !sidecar
        || source.recordId !== recordId || sidecar.recordId !== recordId
        || source.sourceRel !== sourceRel
        || sidecar.sourceRel !== ownershipRel
        || source.createdAt !== loaded.intent.createdAt
        || sidecar.createdAt !== loaded.intent.createdAt
        || canonicalJSON(eventScope(source)) !== scopeJson
        || canonicalJSON(eventScope(sidecar)) !== scopeJson) {
      ownedMalformed('task operation does not prove this record');
    }
    if (k === 0) {
      if (source.operation !== 'create' || sidecar.operation !== 'create'
          || source.sourceRevision !== 0 || sidecar.sourceRevision !== 0
          || source.previousHash !== null || sidecar.previousHash !== null) {
        ownedMalformed('task owning operation is not a creation');
      }
    } else {
      if (source.operation !== 'update' || sidecar.operation !== 'update') {
        ownedMalformed('task revision operation is not an update');
      }
      validateRecordTransition(prevSource, source, OWNED_PROOF.malformed);
      validateRecordTransition(prevSidecar, sidecar, OWNED_PROOF.malformed);
    }
    // Each revision's sidecar snapshot re-proves the chain prefix.
    const sidecarSnapshot = readJournalSnapshot(bound, operationId,
      sidecar.eventId);
    const revOwned = parseTaskOwnership(sidecarSnapshot);
    if (revOwned.recordId !== recordId || revOwned.sourceRel !== sourceRel
        || revOwned.sourceRevision !== k
        || revOwned.operationId !== operationId
        || revOwned.createdAt !== loaded.intent.createdAt
        || revOwned.sourceHash !== source.sourceHash
        || canonicalJSON(revOwned.scope) !== scopeJson
        || canonicalJSON(revOwned.chain)
          !== canonicalJSON(owned.chain.slice(0, k + 1))) {
      ownedMalformed(
        'task ownership snapshot does not prove this revision');
    }
    const sourceSnapshot = readJournalSnapshot(bound, operationId,
      source.eventId);
    if (k === 0) {
      createRecord = parseTaskBytes(sourceSnapshot, recordId,
        'task create snapshot');
      if (createRecord.revision !== 0
          || createRecord.createdAt !== revOwned.createdAt) {
        ownedMalformed('task create snapshot is not the proven record');
      }
    }
    prevSource = source;
    prevSidecar = sidecar;
    tipSource = source;
    tipSnapshot = sourceSnapshot;
    tipSidecarSnapshot = sidecarSnapshot;
  }
  if (!tipSidecarSnapshot.equals(sidecarBytes)) {
    ownedMalformed('current task ownership differs from its snapshot');
  }
  if (owned.sourceHash !== tipSource.sourceHash) {
    ownedMalformed('task ownership hash differs from the task event');
  }
  const currentBytes = readCurrentFile(bound, sourceRel,
    OWNED_PROOF.sourceChanged);
  if (!tipSnapshot.equals(currentBytes)) {
    throw err(OWNED_PROOF.sourceChanged,
      'current task source differs from its proven tip');
  }
  const record = parseTaskBytes(currentBytes, recordId);
  if (record.revision !== owned.sourceRevision
      || record.createdAt !== createRecord.createdAt) {
    ownedMalformed('task revision does not match its proven history');
  }
  return {
    record, ownership: owned, currentBytes, sidecarBytes,
    revision: owned.sourceRevision,
    tip: { operationId: owned.operationId, eventId: tipSource.eventId },
  };
}

export function createOwnedTaskStore(ctx, options) {
  if (ctx === null || typeof ctx !== 'object'
      || typeof ctx.projectRoot !== 'string'
      || ctx.config === null || typeof ctx.config !== 'object') {
    throw err(OWNED_INPUT, 'owned task store requires a resolved context');
  }
  assertRecordObject(options, OWNED_OPTION_KEYS, OWNED_OPTION_KEYS,
    OWNED_INPUT, 'owned task store options');
  const opts = {
    areaIds: recordAreaIds(options.areaIds, OWNED_INPUT,
      'owned task store options'),
  };
  const privateCtx = {
    projectRoot: ctx.projectRoot, config: structuredClone(ctx.config),
  };
  const bound = bindWorkspace(privateCtx, { areaIds: opts.areaIds });
  const tasksRel = assertDestination(privateCtx.config.paths.tasks,
    'paths.tasks');
  const stateRel = assertDestination(privateCtx.config.paths.state,
    'paths.state');
  const sourceRelFor = (recordId) => `${tasksRel}/${recordId}.json`;
  const ownershipRelFor = (recordId) =>
    `${stateRel}/record-ownership/task/${recordId}.json`;

  function scope(areaIds) {
    return {
      workspaceId: bound.workspaceId, projectId: bound.projectId,
      repositoryId: bound.repositoryId, areaIds: [...areaIds],
    };
  }

  function normalizeCreate(input) {
    assertRecordObject(input, OWNED_CREATE_KEYS, OWNED_CREATE_KEYS,
      OWNED_INPUT, 'owned task input');
    const areaIds = recordAreaIds(input.areaIds, OWNED_INPUT,
      'owned task input').sort();
    return { areaIds, task: cloneRecordJSON(input.task) };
  }

  function normalizeTransition(input) {
    assertRecordObject(input, OWNED_TRANSITION_KEYS,
      OWNED_TRANSITION_KEYS, OWNED_INPUT, 'owned task transition input');
    const areaIds = recordAreaIds(input.areaIds, OWNED_INPUT,
      'owned task transition input').sort();
    return { areaIds, transition: cloneRecordJSON(input.transition) };
  }

  // Closed sidecar writer: the stored document is the same ten-field
  // shape the proof validates - never a looser internal form.
  function ownershipDoc(recordId, sourceRel, sourceHash, sourceRevision,
      operationId, createdAt, recordScope, chain) {
    return validateTaskOwnership({
      schemaVersion: 1, sourceKind: 'task', recordId, sourceRevision,
      sourceRel, sourceHash, operationId, scope: recordScope, createdAt,
      chain: [...chain],
    });
  }

  function prepare(input) {
    const normalized = normalizeCreate(input);
    authorizeScope(bound, scope(normalized.areaIds));
    const prepared = prepareTask(privateCtx, normalized.task);
    const record = prepared.task;
    const sourceRel = prepared.file.rel;
    const ownershipRel = ownershipRelFor(record.id);
    const { projectRoot } = resolveWorkspaceState(bound);
    resolveInside(projectRoot, sourceRel, 'task source');
    resolveInside(projectRoot, ownershipRel, 'task ownership');
    const sourceBytes = Buffer.from(prepared.file.content, 'utf8');
    if (sourceBytes.length > loadLimits().maxDocumentBytes) {
      throw err('DOCUMENT_TOO_LARGE', 'task source exceeds document limit');
    }
    ownedBytes(ownershipDoc(record.id, sourceRel, sha256Hex(sourceBytes),
      0, ZERO_UUID, record.createdAt, scope(normalized.areaIds),
      [ZERO_UUID]), 'task ownership');
    return { mode: 'dry-run', record, sourceRel, ownershipRel,
      reservesIds: false };
  }

  function create(input) {
    const normalized = normalizeCreate(input);
    authorizeScope(bound, scope(normalized.areaIds));
    let built = null;
    const journal = applyJournaledRecordCreation(bound, (identity) => {
      // prepareTask generates the task UUID once, inside the strict
      // callback; local timestamps align to the kernel identity before
      // the final bytes are serialized.
      const prepared = prepareTask(privateCtx, normalized.task);
      const record = validateTaskShape({
        ...prepared.task,
        createdAt: identity.createdAt,
        updatedAt: identity.createdAt,
        history: [{ ...prepared.task.history[0], at: identity.createdAt }],
      }, 'owned task');
      const recordId = record.id;
      const sourceRel = prepared.file.rel;
      const ownershipRel = ownershipRelFor(recordId);
      const sourceBytes = ownedBytes(record, 'task source');
      const owned = ownershipDoc(recordId, sourceRel,
        sha256Hex(sourceBytes), 0, identity.operationId,
        identity.createdAt, scope(normalized.areaIds),
        [identity.operationId]);
      const sidecarBytes = ownedBytes(owned, 'task ownership');
      built = { record, sourceRel, ownershipRel };
      return [
        { sourceKind: 'task', recordId, sourceRevision: 0,
          areaIds: [...normalized.areaIds],
          file: { rel: sourceRel, content: sourceBytes } },
        { sourceKind: 'record-ownership', recordId, sourceRevision: 0,
          areaIds: [...normalized.areaIds],
          file: { rel: ownershipRel, content: sidecarBytes } },
      ];
    });
    return { mode: 'applied', record: built.record,
      sourceRel: built.sourceRel, ownershipRel: built.ownershipRel,
      ownershipConfirmed: journal.status === 'committed'
        && journal.journalState === 'confirmed',
      journal };
  }

  // Journalized transition: prove current ownership under the task lock,
  // then extend the chain with one CAS update op whose two events rewrite
  // the task source and advance the sidecar chain head atomically -
  // computed by the same evaluateTaskTransition gates the legacy writer
  // uses. The task lock blocks cooperative legacy writers for the whole
  // window; the seam's byte CAS re-verifies BOTH files under the kernel
  // lock and still catches non-cooperative drift.
  function transition(input) {
    const normalized = normalizeTransition(input);
    authorizeScope(bound, scope(normalized.areaIds));
    const inner = normalized.transition;
    validateTransitionInput(inner);
    const recordId = String(inner.id).toLowerCase();
    const file = taskFilePath(privateCtx, inner.id);
    const lockPath = acquireLock(file);
    let built = null;
    let journal;
    try {
      const sourceRel = sourceRelFor(recordId);
      const ownershipRel = ownershipRelFor(recordId);
      const proof = proveOwnedTask(bound, recordId, sourceRel,
        ownershipRel);
      // The operation must name exactly the record's proven scope.
      if (canonicalJSON([...proof.ownership.scope.areaIds].sort())
          !== canonicalJSON(normalized.areaIds)) {
        throw err('SCOPE_DENIED',
          'transition scope must equal the record ownership scope');
      }
      journal = applyJournaledRecordUpdate(bound, (identity) => {
        const { next, serialized } = evaluateTaskTransition(privateCtx,
          proof.record, inner, identity.createdAt);
        const sourceBytes = Buffer.from(serialized, 'utf8');
        const nextOwned = ownershipDoc(recordId, sourceRel,
          sha256Hex(sourceBytes), next.revision, identity.operationId,
          identity.createdAt, proof.ownership.scope,
          [...proof.ownership.chain, identity.operationId]);
        const nextSidecarBytes = ownedBytes(nextOwned, 'task ownership');
        built = { next };
        return [
          { sourceKind: 'task', recordId,
            sourceRevision: proof.record.revision,
            // The proven tip hash equals sha256 of the current bytes
            // (verified in the proof); the seam re-checks it under lock.
            previousHash: sha256Hex(proof.currentBytes),
            areaIds: [...proof.ownership.scope.areaIds],
            file: { rel: sourceRel, content: sourceBytes } },
          { sourceKind: 'record-ownership', recordId,
            sourceRevision: proof.ownership.sourceRevision,
            // Same CAS discipline on the sidecar file: the kernel
            // re-verifies the proven tip bytes under the journal lock.
            previousHash: sha256Hex(proof.sidecarBytes),
            areaIds: [...proof.ownership.scope.areaIds],
            file: { rel: ownershipRel, content: nextSidecarBytes } },
        ];
      });
    } finally {
      removeIfExists(lockPath); // only the lock file created above
    }
    return {
      mode: 'applied', record: built ? built.next : null,
      sourceRel: sourceRelFor(recordId),
      ownershipRel: ownershipRelFor(recordId),
      updateConfirmed: journal.status === 'committed'
        && journal.journalState === 'confirmed',
      journal,
    };
  }

  function get(recordId) {
    if (!isRecordUUID(recordId)) {
      throw err(OWNED_INPUT, 'owned task id must be a UUID');
    }
    const proof = proveOwnedTask(bound, recordId, sourceRelFor(recordId),
      ownershipRelFor(recordId));
    return {
      record: proof.record, ownership: proof.ownership,
      locator: {
        operationId: proof.tip.operationId,
        eventId: proof.tip.eventId,
      },
      isCurrentSource: true, memoryConsulted: false,
    };
  }

  return Object.freeze({ prepare, create, get, transition });
}
