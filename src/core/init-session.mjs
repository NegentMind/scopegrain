// Resumable init wizard sessions (debt E8): the interactive init flow can
// stop mid-way and resume later without losing answered questions.
//
// Storage: ONE JSON document at <projectRoot>/<stateDir>/init-session.json.
// stateDir is a project-relative destination — during init no config exists
// yet, so the caller supplies it (default: the authored onboarding proposal
// from policy/onboarding-defaults.json).
//
// The document is a closed object recording schemaVersion, answers-so-far,
// answered question ids, the cursor (index of the first unanswered question
// in the canonical question order), createdAt/updatedAt and a sha256
// fingerprint of schemas/answers.schema.json. A session whose fingerprint
// differs from the current schema bytes is STALE: openInitSession reports
// {stale:true, resumable, dropped, missing} and mutating operations reject
// with INIT_SESSION_STALE rather than silently adopting old answers. The
// caller opts into adoption with {resumeStale:true}, which replays only the
// answers that still satisfy the current schema.
//
// Question ids mirror the interactive ask order in cli.mjs askInteractive:
// scalar fields first, then one question per artifact path and one per
// versioning flag. `configPath` is asked interactively but is NOT an
// answers field — it is recorded as session metadata only.
//
// Writes are atomic (exclusive tmp file + rename); reads are bounded and
// strictly UTF-8; malformed stored bytes fail closed with
// INIT_SESSION_MALFORMED. All paths stay inside the project root.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { err } from './errors.mjs';
import {
  decodeUtf8Strict, lstatOrNull, mkdirpSync, readFileLimited,
  removeIfExists, writeFileExclusive,
} from './fsx.mjs';
import {
  assertDestination, assertDistinctPaths, resolveInside,
  resolveProjectRoot, toCanonicalRelative,
} from './paths.mjs';
import {
  DEFAULT_CONFIG_PATH, PATH_KEYS, VERSIONING_KEYS, validateAnswers,
  validateHosts, validateLocale, validateMethodologyMode,
} from './config.mjs';
import { loadLimits, loadOnboardingDefaults } from './policy.mjs';

export const INIT_SESSION_MALFORMED = 'INIT_SESSION_MALFORMED';
export const INIT_SESSION_FILE = 'init-session.json';
export const INIT_SESSION_KIND = 'init-session';

// Canonical question order: identical to the interactive prompts. Flat ids
// for scalar fields; `paths.<key>` and `versioning.<key>` per nested flag.
export const INIT_QUESTION_IDS = Object.freeze([
  'name', 'locale', 'hosts', 'methodology',
  ...PATH_KEYS.map((k) => `paths.${k}`),
  ...VERSIONING_KEYS.map((k) => `versioning.${k}`),
]);
const QUESTION_SET = new Set(INIT_QUESTION_IDS);

const SCHEMA_PATH = fileURLToPath(
  new URL('../../schemas/answers.schema.json', import.meta.url));

const DOC_KEYS = new Set([
  'schemaVersion', 'kind', 'id', 'projectId', 'configPath', 'stateDir',
  'schemaFingerprint', 'answers', 'answered', 'cursor', 'createdAt',
  'updatedAt',
]);
const ANSWER_FIELD_KEYS = new Set(
  ['name', 'locale', 'hosts', 'methodology', 'paths', 'versioning']);
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH_RE = /^[0-9a-f]{64}$/;

// Session objects are immutable views; runtime handles (file location,
// project root) live in this map so the document itself stays a closed,
// serializable object and foreign/plain objects cannot drive writes.
const INTERNALS = new WeakMap();

const isCanon = (v) => {
  const t = Date.parse(v);
  return !Number.isNaN(t) && new Date(t).toISOString() === v;
};

