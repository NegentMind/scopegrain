// SPDX-License-Identifier: Apache-2.0
// Pure closed data contracts for selective capture notes. No filesystem,
// policy loads or remote calls: these validators shape data and return
// independent JSON-safe clones only. Shared record-ownership primitives
// live in record-ownership-data.mjs; this module keeps the capture domain
// codes, labels and contracts.
import { err } from './errors.mjs';
import {
  assertRecordObject, cloneRecordJSON, isRecordTime, isRecordUUID,
  recordAreaIds, validateRecordOwnership, validateRecordScope,
} from './record-ownership-data.mjs';

const ORIGIN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const CATEGORIES = ['decision', 'event', 'attempt', 'discard', 'preference',
  'tool', 'skill', 'stack', 'lesson', 'rule'];
const INPUT_KEYS = ['category', 'title', 'summary', 'areaIds', 'basis',
  'subjectId', 'supersedes'];
const OPTION_KEYS = ['areaIds', 'origin'];
const NOTE_KEYS = ['schemaVersion', 'kind', 'id', 'revision', 'category',
  'title', 'summary', 'scope', 'provenance', 'subjectId', 'supersedes',
  'capturedAt'];
const PROVENANCE_KEYS = ['basis', 'origin'];

function nonblank(value) { return typeof value === 'string' && value.trim() !== ''; }

export function normalizeCaptureInput(input) {
  const code = 'INVALID_CAPTURE_INPUT';
  assertRecordObject(input, INPUT_KEYS, ['category', 'title', 'summary', 'areaIds'],
    code, 'capture input');
  if (!CATEGORIES.includes(input.category)) {
    throw err(code, 'capture input category is not supported');
  }
  if (!nonblank(input.title) || !nonblank(input.summary)) {
    throw err(code, 'capture input title/summary must be nonblank strings');
  }
  const areaIds = recordAreaIds(input.areaIds, code, 'capture input').sort();
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
    if (input.supersedes !== null && !isRecordUUID(input.supersedes)) {
      throw err(code, 'capture input supersedes must be null or a UUID');
    }
    supersedes = input.supersedes;
  }
  if (input.category === 'preference' && !nonblank(subjectId)) {
    throw err(code, 'preference captures require a nonblank subjectId');
  }
  return cloneRecordJSON({ category: input.category, title: input.title,
    summary: input.summary, areaIds, basis, subjectId, supersedes });
}

export function validateCaptureStoreOptions(options) {
  const code = 'INVALID_CAPTURE_INPUT';
  assertRecordObject(options, OPTION_KEYS, OPTION_KEYS, code, 'capture store options');
  if (typeof options.origin !== 'string' || !ORIGIN.test(options.origin)) {
    throw err(code, 'capture store options origin is invalid');
  }
  return cloneRecordJSON({ areaIds: recordAreaIds(options.areaIds, code,
    'capture store options'), origin: options.origin });
}

export function validateCaptureNote(value) {
  const code = 'CAPTURE_MALFORMED';
  assertRecordObject(value, NOTE_KEYS, NOTE_KEYS, code, 'capture note');
  if (value.schemaVersion !== 1 || value.kind !== 'scopegrain.capture'
      || !isRecordUUID(value.id) || value.revision !== 0
      || !CATEGORIES.includes(value.category)
      || !nonblank(value.title) || !nonblank(value.summary)
      || (value.subjectId !== null && !nonblank(value.subjectId))
      || (value.category === 'preference' && !nonblank(value.subjectId))
      || (value.supersedes !== null && !isRecordUUID(value.supersedes))
      || value.supersedes === value.id || !isRecordTime(value.capturedAt)) {
    throw err(code, 'capture note has invalid fields');
  }
  validateRecordScope(value.scope, code, 'capture scope');
  assertRecordObject(value.provenance, PROVENANCE_KEYS, PROVENANCE_KEYS, code,
    'capture provenance');
  if (!['declared', 'inferred'].includes(value.provenance.basis)
      || typeof value.provenance.origin !== 'string'
      || !ORIGIN.test(value.provenance.origin)) {
    throw err(code, 'capture provenance has invalid fields');
  }
  return cloneRecordJSON(value);
}

export function validateCaptureOwnership(value) {
  return validateRecordOwnership(value, 'capture', {
    code: 'CAPTURE_MALFORMED', label: 'capture ownership',
    scopeLabel: 'capture scope',
  });
}
