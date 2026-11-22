// SPDX-License-Identifier: Apache-2.0
// B1: evaluateMethodology admits schemaVersion 3 records that carry
// methodology metadata — same evaluation as V2 — while keeping manual-mode
// semantics for metadata-less V3 and fail-closed bounds for V1/V4+.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkMethodology, evaluateMethodology, evaluateTaskActions }
  from '../src/core/methodology.mjs';
import { transitionTask, updateTaskMeta } from '../src/core/transition.mjs';
import { prepareOutcomeEvidence } from '../src/core/outcomes.mjs';
import { createTask, getTask, taskFilePath } from '../src/core/tasks.mjs';
import fs from 'node:fs';
import {
  approve, assessment, formalFixture, seedState,
} from './methodology-fixtures.mjs';
import { bootstrappedCtx, cleanup } from './helpers.mjs';

const query = (f, input = {}) =>
  checkMethodology(f.ctx, { taskId: f.task.id, ...input });

// R1/S1: V3 + light assessment in organic-sdd evaluates like V2 -> light.
test('V3 with assessment is admitted as light in organic-sdd', () => {
  const f = bootstrappedCtx();
  try {
    f.ctx.config.methodology = 'organic-sdd';
    f.task = createTask(f.ctx, { title: 'V3 light', contract: 'C',
      authorContext: 'fixture-author', scope: ['src/a'],
      methodology: assessment(), type: 'feature' });
    assert.equal(getTask(f.ctx, f.task.id).schemaVersion, 3);
    const r = query(f);
    assert.equal(r.allowed, true, JSON.stringify(r.issues));
    assert.equal(r.route, 'light');
    assert.deepEqual(r.issues, []);
  } finally { cleanup(f.dir); }
});

// R1/S2: V3 + formal specId+designId pair with approvals -> sdd route.
test('V3 with approved formal pair evaluates as sdd', () => {
  const f = formalFixture();
  try {
    f.ctx.config.methodology = 'organic-sdd';
    // Re-create the fixture task as V3 keeping the same formal binding.
    const v3task = createTask(f.ctx, { title: 'V3 formal', contract: 'C',
      authorContext: 'fixture-author', scope: ['src/a'],
      specId: f.spec.artifact.id, designId: f.design.artifact.id,
      scenarioRefs: [{ requirementId: 'R1', scenarioId: 'S1' }],
      type: 'feature' });
    assert.equal(getTask(f.ctx, v3task.id).schemaVersion, 3);
    f.task = v3task;
    approve(f, 'task', v3task.id);
    const r = query(f);
    assert.equal(r.allowed, true, JSON.stringify(r.issues));
    assert.equal(r.route, 'sdd');
  } finally { cleanup(f.dir); }
});

// R2/S1: V3 without methodology and without formal pair is still blocked
// in enforced mode — admission must not become a bypass.
test('V3 without metadata is blocked in organic-sdd, not bypassed', () => {
  const f = bootstrappedCtx();
  try {
    // createTask itself rejects metadata-less tasks under organic-sdd;
    // the bare-V3 record arises via the V1-upgrade path, so it is created
    // in manual mode first and the mode is switched afterwards.
    f.ctx.config.methodology = 'manual';
    f.task = createTask(f.ctx, { title: 'V3 bare', contract: 'C',
      authorContext: 'fixture-author', scope: ['src/a'], type: 'ops' });
    assert.equal(getTask(f.ctx, f.task.id).schemaVersion, 3);
    f.ctx.config.methodology = 'organic-sdd';
    const r = query(f);
    assert.equal(r.allowed, false);
    assert.ok(r.issues.some((i) => i.code === 'METHODOLOGY_REQUIRED'
      && i.message.includes('specId+designId')),
      JSON.stringify(r.issues));
  } finally { cleanup(f.dir); }
});

// R3/S1: manual mode + V3 without methodology metadata stays manual —
// the V1-upgrade path observed in the wild must not regress.
test('manual mode keeps metadata-less V3 on the manual route', () => {
  const f = bootstrappedCtx();
  try {
    f.ctx.config.methodology = 'manual';
    f.task = createTask(f.ctx, { title: 'V3 bare manual', contract: 'C',
      authorContext: 'fixture-author', scope: [], type: 'ops' });
    const r = query(f);
    assert.deepEqual(r, { mode: 'manual', enforced: false, allowed: true,
      route: 'manual', classificationBasis: 'operator-attestation',
      issues: [], authenticatesEvidence: false,
      interceptsNativeTools: false });
  } finally { cleanup(f.dir); }
});

// R3/S2: manual mode + V3 that DOES carry methodology is enforced like V2.
test('manual mode enforces V3 records carrying methodology', () => {
  const f = bootstrappedCtx();
  try {
    f.ctx.config.methodology = 'manual';
    f.task = createTask(f.ctx, { title: 'V3 method manual', contract: 'C',
      authorContext: 'fixture-author', scope: ['src/a'],
      methodology: assessment(), type: 'feature' });
    const r = query(f);
    assert.equal(r.enforced, true);
    assert.equal(r.allowed, true, JSON.stringify(r.issues));
    assert.equal(r.route, 'light');
  } finally { cleanup(f.dir); }
});

