// Bound capture store: typed, scoped, immutable capture notes plus their
// ownership companion, created in one recoverable journal operation.
// A note is a supplied assertion — not proof of activity, an authenticated
// identity or an authorization. Reads return proven current records only;
// they never adopt plausible files, list history or consult memory backends.
import crypto from 'node:crypto';
import { err } from './errors.mjs';
import { canonicalJSON } from './digests.mjs';
import { assertDestination, resolveInside } from './paths.mjs';
import { loadLimits } from './policy.mjs';
import {
  authorizeScope, bindWorkspace, resolveWorkspaceState,
} from './workspaces.mjs';
import { applyJournaledRecordCreation } from './journal.mjs';
import { readOwnedCreation } from './record-ownership.mjs';
import {
  normalizeCaptureInput, validateCaptureNote, validateCaptureOwnership,
  validateCaptureStoreOptions,
} from './capture-data.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PROOF_CODES = { missing: 'CAPTURE_NOT_FOUND',
  malformed: 'CAPTURE_MALFORMED', notCommitted: 'CAPTURE_NOT_COMMITTED',
  sourceChanged: 'CAPTURE_SOURCE_CHANGED' };

function malformed(message) {
  throw err('CAPTURE_MALFORMED', message);
}

function strictUtf8(bytes, label) {
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) {
    malformed(`stored ${label} is not roundtrippable UTF-8`);
  }
  return text;
}

function documentBytes(value, label) {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8');
  if (bytes.length > loadLimits().maxDocumentBytes) {
    throw err('DOCUMENT_TOO_LARGE', `${label} exceeds document limit`);
  }
  return bytes;
}

