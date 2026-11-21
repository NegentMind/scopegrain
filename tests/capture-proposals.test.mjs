// SPDX-License-Identifier: Apache-2.0
// Selective capture producers: pure proposals from committed journal
// operations and explicit init answers, plus a pure review gate. Producers
// never write, never intercept conversations and never promote inference.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { applyPlan } from '../src/core/bootstrap.mjs';
import { createConfig } from '../src/core/config.mjs';
import { resolveContext } from '../src/core/context.mjs';
import { bindWorkspace, prepareWorkspace } from '../src/core/workspaces.mjs';
import {
  applyJournaledCreation, getJournalOperation, recoverJournalOperation,
} from '../src/core/journal.mjs';
import { createCaptureStore } from '../src/core/captures.mjs';
import {
  proposeFromInitAnswers, proposeFromJournal, reviewProposal,
  validateProposal,
} from '../src/core/capture-proposals.mjs';
import {
  VALID_ANSWERS, cleanup, makeTempDir, writeJson,
} from './helpers.mjs';

const json = (value) => JSON.stringify(value, null, 2) + '\n';
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function fixture({ state = '.tasksystem/state', memory = '.tasksystem/memory',
  configRel = '.tasksystem/config.json' } = {}) {
  const dir = makeTempDir('proposals');
  const answers = { ...VALID_ANSWERS,
    paths: { ...VALID_ANSWERS.paths, state, memory } };
  writeJson(dir, configRel, createConfig(dir, answers, {}));
  const ctx = resolveContext({ project: dir, config: configRel });
  const prepared = prepareWorkspace(ctx, {
    areas: [{ key: 'alpha', name: 'Alpha' }, { key: 'beta', name: 'Beta' }],
  });
  applyPlan(dir, [prepared.file]);
  const [a, b] = prepared.workspace.areas.map((area) => area.id);
  const bound = bindWorkspace(ctx, { areaIds: [a, b] });
  const alphaBound = bindWorkspace(ctx, { areaIds: [a] });
  const store = createCaptureStore(ctx, { areaIds: [a, b], origin: 'local-cli' });
  return {
    dir, ctx, a, b, bound, alphaBound, store, memory, state,
    journalDir: path.join(dir, ...state.split('/'), 'journal'),
  };
}

function tree(dir) {
  const values = {};
  function visit(root, rel = '') {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      const abs = path.join(root, entry.name);
      if (entry.isDirectory()) { values[next] = 'directory'; visit(abs, next); }
      else values[next] = fs.readFileSync(abs);
    }
  }
  if (fs.existsSync(dir)) visit(dir);
  return values;
}

function captureInput(f, overrides = {}) {
  return { category: 'decision', title: 'Chose X', summary: 'Because Y',
    areaIds: [f.a, f.b], basis: 'declared', subjectId: null,
    supersedes: null, ...overrides };
}

const answersAll = {
  ...VALID_ANSWERS,
  methodology: 'organic-sdd',
  versioning: { plans: true, tasks: false, reports: true, reviews: false,
    research: false, decisions: true, memory: false, state: false },
};

test('empty journal yields zero proposals for bound and ctx targets', () => {
  const f = fixture();
  try {
    assert.deepEqual(proposeFromJournal(f.bound), []);
    assert.deepEqual(proposeFromJournal(f.ctx), []);
  } finally { cleanup(f.dir); }
});

test('committed capture creation yields one declared event proposal; '
    + 'record-ownership companion never proposes alone', () => {
  const f = fixture();
  try {
    const created = f.store.create(captureInput(f));
    const proposals = proposeFromJournal(f.bound);
    // Exactly one proposal: the capture event. The record-ownership
    // companion event is metadata, not proposal material.
    assert.equal(proposals.length, 1);
    const p = proposals[0];
    assert.doesNotThrow(() => validateProposal(p));
    assert.equal(p.schemaVersion, 1);
    assert.match(p.proposalId, UUID);
    assert.equal(p.category, 'event');
    assert.equal(p.statement.kind, 'declared');
    assert.equal(p.statement.inference, null);
    assert.ok(p.statement.title.trim() !== '');
    assert.ok(p.statement.text.includes(created.record.id));
    assert.equal(p.provenance.producer, 'journal');
    assert.equal(p.provenance.operationId, created.journal.operationId);
    assert.equal(p.provenance.sourceKind, 'capture');
    assert.equal(p.provenance.recordId, created.record.id);
    const op = getJournalOperation(f.bound, created.journal.operationId);
    const captureEvent = op.intent.events.find(
      (e) => e.sourceKind === 'capture');
    assert.equal(p.provenance.eventId, captureEvent.eventId);
    assert.deepEqual(p.suggestedAreaIds, [f.a, f.b].sort());
    assert.equal(p.suggestedSubjectId, null);
    assert.ok(Array.isArray(p.evidence) && p.evidence.length >= 1);
    // Deterministic ids: repeated calls dedupe naturally.
    const again = proposeFromJournal(f.bound);
    assert.deepEqual(again.map((x) => x.proposalId),
      proposals.map((x) => x.proposalId));
    assert.deepEqual(again, proposals);
  } finally { cleanup(f.dir); }
});

