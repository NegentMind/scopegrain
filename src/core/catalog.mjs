// SPDX-License-Identifier: Apache-2.0
// Catalog loader: validates catalog/manifest.json and serves model-facing
// resources verbatim. Content is data, never interpreted or executed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { err } from './errors.mjs';
import { decodeUtf8Strict, lstatOrNull, readFileLimited } from './fsx.mjs';
import { configRel, isInside, portableKey, resolveInside, toCanonicalRelative } from './paths.mjs';
import { loadLimits } from './policy.mjs';

export const INSTALL_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// V2 layout: resources/manifest.json is canonical. catalog/manifest.json is
// accepted ONLY when the new manifest is absent; a corrupt new manifest
// never falls back to the old one.
const MANIFEST_REL = 'resources/manifest.json';
const MANIFEST_REL_V1 = 'catalog/manifest.json';
const LEGACY_REL = 'provenance/legacy-inventory.json';
const KINDS = new Set([
  'command', 'agent', 'skill', 'rule', 'reference', 'profile',
  'prompt', 'mcp',
]);
const DEP_KEYS = ['agents', 'skills', 'rules', 'references', 'prompts', 'mcps'];
const DEP_KIND = {
  agents: 'agent', skills: 'skill', rules: 'rule', references: 'reference',
  prompts: 'prompt', mcps: 'mcp',
};
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
// Per-kind required component folder; skills may also live in templates/.
const KIND_PREFIX = {
  command: ['resources/commands/', 'commands/'],
  agent: ['resources/agents/', 'agents/'],
  skill: ['resources/skills/', 'skills/', 'templates/skills/'],
  rule: ['resources/rules/', 'rules/'],
  reference: ['resources/references/', 'references/'],
  profile: ['resources/profiles/', 'profiles/'],
  prompt: ['resources/prompts/', 'prompts/'],
  mcp: ['resources/mcps/', 'mcps/'],
};
const ENTRY_KEYS = new Set([
  'kind', 'id', 'path', 'description', 'modes', 'sha256', ...DEP_KEYS,
]);
const SHA_RE = /^[0-9a-f]{64}$/i;
const ALIAS_KEYS = new Set([
  'kind', 'id', 'mode', 'default', 'target', 'targetMode', 'parameters',
]);
const PROFILE_KEYS = new Set([
  'schemaVersion', 'id', 'description', 'skills', 'rules', 'references',
  'mcps', 'activation', 'externalServices',
]);
// skills/rules/references are required; mcps is optional so profiles
// authored before MCP gating stay valid without a schema bump.
const PROFILE_LIST_KEYS = ['skills', 'rules', 'references'];
const PROFILE_OPTIONAL_LIST_KEYS = ['mcps'];
export const PROFILE_DEP_KIND = {
  skills: 'skill', rules: 'rule', references: 'reference', mcps: 'mcp',
};

function limitedDoc(abs, label) {
  const st = lstatOrNull(abs);
  if (!st) throw err('CATALOG_MISSING_FILE', `${label} missing: ${abs}`);
  if (st.isSymbolicLink() || !st.isFile()) {
    throw err('CATALOG_INVALID_FILE', `${label} is a link or non-file`);
  }
  const limited = readFileLimited(abs, loadLimits().maxDocumentBytes);
  if (limited.exceeded) {
    throw err('CATALOG_INVALID_FILE', `${label} exceeds document limit`);
  }
  return limited.content;
}

// Resolves `rel` (a POSIX path inside `root`) so the FINAL filesystem path
// is built under containmentRoot and resolveInside walks every ancestor
// against the real filesystem. A lexical isInside(root) alone cannot see a
// junction swapped in after the catalog was loaded.
function safeResourceAbs(root, rel, containmentRoot) {
  const canonical = toCanonicalRelative(rel, `catalog resource ${rel}`);
  const base = path.resolve(root);
  const limit = path.resolve(containmentRoot ?? root);
  if (base !== limit && !isInside(limit, base)) {
    throw err('CATALOG_INVALID_FILE',
      `catalog root escapes containment: ${base}`);
  }
  const candidate = path.resolve(base, ...canonical.split('/'));
  const relative = path.relative(limit, candidate)
    .split(path.sep).join('/');
  return resolveInside(limit, relative, `catalog resource ${rel}`);
}

function readEntryContent(root, rel, containmentRoot = root) {
  return limitedDoc(
    safeResourceAbs(root, rel, containmentRoot), 'catalog resource');
}

// Shared authored profile shape validation (exact keys, string lists,
// activation string, externalServices string array, id match).
export function validateProfile(id, content) {
  const text = Buffer.isBuffer(content)
    ? decodeUtf8Strict(content, 'PROFILE_MALFORMED', `profile ${id}`)
    : content;
  let p;
  try {
    p = JSON.parse(text);
  } catch {
    throw err('PROFILE_MALFORMED', `profile ${id} is not valid JSON`);
  }
  if (p === null || typeof p !== 'object' || Array.isArray(p)) {
    throw err('PROFILE_MALFORMED', `profile ${id} must be an object`);
  }
  for (const k of Object.keys(p)) {
    if (!PROFILE_KEYS.has(k)) {
      throw err('PROFILE_MALFORMED', `profile ${id} has unknown key '${k}'`);
    }
  }
  if (p.schemaVersion !== 1 || p.id !== id
      || typeof p.description !== 'string' || p.description === '') {
    throw err('PROFILE_MALFORMED', `profile ${id} has invalid header fields`);
  }
  for (const lk of [...PROFILE_LIST_KEYS, ...PROFILE_OPTIONAL_LIST_KEYS]) {
    if (p[lk] === undefined && PROFILE_OPTIONAL_LIST_KEYS.includes(lk)) {
      continue;
    }
    if (!Array.isArray(p[lk])
        || !p[lk].every((x) => typeof x === 'string')) {
      throw err('PROFILE_MALFORMED', `profile ${id}.${lk} must be a string array`);
    }
    const dup = p[lk].find((x, i) => p[lk].indexOf(x) !== i);
    if (dup !== undefined) {
      throw err('PROFILE_MALFORMED', `profile ${id}.${lk} duplicates '${dup}'`);
    }
  }
  if (typeof p.activation !== 'string' || p.activation === '') {
    throw err('PROFILE_MALFORMED', `profile ${id}.activation must be a string`);
  }
  if (!Array.isArray(p.externalServices)
      || !p.externalServices.every((x) => typeof x === 'string')) {
    throw err('PROFILE_MALFORMED',
      `profile ${id}.externalServices must be a string array`);
  }
  return p;
}

