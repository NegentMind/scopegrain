// SPDX-License-Identifier: Apache-2.0
// Goals V2: closed-form optional fields (successMetrics, guardrails,
// priority, deadline, modality, parentGoalId, linkedPlanKeys, notes),
// widened status lifecycle, and field preservation on transition.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGoal, listGoals, transitionGoal,
} from '../src/core/worklog.mjs';
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