export function createCaptureStore(ctx, options) {
  if (ctx === null || typeof ctx !== 'object'
      || typeof ctx.projectRoot !== 'string'
      || ctx.config === null || typeof ctx.config !== 'object') {
    throw err('INVALID_CAPTURE_INPUT', 'capture store requires a resolved context');
  }
  // Options and config are validated/cloned once at construction; the store
  // never consults mutable caller state again.
  const opts = validateCaptureStoreOptions(options);
  const privateCtx = { projectRoot: ctx.projectRoot,
    config: structuredClone(ctx.config) };
  const bound = bindWorkspace(privateCtx, { areaIds: opts.areaIds });
  const memoryRel = assertDestination(privateCtx.config.paths.memory, 'paths.memory');
  const stateRel = assertDestination(privateCtx.config.paths.state, 'paths.state');
  const sourceRelFor = (recordId) => `${memoryRel}/captures/${recordId}.json`;
  const ownershipRelFor = (recordId) =>
    `${stateRel}/record-ownership/capture/${recordId}.json`;

  function scope(areaIds) {
    return { workspaceId: bound.workspaceId, projectId: bound.projectId,
      repositoryId: bound.repositoryId, areaIds: [...areaIds] };
  }

  function note(normalized, recordId, createdAt) {
    return validateCaptureNote({
      schemaVersion: 1, kind: 'scopegrain.capture', id: recordId, revision: 0,
      category: normalized.category, title: normalized.title,
      summary: normalized.summary, scope: scope(normalized.areaIds),
      provenance: { basis: normalized.basis, origin: opts.origin },
      subjectId: normalized.subjectId, supersedes: normalized.supersedes,
      capturedAt: createdAt,
    });
  }

  function ownership(recordId, sourceRel, sourceBytes, identity) {
    return validateCaptureOwnership({
      schemaVersion: 1, sourceKind: 'capture', recordId, sourceRevision: 0,
      sourceRel,
      sourceHash: crypto.createHash('sha256').update(sourceBytes).digest('hex'),
      operationId: identity.operationId, scope: scope(identity.areaIds),
      createdAt: identity.createdAt,
    });
  }

  // Current-record proof delegates to the shared ownership proof; this
  // store retains its UUID gate and the note's id/time/scope equality
  // against the proved ownership. No listing, history fallback or
  // plausible-file adoption.
  function readRecord(recordId) {
    if (typeof recordId !== 'string' || !UUID.test(recordId)) {
      throw err('INVALID_CAPTURE_INPUT', 'capture recordId must be a UUID');
    }
    return readOwnedCreation(bound, {
      sourceKind: 'capture', recordId,
      sourceRel: sourceRelFor(recordId),
      ownershipRel: ownershipRelFor(recordId),
      label: 'capture', codes: PROOF_CODES,
    }, (snapshotBytes, owned) => {
      let stored;
      try {
        stored = JSON.parse(strictUtf8(snapshotBytes, 'note'));
      } catch (e) {
        if (e.code === 'CAPTURE_MALFORMED') throw e;
        malformed('capture snapshot is not JSON');
      }
      const record = validateCaptureNote(stored);
      if (record.id !== recordId || record.capturedAt !== owned.createdAt
          || canonicalJSON(record.scope) !== canonicalJSON(owned.scope)) {
        malformed('capture note does not match its proof');
      }
      return record;
    });
  }

  // Supersession: predecessor must be a proven current record of the same
  // category, subject and exact area set; an inferred preference can never
  // supersede a declared one. The old files are never altered.
  function checkSupersedes(normalized) {
    if (normalized.supersedes === null) return;
    const previous = readRecord(normalized.supersedes);
    const prior = previous.record;
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
  }

  function prepare(input) {
    const normalized = normalizeCaptureInput(input);
    authorizeScope(bound, scope(normalized.areaIds));
    checkSupersedes(normalized);
    const recordId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const record = note(normalized, recordId, createdAt);
    const sourceRel = sourceRelFor(recordId);
    const ownershipRel = ownershipRelFor(recordId);
    // Destinations must resolve safely too: a preview never promises an
    // unsafe path, and the check stays read-only.
    const { projectRoot } = resolveWorkspaceState(bound);
    resolveInside(projectRoot, sourceRel, 'capture source');
    resolveInside(projectRoot, ownershipRel, 'capture ownership');
    const sourceBytes = documentBytes(record, 'capture source');
    documentBytes(ownership(recordId, sourceRel, sourceBytes,
      { operationId: '00000000-0000-0000-0000-000000000000', createdAt,
        areaIds: normalized.areaIds }), 'capture ownership');
    return { mode: 'dry-run', record, sourceRel,
      ownershipRel: ownershipRelFor(recordId), reservesIds: false };
  }

  function create(input) {
    const normalized = normalizeCaptureInput(input);
    authorizeScope(bound, scope(normalized.areaIds));
    checkSupersedes(normalized);
    let built = null;
    const journal = applyJournaledRecordCreation(bound, (identity) => {
      const recordId = crypto.randomUUID();
      const sourceRel = sourceRelFor(recordId);
      const ownershipRel = ownershipRelFor(recordId);
      const record = note(normalized, recordId, identity.createdAt);
      const sourceBytes = documentBytes(record, 'capture source');
      const owned = ownership(recordId, sourceRel, sourceBytes,
        { ...identity, areaIds: normalized.areaIds });
      const sidecarBytes = documentBytes(owned, 'capture ownership');
      built = { record, sourceRel, ownershipRel };
      return [
        { sourceKind: 'capture', recordId, sourceRevision: 0,
          areaIds: [...normalized.areaIds],
          file: { rel: sourceRel, content: sourceBytes } },
        { sourceKind: 'record-ownership', recordId, sourceRevision: 0,
          areaIds: [...normalized.areaIds],
          file: { rel: ownershipRel, content: sidecarBytes } },
      ];
    });
    return { mode: 'applied', record: built.record, sourceRel: built.sourceRel,
      ownershipRel: built.ownershipRel,
      ownershipConfirmed: journal.status === 'committed'
        && journal.journalState === 'confirmed',
      journal };
  }

  function get(recordId) {
    return readRecord(recordId);
  }

  return Object.freeze({ prepare, create, get });
}
