// SPDX-License-Identifier: Apache-2.0
// `task reassess`: the legal repair for a stored assessment recorded
// misclassified. A light record whose methodology classifies sdd without
// formal refs must stay readable (the stored shape is not the gate), the
// reassessment is a CAS meta mutation with a history entry, and sdd-
// classifying input or formal bindings are rejected.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { run } from '../src/cli.mjs';
import { createTask, getTask } from '../src/core/tasks.mjs';
import { evaluateMethodology } from '../src/core/methodology.mjs';
import {
  evaluateTaskReassessment, reassessTask,
} from '../src/core/transition.mjs';
import { bootstrappedCtx, cleanup, fakeIO, DEFAULT_ANSWERS } from './helpers.mjs';
import { assessment, formalFixture } from './methodology-fixtures.mjs';

function fixture() {
  return bootstrappedCtx({
    ...DEFAULT_ANSWERS, hosts: ['claude'], methodology: 'organic-sdd',
  });
}

function lastJson(io) {
  return JSON.parse(io.out.stdout[io.out.stdout.length - 1]);
}

const lightAssessment = () => assessment({
  authorization: { status: 'missing', actor: null, reference: null } });
const sddAssessment = () => assessment({
  risk: 'named', riskCategories: ['data-integrity'] });

// Forge the legacy defect the harness once emitted: a stored V2 light
// record whose methodology classifies sdd but carries no formal refs.
function seedWedged(ctx, dir) {
  const task = createTask(ctx, {
    title: 'wedged', contract: 'C', authorContext: 'a', scope: [],
    methodology: lightAssessment(),
  });
  const file = `${dir}/.scopegrain/tasks/${task.id}.json`;
  const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
  rec.methodology = sddAssessment();
  fs.writeFileSync(file, JSON.stringify(rec, null, 2) + '\n');
  return task;
}

test('an sdd-classifying light record stays readable and gate blocks', () => {
  const { dir, ctx } = fixture();
  try {
    const task = seedWedged(ctx, dir);
    // Regression: this record threw TASK_MALFORMED on load, making every
    // verb (show, meta, authorize, reassess) permanently unreachable.
    const loaded = getTask(ctx, task.id);
    assert.equal(loaded.id, task.id);
    const ev = evaluateMethodology(ctx, loaded, { to: 'ACT' });
    assert.equal(ev.allowed, false);
    assert.ok(ev.issues.some((i) => i.code === 'METHODOLOGY_REQUIRED'));
  } finally { cleanup(dir); }
});

test('reassess repairs a wedged record; authorize completes the path', async () => {
  const { dir, ctx } = fixture();
  try {
    const task = seedWedged(ctx, dir);
    const io = fakeIO();
    const assessmentFile = `${dir}/reassess.json`;
    fs.writeFileSync(assessmentFile, JSON.stringify(lightAssessment()));
    const applied = await run([
      'task', 'reassess', '--project', dir, task.id,
      '--revision', '0', '--input', assessmentFile, '--apply',
    ], io);
    assert.equal(applied, 0);
    const next = lastJson(io);
    assert.equal(next.revision, 1);
    const last = next.history[next.history.length - 1];
    assert.equal(last.event, 'reassessed');
    assert.equal(last.from, 'sdd');
    // Gate now reports the honest missing authorization, which
    // `task authorize` resolves legally.
    await run([
      'task', 'authorize', '--project', dir, task.id,
      '--revision', '1', '--actor', 'owner', '--reference', 'D-9', '--apply',
    ], io);
    const moved = await run([
      'task', 'transition', '--project', dir, task.id, 'ACT',
      '--revision', '2', '--apply',
    ], io);
    assert.equal(moved, 0);
    assert.equal(getTask(ctx, task.id).state, 'ACT');
  } finally { cleanup(dir); }
});

test('reassess upgrades a V1 record to V3 with the new assessment', async () => {
  const { dir, ctx } = bootstrappedCtx({
    ...DEFAULT_ANSWERS, hosts: ['claude'], methodology: 'manual',
  });
  try {
    const task = createTask(ctx, { title: 'v1', contract: 'C',
      authorContext: 'a', scope: [] });
    assert.equal(task.schemaVersion, 1);
    assert.equal('methodology' in task, false); // V1 predates the field
    const next = reassessTask(ctx, { id: task.id, expectedRevision: 0,
      methodology: lightAssessment() });
    assert.equal(next.schemaVersion, 3);
    assert.equal(next.methodology.request, 'declared D2 fixture change');
    assert.equal(next.history.at(-1).event, 'reassessed');
    assert.equal(next.history.at(-1).from, null);
  } finally { cleanup(dir); }
});

test('reassess rejects sdd-classifying input and formal bindings', () => {
  const { dir, ctx } = fixture();
  try {
    const task = createTask(ctx, {
      title: 'light', contract: 'C', authorContext: 'a', scope: [],
      methodology: lightAssessment(),
    });
    assert.throws(() => evaluateTaskReassessment(ctx, getTask(ctx, task.id),
      { id: task.id, expectedRevision: 0, methodology: sddAssessment() }),
      { code: 'METHODOLOGY_REQUIRED' });
    const f = formalFixture();
    try {
      assert.throws(() => evaluateTaskReassessment(ctx, f.task,
        { id: f.task.id, expectedRevision: f.task.revision,
          methodology: lightAssessment() }),
        { code: 'INVALID_VALUE' });
    } finally { cleanup(f.dir); }
    assert.equal(getTask(ctx, task.id).revision, 0);
  } finally { cleanup(dir); }
});

test('reassess enforces CAS revision, --input and a closed input', async () => {
  const { dir, ctx } = fixture();
  try {
    const task = createTask(ctx, {
      title: 'light', contract: 'C', authorContext: 'a', scope: [],
      methodology: lightAssessment(),
    });
    const io = fakeIO();
    const assessmentFile = `${dir}/reassess.json`;
    fs.writeFileSync(assessmentFile, JSON.stringify(lightAssessment()));
    for (const args of [
      ['task', 'reassess', '--project', dir, task.id,
        '--input', assessmentFile],
      ['task', 'reassess', '--project', dir, task.id,
        '--revision', '0'],
    ]) {
      const io2 = fakeIO();
      const code = await run(args, io2);
      assert.equal(code, 2, args.join(' '));
      assert.equal(JSON.parse(io2.out.stderr.at(-1)).error.code,
        'INVALID_ARGS');
    }
    const stale = await run([
      'task', 'reassess', '--project', dir, task.id,
      '--revision', '9', '--input', assessmentFile, '--apply',
    ], io);
    assert.equal(stale, 1);
    assert.equal(JSON.parse(io.out.stderr.at(-1)).error.code,
      'REVISION_MISMATCH');
    assert.throws(() => reassessTask(ctx,
      { id: task.id, expectedRevision: 0, methodology: lightAssessment(),
        extra: 1 }), { code: 'UNKNOWN_KEY' });
    assert.throws(() => reassessTask(ctx,
      { id: task.id, expectedRevision: 0, methodology: null }),
      { code: 'INVALID_VALUE' });
    assert.equal(getTask(ctx, task.id).revision, 0);
  } finally { cleanup(dir); }
});
