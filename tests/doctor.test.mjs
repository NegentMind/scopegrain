// SPDX-License-Identifier: Apache-2.0
// Doctor cases: content comparison, templates check, warning propagation.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runDoctor } from '../src/core/doctor.mjs';
import { resolveContext } from '../src/core/context.mjs';
import { applyPlan, prepareInit } from '../src/core/bootstrap.mjs';
import {
  VALID_ANSWERS, cleanup, exists, makeTempDir, writeFile, writeJson,
} from './helpers.mjs';

function bootstrapped() {
  const dir = makeTempDir('doctor');
  applyPlan(dir, prepareInit({ projectRoot: dir, configRel: '.tasksystem/config.json',
    answers: VALID_ANSWERS }).files);
  const ctx = resolveContext({ project: dir });
  return { dir, ctx };
}

test('freshly initialized project reports ready', () => {
  const { dir, ctx } = bootstrapped();
  try {
    const report = runDoctor(ctx);
    assert.equal(report.status, 'ready');
    assert.equal(report.changedDiscovery, false);
    assert.deepEqual(report.summary, {
      ok: report.checks.filter((c) => c.ok).length,
      warnings: 0, failures: 0,
    });
  } finally { cleanup(dir); }
});

test('corrupt or divergent integration fragment is needs-attention', () => {
  const { dir, ctx } = bootstrapped();
  try {
    writeFile(dir, '.tasksystem/integrations/claude-mcp.json', '{corrupt');
    const report = runDoctor(ctx);
    assert.equal(report.status, 'needs-attention');
    assert.ok(report.warnings.some((w) => w.includes('claude-mcp.json')));
    assert.ok(report.summary.failures >= 1);
    assert.equal(report.summary.warnings,
      report.warnings.length - report.summary.failures);
  } finally { cleanup(dir); }
});

test('changed manifest fingerprint is reported', () => {
  const { dir, ctx } = bootstrapped();
  try {
    writeJson(dir, 'package.json', { name: 'new', scripts: { test: 't' } });
    const report = runDoctor(ctx);
    assert.equal(report.changedDiscovery, true);
    assert.ok(report.warnings.some((w) => w.includes('fingerprint')));
    // Advisory-only warnings: status demands attention with zero failures.
    assert.equal(report.summary.failures, 0);
    assert.ok(report.summary.warnings >= 1);
  } finally { cleanup(dir); }
});

test('adding a lockfile after init changes fingerprint presence', () => {
  // The manifest must exist BEFORE bootstrap; re-init on a changed manifest
  // is an explicit conflict, so lockfile presence is what varies here.
  const dir = makeTempDir('doctor-lock');
  try {
    writeJson(dir, 'package.json', { name: 'x', scripts: { test: 't' } });
    applyPlan(dir, prepareInit({ projectRoot: dir, configRel: '.tasksystem/config.json',
      answers: VALID_ANSWERS }).files);
    const ctx = resolveContext({ project: dir });
    assert.equal(runDoctor(ctx).changedDiscovery, false);
    writeFile(dir, 'package-lock.json', '{}');
    assert.equal(runDoctor(ctx).changedDiscovery, true);
  } finally { cleanup(dir); }
});

test('missing or corrupt discovery.json is needs-attention, never repaired', () => {
  const { dir, ctx } = bootstrapped();
  try {
    fs.rmSync(path.join(dir, '.tasksystem', 'discovery.json'));
    assert.equal(runDoctor(ctx).status, 'needs-attention');
    assert.ok(runDoctor(ctx).warnings.some((w) => w.startsWith('discovery')));
    assert.ok(!exists(dir, '.tasksystem/discovery.json')); // doctor never writes
    writeFile(dir, '.tasksystem/discovery.json', '{corrupt');
    const report = runDoctor(ctx);
    assert.equal(report.status, 'needs-attention');
    assert.ok(report.warnings.some((w) => w.includes('malformed JSON')));
    for (const raw of ['null', '[]', '"record"', 'false', '1']) {
      writeFile(dir, '.tasksystem/discovery.json', raw);
      assert.equal(runDoctor(ctx).status, 'needs-attention');
    }
    // Fingerprint mismatch also surfaces.
    writeFile(dir, '.tasksystem/discovery.json',
      JSON.stringify({ schemaVersion: 1, fingerprint: 'different' }));
    const r2 = runDoctor(ctx);
    assert.ok(r2.warnings.some((w) => w.includes('fingerprint')));
  } finally { cleanup(dir); }
});

