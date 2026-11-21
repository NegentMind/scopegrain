// SPDX-License-Identifier: Apache-2.0
// Init planning and application: renders templates, builds the full file
// plan, preflights every destination and creates files exclusively.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { err } from './errors.mjs';
import { decodeUtf8Strict, lstatOrNull, mkdirpSync, readFileLimited, removeIfExists } from './fsx.mjs';
import {
  portableKey, resolveInside, toCanonicalRelative,
} from './paths.mjs';
import {
  assertAnswersMatchConfig,
  assertNoCollisions, configDirOf, createConfig,
  loadConfig, resolveConfigPath, validateAnswers,
} from './config.mjs';
import { inspectProject } from '../discovery/inspect.mjs';
import { renderAdapters } from '../hosts/render.mjs';
import { catalogFiles, loadCatalog } from './catalog.mjs';
import { loadLimits } from './policy.mjs';
import { buildVersioningFiles } from './versioning.mjs';
import { renderNativeAdapters } from '../hosts/native.mjs';
import { wrapManaged } from './managed-section.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const INSTALL_ROOT = path.resolve(MODULE_DIR, '..', '..');
const TEMPLATES_DIR = path.join(INSTALL_ROOT, 'templates');
const SERVER_PATH = path.join(INSTALL_ROOT, 'src', 'mcp', 'server.mjs');
const AGENTS_HOSTS = new Set(['codex', 'opencode', 'devin']);

export function templateDir(installRoot = INSTALL_ROOT) {
  return path.join(installRoot, 'templates');
}

function readTemplate(name, templatesDir = TEMPLATES_DIR) {
  const file = path.join(templatesDir, name);
  const limited = readFileLimited(file, loadLimits().maxDocumentBytes);
  if (limited.exceeded) {
    throw err('TEMPLATE_TOO_LARGE',
      `template exceeds ${loadLimits().maxDocumentBytes} bytes: ${name}`);
  }
  return decodeUtf8Strict(
    limited.content, 'TEMPLATE_MALFORMED', `template ${name}`);
}

