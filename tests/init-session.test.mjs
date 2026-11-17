// Resumable init wizard sessions: persistence, atomicity, validation and
// schema-fingerprint staleness (debt E8). Pure data layer; no CLI/IO here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  INIT_QUESTION_IDS, INIT_SESSION_MALFORMED, openInitSession,
  answer, status, finalize, discard, initSessionFileRel,
} from '../src/core/init-session.mjs';
import { validateAnswers, VERSIONING_KEYS } from '../src/core/config.mjs';
import {
  VALID_ANSWERS, cleanup, exists, makeTempDir, readJson, writeJson,
} from './helpers.mjs';

const STATE = '.tasksystem/state';
const FILE_REL = `${STATE}/init-session.json`;

function paths(dir, stateDir = STATE) {
  return { projectRoot: dir, stateDir };
}

function open(dir, opts) {
  return openInitSession(paths(dir), opts);
}

// Answers every question in canonical order; returns the last session.
function answerAll(session) {
  let s = answer(session, 'name', 'fixture-project').session;
  s = answer(s, 'locale', 'es').session;
  s = answer(s, 'hosts', ['claude', 'devin']).session;
  s = answer(s, 'methodology', 'organic-sdd').session;
  for (const k of Object.keys(VALID_ANSWERS.paths)) {
    s = answer(s, `paths.${k}`, VALID_ANSWERS.paths[k]).session;
  }
  for (const k of VERSIONING_KEYS) {
    s = answer(s, `versioning.${k}`, false).session;
  }
  return s;
}

// Corrupts the stored fingerprint so the next open() sees the session as
// written under a different answers schema.
function tamperFingerprint(dir) {
  const doc = readJson(dir, FILE_REL);
  doc.schemaFingerprint = 'f'.repeat(64);
  writeJson(dir, FILE_REL, doc);
  return doc;
}

test('question set mirrors the interactive init order', () => {
  assert.deepEqual(INIT_QUESTION_IDS, [
    'name', 'locale', 'hosts', 'methodology',
    'paths.plans', 'paths.tasks', 'paths.reports', 'paths.research',
    'paths.decisions', 'paths.memory', 'paths.state',
    'versioning.plans', 'versioning.tasks', 'versioning.reports',
    'versioning.reviews', 'versioning.research', 'versioning.decisions',
    'versioning.memory', 'versioning.state',
  ]);
  assert.equal(INIT_QUESTION_IDS.length, 19);
});