test('operational checks: malformed worklog line fails', () => {
  const { dir, ctx } = bootstrapped();
  try {
    writeFile(dir, '.tasksystem/memory/progress.jsonl',
      '{"ok":true}\nnot-json\n');
    const report = runDoctor(ctx);
    assert.equal(report.status, 'needs-attention');
    assert.ok(report.warnings.some(
      (w) => w.startsWith('worklogs') && w.includes('progress.jsonl')));
  } finally { cleanup(dir); }
});

test('operational checks: malformed verify store fails', () => {
  const { dir, ctx } = bootstrapped();
  try {
    writeFile(dir, '.tasksystem/state/verify-commands.json', '{corrupt');
    const report = runDoctor(ctx);
    assert.equal(report.status, 'needs-attention');
    assert.ok(report.warnings.some((w) => w.startsWith('verify-store')));
  } finally { cleanup(dir); }
});

test('operational checks: malformed session record fails', () => {
  const { dir, ctx } = bootstrapped();
  try {
    writeFile(dir, '.tasksystem/state/sessions/abc.json', '[]');
    const report = runDoctor(ctx);
    assert.equal(report.status, 'needs-attention');
    assert.ok(report.warnings.some((w) => w.startsWith('sessions')));
  } finally { cleanup(dir); }
});

test('operational checks: malformed journal outbox entry fails', () => {
  const { dir, ctx } = bootstrapped();
  try {
    writeFile(dir, '.tasksystem/state/journal/outbox/x.json', 'oops');
    const report = runDoctor(ctx);
    assert.equal(report.status, 'needs-attention');
    assert.ok(report.warnings.some(
      (w) => w.startsWith('journal-internals')));
  } finally { cleanup(dir); }
});

test('operational checks: malformed vantadb enrollment fails', () => {
  const { dir, ctx } = bootstrapped();
  try {
    writeFile(dir, '.tasksystem/vantadb.json',
      JSON.stringify({ backendId: 'vantadb' })); // no schemaVersion
    const report = runDoctor(ctx);
    assert.equal(report.status, 'needs-attention');
    assert.ok(report.warnings.some((w) => w.startsWith('vantadb')));
  } finally { cleanup(dir); }
});

test('operational checks: absent stores stay green on fresh init', () => {
  const { dir, ctx } = bootstrapped();
  try {
    const report = runDoctor(ctx);
    // journal-internals is conditional: it only reports once the lazily
    // created journal directory exists.
    for (const name of ['runtime', 'policy',
      'verify-store', 'sessions', 'worklogs', 'record-ownership',
      'vantadb', 'hooks']) {
      assert.ok(report.checks.some((c) => c.name === name && c.ok),
        `expected ok check: ${name}`);
    }
  } finally { cleanup(dir); }
});

test('operational checks: stale lock with dead pid warns', () => {
  const { dir, ctx } = bootstrapped();
  try {
    // 99999999 exceeds the Windows pid space; provably dead on any OS.
    writeFile(dir, '.tasksystem/state/journal/.lock',
      '{"t":"x","pid":99999999,"at":0}\n');
    const report = runDoctor(ctx);
    const check = report.checks.find((c) => c.name === 'stale-locks');
    assert.ok(check && !check.ok);
    assert.equal(check.severity, 'warning'); // auto-reclaimable, not fatal
    assert.ok(check.detail.includes('dead pid'));
    // Still a foreign file: doctor never deletes locks.
    assert.ok(exists(dir, '.tasksystem/state/journal/.lock'));
  } finally { cleanup(dir); }
});

test('operational checks: divergent host fragment fails', async () => {
  const { dir, ctx } = bootstrapped();
  try {
    const { prepareActivation }
      = await import('../src/hosts/activation.mjs');
    const plan = prepareActivation(ctx, { host: 'devin' });
    const target = plan.files.find((f) => f.action === 'create');
    assert.ok(target, 'expected at least one applyable devin proposal');
    writeFile(dir, target.rel, 'tampered fragment\n');
    const report = runDoctor(ctx);
    assert.equal(report.status, 'needs-attention');
    const check = report.checks.find((c) => c.name === 'host-fragments');
    assert.ok(check && !check.ok);
    assert.ok(check.detail.includes(target.rel));
  } finally { cleanup(dir); }
});

test('opencode host-fragments: the manual merge target is never a conflict', () => {
  // The opencode MCP fragment is a manual-merge proposal (kind 'mcp'), so it
  // is never part of the applyable set doctor re-renders. A real project
  // config file with different content must therefore not surface as
  // fragment drift.
  const { dir, ctx } = bootstrapped();
  try {
    writeFile(dir, 'opencode.jsonc', '{ "mcp": { "servers": {} } }\n');
    const report = runDoctor(ctx);
    const check = report.checks.find((c) => c.name === 'host-fragments');
    assert.ok(check, 'host-fragments check exists');
    assert.ok(check.ok, check.detail);
    assert.match(check.detail, /opencode:v2: 0 ok, \d+ pending/);
    assert.ok(!check.detail.includes('opencode.jsonc'),
      'the manual merge target must not be classified as a fragment');
  } finally { cleanup(dir); }
});

