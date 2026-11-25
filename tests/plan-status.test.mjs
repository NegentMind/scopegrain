// SPDX-License-Identifier: Apache-2.0
// Derived plan status: pure taxonomy over member states + the CLI/API
// view (counts histogram, activeTasks, percent). Nothing persisted.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  derivePlanStatus, planStatus, preparePlan,
} from '../src/core/plans.mjs';
import { applyPlan } from '../src/core/bootstrap.mjs';
import { getTask } from '../src/core/tasks.mjs';
import { transitionTask, updateTaskMeta } from '../src/core/transition.mjs';
import { seedState } from './methodology-fixtures.mjs';
import { bootstrappedMiniCtx, cleanup } from './helpers.mjs';

const m = (state, disp = null) => ({ state, disposition: disp });
const PLAN_V3 = { triage: null, appetite: null, cynefin: 'clear',
  riskRegister: null, premortem: null, stopConditions: null, budget: null };

test('derivePlanStatus: precedence failed>blocked>active>partial>draft', () => {
  assert.equal(derivePlanStatus([]), 'empty');
  assert.equal(derivePlanStatus([m('PLAN'), m('PLAN')]), 'draft');
  assert.equal(derivePlanStatus([m('CLOSE'), m('PLAN')]), 'partial');
  assert.equal(derivePlanStatus([m('CLOSE'), m('ACT')]), 'active');
  assert.equal(derivePlanStatus([m('RESEARCH')]), 'active');
  assert.equal(derivePlanStatus([m('STALL'), m('ACT')]), 'blocked');
  assert.equal(derivePlanStatus([m('ABANDON'), m('CLOSE')]), 'failed');
  assert.equal(derivePlanStatus([m('ABANDON'), m('ACT')]), 'failed');
  assert.equal(derivePlanStatus([m('CLOSE'), m('CLOSE')]), 'completed');
  // Terminal dispositions count as done
  assert.equal(derivePlanStatus([m('CLOSE'), m('ACT', { kind: 'cancelled' })]),
    'completed');
});

test('planStatus: derived view over a real plan', () => {
  const f = bootstrappedMiniCtx();
  try {
    const plan = preparePlan(f.ctx, { key: 'st-plan', title: 'P',
      authorContext: 'fixture-author', ...PLAN_V3,
      tasks: [
        { key: 'a', title: 'A', contract: 'C', scope: ['src/a'],
          dependsOn: [] },
        { key: 'b', title: 'B', contract: 'C', scope: ['src/b'],
          dependsOn: ['a'] },
        { key: 'c', title: 'C', contract: 'C', scope: ['src/c'],
          dependsOn: ['b'] },
      ] });
    applyPlan(f.dir, plan.files);
    const st0 = planStatus(f.ctx, 'st-plan');
    assert.equal(st0.status, 'draft');
    assert.equal(st0.percent, 0);
    assert.deepEqual(st0.counts, { PLAN: 3 });
    assert.deepEqual(st0.activeTasks, []);

    const [a, b, c] = plan.plan.tasks.map((t) => t.id);
    transitionTask(f.ctx, { id: a, to: 'ACT', expectedRevision: 0 });
    const st1 = planStatus(f.ctx, 'st-plan');
    assert.equal(st1.status, 'active');
    assert.deepEqual(st1.activeTasks.map((t) => t.key), ['a']);
    assert.deepEqual(st1.counts, { ACT: 1, PLAN: 2 });

    // Close A, stall B -> blocked (STALL outranks partial); seed states
    // directly — the lifecycle would demand evidence per transition.
    seedState(f, getTask(f.ctx, a), 'CLOSE', null);
    seedState(f, getTask(f.ctx, b), 'STALL', null);
    const st2 = planStatus(f.ctx, 'st-plan');
    assert.equal(st2.status, 'blocked');
    assert.equal(st2.percent, 33);
    assert.deepEqual(st2.counts, { CLOSE: 1, STALL: 1, PLAN: 1 });

    // Abandon C -> failed regardless of progress
    seedState(f, getTask(f.ctx, c), 'ABANDON', null);
    const st3 = planStatus(f.ctx, 'st-plan');
    assert.equal(st3.status, 'failed');
    assert.deepEqual(st3.counts, { CLOSE: 1, STALL: 1, ABANDON: 1 });

    // Disposition-dropped counts as done + its own bucket
    updateTaskMeta(f.ctx, { id: b,
      expectedRevision: getTask(f.ctx, b).revision,
      disposition: { kind: 'cancelled', reason: 'descoped' } });
    const st4 = planStatus(f.ctx, 'st-plan');
    assert.equal(st4.status, 'failed'); // ABANDON still dominates
    assert.equal(st4.counts.dropped, 1);
  } finally { cleanup(f.dir); }
});
