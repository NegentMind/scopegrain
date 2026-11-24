// SPDX-License-Identifier: Apache-2.0
// Native gate channel: `task gate` exit contract for host hooks and
// `host gate` read-only merge proposals. Nothing installs: proposals
// stay owner-merge documents and documented-only hosts emit no fragment.
import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/cli.mjs';
import { gateProposal } from '../src/hosts/gate-proposal.mjs';
import { createTask } from '../src/core/tasks.mjs';
import { setActiveTask } from '../src/core/active.mjs';
import { bootstrappedCtx, cleanup, fakeIO } from './helpers.mjs';

function lastJson(io) {
  return JSON.parse(io.out.stdout[io.out.stdout.length - 1]);
}

test('task gate exits 0 allow when the action is permitted', async () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const task = createTask(ctx, {
      title: 'gate', contract: 'C', authorContext: 'a', scope: [],
    });
    const io = fakeIO();
    const code = await run(
      ['task', 'gate', '--project', dir, task.id, 'read'], io);
    assert.equal(code, 0);
    const out = lastJson(io);
    assert.equal(out.decision, 'allow');
    assert.equal(out.exitCode, 0);
    assert.equal(out.check.allowed, true);
  } finally { cleanup(dir); }
});

test('task gate exits 2 deny when the action is not permitted', async () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    // PLAN permits read|research|propose — edit is denied.
    const task = createTask(ctx, {
      title: 'gate', contract: 'C', authorContext: 'a', scope: [],
    });
    const io = fakeIO();
    const code = await run(
      ['task', 'gate', '--project', dir, task.id, 'edit'], io);
    assert.equal(code, 2);
    const out = lastJson(io);
    assert.equal(out.decision, 'deny');
    assert.equal(out.exitCode, 2);
    assert.equal(out.check.allowed, false);
  } finally { cleanup(dir); }
});

test('task gate "-" resolves the active task via env or pointer', async () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const task = createTask(ctx, {
      title: 'gate', contract: 'C', authorContext: 'a', scope: [],
    });
    setActiveTask(ctx, task.id);
    const io = fakeIO();
    const code = await run(
      ['task', 'gate', '--project', dir, '-', 'read'], io);
    assert.equal(code, 0);
    assert.equal(lastJson(io).check.id, task.id);
  } finally { cleanup(dir); }
});

test('task gate errors fail closed: bad task or action is non-zero', async () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const task = createTask(ctx, {
      title: 'gate', contract: 'C', authorContext: 'a', scope: [],
    });
    for (const [args, expected] of [
      [['task', 'gate', '--project', dir, task.id, 'nonsense'], 1],
      [['task', 'gate', '--project', dir, 'no-such-slug', 'read'], 1],
      // `-` unresolved is INVALID_ARGS -> usage exit 2 (still fail-closed).
      [['task', 'gate', '--project', dir, '-', 'read'], 2],
    ]) {
      const io = fakeIO();
      const code = await run(args, io);
      assert.equal(code, expected, `args ${args.join(' ')} must fail closed`);
    }
  } finally { cleanup(dir); }
});

test('host gate emits a claude PreToolUse command-hook proposal', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const p = gateProposal(ctx, { host: 'claude' });
    assert.equal(p.status, 'proposal');
    assert.equal(p.installed, false);
    assert.equal(p.interceptsNativeTools, false);
    const hook = p.fragment.hooks.PreToolUse[0];
    assert.equal(hook.matcher, 'Edit|Write|MultiEdit|NotebookEdit');
    // The emitted command must remap every non-zero gate exit to 2 —
    // Claude Code treats only exit 2 as blocking (fail-closed P0 fix).
    assert.match(hook.hooks[0].command,
      /task gate .* - edit; s=\$\?; \[ "\$s" -eq 0 \] \|\| exit 2$/);
    assert.equal(p.mergeTarget, '.claude/settings.json');
    assert.equal(p.exitContract[2], 'deny');
  } finally { cleanup(dir); }
});

test('host gate opencode/codex proposals are declarative, never wired', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const oc = gateProposal(ctx, { host: 'opencode' });
    assert.equal(oc.status, 'proposal');
    assert.equal(oc.fragment.permission.edit, 'ask');
    assert.match(oc.note, /does not call `task gate`/);
    const cx = gateProposal(ctx, { host: 'codex' });
    assert.match(cx.fragment, /approval_policy = "on-request"/);
  } finally { cleanup(dir); }
});

test('host gate without a verified surface reports documented-only', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    for (const host of ['devin', 'antigravity', 'hermes', 'generic']) {
      const p = gateProposal(ctx, { host });
      assert.equal(p.status, 'documented-only', host);
      assert.equal(p.fragment, undefined);
      assert.match(p.reason, /pilot remains required/);
    }
    assert.throws(() => gateProposal(ctx, { host: 'bogus' }),
      (e) => e.code === 'UNKNOWN_HOST');
  } finally { cleanup(dir); }
});
