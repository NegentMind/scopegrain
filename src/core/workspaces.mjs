// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { err } from './errors.mjs';
import { decodeUtf8Strict, lstatOrNull, readFileLimited } from './fsx.mjs';
import { assertDestination, portableKey, resolveInside, resolveProjectRoot }
  from './paths.mjs';
import { loadLimits } from './policy.mjs';
import { canonicalDigest, canonicalJSON } from './digests.mjs';
// NOTE: journal.mjs already imports this module, so these imports form a
// two-module cycle. It is safe in ESM: every cross-reference executes
// inside function bodies after both modules finish evaluating, and the
// exported function declarations are bound during instantiation.
import {
  applyJournaledRecordCreation, applyJournaledRecordUpdate,
  readJournalSnapshot,
} from './journal.mjs';
import {
  ownedDocumentBytes, ownedScope, parseOwnedJson, readOwnedCurrent,
  resultingSourceRevision, sha256Hex, walkOwnedLinked,
} from './owned-chain.mjs';
import { validateRecordTransition } from './record-history.mjs';
import { cloneRecordJSON, recordAreaIds } from './record-ownership-data.mjs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const WORKSPACE_KEYS = [
  'schemaVersion', 'workspaceId', 'projectId', 'repositoryId',
  'revision', 'createdAt', 'updatedAt', 'areas',
];
const AREA_KEYS = ['id', 'key', 'name'];
const SCOPE_KEYS = ['workspaceId', 'projectId', 'repositoryId', 'areaIds'];
const bindings = new WeakMap();

function object(value, allowed, required, code, label, unknownCode = code) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
      || Object.getOwnPropertySymbols(value).length !== 0) {
    throw err(code, `${label} must be a plain object`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!allowed.includes(key)) {
      throw err(unknownCode, `${label} contains unknown key '${key}'`);
    }
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw err(code, `${label}.${key} must be an enumerable value`);
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(descriptors, key)) {
      throw err(code, `${label} is missing '${key}'`);
    }
  }
  return value;
}

function array(value, code, label) {
  if (!Array.isArray(value) || value.length === 0
      || Object.getPrototypeOf(value) !== Array.prototype
      || Object.getOwnPropertySymbols(value).length !== 0
      || Object.getOwnPropertyNames(value).length !== value.length + 1) {
    throw err(code, `${label} must be a non-empty dense array`);
  }
  for (let i = 0; i < value.length; i += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw err(code, `${label} must contain only values`);
    }
  }
  return value;
}

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function isCanonicalTime(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    && new Date(Date.parse(value)).toISOString() === value;
}

function areaShape(area, stored) {
  const code = stored ? 'WORKSPACE_MALFORMED' : 'INVALID_WORKSPACE';
  const keys = stored ? AREA_KEYS : ['key', 'name'];
  object(area, keys, keys, code, 'area', stored ? code : 'UNKNOWN_KEY');
  if ((stored && !isUuid(area.id))
      || typeof area.key !== 'string' || !KEY_RE.test(area.key)
      || typeof area.name !== 'string' || area.name.trim() === '') {
    throw err(code, 'area has invalid fields');
  }
}

export function validateWorkspace(value) {
  const code = 'WORKSPACE_MALFORMED';
  object(value, WORKSPACE_KEYS, WORKSPACE_KEYS, code, 'workspace');
  if (value.schemaVersion !== 1
      || !isUuid(value.workspaceId) || !isUuid(value.projectId)
      || !isUuid(value.repositoryId)
      || !Number.isSafeInteger(value.revision) || value.revision < 0
      || !isCanonicalTime(value.createdAt) || !isCanonicalTime(value.updatedAt)
      || Date.parse(value.createdAt) > Date.parse(value.updatedAt)) {
    throw err(code, 'workspace has invalid fields');
  }
  array(value.areas, code, 'workspace.areas');
  const ids = new Set([value.workspaceId, value.projectId, value.repositoryId]);
  if (ids.size !== 3) throw err(code, 'workspace identities must be distinct');
  const keys = new Set();
  for (const area of value.areas) {
    areaShape(area, true);
    if (ids.has(area.id) || keys.has(area.key)) {
      throw err(code, 'workspace area keys and identities must be distinct');
    }
    ids.add(area.id);
    keys.add(area.key);
  }
  return value;
}

