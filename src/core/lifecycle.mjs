// SPDX-License-Identifier: Apache-2.0
// Product lifecycle: adopt, update, backup, restore and uninstall.
// Every verb has a read-only prepare (no writes, no directories, no ID
// reservations) and, where applicable, a create-only apply that re-runs the
// prepare internally -- a preview is never trusted as proof that state has
// not changed. Nothing foreign is ever overwritten or merged; uninstall
// deletes only files that provably match bytes the harness created.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { err } from './errors.mjs';
import { decodeUtf8Strict, lstatOrNull, readDirBounded, readFileLimited,
  removeIfExists } from './fsx.mjs';
import {
  assertDestination, isSameOrAncestor, portableKey, resolveInside,
  resolveProjectRoot,
} from './paths.mjs';
import {
  configDirOf, loadConfig, PATH_KEYS, resolveConfigPath,
} from './config.mjs';
import { applyPlan, buildInitPlan } from './bootstrap.mjs';
import {
  hasManagedSection, managedBody, managedEquals, upsertManaged,
} from './managed-section.mjs';
import { inspectProject } from '../discovery/inspect.mjs';
import { validateWorkspace, workspaceFileRel } from './workspaces.mjs';
import { catalogDestRel, loadWorkspaceCatalog } from './catalog.mjs';
import { loadLimits } from './policy.mjs';
import { buildActivation } from '../hosts/activation.mjs';
import { loadNativePolicy, loadNativeVariants } from '../hosts/native.mjs';

const MAX_MANIFEST_ENTRIES = 10000;
const BACKUP_KIND = 'scopegrain-backup';
const SHA = /^[0-9a-f]{64}$/;
const MANIFEST_KEYS = ['schemaVersion', 'kind', 'createdAt', 'source', 'entries'];
const MANIFEST_ENTRY_KEYS = ['rel', 'sha256', 'bytes'];

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// classifyPlan's reason for a real diverged file: the only conflict kind
// --reconcile may rewrite. Links, directories, plan collisions, unsafe or
// unreadable destinations always stay conflict.
const DIVERGED_REASON = 'destination exists with different content';

function closed(value, keys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw err('LIFECYCLE_INVALID_INPUT', `${label} must be an object`);
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) {
      throw err('LIFECYCLE_INVALID_INPUT', `unknown ${label} key '${key}'`);
    }
  }
}

function requireCtx(ctx) {
  closed(ctx, ['projectRoot', 'projectName', 'configPath', 'configDir', 'config'], 'ctx');
  if (typeof ctx.projectRoot !== 'string' || typeof ctx.configPath !== 'string'
      || typeof ctx.configDir !== 'string'
      || ctx.config === null || typeof ctx.config !== 'object'
      || Array.isArray(ctx.config)) {
    throw err('LIFECYCLE_INVALID_INPUT', 'ctx has invalid fields');
  }
}

// Regular-file bytes or undefined; never follows links.
function diskContent(root, rel) {
  const abs = resolveInside(root, rel, 'document');
  const st = lstatOrNull(abs);
  if (!st || !st.isFile() || st.isSymbolicLink()) return undefined;
  const limited = readFileLimited(abs, loadLimits().maxDocumentBytes);
  return limited.exceeded ? undefined : limited.content;
}

function diskSha256(abs) {
  try {
    const limited = readFileLimited(abs, loadLimits().maxDocumentBytes);
    return limited.exceeded ? null : sha256(limited.content);
  } catch { return null; }
}

// Bounded recursive walk of regular files under dirRel. Links and
// non-regular entries become issues and are never followed.
function walkTree(root, dirRel, counter, out, issues) {
  const abs = resolveInside(root, dirRel, 'source directory');
  const st = lstatOrNull(abs);
  if (!st) return;
  if (st.isSymbolicLink() || !st.isDirectory()) {
    issues.push({ code: 'LIFECYCLE_SOURCE_SKIPPED', rel: dirRel,
      message: 'source path is a link or non-directory' });
    return;
  }
  const { entries, truncated } = readDirBounded(abs, MAX_MANIFEST_ENTRIES);
  if (truncated) {
    throw err('BACKUP_CAPACITY', `directory exceeds entry bound: ${dirRel}`);
  }
  for (const dirent of entries) {
    if (counter.count >= MAX_MANIFEST_ENTRIES) {
      throw err('BACKUP_CAPACITY', 'source tree exceeds entry bound');
    }
    let rel;
    try {
      rel = assertDestination(`${dirRel}/${dirent.name}`, 'source entry');
    } catch (e) {
      counter.count += 1;
      issues.push({ code: e.code, rel: `${dirRel}/${dirent.name}`,
        message: e.message });
      continue;
    }
    if (dirent.isDirectory()) {
      counter.count += 1;
      walkTree(root, rel, counter, out, issues);
      continue;
    }
    counter.count += 1;
    if (dirent.isSymbolicLink() || !dirent.isFile()) {
      issues.push({ code: 'LIFECYCLE_SOURCE_SKIPPED', rel,
        message: 'entry is a link or non-regular file' });
      continue;
    }
    out.push(rel);
  }
}

// A plan file whose content declares managed markers may refresh the same
// region in an existing file that carries them; equality is judged on the
// managed region only, never on user bytes outside it.
function managedClass(abs, incoming) {
  let existing;
  try {
    const limited = readFileLimited(abs, loadLimits().maxDocumentBytes);
    if (limited.exceeded) return null; // never upsert bytes we cannot see
    existing = decodeUtf8Strict(limited.content, 'MANAGED_MALFORMED', abs);
  } catch {
    return null; // unreadable/binary: plain diverged conflict
  }
  let incomingText;
  try {
    incomingText = decodeUtf8Strict(incoming, 'MANAGED_MALFORMED', 'plan file');
  } catch {
    return null;
  }
  if (!hasManagedSection(incomingText) || !hasManagedSection(existing)) {
    return null;
  }
  return managedEquals(existing, managedBody(incomingText))
    ? { action: 'noop' } : { action: 'managed' };
}

// preflightPlan's classification, collected instead of thrown. Action
// 'managed' marks a diverged file whose managed region may be refreshed
// in place; it only ever applies to destinations the plan itself wraps
// in markers and the existing file opted into.
function classifyPlan(projectRoot, files) {
  const collisions = new Set();
  for (let i = 0; i < files.length; i++) {
    for (let j = i + 1; j < files.length; j++) {
      if (isSameOrAncestor(files[i].rel, files[j].rel)
          || isSameOrAncestor(files[j].rel, files[i].rel)) {
        collisions.add(i);
        collisions.add(j);
      }
    }
  }
  return files.map((f, i) => {
    if (collisions.has(i)) {
      return { rel: f.rel, action: 'conflict',
        reason: 'planned destination collides with another planned file' };
    }
    let abs;
    try {
      abs = resolveInside(projectRoot, f.rel, `plan destination ${f.rel}`);
    } catch (e) {
      return { rel: f.rel, action: 'conflict', reason: e.message };
    }
    const st = lstatOrNull(abs);
    if (!st) return { rel: f.rel, action: 'create' };
    if (st.isSymbolicLink() || !st.isFile()) {
      return { rel: f.rel, action: 'conflict',
        reason: 'destination is a link or directory' };
    }
    const incoming = Buffer.isBuffer(f.content)
      ? f.content : Buffer.from(f.content);
    let limited;
    try {
      limited = readFileLimited(abs, incoming.length);
    } catch (e) {
      return { rel: f.rel, action: 'conflict', reason: `read failed: ${e.code}` };
    }
    if (limited.exceeded || !limited.content.equals(incoming)) {
      const managed = managedClass(abs, incoming);
      if (managed) return { rel: f.rel, ...managed };
      return { rel: f.rel, action: 'conflict', reason: DIVERGED_REASON,
        disk: limited.exceeded ? diskSha256(abs) : sha256(limited.content) };
    }
    return { rel: f.rel, action: 'noop' };
  });
}