// R4: regression — V2 behaviour unchanged (light assessment, organic-sdd).
test('V2 light assessment still allowed (regression)', () => {
  const f = bootstrappedCtx();
  try {
    f.ctx.config.methodology = 'organic-sdd';
    f.task = createTask(f.ctx, { title: 'V2 light', contract: 'C',
      authorContext: 'fixture-author', scope: ['src/a'],
      methodology: assessment() });
    assert.equal(getTask(f.ctx, f.task.id).schemaVersion, 2);
    const r = query(f);
    assert.equal(r.allowed, true, JSON.stringify(r.issues));
    assert.equal(r.route, 'light');
  } finally { cleanup(f.dir); }
});

// R4: fail-closed bounds — unknown future versions are rejected, never
// silently evaluated as if they were V2/V3. A V4 record cannot even be
// stored (validateTaskShape rejects it with TASK_MALFORMED), so the gate
// check is exercised directly on the evaluation seam.
test('schemaVersion 4 fails closed with METHODOLOGY_REQUIRED', () => {
  const f = bootstrappedCtx();
  try {
    f.ctx.config.methodology = 'organic-sdd';
    const r = evaluateMethodology(f.ctx, {
      schemaVersion: 4, methodology: assessment(), specId: null,
      designId: null, planKey: null, scenarioRefs: [], revision: 0,
      history: [],
    });
    assert.equal(r.allowed, false);
    assert.ok(r.issues.some((i) => i.code === 'METHODOLOGY_REQUIRED'
      && i.message.includes('V2 or V3')), JSON.stringify(r.issues));
  } finally { cleanup(f.dir); }
});

// The defect's real path: a V2 member of a formal plan upgraded to V3
// via task meta. static projection excludes V3 fields, so the upgrade
// keeps digests/approvals valid — and must not trip membership checks.
test('V3 member of a V2 formal plan passes membership check', () => {
  const f = formalFixture({ mini: false });
  try {
    f.ctx.config.methodology = 'organic-sdd';
    const member = getTask(f.ctx, f.formalPlan.tasks[0].id);
    const upgraded = updateTaskMeta(f.ctx, { id: member.id,
      expectedRevision: member.revision, set: { type: 'feature' } });
    assert.equal(upgraded.schemaVersion, 3);
    f.task = getTask(f.ctx, member.id);
    const r = query(f);
    assert.ok(!r.issues.some((i) => i.code === 'PLAN_MEMBERSHIP_INVALID'),
      JSON.stringify(r.issues));
  } finally { cleanup(f.dir); }
});

// Outcome evidence: a V3 formal task in REVIEW produces it; a V3 record
// without the formal pair is still rejected.
test('prepareOutcomeEvidence accepts V3 formal, rejects V3 without pair', () => {
  const f = formalFixture();
  try {
    f.ctx.config.methodology = 'organic-sdd';
    const seeded = seedState(f, f.task, 'REVIEW');
    const upgraded = updateTaskMeta(f.ctx, { id: seeded.id,
      expectedRevision: seeded.revision, set: { type: 'feature' } });
    assert.equal(upgraded.schemaVersion, 3);
    assert.equal(getTask(f.ctx, seeded.id).state, 'REVIEW');
    const p = prepareOutcomeEvidence(f.ctx, { taskId: seeded.id,
      title: 'V3 outcome', body: 'declared fixture outcome' });
    assert.ok(p.artifact && p.file);
  } finally { cleanup(f.dir); }
});

// The review blocker: a governed task with empty scope loses 'edit'.
// The shared predicate must remove it for V3 exactly as for V2, while a
// metadata-less V3 in manual mode keeps it.
test('governed V3 with empty scope loses edit like V2', () => {
  const f = bootstrappedCtx();
  try {
    f.ctx.config.methodology = 'organic-sdd';
    const v3 = createTask(f.ctx, { title: 'V3 empty scope', contract: 'C',
      authorContext: 'fixture-author', scope: [],
      methodology: assessment(), type: 'feature' });
    const v2 = createTask(f.ctx, { title: 'V2 empty scope', contract: 'C',
      authorContext: 'fixture-author', scope: [],
      methodology: assessment() });
    for (const t of [v3, v2]) {
      transitionTask(f.ctx, { id: t.id, to: 'ACT', expectedRevision: 0 });
      const { permitted } =
        evaluateTaskActions(f.ctx, getTask(f.ctx, t.id));
      assert.ok(!permitted.includes('edit'),
        `schemaVersion ${t.schemaVersion} must lose edit`);
    }
  } finally { cleanup(f.dir); }
});

test('metadata-less V3 in manual mode keeps edit', () => {
  const f = bootstrappedCtx();
  try {
    f.ctx.config.methodology = 'manual';
    const t = createTask(f.ctx, { title: 'V3 bare edit', contract: 'C',
      authorContext: 'fixture-author', scope: [], type: 'ops' });
    transitionTask(f.ctx, { id: t.id, to: 'ACT', expectedRevision: 0 });
    const { permitted } =
      evaluateTaskActions(f.ctx, getTask(f.ctx, t.id));
    assert.ok(permitted.includes('edit'));
  } finally { cleanup(f.dir); }
});

test('V3 without formal pair cannot produce outcome evidence', () => {
  const f = bootstrappedCtx();
  try {
    f.ctx.config.methodology = 'manual';
    f.task = createTask(f.ctx, { title: 'V3 bare outcome', contract: 'C',
      authorContext: 'fixture-author', scope: [], type: 'ops' });
    assert.throws(() => prepareOutcomeEvidence(f.ctx, {
      taskId: f.task.id, title: 'x', body: 'y' }),
      /not a formal/);
  } finally { cleanup(f.dir); }
});