function sha256Hex(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

// Fingerprint of the CURRENT answers schema: raw bytes of the shipped
// schema file, so any edit — even whitespace — marks sessions stale.
export function schemaFingerprint() {
  const limited = readFileLimited(SCHEMA_PATH, loadLimits().maxDocumentBytes);
  if (limited.exceeded) {
    throw err('DOCUMENT_TOO_LARGE',
      'answers schema exceeds document limit');
  }
  return sha256Hex(limited.content);
}

// Pure helper: canonical session file location for a state dir.
export function initSessionFileRel(stateDir) {
  const rel = assertDestination(stateDir, 'stateDir');
  return `${rel}/${INIT_SESSION_FILE}`;
}

function malformed(message) {
  throw err(INIT_SESSION_MALFORMED, message);
}

function assertCanonicalRel(value, label) {
  if (typeof value !== 'string') {
    malformed(`${label} must be a string`);
  }
  try {
    const rel = toCanonicalRelative(value, label);
    assertDestination(rel, label);
    if (rel !== value) {
      malformed(`${label} is not a canonical POSIX path: ${value}`);
    }
  } catch (e) {
    if (e && e.code === INIT_SESSION_MALFORMED) throw e;
    malformed(`${label} is not a valid relative path: ${e.message}`);
  }
  return value;
}

// Single-question value validation. Returns the normalized value to store
// (paths are canonicalized). `answers` supplies already-answered siblings so
// a path answer is also checked for overlap against the rest. Domain codes
// are the same ones full-run validation produces.
function validateAnswerValue(qid, value, answers = {}) {
  if (qid === 'name') {
    if (typeof value !== 'string' || value.trim() === '') {
      throw err('INVALID_VALUE', 'answers.name must be a non-empty string');
    }
    return value;
  }
  if (qid === 'locale') return validateLocale(value);
  if (qid === 'hosts') return validateHosts(value);
  if (qid === 'methodology') {
    return validateMethodologyMode(value, 'answers.methodology');
  }
  const dot = qid.indexOf('.');
  const head = qid.slice(0, dot);
  const key = qid.slice(dot + 1);
  if (head === 'paths' && PATH_KEYS.includes(key)) {
    const rel = assertDestination(value, `paths.${key}`);
    const entries = Object.entries(answers.paths ?? {})
      .filter(([k]) => k !== key);
    entries.push([key, rel]);
    assertDistinctPaths(entries);
    return rel;
  }
  if (head === 'versioning' && VERSIONING_KEYS.includes(key)) {
    if (typeof value !== 'boolean') {
      throw err('INVALID_VALUE', `versioning.${key} must be boolean`);
    }
    return value;
  }
  throw err('INIT_SESSION_UNKNOWN_QUESTION', `unknown question '${qid}'`);
}

// Map an answered question id to its answers leaf, or null when the stored
// answers object has no corresponding leaf. Schema-agnostic: works for
// question kinds this schema version does not know.
function answersLeaf(answers, qid) {
  const dot = qid.indexOf('.');
  if (dot === -1) {
    return Object.hasOwn(answers, qid) ? answers[qid] : undefined;
  }
  const head = answers[qid.slice(0, dot)];
  if (head === null || typeof head !== 'object' || Array.isArray(head)) {
    return undefined;
  }
  const tail = qid.slice(dot + 1);
  return Object.hasOwn(head, tail) ? head[tail] : undefined;
}

// Structural validation of a stored document: fingerprint-agnostic, so a
// session written under another schema version still parses (staleness is
// reported, not malformed). Only the strict phase below enforces
// current-schema value rules.
function validateSessionStructure(d) {
  if (d === null || typeof d !== 'object' || Array.isArray(d)) {
    malformed('init session is not an object');
  }
  for (const k of Object.keys(d)) {
    if (!DOC_KEYS.has(k)) {
      malformed(`init session has unknown key '${k}'`);
    }
  }
  if (d.schemaVersion !== 1 || d.kind !== INIT_SESSION_KIND
      || !UUID_RE.test(d.id || '')
      || (d.projectId !== null
        && (typeof d.projectId !== 'string' || d.projectId === ''))
      || !HASH_RE.test(d.schemaFingerprint || '')
      || typeof d.createdAt !== 'string' || !isCanon(d.createdAt)
      || typeof d.updatedAt !== 'string' || !isCanon(d.updatedAt)
      || Date.parse(d.updatedAt) < Date.parse(d.createdAt)
      || !Number.isInteger(d.cursor) || d.cursor < 0
      || !Array.isArray(d.answered)
      || new Set(d.answered).size !== d.answered.length
      || !d.answered.every((q) => typeof q === 'string' && q !== '')) {
    malformed('init session has invalid fields');
  }
  assertCanonicalRel(d.configPath, 'init session configPath');
  assertCanonicalRel(d.stateDir, 'init session stateDir');
  const a = d.answers;
  if (a === null || typeof a !== 'object' || Array.isArray(a)) {
    malformed('init session answers is not an object');
  }
  for (const k of Object.keys(a)) {
    if (!ANSWER_FIELD_KEYS.has(k)) {
      malformed(`init session answers has unknown key '${k}'`);
    }
  }
  // Structural types only; enum membership is a current-schema concern.
  if (('name' in a) && typeof a.name !== 'string') malformed('answers.name');
  if (('locale' in a) && typeof a.locale !== 'string') {
    malformed('answers.locale');
  }
  if (('hosts' in a) && !Array.isArray(a.hosts)) malformed('answers.hosts');
  if (('methodology' in a) && typeof a.methodology !== 'string') {
    malformed('answers.methodology');
  }
  if ('paths' in a) {
    if (a.paths === null || typeof a.paths !== 'object'
        || Array.isArray(a.paths)
        || !Object.values(a.paths).every((v) => typeof v === 'string')) {
      malformed('answers.paths has invalid structure');
    }
  }
  if ('versioning' in a) {
    if (a.versioning === null || typeof a.versioning !== 'object'
        || Array.isArray(a.versioning)
        || !Object.values(a.versioning).every((v) => typeof v === 'boolean')) {
      malformed('answers.versioning has invalid structure');
    }
  }
  // answered <-> answers consistency, both directions: every answered id
  // must resolve to a stored leaf and every stored leaf must be answered.
  const leafIds = [];
  for (const k of Object.keys(a)) {
    const v = a[k];
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      for (const sub of Object.keys(v)) leafIds.push(`${k}.${sub}`);
    } else {
      leafIds.push(k);
    }
  }
  const leafSet = new Set(leafIds);
  const answeredSet = new Set(d.answered);
  if (d.answered.some((q) => answersLeaf(a, q) === undefined)
      || leafIds.some((q) => !answeredSet.has(q))
      || answeredSet.size !== leafSet.size) {
    malformed('init session answered set is inconsistent with answers');
  }
  return d;
}

