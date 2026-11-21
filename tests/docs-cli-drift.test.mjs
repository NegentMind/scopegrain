// SPDX-License-Identifier: Apache-2.0
// docs-cli-drift: verb-table extraction, doc scanning and doctor wiring.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDoctor } from '../src/core/doctor.mjs';
import { resolveContext } from '../src/core/context.mjs';
import { applyPlan, prepareInit } from '../src/core/bootstrap.mjs';
import { loadCatalog } from '../src/core/catalog.mjs';
import {
  catalogCommandVerbs, checkDocsCliDrift, extractCliVerbs, scanDocText,
} from '../src/core/docs-cli-drift.mjs';
import {
  VALID_ANSWERS, cleanup, makeTempDir, writeFile,
} from './helpers.mjs';

const INSTALL_ROOT = fileURLToPath(new URL('..', import.meta.url));

function bootstrapped() {
  const dir = makeTempDir('drift');
  applyPlan(dir, prepareInit({ projectRoot: dir,
    configRel: '.tasksystem/config.json', answers: VALID_ANSWERS }).files);
  return { dir, ctx: resolveContext({ project: dir }) };
}

const driftCheck = (report) =>
  report.checks.find((c) => c.name === 'docs-cli-drift');

test('extractCliVerbs reads the real COMMANDS table', () => {
  const src = fs.readFileSync(
    path.join(INSTALL_ROOT, 'src', 'cli.mjs'), 'utf8');
  const verbs = extractCliVerbs(src);
  assert.ok(Array.isArray(verbs) && verbs.length >= 50);
  for (const v of ['doctor', 'init', 'task create', 'task check-action',
    'catalog legacy-show', 'verify run', 'view', 'mcp']) {
    assert.ok(verbs.includes(v), `missing verb ${v}`);
  }
  assert.equal(extractCliVerbs('const OTHER = { a: 1 };'), null);
  assert.equal(extractCliVerbs(''), null);
});

test('catalogCommandVerbs collects command ids and command aliases', () => {
  const catalog = loadCatalog({});
  const verbs = catalogCommandVerbs(catalog);
  assert.ok(verbs.includes('plan-work'));
  assert.ok(verbs.includes('pipeline'));
  assert.ok(!verbs.includes('progreso')); // skill alias, not a command
  assert.deepEqual(catalogCommandVerbs(null), []);
});

test('scanDocText flags stale invocations and credits real verbs', () => {
  const verbs = new Set(['init', 'doctor', 'capture create', 'capture show',
    'journal show', 'journal recover', 'pipeline']);
  const doc = [
    'node ./bin/scopegrain.mjs init --project "C:\\x"',
    'node ./bin/scopegrain.mjs capture list --project "C:\\x"',
    '```text',
    'scopegrain journal show OPERATION --project PATH',
    '```',
    'See `capture create` and `journal idle` for details.',
    'bin/scopegrain.mjs        Binary entry point; delegates to src/cli.mjs',
    '`scopegrain doctor --project PATH` is also an invocation.',
    'node ./bin/tasksystem.mjs pipeline --project "C:\\x" --mode plan',
  ].join('\n');
  const { referenced, stale } = scanDocText(doc, verbs);
  assert.ok(stale.has('capture list'));
  assert.equal(stale.size, 1); // 'journal idle' and file refs are not claims
  for (const v of ['init', 'capture create', 'journal show', 'doctor',
    'pipeline']) {
    assert.ok(referenced.has(v), `expected referenced ${v}`);
  }
  assert.ok(!referenced.has('journal idle'));
});

test('scanDocText ignores placeholders and flag-only invocations', () => {
  const verbs = new Set(['task list']);
  const { stale } = scanDocText([
    'scopegrain --help',
    'scopegrain TASK LIST',
    'scopegrain <verb> --project PATH',
  ].join('\n'), verbs);
  assert.equal(stale.size, 0);
});

test('doctor skips the drift check when a project has no docs', () => {
  const { dir, ctx } = bootstrapped();
  try {
    const report = runDoctor(ctx);
    const check = driftCheck(report);
    assert.equal(check.ok, true);
    assert.ok(check.detail.startsWith('skipped:'));
    assert.equal(report.status, 'ready');
  } finally { cleanup(dir); }
});

test('doctor reports documented-but-nonexistent verbs as warning-level', () => {
  const { dir, ctx } = bootstrapped();
  try {
    writeFile(dir, 'README.md', [
      '# fixture',
      'node ./bin/scopegrain.mjs capture list --project "C:\\x"',
      'node ./bin/scopegrain.mjs capture get 6666 --project "C:\\x"',
      'node ./bin/scopegrain.mjs init --project "C:\\x"',
    ].join('\n'));
    const report = runDoctor(ctx);
    const check = driftCheck(report);
    assert.equal(check.ok, false);
    assert.equal(check.severity, 'warning');
    assert.deepEqual(check.stale, ['capture get', 'capture list']);
    assert.ok(check.undocumented.length > 0);
    // Warning-level: attention without a failure count.
    assert.equal(report.status, 'needs-attention');
    assert.equal(report.summary.failures, 0);
    assert.ok(report.summary.warnings >= 1);
    assert.ok(report.warnings.some((w) => w.startsWith('docs-cli-drift')));
  } finally { cleanup(dir); }
});

test('doctor skips the drift check when the CLI source is unavailable', () => {
  const { dir, ctx } = bootstrapped();
  const fakeRoot = makeTempDir('drift-noroot');
  try {
    writeFile(dir, 'README.md',
      'node ./bin/scopegrain.mjs capture list --project "C:\\x"\n');
    const report = runDoctor(ctx, { installRoot: fakeRoot });
    assert.equal(driftCheck(report).ok, true);
    assert.ok(driftCheck(report).detail.startsWith('skipped:'));
  } finally { cleanup(dir); cleanup(fakeRoot); }
});

test('summary partitions checks into ok/warnings/failures', () => {
  const { dir, ctx } = bootstrapped();
  try {
    const ready = runDoctor(ctx);
    assert.equal(ready.summary.warnings, 0);
    assert.equal(ready.summary.failures, 0);
    assert.equal(ready.summary.ok,
      ready.checks.filter((c) => c.ok).length);
    writeFile(dir, '.tasksystem/discovery.json', '{corrupt');
    const bad = runDoctor(ctx);
    assert.equal(bad.status, 'needs-attention');
    assert.equal(bad.summary.failures,
      bad.checks.filter((c) => !c.ok && c.severity !== 'warning').length);
    assert.ok(bad.summary.failures >= 1);
    assert.equal(bad.summary.ok + bad.summary.failures
      + bad.checks.filter((c) => !c.ok && c.severity === 'warning').length,
    bad.checks.length);
  } finally { cleanup(dir); }
});
