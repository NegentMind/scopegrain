// SPDX-License-Identifier: Apache-2.0
// Suggestive task-type -> capability heuristic: ranked candidates with
// declared reasons, declared skills excluded, nothing ever injected.
import test from 'node:test';
import assert from 'node:assert/strict';
import { planSkillRecord, suggestCapabilities } from '../src/core/task-suggest.mjs';
import { buildWorkflowPacket } from '../src/core/workflows.mjs';
import { createTask } from '../src/core/tasks.mjs';
import { bootstrappedCtx, cleanup, fakeIO, readJson } from './helpers.mjs';
import { run } from '../src/cli.mjs';

const lastJson = (io) => JSON.parse(io.out.stdout[io.out.stdout.length - 1]);
const lastErr = (io) => JSON.parse(io.out.stderr[io.out.stderr.length - 1]).error;

test('type:bug surfaces debugging/recovery skills with type reasons', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const task = createTask(ctx, {
      title: 'fix crash', contract: 'C', authorContext: 'a', scope: [],
      type: 'bug',
    });
    const r = suggestCapabilities(ctx, task);
    assert.equal(r.taskId, task.id);
    assert.equal(r.type, 'bug');
    assert.ok(r.suggestions.length > 0);
    const top = r.suggestions.find((s) => s.id === 'systematic-debugging'
      || s.id === 'debugging-and-error-recovery');
    assert.ok(top, 'a debugging skill must rank');
    assert.ok(top.reasons.some((x) => x.startsWith('type:bug')));
  } finally { cleanup(dir); }
});

test('declared task.skills are excluded and echoed under declared', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const task = createTask(ctx, {
      title: 'fix crash', contract: 'C', authorContext: 'a', scope: [],
      type: 'bug', skills: ['systematic-debugging'],
    });
    const r = suggestCapabilities(ctx, task);
    assert.deepEqual(r.declared, ['systematic-debugging']);
    assert.ok(!r.suggestions.some((s) => s.id === 'systematic-debugging'));
  } finally { cleanup(dir); }
});

test('scope tests/ contributes scope reasons', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const task = createTask(ctx, {
      title: 'coverage', contract: 'C', authorContext: 'a',
      scope: ['tests/unit/coverage.test.mjs'],
    });
    const r = suggestCapabilities(ctx, task);
    const withScope = r.suggestions.filter(
      (s) => s.reasons.some((x) => x.startsWith('scope:')));
    assert.ok(withScope.length > 0, 'scope segment must score');
  } finally { cleanup(dir); }
});

test('suggestions never mutate the task record or inject into packets', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const task = createTask(ctx, {
      title: 'fix crash', contract: 'C', authorContext: 'a', scope: [],
      type: 'bug',
    });
    const before = JSON.parse(JSON.stringify(task));
    suggestCapabilities(ctx, task);
    assert.deepEqual(JSON.parse(JSON.stringify(task)), before);
    assert.equal(task.skills, null);
    // Packet: trace is declared under suggested; the skills bucket only
    // ever carries what was explicitly declared.
    const p = buildWorkflowPacket(ctx, {
      command: 'pipeline', mode: 'task', taskId: task.id,
    });
    assert.ok(Array.isArray(p.taskRouting.suggested));
    assert.equal(p.taskRouting.included.length, 0);
    for (const s of p.taskRouting.suggested) {
      assert.ok(Array.isArray(s.reasons) && s.reasons.length > 0);
    }
  } finally { cleanup(dir); }
});

test('null/unknown type still ranks on title+contract tokens', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const task = createTask(ctx, {
      title: 'documentation adr writing', contract: 'docs contract',
      authorContext: 'a', scope: [],
    });
    const r = suggestCapabilities(ctx, task);
    assert.equal(r.type, null);
    assert.ok(r.suggestions.length > 0);
    assert.ok(r.suggestions.every((s) => !s.reasons.some(
      (x) => x.startsWith('type:'))));
  } finally { cleanup(dir); }
});

test('limit bounds the list and must be an integer in [1,50]', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const task = createTask(ctx, {
      title: 'fix crash', contract: 'C', authorContext: 'a', scope: [],
      type: 'bug',
    });
    const one = suggestCapabilities(ctx, task, { limit: 1 });
    assert.equal(one.suggestions.length, 1);
    for (const bad of [0, 51, 1.5]) {
      assert.throws(() => suggestCapabilities(ctx, task, { limit: bad }),
        (e) => e.code === 'INVALID_ARGS');
    }
  } finally { cleanup(dir); }
});