export function workspaceFileRel(ctx) {
  const state = assertDestination(ctx.config.paths.state, 'paths.state');
  return assertDestination(`${state}/workspace.json`, 'workspace file');
}

function readWorkspace(ctx) {
  const rel = workspaceFileRel(ctx);
  const abs = resolveInside(ctx.projectRoot, rel, 'workspace file');
  const st = lstatOrNull(abs);
  if (!st) throw err('WORKSPACE_NOT_FOUND', `workspace not found: ${rel}`);
  if (!st.isFile()) throw err('WORKSPACE_NOT_FILE', `workspace is not a file: ${rel}`);
  let limited;
  try {
    limited = readFileLimited(abs, loadLimits().maxDocumentBytes);
  } catch (e) {
    if (e.code === 'READ_FAILED') throw e;
    throw err('READ_FAILED', `cannot read workspace: ${rel}`);
  }
  if (limited.exceeded) {
    throw err('DOCUMENT_TOO_LARGE', `workspace exceeds document limit: ${rel}`);
  }
  const text = decodeUtf8Strict(
    limited.content, 'MALFORMED_JSON', `workspace: ${rel}`);
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw err('MALFORMED_JSON', `malformed JSON in workspace: ${rel}`);
  }
  return { workspace: validateWorkspace(value), rel, abs, content: limited.content };
}

export function getWorkspace(ctx) {
  return readWorkspace(ctx).workspace;
}

function inputAreas(input) {
  object(input, ['areas'], [], 'INVALID_WORKSPACE', 'workspace input', 'UNKNOWN_KEY');
  if (!Object.hasOwn(input, 'areas')) return null;
  array(input.areas, 'INVALID_WORKSPACE', 'workspace input.areas');
  const keys = new Set();
  for (const area of input.areas) {
    areaShape(area, false);
    if (keys.has(area.key)) throw err('INVALID_WORKSPACE', 'area keys must be distinct');
    keys.add(area.key);
  }
  return input.areas;
}

export function prepareWorkspace(ctx, input = {}) {
  const areas = inputAreas(input);
  const rel = workspaceFileRel(ctx);
  const abs = resolveInside(ctx.projectRoot, rel, 'workspace file');
  const st = lstatOrNull(abs);
  if (st) {
    const existing = readWorkspace(ctx);
    if (areas) {
      const previous = new Map(existing.workspace.areas.map((a) => [a.key, a.name]));
      if (previous.size !== areas.length
          || areas.some((area) => previous.get(area.key) !== area.name)) {
        throw err('WORKSPACE_CONFLICT', 'workspace areas differ from existing enrollment');
      }
    }
    return { workspace: existing.workspace,
      file: { rel: existing.rel, abs: existing.abs, content: existing.content } };
  }
  const proposed = areas ?? [{ key: 'project', name: ctx.config.project.name }];
  for (const area of proposed) areaShape(area, false);
  const now = new Date().toISOString();
  const workspace = {
    schemaVersion: 1, workspaceId: crypto.randomUUID(), projectId: crypto.randomUUID(),
    repositoryId: crypto.randomUUID(), revision: 0, createdAt: now, updatedAt: now,
    areas: proposed.map(({ key, name }) => ({ id: crypto.randomUUID(), key, name })),
  };
  validateWorkspace(workspace);
  const content = JSON.stringify(workspace, null, 2) + '\n';
  if (Buffer.byteLength(content, 'utf8') > loadLimits().maxDocumentBytes) {
    throw err('DOCUMENT_TOO_LARGE', 'workspace exceeds document limit');
  }
  return { workspace, file: { rel, abs, content } };
}