// Strict load+validate. Throws on the first structural problem.
// manifestRel forces an explicit path (used by loadWorkspaceCatalog with
// 'catalog.json'); otherwise prefer resources/manifest.json and accept
// catalog/manifest.json only when the new manifest is absent.
export function loadCatalog({
  installRoot = INSTALL_ROOT, manifestRel, verifyResources,
  snapshot = false, containmentRoot,
} = {}) {
  const opts = { verifyResources };
  let rel = manifestRel ?? MANIFEST_REL;
  if (!manifestRel) {
    const st = lstatOrNull(path.join(installRoot, MANIFEST_REL));
    if (!st) rel = MANIFEST_REL_V1;
  }
  const isSnapshot = snapshot === true;
  // Every manifest/resource path is contained under containmentRoot
  // (defaults to installRoot; a workspace configDir may sit inside
  // projectRoot and is re-validated against it).
  const root = containmentRoot ?? installRoot;
  const manifestAbs = safeResourceAbs(installRoot, rel, root);
  let manifest;
  try {
    manifest = JSON.parse(decodeUtf8Strict(
      limitedDoc(manifestAbs, 'catalog manifest'), 'CATALOG_MALFORMED', rel));
  } catch (e) {
    if (e && e.code === 'CATALOG_MISSING_FILE') {
      throw err(isSnapshot ? 'WORKSPACE_CATALOG_MISSING' : 'CATALOG_NOT_FOUND',
        `${rel} not found`);
    }
    if (e instanceof SyntaxError) {
      throw err('CATALOG_MALFORMED', `${rel} is not valid JSON`);
    }
    throw e;
  }
  if (manifest === null || typeof manifest !== 'object'
      || Array.isArray(manifest)) {
    throw err('CATALOG_MALFORMED', 'manifest must be an object');
  }
  // 'version' is optional install-manifest metadata: the resource-set
  // content version bumped by CI when resources/ changes (never projected
  // into snapshots — they are pinned by sha256, not by version).
  const allowedTop = ['schemaVersion', 'entries', 'aliases', 'version'];
  for (const k of Object.keys(manifest)) {
    if (!allowedTop.includes(k)) {
      throw err('CATALOG_MALFORMED', `manifest has unknown key '${k}'`);
    }
  }
  // Install manifests are V1; project snapshots are V2. A V1 document in
  // the project slot is a legacy snapshot: usable but unpinned (warning).
  const isV1Snapshot = isSnapshot && manifest.schemaVersion === 1;
  const version = isSnapshot ? (isV1Snapshot ? 1 : 2) : 1;
  if (![1, 2].includes(manifest.schemaVersion)
      || manifest.schemaVersion !== version
      || !Array.isArray(manifest.entries)
      || manifest.entries.length === 0) {
    throw err('CATALOG_MALFORMED',
      `manifest requires schemaVersion ${version} and entries`);
  }
  if (manifest.version !== undefined
      && (typeof manifest.version !== 'string'
        || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(manifest.version))) {
    throw err('CATALOG_MALFORMED',
      'manifest.version must be semver x.y.z when present');
  }

  // Snapshot entries resolve relative to the manifest's own directory
  // (configDir), NOT the install root. verifyResources=false loads metadata
  // only (integrity:'not-checked') for diagnosis/restore planning.
  const verify = opts.verifyResources !== false;
  const contentRoot = isSnapshot ? path.dirname(manifestAbs) : installRoot;
  const byKey = new Map();
  const byDest = new Map();
  const byProj = new Map();
  const warnings = [];
  const entries = manifest.entries.map((e, i) => {
    if (e === null || typeof e !== 'object' || Array.isArray(e)) {
      throw err('CATALOG_MALFORMED', `entries[${i}] is not an object`);
    }
    for (const key of Object.keys(e)) {
      if (!ENTRY_KEYS.has(key)) {
        throw err('CATALOG_MALFORMED', `entries[${i}] has unknown key '${key}'`);
      }
    }
    if (!KINDS.has(e.kind)) {
      throw err('CATALOG_UNKNOWN_KIND', `unknown catalog kind '${e.kind}'`);
    }
    if (typeof e.id !== 'string' || !ID_RE.test(e.id)) {
      throw err('CATALOG_MALFORMED', `entries[${i}] has invalid id`);
    }
    if (typeof e.description !== 'string' || e.description.trim() === '') {
      throw err('CATALOG_MALFORMED', `${e.kind}/${e.id} needs a description`);
    }
    const rel = toCanonicalRelative(e.path, `${e.kind}/${e.id}.path`);
    // Kind prefixes apply to snapshots too — a snapshot may not smuggle a
    // config.json in as a command body.
    const prefixOk = isSnapshot
      ? KIND_PREFIX[e.kind].some((p) =>
        rel.startsWith(p.replace('resources/', ''))
        || rel.startsWith(p))
      : KIND_PREFIX[e.kind].some((p) => rel.startsWith(p));
    if (!prefixOk) {
      throw err('CATALOG_INVALID_FILE',
        `${e.kind}/${e.id} is outside its component folder: ${rel}`);
    }
    if (e.sha256 !== undefined
        && (typeof e.sha256 !== 'string' || !SHA_RE.test(e.sha256))) {
      throw err('CATALOG_MALFORMED',
        `${e.kind}/${e.id} has malformed sha256`);
    }
    if (isSnapshot && manifest.schemaVersion === 2
        && e.sha256 === undefined) {
      throw err('CATALOG_MALFORMED',
        `snapshot entry ${e.kind}/${e.id} requires sha256`);
    }
    const key = `${e.kind}/${e.id}`.toLowerCase();
    if (byKey.has(key)) {
      throw err('CATALOG_DUPLICATE', `duplicate ${key} (case-insensitive)`);
    }
    const canon = { ...e, path: rel };
    byKey.set(key, canon);
    const dest = portableKey(rel);
    if (byDest.has(dest)) {
      throw err('CATALOG_DUPLICATE', `duplicate catalog path ${rel}`);
    }
    byDest.set(dest, canon);
    // Post-mapping destination collisions are also detected at load so
    // checkCatalog (not only catalogFiles) catches them.
    const proj = portableKey(catalogDestRel(canon));
    if (byProj.has(proj) && byProj.get(proj) !== `${e.kind}/${e.id}`) {
      throw err('CATALOG_DUPLICATE',
        `projected destination collision: ${catalogDestRel(canon)}`);
    }
    byProj.set(proj, `${e.kind}/${e.id}`);
    for (const dk of DEP_KEYS) {
      if (e[dk] !== undefined && (!Array.isArray(e[dk])
          || !e[dk].every((x) => typeof x === 'string'))) {
        throw err('CATALOG_MALFORMED', `${e.kind}/${e.id}.${dk} must be a string array`);
      }
    }
    if (e.kind === 'command') {
      if (!Array.isArray(e.modes) || e.modes.length === 0
          || !e.modes.every((m) => typeof m === 'string' && m.trim() !== '')
          || new Set(e.modes).size !== e.modes.length) {
        throw err('CATALOG_MALFORMED',
          `command/${e.id} requires unique non-empty modes`);
      }
    }
    if (verify) {
      const bytes = readEntryContent(contentRoot, rel, root);
      if (isSnapshot && manifest.schemaVersion === 2) {
        const digest = crypto.createHash('sha256').update(bytes).digest('hex');
        if (digest !== e.sha256.toLowerCase()) {
          throw err('RESOURCE_INTEGRITY_MISMATCH',
            `${e.kind}/${e.id} content diverges from snapshot hash`);
        }
      }
    }
    return canon;
  });

  // Strict alias validation BEFORE dependency checks: dep/profile refs may
  // cite aliases and dedupe by canonical target.
  const VALID_PARAM_VALUES = {
    focus: new Set(['architecture']),
    interaction: new Set(['guided']),
  };
  const aliases = [];
  if (manifest.aliases !== undefined) {
    if (!Array.isArray(manifest.aliases)) {
      throw err('CATALOG_MALFORMED', 'aliases must be an array');
    }
    const seen = new Set();
    const defaultCount = new Map();
    for (const [ai, a] of manifest.aliases.entries()) {
      if (a === null || typeof a !== 'object' || Array.isArray(a)) {
        throw err('CATALOG_MALFORMED', `alias[${ai}] must be an object`);
      }
      const required = ['kind', 'id', 'target'];
      const allowed = a.kind === 'command'
        ? ALIAS_KEYS : new Set(required);
      for (const k of Object.keys(a)) {
        if (!allowed.has(k)) {
          throw err('CATALOG_MALFORMED',
            `alias ${a.id} has unknown key '${k}'`);
        }
      }
      if (!KINDS.has(a.kind)
          || typeof a.id !== 'string' || !ID_RE.test(a.id)
          || typeof a.target !== 'string' || !ID_RE.test(a.target)) {
        throw err('CATALOG_MALFORMED',
          `alias[${ai}] needs ID_RE-valid kind/id/target`);
      }
      if (byKey.has(`${a.kind}/${a.id}`.toLowerCase())) {
        throw err('CATALOG_DUPLICATE',
          `alias ${a.kind}/${a.id} collides with a canonical id`);
      }
      const target = byKey.get(`${a.kind}/${a.target}`.toLowerCase());
      if (!target) {
        throw err('CATALOG_MISSING_DEP',
          `alias ${a.kind}/${a.id} targets missing ${a.kind}/${a.target}`);
      }
      // Commands may declare one alias per mode; non-command kinds get
      // exactly one entry per alias id.
      const dup = a.kind === 'command'
        ? `${a.kind}/${a.id}/${a.mode ?? ''}`.toLowerCase()
        : `${a.kind}/${a.id}`.toLowerCase();
      if (seen.has(dup)) {
        throw err('CATALOG_DUPLICATE', `duplicate alias ${dup}`);
      }
      seen.add(dup);
      if (a.kind === 'command') {
        if (typeof a.mode !== 'string' || a.mode.trim() === '') {
          throw err('CATALOG_MALFORMED',
            `command alias ${a.id} requires a non-empty mode`);
        }
        if (typeof a.default !== 'boolean') {
          throw err('CATALOG_MALFORMED',
            `command alias ${a.id} requires explicit boolean default`);
        }
        const tm = a.targetMode ?? 'default';
        if (!target.modes.includes(tm)) {
          throw err('CATALOG_MALFORMED',
            `alias ${a.id} targetMode '${tm}' not declared on ${a.target}`);
        }
        // Default must be EXACTLY one per alias-id group (kind/id
        // casefold), regardless of how many mode rows the group has.
        const groupKey = `${a.kind}/${a.id}`.toLowerCase();
        defaultCount.set(groupKey, (defaultCount.get(groupKey) ?? 0)
          + (a.default === true ? 1 : 0));
        if (a.parameters !== undefined) {
          if (a.parameters === null || typeof a.parameters !== 'object'
              || Array.isArray(a.parameters)) {
            throw err('CATALOG_MALFORMED',
              `alias ${a.id}.parameters must be an object`);
          }
          for (const [pk, pv] of Object.entries(a.parameters)) {
            if (!VALID_PARAM_VALUES[pk]?.has(pv)) {
              throw err('CATALOG_MALFORMED',
                `alias ${a.id} has invalid parameter '${pk}=${pv}'`);
            }
          }
        }
      }
      aliases.push({ ...a });
    }
    for (const [gk, n] of defaultCount) {
      if (n !== 1) {
        throw err('CATALOG_MALFORMED',
          `alias ${gk} must have exactly one default`);
      }
    }
  }
  // Canonical resolution for deps/profiles cited by alias.
  const canon = (kind, id) => {
    const entry = byKey.get(`${kind}/${id}`.toLowerCase());
    if (entry) return entry.id;
    const a = aliases.find((x) => x.kind === kind
      && x.id.toLowerCase() === id.toLowerCase());
    return a ? a.target : id;
  };
  // Dependency references must resolve to existing entries of the right kind.
  for (const e of entries) {
    for (const dk of DEP_KEYS) {
      for (const dep of e[dk] || []) {
        if (!byKey.has(`${DEP_KIND[dk]}/${canon(DEP_KIND[dk], dep)}`
          .toLowerCase())) {
          throw err('CATALOG_MISSING_DEP',
            `${e.kind}/${e.id} references unknown ${DEP_KIND[dk]} '${dep}'`);
        }
      }
    }
  }
  // Profile entries are validated eagerly only when bodies are read;
  // metadata-only loads (verifyResources:false) skip body reads entirely.
  if (verify) for (const e of entries) {
    if (e.kind !== 'profile') continue;
    const profile = validateProfile(
      e.id, readEntryContent(contentRoot, e.path, root));
    for (const lk of Object.keys(PROFILE_DEP_KIND)) {
      if (!Array.isArray(profile[lk])) continue;
      for (const dep of profile[lk]) {
        if (!byKey.has(
          `${PROFILE_DEP_KIND[lk]}/${canon(PROFILE_DEP_KIND[lk], dep)}`
            .toLowerCase())) {
          throw err('CATALOG_MISSING_DEP',
            `profile/${e.id} references unknown ${PROFILE_DEP_KIND[lk]} '${dep}'`);
        }
      }
    }
  }
  const integrity = !verify ? 'not-checked'
    : isSnapshot
      ? (isV1Snapshot ? 'legacy-unpinned' : 'hash-verified')
      : 'installation';
  if (isV1Snapshot) {
    warnings.push('snapshot is legacy-unpinned: no sha256 coverage');
  }
  return {
    installRoot, entries, byKey, aliases, warnings,
    snapshot: isSnapshot, snapshotVersion: isSnapshot ? version : null,
    contentRoot, containmentRoot: root, integrity, manifestRel: rel,
    version: manifest.version ?? null,
  };
}

