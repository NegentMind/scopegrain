// SPDX-License-Identifier: Apache-2.0
// Host-destination reconcile coverage (update --reconcile), the declared
// MCP merge targets for claude/codex, the honest activationMode metadata
// and doctor's visibility into manually-merged machine-local files.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { applyUpdate, prepareUpdate } from '../src/core/lifecycle.mjs';
import { runDoctor } from '../src/core/doctor.mjs';
import {
  applyActivation, prepareActivation,
} from '../src/hosts/activation.mjs';
import { renderNativeAdapters } from '../src/hosts/native.mjs';
import {
  bootstrappedCtx, cleanup, DEFAULT_ANSWERS, exists, readJson, writeFile,
} from './helpers.mjs';

const CFG = '.scopegrain/config.json';

test('activation plan declares claude and codex MCP merge targets', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const config = readJson(dir, CFG);
    const { activationPlan } = renderNativeAdapters(
      { ...config, hosts: ['claude', 'codex'] },
      { configRel: CFG, projectRoot: dir });
    const claude = activationPlan.entries.find(
      (e) => e.host === 'claude' && e.kind === 'mcp');
    const codex = activationPlan.entries.find(
      (e) => e.host === 'codex' && e.kind === 'mcp');
    assert.ok(claude, 'claude declares an mcp merge entry');
    assert.ok(codex, 'codex declares an mcp merge entry');
    assert.equal(claude.destination, '.mcp.json');
    assert.equal(codex.destination, '.codex/config.toml');
    assert.equal(claude.machineLocal, true);
    assert.equal(codex.machineLocal, true);
    assert.ok(claude.source.endsWith('claude-mcp.json'));
    assert.ok(codex.source.endsWith('codex-mcp.toml'));
    // `host activate` discloses them as manual-merge skips like opencode.
    const skipped = prepareActivation(ctx, { host: 'claude' }).skipped;
    assert.ok(skipped.some((s) => s.destination === '.mcp.json'));
  } finally { cleanup(dir); }
});

test('activationMode classifies every plan entry honestly', () => {
  const { dir } = bootstrappedCtx();
  try {
    const config = readJson(dir, CFG);
    const { activationPlan } = renderNativeAdapters(config,
      { configRel: CFG, projectRoot: dir });
    const modes = new Set(['apply', 'merge', 'manual']);
    for (const e of activationPlan.entries) {
      assert.ok(modes.has(e.activationMode),
        `${e.host}/${e.kind} lacks a valid activationMode`);
    }
    const applyable = activationPlan.entries.filter(
      (e) => ['skill', 'command', 'command-alias', 'agent', 'mcp-config']
        .includes(e.kind));
    assert.ok(applyable.length > 0);
    for (const e of applyable) {
      assert.equal(e.activationMode, 'apply');
    }
    for (const e of activationPlan.entries.filter(
      (x) => ['mcp', 'agent-declaration'].includes(x.kind))) {
      assert.equal(e.activationMode, 'merge');
    }
  } finally { cleanup(dir); }
});

test('update --reconcile previews and rewrites a diverged applied bridge', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    applyActivation(ctx, { host: 'claude' });
    const target = prepareActivation(ctx, { host: 'claude' })
      .files[0].rel;
    const expected = fs.readFileSync(path.join(dir, target));
    writeFile(dir, target, 'user edited bridge');

    const preview = prepareUpdate(ctx, { reconcile: true });
    const entry = preview.hostBridges.files.find((f) => f.rel === target);
    assert.equal(entry.action, 'conflict');
    assert.equal(entry.reconcile, true);
    // Nothing else diverges in this fixture: every other bridge is noop.
    assert.ok(preview.hostBridges.counts.noop > 0);

    const res = applyUpdate(ctx, { reconcile: true });
    assert.ok(res.hostBridges.reconciled.some((r) => r.path === target));
    assert.ok(fs.readFileSync(path.join(dir, target)).equals(expected));
    // Second pass: the bridge is a clean noop again.
    const after = prepareUpdate(ctx, { reconcile: true });
    assert.equal(after.hostBridges.files.find(
      (f) => f.rel === target).action, 'noop');
  } finally { cleanup(dir); }
});

