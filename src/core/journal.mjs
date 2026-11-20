import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { preflightPlan, applyPlan } from './bootstrap.mjs';
import { canonicalDigest } from './digests.mjs';
import { err, toErrorPayload } from './errors.mjs';
import { decodeUtf8Strict, lstatOrNull, readDirBounded, readFileLimited,
  removeIfExists } from './fsx.mjs';
import { acquireVerifiedLock, releaseVerifiedLock } from './locks.mjs';
import { assertDestination, isSameOrAncestor, resolveInside } from './paths.mjs';
import { loadJournalPolicy, loadLimits } from './policy.mjs';
import { isJournalOperation, validateUpdateChange } from './record-history.mjs';
import { authorizeScope, resolveWorkspaceState } from './workspaces.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const KIND = /^[a-z][a-z0-9-]{0,63}$/;
const RECORD = /^[a-z0-9][a-z0-9-]{0,127}$/;
const CHANGE_KEYS = ['sourceKind', 'recordId', 'sourceRevision', 'areaIds', 'file'];
const EVENT_KEYS = [
  'schemaVersion', 'eventId', 'operationId', 'journalSequence', 'workspaceId',
  'projectId', 'repositoryId', 'areaIds', 'sourceKind', 'recordId',
  'sourceRevision', 'sourceRel', 'previousHash', 'sourceHash', 'snapshotRef',
  'operation', 'createdAt',
];
const INTENT_KEYS = ['schemaVersion', 'operationId', 'state', 'createdAt', 'events'];
const COMMIT_KEYS = ['schemaVersion', 'operationId', 'intentDigest', 'state', 'confirmedAt'];
const RECOVERY_KEYS = ['schemaVersion', 'operationId', 'intentDigest', 'action',
  'sourceOutcome', 'reason', 'decidedAt'];
const EVIDENCE_KEYS = [
  'backendId', 'remoteNamespace', 'remoteKey', 'eventDigest', 'sourceHash', 'confirmedAt',
];

function plain(value, keys, required, code, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
      || Object.getOwnPropertySymbols(value).length) {
    throw err(code, `${label} must be a plain object`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!keys.includes(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw err(code, `${label} has invalid property '${key}'`);
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(descriptors, key)) throw err(code, `${label} is missing '${key}'`);
  }
}

function dense(value, code, label) {
  if (!Array.isArray(value) || !value.length
      || Object.getPrototypeOf(value) !== Array.prototype
      || Object.getOwnPropertySymbols(value).length
      || Object.getOwnPropertyNames(value).length !== value.length + 1) {
    throw err(code, `${label} must be a non-empty dense array`);
  }
  for (let i = 0; i < value.length; i += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw err(code, `${label} must contain only values`);
    }
  }
}

function uuid(value) {
  return typeof value === 'string' && UUID.test(value);
}

function hash(value) {
  return typeof value === 'string' && HASH.test(value);
}

function time(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    && new Date(Date.parse(value)).toISOString() === value;
}

function digestBytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function location(bound) {
  const { projectRoot, stateRel } = resolveWorkspaceState(bound);
  return { root: projectRoot, base: `${stateRel}/journal` };
}

function absolute(loc, rel) {
  return resolveInside(loc.root, rel, 'journal path');
}

function sub(loc, rel) {
  return `${loc.base}/${rel}`;
}

function ensureDir(loc, rel) {
  const abs = absolute(loc, rel);
  fs.mkdirSync(abs, { recursive: true });
  const checked = absolute(loc, rel);
  if (!fs.lstatSync(checked).isDirectory()) {
    throw err('JOURNAL_MALFORMED', `journal path is not a directory: ${rel}`);
  }
  return checked;
}

function readBytes(loc, rel, missingCode = 'JOURNAL_NOT_FOUND') {
  const abs = absolute(loc, rel);
  const stat = lstatOrNull(abs);
  if (!stat) throw err(missingCode, `journal file not found: ${rel}`);
  if (!stat.isFile()) throw err('JOURNAL_MALFORMED', `journal file is not regular: ${rel}`);
  const limited = readFileLimited(abs, loadLimits().maxDocumentBytes);
  if (limited.exceeded) throw err('DOCUMENT_TOO_LARGE', `journal file exceeds limit: ${rel}`);
  return limited.content;
}

function readJson(loc, rel, missingCode = 'JOURNAL_NOT_FOUND') {
  const bytes = readBytes(loc, rel, missingCode);
  const text = decodeUtf8Strict(
    bytes, 'JOURNAL_MALFORMED', `journal JSON: ${rel}`);
  try {
    return JSON.parse(text);
  } catch {
    throw err('JOURNAL_MALFORMED', `malformed journal JSON: ${rel}`);
  }
}

function jsonBytes(value) {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  if (bytes.length > loadLimits().maxDocumentBytes) {
    throw err('DOCUMENT_TOO_LARGE', 'journal document exceeds limit');
  }
  return bytes;
}

function removeOwned(loc, rel, owner, prefix = null) {
  try {
    const abs = absolute(loc, rel);
    const current = fs.lstatSync(abs, { bigint: true });
    if (!owner || !current.isFile() || current.dev !== owner.dev || current.ino !== owner.ino) {
      return;
    }
    if (prefix) {
      const read = readFileLimited(abs, prefix.length);
      if (read.exceeded || !prefix.subarray(0, read.content.length).equals(read.content)) return;
    }
    fs.unlinkSync(abs);
  } catch { /* preserve anything not provably owned */ }
}

function writeNew(loc, rel, content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  if (bytes.length > loadLimits().maxDocumentBytes) {
    throw err('DOCUMENT_TOO_LARGE', 'journal document exceeds limit');
  }
  ensureDir(loc, path.posix.dirname(rel));
  const abs = absolute(loc, rel);
  const fd = fs.openSync(abs, 'wx');
  let closed = false;
  let owner;
  try {
    owner = fs.fstatSync(fd, { bigint: true });
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.writeSync(fd, bytes, offset, bytes.length - offset, offset);
      if (count <= 0) throw err('WRITE_FAILED', `journal write made no progress: ${rel}`);
      offset += count;
    }
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    closed = true;
    return owner;
  } catch (e) {
    if (!closed) {
      try { fs.closeSync(fd); } catch { /* descriptor may already be closed */ }
    }
    removeOwned(loc, rel, owner, rel === sub(loc, '.lock') ? bytes : null);
    throw e;
  }
}

function atomicHead(loc, head) {
  const tempRel = sub(loc, `.head-${crypto.randomUUID()}.tmp`);
  const targetRel = sub(loc, 'head.json');
  const owner = writeNew(loc, tempRel, jsonBytes(head));
  try {
    fs.renameSync(absolute(loc, tempRel), absolute(loc, targetRel));
  } catch (e) {
    removeOwned(loc, tempRel, owner);
    throw e;
  }
}

// The journal lock delegates to the verified-lock layer: payload carries
// {t,pid,at}, so a crashed writer (dead pid) is reclaimed on the next
// acquire while a live one is never broken. Legacy bare-token and
// zero-byte locks reclaim only past the staleness TTL.
function acquire(loc) {
  const abs = absolute(loc, sub(loc, '.lock'));
  fs.mkdirSync(path.dirname(abs), { recursive: true }); // journal base may not exist yet
  return acquireVerifiedLock(abs, 'JOURNAL_LOCKED', 'journal lock already exists');
}

function release(loc, lock) {
  releaseVerifiedLock(lock);
}