// The full generated-file plan with preserved config/discovery bytes, so
// regeneration drift is detected instead of assumed (mirrors doctor).
function generatedPlan(ctx, options, { hosts } = {}) {
  const config = structuredClone(ctx.config);
  // Uninstall must enumerate every destination any host could have left
  // behind, not only the hosts the current config keeps: a host dropped
  // after init still left its applied files (OpenCode pilot finding —
  // uninstall derived the set from live config and orphaned proposals,
  // root entrypoints and divergent artifacts of retired hosts).
  if (hosts !== undefined) config.hosts = hosts;
  const cfgDir = configDirOf(ctx.configPath);
  const discoveryRel = cfgDir === '.'
    ? 'discovery.json' : `${cfgDir}/discovery.json`;
  const discoveryContent = diskContent(ctx.projectRoot, discoveryRel);
  const input = {
    projectRoot: ctx.projectRoot,
    configRel: ctx.configPath,
    config,
    configContent: diskContent(ctx.projectRoot, ctx.configPath),
    // Update preserves existing discovery bytes; an absent file is repaired
    // by a fresh bounded inspection, never by serializing null.
    discovery: discoveryContent === undefined
      ? inspectProject(ctx.projectRoot) : null,
    discoveryContent,
  };
  if (options.installRoot !== undefined) {
    input.installRoot = options.installRoot;
    input.templatesDir = path.join(options.installRoot, 'templates');
  }
  return buildInitPlan(input);
}

// --- adopt -----------------------------------------------------------------

function dirHasEntries(root, rel, issues) {
  const st = lstatOrNull(resolveInside(root, rel, 'journal path'));
  if (!st) return false;
  if (!st.isDirectory() || st.isSymbolicLink()) return true; // foreign object
  try {
    const dir = fs.opendirSync(resolveInside(root, rel, 'journal path'));
    try {
      return dir.readSync() !== null;
    } finally {
      dir.closeSync();
    }
  } catch (e) {
    // An unreadable directory must not abort the read-only preview:
    // report it and answer conservatively so the caller flags attention.
    issues.push({ code: e.code ?? 'READ_FAILED',
      message: `journal path unreadable: ${e.message}` });
    return true;
  }
}

// Minimal read-only journal view: presence + head.activeOperation only.
// Full validation/recovery stays in journal.mjs.
function journalStatus(root, config, issues) {
  const base = `${config.paths.state}/journal`;
  let abs;
  try {
    abs = resolveInside(root, base, 'journal');
  } catch (e) {
    issues.push({ code: e.code ?? 'INTERNAL', message: e.message });
    return 'attention';
  }
  const st = lstatOrNull(abs);
  if (!st) return 'absent';
  if (st.isSymbolicLink() || !st.isDirectory()) {
    issues.push({ code: 'JOURNAL_MALFORMED',
      message: 'journal path is not a directory' });
    return 'attention';
  }
  const headAbs = resolveInside(root, `${base}/head.json`, 'journal head');
  const hst = lstatOrNull(headAbs);
  if (!hst) {
    if (dirHasEntries(root, `${base}/operations`, issues)
        || dirHasEntries(root, `${base}/outbox`, issues)
        || dirHasEntries(root, `${base}/archive/operations`, issues)) {
      issues.push({ code: 'JOURNAL_MALFORMED',
        message: 'journal head is missing while history exists' });
      return 'attention';
    }
    return 'idle';
  }
  if (hst.isSymbolicLink() || !hst.isFile()) {
    issues.push({ code: 'JOURNAL_MALFORMED',
      message: 'journal head is not a regular file' });
    return 'attention';
  }
  try {
    const limited = readFileLimited(headAbs, loadLimits().maxDocumentBytes);
    if (limited.exceeded) {
      issues.push({ code: 'DOCUMENT_TOO_LARGE',
        message: 'journal head exceeds document limit' });
      return 'attention';
    }
    const head = JSON.parse(decodeUtf8Strict(
      limited.content, 'JOURNAL_MALFORMED', 'journal head'));
    if (head === null || typeof head !== 'object' || Array.isArray(head)
        || head.schemaVersion !== 1) {
      issues.push({ code: 'JOURNAL_MALFORMED',
        message: 'journal head has invalid fields' });
      return 'attention';
    }
    return head.activeOperation ? 'active' : 'idle';
  } catch (e) {
    issues.push({ code: e.code ?? 'JOURNAL_MALFORMED',
      message: `journal head unreadable: ${e.message}` });
    return 'attention';
  }
}

// Detects an already-initialized project and reports what adopting would
// bind. Never reinitializes, never writes. Everything except an unusable
// project root is reported as an issue, not thrown.
export function prepareAdopt(projectRoot, options = {}) {
  closed(options, ['config'], 'adopt options');
  if (options.config !== undefined && typeof options.config !== 'string') {
    throw err('LIFECYCLE_INVALID_INPUT', 'options.config must be a string');
  }
  const root = resolveProjectRoot(projectRoot);
  const issues = [];
  let configRel = null;
  let config = null;
  let loaded = null;
  try {
    configRel = resolveConfigPath(root, options.config);
  } catch (e) {
    issues.push({ code: e.code ?? 'INTERNAL', message: e.message });
  }
  if (configRel !== null) {
    try {
      loaded = loadConfig(root, configRel).config;
      config = {
        name: loaded.project.name,
        locale: loaded.locale,
        hosts: [...loaded.hosts],
        methodology: loaded.methodology,
        paths: structuredClone(loaded.paths),
      };
    } catch (e) {
      issues.push({ code: e.code ?? 'INTERNAL', message: e.message });
      if (e.code === 'CONFIG_NOT_FOUND') configRel = null;
    }
  }

  let workspace = null;
  let journalState = 'unknown';
  if (loaded) {
    const ctx = {
      projectRoot: root, configPath: configRel,
      configDir: configDirOf(configRel), config: loaded,
    };
    try {
      const wsRel = workspaceFileRel(ctx);
      const wsAbs = resolveInside(root, wsRel, 'workspace file');
      const st = lstatOrNull(wsAbs);
      if (st) {
        if (st.isSymbolicLink() || !st.isFile()) {
          issues.push({ code: 'WORKSPACE_MALFORMED',
            message: 'workspace is not a regular file' });
        } else {
          const limited = readFileLimited(wsAbs, loadLimits().maxDocumentBytes);
          if (limited.exceeded) {
            issues.push({ code: 'DOCUMENT_TOO_LARGE',
              message: 'workspace exceeds document limit' });
          } else {
            const ws = validateWorkspace(JSON.parse(decodeUtf8Strict(
              limited.content, 'MALFORMED_JSON', wsRel)));
            workspace = {
              rel: wsRel, workspaceId: ws.workspaceId,
              revision: ws.revision, areas: ws.areas.length,
            };
          }
        }
      }
    } catch (e) {
      issues.push({ code: e.code ?? 'INTERNAL', message: e.message });
    }
    journalState = journalStatus(root, loaded, issues);
  }

  const attention = issues.length > 0 || configRel === null
    || journalState === 'active' || journalState === 'attention'
    || journalState === 'unknown';
  return Object.freeze({
    mode: 'dry-run', projectRoot: root, configRel, config, workspace,
    journalState, status: attention ? 'attention' : 'adoptable', issues,
  });
}

