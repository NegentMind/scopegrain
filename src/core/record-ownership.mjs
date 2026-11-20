// Shared read-only ownership proof for typed stores. A current record is
// proven by its canonical sidecar, an authorized scope, a committed
// two-event create operation and immutable journal snapshots that match
// the present bytes. No listing, history fallback or plausible-file
// adoption. The descriptor is a trusted internal literal - never model or
// JSON input - that fixes the source kind, paths, domain labels and the
// caller's error codes.
import { err } from './errors.mjs';
import { canonicalJSON } from './digests.mjs';
import { lstatOrNull, readFileLimited } from './fsx.mjs';
import { resolveInside } from './paths.mjs';
import { loadLimits } from './policy.mjs';
import { authorizeScope, resolveWorkspaceState } from './workspaces.mjs';
import { getJournalOperation, readJournalSnapshot } from './journal.mjs';
import { cloneRecordJSON, validateRecordOwnership }
  from './record-ownership-data.mjs';
import { sameRecordLocator } from './owned-chain.mjs';

function strictUtf8(bytes, code, label) {
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) {
    throw err(code, `stored ${label} is not roundtrippable UTF-8`);
  }
  return text;
}

// Bounded read of a current store file: the binding is revalidated before
// every read, plus containment, no link ancestors, regular file and the
// existing maxDocumentBytes. missing/nonRegular codes are descriptor-
// selected so source and sidecar keep distinct failure codes.
function readCurrent(bound, rel, nonRegularCode, descriptor) {
  const { codes, label } = descriptor;
  const { projectRoot } = resolveWorkspaceState(bound);
  const abs = resolveInside(projectRoot, rel, `${label} file`);
  const st = lstatOrNull(abs);
  if (!st) throw err(codes.missing, `${label} file not found: ${rel}`);
  if (!st.isFile()) {
    throw err(nonRegularCode, `${label} file is not regular: ${rel}`);
  }
  const limited = readFileLimited(abs, loadLimits().maxDocumentBytes);
  if (limited.exceeded) {
    throw err('DOCUMENT_TOO_LARGE', `${label} file exceeds limit: ${rel}`);
  }
  return limited.content;
}

function eventScope(event) {
  return { workspaceId: event.workspaceId, projectId: event.projectId,
    repositoryId: event.repositoryId, areaIds: event.areaIds };
}

// Current-record proof, in the fixed order:
// 1. bounded current sidecar read;
// 2. shape/expected-kind validation, exact id/path, scope authorization
//    BEFORE any record content is produced;
// 3. committed operation with exactly two create/revision0 events;
// 4. both immutable snapshots verified (sidecar bytes equal, source hash
//    equals the source event hash);
// 5. inspectSource parses COPIES of the snapshot/ownership into the typed
//    record;
// 6. revalidated current source read must equal the original snapshot.
export function readOwnedCreation(bound, descriptor, inspectSource) {
  const { sourceKind, recordId, sourceRel, ownershipRel, label, codes }
    = descriptor;
  const sidecarBytes = readCurrent(bound, ownershipRel, codes.malformed,
    descriptor);
  let parsed;
  try {
    parsed = JSON.parse(strictUtf8(sidecarBytes, codes.malformed, 'ownership'));
  } catch (e) {
    if (e.code === codes.malformed) throw e;
    throw err(codes.malformed, `${label} ownership is not JSON`);
  }
  const owned = validateRecordOwnership(parsed, sourceKind, {
    code: codes.malformed, label: `${label} ownership`,
    scopeLabel: `${label} scope`,
  });
  if (owned.recordId !== recordId
      || !sameRecordLocator(owned.sourceRel, sourceRel)) {
    throw err(codes.malformed, `${label} ownership does not name this record`);
  }
  // Grants are validated before any record content is produced.
  authorizeScope(bound, owned.scope);
  const loaded = getJournalOperation(bound, owned.operationId);
  if (loaded.state !== 'committed') {
    throw err(codes.notCommitted,
      `${label} owning operation is not committed`);
  }
  const events = loaded.intent.events;
  if (events.length !== 2) {
    throw err(codes.malformed, `${label} operation is not two events`);
  }
  const source = events.find((e) => e.sourceKind === sourceKind);
  const sidecar = events.find((e) => e.sourceKind === 'record-ownership');
  const scopeJson = canonicalJSON(owned.scope);
  if (!source || !sidecar
      || source.recordId !== recordId || sidecar.recordId !== recordId
      || source.sourceRevision !== 0 || sidecar.sourceRevision !== 0
      || source.operation !== 'create' || sidecar.operation !== 'create'
      || !sameRecordLocator(source.sourceRel, sourceRel)
      || !sameRecordLocator(sidecar.sourceRel, ownershipRel)
      || source.createdAt !== owned.createdAt
      || sidecar.createdAt !== owned.createdAt
      || loaded.intent.createdAt !== owned.createdAt
      || canonicalJSON(eventScope(source)) !== scopeJson
      || canonicalJSON(eventScope(sidecar)) !== scopeJson) {
    throw err(codes.malformed, `${label} operation does not prove this record`);
  }
  const sidecarSnapshot = readJournalSnapshot(bound, owned.operationId,
    sidecar.eventId);
  if (!sidecarSnapshot.equals(sidecarBytes)) {
    throw err(codes.malformed,
      `current ${label} ownership differs from its snapshot`);
  }
  if (owned.sourceHash !== source.sourceHash) {
    throw err(codes.malformed,
      `${label} ownership hash differs from the ${label} event`);
  }
  const sourceSnapshot = readJournalSnapshot(bound, owned.operationId,
    source.eventId);
  // Copies keep the proof bytes/metadata isolated from inspectSource.
  const record = inspectSource(Buffer.from(sourceSnapshot),
    cloneRecordJSON(owned));
  const current = readCurrent(bound, sourceRel, codes.sourceChanged,
    descriptor);
  if (!current.equals(sourceSnapshot)) {
    throw err(codes.sourceChanged,
      `current ${label} source differs from its snapshot`);
  }
  return { record, ownership: owned,
    locator: { operationId: owned.operationId, eventId: source.eventId },
    isCurrentSource: true, memoryConsulted: false };
}
