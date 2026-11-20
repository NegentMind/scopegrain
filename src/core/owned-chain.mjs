// Shared proof primitives for the opt-in journal-backed owned stores
// (transition, approvals, sessions, plans, workspaces). The five stores
// were built in parallel and duplicated the same read machinery: a
// bounded current-file read under a revalidated binding, strict-UTF8
// JSON parsing, the two-event operation pair check, create/update chain
// coherence and the bounded chain walks. Those live here exactly once;
// every domain gate, record validator and sidecar shape stays local to
// its store. Nothing in this module weakens a proof: byte-level CAS,
// snapshot/event-shape/scope revalidation and fail-closed errors are
// preserved verbatim, and no helper adopts plausible files.
//
// NOTE: this module imports journal.mjs and workspaces.mjs, which
// already import each other, so workspaces.mjs -> owned-chain.mjs ->
// workspaces.mjs is a two-module cycle like the existing one. It is
// safe in ESM: every cross-reference executes inside function bodies
// after all modules finish evaluating, and the exported function
// declarations are bound during instantiation.
import crypto from 'node:crypto';
import { err } from './errors.mjs';
import { decodeUtf8Strict, lstatOrNull, readFileLimited } from './fsx.mjs';
import { resolveInside, toCanonicalRelative } from './paths.mjs';
import { loadLimits } from './policy.mjs';
import { canonicalJSON } from './digests.mjs';
import { resultingSourceRevision, validateRecordTransition }
  from './record-history.mjs';
import {
  assertRecordObject, cloneRecordJSON, isRecordTime, isRecordUUID,
  recordAreaIds, validateRecordScope,
} from './record-ownership-data.mjs';
import {
  authorizeScope, bindWorkspace, resolveWorkspaceState,
} from './workspaces.mjs';
import { getJournalOperation, readJournalSnapshot } from './journal.mjs';

export { authorizeScope, resolveWorkspaceState, resultingSourceRevision };
export { decodeUtf8Strict };
export { cloneRecordJSON, isRecordTime, isRecordUUID, recordAreaIds,
  validateRecordScope, assertRecordObject };