// Strict phase: only applied when the stored fingerprint equals the current
// schema. Every stored leaf must satisfy today's validators and the cursor
// must point at the first unanswered question — anything else is tampering
// or corruption, not staleness.
function validateSessionCurrent(d) {
  for (const q of d.answered) {
    if (!QUESTION_SET.has(q)) {
      malformed(`init session has unknown question '${q}'`);
    }
    try {
      validateAnswerValue(q, answersLeaf(d.answers, q), d.answers);
    } catch (e) {
      malformed(`init session answer '${q}' is invalid: ${e.message}`);
    }
  }
  if (d.cursor !== firstUnansweredIndex(d.answered)) {
    malformed('init session cursor does not match answered set');
  }
  return d;
}

function firstUnansweredIndex(answered) {
  const set = new Set(answered);
  for (let i = 0; i < INIT_QUESTION_IDS.length; i++) {
    if (!set.has(INIT_QUESTION_IDS[i])) return i;
  }
  return INIT_QUESTION_IDS.length;
}

function serializeDoc(doc) {
  const text = JSON.stringify(doc, null, 2) + '\n';
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length > loadLimits().maxDocumentBytes) {
    throw err('DOCUMENT_TOO_LARGE',
      'init session exceeds document limit');
  }
  return bytes;
}

// Atomic rewrite: exclusive tmp in the same directory + rename. On any
// failure the previous committed bytes remain intact.
function writeSessionFile(file, bytes) {
  mkdirpSync(path.dirname(file));
  const tmp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  let owned = false;
  writeFileExclusive(tmp, bytes);
  owned = true;
  try {
    fs.renameSync(tmp, file);
    owned = false;
  } finally {
    if (owned) removeIfExists(tmp);
  }
}

