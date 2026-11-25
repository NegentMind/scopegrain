// SPDX-License-Identifier: Apache-2.0
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
  mkdirpSync, removeIfExists, writeFileExclusive,
} from './fsx.mjs';
import {
  isTransitionAllowed, knownActions, knownStates, loadLimits, loadPolicy,
} from './policy.mjs';
import {
  assertDestination, resolveInside,
} from './paths.mjs';
import {
  acquireVerifiedLock, releaseVerifiedLock,
} from './locks.mjs';
import {
  getTask, prepareTask, taskFilePath, validateTaskShape,
  normalizeV3Input, V3_DEFAULTS,
} from './tasks.mjs';
import { validateReview, validateVerification } from './evidence.mjs';
import { evaluateMethodology, evaluateTaskActions } from './methodology.mjs';
import {
  classifyWork, validateMethodologyData,
} from './methodology-data.mjs';
import { canonicalJSON } from './digests.mjs';
import {
  applyJournaledRecordCreation, applyJournaledRecordUpdate,
} from './journal.mjs';
import {
  authorizeScope, bindOwnedStore, decodeUtf8Strict,
  normalizeOwnedInput, ownedDocumentBytes, ownedScope, parseOwnedJson,
  readOwnedCurrent, resolveWorkspaceState, sha256Hex,
  validateChainOwnership, walkOwnedIndex,
} from './owned-chain.mjs';
import { isRecordUUID } from './record-ownership-data.mjs';

const TRANSITION_KEYS = new Set([
  'id', 'to', 'expectedRevision', 'verification', 'review',
]);

