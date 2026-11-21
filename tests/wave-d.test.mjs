// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { runWorkflow, loadRun } from '../src/core/workflow-runner.mjs';
import {
  validateSubmission, loadCatalogStack, composeResource,
  validateBundle, registerExtension, registerPreset, listRegistry,
  setExtensionState, installBundle, presetLayers,
} from '../src/core/distribution.mjs';
import { createTask } from '../src/core/tasks.mjs';
import { assertSafeId } from '../src/core/identifiers.mjs';
import {
  bootstrappedCtx, cleanup, writeJson, VALID_ANSWERS,
} from './helpers.mjs';

const mk = (title) => ({ title, contract: 'c', authorContext: 'a', scope: [] });

test('D1 workflow runner: whitelisted ops only, resumable checkpoints', () => {
  const { dir, ctx } = bootstrappedCtx(VALID_ANSWERS);
  try {
    assert.throws(() => runWorkflow(ctx, {
      schemaVersion: 1, id: 'w1',
      steps: [{ id: 's1', op: 'shell', args: { cmd: 'rm -rf /' } }],
    }), (e) => e.code === 'INVALID_OP');
    const t = createTask(ctx, mk('wf'));
    const r = runWorkflow(ctx, {
      schemaVersion: 1, id: 'wf-ok',
      steps: [
        { id: 'c', op: 'converge.evaluate', args: { taskId: t.id } },
        { id: 'a', op: 'analyze.task', args: { taskId: t.id } },
      ],
    });
    assert.equal(r.run.status, 'completed');
    assert.equal(r.run.completed.length, 2);
    assert.ok(loadRun(ctx, 'wf-ok'));
    // Resume: completed steps are never re-run
    const r2 = runWorkflow(ctx, {
      schemaVersion: 1, id: 'wf-ok',
      steps: [
        { id: 'c', op: 'converge.evaluate', args: { taskId: t.id } },
        { id: 'a', op: 'analyze.task', args: { taskId: t.id } },
        { id: 'n', op: 'noop', args: {} },
      ],
    });
    assert.equal(r2.run.status, 'completed');
    assert.equal(r2.run.completed.length, 3);
  } finally { cleanup(dir); }
});

test('D2 compose: replace/prepend/append/wrap ops apply in order', () => {
  assert.equal(composeResource('base', [
    { op: 'append', content: '+tail' },
    { op: 'prepend', content: 'head+' },
  ]), 'head+base+tail');
  assert.equal(composeResource('b', [
    { op: 'wrap', content: '[[{{BODY}}]]' },
  ]), '[[b]]');
  assert.equal(composeResource('b', [
    { op: 'replace', content: 'new' },
  ]), 'new');
  assert.throws(() => composeResource('b', [{ op: 'exec', content: 'x' }]),
    /op/);
});

test('D3 catalog stack: file:// only, remote refused hard', () => {
  const { dir, ctx } = bootstrappedCtx(VALID_ANSWERS);
  try {
    writeJson(dir, 'cats/extra.json', {
      entries: [{ id: 'x1' }, { id: 'shared', v: 'low' }],
    });
    writeJson(dir, 'cats/upper.json', {
      entries: [{ id: 'shared', v: 'high' }],
    });
    const stack = loadCatalogStack(ctx, [
      { uri: 'file://cats/extra.json', priority: 1 },
      { uri: 'file://cats/upper.json', priority: 2 },
    ]);
    const shared = stack.entries.find((e) => e.id === 'shared');
    assert.equal(shared.v, 'high'); // higher priority wins
    assert.equal(stack.entries.length, 2);
    assert.throws(() => loadCatalogStack(ctx, [
      { uri: 'https://example.com/cat.json' },
    ]), (e) => e.code === 'REMOTE_CATALOG_UNSUPPORTED');
  } finally { cleanup(dir); }
});

