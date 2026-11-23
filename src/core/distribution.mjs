// SPDX-License-Identifier: Apache-2.0
// Distribution machinery (spec-kit catalog/bundle/extension/preset
// parity), constrained to local file:// sources — the remote boundary is
// CLOSED by design, not deferred: http(s) catalog URIs validate their
// shape but refuse at load (REMOTE_CATALOG_UNSUPPORTED), and no inert
// "future remote" flags exist. Everything here is declarative:
// validation, composition and planning; never download or execute.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { err } from './errors.mjs';
import { assertSafeId } from './identifiers.mjs';
import { configRel, isInside, resolveInside } from './paths.mjs';
import { loadWorkspaceCatalog } from './catalog.mjs';
import {
  applyJournaledCreation, applyJournaledRecordUpdate,
} from './journal.mjs';
import { bindWorkspace, getWorkspace } from './workspaces.mjs';
import {
  lstatOrNull, readFileLimited, decodeUtf8Strict,
} from './fsx.mjs';
import { loadLimits } from './policy.mjs';
import {
  acquireVerifiedLock, releaseVerifiedLock,
} from './locks.mjs';

const SEMVER_RE = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const SHA_RE = /^[0-9a-f]{64}$/;
const OPS = new Set(['replace', 'prepend', 'append', 'wrap',
  'replace-section']);

// ---- D7: catalog submission validation ---------------------------------
// {id, version, source:{uri, sha256}, description?}
export function validateSubmission(doc, label = 'submission', extraKeys = []) {
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    throw err('INVALID_VALUE', `${label} must be an object`);
  }
  for (const k of Object.keys(doc)) {
    if (!['schemaVersion', 'id', 'version', 'source', 'description',
      'entries', ...extraKeys].includes(k)) {
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
  return {
    id: doc.id, version: doc.version,
    source: { uri: s.uri, sha256: s.sha256 ?? null, remote },
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
      case 'replace-section': {
        text = replaceSection(text, layer.selector, layer.content);
        break;
      }
      default: break;
    }
  }
  return text;
}

// replace-section: bounded Markdown section override (spec-kit parity).
// `selector` is a lowercase heading anchor; the override replaces the BODY
// under the first matching heading — everything from after the heading line
// to the next heading at the same or higher level, or EOF. Subordinate
// sections are part of that body; the heading itself is preserved. An empty
// content deletes the body. No matching heading leaves the text unchanged —
// a '*' target must not fail per-resource on documents lacking the section.
const SELECTOR_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const HEADING_RE = /^(#{1,6})[ \t]+(.*?)[ \t]*$/;
const anchorOf = (h) => h.toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

function replaceSection(text, selector, content) {
  if (typeof selector !== 'string' || !SELECTOR_RE.test(selector)) {
    throw err('INVALID_VALUE',
      'replace-section requires a lowercase anchor selector');
  }
  const lines = String(text).split('\n');
  let head = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = HEADING_RE.exec(lines[i]);
    if (m && anchorOf(m[2]) === selector) {
      head = i;
      level = m[1].length;
      break;
    }
  }
  if (head === -1) return String(text);
  let end = lines.length;
  for (let j = head + 1; j < lines.length; j++) {
    const m = HEADING_RE.exec(lines[j]);
    if (m && m[1].length <= level) { end = j; break; }
  }
  const body = String(content);
  const merged = body === ''
    ? [...lines.slice(0, head + 1), ...lines.slice(end)]
    : [...lines.slice(0, head + 1),
      ...body.replace(/\n+$/, '').split('\n'), '', ...lines.slice(end)];
  return merged.join('\n');
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
  const rel = configRel(ctx, REGISTRY_RELS[kind]);
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

// ---- dist journal -------------------------------------------------------
// Append-only mutation trail for distribution state. Every registry/payload
// mutation under the dist lock records the previous file hash (CAS proof)
// and a monotonic revision. When the project has a bound workspace the
// registry write itself is routed through the shared journal kernel (real
// byte-level CAS + outbox events); without one the write stays local and
// this log is the authoritative trail. Deletions and payload files cannot
// be expressed as journal records — the dist journal covers them.
const DIST_JOURNAL_REL = 'dist-journal.jsonl';
const DIST_JOURNAL_MAX = 4 * 1024 * 1024;

function sha256Buf(b) {
  return crypto.createHash('sha256').update(b).digest('hex');
}

function atomicWriteFile(abs, bytes) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, bytes, { flag: 'wx' });
  try { fs.renameSync(tmp, abs); }
  catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* best effort */ }
    throw e;
  }
}

function distJournalAbs(ctx) {
  return resolveInside(ctx.projectRoot,
    configRel(ctx, DIST_JOURNAL_REL), 'dist journal');
}

