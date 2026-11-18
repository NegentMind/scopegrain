// Semantic project investigation: a bounded, read-only layer on top of
// inspectProject. No writes, no shell, no network. Detection is limited
// to fixed existence probes (lstat only), one bounded listing of
// .github/workflows and bounded re-reads (<=128 KiB) of allowlisted
// manifest names already discovered by the scanner or the probe list.
// Nothing outside those allowlists is ever opened: secret files
// (.env*, *.pem, *.key, credentials*, .npmrc, .ssh/*, ...) are
// structurally unreachable because reads are name-allowlisted.
import path from 'node:path';
import { err } from '../core/errors.mjs';
import { decodeUtf8Strict, lstatOrNull, readDirBounded, readFileLimited }
  from '../core/fsx.mjs';
import { resolveInside, resolveProjectRoot } from '../core/paths.mjs';
import {
  KNOWN_HOSTS, PATH_KEYS, allFalseVersioning, defaultPathProposals,
  validateConfigObject,
} from '../core/config.mjs';
import { inspectProject } from './inspect.mjs';

const MAX_MANIFEST_BYTES = 128 * 1024;
const MAX_WORKFLOW_ENTRIES = 64;
const WORKFLOWS_DIR = '.github/workflows';

const TOPOLOGY_KINDS = ['monorepo', 'single-package', 'unstructured', 'empty'];
const EVIDENCE_TYPES = new Set([
  'manifest', 'lockfile', 'instructions', 'dir', 'config', 'workflow',
  'host', 'ci',
]);
const CONFIDENCE = new Set(['detected', 'default']);
const RECORD_KEYS = new Set([
  'schemaVersion', 'fingerprint', 'stacks', 'topology', 'evidence',
  'suggestions', 'unknowns', 'timestamp',
]);
const SUGGESTION_KEYS = new Set([
  'name', 'hosts', 'paths', 'verification', 'versioning', 'unanswered',
]);
const INVESTIGATION_OPTION_KEYS = new Set(['config']);
const RECORD_OPTION_KEYS = new Set(['timestamp']);

// --- Fixed probe tables ---------------------------------------------------
// Directory probes: lstat only; a symlink or non-directory counts as absent.
// Contents of these directories are NEVER listed (host dirs may contain
// secrets). kind selects where the hit is recorded.
const DIR_PROBES = [
  { rel: 'src', kind: 'sourceDir' },
  { rel: 'lib', kind: 'sourceDir' },
  { rel: 'app', kind: 'sourceDir' },
  { rel: 'source', kind: 'sourceDir' },
  { rel: 'test', kind: 'testDir' },
  { rel: 'tests', kind: 'testDir' },
  { rel: 'spec', kind: 'testDir' },
  { rel: 'e2e', kind: 'testDir' },
  { rel: '__tests__', kind: 'testDir' },
  { rel: 'docs', kind: 'docDir' },
  { rel: 'doc', kind: 'docDir' },
  { rel: 'android', kind: 'platform', platform: 'mobile' },
  { rel: 'ios', kind: 'platform', platform: 'mobile' },
  { rel: 'src-tauri', kind: 'platform', platform: 'desktop' },
  { rel: 'locales', kind: 'i18n' },
  { rel: 'i18n', kind: 'i18n' },
  { rel: 'l10n', kind: 'i18n' },
  { rel: '.claude', kind: 'host', host: 'claude' },
  { rel: '.codex', kind: 'host', host: 'codex' },
  { rel: '.opencode', kind: 'host', host: 'opencode' },
  { rel: '.devin', kind: 'host', host: 'devin' },
  { rel: '.antigravity', kind: 'host', host: 'antigravity' },
  { rel: '.agents', kind: 'host', host: 'antigravity' },
  { rel: '.agent', kind: 'host', host: 'antigravity' },
];

