// SPDX-License-Identifier: Apache-2.0
// Session cases: opt-in writes, budget, CAS, policy gating, resume.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyPlan, preflightPlan } from '../src/core/bootstrap.mjs';
import { createConfig } from '../src/core/config.mjs';
import { resolveContext } from '../src/core/context.mjs';
import {
  getSession, prepareSession, prepareSessionRecord, recordSession, resumeSession,
  sessionFileAbs,
} from '../src/core/sessions.mjs';
import { createTask } from '../src/core/tasks.mjs';
import { transitionTask } from '../src/core/transition.mjs';
import {
  formalFixture, lightFixture, reanswer, snapshot,
} from './methodology-fixtures.mjs';
import {
  VALID_ANSWERS, cleanup, exists, makeTempDir, writeJson,
} from './helpers.mjs';

function fixture() {
  const dir = makeTempDir('sess');
  writeJson(dir, '.scopegrain/config.json',
    createConfig(dir, VALID_ANSWERS, {}));
  const ctx = resolveContext({ project: dir });
  const task = createTask(ctx, {
    title: 'T', contract: 'C', authorContext: 'a', scope: [],
  });
  return { dir, ctx, task };
}

function makeSession(ctx, task, limit = 3) {
  const prepared = prepareSession(ctx, { taskId: task.id, limit });
  applyPlan(ctx.projectRoot, preflightPlan(ctx.projectRoot, [prepared.file]));
  return prepared.session;
}

test('create is opt-in; limit required and bounded', () => {
  const { dir, ctx, task } = fixture();
  try {
    const p = prepareSession(ctx, { taskId: task.id, limit: 5 });
    assert.ok(!exists(dir, '.scopegrain/state/sessions'));
    for (const bad of [{ taskId: task.id }, { taskId: task.id, limit: 0 },
      { taskId: task.id, limit: 10001 }, { taskId: task.id, limit: 'x' },
      { taskId: 'nope', limit: 3 }, { taskId: task.id, limit: 3, bogus: 1 }]) {
      assert.throws(() => prepareSession(ctx, bad),
        (e) => e.code !== 'INTERNAL');
    }
    applyPlan(dir, preflightPlan(dir, [p.file]));
    const s = getSession(ctx, p.session.id);
    assert.equal(s.limit, 5);
    assert.equal(s.revision, 0);
  } finally { cleanup(dir); }
});

test('gate-denied ACT edit does not consume session bytes/revision/budget in preview or apply', () => {
  const f = formalFixture();
  try {
    transitionTask(f.ctx, { id: f.task.id, to: 'ACT', expectedRevision: 0 });
    const s = makeSession(f.ctx, f.task, 3);
    reanswer(f, f.approvals.task, 'revoke');
    const before = snapshot(f.dir);
    const input = { id: s.id, expectedRevision: 0, action: 'edit', evidence: 'diff' };
    for (const record of [prepareSessionRecord, recordSession]) {
      assert.throws(() => record(f.ctx, input), (e) => e.code === 'SESSION_ACTION_DENIED');
      assert.deepEqual(snapshot(f.dir), before);
    }
    const current = getSession(f.ctx, s.id);
    assert.equal(current.used, 0);
    assert.equal(current.revision, 0);
    assert.deepEqual(current.events, []);
  } finally { cleanup(f.dir); }
});

test('authorized scoped light edit consumes exactly one explicitly recorded operation', () => {
  const f = lightFixture();
  try {
    transitionTask(f.ctx, { id: f.task.id, to: 'ACT', expectedRevision: 0 });
    const s = makeSession(f.ctx, f.task, 3);
    const input = { id: s.id, expectedRevision: 0, action: 'edit',
      evidence: 'declared diff', context: 'fixture' };
    const before = snapshot(f.dir);
    assert.equal(prepareSessionRecord(f.ctx, input).prospective.used, 1);
    assert.deepEqual(snapshot(f.dir), before);
    const next = recordSession(f.ctx, input);
    assert.equal(next.used, 1);
    assert.equal(next.revision, 1);
    assert.equal(next.events.length, 1);
    assert.equal(next.events[0].action, 'edit');
  } finally { cleanup(f.dir); }
});

