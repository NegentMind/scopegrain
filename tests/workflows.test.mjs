// SPDX-License-Identifier: Apache-2.0
// Workflow packet cases: resolution, modes, hosts, profiles, read-only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildWorkflowPacket } from '../src/core/workflows.mjs';
import { installBundle, mountBundle } from '../src/core/distribution.mjs';
import { TOKEN_ESTIMATOR } from '../src/core/tokens.mjs';
import { createTask } from '../src/core/tasks.mjs';
import { checkAction, transitionTask } from '../src/core/transition.mjs';
import { checkMethodology } from '../src/core/methodology.mjs';
import { loadLimits } from '../src/core/policy.mjs';
import {
  assessment, formalFixture, lightFixture, reanswer, snapshot,
} from './methodology-fixtures.mjs';
import {
  bootstrappedCtx, cleanup, writeFile, writeJson,
} from './helpers.mjs';

function ctxFixture() {
  const { dir, ctx } = bootstrappedCtx();
  return { dir, ctx };
}

test('command packet resolves declared resources and modes', () => {
  const { dir, ctx } = ctxFixture();
  try {
    const p = buildWorkflowPacket(ctx, { command: 'pipeline' });
    assert.equal(p.command.id, 'pipeline');
    assert.equal(p.command.mode, 'plan'); // first declared mode
    for (const group of ['agents', 'skills', 'rules', 'references']) {
      assert.ok(p.resources[group].length > 0, group);
      for (const r of p.resources[group]) {
        assert.ok(!r.path.startsWith('templates/'),
          'paths are generated config-relative');
        assert.ok(typeof r.content === 'string' && r.content.length > 0);
      }
    }
    assert.equal(p.capabilities.executesProjectCommands, false);
    assert.equal(p.capabilities.executesAgent, false);
    assert.equal(p.task, null);
    assert.deepEqual(p.methodology, {
      mode: 'manual', available: true, taskCheck: null,
      authenticatesEvidence: false, interceptsNativeTools: false,
    });
  } finally { cleanup(dir); }
});

test('one shared ACT evaluation supplies workflow envelope AND actions, without second approval lookup', (t) => {
  const f = formalFixture({ full: true });
  try {
    transitionTask(f.ctx, { id: f.task.id, to: 'ACT', expectedRevision: 0 });
    const approvalFile = path.resolve(f.approvals.task.file.abs);
    const realOpen = fs.openSync;
    let reads = 0;
    t.mock.method(fs, 'openSync', (file, flags, ...rest) => {
      if (flags === 'r' && path.resolve(String(file)) === approvalFile) reads += 1;
      return realOpen(file, flags, ...rest);
    });
    const p = buildWorkflowPacket(f.ctx, {
      command: 'pipeline', mode: 'task', taskId: f.task.id,
    });
    assert.equal(reads, 1);
    assert.equal(p.methodology.taskCheck.allowed, true);
    assert.ok(p.allowedActions.includes('edit'));
    reads = 0;
    assert.equal(checkAction(f.ctx, f.task.id, 'edit').allowed, true);
    assert.equal(reads, 1);
  } finally { t.mock.restoreAll(); cleanup(f.dir); }
});

test('no-task envelope uses selected mode; existing complete packet document cap remains enforced', () => {
  const f = ctxFixture();
  try {
    for (const mode of ['organic-sdd', 'sdd']) {
      f.ctx.config.methodology = mode;
      const p = buildWorkflowPacket(f.ctx, { command: 'status' });
      assert.equal(p.methodology.mode, mode);
      assert.equal(p.methodology.taskCheck, null);
      assert.equal(p.allowedActions, null);
    }
    f.ctx.config.methodology = 'manual';
    const base = buildWorkflowPacket(f.ctx, { command: 'pipeline', mode: 'task' });
    const limit = loadLimits().maxDocumentBytes;
    // Fits as a task document, but task + unchanged resource content exceeds
    // the packet cap. No policy/manifest/resource mutation is needed.
    const task = createTask(f.ctx, {
      title: 'Bounded large task', authorContext: 'a', scope: [],
      contract: 'x'.repeat(limit - Buffer.byteLength(JSON.stringify(base)) + 1024),
    });
    const before = snapshot(f.dir);
    assert.throws(() => buildWorkflowPacket(f.ctx, {
      command: 'pipeline', mode: 'task', taskId: task.id,
    }), (e) => e.code === 'CONTEXT_TOO_LARGE');
    assert.deepEqual(snapshot(f.dir), before);
  } finally { cleanup(f.dir); }
});

