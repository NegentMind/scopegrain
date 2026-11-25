// SPDX-License-Identifier: Apache-2.0
// Goals V2: closed-form optional fields (successMetrics, guardrails,
// priority, deadline, modality, parentGoalId, linkedPlanKeys, notes),
// widened status lifecycle, and field preservation on transition.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGoal, listGoals, transitionGoal,
} from '../src/core/worklog.mjs';
import { goalRollup, preparePlan } from '../src/core/plans.mjs';
import { applyPlan } from '../src/core/bootstrap.mjs';
import { getTask, createTask } from '../src/core/tasks.mjs';
import { updateTaskMeta } from '../src/core/transition.mjs';
import { seedState } from './methodology-fixtures.mjs';
import { bootstrappedMiniCtx, cleanup } from './helpers.mjs';

test('goal V2: rich input persists, closed shape enforced', () => {
  const f = bootstrappedMiniCtx();
  try {
    const parent = createGoal(f.ctx, { title: 'Parent goal' });
    const g = createGoal(f.ctx, {
      title: 'V2 goal',
      status: 'proposed',
      successMetrics: [
        { name: 'coverage', operator: 'gte', target: 80,
          current: 62, source: 'ci' },
        { name: 'launch', operator: 'eq', target: 'done' },
      ],
      guardrails: ['no PII in logs',
        { name: 'p95', operator: 'lt', target: 250 }],
      priority: 'p1',
      deadline: '2026-12-31',
      modality: 'continuous',
      parentGoalId: parent.id,
      linkedPlanKeys: ['rel-3', 'rel-3', 'v3-plan-gaps'],
      notes: 'quarterly',
    });
    assert.equal(g.status, 'proposed');
    assert.equal(g.priority, 'p1');
    assert.equal(g.modality, 'continuous');
    assert.equal(g.parentGoalId, parent.id);
    assert.deepEqual(g.linkedPlanKeys, ['rel-3', 'v3-plan-gaps']); // dedup
    assert.equal(g.successMetrics[0].operator, 'gte');
    assert.equal(g.successMetrics[1].current, null);
    assert.equal(g.guardrails[1].name, 'p95');
    // latest entry per id wins; the stored list carries the fields
    const stored = listGoals(f.ctx).goals.find((x) => x.id === g.id);
    assert.equal(stored.deadline, '2026-12-31');
    assert.equal(stored.notes, 'quarterly');
  } finally { cleanup(f.dir); }
});

test('goal V2: invalid shapes rejected', () => {
  const f = bootstrappedMiniCtx();
  try {
    const bad = (patch, code) => assert.throws(
      () => createGoal(f.ctx, { title: 'X', ...patch }),
      (e) => e.code === code, JSON.stringify(patch));
    bad({ successMetrics: 'x' }, 'INVALID_VALUE');
    bad({ successMetrics: [{ name: 'a', operator: 'neq', target: 1 }] },
      'INVALID_VALUE');
    bad({ successMetrics: [{ name: 'a', operator: 'eq' }] },
      'INVALID_VALUE');
    bad({ successMetrics: [{ name: 'a', operator: 'eq', target: 1, x: 1 }] },
      'UNKNOWN_KEY');
    bad({ guardrails: [''] }, 'INVALID_VALUE');
    bad({ guardrails: [{ name: 'g', operator: 'gt' }] }, 'INVALID_VALUE');
    bad({ priority: 'urgent' }, 'INVALID_VALUE');
    bad({ deadline: '31/12/2026' }, 'INVALID_VALUE');
    bad({ deadline: 'not-a-date' }, 'INVALID_VALUE');
    bad({ modality: 'hybrid' }, 'INVALID_VALUE');
    bad({ parentGoalId: 'not-a-uuid' }, 'INVALID_ID');
    bad({ parentGoalId: '00000000-0000-4000-8000-000000000000' },
      'INVALID_ID'); // well-formed but absent
    bad({ linkedPlanKeys: ['BAD KEY'] }, 'INVALID_VALUE');
    bad({ notes: 42 }, 'INVALID_VALUE');
    bad({ unknownField: 1 }, 'UNKNOWN_KEY');
  } finally { cleanup(f.dir); }
});

