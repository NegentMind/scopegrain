import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { err } from './errors.mjs';
import { lstatOrNull, readFileLimited } from './fsx.mjs';
import { assertDestination, resolveInside, resolveProjectRoot } from './paths.mjs';
import { loadLimits } from './policy.mjs';
import { canonicalDigest } from './digests.mjs';

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
  let value;
  try {
    value = JSON.parse(limited.content.toString('utf8'));
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

function rootIdentity(root) {
  const resolved = resolveProjectRoot(root);
  if (resolved !== path.resolve(root)) {
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
