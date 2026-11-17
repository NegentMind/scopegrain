// Bound owned-outcome store: immutable structured V2 outcome reports
// plus their ownership companion, created in one recoverable journal
// operation. Logical grant areas live in the sidecar and journal events
// and are never derived from paths. Ownership proves a scoped kernel
// creation, not an authenticated identity, original-request authenticity
// or active truth. Reads return proven current report bytes only: they
// never adopt plausible files, list history, consult memory backends or
// re-evaluate whether the bound task is still current - methodology
// gates keep that responsibility.
import crypto from 'node:crypto';
import { err } from './errors.mjs';
import { assertDestination, resolveInside } from './paths.mjs';
import { loadLimits } from './policy.mjs';
import {
  authorizeScope, bindWorkspace, resolveWorkspaceState,
} from './workspaces.mjs';
import { applyJournaledRecordCreation } from './journal.mjs';
import { readOwnedCreation } from './record-ownership.mjs';
import {
  assertRecordObject, cloneRecordJSON, isRecordUUID, recordAreaIds,
  validateRecordOwnership,
} from './record-ownership-data.mjs';
import {
  artifactDirRel, validateArtifactDocument, validateArtifactShape,
} from './artifacts.mjs';
import { prepareOutcomeEvidence } from './outcomes.mjs';

const OPTION_KEYS = ['areaIds'];
const INPUT_KEYS = ['areaIds', 'outcome'];
const PROOF_CODES = { missing: 'OWNED_OUTCOME_NOT_FOUND',
  malformed: 'OWNED_OUTCOME_MALFORMED',
  notCommitted: 'OWNED_OUTCOME_NOT_COMMITTED',
  sourceChanged: 'OWNED_OUTCOME_SOURCE_CHANGED' };
const INPUT = 'INVALID_OWNED_OUTCOME_INPUT';

function malformed(message) {
  throw err('OWNED_OUTCOME_MALFORMED', message);
}

function strictUtf8(bytes, label) {
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) {
    malformed(`stored ${label} is not roundtrippable UTF-8`);
  }
  return text;
}

function boundedBytes(bytes, label) {
  if (bytes.length > loadLimits().maxDocumentBytes) {
    throw err('DOCUMENT_TOO_LARGE', `${label} exceeds document limit`);
  }
  return bytes;
}

