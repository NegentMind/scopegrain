// SPDX-License-Identifier: Apache-2.0
// Batch approval resolution under policy/auto-approve.json: the closed
// enum is the only authority — covered targets are answered through the
// same locked CAS path with rule origin in the audit comment, and
// everything outside the enum is skipped, never auto-approved.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { applyPlan } from '../src/core/bootstrap.mjs';
import { createTask } from '../src/core/tasks.mjs';
import { prepareArtifact } from '../src/core/artifacts.mjs';
import {
  answerApprovalBatch, describeApprovalTarget, getApproval,
  loadAutoApprovePolicy, prepareApproval, prepareApprovalBatch,
} from '../src/core/approvals.mjs';
import {
  bootstrappedMiniCtx, cleanup, trySymlink, writeJson, writeFile,
} from './helpers.mjs';

function policyRoot(dir, rules) {
  const root = path.join(dir, 'policy-root');
  writeJson(root, 'policy/auto-approve.json',
    { schemaVersion: 1, rules });
  return root;
}

function makeArtifact(ctx, dir, kind, title) {
  const p = prepareArtifact(ctx, kind,
    { title, body: `body ${title}`, references: [] });
  applyPlan(dir, [p.file]);
  return p.artifact;
}

function makeApprovalFor(ctx, dir, target) {
  const p = prepareApproval(ctx, { target });
  applyPlan(dir, [p.file]);
  return p.approval;
}

function artifactTarget(ctx, artifactKind, id) {
  return describeApprovalTarget(ctx,
    { kind: 'artifact', artifactKind, id }).target;
}

const RULES = [
  { id: 'draft-reports', target: { kind: 'artifact', artifactKind: 'report' } },
];

test('batch by match answers covered pending approvals, skips the rest', () => {
  const { dir, ctx } = bootstrappedMiniCtx();
  try {
    const installRoot = policyRoot(dir, RULES);
    const r1 = makeArtifact(ctx, dir, 'report', 'r1');
    const r2 = makeArtifact(ctx, dir, 'report', 'r2');
    const lesson = makeArtifact(ctx, dir, 'lesson', 'l1');
    const task = createTask(ctx, {
      title: 't', contract: 'c', authorContext: 'a', scope: [] });
    const a1 = makeApprovalFor(ctx, dir,
      artifactTarget(ctx, 'report', r1.id));
    const a2 = makeApprovalFor(ctx, dir,
      artifactTarget(ctx, 'report', r2.id));
    const a3 = makeApprovalFor(ctx, dir,
      artifactTarget(ctx, 'lesson', lesson.id));
    const a4 = makeApprovalFor(ctx, dir,
      describeApprovalTarget(ctx, { kind: 'task', id: task.id }).target);

    // Dry-run: previews decisions, writes nothing.
    const preview = prepareApprovalBatch(ctx, {
      match: { kind: 'artifact' }, answer: 'approve', actor: 'tester',
    }, { installRoot });
    assert.equal(preview.summary.answerable, 2);
    // The task-kind approval is filtered by match.kind, not a
    // candidate at all — only the uncovered artifact is skipped.
    assert.equal(preview.summary.skipped, 1);
    assert.ok(!preview.items.some((i) => i.id === a4.id));
    for (const id of [a1.id, a2.id, a3.id, a4.id]) {
      assert.equal(getApproval(ctx, id).status, 'pending');
    }
    const skipped = new Map(preview.items
      .filter((i) => i.disposition === 'skipped')
      .map((i) => [i.id, i.reason]));
    assert.equal(skipped.get(a3.id), 'not-covered-by-policy');
    // The uncovered target is reported for audit, not hidden.
    assert.deepEqual(preview.items.find((i) => i.id === a3.id).target,
      { kind: 'artifact', artifactKind: 'lesson' });

    const out = answerApprovalBatch(ctx, {
      match: { kind: 'artifact' }, answer: 'approve', actor: 'tester',
    }, { installRoot });
    assert.equal(out.summary.answered, 2);
    assert.equal(out.summary.errors, 0);
    for (const id of [a1.id, a2.id]) {
      const stored = getApproval(ctx, id);
      assert.equal(stored.status, 'approved');
      assert.equal(stored.revision, 1);
      // Rule origin is recorded in the audit history.
      assert.equal(stored.history[1].comment, 'rule:draft-reports');
      assert.equal(stored.history[1].actor, 'tester');
    }
    // Uncovered approvals stay pending — nothing outside the enum.
    assert.equal(getApproval(ctx, a3.id).status, 'pending');
    assert.equal(getApproval(ctx, a4.id).status, 'pending');
  } finally { cleanup(dir); }
});

