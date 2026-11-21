// SPDX-License-Identifier: Apache-2.0
// Distribution machinery (spec-kit catalog/bundle/extension/preset
// parity), constrained to local file:// sources — the remote boundary is
// explicit: http(s) catalog URIs are validated but refused at load, and
// install_allowed flags mark entries a future remote layer may fetch.
// Everything here is declarative: validation, composition and planning;
// never download or execute.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { err } from './errors.mjs';
import { assertSafeId } from './identifiers.mjs';
import { resolveInside } from './paths.mjs';
import { loadWorkspaceCatalog } from './catalog.mjs';
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

// Preset override targets: '*', '<kind>/*' or '<kind>/<id>'.
const RESOURCE_KINDS = new Set(['agent', 'command', 'mcp', 'profile',
  'prompt', 'reference', 'rule', 'skill']);
const TARGET_RE = /^[a-z]+\/[a-z0-9][a-z0-9-]{0,63}$/;

function validateOverrideTarget(t, label) {
  if (t === '*') return;
  if (typeof t !== 'string'
      || !(TARGET_RE.test(t) || /^[a-z]+\/\*$/.test(t))) {
    throw err('INVALID_VALUE',
      `${label} must be '*', '<kind>/*' or '<kind>/<id>'`);
  }
  const kind = t.split('/', 1)[0];
  if (!RESOURCE_KINDS.has(kind)) {
    throw err('INVALID_VALUE', `${label} has unknown kind '${kind}'`);
  }
}

// Select the override layers from a preset list matching kind/id, in
// ascending priority order (higher priority applies last, consistent
// with the catalog stack). Returns layers plus an audit trail.
export function presetLayers(presets, kind, id) {
  const key = `${kind}/${id}`.toLowerCase();
  const layers = [];
  const applied = [];
  for (const p of presets.slice()
    .sort((a, b) => a.priority - b.priority)) {
    for (const o of p.overrides) {
      const t = o.target.toLowerCase();
      if (t === '*' || t === key
          || (t.endsWith('/*') && key.startsWith(t.slice(0, -1)))) {
        layers.push(o);
        applied.push({ preset: p.id, target: o.target, op: o.op });
      }
    }
  }
  return { layers, applied };
}

export function applyPresets(ctx, kind, id, text) {
  const { layers, applied } =
    presetLayers(listRegistry(ctx, 'presets'), kind, id);
  return { text: composeResource(text, layers), applied };
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
  const contributes = Array.isArray(input.contributes)
    ? input.contributes : [];
  for (const [i, c] of contributes.entries()) {
    if (!TARGET_RE.test(c ?? '')) {
      throw err('INVALID_VALUE',
        `extension.contributes[${i}] must be '<kind>/<id>'`);
    }
    if (!RESOURCE_KINDS.has(c.split('/', 1)[0])) {
      throw err('INVALID_VALUE',
        `extension.contributes[${i}] has unknown kind`);
    }
  }
  const reg = loadRegistry(ctx, 'extensions');
  if (reg.extensions.some((e) => e.id === doc.id)) {
    throw err('CONFLICT', `extension '${doc.id}' already registered`);
  }
  reg.extensions.push({
    ...doc, lifecycle, contributes, state: 'registered',
    registeredAt: new Date().toISOString(),
  });
  saveRegistry(ctx, 'extensions', reg);
  return Object.freeze(reg.extensions.at(-1));
}

// Lifecycle: registered -> active <-> disabled. Activation validates the
// extension's contributed resource ids against the workspace catalog —
// an extension cannot go active claiming resources that do not exist.
export function setExtensionState(ctx, id, state) {
  if (!['active', 'disabled'].includes(state)) {
    throw err('INVALID_VALUE', "state must be 'active' or 'disabled'");
  }
  assertSafeId(id, 'extension id');
  const reg = loadRegistry(ctx, 'extensions');
  const ext = reg.extensions.find((e) => e.id === id);
  if (!ext) throw err('NOT_FOUND', `extension '${id}' not registered`);
  if (state === 'active' && ext.contributes.length > 0) {
    const cat = loadWorkspaceCatalog(ctx);
    const missing = ext.contributes
      .filter((c) => !cat.byKey.has(c.toLowerCase()));
    if (missing.length > 0) {
      throw err('NOT_FOUND',
        `extension contributes unknown resources: ${missing.join(', ')}`);
    }
  }
  ext.state = state;
  ext[`${state === 'active' ? 'activat' : 'deactivat'}edAt`] =
    new Date().toISOString();
  saveRegistry(ctx, 'extensions', reg);
  return Object.freeze(ext);
}

// Preset: an installed override layer with priority — consumed through
// applyPresets at resource-projection time (workflow packets).
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
    validateOverrideTarget(o.target, `preset.overrides[${i}].target`);
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

// ---- bundle install (file:// only, bounded, provenance-recorded) -------
const MAX_BUNDLE_FILES = 256;
const MAX_BUNDLE_TOTAL = 16 * 1024 * 1024; // 16 MiB per bundle install

function sha256File(abs) {
  return crypto.createHash('sha256')
    .update(fs.readFileSync(abs)).digest('hex');
}

