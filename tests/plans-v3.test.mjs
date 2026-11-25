// SPDX-License-Identifier: Apache-2.0
// Plan V3: semantic layer (triage, appetite, cynefin, risk register,
// premortem, stop conditions, budget), forwarded task semantics and
// triage-aware readiness.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { applyPlan, preflightPlan } from '../src/core/bootstrap.mjs';
import { createConfig } from '../src/core/config.mjs';
import { resolveContext } from '../src/core/context.mjs';
import {
  getPlan, nextPlanTasks, preparePlan,
} from '../src/core/plans.mjs';
import { getTask } from '../src/core/tasks.mjs';
import {
  VALID_ANSWERS, cleanup, makeTempDir, writeJson,
} from './helpers.mjs';

function ctxFixture() {
  const dir = makeTempDir('plans-v3');
  writeJson(dir, '.scopegrain/config.json',
    createConfig(dir, VALID_ANSWERS, {}));
  return { dir, ctx: resolveContext({ project: dir }) };
}

const V3_PLAN = {
  key: 'rel-3', title: 'Release 3', authorContext: 'ctx',
  appetite: 'weeks', cynefin: 'complex',
  premortem: 'the API changed mid-implementation',
  stopConditions: ['owner revokes approval', 'verify fails twice'],
  budget: { turns: 40, notes: 'ceiling' },
  riskRegister: [
    { risk: 'scope creep', likelihood: 'medium', impact: 'high',
      mitigation: 'weekly triage' },
    { risk: 'data loss' },
  ],
  triage: {
    base: { decision: 'do' },
    docs: { decision: 'defer', reason: 'post-release' },
  },
  tasks: [
    { key: 'base', title: 'Base', contract: 'c', scope: [],
      dependsOn: [], priority: 'p0', backlog: 'core',
      steps: [{ name: 'design' }] },
    { key: 'api', title: 'API', contract: 'c', scope: [],
      dependsOn: ['base'], type: 'feature' },
    { key: 'docs', title: 'Docs', contract: 'c', scope: [],
      dependsOn: ['api'], triage: 'defer', triageReason: 'post-release' },
  ],
};

test('V3 plan: stored semantics + forwarded task semantics', () => {
  const { dir, ctx } = ctxFixture();
  try {
    const prepared = preparePlan(ctx, V3_PLAN);
    assert.equal(prepared.plan.schemaVersion, 3);
    applyPlan(dir, preflightPlan(dir, prepared.files));
    const plan = getPlan(ctx, 'rel-3');
    assert.equal(plan.schemaVersion, 3);
    assert.equal(plan.specId, null);
    assert.equal(plan.designId, null);
    assert.equal(plan.appetite, 'weeks');
    assert.equal(plan.cynefin, 'complex');
    assert.equal(plan.triage.docs.decision, 'defer');
    assert.equal(plan.riskRegister[1].likelihood, null); // defaults filled
    assert.deepEqual(plan.stopConditions,
      ['owner revokes approval', 'verify fails twice']);
    assert.deepEqual(plan.budget, { turns: 40, notes: 'ceiling' });
    // per-task triage stored on the plan entries
    assert.equal(plan.tasks[2].triage, 'defer');
    assert.equal(plan.tasks[2].triageReason, 'post-release');
    assert.equal(plan.tasks[0].triage, null);
    // forwarded V3 fields land on the generated task records
    const base = getTask(ctx, plan.tasks[0].id);
    assert.equal(base.schemaVersion, 3);
    assert.equal(base.priority, 'p0');
    assert.equal(base.backlog, 'core');
    assert.equal(base.steps[0].name, 'design');
    const api = getTask(ctx, plan.tasks[1].id);
    assert.equal(api.type, 'feature');
    // The plan DAG (keys) propagates into the record layer as resolved
    // task ids, so task-level consumers (ordering, viewers) see the same
    // dependency structure the ACT gate enforces.
    assert.deepEqual(api.dependsOn, [plan.tasks[0].id]);
    assert.equal(base.dependsOn, null);
  } finally { cleanup(dir); }
});