// Bounded scan of the trail: highest global revision plus the highest
// revision recorded for one registry (its journaled sourceRevision).
function distJournalState(ctx, registry) {
  const abs = distJournalAbs(ctx);
  const st = lstatOrNull(abs);
  const state = { last: 0, perRegistry: 0 };
  if (!st || !st.isFile() || st.isSymbolicLink()) return state;
  const l = readFileLimited(abs, DIST_JOURNAL_MAX * 2);
  if (l.exceeded) return state;
  for (const line of decodeUtf8Strict(l.content, 'MALFORMED',
    DIST_JOURNAL_REL).split('\n')) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (Number.isSafeInteger(e?.revision) && e.revision > state.last) {
      state.last = e.revision;
    }
    if (e?.registry === registry
        && Number.isSafeInteger(e?.revision)
        && e.revision > state.perRegistry) {
      state.perRegistry = e.revision;
    }
  }
  return state;
}

function distJournalAppend(ctx, entry, state) {
  const abs = distJournalAbs(ctx);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const line = JSON.stringify(
    { revision: state.last + 1, ...entry }) + '\n';
  const st = lstatOrNull(abs);
  if (st && st.isFile() && !st.isSymbolicLink()
      && st.size + line.length > DIST_JOURNAL_MAX) {
    // Compaction keeps the newest half of the bounded trail, atomic swap.
    const l = readFileLimited(abs, DIST_JOURNAL_MAX * 2);
    if (!l.exceeded) {
      const lines = decodeUtf8Strict(l.content, 'MALFORMED',
        DIST_JOURNAL_REL).split('\n').filter((x) => x.trim());
      const keep = lines.slice(Math.floor(lines.length / 2));
      atomicWriteFile(abs, Buffer.from(keep.join('\n') + '\n', 'utf8'));
    }
  }
  fs.appendFileSync(abs, line);
}

// Bounded reader for the mutation trail. Parse is tolerant (corrupt lines
// are reported, never fatal); filters narrow by registry/op/id; `chain`
// verifies the per-file CAS property — each entry's previousSha256 must
// equal the newest earlier newSha256 for the same rel (or be null when
// that file was first written). tail keeps only the newest N entries.
export function readDistJournal(ctx,
    { tail = null, registry = null, op = null, id = null } = {}) {
  const abs = distJournalAbs(ctx);
  const st = lstatOrNull(abs);
  if (!st) {
    return Object.freeze({ entries: [], corrupt: [], chain: 'empty' });
  }
  if (st.isSymbolicLink() || !st.isFile()) {
    throw err('INVALID_PATH', 'dist journal is not a regular file');
  }
  const l = readFileLimited(abs, DIST_JOURNAL_MAX * 2);
  if (l.exceeded) {
    throw err('DOCUMENT_TOO_LARGE', 'dist journal exceeds read bound');
  }
  const entries = [];
  const corrupt = [];
  decodeUtf8Strict(l.content, 'MALFORMED', DIST_JOURNAL_REL)
    .split('\n').forEach((line, i) => {
      if (!line.trim()) return;
      try {
        entries.push(JSON.parse(line));
      } catch {
        corrupt.push({ line: i + 1 });
      }
    });
  // Per-rel CAS chain: each write's previousSha256 must equal the most
  // recent earlier newSha256 for that file (null for a first write).
  const newest = new Map();
  let chainBroken = null;
  for (const e of entries) {
    if (typeof e?.rel !== 'string' || !Number.isSafeInteger(e?.revision)) {
      continue; // shape-tolerant: only real entries chain
    }
    const prev = newest.get(e.rel) ?? null;
    if (e.previousSha256 !== prev) {
      chainBroken = chainBroken ?? e.revision;
    }
    newest.set(e.rel, e.newSha256 ?? null);
  }
  let out = entries;
  if (registry) out = out.filter((e) => e.registry === registry);
  if (op) out = out.filter((e) => e.op === op);
  if (id) out = out.filter((e) => e.id === id);
  if (Number.isSafeInteger(tail) && tail >= 0) out = out.slice(-tail);
  return Object.freeze({
    entries: Object.freeze(out),
    corrupt: Object.freeze(corrupt),
    chain: entries.length === 0 ? 'empty'
      : chainBroken === null ? 'valid' : `broken@${chainBroken}`,
  });
}

// Best-effort bound workspace for the opt-in journaled path: a project
// without an enrolled workspace (or with no areas) simply writes locally;
// the dist journal still records the mutation with journaled:false.
function tryBindDist(ctx) {
  try {
    const ws = getWorkspace(ctx);
    const areaIds = (ws.areas ?? []).map((a) => a.id);
    if (areaIds.length === 0) return null;
    return bindWorkspace(ctx, { areaIds });
  } catch {
    return null;
  }
}