function freezeAnswers(a) {
  const out = {};
  for (const [k, v] of Object.entries(a)) {
    if (v !== null && typeof v === 'object') {
      out[k] = Array.isArray(v) ? Object.freeze([...v]) : Object.freeze({ ...v });
    } else {
      out[k] = v;
    }
  }
  return Object.freeze(out);
}

function makeView(doc, file, projectRoot, stale) {
  const view = Object.freeze({
    ...doc,
    answers: freezeAnswers(doc.answers),
    answered: Object.freeze([...doc.answered]),
    stale,
    file,
  });
  INTERNALS.set(view, { file, projectRoot });
  return view;
}

function internal(session) {
  const h = INTERNALS.get(session);
  if (!h) {
    throw err('INIT_SESSION_INVALID',
      'not a live init-session handle (foreign or discarded object)');
  }
  return h;
}

function assertUsable(session) {
  if (session.stale || session.schemaFingerprint !== schemaFingerprint()) {
    throw err('INIT_SESSION_STALE',
      'init session was written under a different answers schema; '
      + 'reopen with resumeStale to adopt resumable answers');
  }
}

function readSessionDoc(file) {
  const limited = readFileLimited(file, loadLimits().maxDocumentBytes);
  if (limited.exceeded) {
    malformed('init session exceeds document limit');
  }
  const text = decodeUtf8Strict(
    limited.content, INIT_SESSION_MALFORMED, 'init session');
  let d;
  try {
    d = JSON.parse(text);
  } catch {
    malformed('init session contains malformed JSON');
  }
  return validateSessionStructure(d);
}

// Answers leaves in canonical schema order — used for status reporting and
// for rebuilding documents during stale adoption.
function orderedAnswers(answers) {
  const out = {};
  for (const k of ['name', 'locale', 'hosts', 'methodology']) {
    if (k in answers) out[k] = answers[k];
  }
  if (answers.paths && typeof answers.paths === 'object') {
    const p = {};
    for (const k of Object.keys(answers.paths)) p[k] = answers.paths[k];
    if (Object.keys(p).length) out.paths = p;
  }
  if (answers.versioning && typeof answers.versioning === 'object') {
    const v = {};
    for (const k of Object.keys(answers.versioning)) {
      v[k] = answers.versioning[k];
    }
    if (Object.keys(v).length) out.versioning = v;
  }
  return out;
}

// Replays stored answers under the CURRENT schema in canonical question
// order. Entries the current schema no longer accepts (unknown question,
// invalid value, overlapping path) are dropped — reported, never adopted.
function resumability(doc) {
  const resumable = [];
  const dropped = [];
  const adopted = {};
  const byQuestion = INIT_QUESTION_IDS
    .filter((q) => doc.answered.includes(q));
  const foreign = doc.answered.filter((q) => !QUESTION_SET.has(q));
  for (const q of byQuestion) {
    const leaf = answersLeaf(doc.answers, q);
    try {
      const value = validateAnswerValue(q, leaf, adopted);
      const dot = q.indexOf('.');
      if (dot === -1) {
        adopted[q] = value;
      } else {
        const head = q.slice(0, dot);
        adopted[head] = { ...(adopted[head] ?? {}), [q.slice(dot + 1)]: value };
      }
      resumable.push(q);
    } catch {
      dropped.push(q);
    }
  }
  for (const q of foreign) dropped.push(q);
  const missing = INIT_QUESTION_IDS.filter((q) => !resumable.includes(q));
  return { resumable, dropped, missing, adopted };
}