// Canonical entry for a kind/id, alias-aware: canonical id first; command
// aliases resolve through their declared DEFAULT row (not the first match);
// other kinds have a unique alias. Returns {entry, alias|null}.
export function resolveCatalogEntry(catalog, kind, id) {
  const e = catalog.byKey.get(`${kind}/${id}`.toLowerCase());
  if (e) return { entry: e, alias: null };
  if (kind === 'command') {
    if (!catalog.aliases.some((a) => a.kind === 'command'
        && a.id.toLowerCase() === String(id).toLowerCase())) {
      return { entry: null, alias: null };
    }
    const inv = resolveInvocation(catalog, { command: id });
    return {
      entry: catalog.byKey.get(`command/${inv.canonicalId}`.toLowerCase()),
      alias: catalog.aliases.find((x) => x.kind === 'command'
        && x.id.toLowerCase() === String(id).toLowerCase()
        && x.default === true) ?? null,
    };
  }
  const a = catalog.aliases?.find((x) => x.kind === kind
    && x.id.toLowerCase() === String(id).toLowerCase()) ?? null;
  if (!a) return { entry: null, alias: null };
  return {
    entry: catalog.byKey.get(`${kind}/${a.target}`.toLowerCase()),
    alias: a,
  };
}

export function getResource(kind, id, opts = {}) {
  const catalog = opts.catalog || loadCatalog(opts);
  if (!KINDS.has(kind)) {
    throw err('CATALOG_UNKNOWN_KIND', `unknown catalog kind '${kind}'`);
  }
  const { entry: e, alias: a } = resolveCatalogEntry(catalog, kind, id);
  if (!e) {
    throw err('CATALOG_UNKNOWN_ID', `unknown ${kind} '${id}'`);
  }
  const content = readEntryContent(catalog.contentRoot ?? catalog.installRoot,
    e.path, catalog.containmentRoot);
  // Snapshot bytes are always re-verified before being handed out.
  if (catalog.snapshot && e.sha256) {
    const digest = crypto.createHash('sha256').update(content).digest('hex');
    if (digest !== e.sha256.toLowerCase()) {
      throw err('RESOURCE_INTEGRITY_MISMATCH',
        `${kind}/${id} content diverges from snapshot hash`);
    }
  }
  return {
    ...e, content,
    requestedId: id, canonicalId: e.id, resolvedVia: a ? 'alias' : 'canonical',
  };
}