test('empty policy is fail-closed: nothing is batch-answerable', () => {
  const { dir, ctx } = bootstrappedMiniCtx();
  try {
    const installRoot = policyRoot(dir, []);
    const r = makeArtifact(ctx, dir, 'report', 'r');
    const a = makeApprovalFor(ctx, dir,
      artifactTarget(ctx, 'report', r.id));
    const out = answerApprovalBatch(ctx, {
      match: {}, answer: 'approve', actor: 'tester',
    }, { installRoot });
    assert.equal(out.summary.answered, 0);
    assert.equal(out.items[0].reason, 'not-covered-by-policy');
    assert.equal(getApproval(ctx, a.id).status, 'pending');
    // Absent file degrades to empty policy, not an error.
    const absent = prepareApprovalBatch(ctx, {
      match: {}, answer: 'approve', actor: 'tester',
    }, { installRoot: path.join(dir, 'no-such-root') });
    assert.equal(absent.summary.answerable, 0);
  } finally { cleanup(dir); }
});

test('batch by ids: explicit list, missing and non-pending reported', () => {
  const { dir, ctx } = bootstrappedMiniCtx();
  try {
    const installRoot = policyRoot(dir, RULES);
    const r = makeArtifact(ctx, dir, 'report', 'r');
    const a = makeApprovalFor(ctx, dir,
      artifactTarget(ctx, 'report', r.id));
    const ghost = 'f'.repeat(64);
    const out = answerApprovalBatch(ctx, {
      ids: [a.id, ghost], answer: 'reject',
      actor: 'tester', comment: 'nope',
    }, { installRoot });
    const byId = new Map(out.items.map((i) => [i.id, i]));
    assert.equal(byId.get(a.id).disposition, 'answered');
    assert.equal(byId.get(ghost).reason, 'not-found');
    const stored = getApproval(ctx, a.id);
    assert.equal(stored.status, 'rejected');
    assert.equal(stored.history[1].comment, 'nope | rule:draft-reports');
    // A second batch over the now-answered record skips it honestly.
    const again = prepareApprovalBatch(ctx, {
      ids: [a.id], answer: 'approve', actor: 'tester',
    }, { installRoot });
    assert.equal(again.items[0].reason, 'not-pending:rejected');
  } finally { cleanup(dir); }
});

test('batch input boundary: closed keys, one selector, bounded answers', () => {
  const { dir, ctx } = bootstrappedMiniCtx();
  try {
    const installRoot = policyRoot(dir, RULES);
    const bad = (input, why) => assert.throws(
      () => prepareApprovalBatch(ctx, input, { installRoot }),
      (e) => e.code === 'APPROVAL_INVALID', why);
    bad({ match: {}, ids: ['a'.repeat(64)], answer: 'approve', actor: 't' },
      'match and ids are exclusive');
    bad({ match: {}, answer: 'approve', actor: 't', extra: 1 },
      'closed input keys');
    bad({ match: { bogus: 1 }, answer: 'approve', actor: 't' },
      'closed match keys');
    bad({ match: {}, answer: 'revoke', actor: 't' },
      'revoke stays single-shot');
    bad({ match: {}, answer: 'custom', actor: 't' },
      'custom requires a real comment');
    bad({ match: { status: 'approved' }, answer: 'approve', actor: 't' },
      'batch resolves pending only');
    bad({ ids: [], answer: 'approve', actor: 't' }, 'ids must be non-empty');
    bad({ ids: ['notasha'], answer: 'approve', actor: 't' },
      'ids must be digests');
    bad({ match: { kind: 'task', artifactKind: 'lesson' },
      answer: 'approve', actor: 't' },
      'artifactKind requires kind artifact');
  } finally { cleanup(dir); }
});

test('malformed policy fails closed, rule target shapes are enforced', () => {
  const { dir, ctx } = bootstrappedMiniCtx();
  try {
    for (const [rules, why] of [
      [[{ id: 'x' }], 'target required'],
      [[{ id: 'X', target: { kind: 'task' } }], 'id must be a slug'],
      [[{ id: 'a', target: { kind: 'task', artifactKind: 'lesson' } }],
        'task target must be {kind} only'],
      [[{ id: 'a', target: { kind: 'artifact', artifactKind: 'bogus' } }],
        'artifactKind must be a known kind'],
      [[{ id: 'a', target: { kind: 'task' } },
        { id: 'a', target: { kind: 'plan' } }], 'rule ids unique'],
    ]) {
      const installRoot = policyRoot(dir, rules);
      assert.throws(
        () => loadAutoApprovePolicy({ installRoot }),
        (e) => e.code === 'POLICY_MALFORMED', why);
    }
    const badDoc = path.join(dir, 'bad-policy');
    writeJson(badDoc, 'policy/auto-approve.json',
      { schemaVersion: 1, rules: [], extra: 1 });
    assert.throws(() => loadAutoApprovePolicy({ installRoot: badDoc }),
      (e) => e.code === 'POLICY_MALFORMED');
    // A non-regular policy file (symlink, dir, fifo) fails closed —
    // it is never silently treated as absent. Symlinks need privileges
    // on Windows; a directory exercises the same !isFile() branch.
    const linked = path.join(dir, 'linked-policy');
    writeJson(linked, 'policy/real.json', { schemaVersion: 1, rules: [] });
    if (!trySymlink(path.join(linked, 'policy/real.json'),
      path.join(linked, 'policy/auto-approve.json'), 'file')) {
      fs.mkdirSync(path.join(linked, 'policy/auto-approve.json'));
    }
    assert.throws(() => loadAutoApprovePolicy({ installRoot: linked }),
      (e) => e.code === 'POLICY_MALFORMED');
  } finally { cleanup(dir); }
});