test('ranking is deterministic across repeated calls', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const task = createTask(ctx, {
      title: 'fix crash', contract: 'C', authorContext: 'a', scope: [],
      type: 'bug',
    });
    const a = suggestCapabilities(ctx, task).suggestions;
    const b = suggestCapabilities(ctx, task).suggestions;
    assert.deepEqual(a, b);
  } finally { cleanup(dir); }
});

test('planSkillRecord builds an auditable SKILLS_CARGADAS record', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const task = createTask(ctx, {
      title: 'fix crash', contract: 'C', authorContext: 'a', scope: [],
      type: 'bug',
    });
    // A heuristic hit carries its reasons as justification.
    const ranked = suggestCapabilities(ctx, task, { limit: 50 })
      .suggestions[0].id;
    const plan = planSkillRecord(ctx, task, { skillIds: [ranked] });
    assert.equal(plan.phase, task.state, 'default phase is the task state');
    assert.ok(plan.set.skills.includes(ranked));
    assert.ok(plan.addNote.startsWith(`SKILLS_CARGADAS[${task.state}]: `));
    assert.ok(plan.addNote.includes(ranked));
    const hit = plan.justifications.find((j) => j.id === ranked);
    assert.ok(hit.justification.startsWith('heuristic: '));
    // An explicit non-hit selection is honestly marked, never invented.
    const manual = planSkillRecord(ctx, task,
      { skillIds: ['session-handoff'], phase: 'ACT' });
    const m = manual.justifications.find((j) => j.id === 'session-handoff');
    assert.equal(m.justification, 'manual-selection: no heuristic signal matched');
    assert.equal(manual.phase, 'ACT');
    // Declared skills union without duplicates.
    assert.deepEqual(manual.set.skills, [...new Set(manual.set.skills)]);
  } finally { cleanup(dir); }
});

test('planSkillRecord refuses unknown ids, empty selections and bad phases', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const task = createTask(ctx, {
      title: 'fix crash', contract: 'C', authorContext: 'a', scope: [],
    });
    assert.throws(() => planSkillRecord(ctx, task, { skillIds: [] }),
      (e) => e.code === 'INVALID_ARGS');
    assert.throws(() => planSkillRecord(ctx, task,
      { skillIds: ['definitely-not-a-catalog-skill'] }),
      (e) => e.code === 'INVALID_ARGS');
    assert.throws(() => planSkillRecord(ctx, task,
      { skillIds: ['systematic-debugging'], phase: 'BUILD' }),
      (e) => e.code === 'INVALID_ARGS');
    // Already-declared ids reaffirm instead of erroring.
    const declared = createTask(ctx, {
      title: 'fix crash', contract: 'C', authorContext: 'a', scope: [],
      skills: ['systematic-debugging'],
    });
    const p = planSkillRecord(ctx, declared,
      { skillIds: ['systematic-debugging'] });
    assert.equal(p.justifications[0].justification,
      'already-declared: reaffirmed selection');
    assert.deepEqual(p.set.skills, ['systematic-debugging']);
  } finally { cleanup(dir); }
});

test('cli: task suggest --record previews, --apply persists via task meta', async () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const task = createTask(ctx, {
      title: 'fix crash', contract: 'C', authorContext: 'a', scope: [],
      type: 'bug',
    });
    const base = ['task', 'suggest', '--project', dir, task.id,
      '--record', '--skills', 'systematic-debugging'];
    // Dry-run: nothing persisted.
    const ioDry = fakeIO();
    assert.equal(await run([...base], ioDry), 0);
    const dry = lastJson(ioDry);
    assert.equal(dry.record.mode, 'dry-run');
    assert.ok(dry.record.addNote.startsWith('SKILLS_CARGADAS['));
    assert.equal(dry.record.set.skills.includes('systematic-debugging'), true);
    // --apply: single CAS mutation — skills union + auditable note.
    const ioApply = fakeIO();
    assert.equal(await run([...base, '--apply'], ioApply), 0);
    const applied = lastJson(ioApply);
    assert.equal(applied.record.mode, 'applied');
    const stored = readJson(dir, `${ctx.config.paths.tasks}/${task.id}.json`);
    assert.deepEqual(stored.skills, ['systematic-debugging']);
    assert.ok(stored.notes.some(
      (n) => n.startsWith('SKILLS_CARGADAS[PLAN]: systematic-debugging')));
    // --record without --skills refuses — no self-recording heuristic.
    const ioNoSel = fakeIO();
    assert.equal(await run(['task', 'suggest', '--project', dir, task.id,
      '--record'], ioNoSel), 2);
    assert.equal(lastErr(ioNoSel).code, 'INVALID_ARGS');
    // --apply without --record refuses.
    const ioBare = fakeIO();
    assert.equal(await run(['task', 'suggest', '--project', dir, task.id,
      '--apply'], ioBare), 2);
  } finally { cleanup(dir); }
});