// Bounded listing with a capacity gate producers can keep strict. With
// failAtCapacity false the caller gets the bounded window and decides
// itself - used so drain/read paths stay available on a saturated or
// over-limit directory instead of deadlocking on JOURNAL_CAPACITY.
function directory(loc, rel, limit, { failAtCapacity = true } = {}) {
  const abs = absolute(loc, rel);
  const stat = lstatOrNull(abs);
  if (!stat) return [];
  if (!stat.isDirectory()) throw err('JOURNAL_MALFORMED', `not a directory: ${rel}`);
  const result = readDirBounded(abs, limit);
  if (failAtCapacity && result.truncated) {
    throw err('JOURNAL_CAPACITY', 'journal directory exceeds limit');
  }
  return result.entries;
}

function validateHead(value) {
  const code = 'JOURNAL_MALFORMED';
  plain(value, ['schemaVersion', 'lastSequence', 'activeOperation', 'pendingOperations'],
    ['schemaVersion', 'lastSequence', 'activeOperation'], code, 'journal head');
  if (value.schemaVersion !== 1 || !Number.isSafeInteger(value.lastSequence)
      || value.lastSequence < 0) throw err(code, 'journal head has invalid fields');
  if (value.pendingOperations !== undefined
      && (!Number.isSafeInteger(value.pendingOperations) || value.pendingOperations < 0)) {
    throw err(code, 'journal head has invalid pending count');
  }
  if (value.activeOperation !== null) {
    plain(value.activeOperation, ['operationId', 'intentDigest'],
      ['operationId', 'intentDigest'], code, 'active operation');
    if (!uuid(value.activeOperation.operationId) || !hash(value.activeOperation.intentDigest)) {
      throw err(code, 'active operation has invalid fields');
    }
  }
  return value;
}

function readHead(loc) {
  const rel = sub(loc, 'head.json');
  if (!lstatOrNull(absolute(loc, rel))) {
    if (hasEntry(loc, sub(loc, 'operations')) || hasEntry(loc, sub(loc, 'outbox'))) {
      throw err('JOURNAL_MALFORMED', 'journal head is missing while history exists');
    }
    return { schemaVersion: 1, lastSequence: 0, activeOperation: null };
  }
  return validateHead(readJson(loc, rel, 'JOURNAL_MALFORMED'));
}

function hasEntry(loc, rel) {
  const abs = absolute(loc, rel);
  const stat = lstatOrNull(abs);
  if (!stat) return false;
  if (!stat.isDirectory()) throw err('JOURNAL_MALFORMED', `not a directory: ${rel}`);
  const dir = fs.opendirSync(abs);
  try { return dir.readSync() !== null; } finally { dir.closeSync(); }
}

// State roots are relocatable (paths.state is owner-configured), so a
// committed event's snapshotRef keeps the state prefix it was written
// under. Validation anchors on sourceHash (the content digest that names
// the blob) and only requires the canonical snapshots suffix — never a
// specific historical state root.
function validSnapshotRef(ref, sourceHash) {
  if (typeof ref !== 'string'
      || !ref.endsWith(`/journal/snapshots/${sourceHash}.blob`)) return false;
  try { assertDestination(ref, 'snapshot ref'); } catch { return false; }
  return true;
}

function validRel(rel, loc, code) {
  let canonical;
  try {
    canonical = assertDestination(rel, 'source file');
  } catch (e) {
    if (code === 'INVALID_JOURNAL_INPUT') throw e;
    throw err(code, 'event source path is invalid');
  }
  if (canonical !== rel || isSameOrAncestor(loc.base, canonical)) {
    throw err(code, 'event source path is not canonical or is inside journal');
  }
  return canonical;
}

function validateIntent(intent, operationId, loc, policy) {
  const code = 'JOURNAL_MALFORMED';
  plain(intent, INTENT_KEYS, INTENT_KEYS, code, 'journal intent');
  if (intent.schemaVersion !== 1 || !uuid(intent.operationId)
      || intent.operationId !== operationId || intent.state !== 'prepared'
      || !time(intent.createdAt)) throw err(code, 'journal intent has invalid fields');
  dense(intent.events, code, 'journal events');
  if (intent.events.length > policy.maxOperationEvents) {
    throw err(code, 'journal event count exceeds policy');
  }
  const ids = new Set([intent.operationId]);
  const records = new Set();
  const paths = [];
  let previous = null;
  let identity = null;
  for (const event of intent.events) {
    plain(event, EVENT_KEYS, EVENT_KEYS, code, 'journal event');
    if (event.schemaVersion !== 1 || !uuid(event.eventId)
        || ids.has(event.eventId) || event.operationId !== operationId
        || !Number.isSafeInteger(event.journalSequence) || event.journalSequence < 1
        || (previous !== null && event.journalSequence !== previous + 1)
        || !uuid(event.workspaceId) || !uuid(event.projectId) || !uuid(event.repositoryId)
        || typeof event.sourceKind !== 'string' || !KIND.test(event.sourceKind)
        || typeof event.recordId !== 'string' || !RECORD.test(event.recordId)
        || (event.sourceRevision !== null
          && (!Number.isSafeInteger(event.sourceRevision) || event.sourceRevision < 0))
        || !hash(event.sourceHash)
        || !validSnapshotRef(event.snapshotRef, event.sourceHash)
        || !isJournalOperation(event.operation)
        || (event.operation === 'create' && event.previousHash !== null)
        || (event.operation === 'update'
          && (!hash(event.previousHash) || !Number.isSafeInteger(event.sourceRevision)
            || event.sourceRevision < 0))
        || event.createdAt !== intent.createdAt) {
      throw err(code, 'journal event has invalid fields');
    }
    dense(event.areaIds, code, 'journal event areaIds');
    if (!event.areaIds.every(uuid) || new Set(event.areaIds).size !== event.areaIds.length) {
      throw err(code, 'journal event areaIds are invalid');
    }
    const currentIdentity = [event.workspaceId, event.projectId, event.repositoryId].join('/');
    if (identity !== null && identity !== currentIdentity) {
      throw err(code, 'journal event identities disagree');
    }
    identity = currentIdentity;
    validRel(event.sourceRel, loc, code);
    const record = `${event.sourceKind}/${event.recordId}`;
    if (records.has(record) || paths.some((rel) =>
      isSameOrAncestor(rel, event.sourceRel) || isSameOrAncestor(event.sourceRel, rel))) {
      throw err(code, 'journal event sources collide');
    }
    ids.add(event.eventId);
    records.add(record);
    paths.push(event.sourceRel);
    previous = event.journalSequence;
  }
  return intent;
}

function validateCommit(value, operationId, intentDigest) {
  const code = 'JOURNAL_MALFORMED';
  plain(value, COMMIT_KEYS, COMMIT_KEYS, code, 'journal commit');
  if (value.schemaVersion !== 1 || value.operationId !== operationId
      || value.intentDigest !== intentDigest || value.state !== 'committed'
      || !time(value.confirmedAt)) throw err(code, 'journal commit has invalid fields');
}

function validateRecovery(value, operationId, intentDigest, state) {
  const code = 'JOURNAL_MALFORMED';
  plain(value, RECOVERY_KEYS, RECOVERY_KEYS, code, 'recovery receipt');
  if (value.schemaVersion !== 1 || value.operationId !== operationId
      || value.intentDigest !== intentDigest || typeof value.reason !== 'string'
      || value.reason.trim() === '' || !time(value.decidedAt)
      || !['finalize-committed', 'abandon-prepared'].includes(value.action)
      || (value.action === 'finalize-committed'
        ? value.sourceOutcome !== 'committed' || state !== 'committed'
        : value.sourceOutcome !== 'unconfirmed' || state !== 'prepared')) {
    throw err(code, 'recovery receipt is invalid or inconsistent with commit');
  }
}