// Collect-mode validation used by CLI/doctor; never throws on issues.
export function checkCatalog(opts = {}) {
  try {
    const catalog = loadCatalog(opts);
    return { ok: true, issues: [], entries: catalog.entries.length };
  } catch (e) {
    return {
      ok: false,
      issues: [{ code: e.code || 'INTERNAL', message: e.message }],
      entries: 0,
    };
  }
}

// Projected destination of a catalog entry underneath the config directory:
// skill sources under templates/ map to skills/<id>/SKILL.md; all other
// entries keep their component-relative path.
export function catalogDestRel(e) {
  if (e.path.startsWith('templates/skills/')) {
    return `skills/${e.id}/SKILL.md`;
  }
  if (e.path.startsWith('resources/')) {
    return e.path.slice('resources/'.length);
  }
  return e.path;
}

// Copy set for bootstrap: resources projected under the selected config
// directory plus a PROJECTED manifest (catalog.json) whose entry paths are
// the generated destinations. Destination collisions after mapping are
// detected as duplicates.
export function catalogFiles(
  { installRoot = INSTALL_ROOT, catalog: given } = {}) {
  const catalog = given ?? loadCatalog({ installRoot });
  const files = [];
  const seenDest = new Map();
  const projectedEntries = [];
  for (const e of catalog.entries) {
    const rel = catalogDestRel(e);
    const key = portableKey(rel);
    if (seenDest.has(key)) {
      throw err('CATALOG_DUPLICATE',
        `projected destination collision: ${rel} (entries '${seenDest.get(key)}' and '${e.id}')`);
    }
    seenDest.set(key, e.id);
    // The same buffer is used for projection and its SHA256 binding.
    const content = readEntryContent(catalog.installRoot, e.path);
    files.push({ rel, content });
    projectedEntries.push({
      ...e, path: rel,
      sha256: crypto.createHash('sha256').update(content).digest('hex'),
    });
  }
  files.push({
    rel: 'catalog.json',
    content: JSON.stringify({
      schemaVersion: 2, entries: projectedEntries,
      aliases: catalog.aliases,
    }, null, 2) + '\n',
  });
  return files;
}