test('ctx target binds all enrolled areas; arbitrary sourceKinds map '
    + 'to declared event proposals', () => {
  const f = fixture();
  try {
    const made = applyJournaledCreation(f.bound, [
      { sourceKind: 'spec', recordId: 'spec-1', sourceRevision: 0,
        areaIds: [f.a],
        file: { rel: `${f.memory}/misc/spec-1.json`, content: json({ a: 1 }) } },
      { sourceKind: 'task', recordId: 'task-1', sourceRevision: 0,
        areaIds: [f.b],
        file: { rel: `${f.memory}/misc/task-1.json`, content: json({ b: 2 }) } },
    ]);
    assert.equal(made.status, 'committed');
    const proposals = proposeFromJournal(f.ctx);
    assert.equal(proposals.length, 2);
    const kinds = proposals.map((p) => p.provenance.sourceKind).sort();
    assert.deepEqual(kinds, ['spec', 'task']);
    for (const p of proposals) {
      assert.equal(p.category, 'event');
      assert.equal(p.statement.kind, 'declared');
      assert.equal(p.provenance.operationId, made.operationId);
      assert.ok(p.statement.text.includes(p.provenance.recordId));
    }
  } finally { cleanup(f.dir); }
});

test('prepared (uncommitted) operations produce no proposals', () => {
  const f = fixture();
  try {
    const created = f.store.create(captureInput(f));
    const commitAbs = path.join(f.journalDir, 'operations',
      created.journal.operationId, 'commit.json');
    fs.unlinkSync(commitAbs);
    assert.deepEqual(proposeFromJournal(f.bound), []);
  } finally { cleanup(f.dir); }
});

test('sinceSequence and sinceOperationId filter committed events', () => {
  const f = fixture();
  try {
    const first = f.store.create(captureInput(f, { title: 'first' }));
    const second = f.store.create(captureInput(f, { title: 'second' }));
    const op1 = getJournalOperation(f.bound, first.journal.operationId);
    const maxSeq1 = Math.max(
      ...op1.intent.events.map((e) => e.journalSequence));
    const all = proposeFromJournal(f.bound);
    assert.equal(all.length, 2);
    const after = proposeFromJournal(f.bound, { sinceSequence: maxSeq1 });
    assert.equal(after.length, 1);
    assert.equal(after[0].provenance.operationId, second.journal.operationId);
    const afterOp = proposeFromJournal(f.bound,
      { sinceOperationId: first.journal.operationId });
    assert.deepEqual(afterOp.map((p) => p.proposalId),
      after.map((p) => p.proposalId));
    const zero = proposeFromJournal(f.bound, { sinceSequence: maxSeq1 + 10 });
    assert.deepEqual(zero, []);
    for (const bad of [{ sinceSequence: 1, sinceOperationId: first.journal.operationId },
      { sinceSequence: -1 }, { sinceSequence: 1.5 }, { sinceOperationId: 'x' },
      { limit: 0 }, { limit: 'x' }, { bogus: 1 }]) {
      assert.throws(() => proposeFromJournal(f.bound, bad),
        (e) => e.code === 'INVALID_PROPOSAL');
    }
    assert.throws(() => proposeFromJournal(null),
      (e) => e.code === 'INVALID_PROPOSAL');
    assert.throws(() => proposeFromJournal(f.bound, null),
      (e) => e.code === 'INVALID_PROPOSAL');
    assert.throws(() => proposeFromJournal(f.bound,
      { sinceOperationId: '99999999-9999-9999-9999-999999999999' }),
      (e) => e.code === 'JOURNAL_NOT_FOUND');
  } finally { cleanup(f.dir); }
});