test('batch answers decline and custom; task-kind rules match', () => {
  const { dir, ctx } = bootstrappedMiniCtx();
  try {
    const installRoot = policyRoot(dir, [
      ...RULES,
      { id: 'task-gate', target: { kind: 'task' } },
    ]);
    const r = makeArtifact(ctx, dir, 'report', 'r');
    const task = createTask(ctx, {
      title: 't', contract: 'c', authorContext: 'a', scope: [] });
    const aR = makeApprovalFor(ctx, dir,
      artifactTarget(ctx, 'report', r.id));
    const aT = makeApprovalFor(ctx, dir,
      describeApprovalTarget(ctx, { kind: 'task', id: task.id }).target);
    const out = answerApprovalBatch(ctx, {
      match: {}, answer: 'decline', actor: 'tester',
      comment: 'not yet',
    }, { installRoot });
    assert.equal(out.summary.answered, 2);
    assert.equal(getApproval(ctx, aR.id).status, 'declined');
    const stored = getApproval(ctx, aT.id);
    assert.equal(stored.status, 'declined');
    assert.equal(stored.history[1].comment, 'not yet | rule:task-gate');
    // custom -> needs-clarification requires the real user comment.
    const r2 = makeArtifact(ctx, dir, 'report', 'r2');
    const aR2 = makeApprovalFor(ctx, dir,
      artifactTarget(ctx, 'report', r2.id));
    const c = answerApprovalBatch(ctx, {
      ids: [aR2.id], answer: 'custom', actor: 'tester',
      comment: 'expand section 3',
    }, { installRoot });
    assert.equal(c.summary.answered, 1);
    const cl = getApproval(ctx, aR2.id);
    assert.equal(cl.status, 'needs-clarification');
    assert.equal(cl.history[1].comment,
      'expand section 3 | rule:draft-reports');
  } finally { cleanup(dir); }
});

test('match by artifactKind alone selects only that kind', () => {
  const { dir, ctx } = bootstrappedMiniCtx();
  try {
    const installRoot = policyRoot(dir, RULES);
    const r = makeArtifact(ctx, dir, 'report', 'r');
    const l = makeArtifact(ctx, dir, 'lesson', 'l');
    const aR = makeApprovalFor(ctx, dir,
      artifactTarget(ctx, 'report', r.id));
    const aL = makeApprovalFor(ctx, dir,
      artifactTarget(ctx, 'lesson', l.id));
    const out = prepareApprovalBatch(ctx, {
      match: { artifactKind: 'report' }, answer: 'approve',
      actor: 'tester',
    }, { installRoot });
    assert.equal(out.summary.candidates, 1);
    assert.equal(out.items[0].id, aR.id);
    assert.ok(!out.items.some((i) => i.id === aL.id));
  } finally { cleanup(dir); }
});

test('malformed store entries are surfaced, never silently skipped', () => {
  const { dir, ctx } = bootstrappedMiniCtx();
  try {
    const installRoot = policyRoot(dir, RULES);
    // Plant an unreadable record, a non-sha filename and a non-regular
    // entry next to the real store — all land in malformed[].
    writeFile(dir, '.scopegrain/decisions/approvals/notasha.json', '{}');
    writeFile(dir, `.scopegrain/decisions/approvals/${'e'.repeat(64)}.json`,
      '{corrupt json');
    fs.mkdirSync(path.join(dir,
      '.scopegrain/decisions/approvals/ghost.json'));
    const r = makeArtifact(ctx, dir, 'report', 'r');
    makeApprovalFor(ctx, dir, artifactTarget(ctx, 'report', r.id));
    const out = prepareApprovalBatch(ctx, {
      match: {}, answer: 'approve', actor: 'tester',
    }, { installRoot });
    assert.equal(out.malformed.length, 3);
    assert.ok(out.malformed.some(
      (m) => m.error === 'not a regular file'));
    assert.equal(out.summary.candidates, 1);
    // Enumeration completeness is disclosed.
    assert.equal(out.truncated, false);
  } finally { cleanup(dir); }
});

test('duplicate ids are skipped, not double-applied', () => {
  const { dir, ctx } = bootstrappedMiniCtx();
  try {
    const installRoot = policyRoot(dir, RULES);
    const r = makeArtifact(ctx, dir, 'report', 'r');
    const a = makeApprovalFor(ctx, dir,
      artifactTarget(ctx, 'report', r.id));
    const out = answerApprovalBatch(ctx, {
      ids: [a.id, a.id], answer: 'approve', actor: 'tester',
    }, { installRoot });
    assert.equal(out.summary.answered, 1);
    const dup = out.items.find((i) => i.reason === 'duplicate');
    assert.ok(dup);
    assert.equal(getApproval(ctx, a.id).revision, 1);
  } finally { cleanup(dir); }
});