function requireOptions(options) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw err('INVALID_VALUE', 'init session options must be an object');
  }
  for (const k of Object.keys(options)) {
    if (!['projectId', 'configPath', 'resumeStale'].includes(k)) {
      throw err('UNKNOWN_KEY', `init session options has unknown key '${k}'`);
    }
  }
  const out = {};
  if (options.projectId !== undefined) {
    if (typeof options.projectId !== 'string' || options.projectId === '') {
      throw err('INVALID_VALUE', 'projectId must be a non-empty string');
    }
    out.projectId = options.projectId;
  }
  out.configPath = options.configPath === undefined
    ? undefined : assertDestination(options.configPath, 'configPath');
  if (options.resumeStale !== undefined) {
    if (typeof options.resumeStale !== 'boolean') {
      throw err('INVALID_VALUE', 'resumeStale must be boolean');
    }
    out.resumeStale = options.resumeStale;
  }
  return out;
}

function requirePaths(paths) {
  if (paths === null || typeof paths !== 'object' || Array.isArray(paths)) {
    throw err('INVALID_VALUE', 'init session paths must be an object');
  }
  for (const k of Object.keys(paths)) {
    if (!['projectRoot', 'stateDir'].includes(k)) {
      throw err('UNKNOWN_KEY', `init session paths has unknown key '${k}'`);
    }
  }
  const projectRoot = resolveProjectRoot(paths.projectRoot);
  const stateDir = assertDestination(
    paths.stateDir ?? loadOnboardingDefaults().paths.state, 'stateDir');
  return { projectRoot, stateDir };
}

function newDoc(paths, opts, fingerprint) {
  const at = new Date().toISOString();
  return {
    schemaVersion: 1,
    kind: INIT_SESSION_KIND,
    id: crypto.randomUUID(),
    projectId: opts.projectId ?? null,
    configPath: opts.configPath ?? DEFAULT_CONFIG_PATH,
    stateDir: paths.stateDir,
    schemaFingerprint: fingerprint,
    answers: {},
    answered: [],
    cursor: 0,
    createdAt: at,
    updatedAt: at,
  };
}

// Creates or loads the wizard session under <stateDir>/init-session.json.
// `paths`: {projectRoot, stateDir?}. `options`: {projectId?, configPath?,
// resumeStale?}. Returns {session, file, created, stale, resumable, dropped,
// missing}; a stale session reports which stored answers remain valid
// without adopting them.
export function openInitSession(paths, options = {}) {
  const p = requirePaths(paths);
  const opts = requireOptions(options);
  const rel = initSessionFileRel(p.stateDir);
  const file = resolveInside(p.projectRoot, rel, 'init session file');
  const fingerprint = schemaFingerprint();
  const st = lstatOrNull(file);
  if (st) {
    if (st.isSymbolicLink()) {
      throw err('SYMLINK_REJECTED',
        'init session file may not be a symlink');
    }
    if (!st.isFile()) {
      malformed('init session path is not a regular file');
    }
    const doc = readSessionDoc(file);
    if (doc.stateDir !== p.stateDir) {
      malformed('init session stateDir does not match its location');
    }
    if (opts.configPath !== undefined && opts.configPath !== doc.configPath) {
      throw err('INIT_SESSION_CONFLICT',
        `session was created for config '${doc.configPath}', `
        + `got '${opts.configPath}'`);
    }
    if (opts.projectId !== undefined && doc.projectId !== null
        && opts.projectId !== doc.projectId) {
      throw err('INIT_SESSION_CONFLICT',
        'session projectId does not match the stored session');
    }
    if (doc.schemaFingerprint === fingerprint) {
      validateSessionCurrent(doc);
      const session = makeView(doc, file, p.projectRoot, false);
      const { missing } = resumability(doc);
      return { session, file, created: false, stale: false,
        resumable: [...doc.answered].sort(
          (a, b) => INIT_QUESTION_IDS.indexOf(a) - INIT_QUESTION_IDS.indexOf(b)),
        dropped: [], missing };
    }
    const report = resumability(doc);
    if (!opts.resumeStale) {
      const session = makeView(doc, file, p.projectRoot, true);
      return { session, file, created: false, stale: true, ...report,
        adopted: undefined };
    }
    // Explicit opt-in adoption: keep identity and timestamps, replay only
    // resumable answers, re-fingerprint under the current schema.
    const adoptedDoc = {
      ...doc,
      schemaFingerprint: fingerprint,
      answers: report.adopted,
      answered: report.resumable,
      cursor: firstUnansweredIndex(report.resumable),
      updatedAt: new Date().toISOString(),
    };
    writeSessionFile(file, serializeDoc(adoptedDoc));
    const session = makeView(adoptedDoc, file, p.projectRoot, false);
    const { adopted, ...fields } = report;
    return { session, file, created: false, stale: false, ...fields };
  }
  const doc = newDoc(p, opts, fingerprint);
  const bytes = serializeDoc(doc);
  mkdirpSync(path.dirname(file));
  try {
    writeFileExclusive(file, bytes);
  } catch (e) {
    if (e && e.code === 'EEXIST') return openInitSession(paths, options);
    throw e;
  }
  return {
    session: makeView(doc, file, p.projectRoot, false),
    file, created: true, stale: false,
    resumable: [], dropped: [], missing: [...INIT_QUESTION_IDS],
  };
}