// --- update ----------------------------------------------------------------

// Top-level directories the plan generator owns, derived from the plan
// itself rather than a copied list: every nested planned path marks its
// first segment as a generated root (.scopegrain/, a custom config dir,
// or any projected host dir the generator may emit). Root-level entries
// (AGENTS.md, CLAUDE.md, a root config) are never roots.
function generatedRoots(planFiles) {
  const roots = new Set();
  for (const f of planFiles) {
    const i = f.rel.indexOf('/');
    if (i > 0) roots.add(portableKey(f.rel.slice(0, i)));
  }
  return roots;
}

// --reconcile eligibility: ONLY a diverged regular file (exactly the
// manual delete-then-update case) under a generated root. The config is
// project-owned and stays out even though it usually sits under a root;
// links, directories, collisions, unreadable or unsafe destinations and
// root-level files are never rewritten.
function reconcilable(f, roots, configPath) {
  return f.action === 'conflict'
    && f.reason === DIVERGED_REASON
    && typeof f.disk === 'string'
    && f.rel !== configPath
    && f.rel.includes('/')
    && roots.has(portableKey(f.rel.slice(0, f.rel.indexOf('/'))));
}

// Host-destination files written by `host activate` (.claude/, .devin/,
// .agents/, .opencode/, .codex/...) live OUTSIDE the generated roots the
// init plan owns, so --reconcile needs a second classify pass: re-derive
// the applyable set activation would write for every configured host and
// declared variant surface, and judge each destination against disk with
// the same safety model. Only a diverged REGULAR file whose new bytes are
// provably generated is eligible for the unlink+wx rewrite — merge
// targets (kind in MERGE_KINDS), global and reserved destinations never
// reach the applyable set, and 'pending' (absent) destinations are
// reported but never created: first activation stays an explicit
// `host activate` decision.
//
// Multi-variant hosts (antigravity app-cli|ide) and shared roots (.agents
// is emitted by both codex and antigravity) can generate DIFFERENT bytes
// for one destination. A diverged destination is auto-reconciled when the
// candidates agree on identical bytes; when they do not, the applied
// surface is inferred from byte-evidence elsewhere (the surface whose
// other destinations still match wins) and only a strictly unique best
// score rewrites — a tie or zero evidence is reported as
// diverged-but-not-reconcilable for `host activate --surface` or manual
// review.
function hostBridgePlan(ctx, options) {
  let declared = {};
  try {
    declared = loadNativeVariants(
      { installRoot: options.installRoot }).hosts ?? {};
  } catch { /* variants file unusable: hosts emit no variants */ }
  // rel -> [{plan, buf}]: every (host, surface) unit that generates the
  // destination, in emission order.
  const rels = new Map();
  const errors = [];
  const hosts = Array.isArray(ctx.config.hosts) ? ctx.config.hosts : [];
  for (const host of hosts) {
    const surfaces = Array.isArray(declared[host])
        && declared[host].length > 0
      ? declared[host].map((v) => v.id) : [null];
    for (const surface of surfaces) {
      const key = surface === null ? host : `${host}:${surface}`;
      let plan;
      try {
        plan = buildActivation(ctx, { host,
          surface: surface ?? undefined,
          installRoot: options.installRoot });
      } catch (e) {
        errors.push({ host: key,
          code: e.code ?? 'ERROR', message: e.message });
        continue;
      }
      for (const f of plan.applyable) {
        const buf = Buffer.isBuffer(f.content)
          ? f.content : Buffer.from(f.content);
        const list = rels.get(f.rel);
        if (list === undefined) rels.set(f.rel, [{ plan: key, buf }]);
        else list.push({ plan: key, buf });
      }
    }
  }
  // Pass 1: classify destinations and accumulate per-plan byte-evidence
  // (how many destinations still match that plan's generated bytes).
  const classified = new Map();
  const evidence = new Map();
  for (const [rel, candidates] of rels) {
    let abs;
    try {
      abs = resolveInside(ctx.projectRoot, rel, `host destination ${rel}`);
    } catch (e) {
      classified.set(rel, { action: 'conflict',
        reason: e.code ?? 'INVALID_PATH' });
      continue;
    }
    const st = lstatOrNull(abs);
    if (!st) {
      classified.set(rel, { action: 'pending' });
      continue;
    }
    if (st.isSymbolicLink() || !st.isFile()) {
      classified.set(rel, { action: 'conflict',
        reason: 'destination is a link or directory' });
      continue;
    }
    let limited;
    try {
      limited = readFileLimited(abs, loadLimits().maxDocumentBytes);
    } catch (e) {
      classified.set(rel, { action: 'conflict',
        reason: `read failed: ${e.code}` });
      continue;
    }
    if (limited.exceeded) {
      classified.set(rel, { action: 'conflict',
        reason: 'destination exceeds document limit' });
      continue;
    }
    const matched = new Set();
    for (const c of candidates) {
      if (limited.content.equals(c.buf)) matched.add(c.plan);
    }
    if (matched.size > 0) {
      for (const key of matched) {
        evidence.set(key, (evidence.get(key) ?? 0) + 1);
      }
      classified.set(rel, { action: 'noop' });
    } else {
      classified.set(rel, { action: 'diverged', candidates,
        disk: sha256(limited.content) });
    }
  }
  // Pass 2: resolve a rewrite target per diverged destination.
  const files = [];
  for (const [rel, info] of classified) {
    if (info.action === 'pending') {
      files.push({ rel, action: 'pending',
        reason: 'not applied; first write stays with `host activate`' });
      continue;
    }
    if (info.action === 'conflict') {
      files.push({ rel, action: 'conflict',
        reason: info.reason, reconcile: false });
      continue;
    }
    if (info.action === 'noop') {
      files.push({ rel, action: 'noop' });
      continue;
    }
    // diverged: keep only byte-distinct candidates (identical proposals
    // emitted by more than one host or surface are a single target).
    const distinct = new Map();
    for (const c of info.candidates) {
      if (![...distinct.values()].some((b) => b.equals(c.buf))) {
        distinct.set(c.plan, c.buf);
      }
    }
    if (distinct.size === 1) {
      files.push({ rel, action: 'conflict', reason: DIVERGED_REASON,
        reconcile: true, content: [...distinct.values()][0],
        disk: info.disk });
      continue;
    }
    const scored = [...distinct.entries()]
      .map(([key, buf]) => ({ key, buf, score: evidence.get(key) ?? 0 }))
      .sort((a, b) => b.score - a.score);
    if (scored[0].score > 0
        && (scored.length === 1 || scored[0].score > scored[1].score)) {
      files.push({ rel, action: 'conflict', reason: DIVERGED_REASON,
        reconcile: true, content: scored[0].buf, plan: scored[0].key,
        disk: info.disk });
    } else {
      files.push({ rel, action: 'conflict',
        reason: 'diverged: multiple surfaces generate different bytes and '
          + 'no applied-surface evidence identifies the target; pick one '
          + 'with `host activate --surface` or merge manually',
        reconcile: false });
    }
  }
  return { files, errors };
}

