// Bounded sessions: an explicit operation budget recorded against a task.
// One exclusive lock, compare-and-swap revision, atomic temp+rename, no
// stale-lock recovery. Policy or budget failure leaves bytes unchanged.
// The opt-in owned store at the bottom journals the same invariants:
// open is one two-event create op (source + session-ownership sidecar at
// rev0) and each recorded operation is one two-event CAS update op; the
// sidecar is the mutable chain head, never a fake create. The legacy
// path above is byte-identical and unchanged.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { err } from './errors.mjs';
import { decodeUtf8Strict, lstatOrNull, mkdirpSync, readFileLimited, removeIfExists, writeFileExclusive } from './fsx.mjs';
import { resolveInside, assertDestination, toCanonicalRelative } from './paths.mjs';
import { canonicalJSON } from './digests.mjs';
import { loadLimits, knownActions } from './policy.mjs';
import { getTask } from './tasks.mjs';
import { checkAction } from './transition.mjs';
import {
  applyJournaledRecordCreation, applyJournaledRecordUpdate,
  getJournalOperation, readJournalSnapshot,
} from './journal.mjs';
import {
  resultingSourceRevision, validateRecordTransition,
} from './record-history.mjs';
import {
  assertRecordObject, cloneRecordJSON, isRecordTime, isRecordUUID,
  recordAreaIds, validateRecordScope,
} from './record-ownership-data.mjs';
import {
  authorizeScope, bindWorkspace, resolveWorkspaceState,
} from './workspaces.mjs';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_KEYS = new Set([
  'schemaVersion', 'id', 'taskId', 'limit', 'used', 'revision',
  'events', 'createdAt', 'updatedAt',
]);
const EVENT_KEYS = new Set(['action', 'evidence', 'context', 'at']);

export function sessionsDirAbs(ctx) {
  return resolveInside(
    ctx.projectRoot, `${ctx.config.paths.state}/sessions`, 'paths.state');
}

export function sessionFileAbs(ctx, id) {
  if (typeof id !== 'string' || !UUID_RE.test(id)) {
    throw err('INVALID_ID', `session id must be a UUID, got: ${String(id)}`);
  }
  return path.join(sessionsDirAbs(ctx), `${id.toLowerCase()}.json`);
}

export function validateSessionShape(s, label = 'session') {
  if (s === null || typeof s !== 'object' || Array.isArray(s)) {
    throw err('SESSION_MALFORMED', `${label} is not an object`);
  }
  for (const k of Object.keys(s)) {
    if (!SESSION_KEYS.has(k)) {
      throw err('SESSION_MALFORMED', `${label} has unknown key '${k}'`);
    }
  }
  const max = loadLimits().maxSessionEvents;
  const actions = knownActions(); // loaded once, not per event
  if (s.schemaVersion !== 1 || !UUID_RE.test(s.id || '')
      || !UUID_RE.test(s.taskId || '')
      || !Number.isInteger(s.limit) || s.limit <= 0 || s.limit > max
      || !Number.isInteger(s.used) || s.used < 0 || s.used > s.limit
      || !Number.isInteger(s.revision) || s.revision < 0
      || typeof s.createdAt !== 'string' || s.createdAt === ''
      || typeof s.updatedAt !== 'string' || s.updatedAt === ''
      || !Array.isArray(s.events)
      || s.events.length > max
      || !s.events.every((ev) => ev !== null && typeof ev === 'object'
        && Object.keys(ev).every((k) => EVENT_KEYS.has(k))
        && typeof ev.action === 'string' && actions.has(ev.action)
        && typeof ev.evidence === 'string' && ev.evidence !== ''
        && typeof ev.context === 'string'
        && typeof ev.at === 'string' && isCanon(ev.at))) {
    throw err('SESSION_MALFORMED', `${label} has invalid fields`);
  }
  // Append-only invariants: usage and revision track recorded events.
  if (s.used !== s.events.length || s.revision !== s.events.length) {
    throw err('SESSION_MALFORMED',
      `${label}: used/revision do not match events.length`);
  }
  const isoOk = typeof s.createdAt === 'string' && isCanon(s.createdAt)
    && typeof s.updatedAt === 'string' && isCanon(s.updatedAt);
  if (!isoOk) {
    throw err('SESSION_MALFORMED', `${label} has invalid timestamps`);
  }
  // Chronology: events nondecreasing within [createdAt, updatedAt], and
  // updatedAt equals the last event time (empty session: == createdAt).
  const created = Date.parse(s.createdAt);
  const updated = Date.parse(s.updatedAt);
  const lastAt = s.events.length
    ? s.events[s.events.length - 1].at : s.createdAt;
  let prev = created;
  for (const ev of s.events) {
    const t = Date.parse(ev.at);
    if (t < prev || t > updated) {
      throw err('SESSION_MALFORMED', `${label} has non-monotonic event times`);
    }
    prev = t;
  }
  if (updated !== Date.parse(lastAt) || updated < created) {
    throw err('SESSION_MALFORMED', `${label} updatedAt is inconsistent`);
  }
  return s;
}

