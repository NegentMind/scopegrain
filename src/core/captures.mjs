// Bound capture store: typed, scoped, immutable capture notes plus their
// ownership companion, created in one recoverable journal operation.
// A note is a supplied assertion — not proof of activity, an authenticated
// identity or an authorization. Reads return proven current records only;
// they never adopt plausible files, list history or consult memory backends.
import crypto from 'node:crypto';
import { err } from './errors.mjs';
import { canonicalJSON } from './digests.mjs';
import { lstatOrNull, readFileLimited } from './fsx.mjs';
import { assertDestination, resolveInside } from './paths.mjs';
import { loadLimits } from './policy.mjs';
import {
  authorizeScope, bindWorkspace, resolveWorkspaceState,
} from './workspaces.mjs';
import {
  applyJournaledRecordCreation, getJournalOperation, readJournalSnapshot,
} from './journal.mjs';
import {
  normalizeCaptureInput, validateCaptureNote, validateCaptureOwnership,
  validateCaptureStoreOptions,
} from './capture-data.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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

// Bounded read of a current store file: the binding is revalidated before
// every read, plus containment, no link ancestors, regular file and the
// existing maxDocumentBytes. missing/nonRegular codes are caller-selected
// so source and sidecar keep distinct failure codes.
function readCurrent(bound, rel, nonRegularCode) {
  const { projectRoot } = resolveWorkspaceState(bound);
  const abs = resolveInside(projectRoot, rel, 'capture file');
  const st = lstatOrNull(abs);
  if (!st) throw err('CAPTURE_NOT_FOUND', `capture file not found: ${rel}`);
  if (!st.isFile()) throw err(nonRegularCode, `capture file is not regular: ${rel}`);
  const limited = readFileLimited(abs, loadLimits().maxDocumentBytes);
  if (limited.exceeded) {
    throw err('DOCUMENT_TOO_LARGE', `capture file exceeds limit: ${rel}`);
  }
  return limited.content;
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

  function eventScope(event) {
    return { workspaceId: event.workspaceId, projectId: event.projectId,
      repositoryId: event.repositoryId, areaIds: event.areaIds };
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

  // Current-record proof: exact canonical sidecar, authorized scope, a
  // committed two-event operation, immutable snapshots that match the
  // present bytes, then current source bytes that match the snapshot.
  // No listing, history fallback or plausible-file adoption.
  function readRecord(recordId) {
    if (typeof recordId !== 'string' || !UUID.test(recordId)) {
      throw err('INVALID_CAPTURE_INPUT', 'capture recordId must be a UUID');
    }
    const ownershipRel = ownershipRelFor(recordId);
    const sidecarBytes = readCurrent(bound, ownershipRel, 'CAPTURE_MALFORMED');
    let parsed;
    try {
      parsed = JSON.parse(strictUtf8(sidecarBytes, 'ownership'));
    } catch (e) {
      if (e.code === 'CAPTURE_MALFORMED') throw e;
      malformed('capture ownership is not JSON');
    }
    const owned = validateCaptureOwnership(parsed);
    const sourceRel = sourceRelFor(recordId);
    if (owned.recordId !== recordId || owned.sourceRel !== sourceRel) {
      malformed('capture ownership does not name this record');
    }
    // Grants are validated before any record content is produced.
    authorizeScope(bound, owned.scope);
    const loaded = getJournalOperation(bound, owned.operationId);
    if (loaded.state !== 'committed') {
      throw err('CAPTURE_NOT_COMMITTED',
        'capture owning operation is not committed');
    }
    const events = loaded.intent.events;
    if (events.length !== 2) malformed('capture operation is not two events');
    const capture = events.find((e) => e.sourceKind === 'capture');
    const sidecar = events.find((e) => e.sourceKind === 'record-ownership');
    const scopeJson = canonicalJSON(owned.scope);
    if (!capture || !sidecar
        || capture.recordId !== recordId || sidecar.recordId !== recordId
        || capture.sourceRevision !== 0 || sidecar.sourceRevision !== 0
        || capture.operation !== 'create' || sidecar.operation !== 'create'
        || capture.sourceRel !== sourceRel || sidecar.sourceRel !== ownershipRel
        || capture.createdAt !== owned.createdAt
        || sidecar.createdAt !== owned.createdAt
        || loaded.intent.createdAt !== owned.createdAt
        || canonicalJSON(eventScope(capture)) !== scopeJson
        || canonicalJSON(eventScope(sidecar)) !== scopeJson) {
      malformed('capture operation does not prove this record');
    }
    const sidecarSnapshot = readJournalSnapshot(bound, owned.operationId,
      sidecar.eventId);
    if (!sidecarSnapshot.equals(sidecarBytes)) {
      malformed('current capture ownership differs from its snapshot');
    }
    if (owned.sourceHash !== capture.sourceHash) {
      malformed('capture ownership hash differs from the capture event');
    }
    const sourceSnapshot = readJournalSnapshot(bound, owned.operationId,
      capture.eventId);
    let stored;
    try {
      stored = JSON.parse(strictUtf8(sourceSnapshot, 'note'));
    } catch (e) {
      if (e.code === 'CAPTURE_MALFORMED') throw e;
      malformed('capture snapshot is not JSON');
    }
    const record = validateCaptureNote(stored);
    if (record.id !== recordId || record.capturedAt !== capture.createdAt
        || canonicalJSON(record.scope) !== scopeJson) {
      malformed('capture note does not match its proof');
    }
    const current = readCurrent(bound, sourceRel, 'CAPTURE_SOURCE_CHANGED');
    if (!current.equals(sourceSnapshot)) {
      throw err('CAPTURE_SOURCE_CHANGED',
        'current capture source differs from its snapshot');
    }
    return { record, ownership: owned,
      locator: { operationId: owned.operationId, eventId: capture.eventId },
      isCurrentSource: true, memoryConsulted: false };
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