test('D7 submission: id/semver/pinning enforced; remote requires sha256', () => {
  assert.throws(() => validateSubmission({ id: 'Bad ID', version: '1.0.0',
    source: { uri: 'file://x' } }), /slug/);
  assert.throws(() => validateSubmission({ id: 'ok', version: 'v1',
    source: { uri: 'file://x' } }), /semver/);
  assert.throws(() => validateSubmission({ id: 'ok', version: '1.0.0',
    source: { uri: 'https://x.com/c.tgz' } }),
    (e) => e.code === 'PIN_REQUIRED');
  const ok = validateSubmission({ id: 'ok', version: '1.0.0',
    source: { uri: 'https://x.com/c.tgz', sha256: 'a'.repeat(64) } });
  assert.equal(ok.source.remote, true);
});

test('D4 bundle: pin validation + missing detection', () => {
  const ids = new Set(['a', 'b']);
  const b = validateBundle({ id: 'pkg', version: '1.0.0',
    requires: [{ id: 'a' }, { id: 'ghost' }], contributes: ['a'] }, ids);
  assert.deepEqual(b.missing, ['ghost']);
  assert.throws(() => validateBundle({ id: 'pkg', version: '1.0.0',
    requires: [{ id: 'a', sha256: 'zz' }] }), /sha256/);
});

test('G3 identifiers: Windows reserved names and non-slugs rejected', () => {
  for (const bad of ['con', 'CON', 'aux', 'nul', 'com1', 'lpt9',
    'Bad ID', 'a b', 'x/y', 'with..dots', '-lead', '']) {
    assert.throws(() => assertSafeId(bad), /INVALID_VALUE|slug|reserved/);
  }
  for (const ok of ['task-1', 'my-ext', 'a', 'x'.repeat(64).slice(0, 63)
    .replace(/^./, 'a')]) {
    assert.equal(assertSafeId(ok), ok);
  }
  // Reserved names are also rejected inside documents that adopt them.
  assert.throws(() => validateSubmission({ id: 'con', version: '1.0.0',
    source: { uri: 'file://x' } }), /reserved/);
});

test('D5/D6 registries: extension lifecycle + preset priority persist', () => {
  const { dir, ctx } = bootstrappedCtx(VALID_ANSWERS);
  try {
    const e = registerExtension(ctx, { id: 'ext1', version: '1.0.0',
      lifecycle: { onActivate: 'boot' }, contributes: [] });
    assert.equal(e.lifecycle.onActivate, 'boot');
    const p = registerPreset(ctx, { id: 'p1', priority: 5,
      overrides: [{ op: 'append', content: 'x', target: '*' }] });
    assert.equal(p.priority, 5);
    assert.equal(listRegistry(ctx, 'extensions').length, 1);
    assert.equal(listRegistry(ctx, 'presets').length, 1);
    assert.throws(() => registerExtension(ctx, { id: 'ext1',
      version: '1.0.0' }), /already/);
    assert.throws(() => registerExtension(ctx, { id: 'e2',
      version: '1.0.0', lifecycle: { onPwned: 'x' } }), /unknown key/);
    assert.throws(() => registerPreset(ctx, { id: 'p2',
      overrides: [{ op: 'append', content: 'x' }] }), /target/);
    assert.throws(() => registerPreset(ctx, { id: 'p2',
      overrides: [{ op: 'append', content: 'x', target: 'bogus/x' }] }),
      /unknown kind/);
  } finally { cleanup(dir); }
});