function areaIds(value) {
  array(value, 'SCOPE_DENIED', 'areaIds');
  if (!value.every(isUuid) || new Set(value).size !== value.length) {
    throw err('SCOPE_DENIED', 'areaIds must contain distinct canonical UUIDs');
  }
  return [...value].sort();
}

// The lexical resolve must match the realpath so a rebound root cannot
// keep a live binding through a link/junction. Win32 filesystems are
// case-insensitive, so the same root legitimately arrives with a
// different drive-letter or segment casing: the comparison follows
// portableKey there and stays byte-exact on case-sensitive platforms.
function sameRoot(resolved, lexical) {
  return process.platform === 'win32'
    ? portableKey(resolved) === portableKey(lexical)
    : resolved === lexical;
}

function rootIdentity(root) {
  const resolved = resolveProjectRoot(root);
  if (!sameRoot(resolved, path.resolve(root))) {
    throw err('WORKSPACE_STALE', 'workspace root changed');
  }
  const stat = fs.statSync(resolved, { bigint: true });
  return { dev: stat.dev, ino: stat.ino };
}

function binding(bound) {
  const state = bindings.get(bound);
  if (!state) throw err('SCOPE_DENIED', 'workspace binding is not authentic');
  return state;
}

function revalidate(state) {
  if (state.invalidated) throw err('WORKSPACE_STALE', 'workspace binding is stale');
  try {
    const current = rootIdentity(state.ctx.projectRoot);
    if (current.dev !== state.root.dev || current.ino !== state.root.ino) {
      throw err('WORKSPACE_STALE', 'workspace root was replaced');
    }
    let workspace;
    try {
      workspace = getWorkspace(state.ctx);
    } catch (e) {
      if (e.code === 'WORKSPACE_NOT_FOUND') {
        throw err('WORKSPACE_STALE', 'workspace metadata was removed');
      }
      throw e;
    }
    if (canonicalDigest(workspace) !== state.digest) {
      throw err('WORKSPACE_STALE', 'workspace metadata changed');
    }
  } catch (e) {
    if (e.code === 'WORKSPACE_STALE') state.invalidated = true;
    throw e;
  }
}

export function bindWorkspace(ctx, options) {
  object(options, ['areaIds'], ['areaIds'], 'SCOPE_DENIED', 'workspace grants');
  const granted = areaIds(options.areaIds);
  const boundCtx = { projectRoot: ctx.projectRoot, config: structuredClone(ctx.config) };
  const root = rootIdentity(boundCtx.projectRoot);
  const workspace = getWorkspace(boundCtx);
  const known = new Set(workspace.areas.map((area) => area.id));
  if (!granted.every((id) => known.has(id))) {
    throw err('SCOPE_DENIED', 'area grant does not belong to workspace');
  }
  const bound = Object.freeze({
    workspaceId: workspace.workspaceId,
    projectId: workspace.projectId,
    repositoryId: workspace.repositoryId,
    areaIds: Object.freeze(granted),
  });
  bindings.set(bound, { ctx: boundCtx, root, workspace: structuredClone(workspace),
    digest: canonicalDigest(workspace), invalidated: false });
  return bound;
}

export function authorizeScope(bound, request) {
  const state = binding(bound);
  object(request, SCOPE_KEYS, SCOPE_KEYS, 'SCOPE_DENIED', 'scope');
  const requested = areaIds(request.areaIds);
  if (request.workspaceId !== bound.workspaceId || request.projectId !== bound.projectId
      || request.repositoryId !== bound.repositoryId
      || !requested.every((id) => bound.areaIds.includes(id))) {
    throw err('SCOPE_DENIED', 'scope is not authorized');
  }
  revalidate(state);
  return Object.freeze({
    workspaceId: bound.workspaceId, projectId: bound.projectId,
    repositoryId: bound.repositoryId, areaIds: Object.freeze(requested),
  });
}

