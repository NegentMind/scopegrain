// SPDX-License-Identifier: Apache-2.0
// Content-bound approval ledger: immutable append of answers against a
// digest-pinned target. Records intent only — actors and comments are
// declared, never authenticated. Effects are limited to the next gate.
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
  acquireVerifiedLock, releaseVerifiedLock,
} from './locks.mjs';
import { assertDestination, resolveInside }
  from './paths.mjs';
import { loadLimits } from './policy.mjs';
import { canonicalDigest, canonicalJSON, taskStaticProjection }
  from './digests.mjs';
import { getArtifact, isCanonicalTime } from './artifacts.mjs';
import { getTask } from './tasks.mjs';
import { getPlan } from './plans.mjs';
import { getSpecification } from './specifications.mjs';
import {
  applyJournaledRecordCreation, applyJournaledRecordUpdate,
} from './journal.mjs';
import {
  assertRecordObject, authorizeScope, bindOwnedStore, cloneRecordJSON,
  normalizeOwnedInput, ownedDocumentBytes, ownedScope,
  parseOwnedJson, readOwnedCurrent, resolveWorkspaceState,
  sha256Hex, validateChainOwnership, walkOwnedIndex,
} from './owned-chain.mjs';

const SHA_RE = /^[0-9a-f]{64}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLAN_KEY_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const STATUSES = new Set([
  'pending', 'approved', 'rejected', 'declined', 'needs-clarification',
  'revoked',
]);
const ANSWER_STATUS = new Map([
  ['approve', 'approved'],
  ['reject', 'rejected'],
  ['decline', 'declined'],
  ['custom', 'needs-clarification'],
  ['revoke', 'revoked'],
]);
const ANSWERS = new Set(ANSWER_STATUS.keys());
const ARTIFACT_KINDS = new Set([
  'spec', 'design', 'research', 'report', 'review', 'decision', 'lesson',
  'handoff',
]);
const EFFECTS = ['permit-next-harness-gate-for-bound-content'];
const DESCRIBE_KEYS = new Set(['kind', 'artifactKind', 'id']);
const PREPARE_KEYS = new Set(['target']);
const ANSWER_KEYS = new Set([
  'id', 'answer', 'expectedRevision', 'expectedTargetDigest', 'actor',
  'comment',
]);
const APPROVAL_KEYS = new Set([
  'schemaVersion', 'id', 'revision', 'target', 'status', 'question',
  'notice', 'scope', 'options', 'createdAt', 'updatedAt', 'history',
]);

function closed(v, keys, label) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    throw err('APPROVAL_INVALID', `${label} must be an object`);
  }
  for (const k of Object.keys(v)) {
    if (!keys.has(k)) {
      throw err('APPROVAL_INVALID', `${label} has unknown key '${k}'`);
    }
  }
}

function dedupeScope(paths) {
  const seen = new Set();
  const out = [];
  for (const p of paths) {
    // Only identical spellings dedupe: src/a and SRC/a are distinct scope
    // paths on case-sensitive filesystems and both stay in the consent.
    if (!seen.has(p)) { seen.add(p); out.push(p); }
  }
  return out;
}

// Lazy bounded prompt loader: no import-time IO; the parsed document is
// shape-validated BEFORE caching so a corrupt template cannot produce
// TypeErrors or poison the cache.
let promptsCache = null;
function prompts(locale) {
  if (promptsCache === null) {
    let parsed;
    try {
      const p = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../templates/approval-prompts.json');
      const limited = readFileLimited(p, loadLimits().maxDocumentBytes);
      if (limited.exceeded) throw new Error('prompts exceed document limit');
      parsed = JSON.parse(decodeUtf8Strict(
        limited.content, 'APPROVAL_MALFORMED', 'approval-prompts.json'));
    } catch (e) {
      throw err('APPROVAL_MALFORMED',
        `approval-prompts.json unavailable: ${e.message}`);
    }
    validatePrompts(parsed);
    promptsCache = parsed;
  }
  if (typeof locale !== 'string'
      || !promptsCache[locale] || !promptsCache[locale].question) {
    throw err('APPROVAL_INVALID',
      `no authored approval prompts for locale '${locale}'`);
  }
  const src = promptsCache[locale];
  return {
    question: src.question, notice: src.notice,
    options: src.options.map((o) => ({ ...o })),
  };
}