test('scoped binding only proposes events it is authorized to see', () => {
  const f = fixture();
  try {
    f.store.create(captureInput(f)); // [a,b] scope - denied for alpha
    const alphaStore = createCaptureStore(f.ctx,
      { areaIds: [f.a], origin: 'local-cli' });
    const alphaOnly = alphaStore.create(
      captureInput(f, { areaIds: [f.a], title: 'alpha' }));
    const full = proposeFromJournal(f.bound);
    assert.equal(full.length, 2);
    const scoped = proposeFromJournal(f.alphaBound);
    assert.equal(scoped.length, 1);
    assert.equal(scoped[0].provenance.recordId, alphaOnly.record.id);
    assert.deepEqual(scoped[0].suggestedAreaIds, [f.a]);
  } finally { cleanup(f.dir); }
});

test('a committed operation carrying a recovery receipt also yields a '
    + 'declared decision proposal', () => {
  const f = fixture();
  try {
    const made = applyJournaledCreation(f.bound, [
      { sourceKind: 'spec', recordId: 'spec-9', sourceRevision: 0,
        areaIds: [f.a],
        file: { rel: `${f.memory}/misc/spec-9.json`, content: json({ a: 1 }) } },
    ]);
    const loaded = getJournalOperation(f.bound, made.operationId);
    const recovered = recoverJournalOperation(f.bound, made.operationId, {
      action: 'finalize-committed', expectedIntentDigest: loaded.intentDigest,
      reason: 'explicit test finalization' });
    assert.equal(recovered.mode, 'applied');
    const proposals = proposeFromJournal(f.bound);
    const decision = proposals.find((p) => p.category === 'decision');
    assert.ok(decision);
    assert.equal(decision.statement.kind, 'declared');
    assert.ok(decision.statement.text.includes('finalize-committed'));
    assert.equal(decision.provenance.operationId, made.operationId);
    assert.equal(decision.provenance.eventId, null);
    assert.equal(decision.provenance.sourceKind, null);
    assert.equal(decision.provenance.recordId, null);
  } finally { cleanup(f.dir); }
});

test('proposeFromInitAnswers: explicit answers are declared preferences '
    + 'with deterministic ids', () => {
  const a = '11111111-1111-4111-8111-111111111111';
  const proposals = proposeFromInitAnswers(answersAll,
    { areaIds: [a], subjectId: 'owner' });
  // locale + hosts + methodology + 8 versioning keys = 11
  assert.equal(proposals.length, 11);
  for (const p of proposals) {
    assert.doesNotThrow(() => validateProposal(p));
    assert.equal(p.category, 'preference');
    assert.equal(p.statement.kind, 'declared');
    assert.equal(p.statement.inference, null);
    assert.equal(p.provenance.producer, 'init-answers');
    assert.equal(p.provenance.operationId, null);
    assert.deepEqual(p.suggestedAreaIds, [a]);
    assert.equal(p.suggestedSubjectId, 'owner');
  }
  const texts = proposals.map((p) => p.statement.text).join('\n');
  assert.ok(texts.includes('es'));
  assert.ok(texts.includes('organic-sdd'));
  assert.ok(texts.includes('plans'));
  const again = proposeFromInitAnswers(answersAll,
    { areaIds: [a], subjectId: 'owner' });
  assert.deepEqual(again.map((p) => p.proposalId),
    proposals.map((p) => p.proposalId));
  // Options are optional; without them areaIds stay empty and each
  // subject defaults to the answered setting's key.
  const bare = proposeFromInitAnswers(answersAll);
  assert.equal(bare.length, 11);
  assert.deepEqual(bare[0].suggestedAreaIds, []);
  assert.equal(bare[0].suggestedSubjectId, 'locale');
  for (const bad of [{ areaIds: 'x' }, { areaIds: ['x'] }, { bogus: 1 }]) {
    assert.throws(() => proposeFromInitAnswers(answersAll, bad),
      (e) => e.code === 'INVALID_PROPOSAL');
  }
});

test('proposeFromInitAnswers: absent methodology/versioning are inferred '
    + 'with the derivation named, never declared', () => {
  const proposals = proposeFromInitAnswers(VALID_ANSWERS);
  // locale + hosts + inferred methodology + inferred versioning = 4
  assert.equal(proposals.length, 4);
  const inferred = proposals.filter((p) => p.statement.kind === 'inferred');
  assert.equal(inferred.length, 2);
  for (const p of inferred) {
    assert.ok(typeof p.statement.inference === 'string'
      && p.statement.inference.trim() !== '');
  }
  const declared = proposals.filter((p) => p.statement.kind === 'declared');
  assert.equal(declared.length, 2);
});

