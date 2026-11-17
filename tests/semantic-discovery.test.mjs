// Semantic investigation layer: bounded read-only probes on top of
// inspectProject, init-answer suggestions, stale-decision diff and the
// typed research record contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildResearchRecord,
  diffInvestigation,
  investigateProject,
  suggestAnswers,
  validateResearchRecord,
} from '../src/discovery/semantic.mjs';
import { inspectProject } from '../src/discovery/inspect.mjs';
import { createConfig } from '../src/core/config.mjs';
import {
  ALL_VERSIONING_FALSE,
  cleanup, makeTempDir, writeFile, writeJson,
} from './helpers.mjs';

const LEAVES = ['name', 'hosts', 'verification', 'versioning'];
const PATH_KEYS = ['plans', 'tasks', 'reports', 'research', 'decisions',
  'memory', 'state'];

function baseConfig(dir, overrides = {}) {
  const discovery = inspectProject(dir);
  return createConfig(dir, {
    name: 'fixture', locale: 'es', hosts: ['claude'],
    paths: {
      plans: '.scopegrain/plans', tasks: '.scopegrain/tasks',
      reports: '.scopegrain/reports', research: '.scopegrain/research',
      decisions: '.scopegrain/decisions', memory: '.scopegrain/memory',
      state: '.scopegrain/state',
    },
    versioning: ALL_VERSIONING_FALSE,
    ...overrides,
  }, discovery);
}

function assertProposalShape(p) {
  assert.ok(p && typeof p === 'object' && !Array.isArray(p));
  assert.ok('value' in p);
  assert.ok(p.confidence === 'detected' || p.confidence === 'default');
  assert.ok(Array.isArray(p.evidence));
}

test('bare directory: empty topology, explicit unknowns, no invented data', () => {
  const dir = makeTempDir('bare-dir');
  try {
    const inv = investigateProject(dir);
    assert.equal(inv.schemaVersion, 1);
    assert.equal(inv.topology.kind, 'empty');
    assert.deepEqual(inv.stacks, []);
    assert.deepEqual(inv.commands, []);
    const codes = inv.unknowns.map((u) => u.code);
    assert.ok(codes.includes('INVESTIGATION_UNKNOWN_STACK'));
    assert.ok(codes.includes('INVESTIGATION_NO_TEST_FRAMEWORK'));
    assert.ok(codes.includes('INVESTIGATION_NO_CI'));
    const s = suggestAnswers(inv);
    for (const k of LEAVES) assertProposalShape(s[k]);
    for (const k of PATH_KEYS) assertProposalShape(s.paths[k]);
    assert.equal(s.name.value, path.basename(dir));
    assert.deepEqual(s.hosts.value, []);
    assert.ok(s.unanswered.includes('hosts'));
    assert.equal(s.verification.value.mode, 'manual');
    assert.deepEqual(s.verification.value.commands, []);
    assert.ok(Object.values(s.versioning.value).every((v) => v === false));
  } finally { cleanup(dir); }
});

test('unstructured project with layout but no manifest stays honest', () => {
  const dir = makeTempDir('unstruct');
  try {
    writeFile(dir, 'src/index.js', 'x\n');
    writeFile(dir, 'tests/x.test.js', 'x\n');
    writeFile(dir, 'docs/guide.md', 'x\n');
    const inv = investigateProject(dir);
    assert.equal(inv.topology.kind, 'unstructured');
    assert.deepEqual(inv.layout.sourceDirs, ['src']);
    assert.deepEqual(inv.layout.testDirs, ['tests']);
    assert.deepEqual(inv.layout.docDirs, ['docs']);
    assert.ok(inv.unknowns.some((u) => u.code === 'INVESTIGATION_UNKNOWN_STACK'));
  } finally { cleanup(dir); }
});