// Authored-template contract: schemaVersion 1, per-locale blocks with
// closed keys, question/notice nonempty, exactly approve/reject options,
// every placeholder used by the renderer present.
function validatePrompts(p) {
  const bad = (m) => err('APPROVAL_MALFORMED',
    `approval-prompts.json: ${m}`);
  if (p === null || typeof p !== 'object' || Array.isArray(p)
      || p.schemaVersion !== 1) {
    throw bad('root must be an object with schemaVersion 1');
  }
  if (Object.keys(p).length !== 3
      || !Object.hasOwn(p, 'en') || !Object.hasOwn(p, 'es')) {
    throw bad('root must contain exactly schemaVersion, en and es');
  }
  for (const loc of ['en', 'es']) {
    const b = p[loc];
    if (b === null || typeof b !== 'object' || Array.isArray(b)) {
      throw bad(`${loc} must be an object`);
    }
    for (const k of Object.keys(b)) {
      if (!['question', 'notice', 'options'].includes(k)) {
        throw bad(`${loc} has unknown key '${k}'`);
      }
    }
    if (typeof b.question !== 'string' || b.question.trim() === ''
        || !b.question.includes('{kind}')
        || !b.question.includes('{id}')
        || !b.question.includes('{digest}')
        || typeof b.notice !== 'string' || b.notice.trim() === ''
        || !Array.isArray(b.options) || b.options.length !== 2
        || b.options[0]?.id !== 'approve' || b.options[1]?.id !== 'reject'
        || !b.options.every((o) => o && typeof o === 'object'
          && Object.keys(o).length === 3
          && typeof o.label === 'string' && o.label.trim() !== ''
          && typeof o.description === 'string'
          && o.description.trim() !== '')) {
      throw bad(`${loc} question/notice/options shape invalid`);
    }
  }
}

// Scope derivation per contract: spec data.scope; design -> its spec scope;
// report V2 -> its task scope; task -> task scope; plan -> union; other
// artifacts -> references.
function artifactScope(ctx, a) {
  if (a.kind === 'spec' && a.data !== undefined) return a.data.scope;
  if (a.kind === 'design' && a.data !== undefined) {
    const spec = getSpecification(ctx, a.data.specId);
    return spec.data.scope;
  }
  if (a.kind === 'report' && a.data !== undefined) {
    const t = getTask(ctx, a.data.taskId);
    return dedupeScope(t.scope);
  }
  return a.references;
}

// Target description: fully validated current record + content digest.
// task/plan digests use the STATIC projection so ordinary progress cannot
// invalidate an answer; contract/scope/dependency edits change them.
export function describeApprovalTarget(ctx, input) {
  closed(input, DESCRIBE_KEYS, 'describeApprovalTarget input');
  const { kind, artifactKind, id } = input;
  if (kind === 'task' || kind === 'plan') {
    if (artifactKind !== undefined) {
      throw err('APPROVAL_INVALID',
        `artifactKind is not allowed for target kind '${kind}'`);
    }
  }
  if (kind === 'artifact') {
    if (!ARTIFACT_KINDS.has(artifactKind)) {
      throw err('APPROVAL_INVALID',
        `artifactKind '${artifactKind}' is not an approvable artifact`);
    }
    const a = getArtifact(ctx, artifactKind, id);
    const target = {
      kind: 'artifact', artifactKind, id: a.id,
      digest: canonicalDigest(a),
    };
    const scope = { paths: [...artifactScope(ctx, a)],
      effects: [...EFFECTS] };
    for (const p of scope.paths) {
      resolveInside(ctx.projectRoot, p, 'artifact approval scope');
    }
    return { target, scope };
  }
  if (kind === 'task') {
    const t = getTask(ctx, id);
    for (const p of t.scope) {
      resolveInside(ctx.projectRoot, p, 'task.scope');
    }
    return {
      target: { kind: 'task', id: t.id,
        digest: canonicalDigest(taskStaticProjection(t)) },
      scope: { paths: dedupeScope(t.scope), effects: [...EFFECTS] },
    };
  }
  if (kind === 'plan') {
    if (typeof id !== 'string' || !PLAN_KEY_RE.test(id)) {
      throw err('APPROVAL_INVALID', `invalid plan key '${id}'`);
    }
    const plan = getPlan(ctx, id);
    const tasks = plan.tasks.map((ref) => getTask(ctx, ref.id ?? ref));
    for (const t of tasks) {
      for (const p of t.scope) {
        resolveInside(ctx.projectRoot, p, 'plan.task.scope');
      }
    }
    const target = {
      kind: 'plan', id,
      digest: canonicalDigest({
        plan, tasks: tasks.map(taskStaticProjection),
      }),
    };
    const union = dedupeScope(tasks.flatMap((t) => t.scope));
    return { target, scope: { paths: union, effects: [...EFFECTS] } };
  }
  throw err('APPROVAL_INVALID', `unknown approval kind '${kind}'`);
}

// Closed-union target shape, validated BEFORE any record lookup.
function validateTargetInput(target) {
  if (target === null || typeof target !== 'object' || Array.isArray(target)) {
    throw err('APPROVAL_INVALID', 'target must be an object');
  }
  const keys = Object.keys(target);
  if (target.kind === 'artifact') {
    if (keys.length !== 4
        || !ARTIFACT_KINDS.has(target.artifactKind)
        || typeof target.id !== 'string' || !UUID_RE.test(target.id)
        || typeof target.digest !== 'string' || !SHA_RE.test(target.digest)) {
      throw err('APPROVAL_INVALID', 'target artifact shape invalid');
    }
  } else if (target.kind === 'task' || target.kind === 'plan') {
    const idOk = target.kind === 'task'
      ? (typeof target.id === 'string' && UUID_RE.test(target.id))
      : (typeof target.id === 'string' && PLAN_KEY_RE.test(target.id));
    if (keys.length !== 3 || !idOk
        || typeof target.digest !== 'string' || !SHA_RE.test(target.digest)) {
      throw err('APPROVAL_INVALID', `target ${target.kind} shape invalid`);
    }
  } else {
    throw err('APPROVAL_INVALID',
      `target kind '${target.kind}' is not approvable`);
  }
}