// Workspace-bound catalog: configDir/catalog.json, manifestRel explicit.
// Missing -> WORKSPACE_CATALOG_MISSING; never falls back to installation.
const MOUNTED_KEYS = new Set([
  'kind', 'id', 'path', 'description', 'modes', 'sha256', 'bundle',
  ...DEP_KEYS,
]);

// Mounted bundle layer: entries installed by `dist bundle-mount` live in
// <configDir>/mounted-catalog.json, confined to paths under bundles/ and
// pinned by sha256 verified against actual bytes. They merge into the
// workspace catalog AFTER snapshot validation — the snapshot manifest
// itself is never modified.
function mergeMounted(cat, configDir, containmentRoot, verify) {
  const mountedAbs = path.join(configDir, 'mounted-catalog.json');
  const st = lstatOrNull(mountedAbs);
  if (!st) { cat.mounted = 0; return cat; }
  if (st.isSymbolicLink() || !st.isFile()) {
    throw err('INVALID_PATH', 'mounted-catalog.json is not a regular file');
  }
  const l = readFileLimited(mountedAbs, loadLimits().maxDocumentBytes);
  if (l.exceeded) throw err('DOCUMENT_TOO_LARGE', 'mounted-catalog.json');
  const doc = JSON.parse(decodeUtf8Strict(
    l.content, 'CATALOG_MALFORMED', 'mounted-catalog.json'));
  if (doc === null || typeof doc !== 'object'
      || !Array.isArray(doc.entries)) {
    throw err('CATALOG_MALFORMED', 'mounted-catalog.json requires {entries:[]}');
  }
  const mountedPaths = new Set();
  for (const [i, e] of doc.entries.entries()) {
    if (e === null || typeof e !== 'object' || Array.isArray(e)) {
      throw err('CATALOG_MALFORMED', `mounted entries[${i}] is not an object`);
    }
    for (const key of Object.keys(e)) {
      if (!MOUNTED_KEYS.has(key)) {
        throw err('CATALOG_MALFORMED',
          `mounted entries[${i}] has unknown key '${key}'`);
      }
    }
    if (!KINDS.has(e.kind)) {
      throw err('CATALOG_UNKNOWN_KIND', `unknown mounted kind '${e.kind}'`);
    }
    if (typeof e.id !== 'string' || !ID_RE.test(e.id)) {
      throw err('CATALOG_MALFORMED', `mounted entries[${i}] has invalid id`);
    }
    if (typeof e.sha256 !== 'string' || !SHA_RE.test(e.sha256)) {
      throw err('CATALOG_MALFORMED',
        `mounted ${e.kind}/${e.id} requires sha256`);
    }
    // The owning bundle must be a safe id AND the path must live under
    // bundles/<bundle>/ — else a forged entry mounts another bundle's
    // files and escapes unmount-by-bundle.
    if (typeof e.bundle !== 'string' || !ID_RE.test(e.bundle)) {
      throw err('CATALOG_MALFORMED',
        `mounted ${e.kind}/${e.id} has invalid bundle id`);
    }
    const rel = toCanonicalRelative(e.path, `mounted ${e.kind}/${e.id}`);
    if (!rel.startsWith(`bundles/${e.bundle}/`)) {
      throw err('CATALOG_INVALID_FILE',
        `mounted ${e.kind}/${e.id} path outside bundles/${e.bundle}/: ${rel}`);
    }
    if (e.kind === 'command'
        && (!Array.isArray(e.modes) || e.modes.length === 0
          || !e.modes.every((m) => typeof m === 'string' && m.trim() !== '')
          || new Set(e.modes).size !== e.modes.length)) {
      throw err('CATALOG_MALFORMED',
        `mounted command/${e.id} requires unique non-empty modes`);
    }
    for (const dk of DEP_KEYS) {
      if (e[dk] !== undefined && (!Array.isArray(e[dk])
          || !e[dk].every((x) => typeof x === 'string'))) {
        throw err('CATALOG_MALFORMED',
          `mounted ${e.kind}/${e.id}.${dk} must be a string array`);
      }
    }
    const key = `${e.kind}/${e.id}`.toLowerCase();
    if (cat.byKey.has(key)) {
      throw err('CATALOG_DUPLICATE',
        `mounted entry ${key} collides with catalog`);
    }
    // A mounted id that shadows a canonical alias would make the alias
    // silently unreachable — byKey resolves before alias lookup.
    if (cat.aliases.some((a) => a.kind === e.kind
        && a.id.toLowerCase() === e.id.toLowerCase())) {
      throw err('CATALOG_DUPLICATE',
        `mounted ${key} shadows a catalog alias`);
    }
    const destKey = portableKey(rel);
    if (mountedPaths.has(destKey)) {
      throw err('CATALOG_DUPLICATE',
        `duplicate mounted path ${rel}`);
    }
    mountedPaths.add(destKey);
    if (verify) {
      const bytes = readEntryContent(configDir, rel, containmentRoot);
      const digest = crypto.createHash('sha256').update(bytes).digest('hex');
      if (digest !== e.sha256.toLowerCase()) {
        throw err('RESOURCE_INTEGRITY_MISMATCH',
          `mounted ${e.kind}/${e.id} content diverges from hash`);
      }
    }
    const canon = { ...e, path: rel,
      description: e.description ?? `mounted:${e.bundle}` };
    cat.entries.push(canon);
    cat.byKey.set(key, canon);
  }
  cat.mounted = doc.entries.length;
  return cat;
}