function acquireLock(taskFile) {
  const lockPath = taskFile + '.lock';
  try {
    return acquireVerifiedLock(lockPath, 'TASK_LOCKED',
      'task lock is held by another live operation');
  } catch (e) {
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

// The canonical policy's `constraints` block declares the content guards
// edges cannot express (terminal dispositions, ->CLOSE methodology
// revalidation). The runtime reads them here and pins them to the
// authored values: a missing or divergent block fails closed with
// POLICY_INVALID instead of silently weakening a gate.
function workflowConstraints() {
  const c = loadPolicy().constraints;
  const exact = (v, want) => Array.isArray(v) && v.length === want.length
    && v.every((x) => want.includes(x));
  if (c === null || typeof c !== 'object' || Array.isArray(c)
      || !exact(c.terminalDispositions, ['discarded', 'cancelled'])
      || c.terminalDispositionTarget !== 'ABANDON'
      || !exact(c.methodologyRevalidatedTargets, ['ACT', 'ACCEPT', 'CLOSE'])) {
    throw err('POLICY_INVALID',
      'policy/workflow.json constraints diverge from the authored gates');
  }
  return c;
}

// All transition decision logic given the current stored record: revision
// CAS, workflow edge, evidence merge, ACCEPT gates, next-record shape and
// the ACT/ACCEPT/CLOSE methodology gate, ending in the serialized bytes. Pure
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
  if (to === task.state) {
    // A self-loop is not a real state transition. REVIEW -> REVIEW is the
    // single exception, and only as an evidence attach: a task parked in
    // REVIEW must be able to accumulate verification/review material
    // without a voiding detour through ACT. Every other self-loop stays
    // invalid, and an evidence-less REVIEW self-loop is a no-op revision
    // bump that only adds history noise, so it is rejected too.
    if (task.state !== 'REVIEW') {
      throw err('INVALID_TRANSITION',
        `transition ${task.state} -> ${to} is not allowed by workflow policy`);
    }
    if (input.verification === undefined && input.review === undefined) {
      throw err('INVALID_TRANSITION',
        'transition REVIEW -> REVIEW requires verification or review evidence');
    }
  } else if (!isTransitionAllowed(task.state, to)) {
    throw err('INVALID_TRANSITION',
      `transition ${task.state} -> ${to} is not allowed by workflow policy`);
  }
  // A terminal disposition is effective, not decorative: a task marked
  // with a policy-declared terminal kind may only move to the declared
  // target. Resuming requires an explicit disposition clear first —
  // otherwise the triage record lies.
  const constraints = workflowConstraints();
  const dispKind = task.disposition?.kind;
  if (dispKind !== undefined
      && constraints.terminalDispositions.includes(dispKind)
      && to !== constraints.terminalDispositionTarget) {
    throw err('DISPOSITION_BLOCKS',
      `task is ${dispKind}; transition to ${constraints.terminalDispositionTarget} or clear disposition first`);
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
    // stored by an earlier transition. Validation admits recordable
    // statuses (fail/error are honest records); ACCEPT separately
    // requires every check to pass and the verdict to be approval.
    verification = validateVerification(verification);
    review = validateReview(review, task);
    const acceptance = loadPolicy().acceptance;
    if (!verification.checks.every(
        (c) => acceptance.verificationStatuses.includes(c.status))) {
      throw err('ACCEPT_REQUIRES_EVIDENCE',
        'ACCEPT requires every verification check to pass');
    }
    if (review.verdict !== acceptance.reviewVerdict) {
      throw err('ACCEPT_REQUIRES_REVIEW',
        `ACCEPT requires verdict '${acceptance.reviewVerdict}'`);
    }
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
  // CLOSE re-runs the gate too: an approval valid at ACCEPT can be revoked
  // afterwards, and closure must not carry a stale grant. evaluateMethodology
  // only adds the outcome/acceptance proof for to === 'ACCEPT', so CLOSE gets
  // the ACT-equivalent baseline — bindings, approvals, dependencies re-proven
  // against the CURRENT records. gatedTaskStates stays the authored pair;
  // the CLOSE revalidation target is policy-declared under
  // constraints.methodologyRevalidatedTargets — revalidation, not a new
  // user-facing gate target.
  if (constraints.methodologyRevalidatedTargets.includes(to)) {
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
  const lock = acquireLock(file);
  let tmpPath = null;
  let tmpOwned = false;
  let next;
  let failure;
  try {
    const task = getTask(ctx, input.id);
    const evaluated = evaluateTaskTransition(ctx, task, input);
    mkdirpSync(path.dirname(file));
    tmpPath = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    writeFileExclusive(tmpPath, evaluated.serialized); // cleans itself on write failure
    tmpOwned = true;
    fs.renameSync(tmpPath, file);
    tmpOwned = false;
    next = evaluated.next;
  } catch (e) {
    failure = e;
  } finally {
    if (tmpOwned) removeIfExists(tmpPath); // rename path only
    try {
      releaseVerifiedLock(lock); // unlinks only the lock proven ours
    } catch (e) {
      if (!failure) failure = e; // a domain failure is never masked
    }
  }
  if (failure) throw failure;
  return next;
}

// ---------------------------------------------------------------------------
// Metadata updates (Schema V3 semantics): priority, backlog, disposition,
// steps, notes and the rest of the orthogonal backlog/task-file fields.
// These are NOT lifecycle transitions - they never change `state` and do
// not touch verification/review evidence. V1/V2 records are upgraded to
// schemaVersion 3 on the first semantic write, preserving methodology
// fields for V2 and nulling them for V1.
// ---------------------------------------------------------------------------

const META_UPDATE_KEYS = new Set([
  'id', 'expectedRevision', 'set', 'addNote', 'stepStatus', 'disposition',
]);
const META_SETTABLE = new Set([
  'backlog', 'priority', 'severity', 'type', 'effort', 'estimate', 'source',
  'relations', 'dependsOn', 'goalIds', 'analysis', 'steps', 'notes',
  'skills', 'uncertainty', 'allowedTools', 'requiredCapabilities',
  'agentRole', 'expectedOutputs', 'sideEffects', 'executionType',
  'outputContract', 'reviewRubric', 'fallback', 'contextInheritance',
  'modelTier',
]);
// Content fields are NOT meta-settable: the contract is bound into the
// approval digest and verification attestation, so post-approval edits
// must go through the lifecycle, not a silent rewrite.
const META_CONTENT_SETTABLE = new Set();
const DISPOSITION_KINDS = new Set([
  'deferred', 'icebox', 'future', 'discarded', 'cancelled',
]);
const STEP_STATUS = new Set(['pending', 'done', 'skipped']);

export function validateMetaUpdateInput(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw err('INVALID_ARGS', 'updateTaskMeta input must be an object');
  }
  for (const key of Object.keys(input)) {
    if (!META_UPDATE_KEYS.has(key)) {
      throw err('UNKNOWN_KEY', `updateTaskMeta received unknown key '${key}'`);
    }
  }
  if (!Number.isSafeInteger(input.expectedRevision)
      || input.expectedRevision < 0) {
    throw err('REVISION_MISMATCH',
      'expectedRevision must be a non-negative safe integer');
  }
  const mutations = ['set', 'addNote', 'stepStatus', 'disposition']
    .filter((k) => input[k] !== undefined);
  if (mutations.length === 0) {
    throw err('INVALID_ARGS',
      'updateTaskMeta requires at least one mutation');
  }
  if (input.set !== undefined) {
    if (input.set === null || typeof input.set !== 'object'
        || Array.isArray(input.set)) {
      throw err('INVALID_VALUE', 'set must be an object of task meta keys');
    }
    for (const k of Object.keys(input.set)) {
      if (!META_SETTABLE.has(k) && !META_CONTENT_SETTABLE.has(k)) {
        throw err('UNKNOWN_KEY',
          `set received non-settable key '${k}'`);
      }
    }
    for (const k of META_CONTENT_SETTABLE) {
      if (input.set[k] !== undefined
          && (typeof input.set[k] !== 'string'
            || input.set[k].trim() === '')) {
        throw err('INVALID_VALUE',
          `set.${k} must be a non-empty string`);
      }
    }
  }
  if (input.addNote !== undefined
      && (typeof input.addNote !== 'string' || input.addNote.trim() === '')) {
    throw err('INVALID_VALUE', 'addNote must be a non-empty string');
  }
  if (input.stepStatus !== undefined) {
    const s = input.stepStatus;
    if (s === null || typeof s !== 'object' || Array.isArray(s)
        || !Number.isSafeInteger(s.index) || s.index < 0
        || !STEP_STATUS.has(s.status)
        || Object.keys(s).some((k) => !['index', 'status'].includes(k))) {
      throw err('INVALID_VALUE',
        'stepStatus must be {index:int>=0,status:pending|done|skipped}');
    }
  }
  if (input.disposition !== undefined && input.disposition !== null) {
    const d = input.disposition;
    if (typeof d !== 'object' || Array.isArray(d)
        || !DISPOSITION_KINDS.has(d.kind)
        || Object.keys(d).some((k) => !['kind', 'reason', 'by'].includes(k))) {
      throw err('INVALID_VALUE',
        'disposition must be null or {kind:deferred|icebox|future|discarded|cancelled,reason?,by?}');
    }
  }
}

// Pure meta update: same CAS revision and history discipline as
// evaluateTaskTransition, restricted to non-lifecycle fields.
export function evaluateTaskMeta(ctx, task, input,
    at = new Date().toISOString()) {
  if (task.revision !== input.expectedRevision) {
    throw err('REVISION_MISMATCH',
      `expected revision ${input.expectedRevision} but stored ${task.revision}`);
  }
  let next = task;
  const fields = [];
  if (next.schemaVersion !== 3) {
    // Upgrade V1/V2 to the canonical V3 shape: V2 keeps its methodology
    // bundle, V1 nulls it out; all semantic fields start at defaults.
    next = {
      ...next,
      schemaVersion: 3,
      methodology: next.schemaVersion === 2 ? next.methodology : null,
      specId: next.schemaVersion === 2 ? next.specId : null,
      designId: next.schemaVersion === 2 ? next.designId : null,
      planKey: next.schemaVersion === 2 ? next.planKey : null,
      scenarioRefs: next.schemaVersion === 2 ? next.scenarioRefs : [],
      ...V3_DEFAULTS,
    };
    fields.push('schemaVersion');
  }
  if (input.set !== undefined) {
    const content = {};
    for (const k of META_CONTENT_SETTABLE) {
      if (input.set[k] !== undefined) content[k] = input.set[k].trim();
    }
    const rest = { ...input.set };
    for (const k of META_CONTENT_SETTABLE) delete rest[k];
    const patch = Object.keys(rest).length ? normalizeV3Input(rest) : null;
    if (patch === null && Object.keys(content).length === 0) {
      throw err('INVALID_VALUE', 'set produced no normalized fields');
    }
    next = { ...next, ...content, ...(patch ?? {}) };
    fields.push(...Object.keys(content), ...Object.keys(patch ?? {}));
  }
  if (input.disposition !== undefined) {
    next = {
      ...next,
      disposition: input.disposition === null ? null : {
        kind: input.disposition.kind,
        reason: input.disposition.reason ?? null,
        at,
        by: input.disposition.by ?? null,
      },
    };
    fields.push('disposition');
  }
  if (input.addNote !== undefined) {
    next = { ...next, notes: [...(next.notes ?? []), input.addNote] };
    fields.push('notes');
  }
  if (input.stepStatus !== undefined) {
    if (!Array.isArray(next.steps)
        || input.stepStatus.index >= next.steps.length) {
      throw err('INVALID_VALUE',
        `stepStatus.index ${input.stepStatus.index} out of range ` +
        `(task has ${Array.isArray(next.steps) ? next.steps.length : 0} steps)`);
    }
    const steps = next.steps.map((s, i) => i === input.stepStatus.index
      ? { ...s, status: input.stepStatus.status } : s);
    next = { ...next, steps };
    fields.push('steps');
  }
  next = {
    ...next,
    revision: task.revision + 1,
    updatedAt: at,
    history: [...task.history, {
      at, event: 'meta-update', fields,
      revision: task.revision + 1,
    }],
  };
  validateTaskShape(next, `task ${input.id}`);
  const serialized = JSON.stringify(next, null, 2) + '\n';
  if (Buffer.byteLength(serialized, 'utf8') > loadLimits().maxDocumentBytes) {
    throw err('DOCUMENT_TOO_LARGE',
      'task record would exceed document bytes limit');
  }
  return { next, serialized };
}

export function updateTaskMeta(ctx, input) {
  validateMetaUpdateInput(input);
  const file = taskFilePath(ctx, input.id);
  const lock = acquireLock(file);
  let tmpPath = null;
  let tmpOwned = false;
  let next;
  let failure;
  try {
    const task = getTask(ctx, input.id);
    const evaluated = evaluateTaskMeta(ctx, task, input);
    mkdirpSync(path.dirname(file));
    tmpPath = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    writeFileExclusive(tmpPath, evaluated.serialized);
    tmpOwned = true;
    fs.renameSync(tmpPath, file);
    tmpOwned = false;
    next = evaluated.next;
  } catch (e) {
    failure = e;
  } finally {
    if (tmpOwned) removeIfExists(tmpPath);
    try {
      releaseVerifiedLock(lock);
    } catch (e) {
      if (!failure) failure = e;
    }
  }
  if (failure) throw failure;
  return next;
}

// --- Authorize: the legal post-creation path for records wedged by
// AUTHORIZATION_MISSING. Only `missing` may become `authorized`; declined
// and authorized are terminal decisions here (a declined task is reopened
// through the lifecycle, not silently re-authorized).
const AUTHORIZE_KEYS = new Set([
  'id', 'expectedRevision', 'actor', 'reference',
]);

export function validateAuthorizeInput(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw err('INVALID_ARGS', 'authorizeTask input must be an object');
  }
  for (const key of Object.keys(input)) {
    if (!AUTHORIZE_KEYS.has(key)) {
      throw err('UNKNOWN_KEY',
        `authorizeTask received unknown key '${key}'`);
    }
  }
  if (!Number.isSafeInteger(input.expectedRevision)
      || input.expectedRevision < 0) {
    throw err('REVISION_MISMATCH',
      'expectedRevision must be a non-negative safe integer');
  }
  for (const k of ['actor', 'reference']) {
    if (typeof input[k] !== 'string' || input[k].trim() === '') {
      throw err('INVALID_VALUE', `${k} must be a non-empty string`);
    }
  }
}

export function evaluateTaskAuthorization(ctx, task, input,
    at = new Date().toISOString()) {
  if (task.revision !== input.expectedRevision) {
    throw err('REVISION_MISMATCH',
      `task ${task.id} is at revision ${task.revision}, ` +
      `expected ${input.expectedRevision}`);
  }
  if (task.methodology === null) {
    throw err('INVALID_VALUE',
      'task carries no methodology assessment to authorize');
  }
  const status = task.methodology.authorization?.status;
  if (status !== 'missing') {
    throw err('INVALID_VALUE',
      `authorization is already '${status}'; only 'missing' can be ` +
      'authorized post-creation');
  }
  const actor = input.actor.trim();
  const reference = input.reference.trim();
  const next = {
    ...task,
    methodology: {
      ...task.methodology,
      authorization: { status: 'authorized', actor, reference },
    },
    revision: task.revision + 1,
    updatedAt: at,
    history: [...task.history, {
      at, event: 'authorized', actor, reference,
      revision: task.revision + 1,
    }],
  };
  validateTaskShape(next, `task ${input.id}`);
  const serialized = JSON.stringify(next, null, 2) + '\n';
  if (Buffer.byteLength(serialized, 'utf8') > loadLimits().maxDocumentBytes) {
    throw err('DOCUMENT_TOO_LARGE',
      'task record would exceed document bytes limit');
  }
  return { next, serialized };
}

export function authorizeTask(ctx, input) {
  validateAuthorizeInput(input);
  const file = taskFilePath(ctx, input.id);
  const lock = acquireLock(file);
  let tmpPath = null;
  let tmpOwned = false;
  let next;
  let failure;
  try {
    const task = getTask(ctx, input.id);
    const evaluated = evaluateTaskAuthorization(ctx, task, input);
    mkdirpSync(path.dirname(file));
    tmpPath = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    writeFileExclusive(tmpPath, evaluated.serialized);
    tmpOwned = true;
    fs.renameSync(tmpPath, file);
    tmpOwned = false;
    next = evaluated.next;
  } catch (e) {
    failure = e;
  } finally {
    if (tmpOwned) removeIfExists(tmpPath);
    try {
      releaseVerifiedLock(lock);
    } catch (e) {
      if (!failure) failure = e;
    }
  }
  if (failure) throw failure;
  return next;
}

// Re-assessment: replaces the stored methodology blob on a light record
// (no formal refs — the spec/design binding is immutable). The legal
// repair for assessments recorded misclassified (e.g. an sdd-classifying
// light record) and for V1 records that must gain an assessment to work
// under a gated mode. CAS + revision + history like authorize.
const REASSESS_KEYS = new Set(['id', 'expectedRevision', 'methodology']);

export function validateReassessInput(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw err('INVALID_ARGS', 'reassessTask input must be an object');
  }
  for (const key of Object.keys(input)) {
    if (!REASSESS_KEYS.has(key)) {
      throw err('UNKNOWN_KEY',
        `reassessTask received unknown key '${key}'`);
    }
  }
  if (!Number.isSafeInteger(input.expectedRevision)
      || input.expectedRevision < 0) {
    throw err('REVISION_MISMATCH',
      'expectedRevision must be a non-negative safe integer');
  }
  if (input.methodology === null || typeof input.methodology !== 'object'
      || Array.isArray(input.methodology)) {
    throw err('INVALID_VALUE', 'methodology must be an assessment object');
  }
}