// Public shape: strips internal fields (content buffers, scoring data).
function hostBridgeReport(bridges, extra = {}) {
  const files = bridges.files.map(
    ({ rel, action, reason, reconcile, plan }) => ({
      rel, action,
      ...(reason ? { reason } : {}),
      ...(reconcile !== undefined ? { reconcile } : {}),
      ...(plan ? { plan } : {}),
    }));
  const counts = { noop: 0, pending: 0, conflict: 0 };
  for (const f of files) counts[f.action] = (counts[f.action] ?? 0) + 1;
  return Object.freeze({
    files, counts,
    conflicts: files.filter((f) => f.action === 'conflict')
      .map((f) => ({ path: f.rel, reason: f.reason,
        reconcile: f.reconcile })),
    errors: bridges.errors,
    ...extra,
  });
}

function assertUpdateOptions(options) {
  closed(options, ['installRoot', 'reconcile'], 'update options');
  if (options.installRoot !== undefined
      && typeof options.installRoot !== 'string') {
    throw err('LIFECYCLE_INVALID_INPUT', 'options.installRoot must be a string');
  }
  if (options.reconcile !== undefined
      && typeof options.reconcile !== 'boolean') {
    throw err('LIFECYCLE_INVALID_INPUT', 'options.reconcile must be boolean');
  }
}

// Proposes a refresh of harness-owned generated resources: every managed
// file classified create|noop|conflict. Create-only semantics; the config
// file is reported but never part of the write set. With
// {reconcile:true} each conflict additionally reports whether an apply
// would rewrite it.
export function prepareUpdate(ctx, options = {}) {
  requireCtx(ctx);
  assertUpdateOptions(options);
  const plan = generatedPlan(ctx, options);
  const classified = classifyPlan(ctx.projectRoot, plan.files);
  const roots = options.reconcile === true
    ? generatedRoots(plan.files) : null;
  const hostBridges = options.reconcile === true
    ? hostBridgePlan(ctx, options) : null;
  const files = classified.map((f) => ({
    ...(f.reason
      ? { rel: f.rel, action: f.action, reason: f.reason }
      : { rel: f.rel, action: f.action }),
    ...(roots !== null && f.action === 'conflict'
      ? { reconcile: reconcilable(f, roots, ctx.configPath) } : {}),
  }));
  const counts = { create: 0, noop: 0, conflict: 0, managed: 0 };
  const conflicts = [];
  for (const [i, f] of files.entries()) {
    counts[f.action] += 1;
    if (f.action === 'conflict') {
      const incoming = plan.files[i].content;
      const managedEligible = (() => {
        try {
          return hasManagedSection(decodeUtf8Strict(
            Buffer.isBuffer(incoming) ? incoming : Buffer.from(incoming),
            'MANAGED_MALFORMED', f.rel));
        } catch { return false; }
      })();
      conflicts.push({ path: f.rel, reason: f.reason,
        ...(roots !== null ? { reconcile: f.reconcile } : {}),
        // Only marker-eligible destinations get the opt-in hint; other
        // diverged files still demand a plain manual merge.
        ...(managedEligible
          ? { remediation: 'carrying the SCOPEGRAIN markers opts this '
              + 'file into managed refreshes; otherwise merge manually' }
          : {}) });
    }
  }
  return Object.freeze({
    mode: 'dry-run', files, counts, conflicts, warnings: [...plan.warnings],
    ...(hostBridges !== null
      ? { hostBridges: hostBridgeReport(hostBridges) } : {}),
  });
}

// In-place refresh of a managed region: the only write that is not
// create-only in the codebase, bounded to the marker-delimited region the
// file opted into. Re-reads under the same lstat check as classification
// (TOCTOU), refuses links/non-files, refuses marker removal mid-apply and
// writes through an exclusive temp + rename so a crash never leaves a
// truncated file.
function applyManagedRefresh(projectRoot, rel, incoming) {
  const abs = resolveInside(projectRoot, rel, `managed target ${rel}`);
  const st = lstatOrNull(abs);
  if (!st || !st.isFile() || st.isSymbolicLink()) {
    return { ok: false, reason: 'destination became a link or non-file during apply' };
  }
  const limited = readFileLimited(abs, loadLimits().maxDocumentBytes);
  if (limited.exceeded) {
    return { ok: false, reason: 'destination exceeded read bound during apply' };
  }
  let existing;
  try {
    existing = decodeUtf8Strict(limited.content, 'MANAGED_MALFORMED', rel);
  } catch {
    return { ok: false, reason: 'destination is not decodable UTF-8' };
  }
  const body = managedBody(decodeUtf8Strict(
    Buffer.isBuffer(incoming) ? incoming : Buffer.from(incoming),
    'MANAGED_MALFORMED', rel));
  if (body === null || !hasManagedSection(existing)) {
    return { ok: false, reason: 'managed markers vanished during apply' };
  }
  const next = upsertManaged(existing, body);
  const tmp = `${abs}.scopegrain-tmp-${process.pid}`;
  const fd = fs.openSync(tmp, 'wx');
  try {
    const buf = Buffer.from(next, 'utf8');
    let off = 0;
    while (off < buf.length) {
      const n = fs.writeSync(fd, buf, off, buf.length - off);
      if (n <= 0) {
        throw err('WRITE_FAILED', `write made no progress on ${rel}`);
      }
      off += n;
    }
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, abs);
  } catch (e) {
    removeIfExists(tmp);
    throw e;
  }
  return { ok: true };
}

