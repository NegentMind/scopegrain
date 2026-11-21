// SPDX-License-Identifier: Apache-2.0
// Distribution machinery (spec-kit catalog/bundle/extension/preset
// parity), constrained to local file:// sources — the remote boundary is
// explicit: http(s) catalog URIs are validated but refused at load, and
// install_allowed flags mark entries a future remote layer may fetch.
// Everything here is declarative: validation, composition and planning;
// never download or execute.

import fs from 'node:fs';
import path from 'node:path';
import { err } from './errors.mjs';
import { assertSafeId } from './identifiers.mjs';
import { resolveInside } from './paths.mjs';
import {
  lstatOrNull, readFileLimited, decodeUtf8Strict,
} from './fsx.mjs';
import { loadLimits } from './policy.mjs';

const SEMVER_RE = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const SHA_RE = /^[0-9a-f]{64}$/;
const OPS = new Set(['replace', 'prepend', 'append', 'wrap']);

// ---- D7: catalog submission validation ---------------------------------
// {id, version, source:{uri, sha256}, description?, install_allowed}
export function validateSubmission(doc, label = 'submission', extraKeys = []) {
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    throw err('INVALID_VALUE', `${label} must be an object`);
  }
  for (const k of Object.keys(doc)) {
    if (!['schemaVersion', 'id', 'version', 'source', 'description',
      'install_allowed', 'entries', ...extraKeys].includes(k)) {
      throw err('UNKNOWN_KEY', `${label} has unknown key '${k}'`);
    }
  }
  assertSafeId(doc.id, `${label}.id`);
  if (!SEMVER_RE.test(doc.version ?? '')) {
    throw err('INVALID_VALUE', `${label}.version must be semver x.y.z`);
  }
  const s = doc.source;
  if (s === null || typeof s !== 'object' || typeof s.uri !== 'string') {
    throw err('INVALID_VALUE', `${label}.source.uri required`);
  }
  const remote = s.uri.startsWith('http://') || s.uri.startsWith('https://');
  const local = s.uri.startsWith('file://');
  if (!remote && !local) {
    throw err('INVALID_VALUE',
      `${label}.source.uri must be file:// or https://`);
  }
  // URL pinning: remote sources MUST pin a sha256; local sources SHOULD.
  if (remote && !SHA_RE.test(s.sha256 ?? '')) {
    throw err('PIN_REQUIRED',
      `${label} remote source requires a pinned sha256`);
  }
  if (s.sha256 !== undefined && !SHA_RE.test(s.sha256)) {
    throw err('INVALID_VALUE', `${label}.source.sha256 must be 64 hex`);
  }
  if (doc.install_allowed !== undefined
      && typeof doc.install_allowed !== 'boolean') {
    throw err('INVALID_VALUE', `${label}.install_allowed must be boolean`);
  }
  return {
    id: doc.id, version: doc.version,
    source: { uri: s.uri, sha256: s.sha256 ?? null, remote },
    install_allowed: doc.install_allowed ?? false,
    description: typeof doc.description === 'string' ? doc.description : '',
  };
}

// ---- D3: multi-source catalog stack (file:// only) ----------------------
// Stack entries come from config.catalogs: [{uri, priority}]. Remote URIs
// validate but refuse to load — the remote boundary is a hard error, not
// silent skip, so a config cannot imply network access.
export function loadCatalogStack(ctx, sources) {
  if (!Array.isArray(sources)) {
    throw err('INVALID_VALUE', 'catalog sources must be an array');
  }
  const layers = [];
  for (const [i, src] of sources.entries()) {
    if (src === null || typeof src !== 'object' || typeof src.uri !== 'string') {
      throw err('INVALID_VALUE', `catalogs[${i}].uri required`);
    }
    if (src.uri.startsWith('http://') || src.uri.startsWith('https://')) {
      throw err('REMOTE_CATALOG_UNSUPPORTED',
        `catalogs[${i}] is remote; remote catalogs are not supported — `
        + 'download manually and reference file://');
    }
    if (!src.uri.startsWith('file://')) {
      throw err('INVALID_VALUE', `catalogs[${i}].uri must be file://`);
    }
    const rel = src.uri.slice('file://'.length);
    const abs = resolveInside(ctx.projectRoot, rel, 'catalog source');
    const st = lstatOrNull(abs);
    if (!st || st.isSymbolicLink() || !st.isFile()) {
      throw err('NOT_FOUND', `catalog source ${rel} not found`);
    }
    const l = readFileLimited(abs, loadLimits().maxDocumentBytes);
    if (l.exceeded) throw err('DOCUMENT_TOO_LARGE', rel);
    const doc = JSON.parse(decodeUtf8Strict(
      l.content, 'CATALOG_MALFORMED', rel));
    if (doc === null || typeof doc !== 'object'
        || !Array.isArray(doc.entries)) {
      throw err('CATALOG_MALFORMED', `${rel} requires {entries:[]}`);
    }
    layers.push({
      uri: src.uri, priority: src.priority ?? i,
      entries: doc.entries.map((e) => ({
        ...e, _layer: i, _uri: src.uri,
      })),
    });
  }
  // Highest priority wins per id; stable order by layer then entry.
  layers.sort((a, b) => a.priority - b.priority);
  const merged = new Map();
  for (const layer of layers) {
    for (const e of layer.entries) merged.set(e.id, e);
  }
  return Object.freeze({ layers: layers.length,
    entries: [...merged.values()] });
}