test('revoked approval filters BOTH workflow edit and checkAction', () => {
  const f = formalFixture({ full: true });
  try {
    transitionTask(f.ctx, { id: f.task.id, to: 'ACT', expectedRevision: 0 });
    const opts = { command: 'pipeline', mode: 'task', taskId: f.task.id };
    assert.ok(buildWorkflowPacket(f.ctx, opts).allowedActions.includes('edit'));
    reanswer(f, f.approvals.task, 'revoke');
    const before = snapshot(f.dir);
    const p = buildWorkflowPacket(f.ctx, opts);
    const check = checkAction(f.ctx, f.task.id, 'edit');
    // The checkAction surface is pinned: the five original fields plus
    // the bounded pre-action hook trace (`actionHooks`; `gate` only when
    // the queried action is gated).
    assert.deepEqual(Object.keys(check).sort(),
      ['action', 'actionHooks', 'allowed', 'id', 'permitted', 'state']);
    assert.deepEqual(check.actionHooks, { applied: [], gated: [] });
    assert.equal(check.allowed, false);
    assert.ok(!p.allowedActions.includes('edit'));
    assert.deepEqual(p.allowedActions, check.permitted);
    assert.deepEqual(p.methodology.taskCheck,
      checkMethodology(f.ctx, { taskId: f.task.id }));
    assert.equal(p.methodology.taskCheck.allowed, false);
    assert.equal(p.capabilities.authenticatesEvidence, false);
    assert.equal(p.capabilities.interceptsNativeTools, false);
    assert.equal(p.capabilities.callsModels, false);
    assert.deepEqual(snapshot(f.dir), before);
  } finally { cleanup(f.dir); }
});

test('V2 empty scope permits ACT but removes edit; legacy V1 empty scope keeps edit', () => {
  const f = lightFixture({ scope: [], full: true });
  try {
    transitionTask(f.ctx, { id: f.task.id, to: 'ACT', expectedRevision: 0 });
    const p = buildWorkflowPacket(f.ctx, {
      command: 'pipeline', mode: 'task', taskId: f.task.id,
    });
    assert.equal(p.methodology.taskCheck.allowed, true);
    assert.ok(!p.allowedActions.includes('edit'));
    assert.deepEqual(p.allowedActions, checkAction(f.ctx, f.task.id, 'edit').permitted);
    const old = createTask(f.ctx, {
      title: 'V1', contract: 'C', authorContext: 'a', scope: [],
    });
    transitionTask(f.ctx, { id: old.id, to: 'ACT', expectedRevision: 0 });
    assert.equal(checkAction(f.ctx, old.id, 'edit').allowed, true);
    assert.ok(buildWorkflowPacket(f.ctx, {
      command: 'pipeline', mode: 'task', taskId: old.id,
    }).allowedActions.includes('edit'));
  } finally { cleanup(f.dir); }
});

test('mode/host/profile validation happens before writes', () => {
  const { dir, ctx } = ctxFixture();
  try {
    assert.throws(() => buildWorkflowPacket(ctx, {
      command: 'pipeline', mode: 'nope',
    }), (e) => e.code === 'INVALID_MODE');
    assert.throws(() => buildWorkflowPacket(ctx, {
      command: 'pipeline', mode: 'task', host: 'ghost',
    }), (e) => e.code === 'INVALID_HOST');
    assert.throws(() => buildWorkflowPacket(ctx, {
      command: 'status', profile: 'bogus',
    }), (e) => e.code === 'CATALOG_UNKNOWN_ID');
    assert.throws(() => buildWorkflowPacket(ctx, {
      command: '../etc',
    }), (e) => e.code === 'CATALOG_UNKNOWN_ID'
      || e.code === 'INVALID_PATH');
    const ok = buildWorkflowPacket(ctx, {
      command: 'pipeline', mode: 'task', host: 'claude', profile: 'web',
    });
    assert.equal(ok.profile.id, 'web');
    assert.equal(ok.host, 'claude');
  } finally { cleanup(dir); }
});