export function applyUpdate(ctx, options = {}) {
  requireCtx(ctx);
  assertUpdateOptions(options);
  const plan = generatedPlan(ctx, options);
  const classified = classifyPlan(ctx.projectRoot, plan.files);
  const roots = options.reconcile === true
    ? generatedRoots(plan.files) : null;
  const hostBridges = options.reconcile === true
    ? hostBridgePlan(ctx, options) : null;
  const creates = [];
  const reconciled = [];
  const managedRefreshed = [];
  const conflicts = [];
  const hostReconciled = [];
  const hostConflicts = [];
  classified.forEach((f, i) => {
    if (f.action === 'managed') {
      const r = applyManagedRefresh(ctx.projectRoot, f.rel,
        plan.files[i].content);
      if (r.ok) managedRefreshed.push(f.rel);
      else conflicts.push({ path: f.rel, reason: r.reason });
      return;
    }
    if (f.action === 'conflict') {
      if (roots !== null && reconcilable(f, roots, ctx.configPath)) {
        const abs = resolveInside(
          ctx.projectRoot, f.rel, `reconcile target ${f.rel}`);
        const st = lstatOrNull(abs);
        if (st && st.isFile() && !st.isSymbolicLink()) {
          // Same automation as the documented manual flow: unlink the
          // diverged file, then recreate through applyPlan's exclusive
          // wx write (full preflight + rollback of only what it created).
          if (diskSha256(abs) === f.disk) {
            fs.unlinkSync(abs);
            creates.push(plan.files[i]);
            reconciled.push({ path: f.rel, reason: f.reason });
          } else {
            conflicts.push({ path: f.rel,
              reason: 'destination changed during apply' });
          }
        } else if (!st) {
          creates.push(plan.files[i]); // vanished since classification
        } else {
          conflicts.push({ path: f.rel,
            reason: 'destination became a link or non-file during apply' });
        }
        return;
      }
      conflicts.push({ path: f.rel, reason: f.reason });
      return;
    }
    // The config is project-owned: never refreshed, never written.
    if (f.action === 'create' && f.rel !== ctx.configPath) {
      creates.push(plan.files[i]);
    }
  });
  // Host-destination bridges: only diverged regular files the bridge plan
  // marked reconcilable are rewritten — same unlink+wx automation as the
  // generated roots (applyPlan re-runs the throwing preflight and rolls
  // back only what it created). 'pending' destinations are never created:
  // first activation stays with `host activate`.
  if (hostBridges !== null) {
    for (const f of hostBridges.files) {
      if (f.action !== 'conflict') continue;
      if (f.reconcile !== true) {
        hostConflicts.push({ path: f.rel, reason: f.reason });
        continue;
      }
      const abs = resolveInside(
        ctx.projectRoot, f.rel, `reconcile target ${f.rel}`);
      const st = lstatOrNull(abs);
      if (st && st.isFile() && !st.isSymbolicLink()) {
        if (typeof f.disk === 'string' && diskSha256(abs) === f.disk) {
          fs.unlinkSync(abs);
          creates.push({ rel: f.rel, content: f.content });
          hostReconciled.push({ path: f.rel, reason: f.reason });
        } else {
          hostConflicts.push({ path: f.rel,
            reason: 'destination changed during apply' });
        }
      } else if (!st) {
        hostConflicts.push({ path: f.rel,
          reason: 'destination vanished during apply' });
      } else {
        hostConflicts.push({ path: f.rel,
          reason: 'destination became a link or non-file during apply' });
      }
    }
  }
  const applied = creates.length
    ? applyPlan(ctx.projectRoot, creates)
    : { created: 0, files: [] };
  return Object.freeze({
    mode: 'applied', created: applied.created, files: applied.files,
    managed: managedRefreshed,
    reconciled, conflicts, warnings: [...plan.warnings],
    ...(hostBridges !== null ? {
      hostBridges: hostBridgeReport(hostBridges,
        { reconciled: hostReconciled, conflicts: hostConflicts }),
    } : {}),
  });
}

// --- backup ----------------------------------------------------------------

function hashEntry(root, rel, issues) {
  const abs = resolveInside(root, rel, 'backup source');
  const st = lstatOrNull(abs);
  if (!st || !st.isFile() || st.isSymbolicLink()) {
    issues.push({ code: 'BACKUP_SOURCE_SKIPPED', rel,
      message: 'source is absent, a link or non-regular' });
    return null;
  }
  let limited;
  try {
    limited = readFileLimited(abs, loadLimits().maxDocumentBytes);
  } catch (e) {
    issues.push({ code: e.code ?? 'READ_FAILED', rel, message: e.message });
    return null;
  }
  if (limited.exceeded) {
    issues.push({ code: 'DOCUMENT_TOO_LARGE', rel,
      message: 'source exceeds document limit' });
    return null;
  }
  return { rel, sha256: sha256(limited.content), bytes: limited.content.length };
}

// Manifest of everything to export: the config file, the discovery file
// that sits next to it (fingerprint-verified state a restore must not
// lose) and every regular file under the seven declared paths (state
// covers journal/workspace/sidecars). Destination must be inside the
// project and must not overlap any source, so a bundle can never
// include itself.
export function prepareBackup(ctx, options = {}) {
  requireCtx(ctx);
  closed(options, ['destination'], 'backup options');
  if (typeof options.destination !== 'string') {
    throw err('LIFECYCLE_INVALID_INPUT',
      'options.destination must be a project-relative path');
  }
  const destRel = assertDestination(options.destination, 'destination');
  const root = ctx.projectRoot;
  const cfgDir = configDirOf(ctx.configPath);
  const discoveryRel = cfgDir === '.'
    ? 'discovery.json' : `${cfgDir}/discovery.json`;
  const sources = [ctx.configPath, discoveryRel,
    ...PATH_KEYS.map((key) => ctx.config.paths[key])];
  for (const src of sources) {
    if (isSameOrAncestor(destRel, src) || isSameOrAncestor(src, destRel)) {
      throw err('BACKUP_DESTINATION_OVERLAP',
        `destination '${destRel}' overlaps backup source '${src}'`);
    }
  }
  const destAbs = resolveInside(root, destRel, 'destination');
  const dst = lstatOrNull(destAbs);
  const status = !dst ? 'absent'
    : (dst.isDirectory() && !dst.isSymbolicLink() ? 'exists' : 'invalid');

  const issues = [];
  const entries = [];
  // A declared path may legitimately contain the config/discovery file
  // (e.g. state rooted at the config dir): dedupe so the manifest never
  // carries a duplicate entry the restore validator would reject.
  const seen = new Set();
  const addEntry = (rel) => {
    const key = rel.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const entry = hashEntry(root, rel, issues);
    if (entry) entries.push(entry);
  };
  addEntry(ctx.configPath);
  addEntry(discoveryRel);
  const counter = { count: 0 };
  for (const key of PATH_KEYS) {
    const files = [];
    walkTree(root, ctx.config.paths[key], counter, files, issues);
    for (const rel of files) {
      addEntry(rel);
    }
  }
  const totalBytes = entries.reduce((sum, e) => sum + e.bytes, 0);
  return Object.freeze({
    mode: 'dry-run', destination: destRel, status, entries, issues,
    counts: { entries: entries.length, totalBytes },
  });
}

// Writes <dest>/manifest.json + <dest>/files/<rel> create-only. Every source
// is re-read and re-hashed at apply; a file that changed since the preview
// is skipped rather than exported under a stale hash.
export function applyBackup(ctx, options = {}) {
  const preview = prepareBackup(ctx, options);
  const root = ctx.projectRoot;
  const kept = [];
  const skipped = [];
  const created = [];
  const createdAbs = [];
  try {
    for (const e of preview.entries) {
      const abs = resolveInside(root, e.rel, 'backup source');
      const st = lstatOrNull(abs);
      if (!st || !st.isFile() || st.isSymbolicLink()) {
        skipped.push({ rel: e.rel, reason: 'not-regular' });
        continue;
      }
      const limited = readFileLimited(abs, loadLimits().maxDocumentBytes);
      if (limited.exceeded) {
        skipped.push({ rel: e.rel, reason: 'oversized' });
        continue;
      }
      if (sha256(limited.content) !== e.sha256) {
        skipped.push({ rel: e.rel, reason: 'changed-since-preview' });
        continue;
      }
      kept.push({ rel: e.rel, sha256: e.sha256, bytes: e.bytes });
      // Streamed apply: write this file before reading the next source so
      // peak memory is one document, not the whole state. applyPlan's 'wx'
      // + fsync + failure cleanup apply per file; createdAbs below
      // preserves the old all-or-nothing failure shape across the loop.
      const slice = applyPlan(root, [{
        rel: `${preview.destination}/files/${e.rel}`,
        content: limited.content,
      }]);
      for (const rel of slice.files) {
        created.push(rel);
        createdAbs.push(resolveInside(root, rel, 'backup output'));
      }
    }
    const manifest = JSON.stringify({
      schemaVersion: 1,
      kind: BACKUP_KIND,
      createdAt: new Date().toISOString(),
      source: { configRel: ctx.configPath },
      entries: kept,
    }, null, 2) + '\n';
    const tail = applyPlan(root, [
      { rel: `${preview.destination}/manifest.json`, content: manifest },
    ]);
    for (const rel of tail.files) created.push(rel);
  } catch (e) {
    for (const p of createdAbs) removeIfExists(p);
    throw e;
  }
  return Object.freeze({
    mode: 'applied', destination: preview.destination,
    created: created.length, files: created,
    manifest: `${preview.destination}/manifest.json`,
    skipped, issues: preview.issues,
  });
}