test('node package: name, vitest hints and real commands only', () => {
  const dir = makeTempDir('node-proj');
  try {
    writeJson(dir, 'package.json', {
      name: 'mi-paquete', packageManager: 'pnpm@9.0.0',
      scripts: { test: 'vitest run', lint: 'eslint .', dev: 'x' },
      devDependencies: { vitest: '^3.0.0' },
    });
    writeFile(dir, 'pnpm-lock.yaml', '');
    writeFile(dir, 'vitest.config.ts', 'export default {}\n');
    const inv = investigateProject(dir);
    assert.deepEqual(inv.stacks.map((s) => s.name), ['node']);
    const fw = inv.test.frameworks.map((f) => f.name);
    assert.ok(fw.includes('vitest'));
    const vf = inv.test.frameworks.find((f) => f.name === 'vitest');
    assert.ok(vf.evidence.includes('vitest.config.ts'));
    assert.ok(vf.evidence.includes('package.json'));
    const s = suggestAnswers(inv);
    assert.equal(s.name.value, 'mi-paquete');
    assert.equal(s.name.confidence, 'detected');
    assert.ok(s.name.evidence.includes('package.json'));
    assert.deepEqual(
      s.verification.value.commands.map((c) => c.command).sort(),
      ['pnpm run lint', 'pnpm run test']);
    assert.ok(s.verification.value.commands.every(
      (c) => c.approved === false && c.source === 'package.json'));
  } finally { cleanup(dir); }
});

test('rust cargo: cargo test hint, package name, no script proposals', () => {
  const dir = makeTempDir('rust-proj');
  try {
    writeFile(dir, 'Cargo.toml', '[package]\nname = "mi-crate"\n');
    writeFile(dir, 'src/main.rs', 'fn main() {}\n');
    const inv = investigateProject(dir);
    assert.deepEqual(inv.stacks.map((s) => s.name), ['rust']);
    assert.ok(inv.test.frameworks.some((f) => f.name === 'cargo-test'));
    assert.deepEqual(inv.commands, []);
    const s = suggestAnswers(inv);
    assert.equal(s.name.value, 'mi-crate');
    assert.equal(s.name.confidence, 'detected');
    assert.deepEqual(s.verification.value.commands, []);
    assert.ok(inv.topology.platforms.some((p) => p.name === 'cli'));
  } finally { cleanup(dir); }
});

test('python project: pytest hints from ini, conftest and pyproject', () => {
  const dir = makeTempDir('py-proj');
  try {
    writeFile(dir, 'pyproject.toml',
      '[project]\nname = "mi-py"\n[tool.pytest.ini_options]\ntestpaths=["tests"]\n');
    writeFile(dir, 'conftest.py', '');
    writeFile(dir, 'tests/test_x.py', 'x\n');
    const inv = investigateProject(dir);
    assert.deepEqual(inv.stacks.map((s) => s.name), ['python']);
    const f = inv.test.frameworks.find((f2) => f2.name === 'pytest');
    assert.ok(f);
    assert.ok(f.evidence.includes('conftest.py'));
    assert.ok(f.evidence.includes('pyproject.toml'));
    const s = suggestAnswers(inv);
    assert.equal(s.name.value, 'mi-py');
  } finally { cleanup(dir); }
});

test('flutter pubspec adds semantic stack and flutter_test hint', () => {
  const dir = makeTempDir('flutter-proj');
  try {
    writeFile(dir, 'pubspec.yaml',
      'name: mi_app\ndependencies:\n  flutter:\n    sdk: flutter\n'
        + 'dev_dependencies:\n  flutter_test:\n    sdk: flutter\n');
    writeFile(dir, 'lib/main.dart', 'void main() {}\n');
    const inv = investigateProject(dir);
    const names = inv.stacks.map((s) => s.name);
    assert.ok(names.includes('dart'));
    assert.ok(names.includes('flutter'));
    assert.ok(inv.stacks.find((s) => s.name === 'flutter')
      .detectedBy === 'semantic');
    assert.ok(inv.test.frameworks.some((f) => f.name === 'flutter_test'));
    const s = suggestAnswers(inv);
    assert.equal(s.name.value, 'mi_app');
  } finally { cleanup(dir); }
});