test('core profile dependencies always supplement the selected profile', () => {
  const { dir, ctx } = ctxFixture();
  try {
    const core = buildWorkflowPacket(ctx, {
      command: 'status', profile: 'core',
    });
    const web = buildWorkflowPacket(ctx, {
      command: 'status', profile: 'web',
    });
    const coreSkills = new Set(core.resources.skills.map((r) => r.id));
    const webSkills = new Set(web.resources.skills.map((r) => r.id));
    for (const id of coreSkills) {
      assert.ok(webSkills.has(id),
        `core skill ${id} must survive in web packet`);
    }
  } finally { cleanup(dir); }
});

test('workflow packet reports estimated resource cost per bucket', () => {
  const { dir, ctx } = ctxFixture();
  try {
    const p = buildWorkflowPacket(ctx, { command: 'pipeline' });
    assert.equal(p.resourceCost.estimator, TOKEN_ESTIMATOR);
    assert.ok(Number.isInteger(p.resourceCost.total)
      && p.resourceCost.total > 0);
    assert.deepEqual(Object.keys(p.resourceCost.byBucket).sort(),
      ['agents', 'command', 'mcps', 'profile', 'prompts',
        'references', 'rules', 'skills'].sort());
    let sum = 0;
    for (const [bucket, est] of Object.entries(p.resourceCost.byBucket)) {
      assert.ok(Number.isInteger(est.estimatedTokens)
        && est.estimatedTokens >= 0, bucket);
      assert.ok(Number.isInteger(est.bytes) && est.bytes >= 0, bucket);
      sum += est.estimatedTokens;
    }
    assert.equal(sum, p.resourceCost.total);
    // The command bucket measures the post-compose content shipped.
    assert.ok(p.resourceCost.byBucket.command.estimatedTokens > 0);
    assert.equal(p.resourceCost.byBucket.command.bytes,
      Buffer.byteLength(p.command.content.replace(/\r\n/g, '\n'), 'utf8'));
  } finally { cleanup(dir); }
});

test('task context supplies state and allowed actions', () => {
  const { dir, ctx } = ctxFixture();
  try {
    const task = createTask(ctx, {
      title: 'T', contract: 'C', authorContext: 'a', scope: [],
    });
    const p = buildWorkflowPacket(ctx, {
      command: 'pipeline', mode: 'task', taskId: task.id,
    });
    assert.equal(p.task.id, task.id);
    assert.equal(p.task.state, 'PLAN');
    assert.ok(p.allowedActions.includes('read'));
    transitionTask(ctx, { id: task.id, to: 'ACT', expectedRevision: 0 });
    const p2 = buildWorkflowPacket(ctx, {
      command: 'pipeline', mode: 'task', taskId: task.id,
    });
    assert.ok(p2.allowedActions.includes('edit'));
  } finally { cleanup(dir); }
});

test('lazy packet carries the binding index, not bodies', () => {
  const { dir, ctx } = ctxFixture();
  try {
    const eager = buildWorkflowPacket(ctx, { command: 'pipeline' });
    const p = buildWorkflowPacket(ctx, { command: 'pipeline', lazy: true });
    assert.equal(p.lazy, true);
    assert.ok(p.hydrate.mcp === 'scopegrain_catalog_get');
    assert.equal(typeof p.command.content, 'string');
    for (const group of ['agents', 'skills', 'rules', 'references']) {
      for (const r of p.resources[group]) {
        assert.equal(r.content, undefined, `${group}/${r.id} must not inline`);
        assert.equal(typeof r.path, 'string');
      }
    }
    assert.ok(p.resourceCost.total < eager.resourceCost.total);
    assert.equal(eager.lazy, undefined);
  } finally { cleanup(dir); }
});