test('session own lock real-close EIO cleans owned lock; foreign sentinel remains', (t) => {
  const f = fixture();
  try {
    const s = makeSession(f.ctx, f.task, 3);
    const before = snapshot(f.dir);
    const realClose = fs.closeSync;
    t.mock.method(fs, 'closeSync', (fd) => {
      realClose(fd);
      throw Object.assign(new Error('injected close EIO'), { code: 'EIO' });
    });
    const input = { id: s.id, expectedRevision: 0, action: 'read', evidence: 'e' };
    assert.throws(() => recordSession(f.ctx, input), (e) => e.code === 'EIO');
    t.mock.restoreAll();
    assert.deepEqual(snapshot(f.dir), before);
    const lock = sessionFileAbs(f.ctx, s.id) + '.lock';
    fs.writeFileSync(lock, 'foreign-sentinel', { flag: 'wx' });
    const held = snapshot(f.dir);
    assert.throws(() => recordSession(f.ctx, input), (e) => e.code === 'SESSION_LOCKED');
    assert.deepEqual(snapshot(f.dir), held);
  } finally { t.mock.restoreAll(); cleanup(f.dir); }
});

test('record honors policy state, budget, CAS and atomic writes', () => {
  const { dir, ctx, task } = fixture();
  try {
    const s = makeSession(ctx, task, 2);
    const file = sessionFileAbs(ctx, s.id);
    const before = fs.readFileSync(file);
    // 'edit' in PLAN is denied: bytes and revision unchanged.
    assert.throws(() => recordSession(ctx, {
      id: s.id, expectedRevision: 0, action: 'edit', evidence: 'e',
    }), (e) => e.code === 'SESSION_ACTION_DENIED');
    assert.ok(fs.readFileSync(file).equals(before));
    // Allowed action in PLAN.
    const s1 = recordSession(ctx, {
      id: s.id, expectedRevision: 0, action: 'read', evidence: 'x',
    });
    assert.equal(s1.used, 1);
    assert.equal(s1.revision, 1);
    // Stale revision.
    assert.throws(() => recordSession(ctx, {
      id: s.id, expectedRevision: 0, action: 'read', evidence: 'x',
    }), (e) => e.code === 'REVISION_MISMATCH');
    // Exhaustion after limit.
    recordSession(ctx, {
      id: s.id, expectedRevision: 1, action: 'read', evidence: 'y',
    });
    assert.throws(() => recordSession(ctx, {
      id: s.id, expectedRevision: 2, action: 'read', evidence: 'z',
    }), (e) => e.code === 'SESSION_LIMIT_EXHAUSTED');
  } finally { cleanup(dir); }
});

test('accepted edit event lands in ACT', () => {
  const { dir, ctx, task } = fixture();
  try {
    const s = makeSession(ctx, task, 5);
    transitionTask(ctx, { id: task.id, to: 'ACT', expectedRevision: 0 });
    const s1 = recordSession(ctx, {
      id: s.id, expectedRevision: 0, action: 'edit',
      evidence: 'diff', context: 'slice-1',
    });
    assert.equal(s1.events[0].action, 'edit');
  } finally { cleanup(dir); }
});

test('lock conflict, malformed stored data and resume integrity', () => {
  const { dir, ctx, task } = fixture();
  try {
    const s = makeSession(ctx, task, 3);
    const file = sessionFileAbs(ctx, s.id);
    fs.writeFileSync(`${file}.lock`, 'held', { flag: 'wx' });
    assert.throws(() => recordSession(ctx, {
      id: s.id, expectedRevision: 0, action: 'read', evidence: 'x',
    }), (e) => e.code === 'SESSION_LOCKED');
    fs.rmSync(`${file}.lock`);
    // Malformed stored session.
    fs.writeFileSync(file, '{broken');
    assert.throws(() => getSession(ctx, s.id),
      (e) => e.code === 'SESSION_MALFORMED');
    assert.throws(() => recordSession(ctx, {
      id: s.id, expectedRevision: 0, action: 'read', evidence: 'x',
    }), (e) => e.code === 'SESSION_MALFORMED');
  } finally { cleanup(dir); }
});

