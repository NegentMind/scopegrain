// SPDX-License-Identifier: Apache-2.0
// Packet token accounting: tokenEstimate wire honesty (self-inclusive
// fixed point), command.rendered deduplication, advisory
// packetBudgetTokens warnings and the declared lazy posture.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { applyPlan } from '../src/core/bootstrap.mjs';
import { buildWorkflowPacket } from '../src/core/workflows.mjs';
import { assembleContextPacket } from '../src/core/context-packet.mjs';
import { loadWorkspaceCatalog } from '../src/core/catalog.mjs';
import { createTask } from '../src/core/tasks.mjs';
import { prepareWorkspace } from '../src/core/workspaces.mjs';
import { estimateJson, TOKEN_ESTIMATOR } from '../src/core/tokens.mjs';
import { appendWorklog, readWorklog } from '../src/core/worklog.mjs';
import { bootstrappedCtx, cleanup, writeFile } from './helpers.mjs';

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

function ctxWithWorkspace() {
  const { dir, ctx } = bootstrappedCtx();
  const ws = prepareWorkspace(ctx, { areas: [{ key: 'p', name: 'P' }] });
  applyPlan(dir, [ws.file]);
  return { dir, ctx };
}

test('context tokenEstimate: total excludes the block, wire is honest', async () => {
  const { dir, ctx } = ctxWithWorkspace();
  try {
    const out = await assembleContextPacket(ctx, { noVantadb: true });
    const { tokenEstimate, ...rest } = out;
    assert.equal(tokenEstimate.estimator, TOKEN_ESTIMATOR);
    assert.equal(tokenEstimate.excludesSelf, true);
    // Historical contract: total covers the packet minus this block.
    assert.equal(tokenEstimate.total, estimateJson(rest).estimatedTokens);
    // wire is the self-inclusive figure and must equal the real wire:
    // it is declared inside the block it measures, iterated to a fixed
    // point.
    assert.equal(tokenEstimate.wire.estimator, TOKEN_ESTIMATOR);
    assert.equal(tokenEstimate.wire.estimatedTokens,
      estimateJson(out).estimatedTokens);
    assert.ok(tokenEstimate.wire.estimatedTokens > tokenEstimate.total);
  } finally { cleanup(dir); }
});

test('context packet warnings field exists; under budget it stays empty', async () => {
  const { dir, ctx } = ctxWithWorkspace();
  try {
    const out = await assembleContextPacket(ctx, { noVantadb: true });
    assert.ok(Array.isArray(out.warnings));
    assert.equal(out.warnings.length, 0);
  } finally { cleanup(dir); }
});

test('context packet over packetBudgetTokens emits a warning, not an error', async () => {
  const { dir, ctx } = ctxWithWorkspace();
  try {
    // ~80 KiB of task title lands in tasks.ready -> ~20k estTok wire.
    createTask(ctx, { title: 'x'.repeat(80 * 1024), contract: 'c',
      authorContext: 'a', scope: [] });
    const out = await assembleContextPacket(ctx, { noVantadb: true });
    assert.ok(out.warnings.some((w) => w.includes('packetBudgetTokens')));
    // The warning's own bytes are inside the recomputed wire figure.
    assert.equal(out.tokenEstimate.wire.estimatedTokens,
      estimateJson(out).estimatedTokens);
  } finally { cleanup(dir); }
});

test('workflow packet emits rendered only when it differs from content', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    // No placeholders in 'pipeline': rendered would duplicate content.
    const p = buildWorkflowPacket(ctx, { command: 'pipeline' });
    assert.equal(p.command.rendered, undefined);
    assert.equal(p.command.sameAsContent, true);
    assert.equal(typeof p.command.content, 'string');

    // A command body with $ARGUMENTS resolves into `rendered`.
    const body = 'Do $ARGUMENTS now.\n';
    writeFile(dir, '.tasksystem/commands/ph-args.md', body);
    const catAbs = `${dir}/.tasksystem/catalog.json`;
    const doc = JSON.parse(fs.readFileSync(catAbs, 'utf8'));
    doc.entries.push({
      kind: 'command', id: 'ph-args', path: 'commands/ph-args.md',
      description: 'placeholder command', modes: ['default'],
      sha256: sha(Buffer.from(body, 'utf8')),
    });
    fs.writeFileSync(catAbs, JSON.stringify(doc, null, 2) + '\n');
    const withArgs = buildWorkflowPacket(ctx,
      { command: 'ph-args', arguments: 'THINGS' });
    assert.equal(withArgs.command.rendered, 'Do THINGS now.\n');
    assert.equal(withArgs.command.sameAsContent, undefined);
    // Backward-compat consumer idiom: rendered ?? content.
    const fallback = (c) => c.rendered ?? (c.sameAsContent ? c.content : null);
    assert.equal(fallback(p.command), p.command.content);
    assert.equal(fallback(withArgs.command), 'Do THINGS now.\n');
  } finally { cleanup(dir); }
});

test('workflow packet declares posture and advisory token budget', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const full = buildWorkflowPacket(ctx, { command: 'intake' });
    assert.deepEqual(full.posture,
      { current: 'full', recommended: 'lazy' });
    assert.ok(full.warnings.some((w) => w.includes('packetBudgetTokens')),
      'full intake packet (~40k estTok) must trip the advisory budget');

    const lazy = buildWorkflowPacket(ctx, { command: 'intake', lazy: true });
    assert.deepEqual(lazy.posture,
      { current: 'lazy', recommended: 'lazy' });
    assert.ok(!lazy.warnings.some((w) => w.includes('packetBudgetTokens')));

    // Packet warnings must not leak into the shared catalog object.
    const catalog = loadWorkspaceCatalog(ctx);
    assert.ok(!(catalog.warnings ?? [])
      .some((w) => String(w).includes('packetBudgetTokens')));
  } finally { cleanup(dir); }
});

test('readWorklog serves a bounded tail window instead of the whole file', () => {
  const { dir, ctx } = ctxWithWorkspace();
  try {
    const task = createTask(ctx, { title: 'T', contract: 'C',
      authorContext: 'a', scope: [] });
    // ~200 KiB log: larger than the take*MAX_LINE_BYTES window for tail=5
    // (~80 KiB) but under the 1 MiB document cap.
    for (let i = 0; i < 40; i++) {
      appendWorklog(ctx, 'progress',
        { taskId: task.id, title: `e${i}`, summary: 's'.repeat(4000) });
    }
    const bounded = readWorklog(ctx, 'progress', { tail: 5 });
    assert.equal(bounded.truncated, true);
    assert.equal(bounded.entries.length, 5);
    assert.equal(bounded.entries.at(-1).title, 'e39');
    // tail:0 consumes nothing and never opens the file window.
    const none = readWorklog(ctx, 'progress', { tail: 0 });
    assert.deepEqual(none, { entries: [], malformed: [], truncated: false });
    // A small log still reads fully and reports truncated:false.
    const { dir: dir2, ctx: ctx2 } = ctxWithWorkspace();
    try {
      const t2 = createTask(ctx2, { title: 'T2', contract: 'C',
        authorContext: 'a', scope: [] });
      appendWorklog(ctx2, 'progress', { taskId: t2.id, title: 'only' });
      const small = readWorklog(ctx2, 'progress', { tail: 5 });
      assert.equal(small.truncated, false);
      assert.equal(small.entries.length, 1);
    } finally { cleanup(dir2); }
  } finally { cleanup(dir); }
});