test('task-declared skills auto-include; unresolvable ids degrade to skipped', () => {
  const { dir, ctx } = ctxFixture();
  try {
    const task = createTask(ctx, {
      title: 'routed', contract: 'C', authorContext: 'a', scope: [],
      skills: ['incremental-implementation', 'bogus-skill-xyz'],
    });
    const p = buildWorkflowPacket(ctx, {
      command: 'pipeline', mode: 'task', taskId: task.id,
    });
    assert.equal(p.taskRouting.taskId, task.id);
    assert.ok(p.taskRouting.included.includes('incremental-implementation'));
    assert.ok(p.taskRouting.skipped.includes('bogus-skill-xyz'));
    assert.ok(p.resources.skills.some(
      (r) => r.id === 'incremental-implementation'));
    const noTask = buildWorkflowPacket(ctx, { command: 'pipeline' });
    assert.equal(noTask.taskRouting, undefined);
  } finally { cleanup(dir); }
});

test('profile-declared mcps gate into the packet bucket', () => {
  const { dir, ctx } = ctxFixture();
  try {
    // core declares mcp/scopegrain — it must supplement any profile.
    const web = buildWorkflowPacket(ctx, {
      command: 'status', profile: 'web',
    });
    const m = web.resources.mcps.find((r) => r.id === 'scopegrain');
    assert.ok(m, 'core-profile mcp must supplement the selected profile');
    assert.equal(typeof m.content, 'string');
    const lazy = buildWorkflowPacket(ctx, { command: 'status', lazy: true });
    const lm = lazy.resources.mcps.find((r) => r.id === 'scopegrain');
    assert.ok(lm && lm.content === undefined && typeof lm.sha256 === 'string');
  } finally { cleanup(dir); }
});

test('mounted bundle resources mark packet.deep and entry.bundle', () => {
  const { dir, ctx } = ctxFixture();
  try {
    const body = '---\nmodes:\n  - default\n---\ndeep body';
    fs.mkdirSync(path.join(dir, 'pack'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'pack/cmd.md'), body);
    const sha = crypto.createHash('sha256').update(body).digest('hex');
    writeJson(dir, 'cats/pack-cat.json', {
      entries: [{ id: 'entry-deep', kind: 'command', modes: ['default'],
        source: { uri: 'file://pack/cmd.md' } }],
    });
    installBundle(ctx, { id: 'deeppkg', version: '1.0.0',
      requires: [{ id: 'entry-deep', sha256: sha }] },
      [{ uri: 'file://cats/pack-cat.json' }], { apply: true });
    mountBundle(ctx, 'deeppkg');
    const p = buildWorkflowPacket(ctx, { command: 'entry-deep', lazy: true });
    assert.equal(p.deep.available, true);
    assert.equal(p.deep.mounted, 1);
    assert.deepEqual(p.deep.bundles, ['deeppkg']);
    assert.equal(p.deep.path, 'bundles/');
    // Hydration path points inside the confined bundle dir.
    assert.equal(p.command.path, 'bundles/deeppkg/entry-deep');
    // deep is workspace-scoped: any packet sees the mounted layer.
    const other = buildWorkflowPacket(ctx, { command: 'status' });
    assert.equal(other.deep.available, true);
    assert.deepEqual(other.deep.bundles, ['deeppkg']);
  } finally { cleanup(dir); }
});

// Seeds a rule file plus its catalog.json entry into the workspace
// snapshot and wires it into a command's rules deps (rehash declared).
function seedRuleInSnapshot(ctx, { id, fm, depOf = 'implement-task' }) {
  const dir = ctx.configDir === '.' ? ctx.projectRoot
    : path.join(ctx.projectRoot, ctx.configDir);
  const body = `${fm}# ${id}\n`;
  writeFile(dir, `rules/${id}.md`, body);
  const catPath = path.join(dir, 'catalog.json');
  const cat = JSON.parse(fs.readFileSync(catPath, 'utf8'));
  cat.entries.push({ kind: 'rule', id, path: `rules/${id}.md`,
    description: 'seeded', sha256: crypto.createHash('sha256')
      .update(body).digest('hex') });
  cat.entries.find((e) => e.kind === 'command' && e.id === depOf)
    .rules.push(id);
  fs.writeFileSync(catPath, JSON.stringify(cat, null, 2));
}

