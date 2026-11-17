// Pure helpers for journaled mutable-record updates. No filesystem,
// policy loads, bindings or remote calls: these validators shape update
// changes and verify revision/hash chain coherence for history readers.
// The kernel enforces byte-CAS (previousHash) under the journal lock;
// the declared sourceRevision is provenance metadata - the journal keeps
// no per-record index, so chain coherence is a read-model check.
import { err } from './errors.mjs';
import { assertRecordObject } from './record-ownership-data.mjs';

const HASH = /^[0-9a-f]{64}$/;
const KIND = /^[a-z][a-z0-9-]{0,63}$/;
const RECORD = /^[a-z0-9][a-z0-9-]{0,127}$/;
const JOURNAL_OPERATIONS = ['create', 'update'];
const FILE_KEYS = ['rel', 'content'];

// Closed update change shape: same fields as a create change plus the
// required previousHash; sourceRevision is the expected CURRENT revision
// and may not be null (null is create semantics).
export const UPDATE_CHANGE_KEYS = [
  'sourceKind', 'recordId', 'sourceRevision', 'previousHash', 'areaIds', 'file',
];

function hash(value) {
  return typeof value === 'string' && HASH.test(value);
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

export function isJournalOperation(value) {
  return JOURNAL_OPERATIONS.includes(value);
}

// The revision a journaled event produces: create keeps its declared
// sourceRevision (normally 0), update produces expected + 1.
export function resultingSourceRevision(event, code = 'INVALID_JOURNAL_INPUT') {
  if (event === null || typeof event !== 'object' || Array.isArray(event)
      || !isJournalOperation(event.operation)) {
    throw err(code, 'journal event operation must be create or update');
  }
  if (event.operation === 'create') return event.sourceRevision;
  if (!Number.isSafeInteger(event.sourceRevision) || event.sourceRevision < 0) {
    throw err(code, 'update event requires an expected source revision');
  }
  return event.sourceRevision + 1;
}

// Closed-shape update change validator: keys, kind/id patterns, int>=0
// expected revision, sha256 previousHash and string|Buffer content.
// Authorization, path containment and size bounds stay in journal.mjs.
export function validateUpdateChange(value, code = 'INVALID_JOURNAL_INPUT',
    label = 'journal update') {
  assertRecordObject(value, UPDATE_CHANGE_KEYS, UPDATE_CHANGE_KEYS, code, label);
  assertRecordObject(value.file, FILE_KEYS, FILE_KEYS, code, `${label} file`);
  if (typeof value.sourceKind !== 'string' || !KIND.test(value.sourceKind)
      || typeof value.recordId !== 'string' || !RECORD.test(value.recordId)
      || !Number.isSafeInteger(value.sourceRevision) || value.sourceRevision < 0
      || !hash(value.previousHash)
      || (typeof value.file.content !== 'string'
        && !Buffer.isBuffer(value.file.content))) {
    throw err(code, `${label} has invalid fields`);
  }
  dense(value.areaIds, code, `${label} areaIds`);
}

// Chain coherence for history readers: an update event must name the
// same record, expect the revision the previous event produced and hash
// to the previous event's source bytes. A fork or gap is invalid input,
// never a reinterpreted branch.
export function validateRecordTransition(previousEvent, updateEvent,
    code = 'INVALID_JOURNAL_INPUT') {
  if (previousEvent === null || typeof previousEvent !== 'object'
      || Array.isArray(previousEvent)
      || updateEvent === null || typeof updateEvent !== 'object'
      || Array.isArray(updateEvent)
      || !isJournalOperation(previousEvent.operation)
      || updateEvent.operation !== 'update'
      || previousEvent.sourceKind !== updateEvent.sourceKind
      || previousEvent.recordId !== updateEvent.recordId
      || updateEvent.sourceRevision !== resultingSourceRevision(previousEvent, code)
      || updateEvent.previousHash !== previousEvent.sourceHash) {
    throw err(code, 'update event does not chain to the previous record event');
  }
}