test('update --reconcile never creates pending host destinations', () => {
  const { dir, ctx } = bootstrappedCtx({ ...DEFAULT_ANSWERS });
  try {
    // Nothing applied: every declared bridge is 'pending', never written.
    const preview = prepareUpdate(ctx, { reconcile: true });
    const pending = preview.hostBridges.files.filter(
      (f) => f.action === 'pending');
    assert.ok(pending.length > 0);
    assert.ok(pending.every((f) => f.reason.includes('host activate')));
    const res = applyUpdate(ctx, { reconcile: true });
    assert.equal(res.hostBridges.reconciled.length, 0);
    assert.ok(!exists(dir, '.claude'));
    assert.ok(!exists(dir, '.devin'));
    assert.ok(!exists(dir, '.codex'));
    assert.ok(!exists(dir, '.agents'));
    assert.ok(!exists(dir, '.opencode'));
  } finally { cleanup(dir); }
});

test('update --reconcile refuses non-file host destinations', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    applyActivation(ctx, { host: 'claude' });
    const target = prepareActivation(ctx, { host: 'claude' })
      .files[0].rel;
    fs.rmSync(path.join(dir, target));
    fs.mkdirSync(path.join(dir, target));
    const preview = prepareUpdate(ctx, { reconcile: true });
    const entry = preview.hostBridges.files.find((f) => f.rel === target);
    assert.equal(entry.action, 'conflict');
    assert.equal(entry.reconcile, false);
    const res = applyUpdate(ctx, { reconcile: true });
    assert.ok(res.hostBridges.conflicts.some((c) => c.path === target));
    assert.ok(fs.statSync(path.join(dir, target)).isDirectory());
  } finally { cleanup(dir); }
});

test('update without --reconcile exposes no hostBridges section', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    applyActivation(ctx, { host: 'claude' });
    writeFile(dir, prepareActivation(ctx, { host: 'claude' }).files[0].rel,
      'user edited bridge');
    const plain = prepareUpdate(ctx, {});
    assert.equal(plain.hostBridges, undefined);
  } finally { cleanup(dir); }
});

test('doctor host-merge-targets: pending, stale and diverged literals', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    // No merge target on disk: declared but pending, still ok.
    let report = runDoctor(ctx);
    let check = report.checks.find((c) => c.name === 'host-merge-targets');
    assert.ok(check.ok);
    assert.ok(check.detail.includes('pending merge'));

    // Correct merge (fragment bytes copied verbatim): ok.
    const fragment = fs.readFileSync(
      path.join(dir, '.scopegrain/integrations/claude-mcp.json'), 'utf8');
    writeFile(dir, '.mcp.json', fragment);
    report = runDoctor(ctx);
    check = report.checks.find((c) => c.name === 'host-merge-targets');
    assert.ok(check.ok, check.detail);

    // Stale literal: an absolute path outside projectRoot that is not in
    // the generated fragment (a relocated install) fails the check.
    const stale = fragment.replace(/"args": \[\s*"[^"]+"/,
      '"args": [\n        "C:\\\\relocated\\\\install\\\\server.mjs"');
    assert.notEqual(stale, fragment);
    writeFile(dir, '.mcp.json', stale);
    report = runDoctor(ctx);
    check = report.checks.find((c) => c.name === 'host-merge-targets');
    assert.equal(check.ok, false);
    assert.notEqual(check.severity, 'warning');

    // Hand-edited divergence that still resolves inside the project is a
    // warning, not a hard failure (the .devin/config.json class of drift).
    const m = fragment.match(/"([^"]*server\.mjs)"/);
    assert.ok(m, 'fragment carries the server path literal');
    const inside = fragment.replace(
      m[0], `"${dir.replace(/\\/g, '/')}/merged.mjs"`);
    assert.notEqual(inside, fragment);
    writeFile(dir, '.mcp.json', inside);
    report = runDoctor(ctx);
    check = report.checks.find((c) => c.name === 'host-merge-targets');
    assert.equal(check.ok, false);
    assert.equal(check.severity, 'warning');
  } finally { cleanup(dir); }
});