export function renderTemplate(text, vars) {
  let out = text;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{{${k}}}`).join(v);
  }
  if (out.includes('{{')) {
    throw err('TEMPLATE_UNRESOLVED', 'unresolved placeholder remains after render');
  }
  return out;
}

function planFile(projectRoot, rel, content) {
  const abs = resolveInside(projectRoot, rel, `plan destination ${rel}`);
  return { rel, abs, content };
}

// Builds the complete init plan from an already-validated config object.
// Pure computation + reads; performs no writes. configContent and
// discoveryContent may supply preserved bytes for re-init no-ops.
export function buildInitPlan({
  projectRoot, configRel, config, configContent, discovery, discoveryContent,
  templatesDir = TEMPLATES_DIR, installRoot = null,
}) {
  const cfgRel = resolveConfigPath(projectRoot, configRel);
  assertNoCollisions(config.paths, cfgRel, config.hosts);

  const configDir = configDirOf(cfgRel);
  const prefix = configDir === '.' ? '' : configDir + '/';
  const configAbs = resolveInside(projectRoot, cfgRel, 'config');
  const instructionsRel = `${prefix}instructions.md`;
  const discoveryRel = `${prefix}discovery.json`;

  const files = [];
  const warnings = [];
  files.push(planFile(projectRoot, cfgRel,
    configContent !== undefined
      ? configContent
      : JSON.stringify(config, null, 2) + '\n'));
  files.push(planFile(projectRoot, instructionsRel, renderTemplate(
    readTemplate('project-instructions.md', templatesDir),
    { configPath: cfgRel, discoveryPath: discoveryRel })));
  // discovery.json is ALWAYS planned: preserved bytes on a no-op re-init,
  // fresh serialization when absent (repairing a deleted file) or changed.
  files.push(planFile(projectRoot, discoveryRel,
    discoveryContent !== undefined
      ? discoveryContent
      : JSON.stringify(discovery ?? null, null, 2) + '\n'));

  // Common entrypoint for codex/opencode/devin; CLAUDE.md for claude.
  // Distinct filenames: no duplicates inside a single plan. The entrypoint
  // is wrapped in managed markers: bytes outside the markers belong to the
  // user, so update can refresh the section without a whole-file conflict.
  const entry = wrapManaged(renderTemplate(
    readTemplate('entrypoint.md', templatesDir), {
      instructionsPath: instructionsRel,
      configPath: cfgRel,
    }));
  if (config.hosts.some((h) => AGENTS_HOSTS.has(h))) {
    files.push(planFile(projectRoot, 'AGENTS.md', entry));
  }
  if (config.hosts.includes('claude')) {
    files.push(planFile(projectRoot, 'CLAUDE.md', entry));
  }

  const rendered = renderAdapters(config, {
    projectRoot,
    configPath: configAbs,
    instructionsPath: resolveInside(projectRoot, instructionsRel),
    serverPath: SERVER_PATH,
  });
  for (const f of rendered.files) {
    files.push(planFile(projectRoot, `${prefix}${f.relativePath}`, f.content));
  }
  files.push(planFile(projectRoot, `${prefix}task-contract.md`,
    readTemplate('task-contract.md', templatesDir)));

  // Canonical workflow/limits policy copied verbatim so copied references
  // can resolve ../policy/*.json inside the projected workspace.
  for (const p of ['workflow.json', 'operation-limits.json',
    'methodology.json']) {
    files.push(planFile(projectRoot, `${prefix}policy/${p}`,
      readTemplate(path.join('..', 'policy', p), templatesDir)));
  }

  // Catalog projection: every manifest entry (commands, agents, skills,
  // rules, references, profiles) plus catalog.json. The three template
  // skills arrive through the catalog mapping skills/<id>/SKILL.md.
  // ONE coherent catalog capture: catalogFiles and native adapters share
  // the same buffers/metadata so the snapshot and bridges never diverge.
  const catalog = loadCatalog({
    installRoot: installRoot || path.dirname(templatesDir),
  });
  const catFiles = catalogFiles({ catalog });
  for (const cf of catFiles) {
    files.push(planFile(projectRoot, `${prefix}${cf.rel}`, cf.content));
  }

  // Versioning proposals: <configDir>/.gitignore (skipped at project root)
  // and integrations/gitignore-proposal.txt. Root .gitignore untouched.
  for (const vf of buildVersioningFiles({
    configDir, paths: config.paths, versioning: config.versioning,
  })) {
    files.push(planFile(projectRoot, vf.rel, vf.content));
  }

  // Native host proposals: thin bridges under integrations/native plus the
  // manual-review activation plan. Proposals only — no host-root writes.
  const native = renderNativeAdapters(config, {
    configRel: cfgRel,
    installRoot: installRoot || path.dirname(templatesDir),
    catalog,
    projectRoot,
  });
  for (const nf of native.files) {
    files.push(planFile(projectRoot, nf.rel, Buffer.from(nf.content, 'utf8')));
  }
  files.push(planFile(projectRoot,
    `${prefix}integrations/native/activation-plan.json`,
    JSON.stringify(native.activationPlan, null, 2) + '\n'));

  // Git transport: .gitattributes INSIDE configDir pins -text for every
  // generated file under it (config, discovery, instructions, catalog,
  // integrations, and the attributes file itself) so bytes survive
  // core.autocrlf checkout. Literal paths only — no wildcards, nothing
  // outside the config dir. Skipped at project root.
  if (configDir !== '.') {
    const esc = (p) => JSON.stringify(
      `/${p.replace(/([\\*?\[\]])/g, '\\$1')}`);
    const covered = files
      .map((f) => f.rel)
      .filter((rel) => rel.startsWith(prefix))
      .map((rel) => rel.slice(prefix.length));
    covered.push('.gitattributes');
    const lines = covered.map((rel) => `${esc(rel)} -text\n`).join('');
    files.push(planFile(projectRoot,
      `${prefix}.gitattributes`,
      '# Preserve generated harness bytes; root project attributes are '
        + `unchanged.\n${lines}`));
  } else {
    warnings.push('configDir is project root: snapshot Git transport '
      + '(line-ending conversion) requires manual review');
  }
  return { config, files, configDir, configRel: cfgRel, warnings };
}

// Every planned file is checked before anything is written:
// - no two planned destinations may be equal or ancestor-related
//   (case-insensitive portable comparison),
// - each leaf must be absent, a link, a non-file, identical (noop) or
//   different (conflict).
export function preflightPlan(projectRoot, files) {
  const conflicts = [];
  // O(n log n) collision check: canonical keys sort all descendants of a
  // prefix into a contiguous run right after it ('a' < 'a/*' < 'a0'), so
  // any ancestor/equal pair is detectable as an adjacent pair — no need
  // to compare every ordered pair.
  const keyed = files.map((f) => ({
    rel: f.rel,
    key: portableKey(toCanonicalRelative(f.rel, `plan destination ${f.rel}`)),
  })).sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
  for (let i = 1; i < keyed.length; i++) {
    const a = keyed[i - 1];
    const b = keyed[i];
    if (b.key === a.key || b.key.startsWith(`${a.key}/`)) {
      conflicts.push({
        path: b.rel,
        reason: `planned destination collides with ${a.rel}`,
      });
    }
  }
  const planned = files.map((f) => {
    // Re-verify containment and the no-link/no-file ancestor chain now.
    const abs = resolveInside(projectRoot, f.rel, `plan destination ${f.rel}`);
    const st = lstatOrNull(abs);
    if (!st) return { ...f, abs, action: 'create' };
    if (st.isSymbolicLink() || !st.isFile()) {
      conflicts.push({ path: f.rel, reason: 'destination is a link or directory' });
      return { ...f, abs, action: 'conflict' };
    }
    const incoming = Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content);
    // Bounded comparison read: incoming.length is the bound, so an
    // oversized/changed existing file yields conflict without a full read
    // or partial data.
    const limited = readFileLimited(abs, incoming.length);
    if (limited.exceeded) {
      conflicts.push({ path: f.rel,
        reason: 'destination exists with different content' });
      return { ...f, abs, action: 'conflict' };
    }
    if (limited.content.equals(incoming)) {
      return { ...f, abs, action: 'noop' };
    }
    conflicts.push({ path: f.rel, reason: 'destination exists with different content' });
    return { ...f, abs, action: 'conflict' };
  });
  if (conflicts.length > 0) {
    const e = err('PLAN_CONFLICT',
      'existing files block init; reconcile manually (no overwrite)');
    e.conflicts = conflicts;
    throw e;
  }
  return planned;
}

// If the config already exists, it must be valid and match the answers;
// otherwise the run is an explicit error, never a silent overwrite.
// Returns the loaded config or null when absent.
export function checkExistingConfig(projectRoot, configRel, answers) {
  const abs = resolveInside(projectRoot, configRel, 'config');
  if (!lstatOrNull(abs)) return null;
  const { config } = loadConfig(projectRoot, configRel);
  assertAnswersMatchConfig(answers, config);
  return config;
}

function readRegularFile(abs, maxBytes = loadLimits().maxDocumentBytes) {
  const st = lstatOrNull(abs);
  if (!st || !st.isFile() || st.isSymbolicLink()) {
    return undefined;
  }
  const limited = readFileLimited(abs, maxBytes);
  if (limited.exceeded) {
    throw err('DOCUMENT_TOO_LARGE',
      `existing document exceeds ${maxBytes} bytes: ${abs}`);
  }
  return limited.content;
}

// Applies a preflighted plan. Re-verifies the whole preflight immediately
// before writing (covering anything changed since the plan was shown).
// Each file is created with an exclusive descriptor whose ownership is
// recorded BEFORE content is written, so a mid-write failure still rolls
// back exactly the files this operation created — never foreign files and
// never directories.
export function applyPlan(projectRoot, files) {
  const planned = preflightPlan(projectRoot, files);
  const created = [];
  try {
    for (const f of planned) {
      if (f.action === 'noop') continue;
      mkdirpSync(path.dirname(f.abs));
      const fd = fs.openSync(f.abs, 'wx');
      created.push(f.abs); // we own this file from the successful open
      try {
        const buf = Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content);
        let written = 0;
        while (written < buf.length) {
          const n = fs.writeSync(fd, buf, written, buf.length - written);
          if (n <= 0) {
            throw err('WRITE_FAILED',
              `write made no progress on ${f.rel}`);
          }
          written += n;
        }
        // Durability parity with the journal's committed marker.
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    }
  } catch (e) {
    for (const p of created) removeIfExists(p);
    throw e;
  }
  // `files` lists only destinations this call actually wrote; `noop`
  // lists the ones already holding identical bytes. Reporting the full
  // planned set as written made pure-noop applies look like writes.
  return {
    created: created.length,
    files: planned.filter((f) => f.action === 'create').map((f) => f.rel),
    noop: planned.filter((f) => f.action === 'noop').map((f) => f.rel),
  };
}

export function prepareInit({ projectRoot, configRel, answers }) {
  validateAnswers(answers); // early validation before any plan work
  const cfgRel = resolveConfigPath(projectRoot, configRel);
  const existing = checkExistingConfig(projectRoot, cfgRel, answers);
  const discovery = inspectProject(projectRoot);

  let config;
  let configContent;
  let discoveryContent;
  if (existing && existing.discovery.fingerprint === discovery.fingerprint) {
    // True no-op re-init: preserve the entire stored config object AND the
    // original config/discovery bytes (whitespace, ordering, custom
    // verification.commands, original evidence). Fresh discovery remains
    // preview/doctor information only.
    config = existing;
    const cfgDir = configDirOf(cfgRel);
    const configAbs = resolveInside(projectRoot, cfgRel, 'config');
    const discoveryAbs = resolveInside(projectRoot,
      cfgDir === '.' ? 'discovery.json' : `${cfgDir}/discovery.json`);
    configContent = readRegularFile(configAbs);
    discoveryContent = readRegularFile(discoveryAbs);
  } else {
    config = createConfig(projectRoot, answers, discovery);
    // Changed manifests produce new config/discovery bytes; when a config
    // already exists that difference is reported as an explicit conflict.
    discoveryContent = JSON.stringify(discovery, null, 2) + '\n';
  }
  const plan = buildInitPlan({
    projectRoot, configRel: cfgRel, config,
    configContent, discovery, discoveryContent,
  });
  const planned = preflightPlan(projectRoot, plan.files);
  return { ...plan, discovery, files: planned };
}
