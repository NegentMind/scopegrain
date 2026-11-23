// SPDX-License-Identifier: Apache-2.0
// task doc rendering, plan run wave scheduling, session-start context.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { applyPlan, preflightPlan } from '../src/core/bootstrap.mjs';
import { createConfig } from '../src/core/config.mjs';
import { resolveContext } from '../src/core/context.mjs';
import {
  getPlan, planRunState, planWaves, preparePlan, recordPlanRun,
} from '../src/core/plans.mjs';
import { transitionTask } from '../src/core/transition.mjs';
import { renderTaskDoc, writeTaskDoc } from '../src/core/taskdoc.mjs';
import { getTask } from '../src/core/tasks.mjs';
import { prepareWorkspace } from '../src/core/workspaces.mjs';
import { run } from '../src/cli.mjs';
import { VALID_ANSWERS, cleanup, fakeIO, makeTempDir, writeJson }
  from './helpers.mjs';

const PLAN = {
  key: 'rel-2', title: 'Release 2', authorContext: 'ctx',
  triage: { d: { decision: 'defer', reason: 'later' } },
  appetite: null, cynefin: null, riskRegister: null, premortem: null,
  stopConditions: null, budget: null,
  tasks: [
    { key: 'a', title: 'A', contract: 'c', scope: [], dependsOn: [] },
    { key: 'b', title: 'B', contract: 'c', scope: [], dependsOn: [] },
    { key: 'c', title: 'C', contract: 'c', scope: [], dependsOn: ['a', 'b'] },
    { key: 'd', title: 'D', contract: 'c', scope: [], dependsOn: ['c'],
      triage: 'defer', triageReason: 'later' },
  ],
};

function fixture() {
  const dir = makeTempDir('tpr');
  writeJson(dir, '.tasksystem/config.json',
    createConfig(dir, VALID_ANSWERS, {}));
  const ctx = resolveContext({ project: dir });
  const ws = prepareWorkspace(ctx, { areas: [{ key: 'p', name: 'P' }] });
  applyPlan(dir, [ws.file]);
  const prepared = preparePlan(ctx, PLAN);
  applyPlan(dir, preflightPlan(dir, prepared.files));
  return { dir, ctx };
}

test('renderTaskDoc covers contract, deps, steps and history sections', () => {
  const { dir, ctx } = fixture();
  try {
    const id = getPlan(ctx, 'rel-2').tasks.find((t) => t.key === 'a').id;
    const task = getTask(ctx, id);
    const md = renderTaskDoc(task);
    assert.match(md, /# A/);
    assert.match(md, /## Contract/);
    assert.match(md, /## History/);
    assert.match(md, /state: PLAN/);
  } finally { cleanup(dir); }
});

test('writeTaskDoc is idempotent: second call reports unchanged', () => {
  const { dir, ctx } = fixture();
  try {
    const id = getPlan(ctx, 'rel-2').tasks.find((t) => t.key === 'a').id;
    const first = writeTaskDoc(ctx, id);
    assert.equal(first.changed, true);
    assert.ok(fs.existsSync(first.path));
    const second = writeTaskDoc(ctx, id);
    assert.equal(second.changed, false);
  } finally { cleanup(dir); }
});

test('planWaves schedules dependency-respecting parallel waves', () => {
  const { dir, ctx } = fixture();
  try {
    const runPlan = planWaves(ctx, 'rel-2');
    assert.equal(runPlan.waves.length, 2);
    assert.deepEqual(runPlan.waves[0].tasks.map((t) => t.key).sort(),
      ['a', 'b']);
    assert.equal(runPlan.waves[0].parallel, true);
    assert.deepEqual(runPlan.waves[1].tasks.map((t) => t.key), ['c']);
    assert.equal(runPlan.waves[1].parallel, false);
    assert.deepEqual(runPlan.triaged.map((t) => t.key), ['d']);
    assert.equal(runPlan.unscheduled.length, 0);
  } finally { cleanup(dir); }
});

test('context assembles the session-start packet read-only', async () => {
  const { dir } = fixture();
  try {
    const io = fakeIO();
    const code = await run(['context', '--project', dir], io);
    assert.equal(code, 0);
    const out = JSON.parse(io.out.stdout.at(-1));
    assert.match(out.instructions, /instructions\.md$/);
    assert.equal(out.tasks.total, 4);
    assert.equal(out.tasks.open, 4);
    assert.ok(Array.isArray(out.tasks.ready));
    assert.equal(typeof out.progress.truncated, 'boolean');
    assert.ok(Array.isArray(out.progress.entries));
    assert.ok(Array.isArray(out.goals));
  } finally { cleanup(dir); }
});

test('plan run preview writes nothing; --apply persists checkpoints and tracks resume progress', async () => {
  const { dir, ctx } = fixture();
  try {
    const preview = recordPlanRun(ctx, 'rel-2');
    assert.equal(preview.mode, 'preview');
    assert.equal(preview.persisted, false);
    assert.equal(preview.run, null);
    assert.equal(preview.resume.remainingWaves, 2);
    assert.ok(!fs.existsSync(path.join(dir, preview.path)));

    const first = recordPlanRun(ctx, 'rel-2', { apply: true });
    assert.equal(first.mode, 'applied');
    assert.equal(first.persisted, true);
    assert.equal(first.run.revision, 0);
    assert.equal(first.run.checkpoints.length, 1);
    assert.equal(first.resume.completedTasks, 0);
    assert.ok(fs.existsSync(path.join(dir, first.path)));

    // Close task 'a' through the legal lifecycle and check resume delta.
    const plan = getPlan(ctx, 'rel-2');
    const aId = plan.tasks.find((t) => t.key === 'a').id;
    let rev = 0;
    for (const st of ['ACT', 'VERIFY', 'EVALUATE', 'REVIEW']) {
      rev = transitionTask(ctx, { id: aId, to: st, expectedRevision: rev }).revision;
    }
    rev = transitionTask(ctx, {
      id: aId,
      to: 'REVIEW',
      expectedRevision: rev,
      verification: {
        checks: [{ command: 'test', cwd: '.', status: 'pass', evidence: 'ok' }],
      },
      review: {
        mode: 'fresh', reviewer: 'r', authorContext: 'ctx',
        reviewerContext: 'other', verdict: 'approve',
      },
    }).revision;
    rev = transitionTask(ctx, { id: aId, to: 'ACCEPT', expectedRevision: rev }).revision;
    transitionTask(ctx, { id: aId, to: 'CLOSE', expectedRevision: rev });

    const beforeSecond = planRunState(ctx, 'rel-2');
    assert.equal(beforeSecond.persisted, true);
    assert.deepEqual(beforeSecond.resume.completedSinceLastCheckpoint, ['a']);
    assert.equal(beforeSecond.resume.completedTasks, 1);

    // CLI plan run --apply persists checkpoint #2.
    const io = fakeIO();
    assert.equal(await run(['plan', 'run', '--project', dir, 'rel-2', '--apply'], io), 0);
    const out = JSON.parse(io.out.stdout.at(-1));
    assert.equal(out.mode, 'applied');
    assert.equal(out.run.revision, 1);
    assert.equal(out.run.checkpoints.length, 2);
    assert.deepEqual(out.closed, ['a']);

    // Tampered run record fails closed with PLAN_RUN_MALFORMED.
    fs.writeFileSync(path.join(dir, first.path), '{corrupt');
    assert.throws(() => planRunState(ctx, 'rel-2'), { code: 'PLAN_RUN_MALFORMED' });
  } finally { cleanup(dir); }
});
