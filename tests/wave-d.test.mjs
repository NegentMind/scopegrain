// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runWorkflow, loadRun } from '../src/core/workflow-runner.mjs';
import {
  validateSubmission, loadCatalogStack, composeResource,
  validateBundle, registerExtension, registerPreset, listRegistry,
} from '../src/core/distribution.mjs';
import { createTask } from '../src/core/tasks.mjs';
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

test('D5/D6 registries: extension lifecycle + preset priority persist', () => {
  const { dir, ctx } = bootstrappedCtx(VALID_ANSWERS);
  try {
    const e = registerExtension(ctx, { id: 'ext1', version: '1.0.0',
      lifecycle: { onActivate: 'boot' }, contributes: [] });
    assert.equal(e.lifecycle.onActivate, 'boot');
    const p = registerPreset(ctx, { id: 'p1', priority: 5,
      overrides: [{ op: 'append', content: 'x' }] });
    assert.equal(p.priority, 5);
    assert.equal(listRegistry(ctx, 'extensions').length, 1);
    assert.equal(listRegistry(ctx, 'presets').length, 1);
    assert.throws(() => registerExtension(ctx, { id: 'ext1',
      version: '1.0.0' }), /already/);
    assert.throws(() => registerExtension(ctx, { id: 'e2',
      version: '1.0.0', lifecycle: { onPwned: 'x' } }), /unknown key/);
  } finally { cleanup(dir); }
});