// Commit a registry JSON file under the dist lock. Bound workspace: the
// kernel enforces CAS (previousHash == current bytes) and emits events.
// Unbound: temp+rename directly. Either way the mutation lands in the
// dist journal with its previous/new hashes.
function commitRegistryFile(ctx, { registry, rel, bytes, op, id = null }) {
  const cfgRel = configRel(ctx, rel);
  const abs = resolveInside(ctx.projectRoot, cfgRel, `${registry} registry`);
  const st = lstatOrNull(abs);
  if (st && (st.isSymbolicLink() || !st.isFile())) {
    throw err('INVALID_PATH', `${cfgRel} is not a regular file`);
  }
  const prevBytes = st ? fs.readFileSync(abs) : null;
  const prevSha = prevBytes ? sha256Buf(prevBytes) : null;
  const state = distJournalState(ctx, registry);
  const bound = tryBindDist(ctx);
  let journaled = false;
  if (bound) {
    const change = {
      sourceKind: 'dist-registry', recordId: registry,
      areaIds: [...bound.areaIds],
      file: { rel: cfgRel, content: bytes },
    };
    if (prevSha === null) {
      applyJournaledCreation(bound,
        [{ ...change, sourceRevision: null }]);
    } else {
      applyJournaledRecordUpdate(bound, () => [{
        ...change, sourceRevision: state.perRegistry,
        previousHash: prevSha,
      }]);
    }
    journaled = true;
  } else {
    atomicWriteFile(abs, bytes);
  }
  distJournalAppend(ctx, {
    at: new Date().toISOString(), op, registry, id, rel: cfgRel,
    previousSha256: prevSha, newSha256: sha256Buf(bytes), journaled,
  }, state);
  return { journaled };
}

function saveRegistry(ctx, kind, doc, meta) {
  return commitRegistryFile(ctx, {
    registry: kind, rel: REGISTRY_RELS[kind],
    bytes: Buffer.from(JSON.stringify(doc, null, 2) + '\n', 'utf8'),
    op: meta?.op ?? 'registry-write', id: meta?.id ?? null,
  });
}

// Registry mutations are read-modify-write: hold the dist lock for the
// whole load+save cycle so two CLIs cannot interleave a lost update.
export function withDistLock(ctx, fn) {
  const lockAbs = resolveInside(ctx.projectRoot,
    configRel(ctx, 'dist.lock'), 'dist lock');
  fs.mkdirSync(path.dirname(lockAbs), { recursive: true });
  const lock = acquireVerifiedLock(lockAbs, 'DIST_LOCKED',
    'another distribution operation holds the lock');
  try { return fn(); }
  finally { releaseVerifiedLock(lock); }
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
  return withDistLock(ctx, () => {
    const reg = loadRegistry(ctx, 'extensions');
    if (reg.extensions.some((e) => e.id === doc.id)) {
      throw err('CONFLICT', `extension '${doc.id}' already registered`);
    }
    reg.extensions.push({
      ...doc, lifecycle, contributes, state: 'registered',
      registeredAt: new Date().toISOString(),
    });
    saveRegistry(ctx, 'extensions', reg,
      { op: 'extension-register', id: doc.id });
    return Object.freeze(reg.extensions.at(-1));
  });
}

// Removal is create-only symmetric: the entry must exist and be disabled
// (an active extension must be deactivated first — no silent teardown).
export function removeExtension(ctx, id) {
  assertSafeId(id, 'extension id');
  return withDistLock(ctx, () => {
    const reg = loadRegistry(ctx, 'extensions');
    const i = reg.extensions.findIndex((e) => e.id === id);
    if (i < 0) throw err('NOT_FOUND', `extension '${id}' not registered`);
    if (reg.extensions[i].state === 'active') {
      throw err('CONFLICT',
        `extension '${id}' is active; deactivate before removing`);
    }
    const removed = reg.extensions.splice(i, 1)[0];
    saveRegistry(ctx, 'extensions', reg,
      { op: 'extension-remove', id });
    return Object.freeze({ removed: removed.id });
  });
}

// Lifecycle: registered -> active <-> disabled. Activation validates the
// extension's contributed resource ids against the workspace catalog —
// an extension cannot go active claiming resources that do not exist.
export function setExtensionState(ctx, id, state) {
  if (!['active', 'disabled'].includes(state)) {
    throw err('INVALID_VALUE', "state must be 'active' or 'disabled'");
  }
  assertSafeId(id, 'extension id');
  return withDistLock(ctx, () => {
    const reg = loadRegistry(ctx, 'extensions');
    const ext = reg.extensions.find((e) => e.id === id);
    if (!ext) throw err('NOT_FOUND', `extension '${id}' not registered`);
    // Registry is disk state: a hand-edited contributes must not crash
    // or bypass validation with a non-array value.
    if (state === 'active' && !Array.isArray(ext.contributes)) {
      throw err('MALFORMED',
        `extension '${id}' registry record is malformed`);
    }
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
    delete ext.activatedAt;
    delete ext.deactivatedAt;
    ext[`${state === 'active' ? 'activat' : 'deactivat'}edAt`] =
      new Date().toISOString();
    saveRegistry(ctx, 'extensions', reg,
      { op: 'extension-state', id });
    return Object.freeze(ext);
  });
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
    if (o.op === 'replace-section'
        && (typeof o.selector !== 'string' || !SELECTOR_RE.test(o.selector))) {
      throw err('INVALID_VALUE',
        `preset.overrides[${i}].selector must be a lowercase anchor`);
    }
  }
  return withDistLock(ctx, () => {
    const reg = loadRegistry(ctx, 'presets');
    if (reg.presets.some((p) => p.id === input.id)) {
      throw err('CONFLICT', `preset '${input.id}' already registered`);
    }
    reg.presets.push({
      id: input.id, priority: input.priority ?? 0,
      overrides: input.overrides,
      registeredAt: new Date().toISOString(),
    });
    saveRegistry(ctx, 'presets', reg,
      { op: 'preset-register', id: input.id });
    return Object.freeze(reg.presets.at(-1));
  });
}