function approvalFile(ctx, digest) {
  const rel = `${ctx.config.paths.decisions}/approvals/${digest}.json`;
  return { rel, abs: resolveInside(ctx.projectRoot, rel, 'approval file') };
}

export function prepareApproval(ctx, input) {
  closed(input, PREPARE_KEYS, 'prepareApproval input');
  const { target } = input;
  validateTargetInput(target); // closed union BEFORE any lookup
  const desc = describeApprovalTarget(ctx, target.kind === 'artifact'
    ? { kind: 'artifact', artifactKind: target.artifactKind, id: target.id }
    : { kind: target.kind, id: target.id });
  if (desc.target.digest !== target.digest) {
    throw err('APPROVAL_STALE_TARGET',
      'target digest does not match the current record');
  }
  const { question, notice, options } = prompts(ctx.config.locale ?? 'en');
  const now = new Date().toISOString();
  const canonicalTarget = { ...desc.target }; // store canonical, not raw
  const approval = {
    schemaVersion: 1,
    id: canonicalTarget.digest.toLowerCase(),
    revision: 0,
    target: canonicalTarget,
    status: 'pending',
    question: question
      .replace('{kind}', canonicalTarget.kind === 'artifact'
        ? canonicalTarget.artifactKind : canonicalTarget.kind)
      .replace('{id}', canonicalTarget.id)
      .replace('{digest}', canonicalTarget.digest.toLowerCase()),
    notice,
    scope: { paths: [...desc.scope.paths], effects: [...EFFECTS] },
    options,
    createdAt: now,
    updatedAt: now,
    history: [{ at: now, event: 'created', revision: 0,
      status: 'pending', actor: null, answer: null, comment: null }],
  };
  validateApprovalShape(approval, 'prepared approval'); // self-check
  const { rel, abs } = approvalFile(ctx, approval.id);
  const content = JSON.stringify(approval, null, 2) + '\n';
  if (Buffer.byteLength(content, 'utf8') > loadLimits().maxDocumentBytes) {
    throw err('DOCUMENT_TOO_LARGE', 'approval exceeds document limit');
  }
  return { approval, file: { rel, abs, content } };
}