test('monorepo: workspaces field plus member manifests gives monorepo', () => {
  const dir = makeTempDir('mono');
  try {
    writeJson(dir, 'package.json', {
      name: 'root', workspaces: ['packages/*'],
    });
    writeJson(dir, 'packages/web/package.json', { name: 'web' });
    writeJson(dir, 'packages/api/package.json', { name: 'api' });
    writeFile(dir, 'turbo.json', '{}\n');
    const inv = investigateProject(dir);
    assert.equal(inv.topology.kind, 'monorepo');
    const types = inv.topology.signals.map((s) => s.type);
    assert.ok(types.includes('workspaces-field'));
    assert.ok(types.includes('turbo'));
    assert.ok(inv.topology.memberRoots.includes('packages/web'));
    assert.ok(inv.topology.memberRoots.includes('packages/api'));
  } finally { cleanup(dir); }
});

test('cargo workspace and nested crate manifests give monorepo', () => {
  const dir = makeTempDir('cargo-mono');
  try {
    writeFile(dir, 'Cargo.toml',
      '[workspace]\nmembers = ["crates/*"]\n');
    writeFile(dir, 'crates/core/Cargo.toml', '[package]\nname = "core"\n');
    writeFile(dir, 'crates/util/Cargo.toml', '[package]\nname = "util"\n');
    const inv = investigateProject(dir);
    assert.equal(inv.topology.kind, 'monorepo');
    assert.ok(inv.topology.signals.some((s) => s.type === 'cargo-workspace'));
    assert.ok(inv.topology.memberRoots.includes('crates/core'));
    assert.ok(inv.topology.memberRoots.includes('crates/util'));
  } finally { cleanup(dir); }
});

test('tauri and electron signals report desktop platform', () => {
  const dir = makeTempDir('desktop-proj');
  try {
    writeJson(dir, 'package.json', {
      name: 'desk', devDependencies: { electron: '^30.0.0' },
    });
    writeFile(dir, 'src-tauri/tauri.conf.json', '{}\n');
    writeFile(dir, 'android/build.gradle', 'x\n');
    const inv = investigateProject(dir);
    const plats = inv.topology.platforms.map((p) => p.name);
    assert.ok(plats.includes('desktop'));
    assert.ok(plats.includes('mobile'));
    const desktop = inv.topology.platforms.find((p) => p.name === 'desktop');
    assert.ok(desktop.evidence.includes('src-tauri/tauri.conf.json'));
    assert.ok(desktop.evidence.includes('package.json'));
  } finally { cleanup(dir); }
});

test('github workflows are listed by name only; other CI by existence', () => {
  const dir = makeTempDir('ci-proj');
  try {
    writeJson(dir, 'package.json', { name: 'x' });
    writeFile(dir, '.github/workflows/ci.yml', 'on: push\n');
    writeFile(dir, '.github/workflows/release.yaml', 'on: push\n');
    writeFile(dir, '.github/workflows/not-ci.txt', 'nope\n');
    writeFile(dir, '.gitlab-ci.yml', 'stages: []\n');
    const inv = investigateProject(dir);
    const gh = inv.ci.providers.find((p) => p.name === 'github-actions');
    assert.ok(gh);
    assert.deepEqual(gh.workflows, ['ci.yml', 'release.yaml']);
    assert.ok(inv.ci.files.includes('.gitlab-ci.yml'));
    // workflow names only: the .txt file is excluded
    assert.ok(!inv.evidence.some((e) => e.path.includes('not-ci')));
  } finally { cleanup(dir); }
});

test('host signals propose hosts from existence only', () => {
  const dir = makeTempDir('host-proj');
  try {
    writeJson(dir, 'package.json', { name: 'x' });
    writeFile(dir, '.claude/settings.json', '{}\n');
    writeFile(dir, '.opencode/opencode.json', '{}\n');
    writeFile(dir, 'CLAUDE.md', '# claude\n');
    const inv = investigateProject(dir);
    const hosts = inv.hosts.signals.map((s) => s.host);
    assert.ok(hosts.includes('claude'));
    assert.ok(hosts.includes('opencode'));
    const s = suggestAnswers(inv);
    assert.ok(s.hosts.value.includes('claude'));
    assert.ok(s.hosts.value.includes('opencode'));
    assert.ok(!s.hosts.value.includes('devin'));
    assert.equal(s.hosts.confidence, 'detected');
    // Contents of .claude/ are never listed or read.
    assert.ok(!inv.evidence.some((e) => e.path.includes('settings.json')));
  } finally { cleanup(dir); }
});