function documentBytes(value, label) {
  return boundedBytes(
    Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8'), label);
}

export function createOwnedOutcomeStore(ctx, options) {
  if (ctx === null || typeof ctx !== 'object'
      || typeof ctx.projectRoot !== 'string'
      || ctx.config === null || typeof ctx.config !== 'object') {
    throw err(INPUT,
      'owned outcome store requires a resolved context');
  }
  // Options and config are validated/cloned once at construction; the store
  // never consults mutable caller state again. There is no origin option:
  // the artifact and sidecar schemas have nowhere to store one, and a
  // silently dropped field would hide caller intent.
  assertRecordObject(options, OPTION_KEYS, OPTION_KEYS, INPUT,
    'owned outcome store options');
  const opts = { areaIds: recordAreaIds(options.areaIds, INPUT,
    'owned outcome store options') };
  const privateCtx = { projectRoot: ctx.projectRoot,
    config: structuredClone(ctx.config) };
  const bound = bindWorkspace(privateCtx, { areaIds: opts.areaIds });
  const reportsRel = artifactDirRel(privateCtx, 'report');
  const stateRel = assertDestination(privateCtx.config.paths.state,
    'paths.state');
  const sourceRelFor = (recordId) => `${reportsRel}/${recordId}.json`;
  const ownershipRelFor = (recordId) =>
    `${stateRel}/record-ownership/report/${recordId}.json`;

  function scope(areaIds) {
    return { workspaceId: bound.workspaceId, projectId: bound.projectId,
      repositoryId: bound.repositoryId, areaIds: [...areaIds] };
  }

  // Closed outer DTO: record areas are sorted/unique for the canonical
  // scope; the outcome is cloned to plain JSON before any IO so a mutated
  // caller object cannot alter the validated record.
  function normalizeInput(input) {
    assertRecordObject(input, INPUT_KEYS, INPUT_KEYS, INPUT,
      'owned outcome input');
    const areaIds = recordAreaIds(input.areaIds, INPUT,
      'owned outcome input').sort();
    return { areaIds, outcome: cloneRecordJSON(input.outcome) };
  }

  function ownership(recordId, sourceRel, sourceBytes, identity, areaIds) {
    return validateRecordOwnership({
      schemaVersion: 1, sourceKind: 'report', recordId, sourceRevision: 0,
      sourceRel,
      sourceHash: crypto.createHash('sha256').update(sourceBytes).digest('hex'),
      operationId: identity.operationId, scope: scope(areaIds),
      createdAt: identity.createdAt,
    }, 'report', { code: 'OWNED_OUTCOME_MALFORMED',
      label: 'outcome ownership', scopeLabel: 'outcome scope' });
  }

  // The proved snapshot bytes are validated through the shared artifact
  // helper - never reread through getArtifact after the proof, which would
  // open a read race. A structurally valid V1 report under a genuine
  // committed proof is still rejected: only structured V2 outcome reports
  // carry typed data. No task or binding lookup happens here - the read
  // proves report bytes and provenance, not current task currency or
  // ACCEPT eligibility.
  function inspectSource(recordId, snapshotBytes, owned) {
    let parsed;
    try {
      parsed = JSON.parse(strictUtf8(snapshotBytes, 'outcome source'));
    } catch (e) {
      if (e.code === 'OWNED_OUTCOME_MALFORMED') throw e;
      malformed('outcome snapshot is not JSON');
    }
    const record = validateArtifactDocument(privateCtx, parsed, 'report',
      `outcome ${recordId}`);
    if (record.schemaVersion !== 2 || record.data === undefined) {
      malformed('outcome is not a structured V2 report');
    }
    if (record.id !== recordId || record.createdAt !== owned.createdAt) {
      malformed('outcome document does not match its proof');
    }
    return record;
  }

  function prepare(input) {
    const normalized = normalizeInput(input);
    authorizeScope(bound, scope(normalized.areaIds));
    const prepared = prepareOutcomeEvidence(privateCtx,
      normalized.outcome);
    const record = prepared.artifact;
    const sourceRel = prepared.file.rel;
    const ownershipRel = ownershipRelFor(record.id);
    // Destinations must resolve safely too: a preview never promises an
    // unsafe path, and the check stays read-only.
    const { projectRoot } = resolveWorkspaceState(bound);
    resolveInside(projectRoot, sourceRel, 'outcome source');
    resolveInside(projectRoot, ownershipRel, 'outcome ownership');
    boundedBytes(Buffer.from(prepared.file.content, 'utf8'),
      'outcome source');
    documentBytes(ownership(record.id, sourceRel,
      Buffer.from(prepared.file.content, 'utf8'),
      { operationId: '00000000-0000-0000-0000-000000000000',
        createdAt: record.createdAt }, normalized.areaIds),
      'outcome ownership');
    return { mode: 'dry-run', record, sourceRel, ownershipRel,
      reservesIds: false };
  }

  function create(input) {
    const normalized = normalizeInput(input);
    authorizeScope(bound, scope(normalized.areaIds));
    let built = null;
    const journal = applyJournaledRecordCreation(bound, (identity) => {
      // prepareOutcomeEvidence generates the artifact ID once, inside the
      // strict callback; only the local createdAt aligns to the kernel
      // identity before the final bytes are serialized.
      const prepared = prepareOutcomeEvidence(privateCtx,
        normalized.outcome);
      const record = validateArtifactShape(
        { ...prepared.artifact, createdAt: identity.createdAt }, 'report',
        'owned outcome');
      const recordId = record.id;
      const sourceRel = `${reportsRel}/${recordId}.json`;
      const ownershipRel = ownershipRelFor(recordId);
      const sourceBytes = documentBytes(record, 'outcome source');
      const owned = ownership(recordId, sourceRel, sourceBytes, identity,
        normalized.areaIds);
      const sidecarBytes = documentBytes(owned, 'outcome ownership');
      built = { record, sourceRel, ownershipRel };
      return [
        { sourceKind: 'report', recordId, sourceRevision: 0,
          areaIds: [...normalized.areaIds],
          file: { rel: sourceRel, content: sourceBytes } },
        { sourceKind: 'record-ownership', recordId, sourceRevision: 0,
          areaIds: [...normalized.areaIds],
          file: { rel: ownershipRel, content: sidecarBytes } },
      ];
    });
    return { mode: 'applied', record: built.record,
      sourceRel: built.sourceRel, ownershipRel: built.ownershipRel,
      ownershipConfirmed: journal.status === 'committed'
        && journal.journalState === 'confirmed',
      journal };
  }

  function get(recordId) {
    if (!isRecordUUID(recordId)) {
      throw err(INPUT, 'owned outcome id must be a UUID');
    }
    return readOwnedCreation(bound, {
      sourceKind: 'report', recordId,
      sourceRel: sourceRelFor(recordId),
      ownershipRel: ownershipRelFor(recordId),
      label: 'outcome', codes: PROOF_CODES,
    }, (snapshotBytes, owned) => inspectSource(recordId, snapshotBytes, owned));
  }

  return Object.freeze({ prepare, create, get });
}
