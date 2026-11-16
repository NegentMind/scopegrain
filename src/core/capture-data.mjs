// Pure closed data contracts for selective capture notes. No filesystem,
// policy loads or remote calls: these validators shape data and return
// independent JSON-safe clones only.
import { err } from './errors.mjs';
import { canonicalJSON } from './digests.mjs';
import { toCanonicalRelative } from './paths.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const ORIGIN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const CATEGORIES = ['decision', 'event', 'attempt', 'discard', 'preference',
  'tool', 'skill', 'stack', 'lesson'];
const INPUT_KEYS = ['category', 'title', 'summary', 'areaIds', 'basis',
  'subjectId', 'supersedes'];
const OPTION_KEYS = ['areaIds', 'origin'];
const NOTE_KEYS = ['schemaVersion', 'kind', 'id', 'revision', 'category',
  'title', 'summary', 'scope', 'provenance', 'subjectId', 'supersedes',
  'capturedAt'];
const SCOPE_KEYS = ['workspaceId', 'projectId', 'repositoryId', 'areaIds'];
const PROVENANCE_KEYS = ['basis', 'origin'];
const OWNERSHIP_KEYS = ['schemaVersion', 'sourceKind', 'recordId',
  'sourceRevision', 'sourceRel', 'sourceHash', 'operationId', 'scope',
  'createdAt'];

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

function uuid(value) { return typeof value === 'string' && UUID.test(value); }
function hash(value) { return typeof value === 'string' && HASH.test(value); }
function nonblank(value) { return typeof value === 'string' && value.trim() !== ''; }
function isoTime(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    && new Date(Date.parse(value)).toISOString() === value;
}

function jsonClone(value) {
  return JSON.parse(canonicalJSON(value));
}

function areaSet(value, code, label) {
  dense(value, code, `${label}.areaIds`);
  const result = [];
  for (const item of value) {
    if (!uuid(item)) throw err(code, `${label}.areaIds entries must be UUIDs`);
    result.push(item);
  }
  if (new Set(result).size !== result.length) {
    throw err(code, `${label}.areaIds must not repeat`);
  }
  return result;
}

function scope(value, code) {
  plain(value, SCOPE_KEYS, SCOPE_KEYS, code, 'capture scope');
  if (!uuid(value.workspaceId) || !uuid(value.projectId)
      || !uuid(value.repositoryId)) {
    throw err(code, 'capture scope identifiers must be UUIDs');
  }
  areaSet(value.areaIds, code, 'capture scope');
}

export function normalizeCaptureInput(input) {
  const code = 'INVALID_CAPTURE_INPUT';
  plain(input, INPUT_KEYS, ['category', 'title', 'summary', 'areaIds'],
    code, 'capture input');
  if (!CATEGORIES.includes(input.category)) {
    throw err(code, 'capture input category is not supported');
  }
  if (!nonblank(input.title) || !nonblank(input.summary)) {
    throw err(code, 'capture input title/summary must be nonblank strings');
  }
  const areaIds = areaSet(input.areaIds, code, 'capture input').sort();
  let basis = 'inferred';
  let subjectId = null;
  let supersedes = null;
  if (Object.hasOwn(input, 'basis')) {
    if (!['declared', 'inferred'].includes(input.basis)) {
      throw err(code, 'capture input basis must be declared or inferred');
    }
    basis = input.basis;
  }
  if (Object.hasOwn(input, 'subjectId')) {
    if (input.subjectId !== null && !nonblank(input.subjectId)) {
      throw err(code, 'capture input subjectId must be null or nonblank');
    }
    subjectId = input.subjectId;
  }
  if (Object.hasOwn(input, 'supersedes')) {
    if (input.supersedes !== null && !uuid(input.supersedes)) {
      throw err(code, 'capture input supersedes must be null or a UUID');
    }
    supersedes = input.supersedes;
  }
  if (input.category === 'preference' && !nonblank(subjectId)) {
    throw err(code, 'preference captures require a nonblank subjectId');
  }
  return jsonClone({ category: input.category, title: input.title,
    summary: input.summary, areaIds, basis, subjectId, supersedes });
}

export function validateCaptureStoreOptions(options) {
  const code = 'INVALID_CAPTURE_INPUT';
  plain(options, OPTION_KEYS, OPTION_KEYS, code, 'capture store options');
  if (typeof options.origin !== 'string' || !ORIGIN.test(options.origin)) {
    throw err(code, 'capture store options origin is invalid');
  }
  return jsonClone({ areaIds: areaSet(options.areaIds, code, 'capture store options'),
    origin: options.origin });
}

export function validateCaptureNote(value) {
  const code = 'CAPTURE_MALFORMED';
  plain(value, NOTE_KEYS, NOTE_KEYS, code, 'capture note');
  if (value.schemaVersion !== 1 || value.kind !== 'scopegrain.capture'
      || !uuid(value.id) || value.revision !== 0
      || !CATEGORIES.includes(value.category)
      || !nonblank(value.title) || !nonblank(value.summary)
      || (value.subjectId !== null && !nonblank(value.subjectId))
      || (value.category === 'preference' && !nonblank(value.subjectId))
      || (value.supersedes !== null && !uuid(value.supersedes))
      || value.supersedes === value.id || !isoTime(value.capturedAt)) {
    throw err(code, 'capture note has invalid fields');
  }
  scope(value.scope, code);
  plain(value.provenance, PROVENANCE_KEYS, PROVENANCE_KEYS, code,
    'capture provenance');
  if (!['declared', 'inferred'].includes(value.provenance.basis)
      || typeof value.provenance.origin !== 'string'
      || !ORIGIN.test(value.provenance.origin)) {
    throw err(code, 'capture provenance has invalid fields');
  }
  return jsonClone(value);
}

export function validateCaptureOwnership(value) {
  const code = 'CAPTURE_MALFORMED';
  plain(value, OWNERSHIP_KEYS, OWNERSHIP_KEYS, code, 'capture ownership');
  if (value.schemaVersion !== 1 || value.sourceKind !== 'capture'
      || !uuid(value.recordId) || value.sourceRevision !== 0
      || !hash(value.sourceHash) || !uuid(value.operationId)
      || !isoTime(value.createdAt)) {
    throw err(code, 'capture ownership has invalid fields');
  }
  let rel;
  try {
    if (typeof value.sourceRel !== 'string' || value.sourceRel.includes('\\')) {
      throw err(code, 'capture ownership sourceRel must be canonical POSIX');
    }
    rel = toCanonicalRelative(value.sourceRel, 'capture ownership sourceRel');
  } catch {
    throw err(code, 'capture ownership sourceRel is not a canonical relative path');
  }
  if (rel !== value.sourceRel) {
    throw err(code, 'capture ownership sourceRel is not canonical');
  }
  scope(value.scope, code);
  return jsonClone(value);
}