test('task packet filters rules by activation.globs vs task.scope', () => {
  const f = lightFixture({ scope: ['src/feature/app.ts'], full: true });
  try {
    seedRuleInSnapshot(f.ctx, { id: 'scoped-ts',
      fm: '---\nactivation.globs: src/**/*.ts\n---\n' });
    // Matching scope keeps the rule; trace records no drop.
    const p = buildWorkflowPacket(f.ctx,
      { command: 'pipeline', mode: 'task', taskId: f.task.id });
    assert.ok(p.resources.rules.some((r) => r.id === 'scoped-ts'));
    assert.ok(!p.rulesFiltered.some((r) => r.id === 'scoped-ts'));
    // Non-matching scope drops it — declared, never silent.
    const docs = createTask(f.ctx, { title: 'Docs', contract: 'C',
      authorContext: 'fixture-author', scope: ['docs/guide.md'],
      methodology: assessment() });
    const p2 = buildWorkflowPacket(f.ctx,
      { command: 'pipeline', mode: 'task', taskId: docs.id });
    assert.ok(!p2.resources.rules.some((r) => r.id === 'scoped-ts'));
    const drop = p2.rulesFiltered.find((r) => r.id === 'scoped-ts');
    assert.equal(drop.reason,
      'activation.globs does not match task.scope');
    // Transversal (no-activation) canonical rules are never dropped.
    assert.ok(p2.resources.rules.length > 0);
    // Empty scope fails closed for glob-scoped rules.
    const empty = createTask(f.ctx, { title: 'NoScope', contract: 'C',
      authorContext: 'fixture-author', scope: [],
      methodology: assessment() });
    const p3 = buildWorkflowPacket(f.ctx,
      { command: 'pipeline', mode: 'task', taskId: empty.id });
    assert.ok(!p3.resources.rules.some((r) => r.id === 'scoped-ts'));
    assert.ok(p3.rulesFiltered.some((r) => r.id === 'scoped-ts'));
  } finally { cleanup(f.dir); }
});

test('without taskId: status filters always, globs never evaluate', () => {
  const { dir, ctx } = ctxFixture();
  try {
    seedRuleInSnapshot(ctx, { id: 'proposed-rule',
      fm: '---\nstatus: proposed\nactivation.globs: never/**\n---\n' });
    seedRuleInSnapshot(ctx, { id: 'archived-rule',
      fm: '---\nstatus: archived\n---\n' });
    const p = buildWorkflowPacket(ctx, { command: 'implement-task' });
    for (const id of ['proposed-rule', 'archived-rule']) {
      assert.ok(!p.resources.rules.some((r) => r.id === id), id);
    }
    const drop = p.rulesFiltered.find((r) => r.id === 'proposed-rule');
    assert.equal(drop.reason, "status 'proposed'");
    const dropA = p.rulesFiltered.find((r) => r.id === 'archived-rule');
    assert.equal(dropA.reason, "status 'archived'");
    // An ACTIVE glob-scoped rule is included: no task bound means no
    // scope to filter against — every declared rule ships.
    seedRuleInSnapshot(ctx, { id: 'active-glob',
      fm: '---\nactivation.globs: nothing-matches/**\n---\n' });
    const p2 = buildWorkflowPacket(ctx, { command: 'implement-task' });
    assert.ok(p2.resources.rules.some((r) => r.id === 'active-glob'));
    assert.ok(!p2.rulesFiltered.some((r) => r.id === 'active-glob'));
    // Lazy packets go through the same gate.
    const lz = buildWorkflowPacket(ctx,
      { command: 'implement-task', lazy: true });
    assert.ok(lz.resources.rules.some((r) => r.id === 'active-glob'));
    assert.ok(lz.rulesFiltered.some((r) => r.id === 'proposed-rule'));
  } finally { cleanup(dir); }
});
