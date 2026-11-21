// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTask } from '../src/core/tasks.mjs';
import { evaluateConvergence, recordConvergence } from '../src/core/converge.mjs';
import {
  createChecklist, markChecklistItem, checklistFindings, getChecklist,
} from '../src/core/checklists.mjs';
import { analyzeTask } from '../src/core/analyze.mjs';
import { recordClarification, listClarifications } from '../src/core/clarify.mjs';
import { setConstitution, getConstitution } from '../src/core/constitution.mjs';
import { renderStoryTaskList } from '../src/core/story-tasks.mjs';
import {
  prepareSpecification, prepareDesign,
} from '../src/core/specifications.mjs';
import { preparePlan } from '../src/core/plans.mjs';
import { applyPlan } from '../src/core/bootstrap.mjs';
import {
  bootstrappedCtx, cleanup, VALID_ANSWERS,
} from './helpers.mjs';

const mk = (title) => ({ title, contract: 'c', authorContext: 'a', scope: [] });

const SPEC = {
  originalRequest: 'fixture', title: 'Spec',
  outcome: { statement: 'o', evidencePlan: 'e' },
  requirements: [{
    id: 'R1', statement: 's',
    scenarios: [
      { id: 'S1', given: 'g', when: 'w', then: 't' },
      { id: 'S2', given: 'g2', when: 'w2', then: 't2' }],
  }],
  scope: [],
};

function pair(ctx, dir) {
  const spec = prepareSpecification(ctx, SPEC);
  applyPlan(dir, [spec.file]);
  const des = prepareDesign(ctx,
    { specId: spec.artifact.id, title: 'd', body: 'b' });
  applyPlan(dir, [des.file]);
  return { spec: spec.artifact, design: des.artifact };
}

test('B1 converge: open task is diverged, record persists create-only', () => {
  const { dir, ctx } = bootstrappedCtx(VALID_ANSWERS);
  try {
    const t = createTask(ctx, mk('conv'));
    const r = evaluateConvergence(ctx, t);
    assert.equal(r.verdict, 'diverged');
    assert.ok(r.findings.some((f) => f.code === 'TASK_OPEN'));
    assert.match(recordConvergence(ctx, t.id).record, /convergence\/001-/);
    assert.match(recordConvergence(ctx, t.id).record, /002-/);
  } finally { cleanup(dir); }
});

test('B2 checklist: CHK ids, CAS mark, failed item blocks converge', () => {
  const { dir, ctx } = bootstrappedCtx(VALID_ANSWERS);
  try {
    const t = createTask(ctx, mk('chk'));
    const c = createChecklist(ctx, {
      taskId: t.id, title: 'req', items: [{ text: 'a' }, { text: 'b' }],
    });
    assert.equal(c.items[0].id, 'CHK001');
    assert.ok(checklistFindings(ctx, t.id)
      .every((f) => f.severity === 'major'));
    markChecklistItem(ctx, c.id, 'CHK001',
      { status: 'fail', expectedRevision: 0 });
    assert.ok(checklistFindings(ctx, t.id)
      .some((x) => x.severity === 'blocking'));
    assert.throws(() => markChecklistItem(ctx, c.id, 'CHK001',
      { status: 'pass', expectedRevision: 0 }),
      (e) => e.code === 'REVISION_MISMATCH');
    assert.equal(getChecklist(ctx, c.id).items[0].status, 'fail');
  } finally { cleanup(dir); }
});

test('B3 analyze: coverage counts and uncovered scenario findings', () => {
  const { dir, ctx } = bootstrappedCtx(VALID_ANSWERS);
  try {
    const { spec, design } = pair(ctx, dir);
    const { plan, files } = preparePlan(ctx, {
      key: 'p1', title: 'P', authorContext: 'a',
      specId: spec.id, designId: design.id,
      tasks: [{
        key: 't1', title: 'T1', contract: 'c', scope: [],
        scenarioRefs: [{ requirementId: 'R1', scenarioId: 'S1' }],
      }, {
        key: 't2', title: 'T2', contract: 'c', scope: [],
        dependsOn: ['t1'],
        scenarioRefs: [{ requirementId: 'R1', scenarioId: 'S2' }],
      }],
    });
    applyPlan(dir, files);
    const t1 = analyzeTask(ctx, plan.tasks[0].id);
    assert.equal(t1.coverage.scenarios, '2/2');
    assert.ok(!t1.findings.some((f) => f.code === 'SCENARIO_UNCOVERED'));
    const bare = analyzeTask(ctx, createTask(ctx, mk('bare')).id);
    assert.ok(bare.findings.some((f) => f.code === 'NO_FORMAL_PAIR'));
  } finally { cleanup(dir); }
});