// An operation lives under operations/ until compaction moves it to
// archive/operations/ — reads resolve either location so archiving never
// erases provenance or breaks journal show/event reads.
function operationBase(loc, operationId) {
  const live = `operations/${operationId}`;
  const stat = lstatOrNull(absolute(loc, sub(loc, live)));
  if (stat) {
    if (!stat.isDirectory()) {
      throw err('JOURNAL_MALFORMED', 'journal operation is not a directory');
    }
    return live;
  }
  return `archive/operations/${operationId}`;
}

function operation(loc, operationId, policy) {
  if (!uuid(operationId)) throw err('INVALID_JOURNAL_INPUT', 'operationId must be a UUID');
  const base = sub(loc, operationBase(loc, operationId));
  const intent = validateIntent(readJson(loc, `${base}/intent.json`), operationId, loc, policy);
  const intentDigest = canonicalDigest(intent);
  const commitRel = `${base}/commit.json`;
  let state = 'prepared';
  if (lstatOrNull(absolute(loc, commitRel))) {
    validateCommit(readJson(loc, commitRel, 'JOURNAL_MALFORMED'), operationId, intentDigest);
    state = 'committed';
  }
  const receiptRel = `${base}/recovery.json`;
  let recovery = null;
  if (lstatOrNull(absolute(loc, receiptRel))) {
    recovery = readJson(loc, receiptRel, 'JOURNAL_MALFORMED');
    validateRecovery(recovery, operationId, intentDigest, state);
    if (recovery.action === 'abandon-prepared') state = 'abandoned';
  }
  return { intent, intentDigest, state, recovery };
}

function authorizeEvent(bound, event) {
  return authorizeScope(bound, {
    workspaceId: event.workspaceId, projectId: event.projectId,
    repositoryId: event.repositoryId, areaIds: event.areaIds,
  });
}

function selectEvent(loaded, eventId) {
  if (!uuid(eventId)) throw err('INVALID_JOURNAL_INPUT', 'eventId must be a UUID');
  const event = loaded.intent.events.find((item) => item.eventId === eventId);
  if (!event) throw err('JOURNAL_NOT_FOUND', 'journal event not found');
  return event;
}

function verifiedSnapshot(loc, event) {
  const bytes = readBytes(loc, sub(loc, `snapshots/${event.sourceHash}.blob`),
    'JOURNAL_SNAPSHOT_MISSING');
  if (digestBytes(bytes) !== event.sourceHash) {
    throw err('JOURNAL_SNAPSHOT_MISMATCH', 'journal snapshot hash mismatch');
  }
  return bytes;
}

function validateEvidence(value, event, code, match = true) {
  plain(value, EVIDENCE_KEYS, EVIDENCE_KEYS, code, 'ack evidence');
  if (typeof value.backendId !== 'string'
      || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value.backendId)
      || typeof value.remoteNamespace !== 'string' || value.remoteNamespace.trim() === ''
      || !uuid(value.remoteKey) || !hash(value.eventDigest) || !hash(value.sourceHash)
      || !time(value.confirmedAt)
      || (match && (value.remoteKey !== event.eventId
        || value.eventDigest !== canonicalDigest(event) || value.sourceHash !== event.sourceHash))) {
    throw err(code, 'ack evidence has invalid fields');
  }
}

function ackRel(loc, operationId, eventId) {
  return sub(loc, `${operationBase(loc, operationId)}/acks/${eventId}.json`);
}

function readAck(loc, operationId, event) {
  const rel = ackRel(loc, operationId, event.eventId);
  if (!lstatOrNull(absolute(loc, rel))) return null;
  const ack = readJson(loc, rel, 'JOURNAL_MALFORMED');
  const keys = ['schemaVersion', 'operationId', 'eventId', 'evidence'];
  plain(ack, keys, keys, 'JOURNAL_MALFORMED', 'journal ack');
  if (ack.schemaVersion !== 1 || ack.operationId !== operationId
      || ack.eventId !== event.eventId) {
    throw err('JOURNAL_MALFORMED', 'journal ack identity mismatch');
  }
  validateEvidence(ack.evidence, event, 'JOURNAL_MALFORMED');
  return ack;
}

// Pending index listing, bounded by maxPendingOperations in every mode.
// Producers keep the strict default (JOURNAL_CAPACITY on overflow, ahead
// of the explicit pending.length checks); readers pass failAtCapacity
// false so a full outbox can still be listed, acked and recovered.
function outbox(loc, policy, { failAtCapacity = true } = {}) {
  const entries = directory(loc, sub(loc, 'outbox'),
    policy.maxPendingOperations, { failAtCapacity });
  const ids = [];
  for (const entry of entries) {
    const match = /^([0-9a-f-]+)\.json$/.exec(entry.name);
    if (!match || !uuid(match[1])) {
      throw err('JOURNAL_MALFORMED', 'outbox contains invalid entry');
    }
    absolute(loc, sub(loc, `outbox/${entry.name}`));
    if (!entry.isFile()) throw err('JOURNAL_MALFORMED', 'outbox entry is not a file');
    ids.push(match[1]);
  }
  return ids;
}

function indexedOperation(loc, operationId, policy) {
  const value = readJson(loc, sub(loc, `outbox/${operationId}.json`), 'JOURNAL_MALFORMED');
  const keys = ['schemaVersion', 'operationId', 'intentDigest'];
  plain(value, keys, keys, 'JOURNAL_MALFORMED', 'outbox index');
  if (value.schemaVersion !== 1 || value.operationId !== operationId || !hash(value.intentDigest)) {
    throw err('JOURNAL_MALFORMED', 'outbox index has invalid fields');
  }
  let loaded;
  try {
    loaded = operation(loc, operationId, policy);
  } catch (e) {
    if (e.code === 'JOURNAL_NOT_FOUND') {
      throw err('JOURNAL_MALFORMED', 'outbox intent is missing');
    }
    throw e;
  }
  if (loaded.intentDigest !== value.intentDigest) {
    throw err('JOURNAL_MALFORMED', 'outbox intent digest mismatch');
  }
  return loaded;
}

export function getJournalOperation(bound, operationId) {
  const loc = location(bound);
  const loaded = operation(loc, operationId, loadJournalPolicy());
  for (const event of loaded.intent.events) authorizeEvent(bound, event);
  return loaded;
}

export function getJournalEvent(bound, operationId, eventId) {
  const loc = location(bound);
  const loaded = operation(loc, operationId, loadJournalPolicy());
  const event = selectEvent(loaded, eventId);
  authorizeEvent(bound, event);
  return { event, intentDigest: loaded.intentDigest, state: loaded.state };
}

export function readJournalSnapshot(bound, operationId, eventId) {
  const loc = location(bound);
  const loaded = operation(loc, operationId, loadJournalPolicy());
  const event = selectEvent(loaded, eventId);
  authorizeEvent(bound, event);
  return verifiedSnapshot(loc, event);
}