// Full stored-record validation. Rules replay the input contract: answered
// events require a nonempty actor, custom/non-pending answers a
// nonempty comment, revoke only out of approved. Numeric time comparisons.
export function validateApprovalShape(a, label = 'approval') {
  try {
    closed(a, APPROVAL_KEYS, label);
  } catch (e) {
    throw err('APPROVAL_MALFORMED', `${label}: ${e.message}`);
  }
  if (a.schemaVersion !== 1
      || typeof a.id !== 'string' || !SHA_RE.test(a.id)
      || !Number.isSafeInteger(a.revision) || a.revision < 0
      || !STATUSES.has(a.status)
      || typeof a.question !== 'string' || a.question.trim() === ''
      || typeof a.notice !== 'string' || a.notice.trim() === ''
      || !isCanonicalTime(a.createdAt) || !isCanonicalTime(a.updatedAt)) {
    throw err('APPROVAL_MALFORMED', `${label} has invalid fields`);
  }
  const t = a.target;
  if (t === null || typeof t !== 'object' || Array.isArray(t)) {
    throw err('APPROVAL_MALFORMED', `${label}.target must be an object`);
  }
  if (t.kind === 'artifact') {
    if (Object.keys(t).length !== 4 || !ARTIFACT_KINDS.has(t.artifactKind)
        || typeof t.id !== 'string' || !UUID_RE.test(t.id)
        || typeof t.digest !== 'string' || !SHA_RE.test(t.digest)) {
      throw err('APPROVAL_MALFORMED', `${label}.target artifact invalid`);
    }
  } else if (t.kind === 'task' || t.kind === 'plan') {
    const idOk = t.kind === 'task'
      ? (typeof t.id === 'string' && UUID_RE.test(t.id))
      : (typeof t.id === 'string' && PLAN_KEY_RE.test(t.id));
    if (Object.keys(t).length !== 3 || !idOk
        || typeof t.digest !== 'string' || !SHA_RE.test(t.digest)) {
      throw err('APPROVAL_MALFORMED', `${label}.target ${t.kind} invalid`);
    }
  } else {
    throw err('APPROVAL_MALFORMED', `${label}.target shape invalid`);
  }
  if (a.id !== t.digest.toLowerCase()) {
    throw err('APPROVAL_MALFORMED',
      `${label}.id must equal target.digest`);
  }
  if (a.scope === null || typeof a.scope !== 'object'
      || Object.keys(a.scope).length !== 2
      || !Array.isArray(a.scope.paths)
      || !a.scope.paths.every((p) => {
        if (typeof p !== 'string') return false;
        try { return assertDestination(p, 'scope') === p; }
        catch { return false; }
      })
      || !Array.isArray(a.scope.effects)
      || a.scope.effects.length !== 1
      || a.scope.effects[0] !== EFFECTS[0]) {
    throw err('APPROVAL_MALFORMED', `${label}.scope invalid`);
  }
  if (!Array.isArray(a.options) || a.options.length !== 2
      || !a.options.every((o) => o && typeof o === 'object'
        && Object.keys(o).length === 3)
      || a.options[0].id !== 'approve' || a.options[1].id !== 'reject'
      || !a.options.every((o) =>
        typeof o.label === 'string' && o.label.trim() !== ''
        && typeof o.description === 'string'
        && o.description.trim() !== '')) {
    throw err('APPROVAL_MALFORMED', `${label}.options invalid`);
  }
  if (!Array.isArray(a.history) || a.history.length < 1
      || a.history.length > loadLimits().maxSessionEvents
      || a.history.length !== a.revision + 1) {
    throw err('APPROVAL_MALFORMED', `${label}.history invalid`);
  }
  let prevAt = -Infinity;
  let prevStatus = null;
  for (let i = 0; i < a.history.length; i += 1) {
    const h = a.history[i];
    if (h === null || typeof h !== 'object' || Array.isArray(h)
        || Object.keys(h).length !== 7
        || !isCanonicalTime(h.at)
        || h.revision !== i
        || !STATUSES.has(h.status)) {
      throw err('APPROVAL_MALFORMED', `${label}.history[${i}] invalid`);
    }
    const atMs = Date.parse(h.at);
    if (atMs < prevAt) {
      throw err('APPROVAL_MALFORMED',
        `${label}.history is not nondecreasing`);
    }
    prevAt = atMs;
    if (i === 0) {
      if (h.event !== 'created' || h.status !== 'pending'
          || h.actor !== null || h.answer !== null || h.comment !== null) {
        throw err('APPROVAL_MALFORMED',
          `${label}.history[0] must be created/pending`);
      }
    } else {
      // Replay the input rules on stored history: every answered event
      // carries a declared actor; custom and re-answers carry a comment.
      if (h.event !== 'answered' || !ANSWERS.has(h.answer)
          || typeof h.actor !== 'string' || h.actor.trim() === ''
          || (h.comment !== null && typeof h.comment !== 'string')) {
        throw err('APPROVAL_MALFORMED', `${label}.history[${i}] invalid event`);
      }
      if (h.answer === 'revoke' && prevStatus !== 'approved') {
        throw err('APPROVAL_MALFORMED',
          `${label}.history[${i}] revoke out of non-approved`);
      }
      if ((h.answer === 'custom' || prevStatus !== 'pending')
          && (typeof h.comment !== 'string' || h.comment.trim() === '')) {
        throw err('APPROVAL_MALFORMED',
          `${label}.history[${i}] requires a non-empty comment`);
      }
      if (h.status !== ANSWER_STATUS.get(h.answer)) {
        throw err('APPROVAL_MALFORMED',
          `${label}.history[${i}] status does not map from answer`);
      }
    }
    prevStatus = h.status;
  }
  if (a.createdAt !== a.history[0].at
      || a.updatedAt !== a.history[a.history.length - 1].at
      || a.status !== a.history[a.history.length - 1].status) {
    throw err('APPROVAL_MALFORMED',
      `${label} top fields must mirror first/last history`);
  }
  return a;
}

export function getApproval(ctx, id) {
  if (typeof id !== 'string' || !SHA_RE.test(id)) {
    throw err('APPROVAL_INVALID', 'approval id must be a sha256 digest');
  }
  const { abs } = approvalFile(ctx, id);
  const st = lstatOrNull(abs);
  if (!st) throw err('APPROVAL_NOT_FOUND', `approval not found: ${id}`);
  if (st.isSymbolicLink() || !st.isFile()) {
    throw err('SYMLINK_REJECTED', `approval may not be a link: ${id}`);
  }
  const limited = readFileLimited(abs, loadLimits().maxDocumentBytes);
  if (limited.exceeded) {
    throw err('APPROVAL_MALFORMED', `approval ${id} exceeds document limit`);
  }
  const text = decodeUtf8Strict(
    limited.content, 'APPROVAL_MALFORMED', `approval ${id}`);
  let a;
  try { a = JSON.parse(text); }
  catch { throw err('APPROVAL_MALFORMED', `approval ${id} malformed JSON`); }
  a = validateApprovalShape(a, `approval ${id}`);
  if (a.id !== id.toLowerCase()) {
    throw err('APPROVAL_MALFORMED', 'approval id does not match filename');
  }
  return a;
}

// Specs with open questions block APPROVE only — other answers stay legal.
function assertSpecApproveable(ctx, a, answer) {
  if (answer !== 'approve' || a.target.kind !== 'artifact'
      || a.target.artifactKind !== 'spec') return;
  const spec = getSpecification(ctx, a.target.id);
  if (spec.data.openQuestions.length > 0) {
    throw err('APPROVAL_OPEN_QUESTIONS',
      `spec ${a.target.id} has ${spec.data.openQuestions.length} open question(s); approve is blocked`);
  }
}

