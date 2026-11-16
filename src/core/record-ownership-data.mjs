// Pure shared primitives for record-ownership sidecars. No filesystem,
// policy loads or remote calls: these validators shape data and return
// independent JSON-safe clones only. Capture keeps its domain codes and
// labels by passing them in; defaults are the neutral record-ownership
// wording.
import { err } from './errors.mjs';
import { canonicalJSON } from './digests.mjs';
import { toCanonicalRelative } from './paths.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const SCOPE_KEYS = ['workspaceId', 'projectId', 'repositoryId', 'areaIds'];
const OWNERSHIP_KEYS = ['schemaVersion', 'sourceKind', 'recordId',
  'sourceRevision', 'sourceRel', 'sourceHash', 'operationId', 'scope',
  'createdAt'];
const OWNERSHIP_KINDS = ['capture', 'spec'];

export function assertRecordObject(value, keys, required, code, label) {
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

// Dense prototype-exact array: subclasses, holes, non-index properties,
// accessors and non-enumerable indices are rejected without invoking them.
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

export function isRecordUUID(value) {
  return typeof value === 'string' && UUID.test(value);
}

export function isRecordTime(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    && new Date(Date.parse(value)).toISOString() === value;
}

export function cloneRecordJSON(value) {
  return JSON.parse(canonicalJSON(value));
}

// Non-empty dense array of distinct lower-case UUIDs. Returns a clone in
// input order - sorting is the caller's normalization choice, not implied.
export function recordAreaIds(value, code, label) {
  dense(value, code, `${label}.areaIds`);
  const result = [];
  for (const item of value) {
    if (!isRecordUUID(item)) {
      throw err(code, `${label}.areaIds entries must be UUIDs`);
    }
    result.push(item);
  }
  if (new Set(result).size !== result.length) {
    throw err(code, `${label}.areaIds must not repeat`);
  }
  return result;
}

export function validateRecordScope(value, code, label) {
  assertRecordObject(value, SCOPE_KEYS, SCOPE_KEYS, code, label);
  if (!isRecordUUID(value.workspaceId) || !isRecordUUID(value.projectId)
      || !isRecordUUID(value.repositoryId)) {
    throw err(code, `${label} identifiers must be UUIDs`);
  }
  recordAreaIds(value.areaIds, code, label);
}

// Closed nine-field ownership sidecar: capture/spec revision0 only. The
// source kind must equal expectedKind exactly - cross-kind sidecars are
// malformed, never reinterpreted.
export function validateRecordOwnership(value, expectedKind, options = {}) {
  const code = options.code ?? 'RECORD_OWNERSHIP_MALFORMED';
  const label = options.label ?? 'record ownership';
  const scopeLabel = options.scopeLabel ?? 'record scope';
  assertRecordObject(value, OWNERSHIP_KEYS, OWNERSHIP_KEYS, code, label);
  if (!OWNERSHIP_KINDS.includes(expectedKind)
      || value.schemaVersion !== 1 || value.sourceKind !== expectedKind
      || !isRecordUUID(value.recordId) || value.sourceRevision !== 0
      || typeof value.sourceHash !== 'string' || !HASH.test(value.sourceHash)
      || !isRecordUUID(value.operationId)
      || !isRecordTime(value.createdAt)) {
    throw err(code, `${label} has invalid fields`);
  }
  let rel;
  try {
    if (typeof value.sourceRel !== 'string' || value.sourceRel.includes('\\')) {
      throw err(code, `${label} sourceRel must be canonical POSIX`);
    }
    rel = toCanonicalRelative(value.sourceRel, `${label} sourceRel`);
  } catch {
    throw err(code, `${label} sourceRel is not a canonical relative path`);
  }
  if (rel !== value.sourceRel) {
    throw err(code, `${label} sourceRel is not canonical`);
  }
  validateRecordScope(value.scope, code, scopeLabel);
  return cloneRecordJSON(value);
}