export function resolveWorkspaceRepository(bound, repositoryId) {
  const state = binding(bound);
  if (!isUuid(repositoryId) || repositoryId !== bound.repositoryId) {
    throw err('SCOPE_DENIED', 'repository is not authorized');
  }
  revalidate(state);
  return state.ctx.projectRoot;
}

export function resolveWorkspaceState(bound) {
  const state = binding(bound);
  revalidate(state);
  const stateRel = assertDestination(state.ctx.config.paths.state, 'paths.state');
  resolveInside(state.ctx.projectRoot, stateRel, 'paths.state');
  return Object.freeze({ projectRoot: state.ctx.projectRoot, stateRel });
}

// ==== Owned workspace store: journal-backed mutable descriptor updates ====
//
// Opt-in typed store that mutates the workspace identity descriptor only
// through applyJournaledRecordUpdate CAS. The descriptor authorizes every
// scope proof, so the update is self-authorized: the journal events carry
// the pre-image identity from `bound`, and the derivation freezes
// schemaVersion/workspaceId/projectId/repositoryId/createdAt so pre- and
// post-image identity can never diverge. Every committed update changes
// the canonical digest and permanently stale-ates all live bindings; the
// store re-binds per call so it survives its own updates while a removed
// grant fails SCOPE_DENIED.
//
// Ownership starts at lazy journal enrollment, not at a separate
// migration step: the first update with no pointer file creates
// `<paths.state>/workspace-ownership.json` through
// applyJournaledRecordCreation (genesis records the current revision and
// sha256 of the CAS-verified current bytes as the owned base), then runs
// a homogeneous two-event update op that rewrites the descriptor and the
// pointer in the same two-phase apply. Each committed pointer doc links
// back through previousOperationId so get() replays the FULL committed
// chain - every op, event pair, descriptor snapshot and frozen identity
// field - down to the single-event genesis, instead of proving only the
// tip. A descriptor that was never journaled is not adopted: get() fails
// closed with OWNED_WORKSPACE_NOT_FOUND. Declared sourceRevisions and
// previousHashes are derived from the bytes the store itself read and
// validated, never caller-supplied.

const OWNED_INPUT = 'INVALID_OWNED_WORKSPACE_INPUT';
const OWNED_MISSING = 'OWNED_WORKSPACE_NOT_FOUND';
const OWNED_MALFORMED = 'OWNED_WORKSPACE_MALFORMED';
const OWNED_UNCOMMITTED = 'OWNED_WORKSPACE_NOT_COMMITTED';
const OWNED_CHANGED = 'OWNED_WORKSPACE_SOURCE_CHANGED';
const OWNED_KIND = 'workspace';
const OWNERSHIP_KIND = 'workspace-ownership';
const OWNED_OPTION_KEYS = ['areaIds'];
const OWNED_UPDATE_KEYS = ['areaIds', 'workspace'];
const OWNED_WORKSPACE_KEYS = ['areas'];
const OWNERSHIP_DOC_KEYS = ['schemaVersion', 'workspaceId', 'revision',
  'sourceHash', 'operationId', 'previousOperationId', 'createOperationId',
  'updatedAt'];
const HASH_RE = /^[0-9a-f]{64}$/;

function ownershipFileRel(ctx) {
  const state = assertDestination(ctx.config.paths.state, 'paths.state');
  return assertDestination(`${state}/workspace-ownership.json`,
    'workspace ownership file');
}

