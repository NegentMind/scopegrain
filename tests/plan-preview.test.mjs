// SPDX-License-Identifier: Apache-2.0
// plan preview: the pre-execution x-ray — readiness, wave schedule,
// ordering risks and aggregate token estimate over a stored plan.
// Strictly read-only: nothing under the state paths may be written.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { applyPlan, preflightPlan } from '../src/core/bootstrap.mjs';
import { createConfig } from '../src/core/config.mjs';
import { resolveContext } from '../src/core/context.mjs';
import { preparePlan, previewPlan } from '../src/core/plans.mjs';
import { getTask } from '../src/core/tasks.mjs';
import { updateTaskMeta } from '../src/core/transition.mjs';
import { TOKEN_ESTIMATOR } from '../src/core/tokens.mjs';
import {
  VALID_ANSWERS, cleanup, fakeIO, makeTempDir, writeJson,
} from './helpers.mjs';

function ctxFixture() {
  const dir = makeTempDir('plan-preview');
  writeJson(dir, '.scopegrain/config.json',
    createConfig(dir, VALID_ANSWERS, {}));
  return { dir, ctx: resolveContext({ project: dir }) };
}

const PLAN = {
  key: 'preview-1', title: 'Preview fixture', authorContext: 'ctx',
  // V3 layer: only V3 member descriptors carry triage — a V1 member
  // input triage field is validated then dropped from plan.tasks.
  // Declaring any V3 key makes the whole V3 field set mandatory.
  appetite: 'days', cynefin: 'complicated',
  premortem: 'the DAG hid a cycle',
  stopConditions: ['owner stops the run'],
  budget: { turns: 10, notes: 'fixture' },
  riskRegister: [{ risk: 'overlap', likelihood: 'low', impact: 'low',
    mitigation: 'serial waves' }],
  triage: { d: { decision: 'defer', reason: 'later' } },
  tasks: [
    { key: 'a', title: 'A', contract: 'c', scope: ['src/x'],
      dependsOn: [] },
    { key: 'b', title: 'B', contract: 'c', scope: ['src/x/sub'],
      dependsOn: [] },
    { key: 'c', title: 'C', contract: 'c', scope: ['src/y'],
      dependsOn: ['d'] },
    { key: 'd', title: 'D', contract: 'c', scope: ['src/z'],
      dependsOn: [], triage: 'defer', triageReason: 'later' },
  ],
};

function storedPlan(dir, ctx) {
  const prepared = preparePlan(ctx, PLAN);
  applyPlan(dir, preflightPlan(dir, prepared.files));
}

test('plan preview: readiness, waves, risks and estimate — no writes', () => {
  const { dir, ctx } = ctxFixture();
  try {
    storedPlan(dir, ctx);
    const runsAbs = path.join(dir, ctx.config.paths.state, 'plan-runs');
    assert.equal(fs.existsSync(runsAbs), false);

    const out = previewPlan(ctx, 'preview-1');
    assert.equal(out.schemaVersion, 1);
    assert.equal(out.mode, 'preview');
    assert.equal(out.plan.key, 'preview-1');
    assert.deepEqual(out.readiness.ready, ['a', 'b']);
    assert.deepEqual(out.readiness.blocked,
      [{ key: 'c', blockedBy: ['d'] }]);
    assert.deepEqual(out.readiness.triaged,
      [{ key: 'd', triage: 'defer', reason: 'later' }]);
    // a and b share wave 0 (parallel); c schedules despite the triaged
    // dep — the risk layer reports it instead of hiding it.
    assert.equal(out.waves.length, 1);
    assert.equal(out.waves[0].parallel, true);
    assert.deepEqual(out.unscheduled, []);

    const kinds = out.orderingRisks.map((r) => r.kind).sort();
    assert.deepEqual(kinds, ['scope-overlap', 'triage-block']);
    assert.deepEqual(out.orderingRisks
      .find((r) => r.kind === 'scope-overlap').members, ['a', 'b']);
    assert.equal(out.orderingRisks
      .find((r) => r.kind === 'triage-block').member, 'c');

    assert.equal(out.tokenEstimate.estimator, TOKEN_ESTIMATOR);
    assert.equal(out.tokenEstimate.members.length, 4);
    const sum = out.tokenEstimate.members
      .reduce((acc, m) => acc + m.estimatedTokens, 0);
    assert.equal(out.tokenEstimate.total,
      out.tokenEstimate.plan + sum);

    assert.equal(fs.existsSync(runsAbs), false);
  } finally {
    cleanup(dir);
  }
});