// File probes: lstat only unless `read` names an allowlisted parser.
// Optional fields map the hit to signals: stack (manifest), topology,
// framework (test config), platform, i18n, ci, doc, host.
const FILE_PROBES = [
  { rel: 'pubspec.yaml', stack: 'dart', read: 'pubspec' },
  { rel: 'Package.swift', stack: 'swift' },
  { rel: 'requirements.txt', stack: 'python' },
  { rel: 'setup.py', stack: 'python' },
  { rel: 'build.gradle', stack: 'gradle' },
  { rel: 'build.gradle.kts', stack: 'gradle' },
  { rel: 'turbo.json', topology: 'turbo' },
  { rel: 'nx.json', topology: 'nx' },
  { rel: 'lerna.json', topology: 'lerna' },
  { rel: 'pnpm-workspace.yaml', topology: 'pnpm-workspace' },
  { rel: 'rush.json', topology: 'rush' },
  { rel: 'settings.gradle', stack: 'gradle', topology: 'gradle-settings' },
  { rel: 'settings.gradle.kts', stack: 'gradle', topology: 'gradle-settings' },
  { rel: 'vitest.config.js', framework: 'vitest' },
  { rel: 'vitest.config.ts', framework: 'vitest' },
  { rel: 'vitest.config.mts', framework: 'vitest' },
  { rel: 'vitest.config.mjs', framework: 'vitest' },
  { rel: 'vitest.config.cjs', framework: 'vitest' },
  { rel: 'vitest.config.cts', framework: 'vitest' },
  { rel: 'jest.config.js', framework: 'jest' },
  { rel: 'jest.config.ts', framework: 'jest' },
  { rel: 'jest.config.mjs', framework: 'jest' },
  { rel: 'jest.config.cjs', framework: 'jest' },
  { rel: 'jest.config.json', framework: 'jest' },
  { rel: 'playwright.config.ts', framework: 'playwright' },
  { rel: 'playwright.config.js', framework: 'playwright' },
  { rel: 'playwright.config.mts', framework: 'playwright' },
  { rel: 'cypress.config.js', framework: 'cypress' },
  { rel: 'cypress.config.ts', framework: 'cypress' },
  { rel: 'cypress.config.mjs', framework: 'cypress' },
  { rel: 'cypress.config.cjs', framework: 'cypress' },
  { rel: 'karma.conf.js', framework: 'karma' },
  { rel: 'karma.conf.ts', framework: 'karma' },
  { rel: '.mocharc.yml', framework: 'mocha' },
  { rel: '.mocharc.yaml', framework: 'mocha' },
  { rel: '.mocharc.json', framework: 'mocha' },
  { rel: '.mocharc.js', framework: 'mocha' },
  { rel: 'pytest.ini', framework: 'pytest' },
  { rel: 'tox.ini', framework: 'pytest' },
  { rel: 'conftest.py', framework: 'pytest' },
  { rel: '.config/nextest.toml', framework: 'cargo-nextest' },
  { rel: 'phpunit.xml', framework: 'phpunit' },
  { rel: 'phpunit.xml.dist', framework: 'phpunit' },
  { rel: 'tauri.conf.json', platform: 'desktop' },
  { rel: 'src-tauri/tauri.conf.json', platform: 'desktop' },
  { rel: 'electron-builder.yml', platform: 'desktop' },
  { rel: 'electron-builder.yaml', platform: 'desktop' },
  { rel: 'next.config.js', platform: 'web' },
  { rel: 'next.config.ts', platform: 'web' },
  { rel: 'next.config.mjs', platform: 'web' },
  { rel: 'nuxt.config.ts', platform: 'web' },
  { rel: 'nuxt.config.js', platform: 'web' },
  { rel: 'astro.config.mjs', platform: 'web' },
  { rel: 'astro.config.ts', platform: 'web' },
  { rel: 'astro.config.js', platform: 'web' },
  { rel: 'svelte.config.js', platform: 'web' },
  { rel: 'svelte.config.ts', platform: 'web' },
  { rel: 'vite.config.ts', platform: 'web' },
  { rel: 'vite.config.js', platform: 'web' },
  { rel: 'vite.config.mts', platform: 'web' },
  { rel: 'vite.config.mjs', platform: 'web' },
  { rel: 'angular.json', platform: 'web' },
  { rel: 'remix.config.js', platform: 'web' },
  { rel: 'i18next.config.js', i18n: true },
  { rel: 'i18next.config.ts', i18n: true },
  { rel: 'i18next.config.mjs', i18n: true },
  { rel: '.gitlab-ci.yml', ci: 'gitlab-ci' },
  { rel: 'azure-pipelines.yml', ci: 'azure-pipelines' },
  { rel: 'Jenkinsfile', ci: 'jenkins' },
  { rel: '.travis.yml', ci: 'travis' },
  { rel: 'bitbucket-pipelines.yml', ci: 'bitbucket-pipelines' },
  { rel: '.circleci/config.yml', ci: 'circleci' },
  { rel: '.woodpecker.yml', ci: 'woodpecker' },
  { rel: 'README.rst', doc: true },
  { rel: 'README.txt', doc: true },
  { rel: 'README.adoc', doc: true },
  { rel: 'README', doc: true },
  { rel: 'opencode.json', host: 'opencode' },
  { rel: 'opencode.jsonc', host: 'opencode' },
  { rel: '.codex/config.toml', host: 'codex' },
  { rel: 'GEMINI.md', host: 'antigravity' },
  { rel: 'src/main.rs', cliHint: 'rust' },
];

// package.json dependency tables (existence of the dep name, never its
// version nor the lockfile contents).
const NODE_DEP_FRAMEWORKS = new Map([
  ['vitest', 'vitest'], ['jest', 'jest'], ['@jest/globals', 'jest'],
  ['mocha', 'mocha'], ['ava', 'ava'], ['tap', 'tap'],
  ['playwright', 'playwright'], ['@playwright/test', 'playwright'],
  ['cypress', 'cypress'], ['jasmine', 'jasmine'], ['uvu', 'uvu'],
]);
const NODE_DEP_PLATFORMS = new Map([
  ['electron', 'desktop'], ['@tauri-apps/api', 'desktop'],
  ['@tauri-apps/cli', 'desktop'],
  ['react', 'web'], ['react-dom', 'web'], ['vue', 'web'],
  ['@angular/core', 'web'], ['svelte', 'web'], ['next', 'web'],
  ['nuxt', 'web'], ['astro', 'web'], ['solid-js', 'web'],
  ['preact', 'web'], ['@remix-run/react', 'web'],
]);
const NODE_DEP_I18N = new Set([
  'i18next', 'react-i18next', 'react-intl', 'vue-i18n', 'next-intl',
  '@formatjs/intl', '@angular/localize', '@fluent/bundle', 'svelte-i18n',
  'typesafe-i18n',
]);

// --- Small helpers --------------------------------------------------------
function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function probePath(rootAbs, rel) {
  const abs = resolveInside(rootAbs, rel, 'probe path');
  return lstatOrNull(abs);
}

function isRealFile(st) {
  return Boolean(st && st.isFile() && !st.isSymbolicLink());
}

function isRealDir(st) {
  return Boolean(st && st.isDirectory() && !st.isSymbolicLink());
}

function parentDir(rel) {
  const i = rel.lastIndexOf('/');
  return i === -1 ? '.' : rel.slice(0, i);
}