test('secrets-adjacent material is never read or listed', () => {
  const dir = makeTempDir('secrets');
  try {
    writeJson(dir, 'package.json', { name: 'x' });
    writeFile(dir, '.env', 'TOKEN=abc\n');
    writeFile(dir, '.env.local', 'TOKEN=abc\n');
    writeFile(dir, 'credentials.json', '{}\n');
    writeFile(dir, 'secrets/key.pem', 'KEY\n');
    writeFile(dir, '.ssh/id_rsa', 'KEY\n');
    writeFile(dir, '.npmrc', '//r/:_authToken=x\n');
    const inv = investigateProject(dir);
    const all = JSON.stringify(inv.evidence) + JSON.stringify(inv.ci)
      + JSON.stringify(inv.i18n);
    for (const bad of ['.env', 'credentials', 'key.pem', 'id_rsa',
      '.npmrc', 'secrets/']) {
      assert.ok(!all.includes(bad), `secret artifact leaked: ${bad}`);
    }
    const s = suggestAnswers(inv);
    assert.ok(!JSON.stringify(s).includes('TOKEN'));
  } finally { cleanup(dir); }
});

test('oversized manifest keeps existence stack but skips content', () => {
  const dir = makeTempDir('big-pub');
  try {
    writeFile(dir, 'pubspec.yaml',
      `name: big_app\n# ${'x'.repeat(140 * 1024)}\n`);
    const inv = investigateProject(dir);
    assert.ok(inv.stacks.some((s) => s.name === 'dart'));
    assert.ok(!inv.stacks.some((s) => s.name === 'flutter'));
    assert.ok(inv.warnings.some((w) => w.code === 'MANIFEST_TOO_LARGE'));
    const s = suggestAnswers(inv);
    // name could not be parsed -> falls back to basename default
    assert.equal(s.name.value, path.basename(dir));
  } finally { cleanup(dir); }
});

test('deep tree and entry budget bounds pass through as warnings', () => {
  const dir = makeTempDir('deep-sem');
  try {
    writeJson(dir, 'a/b/c/d/e/package.json', { name: 'deep' });
    const inv = investigateProject(dir);
    assert.ok(inv.warnings.some((w) => w.code === 'SCAN_PARTIAL_DEPTH'));
    const flat = makeTempDir('many-sem');
    try {
      for (let i = 0; i < 1005; i++) {
        writeFile(flat, `f${String(i).padStart(4, '0')}.txt`, 'x');
      }
      const inv2 = investigateProject(flat);
      assert.ok(inv2.warnings.some((w) => w.code === 'SCAN_TRUNCATED'));
    } finally { cleanup(flat); }
  } finally { cleanup(dir); }
});

test('config option probes artifact dirs without mutating config', () => {
  const dir = makeTempDir('cfg-probe');
  try {
    writeJson(dir, 'package.json', { name: 'x' });
    writeFile(dir, 'docs/agent/research/.keep', '');
    const config = baseConfig(dir, {
      paths: {
        plans: '.scopegrain/plans', tasks: '.scopegrain/tasks',
        reports: '.scopegrain/reports', research: 'docs/agent/research',
        decisions: '.scopegrain/decisions', memory: '.scopegrain/memory',
        state: '.scopegrain/state',
      },
    });
    Object.freeze(config.paths);
    const inv = investigateProject(dir, { config });
    assert.equal(inv.harness.configured, true);
    assert.equal(inv.harness.artifactDirs.research.exists, true);
    assert.equal(inv.harness.artifactDirs.plans.exists, false);
  } finally { cleanup(dir); }
});

