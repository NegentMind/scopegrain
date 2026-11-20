// Bound owned-design store: immutable structured V2 design artifacts
// plus their ownership companion, created in one recoverable journal
// operation. The foreign spec binding stays a domain rule checked on the
// proven snapshot record - logical grant areas live in the sidecar and
// journal events and are never derived from paths. The creation protocol
// lives in owned-store.mjs; this module declares only design domain
// rules.
import { err } from './errors.mjs';
import { validateRecordOwnership } from './record-ownership-data.mjs';
import {
  artifactDirRel, validateArtifactBindings, validateArtifactDocument,
} from './artifacts.mjs';
import { prepareDesign } from './specifications.mjs';
import { createOwnedRecordStore } from './owned-store.mjs';

const PROOF_CODES = { missing: 'OWNED_DESIGN_NOT_FOUND',
  malformed: 'OWNED_DESIGN_MALFORMED',
  notCommitted: 'OWNED_DESIGN_NOT_COMMITTED',
  sourceChanged: 'OWNED_DESIGN_SOURCE_CHANGED' };

const SPEC = {
  storeLabel: 'owned design',
  inputCode: 'INVALID_OWNED_DESIGN_INPUT',
  malformedCode: 'OWNED_DESIGN_MALFORMED',
  proofCodes: PROOF_CODES,
  sourceKind: 'design',
  sourceLabel: 'design',
  idLabel: 'owned design id',
  inputKeys: ['areaIds', 'design'],
  inputKey: 'design',
  artifactKind: 'design',
  sourceDirRel: (ctx) => artifactDirRel(ctx, 'design'),
  prepareArtifact: prepareDesign,
  validateOwnership: (o) => validateRecordOwnership(o, 'design',
    { code: 'OWNED_DESIGN_MALFORMED', label: 'design ownership',
      scopeLabel: 'design scope' }),
  decodeRecord: (ctx, parsed, recordId) =>
    validateArtifactDocument(ctx, parsed, 'design', `design ${recordId}`),
  checkRecord(ctx, record, owned, recordId) {
    if (record.id !== recordId || record.createdAt !== owned.createdAt) {
      throw err('OWNED_DESIGN_MALFORMED',
        'design document does not match its proof');
    }
    // The foreign spec binding is revalidated on the proven record, so a
    // drifted or missing parent fails the read even though the owned
    // bytes are intact.
    validateArtifactBindings(ctx, record, `design ${recordId}`);
  },
};

export function createOwnedDesignStore(ctx, options) {
  return createOwnedRecordStore(ctx, options, SPEC);
}