function baseName(rel) {
  const i = rel.lastIndexOf('/');
  return i === -1 ? rel : rel.slice(i + 1);
}

function sortUnique(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function pushEvidence(list, type, rel, extra) {
  list.push({ type, path: rel, ...extra });
}

// Bounded re-read of an allowlisted manifest. Returns utf8 text or null
// after recording a warning; never throws on IO problems.
function rereadManifest(rootAbs, rel, warnings) {
  let limited;
  try {
    limited = readFileLimited(
      resolveInside(rootAbs, rel, 'manifest'), MAX_MANIFEST_BYTES);
  } catch (e) {
    warnings.push({
      code: 'MANIFEST_UNREADABLE',
      message: `cannot read manifest: ${e.code || e.message}`,
      path: rel,
    });
    return null;
  }
  if (limited.exceeded) {
    warnings.push({
      code: 'MANIFEST_TOO_LARGE',
      message: `manifest exceeds ${MAX_MANIFEST_BYTES} bytes; content skipped`,
      path: rel,
    });
    return null;
  }
  // Non-roundtrippable UTF-8 cannot be represented faithfully as text:
  // mirror inspect.mjs by warning MANIFEST_MALFORMED and skipping content.
  try {
    return decodeUtf8Strict(limited.content, 'MANIFEST_MALFORMED', rel);
  } catch {
    warnings.push({
      code: 'MANIFEST_MALFORMED',
      message: 'manifest is not valid UTF-8; content skipped',
      path: rel,
    });
    return null;
  }
}

// --- Allowlisted manifest parsers (best effort, bounded input) ------------
function parsePackageJson(text) {
  let pkg;
  try {
    pkg = JSON.parse(text);
  } catch {
    return null; // inspect already warned MALFORMED_JSON
  }
  if (pkg === null || typeof pkg !== 'object' || Array.isArray(pkg)) {
    return null;
  }
  const deps = {};
  for (const key of ['dependencies', 'devDependencies']) {
    const d = pkg[key];
    if (d && typeof d === 'object' && !Array.isArray(d)) {
      for (const name of Object.keys(d)) deps[name] = true;
    }
  }
  let workspaces = [];
  if (Array.isArray(pkg.workspaces)) {
    workspaces = pkg.workspaces;
  } else if (pkg.workspaces && typeof pkg.workspaces === 'object'
      && Array.isArray(pkg.workspaces.packages)) {
    workspaces = pkg.workspaces.packages;
  }
  return {
    name: typeof pkg.name === 'string' && pkg.name.trim() !== ''
      ? pkg.name : null,
    workspaces: workspaces.filter((w) => typeof w === 'string'),
    hasBin: Boolean(pkg.bin),
    deps: Object.keys(deps),
  };
}

// Minimal section-aware TOML scan: only what detection needs, no parser.
function tomlSectionString(text, section, key) {
  const lines = text.split('\n');
  let inSection = false;
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('[')) {
      inSection = t === `[${section}]`;
      continue;
    }
    if (!inSection) continue;
    const m = t.match(/^([A-Za-z0-9_-]+)\s*=\s*"([^"]*)"/);
    if (m && m[1] === key) return m[2];
  }
  return null;
}

function parseCargoToml(text) {
  return {
    name: tomlSectionString(text, 'package', 'name'),
    isWorkspace: /^\s*\[workspace\]/m.test(text),
    hasBin: /^\s*\[\[bin\]\]/m.test(text) || /^\s*\[bin\]/m.test(text),
  };
}

function parsePyproject(text) {
  return {
    name: tomlSectionString(text, 'project', 'name')
      ?? tomlSectionString(text, 'tool.poetry', 'name'),
    hasPytest: /\[tool\.pytest/.test(text),
  };
}

// Line scan only; pubspec.yaml is YAML but detection needs three keys.
function parsePubspec(text) {
  const out = { name: null, isFlutter: false, hasFlutterTest: false,
    hasTest: false };
  for (const line of text.split('\n')) {
    const m = line.match(/^name\s*:\s*(\S+)/);
    if (m && !out.name) out.name = m[1];
    if (/sdk\s*:\s*flutter/.test(line)) out.isFlutter = true;
    if (/^\s*flutter_test\s*:/.test(line)) out.hasFlutterTest = true;
    if (/^\s*test\s*:/.test(line)) out.hasTest = true;
    if (/^flutter\s*:/.test(line)) out.isFlutter = true;
  }
  return out;
}

function parseCsproj(text) {
  const frameworks = [];
  if (/Microsoft\.NET\.Test\.Sdk/.test(text)) frameworks.push('dotnet-test');
  if (/xunit/i.test(text)) frameworks.push('xunit');
  if (/nunit/i.test(text)) frameworks.push('nunit');
  if (/MSTest/.test(text)) frameworks.push('mstest');
  return { frameworks };
}

// --- Investigation --------------------------------------------------------
function assertOptions(options, allowed, code) {
  if (options === undefined || options === null) return {};
  if (typeof options !== 'object' || Array.isArray(options)) {
    throw err(code, 'options must be a closed object');
  }
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) {
      throw err(code, `options contains unknown key '${key}'`);
    }
  }
  return options;
}

export function assertInvestigation(inv) {
  if (inv === null || typeof inv !== 'object' || Array.isArray(inv)
      || inv.schemaVersion !== 1 || typeof inv.fingerprint !== 'string'
      || !Array.isArray(inv.stacks) || !Array.isArray(inv.evidence)
      || !Array.isArray(inv.commands) || !Array.isArray(inv.unknowns)
      || !Array.isArray(inv.warnings) || !Array.isArray(inv.names)
      || typeof inv.projectName !== 'string'
      || inv.topology === null || typeof inv.topology !== 'object'
      || Array.isArray(inv.topology)
      || inv.hosts === null || typeof inv.hosts !== 'object'
      || Array.isArray(inv.hosts)
      || !Array.isArray(inv.hosts.signals)) {
    throw err('INVESTIGATION_INVALID_INPUT',
      'argument is not a semantic investigation result');
  }
  return inv;
}