test('triage-aware readiness: deferred/skip/blocked are not ready', () => {
  const { dir, ctx } = ctxFixture();
  try {
    applyPlan(dir, preflightPlan(dir, preparePlan(ctx, V3_PLAN).files));
    const statuses = Object.fromEntries(
      nextPlanTasks(ctx, 'rel-3').map((t) => [t.key, t.status]));
    assert.equal(statuses.base, 'ready');
    assert.equal(statuses.docs, 'triaged'); // defer wins over blocked deps
    assert.equal(statuses.api, 'blocked');
  } finally { cleanup(dir); }
});

test('input validation: enums, triage keys, budget, risk grades', () => {
  const { dir, ctx } = ctxFixture();
  try {
    const bad = (mut, code) => {
      const p = JSON.parse(JSON.stringify(V3_PLAN));
      mut(p);
      assert.throws(() => preparePlan(ctx, p), (e) => e.code === code);
    };
    bad((p) => { p.cynefin = 'nebulous'; }, 'INVALID_PLAN');
    bad((p) => { p.appetite = 'eternity'; }, 'INVALID_PLAN');
    bad((p) => { p.triage.nope = { decision: 'do' }; }, 'INVALID_PLAN');
    bad((p) => { p.triage.base = { decision: 'maybe' }; }, 'INVALID_PLAN');
    bad((p) => { p.budget = { turns: -1 }; }, 'INVALID_PLAN');
    bad((p) => { p.budget = { extra: 1 }; }, 'UNKNOWN_KEY');
    bad((p) => { p.riskRegister = [{ risk: 'x', likelihood: 'extreme' }]; },
      'INVALID_PLAN');
    bad((p) => { p.tasks[0].triage = 'hmm'; }, 'INVALID_PLAN');
    bad((p) => { p.bogus = 1; }, 'UNKNOWN_KEY');
    bad((p) => { p.tasks[0].bogus = 1; }, 'UNKNOWN_KEY');
    // no semantics -> natural version (V1 without pair)
    const p1 = JSON.parse(JSON.stringify(V3_PLAN));
    for (const k of ['appetite', 'cynefin', 'premortem', 'stopConditions',
      'budget', 'riskRegister', 'triage']) delete p1[k];
    for (const t of p1.tasks) {
      delete t.triage; delete t.triageReason;
      delete t.priority; delete t.backlog; delete t.steps; delete t.type;
    }
    assert.equal(preparePlan(ctx, p1).plan.schemaVersion, 1);
  } finally { cleanup(dir); }
});

test('stored shape: V1 may not carry v3 keys; v3 requires all keys', () => {
  const { dir, ctx } = ctxFixture();
  try {
    const p1 = {
      key: 'p1', title: 'P', authorContext: 'a',
      tasks: [{ key: 't', title: 't', contract: 'c', scope: [],
        dependsOn: [] }],
    };
    applyPlan(dir, preflightPlan(dir, preparePlan(ctx, p1).files));
    const f1 = path.join(dir, 'docs/agent/plans/p1.json');
    const d1 = JSON.parse(fs.readFileSync(f1, 'utf8'));
    d1.cynefin = 'complex';
    fs.writeFileSync(f1, JSON.stringify(d1));
    assert.throws(() => getPlan(ctx, 'p1'),
      (e) => e.code === 'PLAN_MALFORMED');
    applyPlan(dir, preflightPlan(dir, preparePlan(ctx, V3_PLAN).files));
    const f3 = path.join(dir, 'docs/agent/plans/rel-3.json');
    const d3 = JSON.parse(fs.readFileSync(f3, 'utf8'));
    delete d3.budget;
    fs.writeFileSync(f3, JSON.stringify(d3));
    assert.throws(() => getPlan(ctx, 'rel-3'),
      (e) => e.code === 'PLAN_MALFORMED');
  } finally { cleanup(dir); }
});