test('resume returns actual state and remaining budget without mutation', () => {
  const { dir, ctx, task } = fixture();
  try {
    const s = makeSession(ctx, task, 4);
    recordSession(ctx, {
      id: s.id, expectedRevision: 0, action: 'read', evidence: 'x',
    });
    const before = fs.readFileSync(sessionFileAbs(ctx, s.id));
    const r = resumeSession(ctx, s.id);
    assert.equal(r.task.state, 'PLAN');
    assert.equal(r.usage.used, 1);
    assert.equal(r.usage.remaining, 3);
    assert.equal(r.usage.measures, 'explicitly-recorded-operations-only');
    assert.equal(r.recovery.reference, 'references/task-domain.md');
    assert.ok(fs.readFileSync(sessionFileAbs(ctx, s.id)).equals(before));
  } finally { cleanup(dir); }
});

// --- schemaVersion 2: self-reported token accounting ---

// Writes literal session bytes (any schema version) to the stored file.
function writeStored(ctx, id, doc) {
  fs.writeFileSync(
    sessionFileAbs(ctx, id), JSON.stringify(doc, null, 2) + '\n');
}

function v1Doc(s, task, extra = {}) {
  return {
    schemaVersion: 1, id: s.id, taskId: task.id, limit: s.limit,
    used: 0, revision: 0, events: [],
    createdAt: s.createdAt, updatedAt: s.createdAt, ...extra,
  };
}

test('stored v1 session without token fields reads and validates', () => {
  const { dir, ctx, task } = fixture();
  try {
    const s = makeSession(ctx, task, 5);
    writeStored(ctx, s.id, v1Doc(s, task));
    const got = getSession(ctx, s.id);
    assert.equal(got.schemaVersion, 1);
    assert.equal(got.tokenLimit, undefined);
    assert.deepEqual(got.events, []);
  } finally { cleanup(dir); }
});

test('recording onto a stored v1 session promotes it to v2 with tokenLimit null', () => {
  const { dir, ctx, task } = fixture();
  try {
    const s = makeSession(ctx, task, 5);
    writeStored(ctx, s.id, v1Doc(s, task));
    const next = recordSession(ctx, {
      id: s.id, expectedRevision: 0, action: 'read', evidence: 'x',
    });
    assert.equal(next.schemaVersion, 2);
    assert.equal(next.tokenLimit, null);
    const stored = getSession(ctx, s.id);
    assert.equal(stored.schemaVersion, 2);
    assert.equal(stored.tokenLimit, null);
    assert.equal(stored.events.length, 1);
  } finally { cleanup(dir); }
});