test('plan preview: deterministic and no risks on a clean chain', () => {
  const { dir, ctx } = ctxFixture();
  try {
    const prepared = preparePlan(ctx, {
      key: 'chain', title: 'Chain', authorContext: 'ctx',
      tasks: [
        { key: 'one', title: 'One', contract: 'c', scope: ['src/a'],
          dependsOn: [] },
        { key: 'two', title: 'Two', contract: 'c', scope: ['src/b'],
          dependsOn: ['one'] },
      ],
    });
    applyPlan(dir, preflightPlan(dir, prepared.files));
    const a = previewPlan(ctx, 'chain');
    const b = previewPlan(ctx, 'chain');
    assert.deepEqual(a, b);
    assert.deepEqual(a.orderingRisks, []);
    assert.equal(a.waves.length, 2);
    assert.deepEqual(a.readiness.ready, ['one']);
    assert.deepEqual(a.readiness.blocked,
      [{ key: 'two', blockedBy: ['one'] }]);
  } finally {
    cleanup(dir);
  }
});

test('plan preview: explicit triage null is not a triage-block', () => {
  const { dir, ctx } = ctxFixture();
  try {
    // V3 plan: members without a triage decision carry `triage: null`
    // on their descriptor — they must not count as triaged blockers.
    const prepared = preparePlan(ctx, {
      key: 'nulltriage', title: 'Null triage', authorContext: 'ctx',
      appetite: 'days', cynefin: 'complicated',
      premortem: 'm', stopConditions: ['s'],
      budget: { turns: 5, notes: 'n' },
      riskRegister: [{ risk: 'r' }],
      triage: null,
      tasks: [
        { key: 'lead', title: 'Lead', contract: 'c', scope: ['src/a'],
          dependsOn: [] },
        { key: 'dep', title: 'Dep', contract: 'c', scope: ['src/b'],
          dependsOn: ['lead'] },
      ],
    });
    applyPlan(dir, preflightPlan(dir, prepared.files));
    const out = previewPlan(ctx, 'nulltriage');
    assert.deepEqual(out.orderingRisks, []);
  } finally {
    cleanup(dir);
  }
});

test('plan preview: unreadable member degrades readiness and waves', () => {
  const { dir, ctx } = ctxFixture();
  try {
    const prepared = preparePlan(ctx, {
      key: 'broken', title: 'Broken', authorContext: 'ctx',
      tasks: [
        { key: 'ok', title: 'Ok', contract: 'c', scope: ['src/a'],
          dependsOn: [] },
        { key: 'gone', title: 'Gone', contract: 'c', scope: ['src/b'],
          dependsOn: [] },
      ],
    });
    applyPlan(dir, preflightPlan(dir, prepared.files));
    const planJson = JSON.parse(fs.readFileSync(path.join(
      dir, ctx.config.paths.plans, 'broken.json'), 'utf8'));
    const gone = planJson.tasks.find((t) => t.key === 'gone');
    fs.rmSync(path.join(dir, ctx.config.paths.tasks,
      `${gone.id.toLowerCase()}.json`));

    const out = previewPlan(ctx, 'broken');
    assert.equal(out.mode, 'preview');
    // Contract: degrade, not throw — nextPlanTasks/planWaves cannot
    // schedule members whose records failed to read.
    const unreadable = out.orderingRisks
      .find((r) => r.kind === 'unreadable');
    assert.equal(unreadable.member, 'gone');
    assert.equal(out.readiness.degraded, true);
    assert.equal(out.waves, null);
    assert.equal(out.unscheduled, null);
    const member = out.tokenEstimate.members
      .find((m) => m.key === 'gone');
    assert.equal(member.estimatedTokens, null);
  } finally {
    cleanup(dir);
  }
});