test('approve yields a capture-ready wrapped DTO the real store consumes', () => {
  const f = fixture();
  try {
    f.store.create(captureInput(f));
    const [p] = proposeFromJournal(f.bound);
    const before = tree(f.dir);
    const review = reviewProposal(p, { action: 'approve' });
    assert.equal(review.status, 'approved');
    assert.deepEqual(Object.keys(review.input).sort(), ['areaIds', 'capture']);
    assert.deepEqual(review.input.areaIds, [f.a, f.b].sort());
    const cap = review.input.capture;
    assert.deepEqual(Object.keys(cap).sort(),
      ['basis', 'category', 'subjectId', 'summary', 'supersedes', 'title']);
    assert.equal(cap.basis, 'declared');
    assert.equal(cap.supersedes, null);
    // The DTO is directly consumable: flatten wrapped shape for the store.
    const applied = f.store.create({ ...cap, areaIds: review.input.areaIds });
    assert.equal(applied.mode, 'applied');
    assert.equal(applied.record.category, 'event');
    assert.equal(applied.record.provenance.basis, 'declared');
    // reviewProposal itself wrote nothing.
    const after = tree(f.dir);
    const added = Object.keys(after).filter((k) => !(k in before));
    for (const rel of added) {
      assert.ok(rel.includes('captures/') || rel.includes('record-ownership/')
        || rel.includes('journal/'), `unexpected write: ${rel}`);
    }
  } finally { cleanup(f.dir); }
});

test('reject produces nothing; inferred approval never promotes basis', () => {
  const a = '11111111-1111-4111-8111-111111111111';
  const inferred = proposeFromInitAnswers(VALID_ANSWERS,
    { areaIds: [a], subjectId: 'owner' })
    .find((p) => p.statement.kind === 'inferred');
  assert.ok(inferred);
  const rejected = reviewProposal(inferred, { action: 'reject' });
  assert.deepEqual(rejected, { status: 'rejected' });
  assert.equal(rejected.input, undefined);
  // Approving an inferred proposal keeps basis inferred: no promotion.
  const approved = reviewProposal(inferred, { action: 'approve' });
  assert.equal(approved.status, 'approved');
  assert.equal(approved.input.capture.basis, 'inferred');
  // changes are forbidden on approve - never silently ignored.
  assert.throws(() => reviewProposal(inferred,
    { action: 'approve', changes: { title: 'x' } }),
    (e) => e.code === 'INVALID_PROPOSAL');
});

test('edit applies operator changes and re-marks basis declared', () => {
  const a = '11111111-1111-4111-8111-111111111111';
  const inferred = proposeFromInitAnswers(VALID_ANSWERS,
    { areaIds: [a], subjectId: 'owner' })
    .find((p) => p.statement.kind === 'inferred');
  const reviewed = reviewProposal(inferred, { action: 'edit',
    changes: { title: 'Manual default', summary: 'Reviewed default' } });
  assert.equal(reviewed.status, 'approved');
  assert.equal(reviewed.input.capture.basis, 'declared');
  assert.equal(reviewed.input.capture.title, 'Manual default');
  assert.equal(reviewed.input.capture.summary, 'Reviewed default');
  assert.equal(reviewed.input.capture.subjectId, 'owner');
  // Editing a declared proposal also yields declared (operator-authored).
  const declared = proposeFromInitAnswers(answersAll,
    { areaIds: [a], subjectId: 'owner' })[0];
  const edited = reviewProposal(declared, { action: 'edit',
    changes: { category: 'lesson', subjectId: null } });
  assert.equal(edited.input.capture.basis, 'declared');
  assert.equal(edited.input.capture.category, 'lesson');
});

test('approve fails closed on proposals that cannot form a valid '
    + 'capture input', () => {
  const a = '11111111-1111-4111-8111-111111111111';
  // Without areas a proposal cannot be approved, whatever its subject.
  const bare = proposeFromInitAnswers(VALID_ANSWERS)[0];
  assert.throws(() => reviewProposal(bare, { action: 'approve' }),
    (e) => e.code === 'INVALID_CAPTURE_INPUT');
  const withSubject = proposeFromInitAnswers(VALID_ANSWERS,
    { subjectId: 'owner' })[0];
  assert.throws(() => reviewProposal(withSubject, { action: 'approve' }),
    (e) => e.code === 'INVALID_CAPTURE_INPUT'); // still no areas
  // The producer default never weakens the capture contract: a proposal
  // carrying a null suggestedSubjectId still fails closed on approve.
  const noSubject = proposeFromInitAnswers(VALID_ANSWERS, { areaIds: [a] })[0];
  noSubject.suggestedSubjectId = null;
  assert.throws(() => reviewProposal(noSubject, { action: 'approve' }),
    (e) => e.code === 'INVALID_CAPTURE_INPUT');
  const ready = proposeFromInitAnswers(VALID_ANSWERS,
    { areaIds: [a], subjectId: 'o' })[0];
  assert.equal(reviewProposal(ready, { action: 'approve' }).status,
    'approved');
});

