// Bound owned-outcome store: immutable structured V2 outcome reports
// plus their ownership companion, created in one recoverable journal
// operation. Logical grant areas live in the sidecar and journal events
// and are never derived from paths. Reads return proven current report
// bytes only: they never re-evaluate whether the bound task is still
// current - methodology gates keep that responsibility. The creation
// protocol lives in owned-store.mjs; this module declares only outcome
// domain rules.
import { err } from './errors.mjs';
import { validateRecordOwnership } from './record-ownership-data.mjs';
import {
  artifactDirRel, validateArtifactDocument,
} from './artifacts.mjs';
import { prepareOutcomeEvidence } from './outcomes.mjs';
import { createOwnedRecordStore } from './owned-store.mjs';

const PROOF_CODES = { missing: 'OWNED_OUTCOME_NOT_FOUND',
  malformed: 'OWNED_OUTCOME_MALFORMED',
  notCommitted: 'OWNED_OUTCOME_NOT_COMMITTED',
  sourceChanged: 'OWNED_OUTCOME_SOURCE_CHANGED' };

const SPEC = {
  storeLabel: 'owned outcome',
  inputCode: 'INVALID_OWNED_OUTCOME_INPUT',
  malformedCode: 'OWNED_OUTCOME_MALFORMED',
  proofCodes: PROOF_CODES,
  sourceKind: 'report',
  sourceLabel: 'outcome',
  idLabel: 'owned outcome id',
  inputKeys: ['areaIds', 'outcome'],
  inputKey: 'outcome',
  artifactKind: 'report',
  sourceDirRel: (ctx) => artifactDirRel(ctx, 'report'),
  prepareArtifact: prepareOutcomeEvidence,
  validateOwnership: (o) => validateRecordOwnership(o, 'report',
    { code: 'OWNED_OUTCOME_MALFORMED', label: 'outcome ownership',
      scopeLabel: 'outcome scope' }),
  decodeRecord: (ctx, parsed, recordId) =>
    validateArtifactDocument(ctx, parsed, 'report', `outcome ${recordId}`),
  checkRecord(_ctx, record, owned, recordId) {
    // A structurally valid V1 report under a genuine committed proof is
    // still rejected: only structured V2 outcome reports carry typed data.
    if (record.schemaVersion !== 2 || record.data === undefined) {
      throw err('OWNED_OUTCOME_MALFORMED',
        'outcome is not a structured V2 report');
    }
    if (record.id !== recordId || record.createdAt !== owned.createdAt) {
      throw err('OWNED_OUTCOME_MALFORMED',
        'outcome document does not match its proof');
    }
  },
};

export function createOwnedOutcomeStore(ctx, options) {
  return createOwnedRecordStore(ctx, options, SPEC);
}