export function listJournalPending(bound, options = {}) {
  const loc = location(bound);
  const policy = loadJournalPolicy();
  plain(options, ['afterSequence', 'limit'], [], 'INVALID_JOURNAL_INPUT', 'pending options');
  const after = Object.hasOwn(options, 'afterSequence') ? options.afterSequence : 0;
  const limit = Object.hasOwn(options, 'limit') ? options.limit : policy.defaultPageSize;
  if (!Number.isSafeInteger(after) || after < 0
      || !Number.isSafeInteger(limit) || limit <= 0 || limit > policy.maxPageSize) {
    throw err('INVALID_JOURNAL_INPUT', 'invalid pending cursor or limit');
  }
  const head = readHead(loc);
  const pending = outbox(loc, policy, { failAtCapacity: false });
  if (head.activeOperation && !pending.includes(head.activeOperation.operationId)) {
    throw err('JOURNAL_RECOVERY_REQUIRED', 'active operation is missing from outbox');
  }
  const next = [];
  for (const operationId of pending) {
    const loaded = indexedOperation(loc, operationId, policy);
    if (loaded.state === 'abandoned') {
      throw err('JOURNAL_RECOVERY_REQUIRED', 'abandoned operation requires cleanup');
    }
    if (operationId === head.activeOperation?.operationId
        && loaded.intentDigest !== head.activeOperation.intentDigest) {
      throw err('JOURNAL_MALFORMED', 'active operation digest mismatch');
    }
    for (const event of loaded.intent.events) {
      if (event.journalSequence > head.lastSequence) {
        throw err('JOURNAL_MALFORMED', 'journal head precedes pending events');
      }
      const ack = readAck(loc, operationId, event);
      if (ack && loaded.state !== 'committed') {
        throw err('JOURNAL_MALFORMED', 'prepared operation has an acknowledgement');
      }
      if (ack || event.journalSequence <= after) continue;
      try {
        authorizeEvent(bound, event);
      } catch (e) {
        if (e.code === 'SCOPE_DENIED') continue;
        throw e;
      }
      if (next.length < limit + 1 || event.journalSequence < next.at(-1).event.journalSequence) {
        if (next.length === limit + 1) next.pop();
        next.push({ operationId, event, intentDigest: loaded.intentDigest, state: loaded.state });
        next.sort((a, b) => a.event.journalSequence - b.event.journalSequence);
      }
    }
  }
  const hasMore = next.length > limit;
  const items = next.slice(0, limit);
  return { items, nextAfterSequence: hasMore ? items.at(-1).event.journalSequence : null };
}

// Acked enumeration: committed events whose remote acknowledgement exists.
// Mirrors listJournalPending pagination; operations fully acked lose their
// outbox index, so the scan walks operations/ directly instead of outbox/.
export function listJournalAcked(bound, options = {}) {
  const loc = location(bound);
  const policy = loadJournalPolicy();
  plain(options, ['afterSequence', 'limit'], [], 'INVALID_JOURNAL_INPUT', 'acked options');
  const after = Object.hasOwn(options, 'afterSequence') ? options.afterSequence : 0;
  const limit = Object.hasOwn(options, 'limit') ? options.limit : policy.defaultPageSize;
  if (!Number.isSafeInteger(after) || after < 0
      || !Number.isSafeInteger(limit) || limit <= 0 || limit > policy.maxPageSize) {
    throw err('INVALID_JOURNAL_INPUT', 'invalid acked cursor or limit');
  }
  const ids = new Set();
  for (const baseRel of ['operations', 'archive/operations']) {
    for (const entry of directory(loc, sub(loc, baseRel), policy.maxPendingOperations)) {
      if (entry.isDirectory() && uuid(entry.name)) ids.add(entry.name);
    }
  }
  const sorted = [...ids].sort();
  const next = [];
  for (const operationId of sorted) {
    const loaded = operation(loc, operationId, policy);
    if (loaded.state !== 'committed') continue;
    for (const event of loaded.intent.events) {
      if (event.journalSequence <= after) continue;
      const ack = readAck(loc, operationId, event);
      if (!ack) continue;
      try {
        authorizeEvent(bound, event);
      } catch {
        continue;
      }
      next.push({ operationId, event, evidence: ack.evidence });
    }
  }
  next.sort((a, b) => a.event.journalSequence - b.event.journalSequence);
  const hasMore = next.length > limit;
  const items = next.slice(0, limit);
  return { items, nextAfterSequence: hasMore ? items.at(-1).event.journalSequence : null };
}

// Cheap pending count for session start: head.pendingOperations is
// maintained by every writer under the journal lock; legacy heads
// without the field fall back to a bounded outbox directory count —
// never a full intent scan.
export function countJournalPending(bound) {
  const loc = location(bound);
  const head = readHead(loc);
  if (Number.isSafeInteger(head.pendingOperations)) {
    return head.pendingOperations;
  }
  return outbox(loc, loadJournalPolicy(), { failAtCapacity: false }).length;
}

// Compaction with full archival (owner decision 2026-11-20): terminal
// operations — committed with every event acked, or abandoned after
// recovery — move intact to archive/operations/ so operations/ stays
// bounded and provenance is never deleted. Pending, active, prepared
// and unacked operations are kept. Atomic rename keeps the move inside
// the same volume; snapshots stay shared and content-addressed.
export function compactJournal(bound) {
  const loc = location(bound);
  const policy = loadJournalPolicy();
  resolveWorkspaceState(bound);
  const lock = acquire(loc);
  try {
    resolveWorkspaceState(bound);
    const head = readHead(loc);
    const pending = new Set(outbox(loc, policy, { failAtCapacity: false }));
    const archived = [];
    const kept = [];
    for (const entry of directory(loc, sub(loc, 'operations'),
      policy.maxPendingOperations, { failAtCapacity: false })) {
      if (!entry.isDirectory() || !uuid(entry.name)) continue;
      const operationId = entry.name;
      const active = head.activeOperation?.operationId === operationId;
      if (active || pending.has(operationId)) { kept.push(operationId); continue; }
      const loaded = operation(loc, operationId, policy);
      const fullyAcked = loaded.state === 'committed'
        && loaded.intent.events.every((event) => readAck(loc, operationId, event));
      if (loaded.state === 'prepared'
          || (loaded.state === 'committed' && !fullyAcked)) {
        kept.push(operationId);
        continue;
      }
      ensureDir(loc, sub(loc, 'archive/operations'));
      fs.renameSync(absolute(loc, sub(loc, `operations/${operationId}`)),
        absolute(loc, sub(loc, `archive/operations/${operationId}`)));
      archived.push(operationId);
    }
    // Self-heals any counter drift; the pending set itself is unchanged.
    const current = readHead(loc);
    atomicHead(loc, { schemaVersion: 1, lastSequence: current.lastSequence,
      activeOperation: current.activeOperation,
      pendingOperations: outbox(loc, policy, { failAtCapacity: false }).length });
    return { archived, kept, archivedCount: archived.length };
  } finally {
    release(loc, lock);
  }
}

export function ackJournalEvent(bound, operationId, eventId, evidence) {
  const loc = location(bound);
  const policy = loadJournalPolicy();
  let loaded = operation(loc, operationId, policy);
  let event = selectEvent(loaded, eventId);
  authorizeEvent(bound, event);
  validateEvidence(evidence, event, 'INVALID_JOURNAL_INPUT', false);
  if (loaded.state !== 'committed') throw err('JOURNAL_NOT_COMMITTED', 'operation is not committed');
  verifiedSnapshot(loc, event);
  const lock = acquire(loc);
  try {
    resolveWorkspaceState(bound);
    loaded = operation(loc, operationId, policy);
    event = selectEvent(loaded, eventId);
    authorizeEvent(bound, event);
    validateEvidence(evidence, event, 'INVALID_JOURNAL_INPUT', false);
    if (loaded.state !== 'committed') throw err('JOURNAL_NOT_COMMITTED', 'operation is not committed');
    verifiedSnapshot(loc, event);
    const previous = readAck(loc, operationId, event);
    if (previous) {
      const same = { ...evidence, confirmedAt: previous.evidence.confirmedAt };
      if (canonicalDigest(same) !== canonicalDigest(previous.evidence)) {
        throw err('JOURNAL_ACK_CONFLICT', 'journal acknowledgement differs');
      }
    } else {
      validateEvidence(evidence, event, 'INVALID_JOURNAL_INPUT');
      const ack = { schemaVersion: 1, operationId, eventId, evidence: { ...evidence } };
      writeNew(loc, ackRel(loc, operationId, eventId), jsonBytes(ack));
    }
    if (loaded.intent.events.every((item) => readAck(loc, operationId, item))) {
      const indexRel = sub(loc, `outbox/${operationId}.json`);
      if (lstatOrNull(absolute(loc, indexRel))) {
        indexedOperation(loc, operationId, policy);
        fs.unlinkSync(absolute(loc, indexRel));
        const current = readHead(loc);
        atomicHead(loc, { schemaVersion: 1, lastSequence: current.lastSequence,
          activeOperation: current.activeOperation,
          pendingOperations: outbox(loc, policy,
            { failAtCapacity: false }).length });
      }
    }
  } finally {
    release(loc, lock);
  }
}