const isCanon = (v) => {
  const t = Date.parse(v);
  return !Number.isNaN(t) && new Date(t).toISOString() === v;
};

function readSessionFile(file, id) {
  const st = lstatOrNull(file);
  if (!st) throw err('SESSION_NOT_FOUND', `session not found: ${id}`);
  if (st.isSymbolicLink() || !st.isFile()) {
    throw err('SYMLINK_REJECTED', `session may not be a link: ${id}`);
  }
  const limited = readFileLimited(file, loadLimits().maxDocumentBytes);
  if (limited.exceeded) {
    throw err('SESSION_MALFORMED', `session ${id} exceeds document limit`);
  }
  const text = decodeUtf8Strict(
    limited.content, 'SESSION_MALFORMED', `session ${id}`);
  let s;
  try {
    s = JSON.parse(text);
  } catch {
    throw err('SESSION_MALFORMED', `session ${id} contains malformed JSON`);
  }
  try {
    s = validateSessionShape(s, `session ${id}`);
  } catch (e) {
    if (e && e.code === 'SESSION_MALFORMED') throw e;
    throw err('SESSION_MALFORMED', `session ${id} failed validation: ${e.message}`);
  }
  if (s.id.toLowerCase() !== id.toLowerCase()) {
    throw err('SESSION_MALFORMED', `session id does not match filename`);
  }
  return s;
}

export function getSession(ctx, id) {
  return readSessionFile(sessionFileAbs(ctx, id), id);
}

// Read-only session plan: {session, file} for exclusive apply.
export function prepareSession(ctx, input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw err('INVALID_SESSION', 'session input must be an object');
  }
  for (const k of Object.keys(input)) {
    if (!['taskId', 'limit'].includes(k)) {
      throw err('UNKNOWN_KEY', `session input has unknown key '${k}'`);
    }
  }
  const max = loadLimits().maxSessionEvents;
  if (!Number.isInteger(input.limit) || input.limit <= 0 || input.limit > max) {
    throw err('INVALID_VALUE', `limit must be an integer in 1..${max}`);
  }
  const task = getTask(ctx, input.taskId); // must exist (throws otherwise)
  const at = new Date().toISOString();
  const session = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    taskId: task.id,
    limit: input.limit,
    used: 0,
    revision: 0,
    events: [],
    createdAt: at,
    updatedAt: at,
  };
  const rel = `${ctx.config.paths.state}/sessions/${session.id}.json`;
  return {
    session,
    file: {
      rel,
      abs: resolveInside(ctx.projectRoot, rel, 'session file'),
      content: JSON.stringify(session, null, 2) + '\n',
    },
  };
}

function acquireLock(lockPath) {
  try {
    writeFileExclusive(lockPath, '');
  } catch (e) {
    if (e && e.code === 'EEXIST') {
      throw err('SESSION_LOCKED',
        'session is locked by another operation; no stale-lock recovery');
    }
    throw e;
  }
}

function validateRecordInput(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw err('INVALID_SESSION', 'record input must be an object');
  }
  for (const k of Object.keys(input)) {
    if (!['id', 'expectedRevision', 'action', 'evidence', 'context']
      .includes(k)) {
      throw err('UNKNOWN_KEY', `record input has unknown key '${k}'`);
    }
  }
  if (typeof input.action !== 'string' || input.action === ''
      || !knownActions().has(input.action)) {
    throw err('INVALID_ACTION', `unknown action '${input.action}'`);
  }
  if (typeof input.evidence !== 'string' || input.evidence === '') {
    throw err('INVALID_VALUE', 'evidence must be a non-empty string');
  }
  if (input.context !== undefined && typeof input.context !== 'string') {
    throw err('INVALID_VALUE', 'context must be a string');
  }
  if (!Number.isInteger(input.expectedRevision)
      || input.expectedRevision < 0) {
    throw err('INVALID_VALUE', 'expectedRevision must be a non-negative integer');
  }
}

// Read-only record preparation: exact input validation plus CURRENT state
// checks (id resolution, revision match, policy, budget) without mutation.
// Used by CLI dry-run; apply re-validates everything under the lock.
export function prepareSessionRecord(ctx, input) {
  validateRecordInput(input);
  const file = sessionFileAbs(ctx, input.id);
  const session = readSessionFile(file, input.id);
  if (session.revision !== input.expectedRevision) {
    throw err('REVISION_MISMATCH',
      `expected revision ${input.expectedRevision} but stored ${session.revision}`);
  }
  const check = checkAction(ctx, session.taskId, input.action);
  if (!check.allowed) {
    throw err('SESSION_ACTION_DENIED',
      `action '${input.action}' is not allowed in task state ${check.state}`);
  }
  if (session.used >= session.limit) {
    throw err('SESSION_LIMIT_EXHAUSTED',
      `operation limit ${session.limit} reached`);
  }
  // Prospective append is built+serialized exactly as apply would: dry-run
  // sees the same DOCUMENT_TOO_LARGE/clock failures with no writes.
  const prospective = buildNextSession(session, input, new Date().toISOString());
  assertSessionFits(prospective);
  return { session, check, prospective };
}