// Closed schemaVersion-2 chain-head pointer: workspaceId + revision +
// sourceHash of the descriptor bytes it vouches for + the operation that
// produced it + the committed-chain links. Genesis is exactly one create
// event, so its doc anchors itself: previousOperationId null requires
// createOperationId === operationId.
function validateOwnershipDoc(value) {
  const code = OWNED_MALFORMED;
  object(value, OWNERSHIP_DOC_KEYS, OWNERSHIP_DOC_KEYS, code,
    'workspace ownership');
  if (value.schemaVersion !== 2 || !isUuid(value.workspaceId)
      || !Number.isSafeInteger(value.revision) || value.revision < 0
      || typeof value.sourceHash !== 'string' || !HASH_RE.test(value.sourceHash)
      || !isUuid(value.operationId)
      || (value.previousOperationId !== null
        && !isUuid(value.previousOperationId))
      || !isUuid(value.createOperationId)
      || !isCanonicalTime(value.updatedAt)
      || (value.previousOperationId === null
        && value.createOperationId !== value.operationId)) {
    throw err(code, 'workspace ownership has invalid fields');
  }
  return value;
}

// Dense non-empty array of enrollment-shape {key,name} areas under the
// owned input code; stored ids are never caller-supplied.
function ownedUpdateAreas(value) {
  array(value, OWNED_INPUT, 'workspace update.areas');
  const keys = new Set();
  for (const area of value) {
    object(area, ['key', 'name'], ['key', 'name'], OWNED_INPUT, 'area');
    if (typeof area.key !== 'string' || !KEY_RE.test(area.key)
        || typeof area.name !== 'string' || area.name.trim() === '') {
      throw err(OWNED_INPUT, 'area has invalid fields');
    }
    if (keys.has(area.key)) {
      throw err(OWNED_INPUT, 'area keys must be distinct');
    }
    keys.add(area.key);
  }
  return value;
}

// Full replacement list resolved against the current descriptor: every
// existing key must be retained (removal is rejected - event scopes are
// authorized against current grants, so a removed area could permanently
// unauthorize pending/historical operations, including their recovery);
// a matched key keeps its area id; a new key earns a fresh UUID.
function resolveOwnedAreas(current, inputs) {
  const byKey = new Map(current.areas.map((area) => [area.key, area]));
  for (const area of current.areas) {
    if (!inputs.some((input) => input.key === area.key)) {
      throw err(OWNED_INPUT,
        `workspace update must retain existing area '${area.key}'`);
    }
  }
  return inputs.map((input) => {
    const existing = byKey.get(input.key);
    return { id: existing ? existing.id : crypto.randomUUID(),
      key: input.key, name: input.name };
  });
}

function deriveNextWorkspace(current, resolved, updatedAt) {
  const next = { ...current, revision: current.revision + 1, updatedAt,
    areas: resolved };
  return validateWorkspace(next);
}