export function removePreset(ctx, id) {
  assertSafeId(id, 'preset id');
  return withDistLock(ctx, () => {
    const reg = loadRegistry(ctx, 'presets');
    const i = reg.presets.findIndex((p) => p.id === id);
    if (i < 0) throw err('NOT_FOUND', `preset '${id}' not registered`);
    const removed = reg.presets.splice(i, 1)[0];
    saveRegistry(ctx, 'presets', reg,
      { op: 'preset-remove', id });
    return Object.freeze({ removed: removed.id });
  });
}

export function listRegistry(ctx, kind) {
  return loadRegistry(ctx, kind)[kind];
}

// ---- bundle install (file:// only, bounded, provenance-recorded) -------
const MAX_BUNDLE_FILES = 256;
const MAX_BUNDLE_DEPTH = 32;
const MAX_BUNDLE_TOTAL = 16 * 1024 * 1024; // 16 MiB per bundle install
// Conventional main file per kind — how a directory source resolves to
// the single document a mounted catalog entry points at.
const KIND_MAIN = {
  skill: 'SKILL.md', agent: 'AGENT.md', command: 'COMMAND.md',
  rule: 'RULE.md', reference: 'REFERENCE.md', prompt: 'PROMPT.md',
  profile: 'PROFILE.json', mcp: 'MCP.json',
};

function sha256File(abs, maxBytes) {
  // fstat on the open fd bounds the read to the file we actually opened —
  // a post-lstat size blow-up cannot turn this into an unbounded read.
  const fd = fs.openSync(abs, 'r');
  try {
    const st = fs.fstatSync(fd);
    if (maxBytes !== undefined && st.size > maxBytes) {
      throw err('DOCUMENT_TOO_LARGE', `file exceeds limit: ${abs}`);
    }
    return crypto.createHash('sha256')
      .update(fs.readFileSync(fd)).digest('hex');
  } finally {
    fs.closeSync(fd);
  }
}

// Collect the regular files of a file:// source (file or dir), bounded
// in count, depth and bytes — incrementally, so a hostile wide tree
// aborts DURING traversal instead of after materializing it.
function collectSourceFiles(abs, relBase, state, depth = 0) {
  if (depth > MAX_BUNDLE_DEPTH) {
    throw err('BUNDLE_TOO_LARGE',
      `bundle source exceeds depth ${MAX_BUNDLE_DEPTH}: ${relBase}`);
  }
  const st = fs.lstatSync(abs);
  if (st.isSymbolicLink()) {
    throw err('INVALID_PATH', `bundle source contains a link: ${relBase}`);
  }
  if (st.isFile()) {
    state.count += 1;
    state.bytes += st.size;
    if (state.count > MAX_BUNDLE_FILES
        || state.bytes > MAX_BUNDLE_TOTAL) {
      throw err('BUNDLE_TOO_LARGE',
        `bundle source exceeds file/byte bounds: ${relBase}`);
    }
    state.out.push({ rel: relBase, abs, size: st.size });
    return;
  }
  if (!st.isDirectory()) {
    throw err('INVALID_PATH', `bundle source is not file/dir: ${relBase}`);
  }
  for (const name of fs.readdirSync(abs).sort()) {
    collectSourceFiles(
      path.join(abs, name), `${relBase}/${name}`, state, depth + 1);
  }
}