function buildNextSession(session, input, at) {
  return {
    ...session,
    used: session.used + 1,
    revision: session.revision + 1,
    updatedAt: at,
    events: [...session.events, {
      action: input.action,
      evidence: input.evidence,
      context: input.context || '',
      at,
    }],
  };
}

function assertSessionFits(next) {
  const serialized = Buffer.from(JSON.stringify(next, null, 2) + '\n');
  if (serialized.length > loadLimits().maxDocumentBytes) {
    throw err('DOCUMENT_TOO_LARGE',
      'appended session would exceed document limit');
  }
  // The prospective record must satisfy EVERY stored invariant — including
  // chronology against the previous last event, not just createdAt.
  validateSessionShape(next, 'prospective session');
  return serialized;
}

// Append one event under lock + CAS after policy check and budget check.
export function recordSession(ctx, input) {
  validateRecordInput(input);
  const file = sessionFileAbs(ctx, input.id);
  const lockPath = `${file}.lock`;
  let tmpPath = null;
  let tmpOwned = false;
  acquireLock(lockPath);
  try {
    const session = readSessionFile(file, input.id);
    if (session.revision !== input.expectedRevision) {
      throw err('REVISION_MISMATCH',
        `expected revision ${input.expectedRevision} but stored ${session.revision}`);
    }
    // Policy first: the action must be allowed for the CURRENT task state.
    const check = checkAction(ctx, session.taskId, input.action);
    if (!check.allowed) {
      throw err('SESSION_ACTION_DENIED',
        `action '${input.action}' is not allowed in task state ${check.state}`);
    }
    if (session.used >= session.limit) {
      throw err('SESSION_LIMIT_EXHAUSTED',
        `operation limit ${session.limit} reached`);
    }
    const at = new Date().toISOString();
    const next = buildNextSession(session, input, at);
    const serialized = assertSessionFits(next);
    tmpPath = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    writeFileExclusive(tmpPath, serialized); // cleans itself on write failure
    tmpOwned = true;
    fs.renameSync(tmpPath, file);
    tmpOwned = false;
    return next;
  } finally {
    if (tmpOwned) removeIfExists(tmpPath);
    removeIfExists(lockPath);
  }
}

// Resume: actual task state, current evidence, usage and remaining budget.
// Adds a recovery guidance REFERENCE (catalog path), never a prompt.
export function resumeSession(ctx, id) {
  const session = getSession(ctx, id);
  const task = getTask(ctx, session.taskId);
  return {
    session,
    task: {
      id: task.id,
      state: task.state,
      revision: task.revision,
      verification: task.verification,
      review: task.review,
    },
    usage: {
      used: session.used,
      limit: session.limit,
      remaining: session.limit - session.used,
      measures: loadLimits().budgetMeasures,
    },
    resourceRoot: ctx.configDir,
    recovery: { reference: 'references/task-system.md' },
  };
}

export function ensureSessionsDir(ctx) {
  mkdirpSync(sessionsDirAbs(ctx));
}

// ---------------------------------------------------------------------------
// Owned sessions: opt-in journal-backed mutable ownership (Block A5).
//
// Open is ONE journal operation with TWO create/rev0 events: the session
// source (byte-identical legacy document at <paths.state>/sessions/<id>.json)
// and a session-ownership sidecar at <paths.state>/session-ownership/<id>.json.
// Each recorded operation is ONE two-event CAS update op over both files:
// the sidecar is the mutable chain head carrying previousOperationId links,
// never a fake create. get()/resume() prove the sidecar, the whole
// create/update chain and the current bytes; record()/prepareRecord()
// re-check only the proven tip (O(1) writes, O(used) reads — deliberate).
//
// The sidecar is NOT under record-ownership/: that tree is reserved for
// rev0-immutable companions (capture/spec/design/report). Event kind is
// 'session-ownership' for the companion and 'session' for the source.
// ---------------------------------------------------------------------------