// --- restore ---------------------------------------------------------------

function loadBundleManifest(root, bundleRel) {
  const bundleAbs = resolveInside(root, bundleRel, 'bundle');
  const bst = lstatOrNull(bundleAbs);
  if (!bst) {
    throw err('RESTORE_BUNDLE_MISSING', `backup bundle not found: ${bundleRel}`);
  }
  if (bst.isSymbolicLink() || !bst.isDirectory()) {
    throw err('RESTORE_BUNDLE_NOT_DIR', `bundle is not a directory: ${bundleRel}`);
  }
  const manRel = `${bundleRel}/manifest.json`;
  const manAbs = resolveInside(root, manRel, 'backup manifest');
  const mst = lstatOrNull(manAbs);
  if (!mst) {
    throw err('RESTORE_MANIFEST_MISSING', `manifest not found: ${manRel}`);
  }
  if (mst.isSymbolicLink() || !mst.isFile()) {
    throw err('RESTORE_MANIFEST_MALFORMED', 'manifest is not a regular file');
  }
  const limited = readFileLimited(manAbs, loadLimits().maxDocumentBytes);
  if (limited.exceeded) {
    throw err('RESTORE_MANIFEST_MALFORMED', 'manifest exceeds document limit');
  }
  const text = decodeUtf8Strict(
    limited.content, 'RESTORE_MANIFEST_MALFORMED', 'backup manifest');
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    throw err('RESTORE_MANIFEST_MALFORMED', 'manifest is not valid JSON');
  }
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    throw err('RESTORE_MANIFEST_MALFORMED', 'manifest must be an object');
  }
  for (const key of Object.keys(doc)) {
    if (!MANIFEST_KEYS.includes(key)) {
      throw err('RESTORE_MANIFEST_MALFORMED', `manifest has unknown key '${key}'`);
    }
  }
  if (doc.schemaVersion !== 1 || doc.kind !== BACKUP_KIND
      || !Array.isArray(doc.entries)
      || typeof doc.createdAt !== 'string'
      || doc.source === null || typeof doc.source !== 'object'
      || Array.isArray(doc.source)) {
    throw err('RESTORE_MANIFEST_MALFORMED', 'manifest has invalid header fields');
  }
  if (doc.entries.length > MAX_MANIFEST_ENTRIES) {
    throw err('RESTORE_MANIFEST_MALFORMED', 'manifest exceeds entry bound');
  }
  const seen = new Set();
  const entries = doc.entries.map((e, i) => {
    if (e === null || typeof e !== 'object' || Array.isArray(e)) {
      throw err('RESTORE_ENTRY_INVALID', `entries[${i}] must be an object`);
    }
    for (const key of Object.keys(e)) {
      if (!MANIFEST_ENTRY_KEYS.includes(key)) {
        throw err('RESTORE_ENTRY_INVALID',
          `entries[${i}] has unknown key '${key}'`);
      }
    }
    if (typeof e.rel !== 'string' || typeof e.sha256 !== 'string'
        || !SHA.test(e.sha256)
        || !Number.isSafeInteger(e.bytes) || e.bytes < 0) {
      throw err('RESTORE_ENTRY_INVALID', `entries[${i}] has invalid fields`);
    }
    let rel;
    try {
      rel = assertDestination(e.rel, `entries[${i}].rel`);
    } catch (cause) {
      throw err('RESTORE_ENTRY_INVALID',
        `entries[${i}].rel is unsafe: ${cause.message}`);
    }
    if (rel !== e.rel) {
      throw err('RESTORE_ENTRY_INVALID', `entries[${i}].rel is not canonical`);
    }
    const key = rel.toLowerCase();
    if (seen.has(key)) {
      throw err('RESTORE_MANIFEST_MALFORMED', `duplicate manifest entry: ${rel}`);
    }
    seen.add(key);
    return { rel, sha256: e.sha256.toLowerCase(), bytes: e.bytes };
  });
  return { entries };
}

// Classifies one manifest entry: create|skip|conflict with a reason and,
// for creates, the hash-verified payload bytes. Read-only.
function classifyRestoreEntry(root, bundleRel, e) {
  const base = { rel: e.rel, sha256: e.sha256 };
  if (isSameOrAncestor(bundleRel, e.rel)) {
    return { ...base, action: 'skip', reason: 'self-referential' };
  }
  const payloadAbs = resolveInside(
    root, `${bundleRel}/files/${e.rel}`, 'backup payload');
  const pst = lstatOrNull(payloadAbs);
  if (!pst || !pst.isFile() || pst.isSymbolicLink()) {
    return { ...base, action: 'skip', reason: 'payload-missing' };
  }
  let payload;
  try {
    payload = readFileLimited(payloadAbs, loadLimits().maxDocumentBytes);
  } catch {
    return { ...base, action: 'skip', reason: 'payload-unreadable' };
  }
  if (payload.exceeded || sha256(payload.content) !== e.sha256) {
    return { ...base, action: 'skip', reason: 'payload-hash-mismatch' };
  }
  const targetAbs = resolveInside(root, e.rel, 'restore target');
  const tst = lstatOrNull(targetAbs);
  if (!tst) {
    return { ...base, action: 'create', content: payload.content };
  }
  if (tst.isSymbolicLink() || !tst.isFile()) {
    return { ...base, action: 'conflict', reason: 'link-or-non-file' };
  }
  let existing;
  try {
    existing = readFileLimited(targetAbs, payload.content.length);
  } catch {
    return { ...base, action: 'conflict', reason: 'target-unreadable' };
  }
  if (!existing.exceeded && existing.content.equals(payload.content)) {
    return { ...base, action: 'skip', reason: 'identical' };
  }
  return { ...base, action: 'conflict', reason: 'different-content' };
}

// Classifies every manifest entry. Payload buffers are stripped so a
// large bundle never keeps every payload live at once.
function classifyRestore(root, bundleRel, entries) {
  return entries.map((e) => {
    const { content, ...rest } = classifyRestoreEntry(root, bundleRel, e);
    return rest;
  });
}

export function prepareRestore(projectRoot, bundleRel, options = {}) {
  closed(options, [], 'restore options');
  const root = resolveProjectRoot(projectRoot);
  const rel = assertDestination(bundleRel, 'bundle');
  const { entries } = loadBundleManifest(root, rel);
  const classified = classifyRestore(root, rel, entries);
  const counts = { create: 0, skip: 0, conflict: 0 };
  const publicEntries = classified.map(({ content, ...rest }) => {
    counts[rest.action] += 1;
    return rest;
  });
  return Object.freeze({
    mode: 'dry-run', bundle: rel, entries: publicEntries, counts,
  });
}