// Per-process reuse of the verified workspace catalog. The eager sha256
// pass over every snapshot and mounted entry is repeated only when the
// fingerprint changes: manifest and mounted-catalog bytes hashed (two
// small files) plus a size+mtimeMs stat tuple for every covered entry
// file. Any stat-changing write invalidates; a stat-preserving byte edit
// escapes only the eager pass — getResource re-hashes served bytes, so
// delivery still fails closed. That narrows the eager-detection window
// to the same TOCTOU caveat already documented for on-disk state.
// Callers must not mutate the returned catalog's containers.
const VERIFIED_CACHE_MAX = 64;
const verifiedCache = new Map();

function coveredFileTuple(abs) {
  const st = lstatOrNull(abs);
  return st !== null && st.isFile() ? `${st.size}:${st.mtimeMs}` : 'absent';
}

function verifyFingerprint(cat, manifestAbs, mountedAbs, configDir) {
  const lim = loadLimits().maxDocumentBytes;
  const fileSha = (abs) => {
    if (lstatOrNull(abs) === null) return 'absent';
    const l = readFileLimited(abs, lim);
    return l.exceeded ? 'exceeded'
      : crypto.createHash('sha256').update(l.content).digest('hex');
  };
  const parts = [fileSha(manifestAbs), fileSha(mountedAbs)];
  for (const e of cat.entries) {
    parts.push(coveredFileTuple(path.join(configDir, e.path)));
  }
  return parts.join('|');
}

// Cross-process tier of the verified cache, persisted under
// <paths.state>/cache/catalog-fingerprint.json (one record per project,
// bound to the resolved configDir so a --config switch never aliases).
// The file stores ONLY the fingerprint — never catalog content — so a
// forged record cannot inject entries: the catalog is always re-parsed
// from the live manifest, and the fingerprint is always recomputed from
// live stat tuples before it is trusted.
// THREAT MODEL: a write-capable attacker can forge, corrupt or delete
// the record. Corrupt/mismatched values are ignored (fail closed → full
// verify). A forged value can only claim "the fingerprint you are about
// to compute anyway" — it cannot name a different state. The real
// residual is the same one the in-process tier documents: a
// stat-preserving byte edit (size+mtime unchanged) evades the eager
// pass; getResource re-hashes every served byte, so delivery still
// fails closed. Persistence widens that window from one process
// lifetime to the time between verifies — an accepted trade-off for
// skipping ~285 ms of sha256 on every one-shot CLI invocation.
const FP_SCHEMA = 1;
function fingerprintRel(ctx) {
  const stateRel = typeof ctx.config?.paths?.state === 'string'
    ? ctx.config.paths.state
    : configRel(ctx, 'state');
  return `${stateRel}/cache/catalog-fingerprint.json`;
}

