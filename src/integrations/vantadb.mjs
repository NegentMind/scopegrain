import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { canonicalDigest, canonicalJSON } from '../core/digests.mjs';
import { err, toErrorPayload } from '../core/errors.mjs';
import { decodeUtf8Strict, readFileLimited } from '../core/fsx.mjs';
import { ackJournalEvent, getJournalEvent, listJournalPending, readJournalSnapshot }
  from '../core/journal.mjs';
import { resolveInside } from '../core/paths.mjs';
import { loadJournalPolicy } from '../core/policy.mjs';
import { authorizeScope, resolveWorkspaceState } from '../core/workspaces.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BACKEND = /^[a-z0-9][a-z0-9-]{0,63}$/;
const POLICY_PATH = fileURLToPath(new URL('../../policy/vantadb-projection.json', import.meta.url));
const POLICY_LIMIT = 1048576;
const CHUNK_BYTES = 262144;
const RESULT_BYTES = 8388608;

function closed(value, keys, required, code, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
      || Object.getOwnPropertySymbols(value).length) {
    throw err(code, `${label} must be a plain object`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [name, descriptor] of Object.entries(descriptors)) {
    if (!keys.includes(name) || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw err(code, `${label} contains invalid property '${name}'`);
    }
  }
  for (const name of required) {
    if (!Object.hasOwn(descriptors, name)) throw err(code, `${label} is missing '${name}'`);
  }
}

function readPolicy() {
  let value;
  try {
    const result = readFileLimited(POLICY_PATH, POLICY_LIMIT);
    if (result.exceeded) throw err('POLICY_MALFORMED', 'projection policy exceeds limit');
    value = JSON.parse(decodeUtf8Strict(
      result.content, 'POLICY_MALFORMED', 'projection policy'));
  } catch (e) {
    if (e.code === 'POLICY_MALFORMED') throw e;
    if (e.code === 'ENOENT') throw err('POLICY_NOT_FOUND', 'projection policy not found');
    throw err('POLICY_MALFORMED', 'projection policy is not valid JSON');
  }
  const keys = ['schemaVersion', 'formatVersion', 'chunkBytes', 'maxToolResultBytes'];
  closed(value, keys, keys, 'POLICY_MALFORMED', 'projection policy');
  if (value.schemaVersion !== 1 || value.formatVersion !== 1
      || value.chunkBytes !== CHUNK_BYTES || value.maxToolResultBytes !== RESULT_BYTES) {
    throw err('POLICY_MALFORMED', 'projection policy has unsupported protocol values');
  }
  return value;
}

function leasePath(loc) {
  return resolveInside(loc.projectRoot, `${loc.stateRel}/journal/.vantadb-projection.lock`,
    'projection lease');
}

function leaseMatches(loc, lease) {
  const root = fs.statSync(loc.projectRoot, { bigint: true });
  if (root.dev !== lease.root.dev || root.ino !== lease.root.ino) return false;
  const abs = leasePath(loc);
  const current = fs.lstatSync(abs, { bigint: true });
  if (!current.isFile() || current.dev !== lease.owner.dev || current.ino !== lease.owner.ino) {
    return false;
  }
  const bytes = readFileLimited(abs, Buffer.byteLength(lease.token));
  return !bytes.exceeded && bytes.content.equals(Buffer.from(lease.token));
}

function releaseLease(loc, lease) {
  if (!leaseMatches(loc, lease)) throw err('BRAIN_SYNC_LOCKED', 'projection lease was replaced');
  fs.unlinkSync(leasePath(loc));
}

function acquireLease(loc) {
  const abs = leasePath(loc);
  const root = fs.statSync(loc.projectRoot, { bigint: true });
  const token = crypto.randomUUID();
  let fd;
  try {
    fd = fs.openSync(abs, 'wx');
  } catch (e) {
    if (e.code === 'EEXIST') throw err('BRAIN_SYNC_LOCKED', 'projection lease already exists');
    throw e;
  }
  let owner;
  let closed = false;
  try {
    owner = fs.fstatSync(fd, { bigint: true });
    const bytes = Buffer.from(token);
    let offset = 0;
    while (offset < bytes.length) {
      const written = fs.writeSync(fd, bytes, offset, bytes.length - offset, offset);
      if (written <= 0) throw err('WRITE_FAILED', 'projection lease write made no progress');
      offset += written;
    }
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    closed = true;
    return { root, owner, token };
  } catch (e) {
    if (!closed) {
      try { fs.closeSync(fd); } catch { /* descriptor may already be closed */ }
    }
    if (owner) {
      try { releaseLease(loc, { root, owner, token }); } catch { /* do not remove foreign lease */ }
    }
    throw e;
  }
}