// Read-only prospective answer: validates input basics BEFORE any lock or
// file write. Returns {previous,next,file} for the caller or the lock path.
export function prepareApprovalAnswer(ctx, input) {
  closed(input, ANSWER_KEYS, 'answer input');
  if (typeof input.id !== 'string' || !SHA_RE.test(input.id)) {
    throw err('APPROVAL_INVALID', 'id must be a sha256 digest');
  }
  if (!Number.isSafeInteger(input.expectedRevision)
      || input.expectedRevision < 0) {
    throw err('REVISION_MISMATCH',
      'expectedRevision must be a non-negative safe integer');
  }
  if (typeof input.expectedTargetDigest !== 'string'
      || !SHA_RE.test(input.expectedTargetDigest)) {
    throw err('APPROVAL_INVALID',
      'expectedTargetDigest must be a sha256 hex string');
  }
  if (!ANSWERS.has(input.answer)) {
    throw err('APPROVAL_INVALID', `unknown answer '${input.answer}'`);
  }
  if (typeof input.actor !== 'string' || input.actor.trim() === '') {
    throw err('APPROVAL_INVALID',
      'actor must be a non-empty string (declared, not authenticated)');
  }
  if (input.comment !== undefined
      && (input.comment !== null && typeof input.comment !== 'string')) {
    throw err('APPROVAL_INVALID', 'comment must be a string or null');
  }
  const previous = getApproval(ctx, input.id);
  const next = applyAnswer(ctx, previous, input);
  const { rel, abs } = approvalFile(ctx, previous.id);
  const content = JSON.stringify(next, null, 2) + '\n';
  if (Buffer.byteLength(content, 'utf8') > loadLimits().maxDocumentBytes) {
    throw err('DOCUMENT_TOO_LARGE', 'approval would exceed document limit');
  }
  return { previous, next, file: { rel, abs, content } };
}

// Shared answer computation. `at` is the event timestamp; owned callers
// pass the kernel operation identity time so record, sidecar and event
// times agree. checkRevision=false delegates revision staleness to the
// journal byte-CAS (the owned path claims a previousHash instead).
function buildAnsweredApproval(ctx, a, input, at, { checkRevision = true } = {}) {
  if (checkRevision && input.expectedRevision !== a.revision) {
    throw err('REVISION_MISMATCH',
      `expected revision ${input.expectedRevision} but stored ${a.revision}`);
  }
  if (input.expectedTargetDigest !== a.target.digest) {
    throw err('APPROVAL_STALE_TARGET',
      'expectedTargetDigest does not match the stored target digest');
  }
  // Revalidate the CURRENT target: digest and derived scope must match.
  const desc = describeApprovalTarget(ctx, a.target.kind === 'artifact'
    ? { kind: 'artifact', artifactKind: a.target.artifactKind,
      id: a.target.id }
    : { kind: a.target.kind, id: a.target.id });
  if (desc.target.digest !== a.target.digest
      || JSON.stringify([...desc.scope.paths].sort())
        !== JSON.stringify([...a.scope.paths].sort())) {
    throw err('APPROVAL_STALE_TARGET',
      'target content or scope drifted since the approval was created');
  }
  const { answer, actor, comment } = input;
  const pending = a.status === 'pending';
  if (answer === 'revoke' && a.status !== 'approved') {
    throw err('APPROVAL_INVALID', 'revoke is only valid from approved');
  }
  const needsComment = answer === 'custom' || !pending;
  if (needsComment
      && (typeof comment !== 'string' || comment.trim() === '')) {
    throw err('APPROVAL_INVALID',
      `answer '${answer}' on a ${a.status} record requires a non-empty comment`);
  }
  assertSpecApproveable(ctx, a, answer);
  const lastAt = Date.parse(a.history[a.history.length - 1].at);
  if (Date.parse(at) < lastAt) {
    throw err('APPROVAL_CLOCK_REGRESSION',
      `clock moved backwards: ${at} < last history event`);
  }
  const next = {
    ...a,
    revision: a.revision + 1,
    status: ANSWER_STATUS.get(answer),
    updatedAt: at,
    history: [...a.history, {
      at, event: 'answered', revision: a.revision + 1,
      status: ANSWER_STATUS.get(answer),
      actor, answer, comment: comment ?? null,
    }],
  };
  validateApprovalShape(next, 'approval(next)');
  return next;
}

function applyAnswer(ctx, a, input) {
  return buildAnsweredApproval(ctx, a, input, new Date().toISOString());
}