const OWNED_INPUT = 'INVALID_OWNED_SESSION_INPUT';
const OWNED_CODES = {
  missing: 'OWNED_SESSION_NOT_FOUND',
  malformed: 'OWNED_SESSION_MALFORMED',
  notCommitted: 'OWNED_SESSION_NOT_COMMITTED',
  sourceChanged: 'OWNED_SESSION_SOURCE_CHANGED',
};
const OWNED_OPTION_KEYS = ['areaIds'];
const OWNED_OPEN_KEYS = ['areaIds', 'session'];
const OWNED_RECORD_KEYS = ['areaIds', 'record'];
const OWNERSHIP_DOC_KEYS = [
  'schemaVersion', 'sourceKind', 'recordId', 'sourceRevision', 'sourceRel',
  'sourceHash', 'operationId', 'previousOperationId', 'createOperationId',
  'scope', 'createdAt', 'updatedAt',
];
const HASH_RE = /^[0-9a-f]{64}$/;
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

function ownedMalformed(message) {
  throw err(OWNED_CODES.malformed, message);
}

function sha256Hex(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

// Closed 12-key mutable chain-head sidecar. rev0 coherence is enforced at
// shape level: a revision-0 sidecar must be the create op itself.
function validateSessionOwnership(value,
    code = OWNED_CODES.malformed, label = 'session ownership') {
  assertRecordObject(value, OWNERSHIP_DOC_KEYS, OWNERSHIP_DOC_KEYS, code, label);
  if (value.schemaVersion !== 1 || value.sourceKind !== 'session'
      || !isRecordUUID(value.recordId)
      || !Number.isSafeInteger(value.sourceRevision) || value.sourceRevision < 0
      || typeof value.sourceHash !== 'string' || !HASH_RE.test(value.sourceHash)
      || !isRecordUUID(value.operationId)
      || (value.previousOperationId !== null
        && !isRecordUUID(value.previousOperationId))
      || !isRecordUUID(value.createOperationId)
      || !isRecordTime(value.createdAt) || !isRecordTime(value.updatedAt)) {
    throw err(code, `${label} has invalid fields`);
  }
  let rel;
  try {
    if (typeof value.sourceRel !== 'string' || value.sourceRel.includes('\\')) {
      throw err(code, `${label} sourceRel must be canonical POSIX`);
    }
    rel = toCanonicalRelative(value.sourceRel, `${label} sourceRel`);
  } catch (e) {
    if (e && e.code === code) throw e;
    throw err(code, `${label} sourceRel is not a canonical relative path`);
  }
  if (rel !== value.sourceRel) {
    throw err(code, `${label} sourceRel is not canonical`);
  }
  validateRecordScope(value.scope, code, `${label} scope`);
  if (value.sourceRevision === 0) {
    if (value.previousOperationId !== null
        || value.operationId !== value.createOperationId
        || value.createdAt !== value.updatedAt) {
      throw err(code, `${label} revision-0 fields are incoherent`);
    }
  } else if (value.previousOperationId === null) {
    throw err(code, `${label} lacks a previous operation`);
  }
  return cloneRecordJSON(value);
}

// Bounded read of a current owned file: binding revalidation, containment,
// regular file and the shared document limit. Codes are caller-selected so
// source and sidecar failures keep distinct domains.
function readOwnedCurrent(bound, rel, missingCode, nonRegularCode, label) {
  const { projectRoot } = resolveWorkspaceState(bound);
  const abs = resolveInside(projectRoot, rel, `${label} file`);
  const st = lstatOrNull(abs);
  if (!st) throw err(missingCode, `${label} file not found: ${rel}`);
  if (!st.isFile()) {
    throw err(nonRegularCode, `${label} file is not regular: ${rel}`);
  }
  const limited = readFileLimited(abs, loadLimits().maxDocumentBytes);
  if (limited.exceeded) {
    throw err('DOCUMENT_TOO_LARGE', `${label} file exceeds limit: ${rel}`);
  }
  return limited.content;
}

function parseSidecar(bytes) {
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) {
    ownedMalformed('stored session ownership is not roundtrippable UTF-8');
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    ownedMalformed('session ownership is not JSON');
  }
  return validateSessionOwnership(parsed);
}

function eventScopeJson(event) {
  return canonicalJSON({
    workspaceId: event.workspaceId, projectId: event.projectId,
    repositoryId: event.repositoryId, areaIds: event.areaIds,
  });
}