function scope(event) {
  return {
    workspaceId: event.workspaceId, projectId: event.projectId,
    repositoryId: event.repositoryId, areaIds: [...event.areaIds].sort(),
  };
}

function chunksFor(snapshot, event) {
  const decoded = snapshot.toString('utf8');
  const encoding = Buffer.from(decoded, 'utf8').equals(snapshot) ? 'utf8' : 'base64';
  const segments = [];
  if (encoding === 'utf8') {
    for (let start = 0; start < snapshot.length;) {
      let end = Math.min(start + CHUNK_BYTES, snapshot.length);
      while (end < snapshot.length && (snapshot[end] & 0xc0) === 0x80) end -= 1;
      segments.push(snapshot.subarray(start, end).toString('utf8'));
      start = end;
    }
  } else {
    const encoded = snapshot.toString('base64');
    for (let start = 0; start < encoded.length; start += CHUNK_BYTES) {
      segments.push(encoded.slice(start, start + CHUNK_BYTES));
    }
  }
  const keys = segments.map((_, index) =>
    `blob-v1-${event.sourceHash}-${encoding}-${String(index).padStart(4, '0')}`);
  return { encoding, segments, keys };
}

function expectedProjection(event, snapshot) {
  const scopeHash = canonicalDigest(scope(event));
  const eventNamespace = `sg-formal-v1-${scopeHash}`;
  const chunkNamespace = `sg-snapshot-v1-${scopeHash}`;
  const chunks = chunksFor(snapshot, event);
  const eventDigest = canonicalDigest(event);
  const payload = canonicalJSON({
    schemaVersion: 1, type: 'scopegrain.journal-event', event, eventDigest,
    snapshot: { namespace: chunkNamespace, encoding: chunks.encoding,
      byteLength: snapshot.length, sourceHash: event.sourceHash, chunks: chunks.keys },
  });
  return { eventNamespace, chunkNamespace, eventDigest, payload, chunks };
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function validateResult(value) {
  let serialized;
  try {
    serialized = canonicalJSON(value);
  } catch {
    throw err('BRAIN_INVALID_RESPONSE', 'remote result is not plain JSON');
  }
  if (Buffer.byteLength(serialized, 'utf8') > RESULT_BYTES) {
    throw err('BRAIN_RESPONSE_TOO_LARGE', 'remote result exceeds protocol limit');
  }
  if (!isObject(value)
      || (Object.hasOwn(value, 'isError') && typeof value.isError !== 'boolean')) {
    throw err('BRAIN_INVALID_RESPONSE', 'remote result has invalid shape');
  }
}

function textJson(result) {
  if (!Object.hasOwn(result, 'content') || !Array.isArray(result.content)
      || result.content.length !== 1 || !isObject(result.content[0])
      || !Object.hasOwn(result.content[0], 'type') || !Object.hasOwn(result.content[0], 'text')
      || result.content[0].type !== 'text' || typeof result.content[0].text !== 'string') {
    throw err('BRAIN_INVALID_RESPONSE', 'remote text result has invalid shape');
  }
  try {
    return JSON.parse(result.content[0].text);
  } catch {
    throw err('BRAIN_INVALID_RESPONSE', 'remote text result is not JSON');
  }
}

function notFound(code, data) {
  return code === -32004 && isObject(data)
    && Object.hasOwn(data, 'code') && data.code === 'VANTADB_NOT_FOUND'
    && Object.hasOwn(data, 'retriable') && data.retriable === false;
}

function thrownNotFound(value) {
  if (value === null || !['object', 'function'].includes(typeof value)) return false;
  const code = Object.getOwnPropertyDescriptor(value, 'code');
  const data = Object.getOwnPropertyDescriptor(value, 'data');
  if (!code || !data || !Object.hasOwn(code, 'value') || !Object.hasOwn(data, 'value')) return false;
  try {
    canonicalJSON(data.value);
    return notFound(code.value, data.value);
  } catch {
    return false;
  }
}

function decodeResult(result, name, namespace, key) {
  validateResult(result);
  if (Object.hasOwn(result, 'isError') && result.isError === true) {
    if (Object.hasOwn(result, 'structuredContent')) {
      throw err('BRAIN_INVALID_RESPONSE', 'remote error has unexpected structured content');
    }
    const value = textJson(result);
    if (!isObject(value) || !Object.hasOwn(value, 'code') || !Object.hasOwn(value, 'message')
        || !Object.hasOwn(value, 'data') || !Number.isSafeInteger(value.code)
        || typeof value.message !== 'string' || !isObject(value.data)) {
      throw err('BRAIN_INVALID_RESPONSE', 'remote error envelope has invalid shape');
    }
    if (name === 'memory_get' && notFound(value.code, value.data)) return null;
    throw err('BRAIN_BACKEND_ERROR', 'remote tool returned an error');
  }
  const value = Object.hasOwn(result, 'structuredContent')
    ? result.structuredContent : textJson(result);
  if (!isObject(value) || !Object.hasOwn(value, 'namespace') || !Object.hasOwn(value, 'key')
      || !Object.hasOwn(value, 'payload') || value.namespace !== namespace || value.key !== key
      || typeof value.payload !== 'string') {
    throw err('BRAIN_INVALID_RESPONSE', 'remote record identity or payload is invalid');
  }
  return value.payload;
}

async function remote(bound, invoke, event, name, args) {
  authorizeScope(bound, scope(event));
  let result;
  try {
    result = await invoke({ name, arguments: args });
  } catch (e) {
    if (name === 'memory_get' && thrownNotFound(e)) return null;
    throw err(name === 'memory_put' ? 'BRAIN_REMOTE_UNCERTAIN' : 'BRAIN_BACKEND_ERROR',
      name === 'memory_put' ? 'remote write outcome is uncertain' : 'remote read failed');
  }
  return decodeResult(result, name, args.namespace, args.key);
}

function sameEvent(actual, expected) {
  try {
    return canonicalJSON(JSON.parse(actual)) === expected;
  } catch {
    return false;
  }
}

function requireMatching(actual, expected, eventPayload) {
  const same = eventPayload ? sameEvent(actual, expected) : actual === expected;
  if (!same) throw err('BRAIN_REMOTE_CONFLICT', 'remote immutable value differs');
}

function report() {
  return { acknowledgedEventIds: [], blockedEventIds: [], failure: null, warnings: [] };
}

function retainedError(e) {
  return typeof e?.code === 'string' && (
    e.code === 'SCOPE_DENIED' || e.code === 'WORKSPACE_STALE'
    || e.code.startsWith('JOURNAL_SNAPSHOT_') || e.code === 'SYMLINK_REJECTED'
    || e.code === 'PROJECT_NOT_FOUND' || e.code === 'PROJECT_NOT_DIR'
    || e.code === 'DOCUMENT_TOO_LARGE');
}

function failure(result, operationId, eventId, stage, error) {
  const actual = stage === 'ack' && !retainedError(error)
    ? err('BRAIN_LOCAL_ACK_UNCERTAIN', 'local acknowledgement outcome is uncertain')
    : error;
  result.failure = { operationId, eventId, stage, error: toErrorPayload(actual) };
}

async function getValue(bound, invoke, event, namespace, key) {
  return remote(bound, invoke, event, 'memory_get', { namespace, key });
}

async function putValue(bound, invoke, event, namespace, key, payload) {
  const returned = await remote(bound, invoke, event, 'memory_put', { namespace, key, payload });
  requireMatching(returned, payload, false);
}

async function projectOne(bound, backendId, invoke, operationId, eventId, result) {
  let stage = 'snapshot';
  try {
    const loaded = getJournalEvent(bound, operationId, eventId);
    if (loaded.state !== 'committed') {
      throw err('JOURNAL_NOT_COMMITTED', 'journal event is not committed');
    }
    const event = loaded.event;
    const snapshot = readJournalSnapshot(bound, operationId, eventId);
    const expected = expectedProjection(event, snapshot);
    stage = 'read';
    const first = await getValue(bound, invoke, event, expected.eventNamespace, eventId);
    if (first !== null) requireMatching(first, expected.payload, true);
    for (let i = 0; i < expected.chunks.keys.length; i += 1) {
      const key = expected.chunks.keys[i];
      const payload = expected.chunks.segments[i];
      stage = 'read';
      const existing = await getValue(bound, invoke, event, expected.chunkNamespace, key);
      if (existing !== null) {
        requireMatching(existing, payload, false);
        continue;
      }
      stage = 'write';
      await putValue(bound, invoke, event, expected.chunkNamespace, key, payload);
      stage = 'verify';
      const verified = await getValue(bound, invoke, event, expected.chunkNamespace, key);
      if (verified === null) {
        throw err('BRAIN_REMOTE_UNCERTAIN', 'remote chunk was not confirmed by readback');
      }
      requireMatching(verified, payload, false);
    }
    stage = 'read';
    const current = await getValue(bound, invoke, event, expected.eventNamespace, eventId);
    if (current !== null) {
      requireMatching(current, expected.payload, true);
    } else {
      stage = 'write';
      await putValue(bound, invoke, event, expected.eventNamespace, eventId, expected.payload);
      stage = 'verify';
      const verified = await getValue(bound, invoke, event, expected.eventNamespace, eventId);
      if (verified === null) {
        throw err('BRAIN_REMOTE_UNCERTAIN', 'remote event was not confirmed by readback');
      }
      requireMatching(verified, expected.payload, true);
    }
    stage = 'ack';
    ackJournalEvent(bound, operationId, eventId, {
      backendId, remoteNamespace: expected.eventNamespace, remoteKey: eventId,
      eventDigest: expected.eventDigest, sourceHash: event.sourceHash,
      confirmedAt: new Date().toISOString(),
    });
    result.acknowledgedEventIds.push(eventId);
  } catch (e) {
    failure(result, operationId, eventId, stage, e);
  }
}

async function withLease(bound, action) {
  const loc = resolveWorkspaceState(bound);
  const lease = acquireLease(loc);
  let result;
  try {
    result = await action();
    return result;
  } finally {
    try {
      releaseLease(loc, lease);
    } catch {
      if (result) result.warnings.push(toErrorPayload(
        err('BRAIN_SYNC_LOCKED', 'projection lease could not be safely released')));
    }
  }
}

export function createVantaDBProjector(bound, options) {
  closed(options, ['backendId', 'invoke'], ['backendId', 'invoke'],
    'BRAIN_INVALID_INPUT', 'projection options');
  if (typeof options.backendId !== 'string' || !BACKEND.test(options.backendId)
      || typeof options.invoke !== 'function') {
    throw err('BRAIN_INVALID_INPUT', 'projection options have invalid fields');
  }
  resolveWorkspaceState(bound);
  readPolicy();
  const { backendId, invoke } = options;
  const journalPolicy = loadJournalPolicy();

  async function drain(options = {}) {
    closed(options, ['limit'], [], 'BRAIN_INVALID_INPUT', 'drain options');
    const limit = Object.hasOwn(options, 'limit') ? options.limit : journalPolicy.defaultPageSize;
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > journalPolicy.maxPageSize) {
      throw err('BRAIN_INVALID_INPUT', 'invalid drain limit');
    }
    const initial = listJournalPending(bound, { afterSequence: 0, limit });
    if (!initial.items.some((item) => item.state === 'committed')) {
      const result = report();
      result.blockedEventIds = initial.items.map((item) => item.event.eventId);
      return result;
    }
    return withLease(bound, async () => {
      const items = listJournalPending(bound, { afterSequence: 0, limit }).items;
      const result = report();
      result.blockedEventIds = items.filter((item) => item.state === 'prepared')
        .map((item) => item.event.eventId);
      for (const item of items) {
        if (item.state === 'prepared') continue;
        await projectOne(bound, backendId, invoke, item.operationId, item.event.eventId, result);
        if (result.failure) break;
      }
      return result;
    });
  }

  async function project(operationId, eventId) {
    if (typeof operationId !== 'string' || !UUID.test(operationId)
        || typeof eventId !== 'string' || !UUID.test(eventId)) {
      throw err('BRAIN_INVALID_INPUT', 'operationId and eventId must be canonical UUIDs');
    }
    const loaded = getJournalEvent(bound, operationId, eventId);
    if (loaded.state !== 'committed') {
      throw err('JOURNAL_NOT_COMMITTED', 'journal event is not committed');
    }
    return withLease(bound, async () => {
      const result = report();
      await projectOne(bound, backendId, invoke, operationId, eventId, result);
      return result;
    });
  }

  return Object.freeze({ drain, project });
}