// Collect the regular files of a file:// source (file or dir), bounded.
function collectSourceFiles(abs, relBase) {
  const st = fs.lstatSync(abs);
  if (st.isSymbolicLink()) {
    throw err('INVALID_PATH', `bundle source contains a link: ${relBase}`);
  }
  if (st.isFile()) return [{ rel: relBase, abs }];
  if (!st.isDirectory()) {
    throw err('INVALID_PATH', `bundle source is not file/dir: ${relBase}`);
  }
  const out = [];
  for (const name of fs.readdirSync(abs).sort()) {
    out.push(...collectSourceFiles(
      path.join(abs, name), `${relBase}/${name}`));
  }
  return out;
}

// Resolve the bundle's requires against the local stack and produce an
// install plan: [{id, rel, sha256}]. Dry-run by default; apply copies the
// files under <configDir>/bundles/<bundle-id>/ and records provenance.
export function installBundle(ctx, bundleDoc, sources, { apply = false } = {}) {
  const stack = loadCatalogStack(ctx, sources);
  const catalogIds = new Set(stack.entries.map((e) => e.id));
  const bundle = validateBundle(bundleDoc, catalogIds);
  if (bundle.missing.length > 0) {
    throw err('NOT_FOUND',
      `bundle requires missing entries: ${bundle.missing.join(', ')}`);
  }
  const limits = loadLimits();
  const files = [];
  let totalBytes = 0;
  for (const req of bundle.requires) {
    const entry = stack.entries.find((e) => e.id === req.id);
    const uri = entry?.source?.uri ?? '';
    if (!uri.startsWith('file://')) {
      throw err('INVALID_VALUE',
        `entry '${req.id}' has no installable file:// source`);
    }
    const abs = resolveInside(
      ctx.projectRoot, uri.slice('file://'.length), 'bundle entry');
    const st = lstatOrNull(abs);
    if (!st) throw err('NOT_FOUND', `bundle source for '${req.id}' missing`);
    const collected = collectSourceFiles(abs, req.id);
    for (const f of collected) {
      const fSt = fs.lstatSync(f.abs);
      if (fSt.size > limits.maxDocumentBytes) {
        throw err('DOCUMENT_TOO_LARGE',
          `bundle file exceeds limit: ${f.rel}`);
      }
      totalBytes += fSt.size;
      if (files.length >= MAX_BUNDLE_FILES
          || totalBytes > MAX_BUNDLE_TOTAL) {
        throw err('BUNDLE_TOO_LARGE',
          `bundle '${bundle.id}' exceeds install bounds`);
      }
      const sha = sha256File(f.abs);
      if (req.sha256 && f.rel === req.id && sha !== req.sha256) {
        throw err('HASH_MISMATCH',
          `bundle entry '${req.id}' sha256 mismatch`);
      }
      files.push({ rel: f.rel, abs: f.abs, sha256: sha });
    }
  }
  const destRel = `${ctx.configDir}/bundles/${bundle.id}`;
  const destAbs = resolveInside(ctx.projectRoot, destRel, 'bundle install');
  const plan = files.map((f) => ({
    rel: `${destRel}/${f.rel}`, sha256: f.sha256,
    exists: fs.existsSync(path.join(destAbs, f.rel)),
  }));
  if (!apply) {
    return Object.freeze({ mode: 'dry-run', applied: false,
      bundle: { id: bundle.id, version: bundle.version },
      files: plan });
  }
  // Apply: create-only per file — existing bytes are never overwritten.
  for (const [i, f] of files.entries()) {
    const dest = path.join(destAbs, f.rel);
    const st = lstatOrNull(dest);
    if (st) {
      if (!st.isFile() || st.isSymbolicLink()
          || sha256File(dest) !== f.sha256) {
        throw err('CONFLICT',
          `bundle install destination diverged: ${plan[i].rel}`);
      }
      continue; // identical content already installed — idempotent
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, fs.readFileSync(f.abs), { flag: 'wx' });
    try { fs.renameSync(tmp, dest); }
    catch (e) {
      try { fs.unlinkSync(tmp); } catch { /* best effort */ }
      throw e;
    }
  }
  // Provenance is content-addressed: identical inputs produce identical
  // bytes, which is what makes re-install a no-op rather than a conflict.
  const provenance = {
    schemaVersion: 1, id: bundle.id, version: bundle.version,
    requires: bundle.requires, contributes: bundle.contributes,
    files: plan.map((p) => ({ rel: p.rel, sha256: p.sha256 })),
  };
  const provAbs = resolveInside(ctx.projectRoot,
    `${destRel}/provenance.json`, 'bundle provenance');
  const provBytes = JSON.stringify(provenance, null, 2) + '\n';
  const provExisting = lstatOrNull(provAbs);
  if (provExisting) {
    // Re-install: identical provenance is a no-op; different bytes under
    // the same bundle id mean divergent content — refuse to clobber.
    const prev = readFileLimited(provAbs, limits.maxDocumentBytes);
    if (prev.exceeded || prev.content.toString('utf8') !== provBytes) {
      throw err('CONFLICT',
        `bundle '${bundle.id}' provenance diverged; refusing to overwrite`);
    }
  } else {
    fs.writeFileSync(provAbs, provBytes, { flag: 'wx' });
  }
  return Object.freeze({ mode: 'applied', applied: true,
    bundle: { id: bundle.id, version: bundle.version },
    files: plan, provenance: `${destRel}/provenance.json` });
}