// Creates ONLY entries whose current classification is 'create', writing
// the exact hash-verified payload bytes. Conflicts are reported, never
// merged or overwritten. Every entry is classified BEFORE any write so a
// malformed later entry can never strand a half-applied restore; payloads
// for creates are re-read and re-hashed per file at write time, keeping
// peak memory at one document instead of the whole bundle.
export function applyRestore(projectRoot, bundleRel, options = {}) {
  closed(options, [], 'restore options');
  const root = resolveProjectRoot(projectRoot);
  const rel = assertDestination(bundleRel, 'bundle');
  const { entries } = loadBundleManifest(root, rel);
  const classified = classifyRestore(root, rel, entries);
  const restored = [];
  const skipped = [];
  const conflicts = [];
  const createdAbs = [];
  try {
    for (const e of classified) {
      if (e.action === 'create') {
        // Re-verify at write time: a bundle mutated between the classify
        // pass and this write is skipped, never restored stale.
        const payloadAbs = resolveInside(
          root, `${rel}/files/${e.rel}`, 'backup payload');
        let payload;
        try {
          payload = readFileLimited(
            payloadAbs, loadLimits().maxDocumentBytes);
        } catch {
          skipped.push({ rel: e.rel, reason: 'payload-unreadable' });
          continue;
        }
        if (payload.exceeded
            || sha256(payload.content) !== e.sha256) {
          skipped.push({ rel: e.rel, reason: 'changed-since-classify' });
          continue;
        }
        const slice = applyPlan(root, [{ rel: e.rel, content: payload.content }]);
        for (const written of slice.files) {
          createdAbs.push(resolveInside(root, written, 'restore output'));
        }
        restored.push(e.rel);
      } else if (e.action === 'conflict') {
        conflicts.push({ rel: e.rel, reason: e.reason });
      } else {
        skipped.push({ rel: e.rel, reason: e.reason });
      }
    }
  } catch (error) {
    for (const p of createdAbs) removeIfExists(p);
    throw error;
  }
  return Object.freeze({ mode: 'applied', restored, skipped, conflicts });
}

// --- uninstall -------------------------------------------------------------

// Generated-file candidates: byte-identical to what this install would
// generate, or pinned by the project's own catalog snapshot (unmodified
// files from an older install). Diverged or foreign bytes are leftBehind.
// Union of the config's current hosts with every host the install knows:
// the superset of destinations uninstall may legitimately classify.
// The applied-activation record written at init/update: `hosts` are the
// host set the plan was generated for and `entries` the proposed
// source->destination copies. Read defensively -- it is on-disk data.
function activationRecord(ctx) {
  const rel = ctx.configDir === '.'
    ? 'integrations/native/activation-plan.json'
    : `${ctx.configDir}/integrations/native/activation-plan.json`;
  const abs = resolveInside(ctx.projectRoot, rel, 'activation plan');
  const st = lstatOrNull(abs);
  if (!st || !st.isFile() || st.isSymbolicLink()) return null;
  const limited = readFileLimited(abs, loadLimits().maxDocumentBytes);
  if (limited.exceeded) return null;
  try {
    const rec = JSON.parse(limited.content.toString('utf8'));
    return typeof rec === 'object' && rec !== null ? rec : null;
  } catch { return null; }
}

// Host sets whose generated bytes prove a file harness-created: the current
// config, the set recorded at apply time (retired hosts keep their proof),
// and the union of every host the install policy can render (destinations
// left by hosts since dropped from config -- OpenCode pilot finding: a
// host retired after init orphaned proposals, root entrypoints and
// divergent artifacts because deletion derived only from live config).
function proofHostSets(ctx, options) {
  const policy = loadNativePolicy({ installRoot: options.installRoot });
  const known = Object.keys(policy.hosts ?? {});
  const sets = new Map();
  const add = (hosts) => {
    const valid = [...new Set(hosts)].filter((h) => known.includes(h));
    if (valid.length) sets.set(valid.join(','), valid);
  };
  add(ctx.config.hosts ?? []);
  const rec = activationRecord(ctx);
  if (rec && typeof rec.hosts === 'object' && rec.hosts !== null) {
    add(Object.keys(rec.hosts));
  }
  add([...(ctx.config.hosts ?? []), ...known]);
  return { sets: [...sets.values()], record: rec };
}

// Generated plan files keyed by rel -> distinct byte-variants a host set
// could legitimately have produced (aggregate files like
// activation-plan.json and .gitattributes differ per host set).
function generatedPlanFiles(ctx, options) {
  const { sets } = proofHostSets(ctx, options);
  const byRel = new Map();
  for (const hosts of sets) {
    for (const f of generatedPlan(ctx, options, { hosts }).files) {
      const buf = Buffer.isBuffer(f.content)
        ? f.content : Buffer.from(f.content);
      const list = byRel.get(f.rel);
      if (list === undefined) byRel.set(f.rel, [buf]);
      else if (!list.some((b) => b.equals(buf))) list.push(buf);
    }
  }
  return byRel;
}

function generatedCandidates(ctx, options) {
  const planFiles = generatedPlanFiles(ctx, options);
  const pins = new Map();
  try {
    const catalog = loadWorkspaceCatalog(
      { projectRoot: ctx.projectRoot, configDir: ctx.configDir },
      { verifyResources: false });
    for (const e of catalog.entries) {
      if (typeof e.sha256 === 'string' && SHA.test(e.sha256)) {
        pins.set(catalogDestRel(e).toLowerCase(), e.sha256.toLowerCase());
      }
    }
  } catch { /* snapshot unavailable: generated-byte matching only */ }
  const prefix = ctx.configDir === '.' ? '' : `${ctx.configDir}/`;
  const candidates = [];
  const leftBehind = [];
  const seen = new Set();
  const prove = (rel, variants) => {
    if (rel === ctx.configPath || seen.has(rel)) return;
    seen.add(rel);
    const abs = resolveInside(ctx.projectRoot, rel, 'generated file');
    const st = lstatOrNull(abs);
    if (!st) return; // absent: nothing to delete
    if (st.isSymbolicLink() || !st.isFile()) {
      leftBehind.push({ rel, reason: 'link-or-non-file' });
      return;
    }
    const limited = readFileLimited(abs, loadLimits().maxDocumentBytes);
    if (limited.exceeded) {
      leftBehind.push({ rel, reason: 'unreadable' });
      return;
    }
    const disk = limited.content;
    if (variants.some((b) => disk.equals(b))) {
      candidates.push({ rel, sha256: sha256(disk), bytes: disk.length,
        reason: 'generated' });
      return;
    }
    const pinKey = rel.startsWith(prefix)
      ? rel.slice(prefix.length).toLowerCase() : null;
    const pinned = pinKey === null ? undefined : pins.get(pinKey);
    if (pinned !== undefined && sha256(disk) === pinned) {
      candidates.push({ rel, sha256: pinned, bytes: disk.length,
        reason: 'snapshot-pinned' });
      return;
    }
    leftBehind.push({ rel, reason: 'diverged' });
  };
  for (const [rel, variants] of planFiles) prove(rel, variants);
  // Activation record: a destination whose bytes still equal the recorded
  // source proposal under configDir is a provably applied copy. Destinations
  // diverged from their source stay behind as user-modified files.
  const { record } = proofHostSets(ctx, options);
  if (record && Array.isArray(record.entries)) {
    for (const e of record.entries) {
      if (typeof e !== 'object' || e === null
          || typeof e.destination !== 'string'
          || typeof e.source !== 'string') {
        continue;
      }
      let srcAbs; let dstAbs; let srcRel; let dstRel;
      try {
        srcRel = toCanonicalRelative(e.source, 'activation source');
        dstRel = toCanonicalRelative(e.destination,
          'activation destination');
        srcAbs = resolveInside(ctx.projectRoot, e.source,
          'activation source');
        dstAbs = resolveInside(ctx.projectRoot, e.destination,
          'activation destination');
      } catch { continue; } // forged record entry: skip, never throw
      // Recorded entries are proposals inside configDir copied to host roots
      // outside it. Anything else cannot be a harness-applied copy.
      if (prefix === '' || !srcRel.startsWith(prefix)
          || dstRel.startsWith(prefix) || dstRel === ctx.configPath
          || seen.has(dstRel)) {
        continue;
      }
      const sst = lstatOrNull(srcAbs);
      const dst = lstatOrNull(dstAbs);
      if (!sst || !sst.isFile() || !dst || !dst.isFile()
          || dst.isSymbolicLink()) {
        continue;
      }
      const src = readFileLimited(srcAbs, loadLimits().maxDocumentBytes);
      const dstL = readFileLimited(dstAbs, loadLimits().maxDocumentBytes);
      if (src.exceeded || dstL.exceeded) continue;
      seen.add(dstRel);
      if (dstL.content.equals(src.content)) {
        candidates.push({ rel: dstRel, sha256: sha256(dstL.content),
          bytes: dstL.content.length, reason: 'activation-record' });
      } else {
        leftBehind.push({ rel: dstRel, reason: 'diverged' });
      }
    }
  }
  return { candidates, leftBehind };
}