test('missing required template is needs-attention without touching it', () => {
  const { dir, ctx } = bootstrapped();
  try {
    const fakeRoot = makeTempDir('doctor-noroot');
    try {
      const report = runDoctor(ctx, { installRoot: fakeRoot });
      assert.equal(report.status, 'needs-attention');
      assert.ok(report.warnings.some((w) => w.startsWith('templates')));
    } finally { cleanup(fakeRoot); }
  } finally { cleanup(dir); }
});

test('user content outside managed markers does not trip the generated check', () => {
  const { dir, ctx } = bootstrapped();
  try {
    const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
    assert.ok(agents.includes('SCOPEGRAIN:BEGIN'));
    fs.writeFileSync(path.join(dir, 'AGENTS.md'),
      `${agents}\n# Project-owned rules\n\nExtra user content.\n`, 'utf8');
    const report = runDoctor(ctx);
    assert.ok(!report.warnings.some((w) => w.includes('AGENTS.md')),
      'managed-body equality must ignore user bytes outside markers');
    const gen = report.checks.filter((c) => c.name === 'generated');
    assert.ok(gen.every((c) => c.ok), 'generated check stays green');
  } finally { cleanup(dir); }
});

test('stale managed body still fails the generated check', () => {
  const { dir, ctx } = bootstrapped();
  try {
    const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
    fs.writeFileSync(path.join(dir, 'AGENTS.md'),
      agents.replace('Session start', 'Session STALE'), 'utf8');
    const report = runDoctor(ctx);
    assert.ok(report.warnings.some((w) => w.includes('AGENTS.md')),
      'a diverged managed body is still reported');
  } finally { cleanup(dir); }
});

test('marker-less diverged AGENTS.md still fails the generated check', () => {
  const { dir, ctx } = bootstrapped();
  try {
    fs.writeFileSync(path.join(dir, 'AGENTS.md'),
      '# my own rules\n\nNo managed section here.\n', 'utf8');
    const report = runDoctor(ctx);
    assert.ok(report.warnings.some((w) => w.includes('AGENTS.md')),
      'a marker-less file that differs stays flagged');
  } finally { cleanup(dir); }
});

test('operational checks: mcp-deps, viewer-build, and user-artifacts', async () => {
  const os = await import('node:os');
  const { dir, ctx } = bootstrapped();
  try {
    const clean = runDoctor(ctx);
    const mcpOk = clean.checks.find((c) => c.name === 'mcp-deps');
    assert.ok(mcpOk && mcpOk.ok, 'mcp-deps passes in installed repo');
    const viewerChk = clean.checks.find((c) => c.name === 'viewer-build');
    assert.ok(viewerChk && viewerChk.ok && typeof viewerChk.built === 'boolean');
    const artOk = clean.checks.find((c) => c.name === 'user-artifacts');
    assert.ok(artOk && artOk.ok);

    // Valid context.md + valid JSON user artifact stay green.
    writeFile(dir, '.tasksystem/context.md', '# Notes\n');
    writeJson(dir, 'docs/agent/tasks/valid-task.json', { id: 'ok' });
    const withValid = runDoctor(ctx);
    const artValid = withValid.checks.find((c) => c.name === 'user-artifacts');
    assert.ok(artValid && artValid.ok && artValid.checked === 2);

    // Corrupt user artifact JSON under tasks fails user-artifacts check.
    writeFile(dir, 'docs/agent/tasks/bad-task.json', '{corrupt');
    const badArt = runDoctor(ctx);
    assert.equal(badArt.status, 'needs-attention');
    const artBad = badArt.checks.find((c) => c.name === 'user-artifacts');
    assert.ok(artBad && !artBad.ok);
    assert.ok(artBad.detail.includes('bad-task.json'));

    // Missing MCP deps in an isolated installRoot outside node_modules warns.
    const isoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-nomcp-'));
    try {
      const noMcp = runDoctor(ctx, { installRoot: isoRoot });
      const mcpInfo = noMcp.checks.find((c) => c.name === 'mcp-deps');
      assert.ok(mcpInfo && mcpInfo.ok && mcpInfo.ready === false);
      assert.ok(mcpInfo.missing.includes('@modelcontextprotocol/sdk'));
      const viewerNo = noMcp.checks.find((c) => c.name === 'viewer-build');
      assert.ok(viewerNo && viewerNo.ok && viewerNo.built === false);
    } finally {
      fs.rmSync(isoRoot, { recursive: true, force: true });
    }
  } finally { cleanup(dir); }
});