export function createOwnedSessionStore(ctx, options) {
  if (ctx === null || typeof ctx !== 'object'
      || typeof ctx.projectRoot !== 'string'
      || ctx.config === null || typeof ctx.config !== 'object') {
    throw err(OWNED_INPUT, 'owned session store requires a resolved context');
  }
  // Options and config are validated/cloned once; the store never consults
  // mutable caller state again.
  assertRecordObject(options, OWNED_OPTION_KEYS, OWNED_OPTION_KEYS,
    OWNED_INPUT, 'owned session store options');
  const opts = { areaIds: recordAreaIds(options.areaIds, OWNED_INPUT,
    'owned session store options') };
  const privateCtx = { projectRoot: ctx.projectRoot,
    config: structuredClone(ctx.config) };
  const resourceRoot = typeof ctx.configDir === 'string' ? ctx.configDir : null;
  const bound = bindWorkspace(privateCtx, { areaIds: opts.areaIds });
  const stateRel = assertDestination(privateCtx.config.paths.state,
    'paths.state');
  const sourceRelFor = (recordId) => `${stateRel}/sessions/${recordId}.json`;
  const ownershipRelFor = (recordId) =>
    `${stateRel}/session-ownership/${recordId}.json`;

  function scopeOf(areaIds) {
    return {
      workspaceId: bound.workspaceId, projectId: bound.projectId,
      repositoryId: bound.repositoryId, areaIds: [...areaIds],
    };
  }

  function boundedBytes(bytes, label) {
    if (bytes.length > loadLimits().maxDocumentBytes) {
      throw err('DOCUMENT_TOO_LARGE', `${label} exceeds document limit`);
    }
    return bytes;
  }

  function documentBytes(value, label) {
    return boundedBytes(
      Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8'), label);
  }

  function sidecarDocument(fields) {
    return validateSessionOwnership({
      schemaVersion: 1, sourceKind: 'session',
      recordId: fields.recordId, sourceRevision: fields.sourceRevision,
      sourceRel: fields.sourceRel, sourceHash: fields.sourceHash,
      operationId: fields.operationId,
      previousOperationId: fields.previousOperationId,
      createOperationId: fields.createOperationId,
      scope: fields.scope,
      createdAt: fields.createdAt, updatedAt: fields.updatedAt,
    });
  }

  function requireId(id) {
    if (!isRecordUUID(id)) {
      throw err(OWNED_INPUT, 'owned session id must be a canonical UUID');
    }
    return id;
  }

  function normalizeOpen(input) {
    assertRecordObject(input, OWNED_OPEN_KEYS, OWNED_OPEN_KEYS, OWNED_INPUT,
      'owned session input');
    return {
      areaIds: recordAreaIds(input.areaIds, OWNED_INPUT,
        'owned session input').sort(),
      session: cloneRecordJSON(input.session),
    };
  }

  function normalizeRecord(input) {
    assertRecordObject(input, OWNED_RECORD_KEYS, OWNED_RECORD_KEYS,
      OWNED_INPUT, 'owned session record input');
    const record = cloneRecordJSON(input.record);
    if (!isRecordUUID(record.id)) {
      throw err(OWNED_INPUT,
        'owned session record id must be a canonical UUID');
    }
    validateRecordInput(record); // legacy domain codes preserved
    return {
      areaIds: recordAreaIds(input.areaIds, OWNED_INPUT,
        'owned session record input').sort(),
      record,
    };
  }

  // The recorded scope must equal the enrolled scope: chain scope is
  // constant by construction and get() re-verifies canonical equality.
  function expectRecordScope(areaIds, sidecar) {
    if (canonicalJSON(areaIds)
        !== canonicalJSON([...sidecar.scope.areaIds].sort())) {
      throw err(OWNED_INPUT,
        'record areas must equal the enrolled session scope');
    }
  }

  // Bounded TIP proof for the write path and dry-runs: canonical sidecar,
  // authorized stored scope, named tip op committed, the tip sidecar
  // snapshot equal to the current sidecar bytes, and hash/revision
  // coherence with the CURRENT source bytes. The full create/update chain
  // proof is get()'s job, not repeated per write.
  function loadProvenTip(recordId) {
    const sourceRel = sourceRelFor(recordId);
    const ownershipRel = ownershipRelFor(recordId);
    const sidecarBytes = readOwnedCurrent(bound, ownershipRel,
      OWNED_CODES.missing, OWNED_CODES.malformed, 'session ownership');
    const sidecar = parseSidecar(sidecarBytes);
    if (sidecar.recordId !== recordId || sidecar.sourceRel !== sourceRel) {
      ownedMalformed('session ownership does not name this record');
    }
    authorizeScope(bound, sidecar.scope);
    const loaded = getJournalOperation(bound, sidecar.operationId);
    if (loaded.state !== 'committed') {
      throw err(OWNED_CODES.notCommitted,
        'session tip operation is not committed');
    }
    const sideEvent = loaded.intent.events.find((e) =>
      e.sourceKind === 'session-ownership' && e.recordId === recordId);
    if (!sideEvent) {
      ownedMalformed('session tip operation does not own this record');
    }
    const tipSnapshot = readJournalSnapshot(bound, sidecar.operationId,
      sideEvent.eventId);
    if (!tipSnapshot.equals(sidecarBytes)) {
      ownedMalformed('current session ownership differs from its snapshot');
    }
    const sourceBytes = readOwnedCurrent(bound, sourceRel,
      OWNED_CODES.missing, OWNED_CODES.sourceChanged, 'session source');
    if (sha256Hex(sourceBytes) !== sidecar.sourceHash) {
      throw err(OWNED_CODES.sourceChanged,
        'current session source differs from its proven tip');
    }
    let session;
    try {
      session = JSON.parse(sourceBytes.toString('utf8'));
      session = validateSessionShape(session, `session ${recordId}`);
    } catch (e) {
      ownedMalformed(`proven session ${recordId} failed validation: ${e.message}`);
    }
    if (session.id.toLowerCase() !== recordId
        || session.revision !== sidecar.sourceRevision) {
      ownedMalformed('proven session does not match its ownership');
    }
    return { sidecar, sidecarBytes, sourceBytes, session,
      sourceRel, ownershipRel };
  }

  // Build the two update changes inside the kernel callback: every domain
  // gate (revision CAS, policy, budget, full prospective shape) throws
  // BEFORE any journal state is reserved. Byte-CAS is re-verified by the
  // kernel under the lock.
  function buildRecordUpdate(proven, record, identity) {
    const { session, sidecar, sourceBytes, sidecarBytes,
      sourceRel, ownershipRel } = proven;
    if (session.revision !== record.expectedRevision) {
      throw err('REVISION_MISMATCH',
        `expected revision ${record.expectedRevision} but stored ${session.revision}`);
    }
    const check = checkAction(privateCtx, session.taskId, record.action);
    if (!check.allowed) {
      throw err('SESSION_ACTION_DENIED',
        `action '${record.action}' is not allowed in task state ${check.state}`);
    }
    if (session.used >= session.limit) {
      throw err('SESSION_LIMIT_EXHAUSTED',
        `operation limit ${session.limit} reached`);
    }
    const next = buildNextSession(session, record, identity.createdAt);
    const nextBytes = assertSessionFits(next);
    const nextSidecar = sidecarDocument({
      recordId: record.id, sourceRel,
      sourceHash: sha256Hex(nextBytes), sourceRevision: next.revision,
      operationId: identity.operationId,
      previousOperationId: sidecar.operationId,
      createOperationId: sidecar.createOperationId,
      scope: sidecar.scope,
      createdAt: sidecar.createdAt, updatedAt: identity.createdAt,
    });
    const nextSidecarBytes = documentBytes(nextSidecar, 'session ownership');
    const areas = [...sidecar.scope.areaIds];
    return {
      next, check, sourceRel, ownershipRel,
      changes: [
        { sourceKind: 'session', recordId: record.id,
          sourceRevision: session.revision,
          previousHash: sha256Hex(sourceBytes), areaIds: areas,
          file: { rel: sourceRel, content: nextBytes } },
        { sourceKind: 'session-ownership', recordId: record.id,
          sourceRevision: sidecar.sourceRevision,
          previousHash: sha256Hex(sidecarBytes), areaIds: areas,
          file: { rel: ownershipRel, content: nextSidecarBytes } },
      ],
    };
  }

  function prepare(input) {
    const normalized = normalizeOpen(input);
    authorizeScope(bound, scopeOf(normalized.areaIds));
    const prepared = prepareSession(privateCtx, normalized.session);
    const record = prepared.session;
    const sourceRel = `${stateRel}/sessions/${record.id}.json`;
    const ownershipRel = ownershipRelFor(record.id);
    const { projectRoot } = resolveWorkspaceState(bound);
    resolveInside(projectRoot, sourceRel, 'session source');
    resolveInside(projectRoot, ownershipRel, 'session ownership');
    const sourceBytes = boundedBytes(
      Buffer.from(prepared.file.content, 'utf8'), 'session source');
    documentBytes(sidecarDocument({
      recordId: record.id, sourceRel,
      sourceHash: sha256Hex(sourceBytes), sourceRevision: 0,
      operationId: ZERO_UUID, previousOperationId: null,
      createOperationId: ZERO_UUID, scope: scopeOf(normalized.areaIds),
      createdAt: record.createdAt, updatedAt: record.createdAt,
    }), 'session ownership');
    return { mode: 'dry-run', record, sourceRel, ownershipRel,
      reservesIds: false };
  }

  function create(input) {
    const normalized = normalizeOpen(input);
    authorizeScope(bound, scopeOf(normalized.areaIds));
    let built = null;
    const journal = applyJournaledRecordCreation(bound, (identity) => {
      // prepareSession generates the session ID once inside the strict
      // callback; only createdAt/updatedAt align to the kernel identity.
      const prepared = prepareSession(privateCtx, normalized.session);
      const record = validateSessionShape({
        ...prepared.session,
        createdAt: identity.createdAt, updatedAt: identity.createdAt,
      }, 'owned session');
      const recordId = record.id;
      const sourceRel = `${stateRel}/sessions/${recordId}.json`;
      const ownershipRel = ownershipRelFor(recordId);
      const sourceBytes = documentBytes(record, 'session source');
      const owned = sidecarDocument({
        recordId, sourceRel, sourceHash: sha256Hex(sourceBytes),
        sourceRevision: 0, operationId: identity.operationId,
        previousOperationId: null, createOperationId: identity.operationId,
        scope: scopeOf(normalized.areaIds),
        createdAt: identity.createdAt, updatedAt: identity.createdAt,
      });
      const sidecarBytes = documentBytes(owned, 'session ownership');
      built = { record, sourceRel, ownershipRel };
      return [
        { sourceKind: 'session', recordId, sourceRevision: 0,
          areaIds: [...normalized.areaIds],
          file: { rel: sourceRel, content: sourceBytes } },
        { sourceKind: 'session-ownership', recordId, sourceRevision: 0,
          areaIds: [...normalized.areaIds],
          file: { rel: ownershipRel, content: sidecarBytes } },
      ];
    });
    return {
      mode: 'applied', record: built.record, sourceRel: built.sourceRel,
      ownershipRel: built.ownershipRel,
      ownershipConfirmed: journal.status === 'committed'
        && journal.journalState === 'confirmed',
      journal,
    };
  }

  function prepareRecord(input) {
    const normalized = normalizeRecord(input);
    const proven = loadProvenTip(normalized.record.id);
    expectRecordScope(normalized.areaIds, proven.sidecar);
    const { projectRoot } = resolveWorkspaceState(bound);
    resolveInside(projectRoot, proven.sourceRel, 'session source');
    resolveInside(projectRoot, proven.ownershipRel, 'session ownership');
    const built = buildRecordUpdate(proven, normalized.record, {
      operationId: ZERO_UUID, createdAt: new Date().toISOString(),
    });
    return { mode: 'dry-run', record: built.next, check: built.check,
      sourceRel: proven.sourceRel, ownershipRel: proven.ownershipRel,
      reservesIds: false };
  }

  function record(input) {
    const normalized = normalizeRecord(input);
    let built = null;
    const journal = applyJournaledRecordUpdate(bound, (identity) => {
      const proven = loadProvenTip(normalized.record.id);
      expectRecordScope(normalized.areaIds, proven.sidecar);
      built = buildRecordUpdate(proven, normalized.record, identity);
      return built.changes;
    });
    return {
      mode: 'applied', record: built.next,
      sourceRel: built.sourceRel, ownershipRel: built.ownershipRel,
      journal,
    };
  }

  // Full read-side proof: canonical tip sidecar -> authorized scope ->
  // backward walk of previousOperationId links where EVERY op is committed
  // with exactly the two events for this record, its sidecar snapshot
  // reproduces the linked document, and both event streams satisfy
  // validateRecordTransition down to the rev0 create op. Then the tip
  // source snapshot yields the record and current bytes must equal it.
  function get(recordId) {
    requireId(recordId);
    const sourceRel = sourceRelFor(recordId);
    const ownershipRel = ownershipRelFor(recordId);
    const tipBytes = readOwnedCurrent(bound, ownershipRel,
      OWNED_CODES.missing, OWNED_CODES.malformed, 'session ownership');
    const tip = parseSidecar(tipBytes);
    if (tip.recordId !== recordId || tip.sourceRel !== sourceRel) {
      ownedMalformed('session ownership does not name this record');
    }
    authorizeScope(bound, tip.scope);
    const scopeJson = canonicalJSON(tip.scope);
    const maxOps = loadLimits().maxSessionEvents + 1;
    const seen = new Set();
    let cursor = tip;
    let cursorBytes = tipBytes;
    let tipSourceEvent = null;
    let tipOperationId = null;
    for (let depth = 0; ; depth += 1) {
      if (depth >= maxOps) ownedMalformed('session chain exceeds bounds');
      if (seen.has(cursor.operationId)) {
        ownedMalformed('session chain contains a cycle');
      }
      seen.add(cursor.operationId);
      const loaded = getJournalOperation(bound, cursor.operationId);
      if (loaded.state !== 'committed') {
        throw err(OWNED_CODES.notCommitted,
          'session chain operation is not committed');
      }
      const events = loaded.intent.events;
      if (events.length !== 2) {
        ownedMalformed('session operation is not two events');
      }
      const source = events.find((e) => e.sourceKind === 'session');
      const side = events.find((e) => e.sourceKind === 'session-ownership');
      if (!source || !side
          || source.recordId !== recordId || side.recordId !== recordId
          || source.sourceRel !== sourceRel || side.sourceRel !== ownershipRel
          || eventScopeJson(source) !== scopeJson
          || eventScopeJson(side) !== scopeJson) {
        ownedMalformed('session operation does not prove this record');
      }
      // The op's sidecar snapshot must reproduce the linked document.
      const snapSide = readJournalSnapshot(bound, cursor.operationId,
        side.eventId);
      if (!snapSide.equals(cursorBytes)) {
        ownedMalformed('session ownership snapshot differs from the chain');
      }
      if (cursor.sourceHash !== source.sourceHash
          || cursor.sourceRevision
            !== resultingSourceRevision(source, OWNED_CODES.malformed)
          || cursor.sourceRevision
            !== resultingSourceRevision(side, OWNED_CODES.malformed)
          || cursor.updatedAt !== loaded.intent.createdAt) {
        ownedMalformed('session ownership does not match its operation');
      }
      if (depth === 0) {
        tipSourceEvent = source;
        tipOperationId = cursor.operationId;
      }
      if (cursor.previousOperationId === null) {
        // Must be the rev0 create op: two create events, coherent anchors.
        if (source.operation !== 'create' || side.operation !== 'create'
            || source.sourceRevision !== 0 || side.sourceRevision !== 0
            || source.previousHash !== null || side.previousHash !== null
            || cursor.sourceRevision !== 0
            || cursor.operationId !== cursor.createOperationId
            || tip.createOperationId !== cursor.createOperationId
            || cursor.createdAt !== loaded.intent.createdAt) {
          ownedMalformed('session chain does not end at its create op');
        }
        break;
      }
      const previous = getJournalOperation(bound, cursor.previousOperationId);
      if (previous.state !== 'committed') {
        throw err(OWNED_CODES.notCommitted,
          'session chain operation is not committed');
      }
      if (previous.intent.events.length !== 2) {
        ownedMalformed('session operation is not two events');
      }
      const prevSource = previous.intent.events.find(
        (e) => e.sourceKind === 'session');
      const prevSide = previous.intent.events.find(
        (e) => e.sourceKind === 'session-ownership');
      if (!prevSource || !prevSide) {
        ownedMalformed('session operation does not prove this record');
      }
      validateRecordTransition(prevSource, source, OWNED_CODES.malformed);
      validateRecordTransition(prevSide, side, OWNED_CODES.malformed);
      const prevSideBytes = readJournalSnapshot(bound,
        cursor.previousOperationId, prevSide.eventId);
      const next = parseSidecar(prevSideBytes);
      if (next.recordId !== recordId || next.sourceRel !== sourceRel
          || next.operationId !== cursor.previousOperationId
          || next.createOperationId !== tip.createOperationId
          || next.createdAt !== tip.createdAt
          || canonicalJSON(next.scope) !== scopeJson) {
        ownedMalformed('session ownership link does not match this record');
      }
      cursor = next;
      cursorBytes = prevSideBytes;
    }
    const sourceSnapshot = readJournalSnapshot(bound, tipOperationId,
      tipSourceEvent.eventId);
    let sessionRecord;
    try {
      const text = sourceSnapshot.toString('utf8');
      if (!Buffer.from(text, 'utf8').equals(sourceSnapshot)) {
        ownedMalformed('session snapshot is not roundtrippable UTF-8');
      }
      sessionRecord = validateSessionShape(
        JSON.parse(text), `session ${recordId}`);
    } catch (e) {
      if (e && e.code === OWNED_CODES.malformed) throw e;
      ownedMalformed(`proven session ${recordId} failed validation: ${e.message}`);
    }
    if (sessionRecord.id.toLowerCase() !== recordId
        || sessionRecord.revision !== tip.sourceRevision
        || sessionRecord.createdAt !== tip.createdAt) {
      ownedMalformed('proven session does not match its ownership');
    }
    const current = readOwnedCurrent(bound, sourceRel,
      OWNED_CODES.missing, OWNED_CODES.sourceChanged, 'session source');
    if (!current.equals(sourceSnapshot)) {
      throw err(OWNED_CODES.sourceChanged,
        'current session source differs from its snapshot');
    }
    return {
      record: sessionRecord, ownership: tip,
      locator: { operationId: tipOperationId,
        eventId: tipSourceEvent.eventId },
      isCurrentSource: true, memoryConsulted: false,
    };
  }

  // Resume over the PROVEN record plus live task state: same fields as the
  // legacy resume plus the ownership proof locator.
  function resume(id) {
    const proven = get(requireId(id));
    const session = proven.record;
    const task = getTask(privateCtx, session.taskId);
    return {
      session,
      task: {
        id: task.id, state: task.state, revision: task.revision,
        verification: task.verification, review: task.review,
      },
      usage: {
        used: session.used, limit: session.limit,
        remaining: session.limit - session.used,
        measures: loadLimits().budgetMeasures,
      },
      resourceRoot,
      recovery: { reference: 'references/task-system.md' },
      ownership: proven.ownership,
      locator: proven.locator,
    };
  }

  return Object.freeze({ prepare, create, prepareRecord, record, get, resume });
}