test('stored events with malformed tokens fail closed; bytes never touched', () => {
  const { dir, ctx, task } = fixture();
  try {
    const s = makeSession(ctx, task, 5);
    const evAt = new Date(Date.parse(s.createdAt) + 1000).toISOString();
    const base = (version, tokens) => ({
      schemaVersion: version,
      ...(version === 2 ? { tokenLimit: null } : {}),
      id: s.id, taskId: task.id, limit: 5, used: 1, revision: 1,
      events: [{ action: 'read', evidence: 'x', context: '', at: evAt,
        tokens }],
      createdAt: s.createdAt, updatedAt: evAt,
    });
    const badReports = [
      { prompt: 2, completion: 3, total: 6 }, // total !== prompt+completion
      { prompt: 2, completion: 3, total: 5, extra: 1 }, // extra key
      { prompt: 2.5, completion: 2.5, total: 5 }, // non-integer
      { prompt: 5, completion: -5, total: 0 }, // negative
      { prompt: 2, completion: 3 }, // missing key
      'not-an-object',
      [1, 2, 3],
    ];
    for (const tokens of badReports) {
      writeStored(ctx, s.id, base(2, tokens));
      const before = fs.readFileSync(sessionFileAbs(ctx, s.id));
      assert.throws(() => getSession(ctx, s.id),
        (e) => e.code === 'SESSION_MALFORMED', JSON.stringify(tokens));
      assert.throws(() => recordSession(ctx, {
        id: s.id, expectedRevision: 1, action: 'read', evidence: 'y',
      }), (e) => e.code === 'SESSION_MALFORMED', JSON.stringify(tokens));
      assert.ok(fs.readFileSync(sessionFileAbs(ctx, s.id)).equals(before));
    }
    // ev.tokens is a v2-only key: even a well-formed report is malformed
    // under schemaVersion 1.
    writeStored(ctx, s.id, base(1, { prompt: 1, completion: 1, total: 2 }));
    assert.throws(() => getSession(ctx, s.id),
      (e) => e.code === 'SESSION_MALFORMED');
  } finally { cleanup(dir); }
});

test('record input.tokens malformed is INVALID_VALUE before any read', () => {
  const { dir, ctx, task } = fixture();
  try {
    const s = makeSession(ctx, task, 5);
    const before = fs.readFileSync(sessionFileAbs(ctx, s.id));
    const badInputs = [
      'x', 5, null, [1, 2], {},
      { prompt: 1, completion: 2, total: 4 }, // total !== sum
      { prompt: 1, completion: 2 }, // missing key
      { prompt: 1, completion: 2, total: 3, extra: 1 }, // extra key
      { prompt: -1, completion: 1, total: 0 }, // negative
      { prompt: 0.5, completion: 0.5, total: 1 }, // non-integer
    ];
    for (const tokens of badInputs) {
      const input = { id: s.id, expectedRevision: 0, action: 'read',
        evidence: 'x', tokens };
      for (const fn of [prepareSessionRecord, recordSession]) {
        assert.throws(() => fn(ctx, input),
          (e) => e.code === 'INVALID_VALUE', JSON.stringify(tokens));
      }
    }
    assert.ok(fs.readFileSync(sessionFileAbs(ctx, s.id)).equals(before));
    // A well-formed report records and persists.
    const next = recordSession(ctx, {
      id: s.id, expectedRevision: 0, action: 'read', evidence: 'x',
      tokens: { prompt: 2, completion: 3, total: 5 },
    });
    assert.deepEqual(next.events[0].tokens,
      { prompt: 2, completion: 3, total: 5 });
    assert.deepEqual(getSession(ctx, s.id).events[0].tokens,
      { prompt: 2, completion: 3, total: 5 });
  } finally { cleanup(dir); }
});

test('reported token budget gates appends; stored docs never exceed it', () => {
  const { dir, ctx, task } = fixture();
  try {
    const prepared = prepareSession(ctx,
      { taskId: task.id, limit: 10, tokenLimit: 10 });
    applyPlan(dir, preflightPlan(dir, [prepared.file]));
    const s = prepared.session;
    assert.equal(s.schemaVersion, 2);
    assert.equal(s.tokenLimit, 10);
    recordSession(ctx, { id: s.id, expectedRevision: 0, action: 'read',
      evidence: 'x', tokens: { prompt: 2, completion: 3, total: 5 } });
    // An event whose report would push the stored sum PAST the limit is
    // refused with the domain code — persisting it would store a
    // document that violates its own declared budget (shape invariant).
    for (const fn of [prepareSessionRecord, recordSession]) {
      assert.throws(() => fn(ctx, { id: s.id, expectedRevision: 1,
        action: 'read', evidence: 'y',
        tokens: { prompt: 4, completion: 4, total: 8 } }),
        (e) => e.code === 'SESSION_TOKEN_BUDGET_EXHAUSTED', fn.name);
    }
    assert.equal(getSession(ctx, s.id).events.length, 1); // bytes untouched
    // The event that REACHES the budget is accepted — the consumption it
    // declares already happened; the gate then blocks the NEXT append.
    const reached = recordSession(ctx, { id: s.id, expectedRevision: 1,
      action: 'read', evidence: 'y',
      tokens: { prompt: 3, completion: 2, total: 5 } });
    assert.equal(reached.events.length, 2); // stored total is now 10 = limit
    const input = { id: s.id, expectedRevision: 2, action: 'read',
      evidence: 'z' };
    for (const fn of [prepareSessionRecord, recordSession]) {
      assert.throws(() => fn(ctx, input),
        (e) => e.code === 'SESSION_TOKEN_BUDGET_EXHAUSTED', fn.name);
    }
    assert.equal(getSession(ctx, s.id).events.length, 2);
  } finally { cleanup(dir); }
});