test('V3 ext: request, planType and trigger persist with defaults', () => {
  const { dir, ctx } = ctxFixture();
  try {
    const p = JSON.parse(JSON.stringify(V3_PLAN));
    p.request = 'Ship the release with zero known P0s';
    p.planType = 'hybrid';
    p.trigger = { kind: 'scheduled', ref: 'weekly-release' };
    p.acceptanceCriteria = ['all tasks CLOSED', 'report written'];
    p.deliverables = [
      { path: 'docs/report.md', mustExist: true },
      { path: 'src/index.mjs' },
    ];
    p.synthesisStrategy = 'aggregate';
    p.replanPolicy = 'insert-remediation';
    const prepared = preparePlan(ctx, p);
    assert.equal(prepared.plan.schemaVersion, 3);
    assert.equal(prepared.plan.request, 'Ship the release with zero known P0s');
    assert.equal(prepared.plan.planType, 'hybrid');
    assert.deepEqual(prepared.plan.trigger,
      { kind: 'scheduled', ref: 'weekly-release' });
    assert.deepEqual(prepared.plan.acceptanceCriteria,
      ['all tasks CLOSED', 'report written']);
    assert.deepEqual(prepared.plan.deliverables, [
      { path: 'docs/report.md', mustExist: true },
      { path: 'src/index.mjs' },
    ]);
    assert.equal(prepared.plan.synthesisStrategy, 'aggregate');
    assert.equal(prepared.plan.replanPolicy, 'insert-remediation');
    applyPlan(dir, preflightPlan(dir, prepared.files));
    const stored = getPlan(ctx, 'rel-3');
    assert.equal(stored.request, 'Ship the release with zero known P0s');
    // absent ext keys are emitted with null defaults on write
    const p2 = JSON.parse(JSON.stringify(V3_PLAN));
    p2.key = 'rel-4';
    const prepared2 = preparePlan(ctx, p2);
    for (const k of ['request', 'planType', 'trigger', 'acceptanceCriteria',
      'deliverables', 'synthesisStrategy', 'replanPolicy']) {
      assert.equal(prepared2.plan[k], null);
    }
    // stored V3 records predating the ext keys stay readable
    const prepared3 = preparePlan(ctx, p2);
    applyPlan(dir, preflightPlan(dir, prepared3.files));
    const f = path.join(dir, 'docs/agent/plans/rel-4.json');
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    delete d.request; delete d.planType; delete d.trigger;
    fs.writeFileSync(f, JSON.stringify(d));
    assert.equal(getPlan(ctx, 'rel-4').key, 'rel-4');
    // validation: bad enum/kind/shape rejected at input
    const bad = (mut, code) => {
      const bp = JSON.parse(JSON.stringify(V3_PLAN));
      mut(bp);
      assert.throws(() => preparePlan(ctx, bp), (e) => e.code === code);
    };
    bad((b) => { b.request = ''; }, 'INVALID_PLAN');
    bad((b) => { b.planType = 'spiral'; }, 'INVALID_PLAN');
    bad((b) => { b.trigger = { kind: 'psychic' }; }, 'INVALID_PLAN');
    bad((b) => { b.trigger = { kind: 'manual', extra: 1 }; },
      'UNKNOWN_KEY');
    bad((b) => { b.acceptanceCriteria = ['']; }, 'INVALID_PLAN');
    bad((b) => { b.acceptanceCriteria = 'done'; }, 'INVALID_PLAN');
    bad((b) => { b.deliverables = [{ path: '../evil' }]; }, 'INVALID_PATH');
    bad((b) => { b.deliverables = [{ path: 'a', extra: 1 }]; },
      'UNKNOWN_KEY');
    bad((b) => { b.synthesisStrategy = 'magic'; }, 'INVALID_PLAN');
    bad((b) => { b.replanPolicy = 'yeet'; }, 'INVALID_PLAN');
    // ext keys are V3-layer: a V1 record may not carry them
    const f1 = path.join(dir, 'docs/agent/plans/rel-4.json');
    const d1 = JSON.parse(fs.readFileSync(f1, 'utf8'));
    d1.schemaVersion = 1;
    delete d1.triage; delete d1.appetite; delete d1.cynefin;
    delete d1.riskRegister; delete d1.premortem; delete d1.stopConditions;
    delete d1.budget; delete d1.specId; delete d1.designId;
    for (const t of d1.tasks) { delete t.triage; delete t.triageReason; }
    d1.request = 'V1 may not carry ext keys';
    fs.writeFileSync(f1, JSON.stringify(d1));
    assert.throws(() => getPlan(ctx, 'rel-4'),
      (e) => e.code === 'PLAN_MALFORMED');
  } finally { cleanup(dir); }
});
