// SPDX-License-Identifier: Apache-2.0
// plan conclude: member-outcome retrospective — worklog outcomes once
// per member, activity line, optional report artifact, idempotent via
// a bounded conclusion record.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  concludePlan, getPlan, preparePlan,
} from '../src/core/plans.mjs';
import { applyPlan } from '../src/core/bootstrap.mjs';
import { getTask } from '../src/core/tasks.mjs';
import { readWorklog } from '../src/core/worklog.mjs';
import { seedState } from './methodology-fixtures.mjs';
import { bootstrappedMiniCtx, cleanup } from './helpers.mjs';

const PLAN_V3 = { triage: null, appetite: null, cynefin: 'clear',
  riskRegister: null, premortem: null, stopConditions: null, budget: null };

function mkPlan(ctx, dir, key, keys = ['a', 'b', 'c']) {
  const plan = preparePlan(ctx, { key, title: 'P',
    authorContext: 'fixture-author', ...PLAN_V3,
    tasks: keys.map((k, i) => ({ key: k, title: k.toUpperCase(),
      contract: 'C', scope: [`src/${k}`],
      dependsOn: i === 0 ? [] : [keys[i - 1]] })) });
  applyPlan(dir, plan.files);
  return plan.plan.tasks.map((t) => t.id);
}

test('conclude refuses non-terminal plans unless --partial', () => {
  const f = bootstrappedMiniCtx();
  try {
    mkPlan(f.ctx, f.dir, 'open-plan');
    assert.throws(() => concludePlan(f.ctx, 'open-plan', { apply: true }),
      (e) => e.code === 'PLAN_NOT_TERMINAL' && e.message.includes('a'));
    const pre = concludePlan(f.ctx, 'open-plan', { partial: true });
    assert.equal(pre.mode, 'preview');
    assert.equal(pre.alreadyConcluded, false);
    assert.equal(pre.summary.status, 'draft');
  } finally { cleanup(f.dir); }
});

test('conclude applies once, then is a noop', () => {
  const f = bootstrappedMiniCtx();
  try {
    const [a, b, c] = mkPlan(f.ctx, f.dir, 'done-plan');
    seedState(f, getTask(f.ctx, a), 'CLOSE', null);
    seedState(f, getTask(f.ctx, b), 'ABANDON', null);
    // c stays PLAN -> partial conclusion
    const first = concludePlan(f.ctx, 'done-plan',
      { apply: true, partial: true, report: true });
    assert.equal(first.mode, 'applied');
    assert.equal(first.summary.status, 'failed');
    assert.equal(first.wrote.outcomes, 2); // ok + fail, not pending c
    assert.equal(first.wrote.activity, true);
    assert.equal(first.wrote.report, true);
    const outs = readWorklog(f.ctx, 'outcomes', { tail: 20 }).entries;
    assert.equal(outs.length, 2);
    assert.deepEqual(outs.map((o) => o.outcome).sort(), ['fail', 'ok']);
    const acts = readWorklog(f.ctx, 'activity', { tail: 20 }).entries;
    assert.equal(acts.filter((e) => e.kind === 'plan-conclusion').length, 1);
    // Report artifact landed
    const reportAbs = path.join(f.dir, first.wrote.reportPath);
    assert.ok(fs.existsSync(reportAbs));
    // Same state -> noop, zero new writes
    const second = concludePlan(f.ctx, 'done-plan',
      { apply: true, partial: true });
    assert.equal(second.mode, 'noop');
    assert.equal(second.wrote.outcomes, 0);
    assert.equal(readWorklog(f.ctx, 'outcomes', { tail: 20 }).entries.length,
      2);
    assert.equal(readWorklog(f.ctx, 'activity', { tail: 20 }).entries
      .filter((e) => e.kind === 'plan-conclusion').length, 1);
    // Close c -> new digest: only c's outcome is appended
    seedState(f, getTask(f.ctx, c), 'CLOSE', null);
    const third = concludePlan(f.ctx, 'done-plan', { apply: true });
    assert.equal(third.mode, 'applied');
    assert.equal(third.summary.status, 'failed'); // ABANDON still there
    assert.equal(third.wrote.outcomes, 1);
    const outs3 = readWorklog(f.ctx, 'outcomes', { tail: 20 }).entries;
    assert.equal(outs3.length, 3);
    assert.deepEqual(outs3.map((o) => o.outcome).sort(),
      ['fail', 'ok', 'ok']);
  } finally { cleanup(f.dir); }
});

test('conclusion record persists and validates', () => {
  const f = bootstrappedMiniCtx();
  try {
    const [a] = mkPlan(f.ctx, f.dir, 'rec-plan', ['a']);
    seedState(f, getTask(f.ctx, a), 'CLOSE', null);
    concludePlan(f.ctx, 'rec-plan', { apply: true });
    const recFile = path.join(f.dir,
      '.scopegrain/state/plan-conclusions/rec-plan.json');
    const rec = JSON.parse(fs.readFileSync(recFile, 'utf8'));
    assert.equal(rec.schemaVersion, 1);
    assert.equal(rec.planKey, 'rec-plan');
    assert.equal(rec.conclusions.length, 1);
    assert.equal(rec.conclusions[0].summary.status, 'completed');
  } finally { cleanup(f.dir); }
});