test('create validates tokenLimit input shape', () => {
  const { dir, ctx, task } = fixture();
  try {
    for (const tokenLimit of [0, -1, 1.5, 'x', NaN]) {
      assert.throws(() => prepareSession(ctx,
        { taskId: task.id, limit: 3, tokenLimit }),
        (e) => e.code === 'INVALID_VALUE', String(tokenLimit));
    }
    // null and absent both store null; a positive integer is honored.
    for (const tokenLimit of [null, undefined]) {
      const p = prepareSession(ctx, { taskId: task.id, limit: 3, tokenLimit });
      assert.equal(p.session.tokenLimit, null);
    }
    const p = prepareSession(ctx,
      { taskId: task.id, limit: 3, tokenLimit: 42 });
    assert.equal(p.session.tokenLimit, 42);
  } finally { cleanup(dir); }
});

test('resume exposes self-reported tokenUsage with declared measures', () => {
  const { dir, ctx, task } = fixture();
  try {
    const prepared = prepareSession(ctx,
      { taskId: task.id, limit: 10, tokenLimit: 10 });
    applyPlan(dir, preflightPlan(dir, [prepared.file]));
    const s = prepared.session;
    recordSession(ctx, { id: s.id, expectedRevision: 0, action: 'read',
      evidence: 'x', tokens: { prompt: 2, completion: 3, total: 5 } });
    const r = resumeSession(ctx, s.id);
    assert.deepEqual(r.usage.tokenUsage, {
      reported: 5, limit: 10, remaining: 5, percent: 50,
      measures: 'self-reported-unverified',
    });
    // No declared budget: null limit/remaining/percent, still labeled.
    const s2 = makeSession(ctx, task, 3);
    const r2 = resumeSession(ctx, s2.id);
    assert.deepEqual(r2.usage.tokenUsage, {
      reported: 0, limit: null, remaining: null, percent: null,
      measures: 'self-reported-unverified',
    });
  } finally { cleanup(dir); }
});

test('stored v2 with reported totals above tokenLimit is malformed', () => {
  const { dir, ctx, task } = fixture();
  try {
    const s = makeSession(ctx, task, 5);
    const evAt = new Date(Date.parse(s.createdAt) + 1000).toISOString();
    writeStored(ctx, s.id, {
      schemaVersion: 2, tokenLimit: 4, id: s.id, taskId: task.id,
      limit: 5, used: 1, revision: 1,
      events: [{ action: 'read', evidence: 'x', context: '', at: evAt,
        tokens: { prompt: 2, completion: 3, total: 5 } }],
      createdAt: s.createdAt, updatedAt: evAt,
    });
    assert.throws(() => getSession(ctx, s.id),
      (e) => e.code === 'SESSION_MALFORMED');
    assert.throws(() => recordSession(ctx, {
      id: s.id, expectedRevision: 1, action: 'read', evidence: 'y',
    }), (e) => e.code === 'SESSION_MALFORMED');
  } finally { cleanup(dir); }
});
