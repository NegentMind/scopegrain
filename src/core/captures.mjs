// Bound capture store: typed, scoped, immutable capture notes plus their
// ownership companion, created in one recoverable journal operation.
// A note is a supplied assertion — not proof of activity, an authenticated
// identity or an authorization. The creation protocol lives in
// owned-store.mjs; this module declares capture domain rules: note shape,
// provenance and supersession.
import crypto from 'node:crypto';
import { err } from './errors.mjs';
import { canonicalJSON } from './digests.mjs';
import { assertDestination } from './paths.mjs';
import {
  normalizeCaptureInput, validateCaptureNote, validateCaptureOwnership,
  validateCaptureStoreOptions,
} from './capture-data.mjs';
import { createOwnedRecordStore } from './owned-store.mjs';

const PROOF_CODES = { missing: 'CAPTURE_NOT_FOUND',
  malformed: 'CAPTURE_MALFORMED', notCommitted: 'CAPTURE_NOT_COMMITTED',
  sourceChanged: 'CAPTURE_SOURCE_CHANGED' };

function malformed(message) {
  throw err('CAPTURE_MALFORMED', message);
}

const SPEC = {
  storeLabel: 'capture',
  inputCode: 'INVALID_CAPTURE_INPUT',
  malformedCode: 'CAPTURE_MALFORMED',
  proofCodes: PROOF_CODES,
  sourceKind: 'capture',
  sourceLabel: 'capture',
  idLabel: 'capture recordId',
  validateOptions: validateCaptureStoreOptions,
  normalizeInput: normalizeCaptureInput,
  sourceDirRel: (ctx) =>
    `${assertDestination(ctx.config.paths.memory, 'paths.memory')}/captures`,
  validateOwnership: validateCaptureOwnership,
  decodeRecord: (_ctx, parsed) => validateCaptureNote(parsed),
  checkRecord(_ctx, record, owned, recordId) {
    if (record.id !== recordId || record.capturedAt !== owned.createdAt
        || canonicalJSON(record.scope) !== canonicalJSON(owned.scope)) {
      malformed('capture note does not match its proof');
    }
  },
  // Supersession: predecessor must be a proven current record of the same
  // category, subject and exact area set; an inferred preference can never
  // supersede a declared one. The old files are never altered.
  precheck(normalized, get) {
    if (normalized.supersedes === null) return;
    const prior = get(normalized.supersedes).record;
    const sameAreas = prior.scope.areaIds.length === normalized.areaIds.length
      && prior.scope.areaIds.every((id, i) => id === normalized.areaIds[i]);
    if (prior.category !== normalized.category
        || prior.subjectId !== normalized.subjectId || !sameAreas) {
      throw err('CAPTURE_SUPERSESSION_CONFLICT',
        'capture predecessor does not match category, subject or areas');
    }
    if (prior.category === 'preference' && prior.provenance.basis === 'declared'
        && normalized.basis === 'inferred') {
      throw err('CAPTURE_SUPERSESSION_CONFLICT',
        'an inferred preference cannot supersede a declared one');
    }
  },
  buildSource(_ctx, normalized, identity, h) {
    const recordId = crypto.randomUUID();
    const record = validateCaptureNote({
      schemaVersion: 1, kind: 'scopegrain.capture', id: recordId, revision: 0,
      category: normalized.category, title: normalized.title,
      summary: normalized.summary, scope: h.scope(normalized.areaIds),
      provenance: { basis: normalized.basis, origin: h.opts.origin },
      subjectId: normalized.subjectId, supersedes: normalized.supersedes,
      capturedAt: identity.createdAt,
    });
    const sourceBytes = h.documentBytes(record, 'capture source');
    return { record, sourceRel: h.sourceRelFor(recordId), sourceBytes };
  },
};

export function createCaptureStore(ctx, options) {
  return createOwnedRecordStore(ctx, options, SPEC);
}