function readPersistedFingerprint(ctx) {
  try {
    const rel = fingerprintRel(ctx);
    const abs = resolveInside(ctx.projectRoot, rel, 'catalog fingerprint');
    const st = lstatOrNull(abs);
    if (!st || st.isSymbolicLink() || !st.isFile()) return null;
    const l = readFileLimited(abs, 64 * 1024);
    if (l.exceeded) return null;
    const doc = JSON.parse(decodeUtf8Strict(
      l.content, 'CATALOG_MALFORMED', rel));
    if (doc === null || typeof doc !== 'object'
        || doc.schemaVersion !== FP_SCHEMA
        || typeof doc.configDir !== 'string'
        || typeof doc.fingerprint !== 'string') {
      return null;
    }
    return doc;
  } catch { return null; }
}

function persistFingerprint(ctx, doc) {
  // Best-effort derived cache, tmp+rename like the structure index — an
  // unwritable state dir must never fail a catalog load.
  try {
    const rel = fingerprintRel(ctx);
    const abs = resolveInside(ctx.projectRoot, rel, 'catalog fingerprint');
    const existing = lstatOrNull(abs);
    if (existing && (existing.isSymbolicLink() || !existing.isFile())) return;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const tmp = `${abs}.tmp-${crypto.randomBytes(8).toString('hex')}`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(doc, null, 1) + '\n', { flag: 'wx' });
      fs.renameSync(tmp, abs);
    } finally {
      try { if (lstatOrNull(tmp)) fs.unlinkSync(tmp); } catch { /* noop */ }
    }
  } catch { /* opportunistic cache write — ignore */ }
}

export function loadWorkspaceCatalog(ctx, { verifyResources = true } = {}) {
  const configDir = ctx.configDir === '.'
    ? ctx.projectRoot
    : resolveInside(ctx.projectRoot, ctx.configDir, 'config directory');
  const load = (verify) => mergeMounted(loadCatalog({
    installRoot: configDir, manifestRel: 'catalog.json',
    verifyResources: verify,
    snapshot: true, containmentRoot: ctx.projectRoot,
  }), configDir, ctx.projectRoot, verify);
  if (!verifyResources) return load(false);
  const manifestAbs = path.join(configDir, 'catalog.json');
  const mountedAbs = path.join(configDir, 'mounted-catalog.json');
  const key = path.resolve(configDir);
  // Metadata-only parse first: manifest corruption still fails closed,
  // and its entry list defines which files the fingerprint must cover.
  const fingerprint = verifyFingerprint(
    load(false), manifestAbs, mountedAbs, configDir);
  const hit = verifiedCache.get(key);
  if (hit && hit.fingerprint === fingerprint) {
    verifiedCache.delete(key);
    verifiedCache.set(key, hit);
    const c = hit.catalog;
    return { ...c, entries: c.entries.slice(), byKey: new Map(c.byKey),
      aliases: c.aliases?.slice(), warnings: c.warnings?.slice() };
  }
  const persisted = readPersistedFingerprint(ctx);
  if (persisted !== null && persisted.configDir === key
      && persisted.fingerprint === fingerprint) {
    // A previous process hash-verified exactly this fingerprint-bound
    // state. The catalog is still freshly parsed from the live manifest
    // (metadata only), and every served resource is re-hashed at
    // delivery — only the redundant eager pass is skipped.
    const cat = load(false);
    cat.integrity = cat.snapshotVersion === 2
      ? 'hash-verified' : 'legacy-unpinned';
    verifiedCache.set(key, { fingerprint, catalog: cat });
    if (verifiedCache.size > VERIFIED_CACHE_MAX) {
      verifiedCache.delete(verifiedCache.keys().next().value);
    }
    return { ...cat, entries: cat.entries.slice(), byKey: new Map(cat.byKey),
      aliases: cat.aliases?.slice(), warnings: cat.warnings?.slice() };
  }
  const cat = load(true);
  const verifiedFp = verifyFingerprint(
    cat, manifestAbs, mountedAbs, configDir);
  verifiedCache.set(key, { fingerprint: verifiedFp, catalog: cat });
  if (verifiedCache.size > VERIFIED_CACHE_MAX) {
    verifiedCache.delete(verifiedCache.keys().next().value);
  }
  // Persist only AFTER a successful full verify: a failed verify never
  // seeds the cache, so tampering always re-verifies next process.
  persistFingerprint(ctx, {
    schemaVersion: FP_SCHEMA, configDir: key, fingerprint: verifiedFp,
    verifiedAt: new Date().toISOString(),
  });
  return cat;
}

// Alias/mode resolution for a requested command invocation.
export function resolveInvocation(catalog, { command, mode }) {
  if (typeof command !== 'string' || command === '') {
    throw err('INVALID_ARGS', 'command id must be a non-empty string');
  }
  const canon = catalog.byKey.get(`command/${command}`.toLowerCase());
  if (canon) {
    const m = mode ?? canon.modes[0];
    if (!canon.modes.includes(m)) {
      throw err('INVALID_MODE',
        `command '${command}' has no mode '${m}'`);
    }
    return {
      requestedId: command, requestedMode: m,
      canonicalId: canon.id, canonicalMode: m,
      deprecated: false, parameters: {},
    };
  }
  const byId = catalog.aliases.filter(
    (a) => a.kind === 'command'
      && a.id.toLowerCase() === command.toLowerCase());
  if (byId.length === 0) {
    throw err('CATALOG_UNKNOWN_ID', `unknown command '${command}'`);
  }
  const matches = mode === undefined
    ? byId : byId.filter((a) => a.mode === mode);
  const chosen = mode === undefined
    ? matches.find((a) => a.default === true)
    : matches.find((a) => a.mode === mode);
  if (!chosen) {
    throw err('INVALID_MODE',
      `alias '${command}' has no mode '${mode}'`);
  }
  const target = catalog.byKey.get(`command/${chosen.target}`.toLowerCase());
  return {
    requestedId: command, requestedMode: mode ?? chosen.mode,
    canonicalId: target.id, canonicalMode: chosen.targetMode ?? 'default',
    deprecated: true, parameters: chosen.parameters ?? {},
  };
}