// Resolve the bundle's requires against the local stack and produce an
// install plan: [{id, rel, sha256}]. Dry-run by default; apply copies the
// files under <configDir>/bundles/<bundle-id>/ and records provenance.
// The apply phase holds the dist lock so provenance can never be read
// mid-write by a concurrent mount/uninstall.
export function installBundle(ctx, bundleDoc, sources, { apply = false } = {}) {
  const stack = loadCatalogStack(ctx, sources);
  const catalogIds = new Set(stack.entries.map((e) => e.id));
  const bundle = validateBundle(bundleDoc, catalogIds);
  if (bundle.missing.length > 0) {
    throw err('NOT_FOUND',
      `bundle requires missing entries: ${bundle.missing.join(', ')}`);
  }
  const limits = loadLimits();
  const state = { count: 0, bytes: 0, out: [] };
  const files = [];
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
    collectSourceFiles(abs, req.id, state);
    for (const f of state.out.splice(0)) {
      if (f.size > limits.maxDocumentBytes) {
        throw err('DOCUMENT_TOO_LARGE',
          `bundle file exceeds limit: ${f.rel}`);
      }
      const sha = sha256File(f.abs, limits.maxDocumentBytes);
      files.push({ rel: f.rel, abs: f.abs, sha256: sha });
    }
  }
  // File sources pin their own sha; directory sources pin their kind's
  // conventional main file. A declared pin that binds to NOTHING fails
  // closed — a pin that silently binds nothing is worse than no pin.
  for (const req of bundle.requires) {
    if (!req.sha256) continue;
    const entry = stack.entries.find((e) => e.id === req.id);
    const reqFiles = files.filter(
      (f) => f.rel === req.id || f.rel.startsWith(`${req.id}/`));
    const single = reqFiles.find((f) => f.rel === req.id);
    const mainFile = single ?? (KIND_MAIN[entry?.kind]
      ? reqFiles.find((f) => f.rel === `${req.id}/${KIND_MAIN[entry.kind]}`)
      : null);
    if (!mainFile) {
      throw err('HASH_MISMATCH',
        `bundle entry '${req.id}' pin binds to no file`);
    }
    if (mainFile.sha256 !== req.sha256) {
      throw err('HASH_MISMATCH',
        `bundle entry '${req.id}' sha256 mismatch`);
    }
  }
  const destRel = configRel(ctx, `bundles/${bundle.id}`);
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
  return withDistLock(ctx, () => {
    // Apply: create-only per file — existing bytes are never overwritten.
    // Each destination is RE-RESOLVED at write time: the ancestor chain
    // is re-verified right before use, shrinking the ancestor-swap window.
    for (const [i, f] of files.entries()) {
      const dest = resolveInside(ctx.projectRoot, plan[i].rel,
        'bundle install destination');
      const st = lstatOrNull(dest);
      if (st) {
        if (!st.isFile() || st.isSymbolicLink()
            || sha256File(dest, limits.maxDocumentBytes) !== f.sha256) {
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
    // bytes, which is what makes re-install a no-op rather than a
    // conflict. Written atomically — readers under the lock never see a
    // half-written provenance document.
    const provenance = {
      schemaVersion: 1, id: bundle.id, version: bundle.version,
      requires: bundle.requires, contributes: bundle.contributes,
      entries: bundle.requires.map((r) => {
        const e = stack.entries.find((x) => x.id === r.id);
        // File sources resolve to themselves; directory sources resolve
        // to the kind's conventional main file (else file stays null and
        // the entry cannot be mounted — reported, not guessed).
        const reqFiles = files.filter(
          (f) => f.rel === r.id || f.rel.startsWith(`${r.id}/`));
        const main = KIND_MAIN[e?.kind];
        const single = reqFiles.find((f) => f.rel === r.id);
        const mainFile = single
          ?? (main
            ? reqFiles.find((f) => f.rel === `${r.id}/${main}`) : null);
        return { id: r.id, kind: e?.kind ?? null,
          file: mainFile?.rel ?? null, sha256: mainFile?.sha256 ?? null,
          ...(Array.isArray(e?.modes) ? { modes: e.modes } : {}) };
      }),
      files: plan.map((p) => ({ rel: p.rel, sha256: p.sha256 })),
    };
    const provAbs = resolveInside(ctx.projectRoot,
      `${destRel}/provenance.json`, 'bundle provenance');
    const provBytes = JSON.stringify(provenance, null, 2) + '\n';
    const provExisting = lstatOrNull(provAbs);
    let prevProvSha = null;
    if (provExisting) {
      // Re-install: identical provenance is a no-op; different bytes
      // under the same bundle id mean divergent content — refuse to
      // clobber.
      const prev = readFileLimited(provAbs, limits.maxDocumentBytes);
      if (prev.exceeded || prev.content.toString('utf8') !== provBytes) {
        throw err('CONFLICT',
          `bundle '${bundle.id}' provenance diverged; refusing to overwrite`);
      }
      prevProvSha = sha256Buf(prev.content);
    } else {
      const tmp = `${provAbs}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, provBytes, { flag: 'wx' });
      try { fs.renameSync(tmp, provAbs); }
      catch (e) {
        try { fs.unlinkSync(tmp); } catch { /* best effort */ }
        throw e;
      }
    }
    // Payload write trail: the provenance bytes carry every file hash,
    // so its hash is the CAS anchor for the whole install.
    distJournalAppend(ctx, {
      at: new Date().toISOString(), op: 'bundle-install',
      registry: 'bundles', id: bundle.id,
      rel: `${destRel}/provenance.json`,
      previousSha256: prevProvSha,
      newSha256: sha256Buf(Buffer.from(provBytes, 'utf8')),
      journaled: false,
    }, distJournalState(ctx, 'bundles'));
    return Object.freeze({ mode: 'applied', applied: true,
      bundle: { id: bundle.id, version: bundle.version },
      files: plan, provenance: `${destRel}/provenance.json` });
  });
}

// ---- mounted catalog layer ------------------------------------------------
// <configDir>/mounted-catalog.json: entries contributed by installed
// bundles, merged into the workspace catalog at load time. Paths are
// configDir-relative (same resolution as snapshot entries).
const MOUNTED_REL = 'mounted-catalog.json';

export function loadMounted(ctx) {
  const rel = configRel(ctx, MOUNTED_REL);
  const abs = resolveInside(ctx.projectRoot, rel, 'mounted catalog');
  const st = lstatOrNull(abs);
  if (!st) return { schemaVersion: 1, entries: [] };
  if (st.isSymbolicLink() || !st.isFile()) {
    throw err('INVALID_PATH', `${rel} is not a regular file`);
  }
  const l = readFileLimited(abs, loadLimits().maxDocumentBytes);
  if (l.exceeded) throw err('DOCUMENT_TOO_LARGE', rel);
  const doc = JSON.parse(decodeUtf8Strict(l.content, 'MALFORMED', rel));
  if (doc === null || typeof doc !== 'object'
      || !Array.isArray(doc.entries)) {
    throw err('MALFORMED', `${rel} has invalid shape`);
  }
  return doc;
}

function saveMounted(ctx, doc, meta) {
  return commitRegistryFile(ctx, {
    registry: 'mounted-catalog', rel: MOUNTED_REL,
    bytes: Buffer.from(JSON.stringify(doc, null, 2) + '\n', 'utf8'),
    op: meta?.op ?? 'mounted-write', id: meta?.id ?? null,
  });
}

function loadProvenance(ctx, bundleId) {
  const rel = configRel(ctx, `bundles/${bundleId}/provenance.json`);
  const abs = resolveInside(ctx.projectRoot, rel, 'bundle provenance');
  const st = lstatOrNull(abs);
  if (!st || st.isSymbolicLink() || !st.isFile()) {
    throw err('NOT_FOUND', `bundle '${bundleId}' is not installed`);
  }
  const l = readFileLimited(abs, loadLimits().maxDocumentBytes);
  if (l.exceeded) throw err('DOCUMENT_TOO_LARGE', rel);
  return JSON.parse(decodeUtf8Strict(l.content, 'MALFORMED', rel));
}

// Mount an installed bundle: its typed entries join the workspace catalog
// so workflow packets and hosts resolve them like any snapshot resource.
// Directory sources mount their kind's conventional main file (recorded
// in provenance at install time); entries without one are reported, not
// silently dropped.
export function mountBundle(ctx, bundleId) {
  assertSafeId(bundleId, 'bundle id');
  return withDistLock(ctx, () => {
    const prov = loadProvenance(ctx, bundleId);
    // Provenance is disk data: a malformed entries array must not
    // persist a bad kind into mounted-catalog (which then breaks every
    // catalog load until hand-repaired).
    if (!Array.isArray(prov.entries)) {
      throw err('MALFORMED', `bundle '${bundleId}' provenance is malformed`);
    }
    const typed = prov.entries.filter((e) => e !== null
      && typeof e === 'object' && RESOURCE_KINDS.has(e.kind));
    const mounted = loadMounted(ctx);
    const snapshot = loadWorkspaceCatalog(ctx);
    const unmounted = [];
    for (const e of typed) {
      const key = `${e.kind}/${e.id}`.toLowerCase();
      if (typeof e.file !== 'string') {
        unmounted.push(key);
        continue;
      }
      // A mounted entry without a recorded sha would skip integrity
      // verification — provenance tampering to null must fail closed.
      if (typeof e.sha256 !== 'string' || !SHA_RE.test(e.sha256)) {
        throw err('MALFORMED',
          `bundle entry ${key} lacks a sha256 pin`);
      }
      // byKey includes already-mounted entries: re-mounting THIS bundle's
      // own entry is a refresh; snapshot ids and other bundles' ids are
      // real collisions.
      const existing = snapshot.byKey.get(key);
      if (existing && existing.bundle !== bundleId) {
        throw err('CONFLICT',
          `mounted entry ${key} collides with catalog`);
      }
      const i = mounted.entries.findIndex(
        (x) => `${x.kind}/${x.id}`.toLowerCase() === key);
      const fileRel = configRel(ctx, `bundles/${bundleId}/${e.file}`);
      const fileAbs = resolveInside(
        ctx.projectRoot, fileRel, 'mounted resource');
      const fst = lstatOrNull(fileAbs);
      if (!fst || fst.isSymbolicLink() || !fst.isFile()) {
        throw err('NOT_FOUND',
          `bundle file missing for ${key}: ${e.file}`);
      }
      const sha = sha256File(fileAbs);
      if (e.sha256 && sha !== e.sha256) {
        throw err('HASH_MISMATCH',
          `bundle file diverged for ${key}: ${e.file}`);
      }
      const entry = { kind: e.kind, id: e.id,
        path: `bundles/${bundleId}/${e.file}`, sha256: sha,
        bundle: bundleId,
        ...(Array.isArray(e.modes) ? { modes: e.modes } : {}) };
      if (i >= 0) mounted.entries[i] = entry;
      else mounted.entries.push(entry);
    }
    saveMounted(ctx, mounted, { op: 'bundle-mount', id: bundleId });
    return Object.freeze({ bundle: bundleId,
      mounted: typed.filter((e) => typeof e.file === 'string')
        .map((e) => `${e.kind}/${e.id}`),
      unmounted });
  });
}

function unmountInner(ctx, bundleId) {
  const mounted = loadMounted(ctx);
  const before = mounted.entries.length;
  mounted.entries = mounted.entries.filter(
    (e) => e.bundle !== bundleId);
  saveMounted(ctx, mounted, { op: 'bundle-unmount', id: bundleId });
  return { unmounted: before - mounted.entries.length,
    bundle: bundleId };
}

export function unmountBundle(ctx, bundleId) {
  assertSafeId(bundleId, 'bundle id');
  return withDistLock(ctx,
    () => Object.freeze(unmountInner(ctx, bundleId)));
}

// Uninstall: unmount, then delete only files still matching provenance —
// user-modified bytes are left behind, never clobbered.
export function uninstallBundle(ctx, bundleId, { keepFiles = false } = {}) {
  assertSafeId(bundleId, 'bundle id');
  return withDistLock(ctx, () => {
    const unmounted = unmountInner(ctx, bundleId);
    const provAbs0 = resolveInside(ctx.projectRoot,
      configRel(ctx, `bundles/${bundleId}/provenance.json`),
      'bundle provenance');
    const provSt = lstatOrNull(provAbs0);
    const provSha = (provSt && provSt.isFile() && !provSt.isSymbolicLink())
      ? sha256Buf(readFileLimited(provAbs0,
          loadLimits().maxDocumentBytes).content)
      : null;
    const prov = loadProvenance(ctx, bundleId);
    const deleted = [];
    const leftBehind = [];
    if (!keepFiles) {
      const baseRel = configRel(ctx, `bundles/${bundleId}`);
      for (const f of prov.files ?? []) {
        // Provenance is disk data: rel paths MUST stay inside the bundle
        // directory or a tampered provenance would delete unrelated files.
        // startsWith alone is bypassable via `bundles/x/../y` — check the
        // resolved path.
        if (typeof f.rel !== 'string') {
          throw err('MALFORMED', 'provenance file rel must be a string');
        }
        const bundleAbs = resolveInside(
          ctx.projectRoot, baseRel, 'bundle dir');
        const abs = resolveInside(
          ctx.projectRoot, f.rel, 'bundle uninstall');
        if (!isInside(bundleAbs, abs)) {
          throw err('MALFORMED',
            `provenance file outside bundle dir: ${f.rel}`);
        }
        const st = lstatOrNull(abs);
        if (!st) continue;
        if (st.isSymbolicLink() || !st.isFile()
            || sha256File(abs) !== f.sha256) {
          leftBehind.push(f.rel);
          continue;
        }
        fs.unlinkSync(abs);
        deleted.push(f.rel);
      }
      const provAbs = resolveInside(ctx.projectRoot,
        `${baseRel}/provenance.json`, 'bundle provenance');
      const pst = lstatOrNull(provAbs);
      if (pst && !pst.isSymbolicLink() && pst.isFile()) {
        fs.unlinkSync(provAbs);
        deleted.push(`${baseRel}/provenance.json`);
      }
    }
    distJournalAppend(ctx, {
      at: new Date().toISOString(), op: 'bundle-uninstall',
      registry: 'bundles', id: bundleId,
      rel: configRel(ctx, `bundles/${bundleId}/provenance.json`),
      previousSha256: provSha, newSha256: null, journaled: false,
      keepFiles,
    }, distJournalState(ctx, 'bundles'));
    return Object.freeze({ bundle: bundleId, ...unmounted,
      deleted, leftBehind });
  });
}

// ---- G7: distribution self-test ----------------------------------------
// End-to-end probe of the distribution loop (discovery -> validation ->
// dry-run -> install -> mount -> unmount -> uninstall) against a fixture
// generated inside the project and always removed afterwards. Each step
// is recorded pass/fail; the report is a diagnostic, not telemetry.
const SELFTEST_ID = 'scopegrain-selftest';

export function selfTestDist(ctx) {
  const steps = [];
  const scratchRel = configRel(ctx, 'selftest-scratch');
  const scratchAbs = resolveInside(
    ctx.projectRoot, scratchRel, 'selftest scratch');
  const bundleRel = configRel(ctx, `bundles/${SELFTEST_ID}`);
  const step = (name, fn) => {
    try {
      const detail = fn();
      steps.push({ step: name, ok: true, detail: detail ?? null });
      return true;
    } catch (e) {
      steps.push({ step: name, ok: false,
        error: { code: e.code ?? 'ERROR', message: String(e.message ?? e) } });
      return false;
    }
  };
  const cleanup = () => {
    try { fs.rmSync(scratchAbs, { recursive: true, force: true }); }
    catch { /* best effort */ }
    try {
      const bundleAbs = resolveInside(
        ctx.projectRoot, bundleRel, 'selftest bundle');
      fs.rmSync(bundleAbs, { recursive: true, force: true });
    } catch { /* best effort */ }
    // A mounted remnant must not stay behind: drop its entries if the
    // unmount step never ran.
    try {
      withDistLock(ctx, () => {
        const mounted = loadMounted(ctx);
        const filtered = mounted.entries.filter(
          (e) => e.bundle !== SELFTEST_ID);
        if (filtered.length !== mounted.entries.length) {
          mounted.entries = filtered;
          saveMounted(ctx, mounted,
            { op: 'selftest-cleanup', id: SELFTEST_ID });
        }
      });
    } catch { /* best effort */ }
  };
  try {
    const skillBody = '# selftest\nscopegrain distribution probe\n';
    const skillSha = sha256Buf(Buffer.from(skillBody, 'utf8'));
    step('prepare', () => {
      fs.mkdirSync(scratchAbs, { recursive: true });
      fs.writeFileSync(path.join(scratchAbs, 'SKILL.md'), skillBody);
      const cat = { entries: [{ id: 'selftest-skill', kind: 'skill',
        source: { uri: `file://${scratchRel}/SKILL.md` } }] };
      fs.writeFileSync(path.join(scratchAbs, 'cat.json'),
        JSON.stringify(cat));
      return { scratch: scratchRel };
    });
    let stack = null;
    step('discovery', () => {
      stack = loadCatalogStack(ctx,
        [{ uri: `file://${scratchRel}/cat.json` }]);
      if (!stack.entries.some((e) => e.id === 'selftest-skill')) {
        throw err('NOT_FOUND', 'selftest entry not discovered');
      }
      return { entries: stack.entries.length };
    });
    let bundle = null;
    step('validate', () => {
      bundle = validateBundle({ id: SELFTEST_ID, version: '0.0.1',
        requires: [{ id: 'selftest-skill', sha256: skillSha }] },
        new Set((stack?.entries ?? []).map((e) => e.id)));
      return { requires: bundle.requires?.length ?? 1 };
    });
    step('dry-run', () => {
      const dry = installBundle(ctx, { id: SELFTEST_ID, version: '0.0.1',
        requires: [{ id: 'selftest-skill', sha256: skillSha }] },
        [{ uri: `file://${scratchRel}/cat.json` }]);
      if (dry.mode !== 'dry-run' || dry.files.length < 1) {
        throw err('INVALID_VALUE', 'dry-run did not plan files');
      }
      return { files: dry.files.length };
    });
    step('install', () => {
      const done = installBundle(ctx, { id: SELFTEST_ID, version: '0.0.1',
        requires: [{ id: 'selftest-skill', sha256: skillSha }] },
        [{ uri: `file://${scratchRel}/cat.json` }], { apply: true });
      if (done.applied !== true) {
        throw err('INVALID_VALUE', 'install did not apply');
      }
      const prov = loadProvenance(ctx, SELFTEST_ID);
      if (!Array.isArray(prov.files) || prov.files.length < 1) {
        throw err('MALFORMED', 'provenance missing file records');
      }
      return { provenance: prov.files.length };
    });
    step('mount', () => {
      const m = mountBundle(ctx, SELFTEST_ID);
      const mounted = loadMounted(ctx);
      if (!mounted.entries.some((e) => e.bundle === SELFTEST_ID)) {
        throw err('NOT_FOUND', 'bundle not in mounted catalog');
      }
      return { mounted: m.mounted.length };
    });
    step('unmount', () => {
      const u = unmountBundle(ctx, SELFTEST_ID);
      if (loadMounted(ctx).entries
        .some((e) => e.bundle === SELFTEST_ID)) {
        throw err('INVALID_VALUE', 'mounted entries not removed');
      }
      return { unmounted: u.unmounted };
    });
    step('uninstall', () => {
      const u = uninstallBundle(ctx, SELFTEST_ID);
      if (lstatOrNull(resolveInside(ctx.projectRoot,
        `${bundleRel}/provenance.json`, 'selftest provenance'))) {
        throw err('INVALID_VALUE', 'bundle files left behind');
      }
      return { deleted: u.deleted.length };
    });
  } finally {
    cleanup();
  }
  return Object.freeze({
    ok: steps.every((s) => s.ok) && steps.length === 8,
    steps: Object.freeze(steps),
  });
}