// Validates and records one answer. The session handle is not mutated; the
// returned view replaces it. `next` is the first unanswered question id in
// canonical order, or null when the session is complete.
export function answer(session, questionId, value) {
  const { file } = internal(session);
  assertUsable(session);
  if (!QUESTION_SET.has(questionId)) {
    throw err('INIT_SESSION_UNKNOWN_QUESTION',
      `unknown question '${questionId}'`);
  }
  const stored = validateAnswerValue(questionId, value, session.answers);
  const answers = { ...session.answers };
  const dot = questionId.indexOf('.');
  if (dot === -1) {
    answers[questionId] = stored;
  } else {
    const head = questionId.slice(0, dot);
    answers[head] = {
      ...(answers[head] ?? {}), [questionId.slice(dot + 1)]: stored,
    };
  }
  const answered = INIT_QUESTION_IDS.filter(
    (q) => answersLeaf(answers, q) !== undefined);
  const now = new Date().toISOString();
  const nextDoc = {
    schemaVersion: session.schemaVersion,
    kind: session.kind,
    id: session.id,
    projectId: session.projectId,
    configPath: session.configPath,
    stateDir: session.stateDir,
    schemaFingerprint: session.schemaFingerprint,
    answers: orderedAnswers(answers),
    answered,
    cursor: firstUnansweredIndex(answered),
    createdAt: session.createdAt,
    // Clock regressions never move updatedAt backwards.
    updatedAt: now >= session.updatedAt ? now : session.updatedAt,
  };
  writeSessionFile(file, serializeDoc(nextDoc));
  const view = makeView(nextDoc, file, internal(session).projectRoot, false);
  const next = INIT_QUESTION_IDS[view.cursor] ?? null;
  return { session: view, next };
}

// Read-only progress: answered/remaining ids in canonical order, the
// answers object in schema order and staleness for reporting.
export function status(session) {
  internal(session);
  const set = new Set(session.answered);
  return {
    answered: [...session.answered],
    remaining: INIT_QUESTION_IDS.filter((q) => !set.has(q)),
    complete: session.answered.length === INIT_QUESTION_IDS.length,
    stale: session.stale === true,
    answers: orderedAnswers(session.answers),
  };
}

// Produces the answers object a full interactive run would have produced:
// every question answered, then normalized by the same validateAnswers that
// prepareInit runs. Incomplete or stale sessions reject fail-closed.
export function finalize(session) {
  internal(session);
  assertUsable(session);
  const missing = INIT_QUESTION_IDS.filter(
    (q) => answersLeaf(session.answers, q) === undefined);
  if (missing.length) {
    const e = err('INIT_SESSION_INCOMPLETE',
      `init session is incomplete; missing: ${missing.join(', ')}`);
    e.missing = missing;
    throw e;
  }
  const a = session.answers;
  return validateAnswers({
    name: a.name,
    locale: a.locale,
    hosts: [...a.hosts],
    methodology: a.methodology,
    paths: { ...a.paths },
    versioning: { ...a.versioning },
  });
}

// Removes the session file and invalidates the handle. Best-effort on the
// file (already gone is fine); the handle is dead afterwards either way.
export function discard(session) {
  const { file } = internal(session);
  removeIfExists(file);
  INTERNALS.delete(session);
}