function validateChanges(bound, changes, loc, policy) {
  dense(changes, 'INVALID_JOURNAL_INPUT', 'journal changes');
  if (changes.length > policy.maxOperationEvents) {
    throw err('INVALID_JOURNAL_INPUT', 'journal operation exceeds event limit');
  }
  const records = new Set();
  return changes.map((change) => {
    plain(change, CHANGE_KEYS, CHANGE_KEYS, 'INVALID_JOURNAL_INPUT', 'journal change');
    plain(change.file, ['rel', 'content'], ['rel', 'content'],
      'INVALID_JOURNAL_INPUT', 'journal file');
    if (typeof change.sourceKind !== 'string' || !KIND.test(change.sourceKind)
        || typeof change.recordId !== 'string' || !RECORD.test(change.recordId)
        || (change.sourceRevision !== null
          && (!Number.isSafeInteger(change.sourceRevision) || change.sourceRevision < 0))
        || (typeof change.file.content !== 'string' && !Buffer.isBuffer(change.file.content))) {
      throw err('INVALID_JOURNAL_INPUT', 'journal change has invalid fields');
    }
    dense(change.areaIds, 'INVALID_JOURNAL_INPUT', 'journal change areaIds');
    const ids = [...change.areaIds];
    const content = Buffer.from(change.file.content);
    if (content.length > loadLimits().maxDocumentBytes) {
      throw err('DOCUMENT_TOO_LARGE', 'journal source exceeds document limit');
    }
    const rel = validRel(change.file.rel, loc, 'INVALID_JOURNAL_INPUT');
    const record = `${change.sourceKind}/${change.recordId}`;
    if (records.has(record)) throw err('INVALID_JOURNAL_INPUT', 'duplicate journal record');
    records.add(record);
    const scope = authorizeScope(bound, {
      workspaceId: bound.workspaceId, projectId: bound.projectId,
      repositoryId: bound.repositoryId, areaIds: ids,
    });
    return {
      sourceKind: change.sourceKind, recordId: change.recordId,
      sourceRevision: change.sourceRevision, areaIds: [...scope.areaIds],
      file: { rel, content },
    };
  });
}

function unchanged(planned) {
  return {
    status: 'unchanged', operationId: null, eventIds: [], journalState: 'none',
    pendingMemory: false, result: { created: 0, files: planned.map((file) => file.rel) },
    cause: null, warnings: [],
  };
}

function saveBlob(loc, hash, content) {
  const rel = sub(loc, `snapshots/${hash}.blob`);
  if (lstatOrNull(absolute(loc, rel))) {
    const bytes = readBytes(loc, rel, 'JOURNAL_SNAPSHOT_MISSING');
    if (digestBytes(bytes) !== hash || !bytes.equals(content)) {
      throw err('JOURNAL_SNAPSHOT_MISMATCH', 'existing snapshot differs');
    }
    return;
  }
  writeNew(loc, rel, content);
}

function saveSnapshot(loc, event, content) {
  saveBlob(loc, event.sourceHash, content);
}

function prepareIntent(bound, loc, candidates, head, identity = null) {
  const operationId = identity?.operationId ?? crypto.randomUUID();
  const createdAt = identity?.createdAt ?? new Date().toISOString();
  const events = candidates.map((candidate, index) => {
    const sourceHash = digestBytes(candidate.file.content);
    return {
      schemaVersion: 1, eventId: crypto.randomUUID(), operationId,
      journalSequence: head.lastSequence + index + 1,
      workspaceId: bound.workspaceId, projectId: bound.projectId,
      repositoryId: bound.repositoryId, areaIds: [...candidate.areaIds],
      sourceKind: candidate.sourceKind, recordId: candidate.recordId,
      sourceRevision: candidate.sourceRevision, sourceRel: candidate.file.rel,
      previousHash: candidate.previousHash ?? null, sourceHash,
      snapshotRef: sub(loc, `snapshots/${sourceHash}.blob`),
      operation: candidate.operation ?? 'create', createdAt,
    };
  });
  return { schemaVersion: 1, operationId, state: 'prepared', createdAt, events };
}

function pendingResult(intent, cause) {
  return {
    status: 'unconfirmed', operationId: intent.operationId,
    eventIds: intent.events.map((event) => event.eventId), journalState: 'prepared',
    pendingMemory: true, result: null, cause: toErrorPayload(cause), warnings: [],
  };
}

// Shared pre-condition for any journaled write under the lock: an
// inactive head, a pending outbox of only committed operations and no
// event sequence beyond the head.
function writableJournal(loc, policy) {
  const head = readHead(loc);
  if (head.activeOperation !== null) {
    throw err('JOURNAL_RECOVERY_REQUIRED', 'journal has an active operation');
  }
  const pending = outbox(loc, policy);
  for (const operationId of pending) {
    const loaded = indexedOperation(loc, operationId, policy);
    if (loaded.state !== 'committed') {
      throw err('JOURNAL_RECOVERY_REQUIRED', 'journal has an unconfirmed operation');
    }
    for (const event of loaded.intent.events) {
      if (event.journalSequence > head.lastSequence) {
        throw err('JOURNAL_MALFORMED', 'journal head precedes pending events');
      }
      readAck(loc, operationId, event);
    }
  }
  return { head, pending };
}

// Reserve the sequences in head, persist snapshots, intent and outbox in
// the fixed order. extraBlobs are additional content-addressed snapshot
// files (update pre-images) written after the per-event post-images.
// The head reservation stays FIRST on purpose: it allocates the sequence
// range under the lock, keeps "head exists before any history" true for
// readHead, and snapshots-before-intent preserves the invariant that a
// persisted intent implies complete snapshots. Writing the intent before
// the head would instead orphan an intent claiming sequences the head
// never reserved (and for a first operation a missing head with history
// is JOURNAL_MALFORMED). The remaining crash window - head reserved,
// intent absent - is resolved by missingIntentOperation on the
// 'abandon-prepared' recovery path, not by reordering.
function persistIntent(loc, intent, candidates, head, pendingBase, extraBlobs = []) {
  const intentBytes = jsonBytes(intent);
  const intentDigest = canonicalDigest(intent);
  const activeOperation = { operationId: intent.operationId, intentDigest };
  const reserved = { schemaVersion: 1,
    lastSequence: head.lastSequence + candidates.length, activeOperation,
    // The outbox index for this operation is written below; the counter
    // anticipates it so a crash mid-window only ever overcounts.
    pendingOperations: pendingBase + 1 };
  atomicHead(loc, reserved);
  for (let i = 0; i < candidates.length; i += 1) {
    saveSnapshot(loc, intent.events[i], candidates[i].file.content);
  }
  for (const blob of extraBlobs) {
    saveBlob(loc, blob.hash, blob.bytes);
  }
  writeNew(loc, sub(loc, `operations/${intent.operationId}/intent.json`), intentBytes);
  writeNew(loc, sub(loc, `outbox/${intent.operationId}.json`),
    jsonBytes({ schemaVersion: 1, operationId: intent.operationId, intentDigest }));
  return { intentDigest, reserved };
}

