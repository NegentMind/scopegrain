// SPDX-License-Identifier: Apache-2.0
// Context packet X-ray layer (--explain): per-section provenance, flag
// accounting and --fields projection reporting. The layer is a pure
// projection over the assembled packet — it never mutates state and
// tokenEstimate figures never cover it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleContextPacket } from '../src/core/context-packet.mjs';
import { TOKEN_ESTIMATOR } from '../src/core/tokens.mjs';
import { applyPlan } from '../src/core/bootstrap.mjs';
import { prepareWorkspace } from '../src/core/workspaces.mjs';
import { bootstrappedMiniCtx, cleanup, fakeIO, writeFile }
  from './helpers.mjs';

function ctxWithWorkspace() {
  const { dir, ctx } = bootstrappedMiniCtx();
  const ws = prepareWorkspace(ctx, { areas: [{ key: 'p', name: 'P' }] });
  applyPlan(dir, [ws.file]);
  return { dir, ctx };
}

test('context --explain: off by default, on adds registered provenance', async () => {
  const { dir, ctx } = ctxWithWorkspace();
  try {
    const plain = await assembleContextPacket(ctx, { noVantadb: true });
    assert.equal(plain.explain, undefined);

    const out = await assembleContextPacket(ctx,
      { noVantadb: true, explain: true });
    assert.equal(out.explain.schemaVersion, 1);
    assert.equal(out.explain.estimator, TOKEN_ESTIMATOR);
    // Every packet section carries a registered entry — no generic
    // 'section without registered provenance' fallbacks for known keys.
    for (const k of Object.keys(out)) {
      if (k === 'explain') continue;
      assert.ok(out.explain.sections[k], `missing section ${k}`);
      assert.notEqual(out.explain.sections[k].basis,
        'section without registered provenance', `unregistered ${k}`);
      assert.equal(typeof out.explain.sections[k].source, 'string');
    }
  } finally {
    cleanup(dir);
  }
});

test('context --explain: flags drive exclusion notes', async () => {
  const { dir, ctx } = ctxWithWorkspace();
  try {
    const out = await assembleContextPacket(ctx, {
      explain: true, noVantadb: true, noStructure: true, tail: 2,
    });
    const { flags, sections } = out.explain;
    assert.equal(flags.noVantadb, true);
    assert.equal(flags.noStructure, true);
    assert.equal(flags.tail, 2);
    assert.ok(sections.vantadb.notes.some(
      (n) => n.includes('--no-vantadb')));
    assert.ok(sections.structure.notes.some(
      (n) => n.includes('--no-structure')));
    assert.equal(sections.progress.basis, 'tail 2');
  } finally {
    cleanup(dir);
  }
});

test('context --explain: per-section tokens match tokenEstimate', async () => {
  const { dir, ctx } = ctxWithWorkspace();
  try {
    const out = await assembleContextPacket(ctx,
      { noVantadb: true, explain: true });
    for (const [k, s] of Object.entries(out.explain.sections)) {
      // tokenEstimate excludes its own section (excludesSelf contract):
      // the explain layer reports null there, matching nothing else.
      const declared = out.tokenEstimate.sections[k];
      assert.equal(s.estimatedTokens,
        declared === undefined ? null : declared.estimatedTokens, k);
    }
    // The explain block itself is appended after the estimate pass and
    // stays outside the declared figures — the note says so.
    assert.ok(out.explain.note.includes('exclude'));
    assert.equal(out.tokenEstimate.sections.explain, undefined);
  } finally {
    cleanup(dir);
  }
});

test('context --explain: --fields reports matched and unknown names', async () => {
  const { dir, ctx } = ctxWithWorkspace();
  try {
    const out = await assembleContextPacket(ctx, {
      noVantadb: true, explain: true,
      fields: 'tasks,explain,bogus-field',
    });
    assert.deepEqual(out.explain.projection.requested,
      ['tasks', 'explain', 'bogus-field']);
    assert.deepEqual(out.explain.projection.matched, ['tasks', 'explain']);
    assert.deepEqual(out.explain.projection.unknown, ['bogus-field']);
    assert.equal(out.explain.projection.appliedAfter, 'assembly');
    assert.equal(out.explain.flags.fields, 'tasks,explain,bogus-field');
  } finally {
    cleanup(dir);
  }
});

test('context --explain: userContext provenance reflects the real file', async () => {
  const { dir, ctx } = ctxWithWorkspace();
  try {
    const absent = await assembleContextPacket(ctx,
      { noVantadb: true, explain: true });
    assert.ok(absent.explain.sections.userContext.notes.some(
      (n) => n.includes('absent')));

    writeFile(dir, '.scopegrain/context.md', '# owner notes\n');
    const present = await assembleContextPacket(ctx,
      { noVantadb: true, explain: true });
    assert.equal(present.explain.sections.userContext.source,
      '.scopegrain/context.md');
    assert.equal(present.explain.sections.userContext.notes, undefined);
  } finally {
    cleanup(dir);
  }
});

test('context --explain --fields: explain projects like a normal key', async () => {
  const { dir } = ctxWithWorkspace();
  try {
    const { run } = await import('../src/cli.mjs');
    const kept = fakeIO();
    assert.equal(await run(
      ['context', '--project', dir, '--no-vantadb', '--explain',
        '--fields', 'tasks,explain'], kept), 0);
    const keptPacket = JSON.parse(kept.out.stdout.join(''));
    assert.ok(keptPacket.tasks);
    assert.ok(keptPacket.explain);
    const dropped = fakeIO();
    assert.equal(await run(
      ['context', '--project', dir, '--no-vantadb', '--explain',
        '--fields', 'tasks'], dropped), 0);
    const droppedPacket = JSON.parse(dropped.out.stdout.join(''));
    assert.ok(droppedPacket.tasks);
    // --fields tasks drops explain like any unlisted key; the typo
    // surface lives in explain.projection, only reachable when explain
    // itself is kept.
    assert.equal(droppedPacket.explain, undefined);
  } finally {
    cleanup(dir);
  }
});

test('context --explain: deterministic across calls', async () => {
  const { dir, ctx } = ctxWithWorkspace();
  try {
    const opts = { noVantadb: true, noStructure: true, explain: true };
    const a = await assembleContextPacket(ctx, opts);
    const b = await assembleContextPacket(ctx, opts);
    assert.deepEqual(a.explain, b.explain);
  } finally {
    cleanup(dir);
  }
});