// Locked answer: input validated and prospective record prepared BEFORE the
// lock (read-only), then reprepared INSIDE the lock so a concurrent answer
// cannot silently overwrite. The lock is a verified token lock: release
// re-proves inode + token ownership, so a foreign replacement is never
// deleted by our finally.
export function answerApproval(ctx, input) {
  // Preflight: all input/basic failures surface with zero filesystem writes.
  const preflight = prepareApprovalAnswer(ctx, input);
  const { abs } = preflight.file;
  const lock = acquireVerifiedLock(`${abs}.lock`, 'APPROVAL_LOCKED',
    'approval lock exists; refusing to recover it automatically');
  let tmpPath = null;
  let tmpOwned = false;
  let next;
  let failure;
  try {
    const reprepared = prepareApprovalAnswer(ctx, input); // reprepare
    mkdirpSync(path.dirname(abs));
    tmpPath = `${abs}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    writeFileExclusive(tmpPath, reprepared.file.content);
    tmpOwned = true;
    fs.renameSync(tmpPath, abs);
    tmpOwned = false;
    next = reprepared.next;
  } catch (e) {
    failure = e;
  } finally {
    if (tmpOwned) removeIfExists(tmpPath);
    try {
      releaseVerifiedLock(lock); // unlinks only the lock proven ours
    } catch (e) {
      if (!failure) failure = e; // a domain failure is never masked
    }
  }
  if (failure) throw failure;
  return next;
}

// ---------------------------------------------------------------------
// Journal-backed mutable ownership (opt-in). The question record is a
// strict two-event create op plus a revision0 ownership sidecar; each
// answer is a CAS update op (previousHash + expected revision) that
// advances the record and the sidecar tip atomically. The sidecar's
// `chain` is the per-record operation index — the journal keeps no
// index — and every revision's snapshot re-proves its prefix. Reads
// return proven current records only: no adoption of plausible files,
// no listing, no history fallback. Ownership proves scoped kernel
// operations, not authenticated identity or active truth.
// ---------------------------------------------------------------------

const OWNED_INPUT = 'INVALID_OWNED_APPROVAL_INPUT';
const OWNED_CODES = {
  missing: 'OWNED_APPROVAL_NOT_FOUND',
  malformed: 'OWNED_APPROVAL_MALFORMED',
  notCommitted: 'OWNED_APPROVAL_NOT_COMMITTED',
  sourceChanged: 'OWNED_APPROVAL_SOURCE_CHANGED',
};
const OWNED_ANSWER_REQUIRED = [
  'id', 'answer', 'expectedRevision', 'expectedTargetDigest', 'actor',
];
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const isSha256 = (value) => typeof value === 'string' && SHA_RE.test(value);

function ownedMalformed(message) {
  throw err(OWNED_CODES.malformed, message);
}

function boundedBytes(bytes, label) {
  if (bytes.length > loadLimits().maxDocumentBytes) {
    throw err('DOCUMENT_TOO_LARGE', `${label} exceeds document limit`);
  }
  return bytes;
}

// Closed 10-field mutable sidecar: tip metadata plus the ordered
// operation chain (chain[k] produced revision k, chain.at(-1) ===
// operationId, length === sourceRevision + 1). Distinct from the
// rev0-only shared validator: approval ids are sha256 digests, not
// UUIDs, and the record mutates.
function validateApprovalOwnership(value, label = 'approval ownership') {
  return validateChainOwnership(value, {
    sourceKind: 'approval', recordIdOk: isSha256, indexKey: 'chain',
    maxRevision: loadLimits().maxSessionEvents,
    code: OWNED_CODES.malformed, label });
}

export function createOwnedApprovalStore(ctx, options) {
  const { privateCtx, bound } = bindOwnedStore(ctx, options, OWNED_INPUT,
    'owned approval store');
  const decisionsRel = assertDestination(privateCtx.config.paths.decisions,
    'paths.decisions');
  const stateRel = assertDestination(privateCtx.config.paths.state,
    'paths.state');
  const sourceRelFor = (recordId) => `${decisionsRel}/approvals/${recordId}.json`;
  const ownershipRelFor = (recordId) =>
    `${stateRel}/record-ownership/approval/${recordId}.json`;

  function scope(areaIds) {
    return ownedScope(bound, areaIds);
  }

  function ownership(recordId, sourceRel, sourceHash, revision, operationId,
      createdAt, areaIds, chain) {
    return validateApprovalOwnership({
      schemaVersion: 1, sourceKind: 'approval', recordId,
      sourceRevision: revision, sourceRel, sourceHash, operationId,
      scope: scope(areaIds), createdAt, chain: [...chain],
    });
  }

  function parseOwned(bytes, label) {
    return validateApprovalOwnership(
      parseOwnedJson(bytes, OWNED_CODES.malformed, label), label);
  }

  // Full tip proof in the fixed order: sidecar -> shape -> scope ->
  // committed chain of 2-event ops (create then coherent updates) ->
  // per-revision sidecar snapshots -> tip snapshot equality -> typed
  // record -> current bytes equality. Never adopts plausible files.
  function readOwnedApproval(recordId) {
    const sourceRel = sourceRelFor(recordId);
    const ownershipRel = ownershipRelFor(recordId);
    const sidecarBytes = readOwnedCurrent(bound, ownershipRel, {
      missingCode: OWNED_CODES.missing,
      nonRegularCode: OWNED_CODES.malformed, label: 'approval ownership' });
    const owned = parseOwned(sidecarBytes, 'approval ownership');
    if (owned.recordId !== recordId || owned.sourceRel !== sourceRel) {
      ownedMalformed('approval ownership does not name this record');
    }
    // Grants are validated before any record content is produced.
    authorizeScope(bound, owned.scope);
    const scopeJson = canonicalJSON(owned.scope);
    const sourceHashes = [];
    let tipApproval = null;
    let tipSnapshot = null;
    let tipSidecarSnapshot = null;
    for (const hop of walkOwnedIndex(bound, owned.chain, {
      sourceKind: 'approval', sidecarKind: 'record-ownership',
      recordId, sourceRel, sidecarRel: ownershipRel, scopeJson,
      code: OWNED_CODES.malformed,
      notCommittedCode: OWNED_CODES.notCommitted,
      label: 'approval' })) {
      // Each revision's sidecar snapshot re-proves the chain prefix.
      const revOwned = parseOwned(hop.sidecarSnapshot,
        'approval ownership snapshot');
      if (revOwned.recordId !== recordId || revOwned.sourceRel !== sourceRel
          || revOwned.sourceRevision !== hop.index
          || revOwned.operationId !== hop.operationId
          || revOwned.createdAt !== hop.loaded.intent.createdAt
          || revOwned.sourceHash !== hop.source.sourceHash
          || canonicalJSON(revOwned.scope) !== scopeJson
          || canonicalJSON(revOwned.chain)
            !== canonicalJSON(owned.chain.slice(0, hop.index + 1))) {
        ownedMalformed(
          'approval ownership snapshot does not prove this revision');
      }
      sourceHashes.push(hop.source.sourceHash);
      tipApproval = hop.source;
      tipSnapshot = hop.sourceSnapshot;
      tipSidecarSnapshot = hop.sidecarSnapshot;
    }
    if (!tipSidecarSnapshot.equals(sidecarBytes)) {
      ownedMalformed('current approval ownership differs from its snapshot');
    }
    if (owned.sourceHash !== tipApproval.sourceHash) {
      ownedMalformed('approval ownership hash differs from the event');
    }
    let record;
    try {
      record = JSON.parse(decodeUtf8Strict(Buffer.from(tipSnapshot),
        OWNED_CODES.malformed, 'stored approval source'));
      record = validateApprovalShape(record, `approval ${recordId}`);
    } catch (e) {
      if (e.code === OWNED_CODES.malformed) throw e;
      if (e.code === 'APPROVAL_MALFORMED') {
        ownedMalformed(`approval snapshot fails shape: ${e.message}`);
      }
      ownedMalformed('approval snapshot is not valid JSON');
    }
    if (record.id !== recordId || record.revision !== owned.sourceRevision) {
      ownedMalformed('approval document does not match its proof');
    }
    const current = readOwnedCurrent(bound, sourceRel, {
      missingCode: OWNED_CODES.missing,
      nonRegularCode: OWNED_CODES.sourceChanged, label: 'approval' });
    if (!current.equals(tipSnapshot)) {
      throw err(OWNED_CODES.sourceChanged,
        'current approval source differs from its snapshot');
    }
    return { record, ownership: owned, sourceHashes, sidecarBytes,
      current, tip: { operationId: owned.operationId, event: tipApproval } };
  }

  // Closed create DTO: record areas sorted unique; the target is cloned
  // to plain JSON before any IO so caller mutation cannot alter it.
  function normalizeCreate(input) {
    return normalizeOwnedInput(input, 'target', OWNED_INPUT,
      'owned approval input');
  }

  function prepare(input) {
    const normalized = normalizeCreate(input);
    authorizeScope(bound, scope(normalized.areaIds));
    const prepared = prepareApproval(privateCtx,
      { target: normalized.target });
    const record = prepared.approval;
    const sourceRel = prepared.file.rel;
    const ownershipRel = ownershipRelFor(record.id);
    const { projectRoot } = resolveWorkspaceState(bound);
    resolveInside(projectRoot, sourceRel, 'approval source');
    resolveInside(projectRoot, ownershipRel, 'approval ownership');
    const sourceBytes = Buffer.from(prepared.file.content, 'utf8');
    boundedBytes(sourceBytes, 'approval source');
    ownedDocumentBytes(ownership(record.id, sourceRel,
      sha256Hex(sourceBytes), 0, ZERO_UUID, record.createdAt,
      normalized.areaIds, [ZERO_UUID]), 'approval ownership');
    return { mode: 'dry-run', record, sourceRel, ownershipRel,
      reservesIds: false };
  }

  function create(input) {
    const normalized = normalizeCreate(input);
    authorizeScope(bound, scope(normalized.areaIds));
    let built = null;
    const journal = applyJournaledRecordCreation(bound, (identity) => {
      const prepared = prepareApproval(privateCtx,
        { target: cloneRecordJSON(normalized.target) });
      const record = validateApprovalShape({
        ...prepared.approval,
        createdAt: identity.createdAt,
        updatedAt: identity.createdAt,
        history: [{ ...prepared.approval.history[0],
          at: identity.createdAt }],
      }, 'owned approval');
      const sourceRel = prepared.file.rel;
      const ownershipRel = ownershipRelFor(record.id);
      const sourceBytes = ownedDocumentBytes(record, 'approval source');
      const owned = ownership(record.id, sourceRel, sha256Hex(sourceBytes),
        0, identity.operationId, identity.createdAt, normalized.areaIds,
        [identity.operationId]);
      const sidecarBytes = ownedDocumentBytes(owned, 'approval ownership');
      built = { record, sourceRel, ownershipRel };
      return [
        { sourceKind: 'approval', recordId: record.id, sourceRevision: 0,
          areaIds: [...normalized.areaIds],
          file: { rel: sourceRel, content: sourceBytes } },
        { sourceKind: 'record-ownership', recordId: record.id,
          sourceRevision: 0, areaIds: [...normalized.areaIds],
          file: { rel: ownershipRel, content: sidecarBytes } },
      ];
    });
    return { mode: 'applied', record: built.record,
      sourceRel: built.sourceRel, ownershipRel: built.ownershipRel,
      ownershipConfirmed: journal.status === 'committed'
        && journal.journalState === 'confirmed',
      journal };
  }

  function answer(input) {
    assertRecordObject(input, [...ANSWER_KEYS], OWNED_ANSWER_REQUIRED,
      OWNED_INPUT, 'owned approval answer input');
    if (typeof input.id !== 'string' || !SHA_RE.test(input.id)) {
      throw err('APPROVAL_INVALID', 'id must be a sha256 digest');
    }
    if (!Number.isSafeInteger(input.expectedRevision)
        || input.expectedRevision < 0) {
      throw err('REVISION_MISMATCH',
        'expectedRevision must be a non-negative safe integer');
    }
    if (typeof input.expectedTargetDigest !== 'string'
        || !SHA_RE.test(input.expectedTargetDigest)) {
      throw err('APPROVAL_INVALID',
        'expectedTargetDigest must be a sha256 hex string');
    }
    if (!ANSWERS.has(input.answer)) {
      throw err('APPROVAL_INVALID', `unknown answer '${input.answer}'`);
    }
    if (typeof input.actor !== 'string' || input.actor.trim() === '') {
      throw err('APPROVAL_INVALID',
        'actor must be a non-empty string (declared, not authenticated)');
    }
    if (input.comment !== undefined
        && (input.comment !== null && typeof input.comment !== 'string')) {
      throw err('APPROVAL_INVALID', 'comment must be a string or null');
    }
    let built = null;
    const journal = applyJournaledRecordUpdate(bound, (identity) => {
      const proved = readOwnedApproval(input.id);
      const tipRevision = proved.ownership.sourceRevision;
      if (input.expectedRevision > tipRevision) {
        throw err('REVISION_MISMATCH',
          `expected revision ${input.expectedRevision} but stored ${tipRevision}`);
      }
      // The claimed base pins the CAS previousHash through the proven
      // chain: a stale revision declares old bytes and the kernel
      // conflicts before any journal state is consumed.
      const baseHash = proved.sourceHashes[input.expectedRevision];
      const next = buildAnsweredApproval(privateCtx, proved.record, input,
        identity.createdAt, { checkRevision: false });
      const sourceBytes = ownedDocumentBytes(next, 'approval source');
      const owned = ownership(input.id, proved.ownership.sourceRel,
        sha256Hex(sourceBytes), next.revision, identity.operationId,
        identity.createdAt, proved.ownership.scope.areaIds,
        [...proved.ownership.chain, identity.operationId]);
      const sidecarBytes = ownedDocumentBytes(owned, 'approval ownership');
      built = { record: next, sourceRel: proved.ownership.sourceRel,
        ownershipRel: ownershipRelFor(input.id) };
      return [
        { sourceKind: 'approval', recordId: input.id,
          sourceRevision: input.expectedRevision, previousHash: baseHash,
          areaIds: [...proved.ownership.scope.areaIds],
          file: { rel: proved.ownership.sourceRel, content: sourceBytes } },
        { sourceKind: 'record-ownership', recordId: input.id,
          sourceRevision: tipRevision,
          previousHash: sha256Hex(proved.sidecarBytes),
          areaIds: [...proved.ownership.scope.areaIds],
          file: { rel: ownershipRelFor(input.id), content: sidecarBytes } },
      ];
    });
    return { mode: 'applied', record: built.record,
      sourceRel: built.sourceRel, ownershipRel: built.ownershipRel,
      ownershipConfirmed: journal.status === 'committed'
        && journal.journalState === 'confirmed',
      journal };
  }

  function get(recordId) {
    if (typeof recordId !== 'string' || !SHA_RE.test(recordId)) {
      throw err(OWNED_INPUT, 'owned approval id must be a sha256 digest');
    }
    const proved = readOwnedApproval(recordId);
    return { record: proved.record, ownership: proved.ownership,
      locator: { operationId: proved.tip.operationId,
        eventId: proved.tip.event.eventId },
      isCurrentSource: true, memoryConsulted: false };
  }

  return Object.freeze({ prepare, create, get, answer });
}