export function evaluateTaskReassessment(ctx, task, input,
    at = new Date().toISOString()) {
  if (task.revision !== input.expectedRevision) {
    throw err('REVISION_MISMATCH',
      `task ${task.id} is at revision ${task.revision}, ` +
      `expected ${input.expectedRevision}`);
  }
  if (task.specId != null || task.designId != null || task.planKey != null) {
    throw err('INVALID_VALUE',
      'formal bindings are immutable; reassess applies to light records only');
  }
  const assessment = validateMethodologyData(
    input.methodology, 'task reassessment');
  const { route } = classifyWork(assessment);
  if (route === 'sdd') {
    throw err('METHODOLOGY_REQUIRED',
      'classified sdd requires the specId+designId pair, which '
      + 're-assessment cannot bind — create a formal task instead');
  }
  let next = task;
  if (next.schemaVersion !== 3) {
    // Same upgrade semantics as evaluateTaskMeta: V2 keeps its refs
    // (all null for light records), V1 gains the V3 semantic fields.
    next = {
      ...next,
      schemaVersion: 3,
      specId: next.schemaVersion === 2 ? next.specId : null,
      designId: next.schemaVersion === 2 ? next.designId : null,
      planKey: next.schemaVersion === 2 ? next.planKey : null,
      scenarioRefs: next.schemaVersion === 2 ? next.scenarioRefs : [],
      ...V3_DEFAULTS,
    };
  }
  next = {
    ...next,
    methodology: assessment,
    revision: task.revision + 1,
    updatedAt: at,
    history: [...task.history, {
      at, event: 'reassessed',
      from: task.methodology == null
        ? null : classifyWork(task.methodology).route,
      to: route,
      revision: task.revision + 1,
    }],
  };
  validateTaskShape(next, `task ${input.id}`);
  const serialized = JSON.stringify(next, null, 2) + '\n';
  if (Buffer.byteLength(serialized, 'utf8') > loadLimits().maxDocumentBytes) {
    throw err('DOCUMENT_TOO_LARGE',
      'task record would exceed document bytes limit');
  }
  return { next, serialized };
}