test('B4 clarify: dated sessions are create-only and ordered', () => {
  const { dir, ctx } = bootstrappedCtx(VALID_ANSWERS);
  try {
    const { spec } = pair(ctx, dir);
    const s1 = recordClarification(ctx, {
      specId: spec.id, date: '2026-11-21',
      entries: [{ question: 'q1', answer: 'a1' }],
    });
    assert.match(s1.record, /001-2026-11-21\.json$/);
    recordClarification(ctx, {
      specId: spec.id,
      entries: [{ question: 'q2', answer: 'a2' }],
    });
    const sessions = listClarifications(ctx, spec.id);
    assert.equal(sessions.length, 2);
    assert.equal(sessions[0].date, '2026-11-21');
    assert.throws(() => recordClarification(ctx, {
      specId: '00000000-0000-0000-0000-000000000000',
      entries: [{ question: 'q', answer: 'a' }],
    }), (e) => e.code === 'NOT_FOUND' || /not found|missing/i.test(e.message));
  } finally { cleanup(dir); }
});

test('B5 constitution: semver bumps enforced, history + complexity', () => {
  const { dir, ctx } = bootstrappedCtx(VALID_ANSWERS);
  try {
    const doc = setConstitution(ctx, {
      version: '1.0.0', bump: 'major',
      principles: [
        { id: 'P1', title: 'T', statement: 's' },
        { id: 'P2', title: 'T2', statement: 's2' },
      ], summary: 'genesis',
    });
    assert.equal(doc.complexity.principles, 2);
    assert.throws(() => setConstitution(ctx, {
      version: '1.0.1', bump: 'patch', summary: 'drop P2',
      principles: [{ id: 'P1', title: 'T', statement: 's' }],
    }), /major/);
    const v2 = setConstitution(ctx, {
      version: '2.0.0', bump: 'major', summary: 'rewrite',
      principles: [{ id: 'P1', title: 'T', statement: 's' }],
    });
    assert.equal(v2.history.length, 2);
    assert.equal(getConstitution(ctx).version, '2.0.0');
  } finally { cleanup(dir); }
});

test('B6 story tasks: T###, [P] and US-grouped phases render', () => {
  const { dir, ctx } = bootstrappedCtx(VALID_ANSWERS);
  try {
    const { spec, design } = pair(ctx, dir);
    const { plan, files } = preparePlan(ctx, {
      key: 'p1', title: 'P', authorContext: 'a',
      specId: spec.id, designId: design.id,
      tasks: [{
        key: 'setup', title: 'Bootstrap', contract: 'c', scope: [],
      }, {
        key: 't1', title: 'Story one', contract: 'c', scope: [],
        scenarioRefs: [{ requirementId: 'R1', scenarioId: 'S1' }],
      }, {
        key: 't2', title: 'Story two', contract: 'c', scope: [],
        scenarioRefs: [{ requirementId: 'R1', scenarioId: 'S2' }],
      }],
    });
    applyPlan(dir, files);
    const { markdown, groups } = renderStoryTaskList(ctx, 'p1');
    assert.ok(markdown.includes('T001'));
    assert.ok(markdown.includes('## Phase: Setup'));
    assert.ok(markdown.includes('[US1]'));
    assert.ok(groups.some((g) => g.startsWith('User Story 1')));
    // setup + t1 share wave 0 -> both get [P]
    assert.ok(markdown.includes('[P]'));
  } finally { cleanup(dir); }
});