// ---- D2: layered resource composition ------------------------------------
export function composeResource(base, layers) {
  let text = String(base);
  for (const layer of layers) {
    if (layer === null || typeof layer !== 'object' || !OPS.has(layer.op)) {
      throw err('INVALID_VALUE', `layer op must be one of ${[...OPS]}`);
    }
    if (typeof layer.content !== 'string') {
      throw err('INVALID_VALUE', 'layer.content must be a string');
    }
    switch (layer.op) {
      case 'replace': text = layer.content; break;
      case 'prepend': text = layer.content + text; break;
      case 'append': text = text + layer.content; break;
      case 'wrap': {
        const [pre, post] = layer.content.split('{{BODY}}');
        if (pre === undefined || post === undefined) {
          throw err('INVALID_VALUE', 'wrap content requires {{BODY}}');
        }
        text = pre + text + post;
        break;
      }
      default: break;
    }
  }
  return text;
}

// ---- D4: bundles ----------------------------------------------------------
// {id, version, requires:[{id, sha256}], contributes:[id]}
export function validateBundle(doc, catalogIds) {
  const v = validateSubmission(
    { ...doc, source: doc.source ?? { uri: 'file://bundle' } },
    'bundle', ['requires', 'contributes']);
  if (!Array.isArray(doc.requires)) {
    throw err('INVALID_VALUE', 'bundle.requires must be an array');
  }
  const missing = [];
  for (const [i, r] of doc.requires.entries()) {
    if (r === null || typeof r !== 'object') {
      throw err('INVALID_VALUE', `bundle.requires[${i}].id invalid`);
    }
    assertSafeId(r.id, `bundle.requires[${i}].id`);
    if (r.sha256 !== undefined && !SHA_RE.test(r.sha256)) {
      throw err('INVALID_VALUE', `bundle.requires[${i}].sha256 invalid`);
    }
    if (catalogIds && !catalogIds.has(r.id)) missing.push(r.id);
  }
  return Object.freeze({ ...v, requires: doc.requires,
    contributes: Array.isArray(doc.contributes) ? doc.contributes : [],
    missing });
}

// ---- D5/D6: extension + preset registries ---------------------------------
const REGISTRY_RELS = {
  extensions: 'extensions.json',
  presets: 'presets.json',
};

function loadRegistry(ctx, kind) {
  const rel = `${ctx.configDir}/${REGISTRY_RELS[kind]}`;
  const abs = resolveInside(ctx.projectRoot, rel, `${kind} registry`);
  const st = lstatOrNull(abs);
  if (!st) return { schemaVersion: 1, [kind]: [] };
  if (st.isSymbolicLink() || !st.isFile()) {
    throw err('INVALID_PATH', `${rel} is not a regular file`);
  }
  const l = readFileLimited(abs, loadLimits().maxDocumentBytes);
  if (l.exceeded) throw err('DOCUMENT_TOO_LARGE', rel);
  const doc = JSON.parse(decodeUtf8Strict(l.content, 'MALFORMED', rel));
  if (doc === null || typeof doc !== 'object'
      || !Array.isArray(doc[kind])) {
    throw err('MALFORMED', `${rel} has invalid shape`);
  }
  return doc;
}

function saveRegistry(ctx, kind, doc) {
  const abs = resolveInside(ctx.projectRoot,
    `${ctx.configDir}/${REGISTRY_RELS[kind]}`, `${kind} registry`);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n', { flag: 'wx' });
  try { fs.renameSync(tmp, abs); }
  catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* best effort */ }
    throw e;
  }
}

// Extension declaration: {id, version, lifecycle:{onInstall?,onActivate?},
// contributes:[ids]} — declarative; hooks are data labels only.
export function registerExtension(ctx, input) {
  const doc = validateSubmission(
    { ...input, source: input?.source ?? { uri: 'file://local' } },
    'extension', ['lifecycle', 'contributes']);
  const lifecycle = input.lifecycle ?? {};
  for (const k of Object.keys(lifecycle)) {
    if (!['onInstall', 'onActivate', 'onRemove'].includes(k)) {
      throw err('UNKNOWN_KEY', `extension.lifecycle unknown key '${k}'`);
    }
  }
  const reg = loadRegistry(ctx, 'extensions');
  if (reg.extensions.some((e) => e.id === doc.id)) {
    throw err('CONFLICT', `extension '${doc.id}' already registered`);
  }
  reg.extensions.push({
    ...doc, lifecycle,
    contributes: Array.isArray(input.contributes) ? input.contributes : [],
    registeredAt: new Date().toISOString(),
  });
  saveRegistry(ctx, 'extensions', reg);
  return Object.freeze(reg.extensions.at(-1));
}

// Preset: an installed override layer with priority — applied through
// composeResource at projection time by consumers.
export function registerPreset(ctx, input) {
  if (input === null || typeof input !== 'object'
      || !Array.isArray(input.overrides)) {
    throw err('INVALID_VALUE', 'preset requires {id, overrides:[]}');
  }
  assertSafeId(input.id, 'preset.id');
  for (const [i, o] of input.overrides.entries()) {
    if (o === null || typeof o !== 'object' || !OPS.has(o.op)) {
      throw err('INVALID_VALUE',
        `preset.overrides[${i}] requires a valid op`);
    }
  }
  const reg = loadRegistry(ctx, 'presets');
  if (reg.presets.some((p) => p.id === input.id)) {
    throw err('CONFLICT', `preset '${input.id}' already registered`);
  }
  reg.presets.push({
    id: input.id, priority: input.priority ?? 0,
    overrides: input.overrides,
    registeredAt: new Date().toISOString(),
  });
  saveRegistry(ctx, 'presets', reg);
  return Object.freeze(reg.presets.at(-1));
}

export function listRegistry(ctx, kind) {
  return loadRegistry(ctx, kind)[kind];
}