test('invalid options are rejected with closed-object errors', () => {
  const dir = makeTempDir('opts');
  try {
    assert.throws(() => investigateProject(dir, { bogus: 1 }),
      (e) => e.code === 'INVESTIGATION_INVALID_OPTIONS');
    assert.throws(() => investigateProject(dir, 'x'),
      (e) => e.code === 'INVESTIGATION_INVALID_OPTIONS');
    assert.throws(() => investigateProject(dir, { config: 'nope' }),
      (e) => e.code === 'INVESTIGATION_INVALID_CONFIG');
  } finally { cleanup(dir); }
});

test('diffInvestigation reports stale decisions vs new evidence', () => {
  const dir = makeTempDir('diff');
  try {
    writeJson(dir, 'package.json', {
      name: 'x', scripts: { test: 't' },
    });
    writeFile(dir, 'package-lock.json', '{}\n');
    const config = baseConfig(dir);
    // Persisted decision: the owner approved this verification command.
    config.verification.commands = [
      { command: 'npm run test', cwd: '.', approved: true },
    ];
    // Same evidence: not stale.
    const fresh = diffInvestigation(config, investigateProject(dir));
    assert.equal(fresh.stale, false);
    assert.equal(fresh.fingerprint.match, true);
    assert.deepEqual(fresh.staleDecisions, []);
    // Add a manifest + drop the lockfile: stale with per-file detail.
    fs.rmSync(path.join(dir, 'package-lock.json'));
    writeFile(dir, 'Cargo.toml', '[package]\nname = "y"\n');
    const d = diffInvestigation(config, investigateProject(dir));
    assert.equal(d.stale, true);
    assert.equal(d.fingerprint.match, false);
    assert.deepEqual(d.manifests.added, ['Cargo.toml']);
    assert.deepEqual(d.manifests.lockfiles.removed, ['package-lock.json']);
    assert.deepEqual(d.stacks.added, ['rust']);
    assert.ok(d.staleDecisions.includes('discovery.fingerprint'));
    assert.ok(d.staleDecisions.includes('discovery.stacks'));
    // The persisted approved command no longer matches the new proposal
    // set (pm became ambiguous -> command:null proposal).
    assert.ok(d.commands.removed.some((c) => c.includes('npm run test')));
  } finally { cleanup(dir); }
});

test('diffInvestigation flags content change when manifest set is equal', () => {
  const dir = makeTempDir('diff2');
  try {
    writeJson(dir, 'package.json', { name: 'x', version: '1.0.0' });
    const config = baseConfig(dir);
    writeJson(dir, 'package.json', { name: 'x', version: '2.0.0' });
    const d = diffInvestigation(config, investigateProject(dir));
    assert.equal(d.stale, true);
    assert.deepEqual(d.manifests.added, []);
    assert.deepEqual(d.manifests.removed, []);
    assert.equal(d.manifests.contentIndeterminate, true);
  } finally { cleanup(dir); }
});

test('diffInvestigation reports new host signals and validates inputs', () => {
  const dir = makeTempDir('diff3');
  try {
    writeJson(dir, 'package.json', { name: 'x' });
    const config = baseConfig(dir); // hosts: ['claude']
    writeFile(dir, '.opencode/opencode.json', '{}\n');
    const d = diffInvestigation(config, investigateProject(dir));
    assert.ok(d.hosts.newSignals.includes('opencode'));
    assert.ok(d.staleDecisions.includes('hosts'));
    const inv = investigateProject(dir);
    assert.throws(() => diffInvestigation(null, inv),
      (e) => e.code === 'INVESTIGATION_INVALID_INPUT');
    assert.throws(() => diffInvestigation(config, { bogus: 1 }),
      (e) => e.code === 'INVESTIGATION_INVALID_INPUT');
    // Frozen config input must not be mutated by internal validation.
    const frozen = Object.freeze(JSON.parse(JSON.stringify(config)));
    deepFreeze(frozen);
    diffInvestigation(frozen, inv); // must not throw
  } finally { cleanup(dir); }
});

function deepFreeze(o) {
  for (const v of Object.values(o)) {
    if (v && typeof v === 'object') deepFreeze(Object.freeze(v));
  }
  return o;
}