// Enumerates ONLY files provably created by the harness: the config file,
// byte-matched generated files (or snapshot-pinned older ones) and every
// regular file under paths.state. User artifact paths are never enumerated.
export function prepareUninstall(ctx, options = {}) {
  requireCtx(ctx);
  closed(options, ['installRoot'], 'uninstall options');
  if (options.installRoot !== undefined
      && typeof options.installRoot !== 'string') {
    throw err('LIFECYCLE_INVALID_INPUT', 'options.installRoot must be a string');
  }
  const root = ctx.projectRoot;
  const issues = [];
  const candidates = [];
  const leftBehind = [];

  const cfgAbs = resolveInside(root, ctx.configPath, 'config');
  const cst = lstatOrNull(cfgAbs);
  if (cst && cst.isFile() && !cst.isSymbolicLink()) {
    const limited = readFileLimited(cfgAbs, loadLimits().maxDocumentBytes);
    if (!limited.exceeded) {
      candidates.push({ rel: ctx.configPath, sha256: sha256(limited.content),
        bytes: limited.content.length, reason: 'config' });
    } else {
      issues.push({ code: 'DOCUMENT_TOO_LARGE', rel: ctx.configPath,
        message: 'config exceeds document limit' });
    }
  } else if (cst) {
    leftBehind.push({ rel: ctx.configPath, reason: 'link-or-non-file' });
  }

  const gen = generatedCandidates(ctx, options);
  candidates.push(...gen.candidates);
  leftBehind.push(...gen.leftBehind);

  const seen = new Set(candidates.map((c) => c.rel.toLowerCase()));
  const counter = { count: 0 };
  const stateFiles = [];
  walkTree(root, ctx.config.paths.state, counter, stateFiles, issues);
  for (const rel of stateFiles) {
    if (seen.has(rel.toLowerCase())) continue;
    const abs = resolveInside(root, rel, 'state file');
    let limited;
    try {
      limited = readFileLimited(abs, loadLimits().maxDocumentBytes);
    } catch (e) {
      issues.push({ code: e.code ?? 'READ_FAILED', rel, message: e.message });
      continue;
    }
    if (limited.exceeded) {
      issues.push({ code: 'DOCUMENT_TOO_LARGE', rel,
        message: 'state file exceeds document limit' });
      continue;
    }
    candidates.push({ rel, sha256: sha256(limited.content),
      bytes: limited.content.length, reason: 'state' });
  }

  return Object.freeze({ mode: 'dry-run', candidates, leftBehind, issues });
}

// Harness-owned directory scopes: the config dir, paths.state and every
// ancestor directory of a generated file. Used to remove emptied dirs
// bottom-up after deletion; the project root is never touched.
function harnessDirScopes(ctx, options) {
  const scopes = new Set();
  if (ctx.configDir !== '.') scopes.add(ctx.configDir);
  scopes.add(ctx.config.paths.state);
  for (const rel0 of generatedPlanFiles(ctx, options).keys()) {
    let rel = rel0;
    while (rel.includes('/')) {
      rel = rel.slice(0, rel.lastIndexOf('/'));
      scopes.add(rel);
    }
  }
  const counter = { count: 0 };
  const stateFiles = [];
  walkTree(ctx.projectRoot, ctx.config.paths.state, counter, stateFiles, []);
  for (const rel of stateFiles) {
    let r = rel;
    while (r.includes('/')) {
      r = r.slice(0, r.lastIndexOf('/'));
      if (!isSameOrAncestor(ctx.config.paths.state, r)) break;
      scopes.add(r);
    }
  }
  return scopes;
}

// Deletes ONLY regular files that still byte-match the preview hash, then
// removes emptied harness directories bottom-up. Anything that changed is
// reported as leftBehind -- never deleted, never merged.
export function applyUninstall(ctx, options = {}) {
  const preview = prepareUninstall(ctx, options);
  const root = ctx.projectRoot;
  const deleted = [];
  const leftBehind = [...preview.leftBehind];
  for (const c of preview.candidates) {
    const abs = resolveInside(root, c.rel, 'uninstall candidate');
    const st = lstatOrNull(abs);
    if (!st) continue; // already gone
    if (!st.isFile() || st.isSymbolicLink()) {
      leftBehind.push({ rel: c.rel, reason: 'not-regular' });
      continue;
    }
    const limited = readFileLimited(abs, loadLimits().maxDocumentBytes);
    if (limited.exceeded || sha256(limited.content) !== c.sha256) {
      leftBehind.push({ rel: c.rel, reason: 'changed-since-preview' });
      continue;
    }
    fs.unlinkSync(abs);
    deleted.push(c.rel);
  }
  const scopes = harnessDirScopes(ctx, options);
  const eligible = new Set();
  for (const rel of deleted) {
    let r = rel;
    while (r.includes('/')) {
      r = r.slice(0, r.lastIndexOf('/'));
      if (scopes.has(r)) eligible.add(r);
    }
  }
  const ordered = [...eligible]
    .sort((a, b) => b.split('/').length - a.split('/').length);
  const removedDirs = [];
  for (const rel of ordered) {
    const abs = resolveInside(root, rel, 'harness directory');
    const st = lstatOrNull(abs);
    if (!st || !st.isDirectory() || st.isSymbolicLink()) continue;
    try {
      fs.rmdirSync(abs);
      removedDirs.push(rel);
    } catch { /* non-empty or foreign: left in place */ }
  }
  return Object.freeze({ mode: 'applied', deleted, leftBehind, removedDirs });
}
