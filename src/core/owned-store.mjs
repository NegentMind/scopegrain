// Shared owned-record store: an immutable source document plus its
// ownership sidecar, created in one recoverable journal operation.
// Every kind follows the same protocol — closed options/input, scope
// authorization, strict serialization, ownership proof and proven reads —
// so the factory owns the protocol and each store declares only its
// domain rules: codes, kinds, input shape, record validation and any
// pre-write checks. Ownership proves a scoped kernel creation, not an
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
} from './record-ownership-data.mjs';
import { validateArtifactShape } from './artifacts.mjs';

const ZERO_OPERATION = '00000000-0000-0000-0000-000000000000';

// spec contract:
//   storeLabel        human label ('owned specification')
//   inputCode         closed-input error code
//   malformedCode     stored-bytes error code
//   proofCodes        {missing, malformed, notCommitted, sourceChanged}
//   sourceKind        journal sourceKind AND record-ownership/<kind>/ dir
//   sourceLabel       label fragment for IO errors ('spec' | 'outcome')
//   idLabel           'owned X id' prefix for the UUID gate
//   inputKeys         closed input keys (default normalization only)
//   inputKey          payload key ('specification'|'design'|'outcome')
//   artifactKind      artifacts.mjs kind for the default record pipeline
//   sourceDirRel(ctx) directory rel for source documents
//   prepareArtifact   ctx -> {artifact, file} (default pipeline only)
//   validateOwnership object -> validated sidecar record
//   decodeRecord(ctx, parsed, recordId) -> validated stored record
//   checkRecord(ctx, record, owned, recordId) -> void, throws malformed
//   validateOptions?  options -> opts (default: closed {areaIds})
//   normalizeInput?   input -> {areaIds, [inputKey]} (default: artifact DTO)
//   buildSource?      (ctx, normalized, identity, h) ->
//                     {record, sourceRel, sourceBytes}; identity.createdAt
//                     MUST be stamped into the record's proof-time field.
//                     h = {opts, scope, documentBytes, sourceRelFor}
//   precheck?         (normalized, get) -> void, runs in prepare AND create
export function createOwnedRecordStore(ctx, options, spec) {
  if (ctx === null || typeof ctx !== 'object'
      || typeof ctx.projectRoot !== 'string'
      || ctx.config === null || typeof ctx.config !== 'object') {
    throw err(spec.inputCode,
      `${spec.storeLabel} store requires a resolved context`);
  }
  const opts = spec.validateOptions
    ? spec.validateOptions(options)
    : defaultOptions(options, spec);
  const privateCtx = { projectRoot: ctx.projectRoot,
    config: structuredClone(ctx.config) };
  const bound = bindWorkspace(privateCtx, { areaIds: opts.areaIds });
  const sourceDirRel = spec.sourceDirRel(privateCtx);
  const stateRel = assertDestination(privateCtx.config.paths.state,
    'paths.state');
  const sourceRelFor = (recordId) => `${sourceDirRel}/${recordId}.json`;
  const ownershipRelFor = (recordId) =>
    `${stateRel}/record-ownership/${spec.sourceKind}/${recordId}.json`;

  function malformed(message) {
    throw err(spec.malformedCode, message);
  }

  function strictUtf8(bytes, label) {
    const text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes)) {
      malformed(`stored ${label} is not roundtrippable UTF-8`);
    }
    return text;
  }

  function documentBytes(value, label) {
    const bytes = Buffer.from(
      JSON.stringify(value, null, 2) + '\n', 'utf8');
    if (bytes.length > loadLimits().maxDocumentBytes) {
      throw err('DOCUMENT_TOO_LARGE', `${label} exceeds document limit`);
    }
    return bytes;
  }

  function scope(areaIds) {
    return { workspaceId: bound.workspaceId, projectId: bound.projectId,
      repositoryId: bound.repositoryId, areaIds: [...areaIds] };
  }

  const normalize = spec.normalizeInput ?? ((input) => {
    assertRecordObject(input, spec.inputKeys, spec.inputKeys, spec.inputCode,
      `${spec.storeLabel} input`);
    const areaIds = recordAreaIds(input.areaIds, spec.inputCode,
      `${spec.storeLabel} input`).sort();
    return { areaIds, [spec.inputKey]: cloneRecordJSON(input[spec.inputKey]) };
  });

  const helpers = { opts, scope, documentBytes, sourceRelFor };

  const buildSource = spec.buildSource ?? ((normalized, identity) => {
    const prepared = spec.prepareArtifact(privateCtx,
      normalized[spec.inputKey]);
    const record = validateArtifactShape(
      { ...prepared.artifact, createdAt: identity.createdAt },
      spec.artifactKind, spec.storeLabel);
    const sourceRel = sourceRelFor(record.id);
    const sourceBytes = documentBytes(record, `${spec.sourceLabel} source`);
    return { record, sourceRel, sourceBytes };
  });

  function ownership(recordId, sourceRel, sourceBytes, identity, areaIds) {
    return spec.validateOwnership({
      schemaVersion: 1, sourceKind: spec.sourceKind, recordId,
      sourceRevision: 0, sourceRel,
      sourceHash: crypto.createHash('sha256').update(sourceBytes)
        .digest('hex'),
      operationId: identity.operationId, scope: scope(areaIds),
      createdAt: identity.createdAt,
    });
  }

  // The proved snapshot bytes are validated through the store's decoder —
  // never reread through a generic getter after the proof, which would
  // open a read race.
  function inspectSource(recordId, snapshotBytes, owned) {
    let parsed;
    try {
      parsed = JSON.parse(
        strictUtf8(snapshotBytes, `${spec.sourceLabel} source`));
    } catch (e) {
      if (e.code === spec.malformedCode) throw e;
      malformed(`${spec.sourceLabel} snapshot is not JSON`);
    }
    const record = spec.decodeRecord(privateCtx, parsed, recordId);
    spec.checkRecord(privateCtx, record, owned, recordId);
    return record;
  }

  function get(recordId) {
    if (!isRecordUUID(recordId)) {
      throw err(spec.inputCode, `${spec.idLabel} must be a UUID`);
    }
    return readOwnedCreation(bound, {
      sourceKind: spec.sourceKind, recordId,
      sourceRel: sourceRelFor(recordId),
      ownershipRel: ownershipRelFor(recordId),
      label: spec.sourceLabel, codes: spec.proofCodes,
    }, (snapshotBytes, owned) => inspectSource(recordId, snapshotBytes, owned));
  }

  function prepare(input) {
    const normalized = normalize(input);
    authorizeScope(bound, scope(normalized.areaIds));
    spec.precheck?.(normalized, get);
    const identity = { operationId: ZERO_OPERATION,
      createdAt: new Date().toISOString() };
    const built = spec.buildSource
      ? spec.buildSource(privateCtx, normalized, identity, helpers)
      : buildSource(normalized, identity);
    const ownershipRel = ownershipRelFor(built.record.id);
    // Destinations must resolve safely too: a preview never promises an
    // unsafe path, and the check stays read-only.
    const { projectRoot } = resolveWorkspaceState(bound);
    resolveInside(projectRoot, built.sourceRel, `${spec.sourceLabel} source`);
    resolveInside(projectRoot, ownershipRel, `${spec.sourceLabel} ownership`);
    documentBytes(ownership(built.record.id, built.sourceRel,
      built.sourceBytes, identity, normalized.areaIds),
      `${spec.sourceLabel} ownership`);
    return { mode: 'dry-run', record: built.record,
      sourceRel: built.sourceRel, ownershipRel, reservesIds: false };
  }

  function create(input) {
    const normalized = normalize(input);
    authorizeScope(bound, scope(normalized.areaIds));
    spec.precheck?.(normalized, get);
    let built = null;
    const journal = applyJournaledRecordCreation(bound, (identity) => {
      const source = spec.buildSource
        ? spec.buildSource(privateCtx, normalized, identity, helpers)
        : buildSource(normalized, identity);
      const recordId = source.record.id;
      const ownershipRel = ownershipRelFor(recordId);
      const owned = ownership(recordId, source.sourceRel,
        source.sourceBytes, identity, normalized.areaIds);
      const sidecarBytes = documentBytes(owned,
        `${spec.sourceLabel} ownership`);
      built = { record: source.record, sourceRel: source.sourceRel,
        ownershipRel };
      return [
        { sourceKind: spec.sourceKind, recordId, sourceRevision: 0,
          areaIds: [...normalized.areaIds],
          file: { rel: source.sourceRel, content: source.sourceBytes } },
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

  return Object.freeze({ prepare, create, get });
}

function defaultOptions(options, spec) {
  assertRecordObject(options, ['areaIds'], ['areaIds'], spec.inputCode,
    `${spec.storeLabel} options`);
  return { areaIds: recordAreaIds(options.areaIds, spec.inputCode,
    `${spec.storeLabel} options`) };
}