test('presets consume: target matching + packet applies overrides', async () => {
  const { dir, ctx } = bootstrappedCtx(VALID_ANSWERS);
  try {
    // Matching semantics: exact, kind/* and * targets all apply,
    // higher priority last.
    const presets = [
      { id: 'low', priority: 1, overrides: [
        { op: 'append', content: '+L', target: '*' }] },
      { id: 'high', priority: 9, overrides: [
        { op: 'append', content: '+H', target: 'rule/*' },
        { op: 'append', content: '+E', target: 'skill/planning-and-task-breakdown' }] },
    ];
    let sel = presetLayers(presets, 'rule', 'workflow');
    assert.equal(sel.layers.length, 2);
    assert.equal(composeResource('b', sel.layers), 'b+L+H');
    sel = presetLayers(presets, 'skill', 'planning-and-task-breakdown');
    assert.equal(sel.layers.length, 2); // '*' + exact
    sel = presetLayers(presets, 'prompt', 'task-brief');
    assert.equal(sel.layers.length, 1); // only '*'
    // End-to-end: registered preset shapes the workflow packet content.
    registerPreset(ctx, { id: 'pk', priority: 1, overrides: [
      { op: 'append', content: '\nPRESET-MARK', target: 'command/*' }] });
    const { buildWorkflowPacket } =
      await import('../src/core/workflows.mjs');
    const packet = buildWorkflowPacket(ctx, { command: 'plan-work' });
    assert.ok(packet.command.content.endsWith('PRESET-MARK'));
    assert.deepEqual(packet.presets.applied,
      [{ resource: 'command/plan-work', preset: 'pk',
        target: 'command/*', op: 'append' }]);
  } finally { cleanup(dir); }
});

test('extension lifecycle: activate validates contributes vs catalog', () => {
  const { dir, ctx } = bootstrappedCtx(VALID_ANSWERS);
  try {
    registerExtension(ctx, { id: 'ok-ext', version: '1.0.0',
      contributes: ['command/plan-work'] });
    const act = setExtensionState(ctx, 'ok-ext', 'active');
    assert.equal(act.state, 'active');
    const dis = setExtensionState(ctx, 'ok-ext', 'disabled');
    assert.equal(dis.state, 'disabled');
    registerExtension(ctx, { id: 'bad-ext', version: '1.0.0',
      contributes: ['command/ghost'] });
    assert.throws(() => setExtensionState(ctx, 'bad-ext', 'active'),
      /unknown resources/);
    assert.throws(() => setExtensionState(ctx, 'nope', 'active'),
      /not registered/);
  } finally { cleanup(dir); }
});

test('bundle install: file:// bounded copy, sha256 pin, provenance', () => {
  const { dir, ctx } = bootstrappedCtx(VALID_ANSWERS);
  try {
    fs.mkdirSync(path.join(dir, 'pack'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'pack/content.md'), 'hello bundle');
    const sha = crypto.createHash('sha256')
      .update('hello bundle').digest('hex');
    writeJson(dir, 'cats/pack-cat.json', {
      entries: [{ id: 'entry-a',
        source: { uri: 'file://pack/content.md' } }] });
    const input = {
      bundle: { id: 'pkg', version: '1.0.0',
        requires: [{ id: 'entry-a', sha256: sha }] },
      sources: [{ uri: 'file://cats/pack-cat.json' }],
    };
    const dry = installBundle(ctx, input.bundle, input.sources);
    assert.equal(dry.mode, 'dry-run');
    assert.equal(dry.files.length, 1);
    const done = installBundle(ctx, input.bundle, input.sources,
      { apply: true });
    assert.equal(done.applied, true);
    assert.ok(fs.existsSync(path.join(dir,
      '.tasksystem/bundles/pkg/entry-a')));
    const prov = JSON.parse(fs.readFileSync(path.join(dir,
      '.tasksystem/bundles/pkg/provenance.json'), 'utf8'));
    assert.equal(prov.files[0].sha256, sha);
    // Idempotent re-apply (identical bytes) is a no-op, not a conflict.
    const again = installBundle(ctx, input.bundle, input.sources,
      { apply: true });
    assert.equal(again.applied, true);
    // Wrong pin fails closed.
    assert.throws(() => installBundle(ctx, { ...input.bundle,
      requires: [{ id: 'entry-a', sha256: 'b'.repeat(64) }] },
      input.sources), (e) => e.code === 'HASH_MISMATCH');
    // Missing stack entry fails closed.
    assert.throws(() => installBundle(ctx, { ...input.bundle,
      requires: [{ id: 'ghost' }] }, input.sources), /missing entries/);
  } finally { cleanup(dir); }
});