// Commit marker, confirmation state and head-pointer cleanup shared by
// create and update application tails.
function finalizeOperation(loc, intent, intentDigest, reserved, result) {
  try {
    writeNew(loc, sub(loc, `operations/${intent.operationId}/commit.json`),
      jsonBytes({ schemaVersion: 1, operationId: intent.operationId, intentDigest,
        state: 'committed', confirmedAt: new Date().toISOString() }));
  } catch (e) {
    result.cause = toErrorPayload(e);
    return result;
  }
  result.journalState = 'confirmed';
  try {
    const current = readHead(loc);
    if (current.lastSequence !== reserved.lastSequence
        || current.activeOperation?.operationId !== intent.operationId
        || current.activeOperation?.intentDigest !== intentDigest) {
      throw err('JOURNAL_RECOVERY_REQUIRED', 'journal active pointer changed');
    }
    atomicHead(loc, { schemaVersion: 1, lastSequence: current.lastSequence,
      activeOperation: null,
      pendingOperations: outbox(loc, loadJournalPolicy(),
        { failAtCapacity: false }).length });
  } catch {
    result.warnings.push(toErrorPayload(err('JOURNAL_RECOVERY_REQUIRED',
      'committed operation requires journal head recovery')));
  }
  return result;
}

function lockedCreation(bound, changes, loc, policy, identity = null) {
  resolveWorkspaceState(bound);
  const { head, pending } = writableJournal(loc, policy);
  const planned = preflightPlan(loc.root, changes.map((change) => change.file));
  const candidates = changes.filter((_, index) => planned[index].action === 'create');
  if (identity && candidates.length !== changes.length) {
    throw err('JOURNAL_SOURCE_CONFLICT', 'record creation requires all-new sources');
  }
  if (!candidates.length) return unchanged(planned);
  if (pending.length >= policy.maxPendingOperations) {
    throw err('JOURNAL_CAPACITY', 'journal pending capacity reached');
  }
  if (head.lastSequence > Number.MAX_SAFE_INTEGER - candidates.length) {
    throw err('JOURNAL_SEQUENCE_EXHAUSTED', 'journal sequence exhausted');
  }
  const intent = prepareIntent(bound, loc, candidates, head, identity);
  validateIntent(intent, intent.operationId, loc, policy);
  const { intentDigest, reserved } = persistIntent(loc, intent, candidates, head,
    pending.length);
  resolveWorkspaceState(bound);
  let applied;
  try {
    applied = applyPlan(loc.root, candidates.map((candidate) => candidate.file));
  } catch (e) {
    return pendingResult(intent, e);
  }
  if (applied.created !== candidates.length) {
    return pendingResult(intent,
      err('JOURNAL_SOURCE_UNCONFIRMED', 'not every prepared source was created'));
  }
  return finalizeOperation(loc, intent, intentDigest, reserved, {
    status: 'committed', operationId: intent.operationId,
    eventIds: intent.events.map((event) => event.eventId),
    journalState: 'pending-finalization', pendingMemory: true,
    result: applied, cause: null, warnings: [],
  });
}

function applyCreation(bound, validated, loc, policy, identity = null) {
  const lock = acquire(loc);
  let result;
  let failure;
  try {
    result = lockedCreation(bound, validated, loc, policy, identity);
  } catch (e) {
    failure = e;
  } finally {
    try {
      release(loc, lock);
    } catch (e) {
      if (result) result.warnings.push(toErrorPayload(e));
      else if (!failure) failure = e;
    }
  }
  if (failure) throw failure;
  return result;
}

export function applyJournaledCreation(bound, changes) {
  const loc = location(bound);
  const policy = loadJournalPolicy();
  const validated = validateChanges(bound, changes, loc, policy);
  const initial = preflightPlan(loc.root, validated.map((change) => change.file));
  if (initial.every((file) => file.action === 'noop')) return unchanged(initial);
  const initialCreates = validated.filter((_, index) => initial[index].action === 'create');
  return applyCreation(bound, initialCreates, loc, policy);
}

// Internal seam for typed adapters: the kernel generates the operation
// identity once, hands a frozen copy to the trusted synchronous callback
// and validates whatever it returns like any other change set. Every
// proposed source must be new — an existing matching file is a conflict,
// never adoption of foreign bytes.
export function applyJournaledRecordCreation(bound, createChanges) {
  if (typeof createChanges !== 'function') {
    throw err('INVALID_JOURNAL_INPUT', 'record creation requires a callback');
  }
  const identity = Object.freeze({
    operationId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  });
  const loc = location(bound);
  const policy = loadJournalPolicy();
  const validated = validateChanges(bound, createChanges(identity), loc, policy);
  const initial = preflightPlan(loc.root, validated.map((change) => change.file));
  if (!initial.every((file) => file.action === 'create')) {
    throw err('JOURNAL_SOURCE_CONFLICT', 'record creation requires all-new sources');
  }
  return applyCreation(bound, validated, loc, policy, identity);
}

// Bounded read of a CAS update target: the path must resolve to an
// existing regular non-link file whose bytes hash to the declared
// previousHash. Any drift, absence or exotic entry is a conflict - the
// caller's view of the world is wrong, never silently reconciled.
function readCasSource(loc, change) {
  const abs = absolute(loc, change.file.rel);
  const stat = lstatOrNull(abs);
  if (!stat || stat.isSymbolicLink() || !stat.isFile()) {
    throw err('JOURNAL_SOURCE_CONFLICT',
      `update source is missing or not a regular file: ${change.file.rel}`);
  }
  const limited = readFileLimited(abs, loadLimits().maxDocumentBytes);
  if (limited.exceeded) {
    throw err('DOCUMENT_TOO_LARGE',
      `update source exceeds document limit: ${change.file.rel}`);
  }
  if (digestBytes(limited.content) !== change.previousHash) {
    throw err('JOURNAL_SOURCE_CONFLICT',
      `update source differs from previousHash: ${change.file.rel}`);
  }
  return limited.content;
}

function validateUpdateChanges(bound, changes, loc, policy) {
  dense(changes, 'INVALID_JOURNAL_INPUT', 'journal changes');
  if (changes.length > policy.maxOperationEvents) {
    throw err('INVALID_JOURNAL_INPUT', 'journal operation exceeds event limit');
  }
  const records = new Set();
  return changes.map((change) => {
    validateUpdateChange(change, 'INVALID_JOURNAL_INPUT', 'journal change');
    const content = Buffer.from(change.file.content);
    if (content.length > loadLimits().maxDocumentBytes) {
      throw err('DOCUMENT_TOO_LARGE', 'journal source exceeds document limit');
    }
    const rel = validRel(change.file.rel, loc, 'INVALID_JOURNAL_INPUT');
    const record = `${change.sourceKind}/${change.recordId}`;
    if (records.has(record)) {
      throw err('INVALID_JOURNAL_INPUT', 'duplicate journal record');
    }
    records.add(record);
    const scope = authorizeScope(bound, {
      workspaceId: bound.workspaceId, projectId: bound.projectId,
      repositoryId: bound.repositoryId, areaIds: [...change.areaIds],
    });
    return {
      sourceKind: change.sourceKind, recordId: change.recordId,
      sourceRevision: change.sourceRevision, previousHash: change.previousHash,
      areaIds: [...scope.areaIds], file: { rel, content }, operation: 'update',
    };
  });
}

function unchangedUpdate(changes) {
  return {
    status: 'unchanged', operationId: null, eventIds: [], journalState: 'none',
    pendingMemory: false,
    result: { updated: 0, files: changes.map((change) => change.file.rel) },
    cause: null, warnings: [],
  };
}