// --- Frozen provenance ledger (metadata only) ---
// provenance/legacy-inventory.json is authored frozen data: counts, hashes and
// review indicators. Bodies are never read or served; originalActivation is
// 'blocked' for every entry.

export function loadLegacyInventory({ installRoot = INSTALL_ROOT } = {}) {
  const abs = resolveInside(installRoot, LEGACY_REL, 'legacy inventory');
  let data;
  try {
    data = JSON.parse(decodeUtf8Strict(
      limitedDoc(abs, 'legacy inventory'), 'LEGACY_MALFORMED', 'legacy inventory'));
  } catch (e) {
    if (e && e.code === 'CATALOG_MISSING_FILE') {
      throw err('LEGACY_NOT_FOUND',
        'provenance/legacy-inventory.json not found; '
        + 'the frozen ledger ships only with the source repository');
    }
    if (e instanceof SyntaxError) {
      throw err('LEGACY_MALFORMED', 'legacy inventory is not valid JSON');
    }
    throw e;
  }
  if (data === null || typeof data !== 'object' || !Array.isArray(data.entries)) {
    throw err('LEGACY_MALFORMED', 'legacy inventory requires an entries array');
  }
  return data;
}

export function legacyList({ kind } = {}, opts = {}) {
  const data = loadLegacyInventory(opts);
  if (kind !== undefined) {
    if (typeof kind !== 'string' || kind === '') {
      throw err('CATALOG_UNKNOWN_KIND', `unknown legacy kind '${kind}'`);
    }
    if (!data.entries.some((e) => e.kind === kind)) {
      throw err('CATALOG_UNKNOWN_KIND', `unknown legacy kind '${kind}'`);
    }
  }
  const entries = kind
    ? data.entries.filter((e) => e.kind === kind) : data.entries;
  // Active catalog is loaded ONCE per public call; its absence produces an
  // explicit warning and captured replacements, never a silent current path.
  const active = activeCatalogOnce(opts);
  const cls = loadClassification(opts);
  return {
    schemaVersion: data.schemaVersion,
    claim: data.claim ?? null,
    sourceBodiesIncluded: data.sourceBodiesIncluded ?? null,
    counts: data.counts ?? {},
    warnings: active.warning ? [active.warning] : [],
    entries: entries.map((e) => decorateLegacy(e, active.catalog, cls)),
  };
}

function activeCatalogOnce(opts) {
  try {
    return { catalog: opts.catalog || loadCatalog(opts), warning: null };
  } catch (e) {
    return {
      catalog: null,
      warning: `active catalog unavailable (${e.code || 'INTERNAL'}): `
        + 'currentReplacement falls back to captured metadata',
    };
  }
}

// Frozen identifier triage: provenance/legacy-classification.json entries carry
// {id,category,family,basis,reviewRequired,...} (no kind). Joined ONLY for
// legacy kind 'skill' by id. Missing file is optional; malformed or
// oversized content is a structured error, never swallowed.
const CLASSIFICATION_REL = 'provenance/legacy-classification.json';
function loadClassification(opts = {}) {
  const abs = resolveInside(
    opts.installRoot || INSTALL_ROOT, CLASSIFICATION_REL, 'classification');
  const st = lstatOrNull(abs);
  if (!st) return new Map();
  if (st.isSymbolicLink() || !st.isFile()) {
    throw err('LEGACY_MALFORMED', 'classification file is not a regular file');
  }
  const limited = readFileLimited(abs, loadLimits().maxDocumentBytes);
  if (limited.exceeded) {
    throw err('LEGACY_MALFORMED', 'classification exceeds document limit');
  }
  const text = decodeUtf8Strict(
    limited.content, 'LEGACY_MALFORMED', 'legacy classification');
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw err('LEGACY_MALFORMED', 'classification is not valid JSON');
  }
  if (data === null || typeof data !== 'object'
      || !Array.isArray(data.entries)) {
    throw err('LEGACY_MALFORMED', 'classification requires an entries array');
  }
  const byId = new Map();
  for (const e of data.entries) {
    if (e && typeof e.id === 'string') byId.set(e.id, e);
  }
  return byId;
}

function decorateLegacy(e, activeCatalog, clsById) {
  let currentReplacement = e.replacement ?? null;
  if (activeCatalog) {
    const active = activeCatalog.byKey.get(`${e.kind}/${e.id}`.toLowerCase());
    if (active) currentReplacement = catalogDestRel(active);
  }
  const out = {
    ...e, originalActivation: 'blocked', currentReplacement,
  };
  if (e.kind === 'skill' && clsById) {
    const c = clsById.get(e.id);
    if (c) {
      for (const k of ['category', 'family', 'basis', 'reviewRequired']) {
        if (c[k] !== undefined) out[k] = c[k];
      }
    }
  }
  return out;
}

export function legacyGet(kind, id, opts = {}) {
  const data = loadLegacyInventory(opts);
  const e = data.entries.find((x) => x.kind === kind && x.id === id);
  if (!e) {
    throw err('CATALOG_UNKNOWN_ID', `unknown legacy ${kind} '${id}'`);
  }
  const active = activeCatalogOnce(opts);
  const cls = loadClassification(opts);
  const out = decorateLegacy(e, active.catalog, cls);
  if (active.warning) out.warnings = [active.warning];
  return out;
}