export function sha256Hex(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

// The single document serializer: JSON pretty-printed with a trailing
// newline, bounded by the shared document limit.
export function ownedDocumentBytes(value, label) {
  return boundedOwnedBytes(
    Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8'), label);
}

export function boundedOwnedBytes(bytes, label) {
  if (bytes.length > loadLimits().maxDocumentBytes) {
    throw err('DOCUMENT_TOO_LARGE', `${label} exceeds document limit`);
  }
  return bytes;
}

// Strict sidecar bytes -> parsed JSON. Non-roundtrippable UTF-8 and
// non-JSON both fail closed under the caller's malformed code.
export function parseOwnedJson(bytes, code, label) {
  let parsed;
  try {
    parsed = JSON.parse(decodeUtf8Strict(bytes, code, label));
  } catch (e) {
    if (e && e.code === code) throw e;
    throw err(code, `${label} is not JSON`);
  }
  return parsed;
}

// The scope every journal event carries, for canonical comparison with
// the sidecar's stored scope.
export function eventScope(event) {
  return {
    workspaceId: event.workspaceId, projectId: event.projectId,
    repositoryId: event.repositoryId, areaIds: event.areaIds,
  };
}

export function eventScopeJson(event) {
  return canonicalJSON(eventScope(event));
}

// Bounded current-file read under a revalidated binding: containment,
// regular file, document limit. `missingCode` selects the absent-file
// code; `nonRegularCode` the not-a-file code. A null missingCode returns
// null instead of throwing (pointer-style readers where absence is a
// legitimate state, never a silent adoption).
export function readOwnedCurrent(bound, rel, options) {
  const { missingCode, nonRegularCode, label } = options;
  const { projectRoot } = resolveWorkspaceState(bound);
  const abs = resolveInside(projectRoot, rel, `${label} file`);
  const st = lstatOrNull(abs);
  if (!st) {
    if (missingCode === null) return null;
    throw err(missingCode, `${label} file not found: ${rel}`);
  }
  if (!st.isFile()) {
    throw err(nonRegularCode, `${label} file is not regular: ${rel}`);
  }
  const limited = readFileLimited(abs, loadLimits().maxDocumentBytes);
  if (limited.exceeded) {
    throw err('DOCUMENT_TOO_LARGE', `${label} file exceeds limit: ${rel}`);
  }
  return limited.content;
}

// Shared store-construction gate: a resolved context, the closed
// { areaIds } options object and an authentic binding over a privately
// cloned config. Store callers keep their own input code and labels.
export function bindOwnedStore(ctx, options, code, label) {
  if (ctx === null || typeof ctx !== 'object'
      || typeof ctx.projectRoot !== 'string'
      || ctx.config === null || typeof ctx.config !== 'object') {
    throw err(code, `${label} requires a resolved context`);
  }
  assertRecordObject(options, ['areaIds'], ['areaIds'], code,
    `${label} options`);
  const areaIds = recordAreaIds(options.areaIds, code, `${label} options`);
  const privateCtx = { projectRoot: ctx.projectRoot,
    config: structuredClone(ctx.config) };
  const bound = bindWorkspace(privateCtx, { areaIds });
  return { privateCtx, bound, areaIds };
}

// The scope object every store derives from its binding: same field set,
// caller-owned areaIds copy.
export function ownedScope(bound, areaIds) {
  return {
    workspaceId: bound.workspaceId, projectId: bound.projectId,
    repositoryId: bound.repositoryId, areaIds: [...areaIds],
  };
}

// Closed { areaIds, <payloadKey> } input normalization shared by the
// create/update DTOs: areas sorted unique, the payload cloned to plain
// JSON before any IO so caller mutation cannot alter it.
export function normalizeOwnedInput(input, payloadKey, code, label) {
  assertRecordObject(input, ['areaIds', payloadKey],
    ['areaIds', payloadKey], code, label);
  return {
    areaIds: recordAreaIds(input.areaIds, code, label).sort(),
    [payloadKey]: cloneRecordJSON(input[payloadKey]),
  };
}

// Dense prototype-exact array, mirroring record-ownership-data's rule:
// subclasses, holes, extra properties and accessors are rejected.
export function assertDenseRecordArray(value, code, label) {
  if (!Array.isArray(value) || !value.length
      || Object.getPrototypeOf(value) !== Array.prototype
      || Object.getOwnPropertySymbols(value).length
      || Object.getOwnPropertyNames(value).length !== value.length + 1) {
    throw err(code, `${label} must be a non-empty dense array`);
  }
  for (let i = 0; i < value.length; i += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !descriptor.enumerable
        || !Object.hasOwn(descriptor, 'value')) {
      throw err(code, `${label} must contain only values`);
    }
  }
}

// Closed mutable ownership sidecar with a dense operation index:
// base nine fields + the caller's index key (`chain` or `operations`)
// + optional `updatedAt`. The index is revision-addressed:
// index[k] produced revision k, index.at(-1) === operationId and
// index.length === sourceRevision + 1.
// spec: { sourceKind, recordIdOk, indexKey, updatedAt?, indexUnique?,
//         maxRevision?, code, label }
export function validateChainOwnership(value, spec) {
  const keys = ['schemaVersion', 'sourceKind', 'recordId', 'sourceRevision',
    'sourceRel', 'sourceHash', 'operationId', 'scope', 'createdAt',
    spec.indexKey, ...(spec.updatedAt ? ['updatedAt'] : [])];
  const code = spec.code;
  const label = spec.label;
  assertRecordObject(value, keys, keys, code, label);
  if (value.schemaVersion !== 1 || value.sourceKind !== spec.sourceKind
      || !spec.recordIdOk(value.recordId)
      || !Number.isSafeInteger(value.sourceRevision)
      || value.sourceRevision < 0
      || (spec.maxRevision !== undefined
        && spec.maxRevision !== null
        && value.sourceRevision >= spec.maxRevision)
      || typeof value.sourceHash !== 'string'
      || !/^[0-9a-f]{64}$/.test(value.sourceHash)
      || !isRecordUUID(value.operationId)
      || !isRecordTime(value.createdAt)
      || (spec.updatedAt && !isRecordTime(value.updatedAt))) {
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
  const index = value[spec.indexKey];
  assertDenseRecordArray(index, code, `${label} ${spec.indexKey}`);
  if (index.length !== value.sourceRevision + 1
      || !index.every(isRecordUUID)
      || (spec.indexUnique !== false
        && new Set(index).size !== index.length)
      || index[index.length - 1] !== value.operationId) {
    throw err(code, `${label} ${spec.indexKey} does not match its revision`);
  }
  return cloneRecordJSON(value);
}

// Committed-op loader: the only journal read a proof performs. An
// uncommitted named operation fails closed under notCommittedCode.
export function requireCommittedOp(bound, operationId, notCommittedCode,
    label) {
  const loaded = getJournalOperation(bound, operationId);
  if (loaded.state !== 'committed') {
    throw err(notCommittedCode, `${label} is not committed`);
  }
  return loaded;
}

// Two-event operation pair: exactly one event per stream naming this
// record, its paths, the op timestamp and (optionally) the stored
// scope. spec: { sourceKind, sidecarKind, recordId, sourceRel,
// sidecarRel, scopeJson?, checkTimes?, code, label }
export function findOwnedPair(loaded, spec) {
  const events = loaded.intent.events;
  if (events.length !== 2) {
    throw err(spec.code, `${spec.label} operation is not two events`);
  }
  const source = events.find((e) => e.sourceKind === spec.sourceKind);
  const sidecar = events.find((e) => e.sourceKind === spec.sidecarKind);
  if (!source || !sidecar
      || source.recordId !== spec.recordId
      || sidecar.recordId !== spec.recordId
      || !sameRecordLocator(source.sourceRel, spec.sourceRel)
      || !sameRecordLocator(sidecar.sourceRel, spec.sidecarRel)
      || (spec.checkTimes !== false
        && (source.createdAt !== loaded.intent.createdAt
          || sidecar.createdAt !== loaded.intent.createdAt))
      || (spec.scopeJson !== undefined && spec.scopeJson !== null
        && (eventScopeJson(source) !== spec.scopeJson
          || eventScopeJson(sidecar) !== spec.scopeJson))) {
    throw err(spec.code, `${spec.label} operation does not prove this record`);
  }
  return { source, sidecar };
}

// State/memory roots are owner-configured and relocatable, so a committed
// event's sourceRel keeps the prefix it was written under. Record
// identity is carried by the trailing <kind-dir>/<recordId> segments; the
// content anchor is the journal snapshot digest, not the prefix.
export function sameRecordLocator(recorded, expected) {
  const tail = (p) => (typeof p === 'string' ? p.split('/').slice(-2).join('/') : '');
  return tail(recorded) !== '' && tail(recorded) === tail(expected);
}

// The first chain entry must be a clean two-create rev0 pair: no prior
// revision, no claimed pre-image hash.
export function assertGenesisPair(source, sidecar, code, label) {
  if (source.operation !== 'create' || sidecar.operation !== 'create'
      || source.sourceRevision !== 0 || sidecar.sourceRevision !== 0
      || source.previousHash !== null || sidecar.previousHash !== null) {
    throw err(code, `${label} owning operation is not a creation`);
  }
}

// Every later entry is a coherent two-update pair chained to the
// previous one on BOTH event streams.
export function assertUpdatePair(previous, current, code, label) {
  if (current.source.operation !== 'update'
      || current.sidecar.operation !== 'update') {
    throw err(code, `${label} revision operation is not an update`);
  }
  validateRecordTransition(previous.source, current.source, code);
  validateRecordTransition(previous.sidecar, current.sidecar, code);
}

// Forward walk over a dense per-record operation index (the `chain` /
// `operations` sidecar field): each referenced operation must be
// committed and prove this record on both streams, chained by revision
// and byte hash from the rev0 create. Yields
// { index, operationId, loaded, source, sidecar, sourceSnapshot,
//   sidecarSnapshot }; the caller re-validates snapshot CONTENT per
// revision (domain shape, prefix equality, byte rebuilds).
// options: findOwnedPair spec + { notCommittedCode, label }
export function* walkOwnedIndex(bound, operationIds, options) {
  let previous = null;
  for (let index = 0; index < operationIds.length; index += 1) {
    const operationId = operationIds[index];
    const loaded = requireCommittedOp(bound, operationId,
      options.notCommittedCode, `${options.label} owning operation`);
    const pair = findOwnedPair(loaded, options);
    if (index === 0) {
      assertGenesisPair(pair.source, pair.sidecar, options.code,
        options.label);
    } else {
      assertUpdatePair(previous, pair, options.code, options.label);
    }
    const sidecarSnapshot = readJournalSnapshot(bound, operationId,
      pair.sidecar.eventId);
    const sourceSnapshot = readJournalSnapshot(bound, operationId,
      pair.source.eventId);
    yield { index, operationId, loaded, ...pair,
      sourceSnapshot, sidecarSnapshot };
    previous = pair;
  }
}

// Backward walk over a chain-head sidecar linked by previousOperationId:
// bounds and cycle checks, committed ops only, the op's sidecar snapshot
// must byte-equal the linked document, both event streams chain with
// validateRecordTransition and each link's parsed document names the
// operation it claims. Yields
// { depth, cursor, cursorBytes, loaded, source, sidecar, isGenesis }
// per hop; `source` is null on a single-event genesis hop.
// options: findOwnedPair spec + { notCommittedCode, maxOps,
//   parseLink(bytes) -> doc, previousIdOf(doc) -> id | null,
//   checkLink?(nextDoc, cursorDoc), singleEventGenesis?, label }
export function* walkOwnedLinked(bound, tip, tipBytes, options) {
  const code = options.code;
  const label = options.label;
  const maxOps = options.maxOps ?? loadLimits().maxSessionEvents + 1;
  const seen = new Set();
  let cursor = tip;
  let cursorBytes = tipBytes;
  for (let depth = 0; ; depth += 1) {
    if (depth >= maxOps) {
      throw err(code, `${label} chain exceeds bounds`);
    }
    if (seen.has(cursor.operationId)) {
      throw err(code, `${label} chain contains a cycle`);
    }
    seen.add(cursor.operationId);
    const loaded = getJournalOperation(bound, cursor.operationId);
    if (loaded.state !== 'committed') {
      throw err(options.notCommittedCode,
        `${label} chain operation is not committed`);
    }
    const previousId = options.previousIdOf(cursor);
    const isGenesis = previousId === null;
    const events = loaded.intent.events;
    let source = null;
    let sidecar = null;
    if (isGenesis && options.singleEventGenesis) {
      // Single-event enrollment ops (the workspace pointer genesis) have
      // no source event: the sidecar event alone is the chain anchor.
      if (events.length !== 1) {
        throw err(code, `${label} operation is not one event`);
      }
      [sidecar] = events;
      if (sidecar.sourceKind !== options.sidecarKind
          || sidecar.operation !== 'create'
          || sidecar.recordId !== options.recordId
          || !sameRecordLocator(sidecar.sourceRel, options.sidecarRel)) {
        throw err(code, `${label} operation does not prove this record`);
      }
    } else {
      ({ source, sidecar } = findOwnedPair(loaded, options));
    }
    // The op's sidecar snapshot must reproduce the linked document.
    const sidecarSnapshot = readJournalSnapshot(bound, cursor.operationId,
      sidecar.eventId);
    if (!sidecarSnapshot.equals(cursorBytes)) {
      throw err(code, `${label} snapshot differs from the chain`);
    }
    let next = null;
    let nextBytes = null;
    if (!isGenesis) {
      const previous = getJournalOperation(bound, previousId);
      if (previous.state !== 'committed') {
        throw err(options.notCommittedCode,
          `${label} chain operation is not committed`);
      }
      let prevPair;
      if (options.singleEventGenesis
          && previous.intent.events.length === 1) {
        const [event] = previous.intent.events;
        if (event.sourceKind !== options.sidecarKind) {
          throw err(code, `${label} operation does not prove this record`);
        }
        prevPair = { source: null, sidecar: event };
      } else {
        prevPair = findOwnedPair(previous, options);
      }
      if (prevPair.source !== null && source !== null) {
        validateRecordTransition(prevPair.source, source, code);
      }
      validateRecordTransition(prevPair.sidecar, sidecar, code);
      nextBytes = readJournalSnapshot(bound, previousId,
        prevPair.sidecar.eventId);
      next = options.parseLink(nextBytes);
      if (next.operationId !== previousId) {
        throw err(code, `${label} link does not match this record`);
      }
      if (options.checkLink) options.checkLink(next, cursor);
    }
    yield { depth, cursor, cursorBytes, loaded, source, sidecar,
      isGenesis };
    if (isGenesis) break;
    cursor = next;
    cursorBytes = nextBytes;
  }
}