// fsync'd exclusive temp write next to the update target so the rename
// stays on the same volume. A failed write removes only our own temp.
function stageUpdate(abs, content) {
  const tmp = `${abs}.upd-${crypto.randomUUID()}.tmp`;
  const fd = fs.openSync(tmp, 'wx');
  let closed = false;
  try {
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.writeSync(fd, bytes, offset, bytes.length - offset, offset);
      if (count <= 0) {
        throw err('WRITE_FAILED', `update temp write made no progress: ${tmp}`);
      }
      offset += count;
    }
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    closed = true;
    return tmp;
  } catch (e) {
    if (!closed) {
      try { fs.closeSync(fd); } catch { /* descriptor may already be closed */ }
    }
    try { fs.unlinkSync(tmp); } catch { /* best effort: our own temp only */ }
    throw e;
  }
}

// Two-phase apply: stage every new-content temp, re-verify the CAS on
// ALL targets so no rename happens while any source drifted, rename all,
// then post-verify each target's bytes. Failures surface as throws or a
// short updated count - the caller turns either into an unconfirmed op.
function applyUpdates(loc, changes) {
  const staged = [];
  try {
    for (const change of changes) {
      const abs = absolute(loc, change.file.rel);
      staged.push({ abs, tmp: stageUpdate(abs, change.file.content), change });
    }
    for (const item of staged) readCasSource(loc, item.change);
    for (const item of staged) {
      fs.renameSync(item.tmp, item.abs);
      item.tmp = null;
    }
    let updated = 0;
    for (const item of staged) {
      const current = readFileLimited(item.abs, loadLimits().maxDocumentBytes);
      if (!current.exceeded && current.content.equals(item.change.file.content)) {
        updated += 1;
      }
    }
    return { updated, files: changes.map((change) => change.file.rel) };
  } finally {
    for (const item of staged) {
      if (item.tmp) removeIfExists(item.tmp);
    }
  }
}

function lockedUpdate(bound, changes, loc, policy, identity) {
  resolveWorkspaceState(bound);
  const { head, pending } = writableJournal(loc, policy);
  // Authoritative CAS under the journal lock, BEFORE any sequence is
  // reserved: a stale view is a clean conflict, never a consumed intent.
  const preimages = changes.map((change) => readCasSource(loc, change));
  if (pending.length >= policy.maxPendingOperations) {
    throw err('JOURNAL_CAPACITY', 'journal pending capacity reached');
  }
  if (head.lastSequence > Number.MAX_SAFE_INTEGER - changes.length) {
    throw err('JOURNAL_SEQUENCE_EXHAUSTED', 'journal sequence exhausted');
  }
  const intent = prepareIntent(bound, loc, changes, head, identity);
  validateIntent(intent, intent.operationId, loc, policy);
  const { intentDigest, reserved } = persistIntent(loc, intent, changes, head,
    pending.length, changes.map((change, index) => ({
      hash: change.previousHash, bytes: preimages[index],
    })));
  resolveWorkspaceState(bound);
  let applied;
  try {
    applied = applyUpdates(loc, changes);
  } catch (e) {
    return pendingResult(intent, e);
  }
  if (applied.updated !== changes.length) {
    return pendingResult(intent,
      err('JOURNAL_SOURCE_UNCONFIRMED', 'not every prepared update was applied'));
  }
  return finalizeOperation(loc, intent, intentDigest, reserved, {
    status: 'committed', operationId: intent.operationId,
    eventIds: intent.events.map((event) => event.eventId),
    journalState: 'pending-finalization', pendingMemory: true,
    result: applied, cause: null, warnings: [],
  });
}

function applyUpdate(bound, validated, loc, policy, identity) {
  const lock = acquire(loc);
  let result;
  let failure;
  try {
    result = lockedUpdate(bound, validated, loc, policy, identity);
  } catch (e) {
    failure = e;
  } finally {
    try {
      release(loc, lock);
    } catch (e) {
      if (result) result.warnings.push(toErrorPayload(e));
      else if (!failure) failure = e;
    }
  }
  if (failure) throw failure;
  return result;
}

// Internal seam for typed adapters updating mutable records: the kernel
// generates the operation identity once, hands a frozen copy to the
// trusted synchronous callback and validates whatever it returns as
// update changes. Every proposed source must exist, be a regular file
// and hash to the declared previousHash - the compare-and-swap is
// checked before any reservation and again under the journal lock, then
// applied by temp+rename. A CAS mismatch, missing source or non-regular
// target fails closed before any journal state is reserved; apply-phase
// failures preserve the unconfirmed/prepared receipt exactly like create
// failures. The CAS is cooperative: writers outside the journal can
// still interleave, and the declared sourceRevision is provenance
// metadata the kernel does not verify against prior operations.
export function applyJournaledRecordUpdate(bound, updateChanges) {
  if (typeof updateChanges !== 'function') {
    throw err('INVALID_JOURNAL_INPUT', 'record update requires a callback');
  }
  const identity = Object.freeze({
    operationId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  });
  const loc = location(bound);
  const policy = loadJournalPolicy();
  const validated = validateUpdateChanges(bound, updateChanges(identity), loc, policy);
  const current = validated.map((change) => readCasSource(loc, change));
  const candidates = validated.filter((_, index) =>
    !current[index].equals(validated[index].file.content));
  if (!candidates.length) return unchangedUpdate(validated);
  return applyUpdate(bound, candidates, loc, policy, identity);
}

function recoveryInput(operationId, options) {
  if (!uuid(operationId)) throw err('INVALID_JOURNAL_INPUT', 'operationId must be a UUID');
  const keys = ['action', 'expectedIntentDigest', 'reason'];
  plain(options, keys, keys, 'INVALID_JOURNAL_INPUT', 'recovery options');
  const input = { action: options.action, expectedIntentDigest: options.expectedIntentDigest,
    reason: options.reason };
  if (!['finalize-committed', 'abandon-prepared'].includes(input.action)
      || !hash(input.expectedIntentDigest)
      || typeof input.reason !== 'string' || input.reason.trim() === '') {
    throw err('INVALID_JOURNAL_INPUT', 'recovery options have invalid fields');
  }
  jsonBytes({ schemaVersion: 1, operationId, intentDigest: input.expectedIntentDigest,
    action: input.action, sourceOutcome: input.action === 'finalize-committed'
      ? 'committed' : 'unconfirmed', reason: input.reason,
    decidedAt: '2026-01-01T00:00:00.000Z' });
  return input;
}