test('plan preview: dropped member still scheduled is flagged', () => {
  const { dir, ctx } = ctxFixture();
  try {
    const prepared = preparePlan(ctx, {
      key: 'dropped', title: 'Dropped', authorContext: 'ctx',
      tasks: [
        { key: 'keep', title: 'Keep', contract: 'c', scope: ['src/a'],
          dependsOn: [] },
        { key: 'dead', title: 'Dead', contract: 'c', scope: ['src/b'],
          dependsOn: [] },
      ],
    });
    applyPlan(dir, preflightPlan(dir, prepared.files));
    const planJson = JSON.parse(fs.readFileSync(path.join(
      dir, ctx.config.paths.plans, 'dropped.json'), 'utf8'));
    const dead = planJson.tasks.find((t) => t.key === 'dead');
    const rec = getTask(ctx, dead.id);
    updateTaskMeta(ctx, { id: dead.id, expectedRevision: rec.revision,
      disposition: { kind: 'discarded', reason: 'superseded',
        by: 'owner' } });

    const out = previewPlan(ctx, 'dropped');
    // nextPlanTasks/planWaves ignore dispositions: the dropped member
    // is still counted ready and scheduled — the risk surfaces the
    // contradiction instead of hiding it.
    assert.deepEqual(out.readiness.ready.sort(), ['dead', 'keep']);
    const risk = out.orderingRisks
      .find((r) => r.kind === 'dropped-scheduled');
    assert.equal(risk.member, 'dead');
    assert.equal(risk.disposition, 'discarded');
  } finally {
    cleanup(dir);
  }
});

test('plan preview: triage-block propagates transitively', () => {
  const { dir, ctx } = ctxFixture();
  try {
    const prepared = preparePlan(ctx, {
      key: 'transitive', title: 'Transitive', authorContext: 'ctx',
      appetite: 'days', cynefin: 'complicated',
      premortem: 'm', stopConditions: ['s'],
      budget: { turns: 5, notes: 'n' },
      riskRegister: [{ risk: 'r' }],
      triage: { t: { decision: 'defer', reason: 'later' } },
      tasks: [
        { key: 't', title: 'T', contract: 'c', scope: ['src/t'],
          dependsOn: [], triage: 'defer', triageReason: 'later' },
        { key: 'mid', title: 'Mid', contract: 'c', scope: ['src/m'],
          dependsOn: ['t'] },
        { key: 'leaf', title: 'Leaf', contract: 'c', scope: ['src/l'],
          dependsOn: ['mid'] },
      ],
    });
    applyPlan(dir, preflightPlan(dir, prepared.files));
    const out = previewPlan(ctx, 'transitive');
    // leaf never names t directly — its block is inherited through
    // mid; the risk must still name the triaged ancestor.
    const hits = out.orderingRisks
      .filter((r) => r.kind === 'triage-block')
      .map((r) => r.member).sort();
    assert.deepEqual(hits, ['leaf', 'mid']);
    assert.ok(out.orderingRisks.every((r) => r.kind !== 'triage-block'
      || r.blockers.includes('t')));
  } finally {
    cleanup(dir);
  }
});

test('plan preview CLI: read-only end to end', async () => {
  const { dir } = ctxFixture();
  try {
    const ctx = resolveContext({ project: dir });
    storedPlan(dir, ctx);
    const { run } = await import('../src/cli.mjs');
    const io = fakeIO();
    const code = await run(
      ['plan', 'preview', 'preview-1', '--project', dir], io);
    assert.equal(code, 0, io.out.stderr.join(''));
    const out = JSON.parse(io.out.stdout.join(''));
    assert.equal(out.mode, 'preview');
    assert.equal(out.tokenEstimate.estimator, TOKEN_ESTIMATOR);
    const runsAbs = path.join(
      dir, ctx.config.paths.state, 'plan-runs');
    assert.equal(fs.existsSync(runsAbs), false);
  } finally {
    cleanup(dir);
  }
});