test('buildResearchRecord is deterministic, timestamp by caller only', () => {
  const dir = makeTempDir('record');
  try {
    writeJson(dir, 'package.json', { name: 'x', scripts: { test: 't' } });
    writeFile(dir, 'package-lock.json', '{}\n');
    const inv = investigateProject(dir);
    const a = buildResearchRecord(inv);
    const b = buildResearchRecord(inv);
    assert.deepEqual(a, b);
    assert.equal(a.record.schemaVersion, 1);
    assert.equal(a.record.fingerprint, inv.fingerprint);
    assert.ok(!('timestamp' in a.record));
    assert.match(a.suggestedPath, /^semantic-[0-9a-f]{16}\.json$/);
    const withTs = buildResearchRecord(inv, { timestamp: '2026-11-17T00:00:00Z' });
    assert.equal(withTs.record.timestamp, '2026-11-17T00:00:00Z');
    assert.equal(validateResearchRecord(a.record), a.record);
    assert.deepEqual(
      validateResearchRecord(JSON.parse(JSON.stringify(a.record))).schemaVersion,
      1);
  } finally { cleanup(dir); }
});

test('validateResearchRecord enforces the closed stored shape', () => {
  const dir = makeTempDir('record-bad');
  try {
    writeJson(dir, 'package.json', { name: 'x' });
    const { record } = buildResearchRecord(investigateProject(dir));
    const cases = [
      null,
      { ...record, extra: 1 },
      { ...record, schemaVersion: 2 },
      { ...record, fingerprint: 'zz' },
      { ...record, stacks: 'x' },
      { ...record, topology: { kind: 'weird' } },
      { ...record, timestamp: 5 },
    ];
    for (const bad of cases) {
      assert.throws(() => validateResearchRecord(bad),
        (e) => e.code === 'RESEARCH_INVALID_RECORD');
    }
    assert.throws(() => buildResearchRecord({ bogus: 1 }),
      (e) => e.code === 'INVESTIGATION_INVALID_INPUT');
  } finally { cleanup(dir); }
});

test('suggestAnswers never invents commands: only surfaced scripts', () => {
  const dir = makeTempDir('no-invent');
  try {
    writeFile(dir, 'Cargo.toml', '[package]\nname = "x"\n');
    writeFile(dir, 'pubspec.yaml', 'name: y\ndependencies:\n  flutter:\n    sdk: flutter\n');
    const inv = investigateProject(dir);
    const s = suggestAnswers(inv);
    // rust/dart/flutter stacks: no package.json scripts exist, so no
    // command may appear at all.
    assert.deepEqual(s.verification.value.commands, []);
    assert.equal(s.verification.confidence, 'default');
  } finally { cleanup(dir); }
});

test('i18n hints from locales dir and manifest dependency', () => {
  const dir = makeTempDir('i18n-proj');
  try {
    writeJson(dir, 'package.json', {
      name: 'x', dependencies: { i18next: '^23.0.0' },
    });
    writeFile(dir, 'locales/en.json', '{}\n');
    writeFile(dir, 'i18next.config.js', 'x\n');
    const inv = investigateProject(dir);
    const kinds = inv.i18n.hints.map((h) => h.kind);
    assert.ok(kinds.includes('dir'));
    assert.ok(kinds.includes('config'));
    assert.ok(kinds.includes('dependency'));
  } finally { cleanup(dir); }
});

test('investigation is deterministic and does not mutate inputs', () => {
  const dir = makeTempDir('det');
  try {
    writeJson(dir, 'package.json', {
      name: 'x', workspaces: ['packages/*'],
      devDependencies: { vitest: '1' },
    });
    writeJson(dir, 'packages/a/package.json', { name: 'a' });
    writeFile(dir, 'vitest.config.ts', 'x\n');
    const a = investigateProject(dir);
    const b = investigateProject(dir);
    assert.deepEqual(a, b);
    // suggestAnswers / buildResearchRecord must not mutate inv.
    const snapshot = JSON.parse(JSON.stringify(a));
    suggestAnswers(a);
    buildResearchRecord(a);
    diffInvestigation(baseConfig(dir), a);
    assert.deepEqual(a, snapshot);
  } finally { cleanup(dir); }
});