// Resolve a wedged reservation: the head points at an operation whose
// intent.json was never persisted (crash inside persistIntent between the
// atomic head write and the intent write). Only 'abandon-prepared' may
// resolve it; every other action keeps failing closed with the original
// JOURNAL_NOT_FOUND. The caller proves knowledge of the reservation
// through expectedIntentDigest, verified against head.activeOperation -
// the reported digest is the reserved one, never fabricated intent data.
// Tolerance applies only to genuine absence: the operation directory must
// hold nothing but an optional matching abandon receipt (kept so a
// recovery that crashed after persisting its receipt stays resumable),
// and a present outbox index must match the same digest. A malformed,
// partial or contradictory artifact still fails closed.
function missingIntentOperation(loc, policy, operationId, input) {
  const base = sub(loc, `operations/${operationId}`);
  if (input.action !== 'abandon-prepared') {
    throw err('JOURNAL_NOT_FOUND', `journal file not found: ${base}/intent.json`);
  }
  let recovery = null;
  for (const entry of directory(loc, base, 8)) {
    if (entry.name === 'recovery.json' && entry.isFile()) {
      recovery = readJson(loc, `${base}/recovery.json`, 'JOURNAL_MALFORMED');
      validateRecovery(recovery, operationId, input.expectedIntentDigest, 'prepared');
      if (recovery.action !== input.action || recovery.reason !== input.reason) {
        throw err('JOURNAL_RECOVERY_CONFLICT', 'recovery decision differs from receipt');
      }
      continue;
    }
    throw err('JOURNAL_MALFORMED',
      `unexpected artifact without intent: ${base}/${entry.name}`);
  }
  const head = readHead(loc);
  if (head.activeOperation) {
    if (head.activeOperation.operationId !== operationId) {
      throw err('JOURNAL_RECOVERY_CONFLICT', 'another operation is active');
    }
    if (head.activeOperation.intentDigest !== input.expectedIntentDigest) {
      throw err('JOURNAL_RECOVERY_CONFLICT', 'expected intent digest differs');
    }
  } else if (!recovery) {
    throw err('JOURNAL_NOT_FOUND', `journal operation not found: ${operationId}`);
  }
  const indexRel = sub(loc, `outbox/${operationId}.json`);
  const hasIndex = Boolean(lstatOrNull(absolute(loc, indexRel)));
  if (hasIndex) {
    const index = readJson(loc, indexRel, 'JOURNAL_MALFORMED');
    plain(index, ['schemaVersion', 'operationId', 'intentDigest'],
      ['schemaVersion', 'operationId', 'intentDigest'], 'JOURNAL_MALFORMED', 'outbox index');
    if (index.schemaVersion !== 1 || index.operationId !== operationId
        || index.intentDigest !== input.expectedIntentDigest) {
      throw err('JOURNAL_MALFORMED', 'outbox index does not match reservation');
    }
  }
  const loaded = { intent: null, intentDigest: input.expectedIntentDigest,
    state: recovery ? 'abandoned' : 'missing', recovery };
  return { loc, loaded, head, pendingEventIds: [], indexRel, hasIndex, policy };
}

function recoveryData(bound, operationId, input) {
  const loc = location(bound);
  const policy = loadJournalPolicy();
  let loaded;
  try {
    loaded = operation(loc, operationId, policy);
  } catch (e) {
    if (e.code !== 'JOURNAL_NOT_FOUND') throw e;
    return missingIntentOperation(loc, policy, operationId, input);
  }
  for (const event of loaded.intent.events) authorizeEvent(bound, event);
  if (loaded.intentDigest !== input.expectedIntentDigest) {
    throw err('JOURNAL_RECOVERY_CONFLICT', 'expected intent digest differs');
  }
  if (loaded.recovery && (loaded.recovery.action !== input.action
      || loaded.recovery.reason !== input.reason
      || loaded.recovery.intentDigest !== input.expectedIntentDigest)) {
    throw err('JOURNAL_RECOVERY_CONFLICT', 'recovery decision differs from receipt');
  }
  const pendingEventIds = [];
  for (const event of loaded.intent.events) {
    verifiedSnapshot(loc, event);
    const ack = readAck(loc, operationId, event);
    if (ack && loaded.state !== 'committed') {
      throw err('JOURNAL_MALFORMED', 'uncommitted operation has an acknowledgement');
    }
    if (!ack && loaded.state === 'committed') pendingEventIds.push(event.eventId);
  }
  const head = readHead(loc);
  const lastSequence = loaded.intent.events.at(-1).journalSequence;
  if (head.lastSequence < lastSequence) {
    throw err('JOURNAL_MALFORMED', 'journal head precedes operation');
  }
  if (head.activeOperation) {
    if (head.activeOperation.operationId !== operationId) {
      throw err('JOURNAL_RECOVERY_CONFLICT', 'another operation is active');
    }
    if (head.activeOperation.intentDigest !== loaded.intentDigest
        || head.lastSequence !== lastSequence) {
      throw err('JOURNAL_MALFORMED', 'active operation does not match journal head');
    }
  }
  const indexRel = sub(loc, `outbox/${operationId}.json`);
  const hasIndex = Boolean(lstatOrNull(absolute(loc, indexRel)));
  if (hasIndex) indexedOperation(loc, operationId, policy);
  if ((input.action === 'finalize-committed' && loaded.state !== 'committed')
      || (input.action === 'abandon-prepared' && loaded.state === 'committed')) {
    throw err('JOURNAL_RECOVERY_CONFLICT', 'recovery action does not match operation state');
  }
  if (input.action === 'finalize-committed' && pendingEventIds.length && !hasIndex
      && outbox(loc, policy).length >= policy.maxPendingOperations) {
    throw err('JOURNAL_CAPACITY', 'journal pending capacity reached');
  }
  return { loc, loaded, head, pendingEventIds, indexRel, hasIndex, policy };
}

function recoveryResult(operationId, input, data, mode, recovery = data.loaded.recovery) {
  return {
    mode, operationId, intentDigest: data.loaded.intentDigest,
    action: input.action, reason: input.reason,
    state: mode === 'applied' && input.action === 'abandon-prepared'
      ? 'abandoned' : data.loaded.state,
    sourceOutcome: input.action === 'finalize-committed' ? 'committed' : 'unconfirmed',
    preservesSources: true, pendingEventIds: data.pendingEventIds, recovery, warnings: [],
  };
}

export function prepareJournalRecovery(bound, operationId, options) {
  const input = recoveryInput(operationId, options);
  const data = recoveryData(bound, operationId, input);
  return recoveryResult(operationId, input, data, 'dry-run');
}

export function recoverJournalOperation(bound, operationId, options) {
  const input = recoveryInput(operationId, options);
  const initial = recoveryData(bound, operationId, input);
  resolveWorkspaceState(bound);
  const lock = acquire(initial.loc);
  let result;
  let failure;
  try {
    const data = recoveryData(bound, operationId, input);
    let receipt = data.loaded.recovery;
    if (!receipt) {
      receipt = { schemaVersion: 1, operationId, intentDigest: data.loaded.intentDigest,
        action: input.action, sourceOutcome: input.action === 'finalize-committed'
          ? 'committed' : 'unconfirmed', reason: input.reason, decidedAt: new Date().toISOString() };
      resolveWorkspaceState(bound);
      writeNew(data.loc, sub(data.loc, `operations/${operationId}/recovery.json`),
        jsonBytes(receipt));
    }
    if (input.action === 'finalize-committed' && data.pendingEventIds.length && !data.hasIndex) {
      resolveWorkspaceState(bound);
      writeNew(data.loc, data.indexRel, jsonBytes({
        schemaVersion: 1, operationId, intentDigest: data.loaded.intentDigest,
      }));
    }
    if (data.head.activeOperation) {
      resolveWorkspaceState(bound);
      atomicHead(data.loc, { schemaVersion: 1, lastSequence: data.head.lastSequence,
        activeOperation: null,
        pendingOperations: outbox(data.loc, data.policy,
          { failAtCapacity: false }).length });
    }
    if (data.hasIndex && (input.action === 'abandon-prepared' || !data.pendingEventIds.length)) {
      resolveWorkspaceState(bound);
      // A missing intent cannot be reloaded: recoveryData already
      // validated that index against the head reservation instead.
      if (data.loaded.intent) indexedOperation(data.loc, operationId, data.policy);
      fs.unlinkSync(absolute(data.loc, data.indexRel));
      atomicHead(data.loc, { schemaVersion: 1, lastSequence: data.head.lastSequence,
        activeOperation: null,
        pendingOperations: outbox(data.loc, data.policy,
          { failAtCapacity: false }).length });
    }
    result = recoveryResult(operationId, input, data, 'applied', receipt);
  } catch (e) {
    failure = e;
  } finally {
    try {
      release(initial.loc, lock);
    } catch (e) {
      if (result) result.warnings.push(toErrorPayload(e));
      else if (!failure) failure = e;
    }
  }
  if (failure) throw failure;
  return result;
}