export function reassessTask(ctx, input) {
  validateReassessInput(input);
  const file = taskFilePath(ctx, input.id);
  const lock = acquireLock(file);
  let tmpPath = null;
  let tmpOwned = false;
  let next;
  let failure;
  try {
    const task = getTask(ctx, input.id);
    const evaluated = evaluateTaskReassessment(ctx, task, input);
    mkdirpSync(path.dirname(file));
    tmpPath = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    writeFileExclusive(tmpPath, evaluated.serialized);
    tmpOwned = true;
    fs.renameSync(tmpPath, file);
    tmpOwned = false;
    next = evaluated.next;
  } catch (e) {
    failure = e;
  } finally {
    if (tmpOwned) removeIfExists(tmpPath);
    try {
      releaseVerifiedLock(lock);
    } catch (e) {
      if (!failure) failure = e;
    }
  }
  if (failure) throw failure;
  return next;
}

// checkAction reports whether an action is permitted by policy in the task's
// current stored state. It does not intercept native host tool calls.
export function checkAction(ctx, taskId, action) {
  if (typeof action !== 'string' || !knownActions().has(action)) {
    throw err('INVALID_ACTION', `unknown action '${String(action)}'`);
  }
  const task = getTask(ctx, taskId);
  const { permitted, actionHooks } = evaluateTaskActions(ctx, task);
  const gate = actionHooks.gated.find((g) => g.action === action) ?? null;
  return {
    id: task.id,
    state: task.state,
    action,
    allowed: permitted.includes(action),
    permitted,
    // Bounded pre-action hook trace: entries that matched this task's
    // permitted set, plus the gate flag when this action is gated.
    actionHooks,
    ...(gate ? { gate } : {}),
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
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

function ownedMalformed(message) {
  throw err(OWNED_PROOF.malformed, message);
}

// Ten-field mutable ownership sidecar for the 'task' kind: the shared
// nine-key rev0 contract plus `chain`, the per-record operation index
// (approvals pattern). record-ownership-data.mjs only admits the
// immutable kinds and is outside this change's ownership. Revision is
// no longer pinned: chain.length === sourceRevision + 1 and the tip
// entry must equal operationId; sourceRevision stays under the
// maxSessionEvents bound like the sibling stores.
function validateTaskOwnership(value, label = 'task ownership') {
  return validateChainOwnership(value, {
    sourceKind: 'task', recordIdOk: isRecordUUID, indexKey: 'chain',
    maxRevision: loadLimits().maxSessionEvents,
    code: OWNED_PROOF.malformed, label });
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

// Full mutable proof, fixed order, fail closed: canonical sidecar ->
// scope authorization -> the chain's committed two-event operations in
// revision order (a two-create rev0 op, then coherent update pairs on
// BOTH event streams, each revision's sidecar snapshot re-proving the
// chain prefix) -> tip sidecar snapshot equals current sidecar bytes ->
// tip source snapshot equals current source bytes -> record.revision
// equals the proven tip revision. The journal operations directory is
// never enumerated: the sidecar's `chain` is the per-record index.
function proveOwnedTask(bound, recordId, sourceRel, ownershipRel) {
  const sidecarBytes = readOwnedCurrent(bound, ownershipRel, {
    missingCode: OWNED_PROOF.missing, nonRegularCode: OWNED_PROOF.malformed,
    label: 'task ownership' });
  const owned = validateTaskOwnership(
    parseOwnedJson(sidecarBytes, OWNED_PROOF.malformed, 'task ownership'));
  if (owned.recordId !== recordId || owned.sourceRel !== sourceRel) {
    ownedMalformed('task ownership does not name this record');
  }
  // Grants are validated before any record content is produced.
  authorizeScope(bound, owned.scope);
  const scopeJson = canonicalJSON(owned.scope);
  let tipSource = null;
  let tipSnapshot = null;
  let tipSidecarSnapshot = null;
  let createRecord = null;
  for (const hop of walkOwnedIndex(bound, owned.chain, {
    sourceKind: 'task', sidecarKind: 'record-ownership',
    recordId, sourceRel, sidecarRel: ownershipRel, scopeJson,
    code: OWNED_PROOF.malformed, notCommittedCode: OWNED_PROOF.notCommitted,
    label: 'task' })) {
    // Each revision's sidecar snapshot re-proves the chain prefix.
    const revOwned = validateTaskOwnership(
      parseOwnedJson(hop.sidecarSnapshot, OWNED_PROOF.malformed,
        'task ownership snapshot'));
    if (revOwned.recordId !== recordId || revOwned.sourceRel !== sourceRel
        || revOwned.sourceRevision !== hop.index
        || revOwned.operationId !== hop.operationId
        || revOwned.createdAt !== hop.loaded.intent.createdAt
        || revOwned.sourceHash !== hop.source.sourceHash
        || canonicalJSON(revOwned.scope) !== scopeJson
        || canonicalJSON(revOwned.chain)
          !== canonicalJSON(owned.chain.slice(0, hop.index + 1))) {
      ownedMalformed(
        'task ownership snapshot does not prove this revision');
    }
    if (hop.index === 0) {
      createRecord = parseTaskBytes(hop.sourceSnapshot, recordId,
        'task create snapshot');
      if (createRecord.revision !== 0
          || createRecord.createdAt !== revOwned.createdAt) {
        ownedMalformed('task create snapshot is not the proven record');
      }
    }
    tipSource = hop.source;
    tipSnapshot = hop.sourceSnapshot;
    tipSidecarSnapshot = hop.sidecarSnapshot;
  }
  if (!tipSidecarSnapshot.equals(sidecarBytes)) {
    ownedMalformed('current task ownership differs from its snapshot');
  }
  if (owned.sourceHash !== tipSource.sourceHash) {
    ownedMalformed('task ownership hash differs from the task event');
  }
  const currentBytes = readOwnedCurrent(bound, sourceRel, {
    missingCode: OWNED_PROOF.missing,
    nonRegularCode: OWNED_PROOF.sourceChanged, label: 'task' });
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
  const { privateCtx, bound } = bindOwnedStore(ctx, options, OWNED_INPUT,
    'owned task store');
  const tasksRel = assertDestination(privateCtx.config.paths.tasks,
    'paths.tasks');
  const stateRel = assertDestination(privateCtx.config.paths.state,
    'paths.state');
  const sourceRelFor = (recordId) => `${tasksRel}/${recordId}.json`;
  const ownershipRelFor = (recordId) =>
    `${stateRel}/record-ownership/task/${recordId}.json`;

  function scope(areaIds) {
    return ownedScope(bound, areaIds);
  }

  function normalizeCreate(input) {
    return normalizeOwnedInput(input, 'task', OWNED_INPUT,
      'owned task input');
  }

  function normalizeTransition(input) {
    return normalizeOwnedInput(input, 'transition', OWNED_INPUT,
      'owned task transition input');
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
    ownedDocumentBytes(ownershipDoc(record.id, sourceRel, sha256Hex(sourceBytes),
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
      const sourceBytes = ownedDocumentBytes(record, 'task source');
      const owned = ownershipDoc(recordId, sourceRel,
        sha256Hex(sourceBytes), 0, identity.operationId,
        identity.createdAt, scope(normalized.areaIds),
        [identity.operationId]);
      const sidecarBytes = ownedDocumentBytes(owned, 'task ownership');
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
    const lock = acquireLock(file);
    let built = null;
    let journal;
    let failure;
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
        const nextSidecarBytes = ownedDocumentBytes(nextOwned, 'task ownership');
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
    } catch (e) {
      failure = e;
    } finally {
      try {
        releaseVerifiedLock(lock); // unlinks only the lock proven ours
      } catch (e) {
        if (!failure) failure = e; // a domain failure is never masked
      }
    }
    if (failure) throw failure;
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
