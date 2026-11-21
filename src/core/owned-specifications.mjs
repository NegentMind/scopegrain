// SPDX-License-Identifier: Apache-2.0
// Bound owned-specification store: immutable structured V2 specifications
// plus their ownership companion, created in one recoverable journal
// operation. Logical grant areas live in the sidecar and journal events -
// spec.data.scope path declarations are a different concept and are never
// used to derive grants. The creation protocol lives in owned-store.mjs;
// this module declares only spec domain rules.
import { err } from './errors.mjs';
import { validateRecordOwnership } from './record-ownership-data.mjs';
import {
  artifactDirRel, validateArtifactDocument,
} from './artifacts.mjs';
import { prepareSpecification } from './specifications.mjs';
import { createOwnedRecordStore } from './owned-store.mjs';

const PROOF_CODES = { missing: 'OWNED_SPEC_NOT_FOUND',
  malformed: 'OWNED_SPEC_MALFORMED', notCommitted: 'OWNED_SPEC_NOT_COMMITTED',
  sourceChanged: 'OWNED_SPEC_SOURCE_CHANGED' };

const SPEC = {
  storeLabel: 'owned specification',
  inputCode: 'INVALID_OWNED_SPEC_INPUT',
  malformedCode: 'OWNED_SPEC_MALFORMED',
  proofCodes: PROOF_CODES,
  sourceKind: 'spec',
  sourceLabel: 'spec',
  idLabel: 'owned specification id',
  inputKeys: ['areaIds', 'specification'],
  inputKey: 'specification',
  artifactKind: 'spec',
  sourceDirRel: (ctx) => artifactDirRel(ctx, 'spec'),
  prepareArtifact: prepareSpecification,
  validateOwnership: (o) => validateRecordOwnership(o, 'spec',
    { code: 'OWNED_SPEC_MALFORMED', label: 'spec ownership',
      scopeLabel: 'spec scope' }),
  decodeRecord: (ctx, parsed, recordId) =>
    validateArtifactDocument(ctx, parsed, 'spec', `spec ${recordId}`),
  checkRecord(_ctx, record, owned, recordId) {
    if (record.schemaVersion !== 2 || record.data === undefined) {
      throw err('SPEC_STRUCTURED_REQUIRED',
        `spec ${recordId} is not a structured V2 artifact`);
    }
    if (record.id !== recordId || record.createdAt !== owned.createdAt) {
      throw err('OWNED_SPEC_MALFORMED',
        'spec document does not match its proof');
    }
  },
};

export function createOwnedSpecificationStore(ctx, options) {
  return createOwnedRecordStore(ctx, options, SPEC);
}
