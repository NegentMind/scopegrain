// Bound owned-specification store: immutable structured V2 specifications
// plus their ownership companion, created in one recoverable journal
// operation. Logical grant areas live in the sidecar and journal events -
// spec.data.scope path declarations are a different concept and are never
// used to derive grants. Ownership proves a scoped kernel creation, not an
// authenticated identity, original-request authenticity or active truth.
// Reads return proven current records only; they never adopt plausible
// files, list history or consult memory backends.
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
import { prepareSpecification } from './specifications.mjs';

const OPTION_KEYS = ['areaIds'];
const INPUT_KEYS = ['areaIds', 'specification'];
const PROOF_CODES = { missing: 'OWNED_SPEC_NOT_FOUND',
  malformed: 'OWNED_SPEC_MALFORMED', notCommitted: 'OWNED_SPEC_NOT_COMMITTED',
  sourceChanged: 'OWNED_SPEC_SOURCE_CHANGED' };
const INPUT = 'INVALID_OWNED_SPEC_INPUT';

function malformed(message) {
  throw err('OWNED_SPEC_MALFORMED', message);
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

export function createOwnedSpecificationStore(ctx, options) {
  if (ctx === null || typeof ctx !== 'object'
      || typeof ctx.projectRoot !== 'string'
      || ctx.config === null || typeof ctx.config !== 'object') {
    throw err(INPUT,
      'owned specification store requires a resolved context');
  }
  // Options and config are validated/cloned once at construction; the store
  // never consults mutable caller state again. There is no origin option:
  // the artifact and sidecar schemas have nowhere to store one, and a
  // silently dropped field would hide caller intent.
  assertRecordObject(options, OPTION_KEYS, OPTION_KEYS, INPUT,
    'owned specification store options');
  const opts = { areaIds: recordAreaIds(options.areaIds, INPUT,
    'owned specification store options') };
  const privateCtx = { projectRoot: ctx.projectRoot,
    config: structuredClone(ctx.config) };
  const bound = bindWorkspace(privateCtx, { areaIds: opts.areaIds });
  const specsRel = artifactDirRel(privateCtx, 'spec');
  const stateRel = assertDestination(privateCtx.config.paths.state,
    'paths.state');
  const sourceRelFor = (recordId) => `${specsRel}/${recordId}.json`;
  const ownershipRelFor = (recordId) =>
    `${stateRel}/record-ownership/spec/${recordId}.json`;

  function scope(areaIds) {
    return { workspaceId: bound.workspaceId, projectId: bound.projectId,
      repositoryId: bound.repositoryId, areaIds: [...areaIds] };
  }

  // Closed outer DTO: record areas are sorted/unique for the canonical
  // scope; the specification is cloned to plain JSON before any IO so a
  // mutated caller object cannot alter the validated record.
  function normalizeInput(input) {
    assertRecordObject(input, INPUT_KEYS, INPUT_KEYS, INPUT,
      'owned specification input');
    const areaIds = recordAreaIds(input.areaIds, INPUT,
      'owned specification input').sort();
    return { areaIds, specification: cloneRecordJSON(input.specification) };
  }

  function ownership(recordId, sourceRel, sourceBytes, identity, areaIds) {
    return validateRecordOwnership({
      schemaVersion: 1, sourceKind: 'spec', recordId, sourceRevision: 0,
      sourceRel,
      sourceHash: crypto.createHash('sha256').update(sourceBytes).digest('hex'),
      operationId: identity.operationId, scope: scope(areaIds),
      createdAt: identity.createdAt,
    }, 'spec', { code: 'OWNED_SPEC_MALFORMED', label: 'spec ownership',
      scopeLabel: 'spec scope' });
  }

  // The proved snapshot bytes are validated through the shared artifact
  // helper - never reread through getSpecification after the proof, which
  // would open a read race.
  function inspectSource(recordId, snapshotBytes, owned) {
    let parsed;
    try {
      parsed = JSON.parse(strictUtf8(snapshotBytes, 'spec source'));
    } catch (e) {
      if (e.code === 'OWNED_SPEC_MALFORMED') throw e;
      malformed('spec snapshot is not JSON');
    }
    const record = validateArtifactDocument(privateCtx, parsed, 'spec',
      `spec ${recordId}`);
    if (record.schemaVersion !== 2 || record.data === undefined) {
      throw err('SPEC_STRUCTURED_REQUIRED',
        `spec ${recordId} is not a structured V2 artifact`);
    }
    if (record.id !== recordId || record.createdAt !== owned.createdAt) {
      malformed('spec document does not match its proof');
    }
    return record;
  }

  function prepare(input) {
    const normalized = normalizeInput(input);
    authorizeScope(bound, scope(normalized.areaIds));
    const prepared = prepareSpecification(privateCtx,
      normalized.specification);
    const record = prepared.artifact;
    const sourceRel = prepared.file.rel;
    const ownershipRel = ownershipRelFor(record.id);
    // Destinations must resolve safely too: a preview never promises an
    // unsafe path, and the check stays read-only.
    const { projectRoot } = resolveWorkspaceState(bound);
    resolveInside(projectRoot, sourceRel, 'spec source');
    resolveInside(projectRoot, ownershipRel, 'spec ownership');
    boundedBytes(Buffer.from(prepared.file.content, 'utf8'), 'spec source');
    documentBytes(ownership(record.id, sourceRel,
      Buffer.from(prepared.file.content, 'utf8'),
      { operationId: '00000000-0000-0000-0000-000000000000',
        createdAt: record.createdAt }, normalized.areaIds),
      'spec ownership');
    return { mode: 'dry-run', record, sourceRel, ownershipRel,
      reservesIds: false };
  }

  function create(input) {
    const normalized = normalizeInput(input);
    authorizeScope(bound, scope(normalized.areaIds));
    let built = null;
    const journal = applyJournaledRecordCreation(bound, (identity) => {
      // prepareSpecification generates the artifact ID once, inside the
      // strict callback; only the local createdAt aligns to the kernel
      // identity before the final bytes are serialized.
      const prepared = prepareSpecification(privateCtx,
        normalized.specification);
      const record = validateArtifactShape(
        { ...prepared.artifact, createdAt: identity.createdAt }, 'spec',
        'owned specification');
      const recordId = record.id;
      const sourceRel = `${specsRel}/${recordId}.json`;
      const ownershipRel = ownershipRelFor(recordId);
      const sourceBytes = documentBytes(record, 'spec source');
      const owned = ownership(recordId, sourceRel, sourceBytes, identity,
        normalized.areaIds);
      const sidecarBytes = documentBytes(owned, 'spec ownership');
      built = { record, sourceRel, ownershipRel };
      return [
        { sourceKind: 'spec', recordId, sourceRevision: 0,
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
      throw err(INPUT, 'owned specification id must be a UUID');
    }
    return readOwnedCreation(bound, {
      sourceKind: 'spec', recordId,
      sourceRel: sourceRelFor(recordId),
      ownershipRel: ownershipRelFor(recordId),
      label: 'spec', codes: PROOF_CODES,
    }, (snapshotBytes, owned) => inspectSource(recordId, snapshotBytes, owned));
  }

  return Object.freeze({ prepare, create, get });
}