// Bounded read-only investigation. options is a closed object:
// {config?} where config supplies the seven configured artifact paths
// for existence probing; it never weakens bounds and is never mutated.
export function investigateProject(projectRoot, options) {
  const opts = assertOptions(
    options, INVESTIGATION_OPTION_KEYS, 'INVESTIGATION_INVALID_OPTIONS');
  let config = null;
  if (opts.config !== undefined) {
    if (opts.config === null || typeof opts.config !== 'object'
        || Array.isArray(opts.config)) {
      throw err('INVESTIGATION_INVALID_CONFIG',
        'options.config must be a config-like object');
    }
    config = opts.config;
  }
  const root = resolveProjectRoot(projectRoot);
  const base = inspectProject(root);

  const stacksByName = new Map();
  for (const s of base.stacks) {
    stacksByName.set(s.name, {
      name: s.name, manifests: [...s.manifests], detectedBy: 'manifest',
    });
  }
  const evidence = cloneJson(base.evidence);
  const warnings = cloneJson(base.warnings);
  const semanticEvidence = [];
  const topologySignals = [];
  const memberRoots = new Set();
  const platformEvidence = new Map(); // name -> Set(paths)
  const frameworkEvidence = new Map(); // name -> Set(paths)
  const hostSignals = []; // {host, path}
  const i18nHints = []; // {kind, detail, path?}
  const docFiles = new Set();
  const ciFiles = new Set();
  const manifestNames = []; // candidate names, in manifest-priority order
  let hasWorkspaceField = null; // {path}
  let hasCargoWorkspace = null;
  let srcMainRs = false;

  const addPlatform = (name, ev) => {
    if (!platformEvidence.has(name)) platformEvidence.set(name, new Set());
    platformEvidence.get(name).add(ev);
  };
  const addFramework = (name, ev) => {
    if (!frameworkEvidence.has(name)) frameworkEvidence.set(name, new Set());
    frameworkEvidence.get(name).add(ev);
  };
  const addSemanticStack = (name, rel) => {
    if (!stacksByName.has(name)) {
      stacksByName.set(name, { name, manifests: [], detectedBy: 'semantic' });
    }
    const s = stacksByName.get(name);
    if (!s.manifests.includes(rel)) s.manifests.push(rel);
  };

  const layout = { sourceDirs: [], testDirs: [], docDirs: [] };

  // --- existence probes ---------------------------------------------------
  for (const p of DIR_PROBES) {
    const st = probePath(root, p.rel);
    if (!isRealDir(st)) continue;
    if (p.kind === 'sourceDir') layout.sourceDirs.push(p.rel);
    else if (p.kind === 'testDir') layout.testDirs.push(p.rel);
    else if (p.kind === 'docDir') layout.docDirs.push(p.rel);
    else if (p.kind === 'platform') addPlatform(p.platform, p.rel);
    else if (p.kind === 'i18n') {
      i18nHints.push({ kind: 'dir', detail: p.rel, path: p.rel });
    } else if (p.kind === 'host') {
      hostSignals.push({ host: p.host, path: p.rel });
      pushEvidence(semanticEvidence, 'host', p.rel);
      continue;
    }
    pushEvidence(semanticEvidence, 'dir', p.rel);
  }

  const readQueue = []; // {rel, parser}
  for (const p of FILE_PROBES) {
    const st = probePath(root, p.rel);
    if (!isRealFile(st)) continue;
    if (p.stack) {
      addSemanticStack(p.stack, p.rel);
      pushEvidence(semanticEvidence, 'manifest', p.rel, { read: true });
    }
    if (p.topology) topologySignals.push({ type: p.topology, path: p.rel });
    if (p.framework) addFramework(p.framework, p.rel);
    if (p.platform) addPlatform(p.platform, p.rel);
    if (p.i18n) i18nHints.push({ kind: 'config', detail: p.rel, path: p.rel });
    if (p.ci) ciFiles.add(p.rel);
    if (p.doc) docFiles.add(p.rel);
    if (p.host) {
      hostSignals.push({ host: p.host, path: p.rel });
      pushEvidence(semanticEvidence, 'host', p.rel);
    }
    if (p.cliHint === 'rust') srcMainRs = true;
    if (p.read) readQueue.push({ rel: p.rel, parser: p.read });
    if (!p.stack && !p.host) {
      // config/ci/doc probes contribute generic config evidence once
      const type = p.ci ? 'ci' : (p.doc ? 'instructions' : 'config');
      pushEvidence(semanticEvidence, type, p.rel);
    }
  }

  // --- bounded re-reads of allowlisted manifests --------------------------
  // inspect-discovered manifests worth parsing.
  const inspectManifests = base.evidence.filter(
    (e) => e.type === 'manifest' && e.read === true);
  for (const e of inspectManifests) {
    const name = baseName(e.path);
    if (name === 'package.json') {
      const text = rereadManifest(root, e.path, warnings);
      if (text === null) continue;
      const parsed = parsePackageJson(text);
      if (!parsed) continue;
      if (parsed.name && parentDir(e.path) === '.') {
        manifestNames.push({ name: parsed.name, path: e.path, prio: 0 });
      }
      if (parsed.workspaces.length > 0) {
        hasWorkspaceField = { path: e.path };
      }
      if (parsed.hasBin) {
        addPlatform('cli', e.path);
      }
      for (const dep of parsed.deps) {
        if (NODE_DEP_FRAMEWORKS.has(dep)) {
          addFramework(NODE_DEP_FRAMEWORKS.get(dep), e.path);
        }
        if (NODE_DEP_PLATFORMS.has(dep)) {
          addPlatform(NODE_DEP_PLATFORMS.get(dep), e.path);
        }
        if (NODE_DEP_I18N.has(dep)) {
          i18nHints.push({ kind: 'dependency', detail: dep, path: e.path });
        }
      }
    } else if (name === 'Cargo.toml') {
      const text = rereadManifest(root, e.path, warnings);
      if (text === null) continue;
      const parsed = parseCargoToml(text);
      if (parsed.name && parentDir(e.path) === '.') {
        manifestNames.push({ name: parsed.name, path: e.path, prio: 1 });
      }
      if (parsed.isWorkspace) hasCargoWorkspace = { path: e.path };
      if (parsed.hasBin) {
        addPlatform('cli', e.path);
      }
      addFramework('cargo-test', e.path);
    } else if (name === 'pyproject.toml') {
      const text = rereadManifest(root, e.path, warnings);
      if (text === null) continue;
      const parsed = parsePyproject(text);
      if (parsed.name && parentDir(e.path) === '.') {
        manifestNames.push({ name: parsed.name, path: e.path, prio: 2 });
      }
      if (parsed.hasPytest) addFramework('pytest', e.path);
    } else if (name.endsWith('.csproj')) {
      const text = rereadManifest(root, e.path, warnings);
      if (text === null) continue;
      for (const f of parseCsproj(text).frameworks) addFramework(f, e.path);
    }
  }
  // Semantic manifests that need content (pubspec.yaml).
  for (const { rel, parser } of readQueue) {
    if (parser !== 'pubspec') continue;
    const text = rereadManifest(root, rel, warnings);
    if (text === null) continue;
    const parsed = parsePubspec(text);
    if (parsed.name && parentDir(rel) === '.') {
      manifestNames.push({ name: parsed.name, path: rel, prio: 3 });
    }
    if (parsed.isFlutter) addSemanticStack('flutter', rel);
    if (parsed.hasFlutterTest) addFramework('flutter_test', rel);
    if (parsed.hasTest) addFramework('test', rel);
  }

  // --- member roots and topology ------------------------------------------
  const allManifestPaths = [
    ...base.evidence.filter((e) => e.type === 'manifest').map((e) => e.path),
    ...semanticEvidence.filter((e) => e.type === 'manifest').map((e) => e.path),
  ];
  const manifestDirs = new Set(allManifestPaths.map(parentDir));
  for (const d of manifestDirs) {
    if (d !== '.') memberRoots.add(d);
  }
  if (hasWorkspaceField) {
    topologySignals.push(
      { type: 'workspaces-field', path: hasWorkspaceField.path });
  }
  if (hasCargoWorkspace) {
    topologySignals.push(
      { type: 'cargo-workspace', path: hasCargoWorkspace.path });
  }

  let kind;
  if (manifestDirs.size === 0) {
    kind = (layout.sourceDirs.length > 0 || layout.testDirs.length > 0)
      ? 'unstructured' : 'empty';
  } else if (manifestDirs.size === 1 && topologySignals.length === 0) {
    kind = 'single-package';
  } else {
    kind = 'monorepo';
  }

  if (srcMainRs && stacksByName.has('rust')) addPlatform('cli', 'src/main.rs');

  // --- CI: one bounded listing of .github/workflows -----------------------
  const ciProviders = [];
  const wfSt = probePath(root, WORKFLOWS_DIR);
  if (isRealDir(wfSt)) {
    let names = [];
    try {
      const listing = readDirBounded(
        resolveInside(root, WORKFLOWS_DIR, 'workflows dir'),
        MAX_WORKFLOW_ENTRIES);
      names = listing.entries
        .filter((d) => d.isFile() && !d.isSymbolicLink()
          && /\.(ya?ml)$/i.test(d.name))
        .map((d) => d.name)
        .sort((a, b) => a.localeCompare(b));
      if (listing.truncated) {
        warnings.push({
          code: 'SCAN_TRUNCATED',
          message: `workflow listing exceeded ${MAX_WORKFLOW_ENTRIES} entries`,
          path: WORKFLOWS_DIR,
        });
      }
    } catch (e) {
      warnings.push({
        code: 'DIR_UNREADABLE',
        message: `cannot list directory: ${e.code || e.message}`,
        path: WORKFLOWS_DIR,
      });
      names = null;
    }
    if (names !== null) {
      ciProviders.push({
        name: 'github-actions', path: WORKFLOWS_DIR, workflows: names,
      });
      for (const n of names) {
        pushEvidence(
          semanticEvidence, 'workflow', `${WORKFLOWS_DIR}/${n}`);
      }
    }
  }
  const CI_PROVIDER_OF = {
    'gitlab-ci': 'gitlab-ci', 'azure-pipelines': 'azure-pipelines',
    jenkins: 'jenkins', travis: 'travis',
    'bitbucket-pipelines': 'bitbucket-pipelines', circleci: 'circleci',
    woodpecker: 'woodpecker',
  };
  for (const rel of [...ciFiles].sort()) {
    const probe = FILE_PROBES.find((p) => p.rel === rel);
    if (probe && CI_PROVIDER_OF[probe.ci]) {
      ciProviders.push({ name: CI_PROVIDER_OF[probe.ci], path: rel });
    }
  }
  ciProviders.sort((a, b) => a.name.localeCompare(b.name));

  // --- docs, host signals from instructions evidence ----------------------
  for (const e of base.evidence) {
    if (e.type !== 'instructions') continue;
    docFiles.add(e.path);
    const bn = baseName(e.path);
    if (bn === 'CLAUDE.md') hostSignals.push({ host: 'claude', path: e.path });
    if (bn === 'AGENTS.md') hostSignals.push({ host: 'codex', path: e.path });
  }

  // --- dedupe, sort, assemble ---------------------------------------------
  const uniqHosts = new Map();
  for (const h of hostSignals) {
    const key = `${h.host}${h.path}`;
    if (!uniqHosts.has(key)) uniqHosts.set(key, h);
  }
  const sortedHostSignals = [...uniqHosts.values()].sort(
    (a, b) => KNOWN_HOSTS.indexOf(a.host) - KNOWN_HOSTS.indexOf(b.host)
      || a.path.localeCompare(b.path));

  for (const s of stacksByName.values()) s.manifests.sort();
  const stacks = [...stacksByName.values()]
    .sort((a, b) => a.name.localeCompare(b.name));

  const frameworks = [...frameworkEvidence.entries()]
    .map(([name, ev]) => ({ name, evidence: [...ev].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const platforms = [...platformEvidence.entries()]
    .map(([name, ev]) => ({ name, evidence: [...ev].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));
  topologySignals.sort(
    (a, b) => a.type.localeCompare(b.type) || a.path.localeCompare(b.path));

  const allEvidence = [...evidence, ...semanticEvidence];
  // Dedupe identical {type,path} entries (e.g. a doc probe re-reporting an
  // instructions file already found by inspect).
  const seenEv = new Set();
  const mergedEvidence = [];
  for (const e of allEvidence) {
    const key = `${e.type}${e.path}`;
    if (seenEv.has(key)) continue;
    seenEv.add(key);
    mergedEvidence.push(e);
  }
  mergedEvidence.sort(
    (a, b) => a.path.localeCompare(b.path) || a.type.localeCompare(b.type));

  layout.sourceDirs.sort();
  layout.testDirs.sort();
  layout.docDirs.sort();
  const unknowns = [];
  if (stacks.length === 0) {
    unknowns.push({
      code: 'INVESTIGATION_UNKNOWN_STACK',
      message: 'no recognized manifest found; stack is undetermined',
    });
  }
  if (frameworks.length === 0) {
    unknowns.push({
      code: 'INVESTIGATION_NO_TEST_FRAMEWORK',
      message: 'no test framework signals found in manifests or configs',
    });
  }
  if (ciProviders.length === 0) {
    unknowns.push({
      code: 'INVESTIGATION_NO_CI',
      message: 'no CI configuration files detected',
    });
  }
  if (sortedHostSignals.length === 0) {
    unknowns.push({
      code: 'INVESTIGATION_NO_HOST_SIGNALS',
      message: 'no host-specific directories or files detected',
    });
  }

  const inv = {
    schemaVersion: 1,
    projectName: path.basename(root),
    fingerprint: base.fingerprint,
    stacks,
    topology: {
      kind,
      signals: topologySignals,
      memberRoots: [...memberRoots].sort(),
      platforms,
    },
    layout,
    test: { frameworks },
    docs: {
      files: [...docFiles].sort(),
      directories: [...layout.docDirs],
    },
    ci: {
      providers: ciProviders,
      files: [...ciFiles].sort(),
    },
    hosts: { signals: sortedHostSignals },
    i18n: {
      hints: i18nHints.sort(
        (a, b) => a.kind.localeCompare(b.kind)
          || a.detail.localeCompare(b.detail)),
    },
    commands: cloneJson(base.commands),
    evidence: mergedEvidence,
    unknowns,
    warnings,
    // Root-manifest name candidates in priority order; used by
    // suggestAnswers, kept in the result so the record is reproducible.
    names: manifestNames.sort((a, b) => a.prio - b.prio),
  };

  // Optional configured-artifact probing; config is never mutated.
  if (config) {
    const artifactDirs = {};
    const paths = (config.paths && typeof config.paths === 'object'
      && !Array.isArray(config.paths)) ? config.paths : {};
    for (const key of PATH_KEYS) {
      const raw = paths[key];
      if (typeof raw !== 'string' || raw.trim() === '') continue;
      const entry = { path: raw };
      try {
        const st = lstatOrNull(
          resolveInside(root, raw, `paths.${key}`));
        entry.exists = isRealDir(st) || isRealFile(st);
        entry.valid = true;
      } catch {
        entry.exists = false;
        entry.valid = false;
      }
      artifactDirs[key] = entry;
    }
    inv.harness = { configured: true, artifactDirs };
  } else {
    inv.harness = { configured: false };
  }
  return inv;
}

// --- Suggestions ----------------------------------------------------------
function proposal(value, confidence, evidence) {
  return { value, confidence, evidence: [...evidence].sort() };
}

export function suggestAnswers(investigation) {
  const inv = assertInvestigation(investigation);
  const names = Array.isArray(inv.names) ? inv.names : [];
  const primary = names.length > 0 ? names[0] : null;
  const name = primary
    ? proposal(primary.name, 'detected', [primary.path])
    : proposal(inv.projectName, 'default', []);

  const detectedHosts = sortUnique(inv.hosts.signals.map((s) => s.host));
  const hostEvidence = inv.hosts.signals.map((s) => s.path);
  const hosts = detectedHosts.length > 0
    ? proposal(detectedHosts, 'detected', hostEvidence)
    : proposal([], 'default', []);

  const defaults = defaultPathProposals();
  const paths = {};
  for (const key of PATH_KEYS) {
    paths[key] = proposal(defaults[key], 'default', []);
  }

  const commands = cloneJson(inv.commands).map((c) => ({
    ...c, approved: false,
  }));
  const cmdEvidence = sortUnique(commands.map((c) => c.source));
  const verification = commands.length > 0
    ? proposal({ mode: 'manual', commands }, 'detected', cmdEvidence)
    : proposal({ mode: 'manual', commands: [] }, 'default', []);

  const versioning = proposal(allFalseVersioning(), 'default', []);

  const unanswered = [];
  if (hosts.value.length === 0) unanswered.push('hosts');

  return { name, hosts, paths, verification, versioning, unanswered };
}

// --- Stale-decision diff ----------------------------------------------------
function evidencePaths(evidence, type) {
  return (Array.isArray(evidence) ? evidence : [])
    .filter((e) => e && e.type === type && typeof e.path === 'string')
    .map((e) => e.path);
}

function setDiff(oldSet, newSet) {
  const added = [...newSet].filter((x) => !oldSet.has(x)).sort();
  const removed = [...oldSet].filter((x) => !newSet.has(x)).sort();
  const retained = [...oldSet].filter((x) => newSet.has(x)).sort();
  return { added, removed, retained };
}

function commandSignature(c) {
  const cmd = typeof c?.command === 'string' ? c.command : '(null)';
  const cwd = typeof c?.cwd === 'string' ? c.cwd : '.';
  return `${cmd} @ ${cwd}`;
}

// Pure, read-only comparison of a persisted config against fresh evidence.
// config is deep-cloned before canonical validation so a frozen caller
// object is never mutated.
export function diffInvestigation(config, investigation) {
  const inv = assertInvestigation(investigation);
  if (config === null || typeof config !== 'object'
      || Array.isArray(config)) {
    throw err('INVESTIGATION_INVALID_INPUT',
      'config must be a persisted config object');
  }
  let validated;
  try {
    validated = validateConfigObject(cloneJson(config));
  } catch (e) {
    throw err('INVESTIGATION_INVALID_INPUT',
      `config failed canonical validation: ${e.message}`);
  }

  const oldEvidence = validated.discovery.evidence;
  const oldManifests = new Set(evidencePaths(oldEvidence, 'manifest'));
  const oldLockfiles = new Set(evidencePaths(oldEvidence, 'lockfile'));
  const newManifests = new Set(evidencePaths(inv.evidence, 'manifest'));
  const newLockfiles = new Set(evidencePaths(inv.evidence, 'lockfile'));

  const manifests = setDiff(oldManifests, newManifests);
  const lockfiles = setDiff(oldLockfiles, newLockfiles);
  const expected = validated.discovery.fingerprint;
  const actual = inv.fingerprint;
  const match = expected === actual;
  const contentIndeterminate = !match
    && manifests.added.length === 0 && manifests.removed.length === 0
    && lockfiles.added.length === 0 && lockfiles.removed.length === 0;

  const oldStacks = new Set(
    (validated.discovery.stacks || [])
      .map((s) => (typeof s === 'string' ? s : s?.name))
      .filter((n) => typeof n === 'string'));
  const newStacks = new Set(inv.stacks.map((s) => s.name));
  const stacks = setDiff(oldStacks, newStacks);

  const oldCmds = new Set(
    (validated.verification.commands || []).map(commandSignature));
  const newCmds = new Set(inv.commands.map(commandSignature));
  const commands = setDiff(oldCmds, newCmds);

  const suggestedHosts = new Set(inv.hosts.signals.map((s) => s.host));
  const newSignals = [...suggestedHosts]
    .filter((h) => !validated.hosts.includes(h))
    .sort((a, b) => KNOWN_HOSTS.indexOf(a) - KNOWN_HOSTS.indexOf(b));

  const staleDecisions = [];
  if (!match) staleDecisions.push('discovery.fingerprint');
  if (manifests.added.length || manifests.removed.length
      || lockfiles.added.length || lockfiles.removed.length) {
    staleDecisions.push('discovery.evidence');
  }
  if (stacks.added.length || stacks.removed.length) {
    staleDecisions.push('discovery.stacks');
  }
  if (commands.added.length || commands.removed.length) {
    staleDecisions.push('verification.commands');
  }
  if (newSignals.length > 0) staleDecisions.push('hosts');

  const notes = [];
  if (contentIndeterminate) {
    notes.push('manifest set unchanged but fingerprint differs; '
      + 'stored evidence cannot identify which manifest content changed');
  }

  return {
    stale: staleDecisions.length > 0,
    fingerprint: { expected, actual, match },
    manifests: {
      added: manifests.added,
      removed: manifests.removed,
      retained: manifests.retained,
      lockfiles: { added: lockfiles.added, removed: lockfiles.removed },
      contentIndeterminate,
    },
    stacks: { added: stacks.added, removed: stacks.removed },
    commands: { added: commands.added, removed: commands.removed },
    hosts: { newSignals },
    staleDecisions,
    notes,
  };
}

// --- Research record ------------------------------------------------------
export function buildResearchRecord(investigation, options) {
  const inv = assertInvestigation(investigation);
  const opts = assertOptions(
    options, RECORD_OPTION_KEYS, 'INVESTIGATION_INVALID_OPTIONS');
  const record = {
    schemaVersion: 1,
    fingerprint: inv.fingerprint,
    stacks: cloneJson(inv.stacks),
    topology: cloneJson(inv.topology),
    evidence: cloneJson(inv.evidence),
    suggestions: suggestAnswers(inv),
    unknowns: cloneJson(inv.unknowns),
  };
  if (opts.timestamp !== undefined) {
    if (typeof opts.timestamp !== 'string' || opts.timestamp.trim() === '') {
      throw err('INVESTIGATION_INVALID_OPTIONS',
        'options.timestamp must be a non-empty string');
    }
    record.timestamp = opts.timestamp;
  }
  return {
    record,
    suggestedPath: `semantic-${inv.fingerprint.slice(0, 16)}.json`,
  };
}

function invalidRecord(msg) {
  return err('RESEARCH_INVALID_RECORD', msg);
}

function validateLeafProposal(p, label) {
  if (p === null || typeof p !== 'object' || Array.isArray(p)) {
    throw invalidRecord(`${label} must be a proposal object`);
  }
  for (const key of Object.keys(p)) {
    if (!['value', 'confidence', 'evidence'].includes(key)) {
      throw invalidRecord(`${label} contains unknown key '${key}'`);
    }
  }
  if (!('value' in p)) {
    throw invalidRecord(`${label} is missing 'value'`);
  }
  if (!CONFIDENCE.has(p.confidence)) {
    throw invalidRecord(`${label}.confidence must be detected|default`);
  }
  if (!Array.isArray(p.evidence)
      || !p.evidence.every((x) => typeof x === 'string')) {
    throw invalidRecord(`${label}.evidence must be an array of strings`);
  }
}

// Pure validator for the stored research-document shape. Returns the
// record unchanged or throws RESEARCH_INVALID_RECORD.
export function validateResearchRecord(record) {
  if (record === null || typeof record !== 'object'
      || Array.isArray(record)) {
    throw invalidRecord('record must be an object');
  }
  for (const key of Object.keys(record)) {
    if (!RECORD_KEYS.has(key)) {
      throw invalidRecord(`record contains unknown key '${key}'`);
    }
  }
  for (const key of RECORD_KEYS) {
    if (key === 'timestamp') continue;
    if (!(key in record)) {
      throw invalidRecord(`record is missing required key '${key}'`);
    }
  }
  if (record.schemaVersion !== 1) {
    throw invalidRecord('record.schemaVersion must be 1');
  }
  if (typeof record.fingerprint !== 'string'
      || !/^[0-9a-f]{64}$/.test(record.fingerprint)) {
    throw invalidRecord('record.fingerprint must be a sha256 hex string');
  }
  if ('timestamp' in record
      && (typeof record.timestamp !== 'string'
        || record.timestamp.trim() === '')) {
    throw invalidRecord('record.timestamp must be a non-empty string');
  }
  if (!Array.isArray(record.stacks)) {
    throw invalidRecord('record.stacks must be an array');
  }
  for (const s of record.stacks) {
    if (s === null || typeof s !== 'object' || typeof s.name !== 'string'
        || s.name === '' || !Array.isArray(s.manifests)
        || !s.manifests.every((m) => typeof m === 'string')
        || !['manifest', 'semantic'].includes(s.detectedBy)) {
      throw invalidRecord('record.stacks entries are malformed');
    }
  }
  const t = record.topology;
  if (t === null || typeof t !== 'object' || Array.isArray(t)
      || !TOPOLOGY_KINDS.includes(t.kind)
      || !Array.isArray(t.signals) || !Array.isArray(t.memberRoots)
      || !Array.isArray(t.platforms)) {
    throw invalidRecord('record.topology is malformed');
  }
  for (const p of t.platforms) {
    if (p === null || typeof p !== 'object' || typeof p.name !== 'string'
        || !Array.isArray(p.evidence)) {
      throw invalidRecord('record.topology.platforms entries are malformed');
    }
  }
  if (!Array.isArray(record.evidence)) {
    throw invalidRecord('record.evidence must be an array');
  }
  for (const e of record.evidence) {
    if (e === null || typeof e !== 'object' || typeof e.path !== 'string'
        || e.path === '' || !EVIDENCE_TYPES.has(e.type)) {
      throw invalidRecord('record.evidence entries are malformed');
    }
  }
  const s = record.suggestions;
  if (s === null || typeof s !== 'object' || Array.isArray(s)) {
    throw invalidRecord('record.suggestions must be an object');
  }
  for (const key of Object.keys(s)) {
    if (!SUGGESTION_KEYS.has(key)) {
      throw invalidRecord(`record.suggestions contains unknown key '${key}'`);
    }
  }
  validateLeafProposal(s.name, 'suggestions.name');
  validateLeafProposal(s.hosts, 'suggestions.hosts');
  validateLeafProposal(s.verification, 'suggestions.verification');
  validateLeafProposal(s.versioning, 'suggestions.versioning');
  if (s.paths === null || typeof s.paths !== 'object'
      || Array.isArray(s.paths)) {
    throw invalidRecord('suggestions.paths must be an object');
  }
  for (const key of Object.keys(s.paths)) {
    if (!PATH_KEYS.includes(key)) {
      throw invalidRecord(`suggestions.paths contains unknown key '${key}'`);
    }
  }
  for (const key of PATH_KEYS) {
    validateLeafProposal(s.paths[key], `suggestions.paths.${key}`);
  }
  if (!Array.isArray(s.unanswered)
      || !s.unanswered.every((x) => typeof x === 'string')) {
    throw invalidRecord('suggestions.unanswered must be an array of strings');
  }
  if (!Array.isArray(record.unknowns)) {
    throw invalidRecord('record.unknowns must be an array');
  }
  for (const u of record.unknowns) {
    if (u === null || typeof u !== 'object' || typeof u.code !== 'string'
        || typeof u.message !== 'string') {
      throw invalidRecord('record.unknowns entries are malformed');
    }
  }
  return record;
}