export function createOwnedWorkspaceStore(ctx, options) {
  if (ctx === null || typeof ctx !== 'object'
      || typeof ctx.projectRoot !== 'string'
      || ctx.config === null || typeof ctx.config !== 'object') {
    throw err(OWNED_INPUT, 'owned workspace store requires a resolved context');
  }
  // Options are validated/cloned once at construction; grants are fixed
  // and re-bound per call so the store survives its own updates.
  object(options, OWNED_OPTION_KEYS, OWNED_OPTION_KEYS, OWNED_INPUT,
    'owned workspace store options');
  const opts = { areaIds: recordAreaIds(options.areaIds, OWNED_INPUT,
    'owned workspace store options').sort() };
  const privateCtx = { projectRoot: ctx.projectRoot,
    config: structuredClone(ctx.config) };
  // Eager bind: WORKSPACE_NOT_FOUND / SCOPE_DENIED surface at
  // construction instead of the first method call.
  bindWorkspace(privateCtx, { areaIds: opts.areaIds });
  const sourceRel = workspaceFileRel(privateCtx);
  const pointerRel = ownershipFileRel(privateCtx);

  function bind() {
    return bindWorkspace(privateCtx, { areaIds: opts.areaIds });
  }

  function normalizeInput(input) {
    object(input, OWNED_UPDATE_KEYS, OWNED_UPDATE_KEYS, OWNED_INPUT,
      'owned workspace update');
    const areaIds = recordAreaIds(input.areaIds, OWNED_INPUT,
      'owned workspace update').sort();
    object(input.workspace, OWNED_WORKSPACE_KEYS, OWNED_WORKSPACE_KEYS,
      OWNED_INPUT, 'owned workspace update.workspace');
    const workspace = cloneRecordJSON(input.workspace);
    ownedUpdateAreas(workspace.areas);
    return { areaIds, workspace };
  }

  function readDescriptor(bound) {
    const { projectRoot } = resolveWorkspaceState(bound);
    return readWorkspace({ projectRoot, config: privateCtx.config });
  }

  // Bounded pointer read under a revalidated binding: absent is a plain
  // null, malformed/non-regular/oversized fails closed with the family
  // code and is never repaired or overwritten silently.
  function readOwnership(bound) {
    const bytes = readOwnedCurrent(bound, pointerRel, {
      missingCode: null, nonRegularCode: OWNED_MALFORMED,
      label: 'workspace ownership' });
    if (bytes === null) return null;
    return { doc: validateOwnershipDoc(
        parseOwnedJson(bytes, OWNED_MALFORMED, 'workspace ownership')),
      bytes };
  }

  // The pointer vouches for exact descriptor bytes: the byte hash is
  // checked first - a hash match means the descriptor is exactly the
  // proven bytes, so a workspaceId/revision disagreement afterwards can
  // only be a malformed pointer. A hash mismatch means the descriptor
  // drifted from its last journaled state and is never re-baselined
  // silently.
  function requireConsistent(pointer, current, bytes) {
    if (pointer.doc.sourceHash !== sha256Hex(bytes)) {
      throw err(OWNED_CHANGED,
        'workspace descriptor differs from its proven state');
    }
    if (pointer.doc.workspaceId !== current.workspaceId
        || pointer.doc.revision !== current.revision) {
      throw err(OWNED_MALFORMED,
        'workspace ownership does not match the descriptor');
    }
  }

  function ownershipDoc(workspaceId, revision, sourceHash, operationId,
      previousOperationId, createOperationId, updatedAt) {
    return validateOwnershipDoc({ schemaVersion: 2, workspaceId, revision,
      sourceHash, operationId, previousOperationId, createOperationId,
      updatedAt });
  }

  function prepare(input) {
    const normalized = normalizeInput(input);
    const bound = bind();
    authorizeScope(bound, ownedScope(bound, normalized.areaIds));
    const current = readDescriptor(bound);
    const pointer = readOwnership(bound);
    if (pointer) requireConsistent(pointer, current.workspace, current.content);
    const resolved = resolveOwnedAreas(current.workspace,
      normalized.workspace.areas);
    const changed = canonicalJSON(resolved)
      !== canonicalJSON(current.workspace.areas);
    const next = deriveNextWorkspace(current.workspace, resolved,
      new Date().toISOString());
    ownedDocumentBytes(next, 'workspace source');
    ownedDocumentBytes(ownershipDoc(next.workspaceId, next.revision,
      'a'.repeat(64), '00000000-0000-0000-0000-000000000000', null,
      '00000000-0000-0000-0000-000000000000',
      next.updatedAt), 'workspace ownership');
    return { mode: 'dry-run', record: next, sourceRel, pointerRel,
      enrolled: pointer !== null, changed, reservesIds: false };
  }

  function update(input) {
    const normalized = normalizeInput(input);
    const bound = bind();
    const authorized = authorizeScope(bound,
      ownedScope(bound, normalized.areaIds));
    const current = readDescriptor(bound);
    let pointer = readOwnership(bound);
    if (pointer) requireConsistent(pointer, current.workspace, current.content);
    const resolved = resolveOwnedAreas(current.workspace,
      normalized.workspace.areas);
    if (canonicalJSON(resolved) === canonicalJSON(current.workspace.areas)) {
      return { mode: 'unchanged', record: cloneRecordJSON(current.workspace),
        journal: null };
    }
    if (!pointer) {
      // Lazy enrollment: the genesis pointer records the CAS-verified
      // current bytes as the owned base inside the journal itself.
      const genesis = applyJournaledRecordCreation(bound, (identity) => {
        const doc = ownershipDoc(current.workspace.workspaceId,
          current.workspace.revision, sha256Hex(current.content),
          identity.operationId, null, identity.operationId,
          identity.createdAt);
        return [{ sourceKind: OWNERSHIP_KIND,
          recordId: current.workspace.workspaceId,
          sourceRevision: current.workspace.revision,
          areaIds: [...authorized.areaIds],
          file: { rel: pointerRel,
            content: ownedDocumentBytes(doc, 'workspace ownership') } }];
      });
      if (!(genesis.status === 'committed'
          && genesis.journalState === 'confirmed')) {
        // Uncertain enrollment receipt: surface it instead of tripping
        // the pending-op barrier on the update attempt.
        return { mode: 'applied', record: cloneRecordJSON(current.workspace),
          sourceRel, pointerRel, updateApplied: false,
          updateConfirmed: false, journal: genesis };
      }
      pointer = readOwnership(bound);
    }
    const base = { workspaceHash: sha256Hex(current.content),
      pointerRevision: pointer.doc.revision,
      pointerHash: sha256Hex(pointer.bytes) };
    let built = null;
    const journal = applyJournaledRecordUpdate(bound, (identity) => {
      // Fresh UUIDs and the kernel timestamp are generated once, inside
      // the strict callback; identity fields are carried over verbatim.
      const next = deriveNextWorkspace(current.workspace,
        resolveOwnedAreas(current.workspace, normalized.workspace.areas),
        identity.createdAt);
      const nextBytes = ownedDocumentBytes(next, 'workspace source');
      const nextPointer = ownershipDoc(next.workspaceId, next.revision,
        sha256Hex(nextBytes), identity.operationId,
        pointer.doc.operationId, pointer.doc.createOperationId,
        identity.createdAt);
      const nextPointerBytes = ownedDocumentBytes(nextPointer,
        'workspace ownership');
      built = { record: next };
      return [
        { sourceKind: OWNED_KIND, recordId: current.workspace.workspaceId,
          sourceRevision: current.workspace.revision,
          previousHash: base.workspaceHash,
          areaIds: [...authorized.areaIds],
          file: { rel: sourceRel, content: nextBytes } },
        { sourceKind: OWNERSHIP_KIND, recordId: current.workspace.workspaceId,
          sourceRevision: base.pointerRevision,
          previousHash: base.pointerHash,
          areaIds: [...authorized.areaIds],
          file: { rel: pointerRel, content: nextPointerBytes } },
      ];
    });
    return { mode: 'applied', record: built ? built.record : null,
      sourceRel, pointerRel, updateApplied: true,
      updateConfirmed: journal.status === 'committed'
        && journal.journalState === 'confirmed',
      journal };
  }

  // Full provenance proof without operations enumeration: the pointer
  // names the tip operation and links every earlier update back to the
  // single-event genesis enrollment. Each committed op is replayed - the
  // pointer snapshot must byte-equal the linked document, both event
  // streams chain by revision and pre-image hash, every intermediate
  // descriptor snapshot is re-validated with frozen identity fields -
  // and the tip descriptor snapshot must equal the current bytes.
  function get() {
    const bound = bind();
    authorizeScope(bound, ownedScope(bound, opts.areaIds));
    const current = readDescriptor(bound);
    const pointer = readOwnership(bound);
    if (!pointer) {
      throw err(OWNED_MISSING,
        'workspace has no journaled ownership proof');
    }
    requireConsistent(pointer, current.workspace, current.content);
    const workspaceId = current.workspace.workspaceId;
    let tipHop = null;
    let firstUpdate = null;
    let genesisDoc = null;
    for (const hop of walkOwnedLinked(bound, pointer.doc, pointer.bytes, {
      sourceKind: OWNED_KIND, sidecarKind: OWNERSHIP_KIND,
      recordId: workspaceId, sourceRel, sidecarRel: pointerRel,
      code: OWNED_MALFORMED, notCommittedCode: OWNED_UNCOMMITTED,
      label: 'workspace', singleEventGenesis: true,
      maxOps: loadLimits().maxSessionEvents + 1,
      parseLink: (bytes) => validateOwnershipDoc(
        parseOwnedJson(bytes, OWNED_MALFORMED, 'workspace ownership')),
      previousIdOf: (doc) => doc.previousOperationId,
      checkLink: (next, cursor) => {
        if (next.workspaceId !== workspaceId
            || next.createOperationId !== cursor.createOperationId) {
          throw err(OWNED_MALFORMED,
            'workspace ownership link does not match this record');
        }
      },
    })) {
      const { cursor, loaded, source, sidecar, isGenesis } = hop;
      if (cursor.workspaceId !== workspaceId
          || resultingSourceRevision(sidecar, OWNED_MALFORMED)
            !== cursor.revision
          || cursor.updatedAt !== loaded.intent.createdAt
          || sidecar.createdAt !== loaded.intent.createdAt) {
        throw err(OWNED_MALFORMED,
          'workspace ownership does not match its operation');
      }
      if (hop.depth === 0) tipHop = hop;
      if (isGenesis) {
        genesisDoc = cursor;
        continue;
      }
      // Non-genesis hops carry the two-event update pair; the source
      // event must produce exactly the descriptor the pointer vouches.
      if (resultingSourceRevision(source, OWNED_MALFORMED) !== cursor.revision
          || source.sourceHash !== cursor.sourceHash) {
        throw err(OWNED_MALFORMED,
          'workspace source event does not match its pointer');
      }
      // Every intermediate descriptor snapshot is re-validated with the
      // identity fields frozen, so a rewritten history that preserves
      // hashes still fails closed on identity drift.
      const snapshot = readJournalSnapshot(bound, cursor.operationId,
        source.eventId);
      let record;
      try {
        const text = snapshot.toString('utf8');
        if (!Buffer.from(text, 'utf8').equals(snapshot)) {
          throw err(OWNED_MALFORMED,
            'workspace snapshot is not roundtrippable UTF-8');
        }
        record = validateWorkspace(JSON.parse(text));
      } catch (e) {
        if (e && e.code === OWNED_MALFORMED) throw e;
        throw err(OWNED_MALFORMED,
          `proven workspace snapshot failed validation: ${e.message}`);
      }
      if (record.workspaceId !== workspaceId
          || record.projectId !== current.workspace.projectId
          || record.repositoryId !== current.workspace.repositoryId
          || record.createdAt !== current.workspace.createdAt
          || record.revision !== cursor.revision
          || record.updatedAt !== loaded.intent.createdAt) {
        throw err(OWNED_MALFORMED,
          'workspace snapshot identity does not match its chain');
      }
      if (hop.depth === 0 && !snapshot.equals(current.content)) {
        throw err(OWNED_CHANGED,
          'workspace descriptor differs from its snapshot');
      }
      // Yields run tip -> genesis, so this ends as the update hop that
      // directly follows the single-event genesis enrollment.
      firstUpdate = hop;
    }
    if (firstUpdate) {
      // The pointer stream chains genesis->first update inside the walk;
      // the descriptor stream has no genesis event, so the first update
      // must declare the genesis-anchored base as its exact pre-image.
      validateRecordTransition({
        operation: 'create', sourceKind: OWNED_KIND,
        recordId: workspaceId, sourceRevision: genesisDoc.revision,
        sourceHash: genesisDoc.sourceHash,
      }, firstUpdate.source, OWNED_MALFORMED);
    }
    return { record: cloneRecordJSON(current.workspace),
      locator: { operationId: tipHop.cursor.operationId,
        eventId: (tipHop.source ?? tipHop.sidecar).eventId },
      journaled: tipHop.source !== null, isCurrentSource: true,
      memoryConsulted: false };
  }

  return Object.freeze({ prepare, update, get });
}