test('open creates a single session file under the project state dir', () => {
  const dir = makeTempDir('init-sess');
  try {
    const { session, file, created, stale } = open(dir);
    assert.equal(created, true);
    assert.equal(stale, false);
    assert.equal(file, path.join(dir, ...FILE_REL.split('/')));
    assert.ok(exists(dir, FILE_REL));
    const doc = readJson(dir, FILE_REL);
    assert.deepEqual(Object.keys(doc).sort(), [
      'answered', 'answers', 'configPath', 'createdAt', 'cursor', 'id',
      'kind', 'projectId', 'schemaFingerprint', 'schemaVersion', 'stateDir',
      'updatedAt',
    ].sort());
    assert.equal(doc.schemaVersion, 1);
    assert.equal(doc.kind, 'init-session');
    assert.match(doc.id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    assert.match(doc.schemaFingerprint, /^[0-9a-f]{64}$/);
    assert.deepEqual(doc.answers, {});
    assert.deepEqual(doc.answered, []);
    assert.equal(doc.cursor, 0);
    assert.equal(doc.stateDir, STATE);
    const st = status(session);
    assert.equal(st.complete, false);
    assert.equal(st.answered.length, 0);
    assert.equal(st.remaining.length, 19);
    assert.deepEqual(st.remaining[0], 'name');
  } finally { cleanup(dir); }
});

test('reopen resumes persisted answers; nothing rewrites id/createdAt', () => {
  const dir = makeTempDir('init-sess');
  try {
    const first = open(dir);
    const s1 = answer(first.session, 'name', 'fixture-project').session;
    answer(s1, 'locale', 'en');
    const second = open(dir);
    assert.equal(second.created, false);
    assert.equal(second.session.id, first.session.id);
    assert.equal(second.session.createdAt, first.session.createdAt);
    assert.equal(second.session.answers.name, 'fixture-project');
    assert.equal(second.session.answers.locale, 'en');
    const st = status(second.session);
    assert.deepEqual(st.answered, ['name', 'locale']);
    assert.equal(st.remaining[0], 'hosts');
    assert.equal(st.complete, false);
  } finally { cleanup(dir); }
});

test('answer returns the next unanswered question id; null when complete', () => {
  const dir = makeTempDir('init-sess');
  try {
    const { session } = open(dir);
    const r1 = answer(session, 'name', 'p');
    assert.equal(r1.next, 'locale');
    const s = answerAll(r1.session);
    assert.equal(status(s).complete, true);
    const again = answer(s, 'name', 'p2'); // edit after completion
    assert.equal(again.next, null);
    assert.equal(status(again.session).answers.name, 'p2');
  } finally { cleanup(dir); }
});

test('answer validates the single value and persists nothing on failure', () => {
  const dir = makeTempDir('init-sess');
  try {
    const { session } = open(dir);
    const cases = [
      ['name', '', 'INVALID_VALUE'],
      ['name', '   ', 'INVALID_VALUE'],
      ['name', 42, 'INVALID_VALUE'],
      ['locale', 'fr', 'INVALID_LOCALE'],
      ['hosts', [], 'INVALID_HOSTS'],
      ['hosts', ['claude', 'claude'], 'INVALID_HOSTS'],
      ['hosts', ['emacs'], 'UNKNOWN_HOST'],
      ['hosts', 'claude', 'INVALID_HOSTS'],
      ['methodology', 'waterfall', 'INVALID_METHODOLOGY_MODE'],
      ['paths.plans', '../escape', 'INVALID_PATH'],
      ['paths.plans', '/abs/x', 'INVALID_PATH'],
      ['paths.plans', '.git/hooks', 'RESERVED_PATH'],
      ['versioning.plans', 'yes', 'INVALID_VALUE'],
      ['versioning.plans', 1, 'INVALID_VALUE'],
    ];
    for (const [qid, value, code] of cases) {
      assert.throws(() => answer(session, qid, value),
        (e) => e.code === code, `${qid}=${JSON.stringify(value)}`);
    }
    assert.throws(() => answer(session, 'bogus', 'x'),
      (e) => e.code === 'INIT_SESSION_UNKNOWN_QUESTION');
    assert.throws(() => answer(session, 'paths.bogus', 'x'),
      (e) => e.code === 'INIT_SESSION_UNKNOWN_QUESTION');
    // Failed answers persisted nothing: file still shows an empty session.
    const doc = readJson(dir, FILE_REL);
    assert.deepEqual(doc.answers, {});
    assert.deepEqual(doc.answered, []);
    assert.equal(doc.cursor, 0);
  } finally { cleanup(dir); }
});

test('path answers enforce distinctness against already-answered paths', () => {
  const dir = makeTempDir('init-sess');
  try {
    let s = open(dir).session;
    s = answer(s, 'paths.plans', 'a/plans').session;
    assert.throws(() => answer(s, 'paths.tasks', 'a/plans'),
      (e) => e.code === 'PATH_OVERLAP');
    assert.throws(() => answer(s, 'paths.tasks', 'a/PLANS'),
      (e) => e.code === 'PATH_OVERLAP'); // portable case-insensitive
    assert.throws(() => answer(s, 'paths.tasks', 'a'),
      (e) => e.code === 'PATH_OVERLAP'); // ancestor of a/plans
    s = answer(s, 'paths.tasks', 'a/tasks').session;
    assert.equal(s.answers.paths.tasks, 'a/tasks');
    // Re-answering the same key does not collide with itself.
    s = answer(s, 'paths.plans', 'b/plans').session;
    assert.equal(s.answers.paths.plans, 'b/plans');
  } finally { cleanup(dir); }
});

test('answer canonicalizes separators before storing', () => {
  const dir = makeTempDir('init-sess');
  try {
    let s = open(dir).session;
    s = answer(s, 'paths.plans', 'docs\\agent\\plans').session;
    assert.equal(s.answers.paths.plans, 'docs/agent/plans');
    assert.equal(
      readJson(dir, FILE_REL).answers.paths.plans, 'docs/agent/plans');
  } finally { cleanup(dir); }
});

test('out-of-order answering keeps cursor at the first unanswered question', () => {
  const dir = makeTempDir('init-sess');
  try {
    let s = open(dir).session;
    s = answer(s, 'versioning.state', true).session;
    assert.equal(s.cursor, 0);
    const st = status(s);
    assert.deepEqual(st.answered, ['versioning.state']);
    assert.equal(st.remaining[0], 'name');
    assert.equal(st.remaining.length, 18);
    s = answer(s, 'name', 'p').session;
    assert.equal(s.cursor, 1);
  } finally { cleanup(dir); }
});

test('status returns answers in schema order', () => {
  const dir = makeTempDir('init-sess');
  try {
    let s = open(dir).session;
    s = answer(s, 'versioning.state', true).session;
    s = answer(s, 'paths.tasks', 't').session;
    s = answer(s, 'name', 'p').session;
    const st = status(s);
    assert.deepEqual(Object.keys(st.answers),
      ['name', 'paths', 'versioning']);
    assert.deepEqual(Object.keys(st.answers.paths), ['tasks']);
    assert.deepEqual(Object.keys(st.answers.versioning), ['state']);
  } finally { cleanup(dir); }
});

test('finalize rejects an incomplete session', () => {
  const dir = makeTempDir('init-sess');
  try {
    let s = open(dir).session;
    s = answer(s, 'name', 'p').session;
    assert.throws(() => finalize(s), (e) => {
      assert.equal(e.code, 'INIT_SESSION_INCOMPLETE');
      assert.ok(e.missing.includes('locale'));
      assert.ok(!e.missing.includes('name'));
      return true;
    });
  } finally { cleanup(dir); }
});

test('finalize output is identical to a fresh full run and validates', () => {
  const dir = makeTempDir('init-sess');
  try {
    const s = answerAll(open(dir).session);
    const answers = finalize(s);
    // Exactly what askInteractive produces for the same input.
    assert.deepEqual(answers, {
      name: 'fixture-project',
      locale: 'es',
      hosts: ['claude', 'devin'],
      paths: VALID_ANSWERS.paths,
      versioning: {
        plans: false, tasks: false, reports: false, reviews: false,
        research: false, decisions: false, memory: false, state: false,
      },
      methodology: 'organic-sdd',
    });
    assert.doesNotThrow(() => validateAnswers(answers));
  } finally { cleanup(dir); }
});

test('changed schema fingerprint reports stale + resumable, never adopts', () => {
  const dir = makeTempDir('init-sess');
  try {
    let s = open(dir).session;
    s = answer(s, 'name', 'p').session;
    s = answer(s, 'locale', 'es').session;
    tamperFingerprint(dir);
    const reopened = open(dir);
    assert.equal(reopened.stale, true);
    assert.equal(reopened.session.stale, true);
    // Previously stored answers are still resumable under the current schema.
    assert.deepEqual(reopened.resumable, ['name', 'locale']);
    assert.deepEqual(reopened.dropped, []);
    assert.equal(reopened.missing.length, 17);
    assert.equal(reopened.missing[0], 'hosts');
  } finally { cleanup(dir); }
});

test('stale session rejects mutations; status stays read-only', () => {
  const dir = makeTempDir('init-sess');
  try {
    let s = open(dir).session;
    s = answer(s, 'name', 'p').session;
    tamperFingerprint(dir);
    const { session } = open(dir);
    assert.throws(() => answer(session, 'locale', 'es'),
      (e) => e.code === 'INIT_SESSION_STALE');
    assert.throws(() => finalize(session),
      (e) => e.code === 'INIT_SESSION_STALE');
    const st = status(session);
    assert.equal(st.stale, true);
    assert.equal(st.answers.name, 'p');
  } finally { cleanup(dir); }
});

test('resumeStale prunes to resumable answers and resumes under current schema', () => {
  const dir = makeTempDir('init-sess');
  try {
    let s = open(dir).session;
    s = answer(s, 'name', 'p').session;
    s = answer(s, 'locale', 'es').session;
    const storedId = s.id;
    tamperFingerprint(dir);
    const reopened = open(dir, { resumeStale: true });
    assert.equal(reopened.stale, false);
    assert.equal(reopened.session.stale, false);
    assert.equal(reopened.session.id, storedId);
    assert.deepEqual(reopened.resumable, ['name', 'locale']);
    assert.deepEqual(status(reopened.session).answered, ['name', 'locale']);
    // Session is live again: answers persist under the current fingerprint.
    const next = answer(reopened.session, 'hosts', ['claude']).session;
    assert.equal(next.stale, false);
    const doc = readJson(dir, FILE_REL);
    assert.equal(doc.answers.name, 'p');
    assert.match(doc.schemaFingerprint, /^[0-9a-f]{64}$/);
  } finally { cleanup(dir); }
});

test('resumeStale drops answers that fail the current schema', () => {
  const dir = makeTempDir('init-sess');
  try {
    // Forge a doc whose stored answer was valid "before" but is not now.
    let s = open(dir).session;
    s = answer(s, 'name', 'p').session;
    const doc = readJson(dir, FILE_REL);
    doc.answers.locale = 'klingon';
    doc.answered.push('locale');
    doc.schemaFingerprint = 'f'.repeat(64);
    writeJson(dir, FILE_REL, doc);
    const reopened = open(dir, { resumeStale: true });
    assert.equal(reopened.stale, false);
    assert.deepEqual(reopened.resumable, ['name']);
    assert.deepEqual(reopened.dropped, ['locale']);
    assert.equal(status(reopened.session).remaining[0], 'locale');
    assert.equal(readJson(dir, FILE_REL).answers.locale, undefined);
  } finally { cleanup(dir); }
});

test('malformed session files fail closed with INIT_SESSION_MALFORMED', () => {
  const dir = makeTempDir('init-sess');
  const fileAbs = path.join(dir, ...FILE_REL.split('/'));
  const reset = () => fs.rmSync(fileAbs, { force: true });
  try {
    // Bad JSON bytes.
    fs.mkdirSync(path.join(dir, ...STATE.split('/')), { recursive: true });
    fs.writeFileSync(fileAbs, '{nope');
    assert.throws(() => open(dir), (e) => e.code === INIT_SESSION_MALFORMED);
    // Invalid UTF-8.
    fs.writeFileSync(fileAbs, Buffer.from([0xff, 0xfe, 0x41]));
    assert.throws(() => open(dir), (e) => e.code === INIT_SESSION_MALFORMED);
    // Unknown top-level key.
    reset();
    open(dir);
    let doc = readJson(dir, FILE_REL);
    doc.extra = 1;
    writeJson(dir, FILE_REL, doc);
    assert.throws(() => open(dir), (e) => e.code === INIT_SESSION_MALFORMED);
    // answered/answers inconsistency.
    reset();
    open(dir);
    doc = readJson(dir, FILE_REL);
    doc.answered = ['name']; // answers.name absent
    writeJson(dir, FILE_REL, doc);
    assert.throws(() => open(dir), (e) => e.code === INIT_SESSION_MALFORMED);
    // Cursor out of sync with answered set.
    reset();
    open(dir);
    doc = readJson(dir, FILE_REL);
    doc.cursor = 5;
    writeJson(dir, FILE_REL, doc);
    assert.throws(() => open(dir), (e) => e.code === INIT_SESSION_MALFORMED);
    // Stored value invalid while fingerprint claims current schema.
    reset();
    open(dir);
    doc = readJson(dir, FILE_REL);
    doc.answers.locale = 'klingon';
    doc.answered = ['locale'];
    writeJson(dir, FILE_REL, doc);
    assert.throws(() => open(dir), (e) => e.code === INIT_SESSION_MALFORMED);
  } finally { cleanup(dir); }
});

test('paths and options are closed, contained and validated', () => {
  const dir = makeTempDir('init-sess');
  try {
    assert.throws(() => openInitSession({ projectRoot: dir, stateDir: '../x' }),
      (e) => e.code === 'INVALID_PATH');
    assert.throws(() => openInitSession({ projectRoot: dir, stateDir: '.git/x' }),
      (e) => e.code === 'RESERVED_PATH');
    assert.throws(() => openInitSession({ projectRoot: dir, bogus: 1 }),
      (e) => e.code === 'UNKNOWN_KEY');
    assert.throws(
      () => openInitSession({ projectRoot: `${dir}-missing` }),
      (e) => e.code === 'PROJECT_NOT_FOUND');
    assert.throws(() => open(dir, { configPath: '../cfg.json' }),
      (e) => e.code === 'INVALID_PATH');
    assert.throws(() => open(dir, { resumeStale: 'maybe' }),
      (e) => e.code === 'INVALID_VALUE');
    assert.throws(() => open(dir, { bogus: 1 }), (e) => e.code === 'UNKNOWN_KEY');
  } finally { cleanup(dir); }
});

test('discard removes the session file and disables the handle', () => {
  const dir = makeTempDir('init-sess');
  try {
    const { session } = open(dir);
    assert.ok(exists(dir, FILE_REL));
    discard(session);
    assert.ok(!exists(dir, FILE_REL));
    assert.throws(() => status(session),
      (e) => e.code === 'INIT_SESSION_INVALID');
    // A fresh open starts from scratch.
    const again = open(dir);
    assert.equal(again.created, true);
    assert.equal(status(again.session).answered.length, 0);
  } finally { cleanup(dir); }
});

test('no stray tmp files remain after answers', () => {
  const dir = makeTempDir('init-sess');
  try {
    answerAll(open(dir).session);
    const leftovers = fs.readdirSync(path.join(dir, ...STATE.split('/')))
      .filter((f) => f.endsWith('.tmp'));
    assert.deepEqual(leftovers, []);
  } finally { cleanup(dir); }
});

test('default stateDir comes from onboarding policy proposals', () => {
  const dir = makeTempDir('init-sess');
  try {
    const { session } = openInitSession({ projectRoot: dir });
    assert.equal(session.stateDir, '.scopegrain/state');
    assert.ok(exists(dir, '.scopegrain/state/init-session.json'));
  } finally { cleanup(dir); }
});

test('projectId and configPath metadata persist; initSessionFileRel is pure', () => {
  const dir = makeTempDir('init-sess');
  try {
    const { session } = open(dir, {
      projectId: 'proj-1', configPath: '.custom/config.json',
    });
    assert.equal(session.projectId, 'proj-1');
    assert.equal(session.configPath, '.custom/config.json');
    assert.equal(readJson(dir, FILE_REL).configPath, '.custom/config.json');
    assert.equal(initSessionFileRel(STATE), FILE_REL);
    assert.equal(initSessionFileRel('a\\b'), 'a/b/init-session.json');
  } finally { cleanup(dir); }
});