test('system-generated preference proposals approve verbatim: subject '
    + 'defaults to the answered setting (regression)', () => {
  const f = fixture();
  try {
    // Exactly what `capture proposals` emits: enrolled areaIds, no
    // subjectId option. Approving verbatim used to throw
    // INVALID_CAPTURE_INPUT (preference requires a nonblank subjectId).
    const proposals = proposeFromInitAnswers(answersAll, { areaIds: [f.a] });
    assert.equal(proposals.length, 11);
    const subjects = proposals.map((p) => p.suggestedSubjectId);
    for (const p of proposals) {
      assert.equal(typeof p.suggestedSubjectId, 'string');
      assert.ok(p.suggestedSubjectId.trim() !== '');
      const review = reviewProposal(p, { action: 'approve' });
      assert.equal(review.status, 'approved');
      assert.equal(review.input.capture.subjectId, p.suggestedSubjectId);
    }
    // One stable subject per answered setting: the answer key itself.
    assert.deepEqual(subjects, ['locale', 'hosts', 'methodology',
      'versioning.plans', 'versioning.tasks', 'versioning.reports',
      'versioning.reviews', 'versioning.research', 'versioning.decisions',
      'versioning.memory', 'versioning.state']);
    // Deterministic: same answers, same subjects and proposal ids.
    assert.deepEqual(proposeFromInitAnswers(answersAll, { areaIds: [f.a] })
      .map((p) => [p.proposalId, p.suggestedSubjectId]),
      proposals.map((p) => [p.proposalId, p.suggestedSubjectId]));
    // The reviewed DTO is consumable by the real store: the
    // `capture review --apply` path works without an edit decision.
    const review = reviewProposal(proposals[0], { action: 'approve' });
    const applied = f.store.create(
      { ...review.input.capture, areaIds: review.input.areaIds });
    assert.equal(applied.mode, 'applied');
    assert.equal(applied.record.category, 'preference');
    assert.equal(applied.record.subjectId, 'locale');
    assert.equal(applied.record.provenance.basis, 'declared');
  } finally { cleanup(f.dir); }
});

test('malformed proposals, decisions and hostile objects are rejected', () => {
  const f = fixture();
  try {
    f.store.create(captureInput(f));
    const [p] = proposeFromJournal(f.bound);
    for (const bad of [null, [], 'x', { ...p, extra: 1 },
      { ...p, proposalId: 'x' }, { ...p, category: 'other' },
      { ...p, statement: { ...p.statement, kind: 'guessed' } },
      { ...p, suggestedAreaIds: 'x' }, { ...p, evidence: [] }]) {
      assert.throws(() => reviewProposal(bad, { action: 'approve' }),
        (e) => e.code === 'INVALID_PROPOSAL');
      assert.throws(() => validateProposal(bad),
        (e) => e.code === 'INVALID_PROPOSAL');
    }
    for (const bad of [null, [], { action: 'maybe' },
      { action: 'edit' }, // missing changes
      { action: 'reject', changes: {} },
      { action: 'approve', extra: 1 },
      { action: 'edit', changes: { basis: 'inferred' } },
      { action: 'edit', changes: { bogus: 1 } }]) {
      assert.throws(() => reviewProposal(p, bad),
        (e) => e.code === 'INVALID_PROPOSAL');
    }
    const getter = { action: 'approve' };
    Object.defineProperty(getter, 'reason', { enumerable: true, get() { return 'x'; } });
    assert.throws(() => reviewProposal(p, getter),
      (e) => e.code === 'INVALID_PROPOSAL');
    // Caller mutation cannot affect an already-returned review.
    const review = reviewProposal(p, { action: 'approve' });
    p.statement.title = 'mutated';
    assert.notEqual(review.input.capture.title, 'mutated');
  } finally { cleanup(f.dir); }
});

test('producers perform zero filesystem writes', () => {
  const f = fixture();
  try {
    f.store.create(captureInput(f));
    const before = tree(f.dir);
    const proposals = proposeFromJournal(f.bound);
    proposeFromJournal(f.ctx, { limit: 1 });
    reviewProposal(proposals[0], { action: 'reject' });
    reviewProposal(proposals[0], { action: 'approve' });
    proposeFromInitAnswers(answersAll, { areaIds: [f.a], subjectId: 's' });
    assert.deepEqual(tree(f.dir), before);
  } finally { cleanup(f.dir); }
});