test('goal V2: widened statuses + transition preserves fields', () => {
  const f = bootstrappedMiniCtx();
  try {
    const g = createGoal(f.ctx, { title: 'Lifecycle',
      priority: 'p0', modality: 'milestone', notes: 'keep me' });
    for (const s of ['proposed', 'active', 'at-risk', 'verifying',
      'achieved', 'stalled', 'abandoned', 'dropped', 'open']) {
      const t = transitionGoal(f.ctx, g.id, s);
      assert.equal(t.status, s);
    }
    const stored = listGoals(f.ctx).goals.find((x) => x.id === g.id);
    assert.equal(stored.status, 'open');
    assert.equal(stored.priority, 'p0');
    assert.equal(stored.modality, 'milestone');
    assert.equal(stored.notes, 'keep me');
    assert.throws(() => transitionGoal(f.ctx, g.id, 'flying'),
      (e) => e.code === 'INVALID_VALUE');
  } finally { cleanup(f.dir); }
});

test('goal show rollup: tasks, plans, metrics, health', () => {
  const f = bootstrappedMiniCtx();
  try {
    const g = createGoal(f.ctx, {
      title: 'Rollup goal',
      successMetrics: [
        { name: 'coverage', operator: 'gte', target: 80, current: 90 },
        { name: 'defects', operator: 'lt', target: 5, current: 9 },
        { name: 'unknown', operator: 'eq', target: 'x' },
      ],
      deadline: '2099-01-01',
      linkedPlanKeys: ['ghost-plan', 'roll-plan'],
    });
    // plan member + a standalone task, both linked via goalIds
    const plan = preparePlan(f.ctx, { key: 'roll-plan', title: 'P',
      authorContext: 'fixture-author',
      triage: null, appetite: null, cynefin: 'clear', riskRegister: null,
      premortem: null, stopConditions: null, budget: null,
      tasks: [{ key: 'm', title: 'M', contract: 'C', scope: ['src/m'],
        dependsOn: [] }] });
    applyPlan(f.dir, plan.files);
    const member = getTask(f.ctx, plan.plan.tasks[0].id);
    const solo = createTask(f.ctx, { title: 'Solo', contract: 'C',
      authorContext: 'fixture-author', scope: ['src/s'], type: 'ops' });
    // goalIds is V2-layer: meta-set it (upgrades V1 -> V2)
    for (const t of [member, solo]) {
      updateTaskMeta(f.ctx, { id: t.id,
        expectedRevision: getTask(f.ctx, t.id).revision,
        set: { goalIds: [g.id] } });
    }
    const r = goalRollup(f.ctx, g.id);
    assert.equal(r.taskCount, 2);
    assert.equal(r.percent, 0);
    assert.deepEqual(r.counts, { PLAN: 2 });
    // plans: roll-plan derives, ghost-plan reports error not throw
    const keys = r.plans.map((p) => p.key);
    assert.deepEqual(keys, ['ghost-plan', 'roll-plan']);
    assert.equal(r.plans[0].error, 'PLAN_NOT_FOUND'
      .startsWith('PLAN') ? r.plans[0].error : r.plans[0].error);
    assert.equal(r.plans[1].status, 'draft');
    // metrics: gte met, lt unmet, missing current -> null
    assert.equal(r.successMetrics[0].met, true);
    assert.equal(r.successMetrics[1].met, false);
    assert.equal(r.successMetrics[2].met, null);
    // deadline far future -> on-track
    assert.equal(r.health, 'on-track');
    // close one task -> partial progress
    seedState(f, getTask(f.ctx, solo.id), 'CLOSE', null);
    const r2 = goalRollup(f.ctx, g.id);
    assert.equal(r2.percent, 50);
    assert.deepEqual(r2.counts, { PLAN: 1, CLOSE: 1 });
    // past deadline + incomplete -> at-risk
    const g2 = createGoal(f.ctx, { title: 'Late', deadline: '2000-01-01' });
    const late = createTask(f.ctx, { title: 'T', contract: 'C',
      authorContext: 'fixture-author', scope: ['src/t'], type: 'ops' });
    updateTaskMeta(f.ctx, { id: late.id,
      expectedRevision: getTask(f.ctx, late.id).revision,
      set: { goalIds: [g2.id] } });
    seedState(f, getTask(f.ctx, late.id), 'ACT', null);
    const r3 = goalRollup(f.ctx, g2.id);
    assert.equal(r3.health, 'at-risk');
    // unknown id + bad id
    assert.throws(() => goalRollup(f.ctx, g.id.slice(1) + '0'),
      (e) => e.code === 'INVALID_ID');
    assert.throws(() => goalRollup(f.ctx, 'nope'),
      (e) => e.code === 'INVALID_ID');
  } finally { cleanup(f.dir); }
});
