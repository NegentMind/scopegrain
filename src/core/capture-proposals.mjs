// SPDX-License-Identifier: Apache-2.0
// Selective capture producers: pure, deterministic mapping from recorded
// harness activity (committed journal operations, explicit init answers)
// to capture PROPOSALS for opt-in review - never captures themselves.
// Producers read only journal metadata, hash-verified journal snapshots
// and the supplied answers object: no conversation interception, no
// project-file scanning, no memory backend. Approve preserves
// the statement basis; only an explicit operator edit re-marks declared.
// The only write surface is persistProposalDecision: review decisions
// recorded by an explicit caller into the append-only decisions log so a
// rejected proposal stops reappearing in later emissions.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { err } from './errors.mjs';
import {
  decodeUtf8Strict, lstatOrNull, mkdirpSync, readFileLimited,
} from './fsx.mjs';
import { canonicalDigest } from './digests.mjs';
import { loadJournalPolicy } from './policy.mjs';
import { resolveInside } from './paths.mjs';
import { VERSIONING_KEYS, validateAnswers } from './config.mjs';
import { normalizeCaptureInput, validateCaptureNote } from './capture-data.mjs';
import {
  getJournalOperation, listJournalPending, readJournalSnapshot,
} from './journal.mjs';
import {
  assertRecordObject, cloneRecordJSON, isRecordUUID,
} from './record-ownership-data.mjs';
import {
  bindWorkspace, getWorkspace, resolveWorkspaceState,
} from './workspaces.mjs';

const CODE = 'INVALID_PROPOSAL';
const SEED_PREFIX = 'scopegrain:capture-proposal:v1:';
const KIND = /^[a-z][a-z0-9-]{0,63}$/;
// Journal record ids are wider than UUIDs (any lowercase slug); provenance
// accepts both forms.
const RECORD_ID = /^[a-z0-9][a-z0-9-]{0,127}$/;
const CATEGORIES = ['decision', 'event', 'attempt', 'discard', 'preference',
  'tool', 'skill', 'stack', 'lesson'];
const PRODUCERS = ['journal', 'init-answers'];
const PROPOSAL_KEYS = ['schemaVersion', 'proposalId', 'category', 'statement',
  'provenance', 'suggestedAreaIds', 'suggestedSubjectId', 'evidence'];
const STATEMENT_KEYS = ['kind', 'title', 'text', 'inference'];
const PROVENANCE_KEYS = ['producer', 'operationId', 'eventId', 'sourceKind',
  'recordId'];
const JOURNAL_OPTION_KEYS = ['sinceOperationId', 'sinceSequence', 'limit'];
const ANSWER_OPTION_KEYS = ['areaIds', 'subjectId'];
const DECISION_KEYS = ['action', 'reason', 'changes'];
const CHANGE_KEYS = ['title', 'summary', 'category', 'subjectId', 'areaIds',
  'supersedes'];
const COMPANION_KIND = 'record-ownership';
const DEFAULT_INFERENCE = 'harness-default';
const DECISIONS_REL = 'capture-proposal-decisions.jsonl';
const DECISION_KEYS_STORED = ['schemaVersion', 'proposalId', 'proposalHash',
  'action', 'reason', 'decidedAt'];
const DECISION_ACTIONS = ['approve', 'reject', 'edit'];
const DECISIONS_MAX_BYTES = 1024 * 1024;
const DECISION_LINE_MAX = 16 * 1024;
const HASH_RE = /^[0-9a-f]{64}$/;

function nonblank(value) {
  return typeof value === 'string' && value.trim() !== '';
}

// Deterministic name-based UUID: sha256 of a namespaced seed rendered with
// version-5/variant bits. An identifier, never randomness or identity proof.
function digestUUID(seed) {
  const h = crypto.createHash('sha256')
    .update(SEED_PREFIX + seed, 'utf8').digest('hex');
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}`
    + `-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// Dense array of distinct canonical UUIDs; empties allowed (init answers
// may predate workspace enrollment). No sorting - caller chooses order.
function idArray(value, code, label) {
  if (!Array.isArray(value)
      || Object.getPrototypeOf(value) !== Array.prototype
      || Object.getOwnPropertySymbols(value).length
      || Object.getOwnPropertyNames(value).length !== value.length + 1) {
    throw err(code, `${label} must be a dense array`);
  }
  for (let i = 0; i < value.length; i += 1) {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !d.enumerable || !Object.hasOwn(d, 'value')) {
      throw err(code, `${label} must contain only values`);
    }
  }
  if (!value.every(isRecordUUID) || new Set(value).size !== value.length) {
    throw err(code, `${label} entries must be distinct UUIDs`);
  }
  return [...value];
}

function nonblankArray(value, code, label) {
  if (!Array.isArray(value) || !value.length
      || Object.getPrototypeOf(value) !== Array.prototype
      || Object.getOwnPropertySymbols(value).length
      || Object.getOwnPropertyNames(value).length !== value.length + 1
      || !value.every(nonblank)) {
    throw err(code, `${label} must be a non-empty dense array of nonblank strings`);
  }
  return [...value];
}

// Closed proposal contract. Returns an independent JSON-safe clone.
export function validateProposal(value) {
  assertRecordObject(value, PROPOSAL_KEYS, PROPOSAL_KEYS, CODE,
    'capture proposal');
  if (value.schemaVersion !== 1 || !isRecordUUID(value.proposalId)
      || !CATEGORIES.includes(value.category)) {
    throw err(CODE, 'capture proposal has invalid fields');
  }
  assertRecordObject(value.statement, STATEMENT_KEYS, STATEMENT_KEYS, CODE,
    'proposal statement');
  const st = value.statement;
  if (!['declared', 'inferred'].includes(st.kind) || !nonblank(st.title)
      || !nonblank(st.text)
      || (st.kind === 'inferred' ? !nonblank(st.inference)
        : st.inference !== null)) {
    throw err(CODE, 'proposal statement has invalid fields');
  }
  assertRecordObject(value.provenance, PROVENANCE_KEYS, PROVENANCE_KEYS, CODE,
    'proposal provenance');
  const pv = value.provenance;
  if (!PRODUCERS.includes(pv.producer)
      || (pv.operationId !== null && !isRecordUUID(pv.operationId))
      || (pv.eventId !== null && !isRecordUUID(pv.eventId))
      || (pv.recordId !== null && (typeof pv.recordId !== 'string'
        || !RECORD_ID.test(pv.recordId)))
      || (pv.sourceKind !== null
        && (typeof pv.sourceKind !== 'string' || !KIND.test(pv.sourceKind)))) {
    throw err(CODE, 'proposal provenance has invalid fields');
  }
  idArray(value.suggestedAreaIds, CODE, 'proposal suggestedAreaIds');
  if (value.suggestedSubjectId !== null && !nonblank(value.suggestedSubjectId)) {
    throw err(CODE, 'proposal suggestedSubjectId must be null or nonblank');
  }
  nonblankArray(value.evidence, CODE, 'proposal evidence');
  return cloneRecordJSON(value);
}

function proposal(seed, category, statement, provenance, suggestedAreaIds,
    suggestedSubjectId, evidence) {
  return validateProposal({
    schemaVersion: 1, proposalId: digestUUID(seed), category, statement,
    provenance, suggestedAreaIds, suggestedSubjectId, evidence,
  });
}

function resolveBound(target) {
  if (target === null || typeof target !== 'object' || Array.isArray(target)) {
    throw err(CODE, 'journal producer requires a bound workspace or resolved context');
  }
  if (typeof target.workspaceId === 'string'
      && typeof target.projectId === 'string'
      && typeof target.repositoryId === 'string'
      && Array.isArray(target.areaIds)) {
    return target; // authenticity is enforced by the journal calls below
  }
  if (typeof target.projectRoot === 'string'
      && target.config !== null && typeof target.config === 'object') {
    const workspace = getWorkspace(target);
    return bindWorkspace(target,
      { areaIds: workspace.areas.map((area) => area.id) });
  }
  throw err(CODE, 'journal producer requires a bound workspace or resolved context');
}

function journalOptions(options) {
  assertRecordObject(options, JOURNAL_OPTION_KEYS, [], CODE,
    'journal proposal options');
  const policy = loadJournalPolicy();
  const hasSeq = Object.hasOwn(options, 'sinceSequence');
  const hasOp = Object.hasOwn(options, 'sinceOperationId');
  if (hasSeq && hasOp) {
    throw err(CODE, 'sinceSequence and sinceOperationId are mutually exclusive');
  }
  let sinceSequence = null;
  let sinceOperationId = null;
  if (hasSeq) {
    if (!Number.isSafeInteger(options.sinceSequence) || options.sinceSequence < 0) {
      throw err(CODE, 'sinceSequence must be a non-negative safe integer');
    }
    sinceSequence = options.sinceSequence;
  }
  if (hasOp) {
    if (!isRecordUUID(options.sinceOperationId)) {
      throw err(CODE, 'sinceOperationId must be a UUID');
    }
    sinceOperationId = options.sinceOperationId;
  }
  let limit = policy.defaultPageSize;
  if (Object.hasOwn(options, 'limit')) {
    if (!Number.isSafeInteger(options.limit) || options.limit <= 0
        || options.limit > policy.maxPageSize) {
      throw err(CODE, 'limit must be a positive safe integer within policy');
    }
    limit = options.limit;
  }
  return { sinceSequence, sinceOperationId, limit };
}

// Verified snapshot bytes are recorded facts: when they parse as a capture
// note, its declared title/category enrich the statement. Any read or
// parse failure degrades to event-metadata text, never a hard failure for
// a single event.
function captureNote(bound, item) {
  try {
    const bytes = readJournalSnapshot(
      bound, item.operationId, item.event.eventId);
    // Hash-verified snapshot bytes may still carry non-roundtrippable
    // UTF-8: the strict decode keeps a corrupt note from degrading into
    // silently different proposal text (the catch below degrades to the
    // generic event-metadata statement, which is the documented outcome).
    return validateCaptureNote(JSON.parse(
      decodeUtf8Strict(bytes, 'CAPTURE_MALFORMED', 'capture note')));
  } catch {
    return null;
  }
}

function eventProposal(bound, item) {
  const event = item.event;
  if (event.sourceKind === COMPANION_KIND) return null; // companion metadata
  let title = `${event.sourceKind} record created`;
  let text = `A ${event.sourceKind} record ${event.recordId}`
    + ` was created at ${event.sourceRel}.`;
  if (event.sourceKind === 'capture') {
    const note = captureNote(bound, item);
    if (note) {
      title = 'capture note recorded';
      text = `Capture note ${event.recordId} (${note.category}) was created`
        + ` at ${event.sourceRel}: ${note.title}`;
    }
  }
  return proposal(`journal:${item.operationId}:${event.journalSequence}`,
    'event',
    { kind: 'declared', title, text, inference: null },
    { producer: 'journal', operationId: item.operationId,
      eventId: event.eventId, sourceKind: event.sourceKind,
      recordId: event.recordId },
    [...event.areaIds].sort(), null,
    [`journal-operation:${item.operationId}`,
      `journal-event:${event.eventId}`,
      `journal-sequence:${event.journalSequence}`,
      `source:${event.sourceRel}`, `snapshot:${event.sourceHash}`]);
}

function recoveryProposal(operationId, group, recovery) {
  const areas = [...new Set(
    group.flatMap((item) => item.event.areaIds))].sort();
  return proposal(`journal:${operationId}:recovery`, 'decision',
    { kind: 'declared', title: 'journal recovery decision',
      text: `Operation ${operationId} was resolved with action`
        + ` '${recovery.action}': ${recovery.reason}`,
      inference: null },
    { producer: 'journal', operationId, eventId: null,
      sourceKind: null, recordId: null },
    areas, null,
    [`journal-operation:${operationId}`,
      `journal-recovery:${recovery.action}`]);
}

// Proposals from committed journal operations. The only committed listing
// the journal exposes is the outbox (unacked events); fully acked or
// index-removed operations are invisible - proposals are review material,
// not an audit trail. A journal needing recovery fails closed. No writes.
export function proposeFromJournal(target, options = {}) {
  const bound = resolveBound(target);
  const opts = journalOptions(options);
  let after = 0;
  if (opts.sinceSequence !== null) {
    after = opts.sinceSequence;
  } else if (opts.sinceOperationId !== null) {
    const loaded = getJournalOperation(bound, opts.sinceOperationId);
    after = Math.max(
      ...loaded.intent.events.map((event) => event.journalSequence));
  }
  const items = [];
  for (;;) {
    const page = listJournalPending(bound, { afterSequence: after, limit: opts.limit });
    items.push(...page.items);
    if (page.nextAfterSequence === null) break;
    after = page.nextAfterSequence;
  }
  const groups = new Map();
  for (const item of items) {
    if (item.state !== 'committed') continue;
    if (!groups.has(item.operationId)) groups.set(item.operationId, []);
    groups.get(item.operationId).push(item);
  }
  const proposals = [];
  for (const [operationId, group] of groups) {
    group.sort((x, y) => x.event.journalSequence - y.event.journalSequence);
    let loaded = null;
    try {
      loaded = getJournalOperation(bound, operationId);
    } catch (e) {
      if (e.code !== 'SCOPE_DENIED') throw e; // event items already authorized
    }
    for (const item of group) {
      const built = eventProposal(bound, item);
      if (built) proposals.push(built);
    }
    if (loaded !== null && loaded.recovery) {
      proposals.push(recoveryProposal(operationId, group, loaded.recovery));
    }
  }
  return filterRejectedProposals(
    proposals, listProposalDecisions(bound).decisions);
}

// Preference proposals from explicit owner answers. Every emitted proposal
// is 'declared' when it derives from an answered field; absent
// methodology/versioning fields emit 'inferred' proposals naming the
// harness-default derivation - validator defaults are never re-labeled as
// answers. Pure: no config file is read here; the caller supplies the data.
// The subject of each preference is the answered setting itself: an
// explicit options.subjectId wins, otherwise the answer key is the stable
// subject label so a system-generated proposal approves verbatim and a
// later preference on the same setting can supersede it.
export function proposeFromInitAnswers(answers, options = {}) {
  assertRecordObject(options, ANSWER_OPTION_KEYS, [], CODE,
    'init-answers proposal options');
  let areaIds = [];
  if (Object.hasOwn(options, 'areaIds')) {
    areaIds = idArray(options.areaIds, CODE, 'init-answers options.areaIds');
  }
  let subjectId = null;
  if (Object.hasOwn(options, 'subjectId')) {
    if (options.subjectId !== null && !nonblank(options.subjectId)) {
      throw err(CODE, 'init-answers options.subjectId must be null or nonblank');
    }
    subjectId = options.subjectId;
  }
  const validated = validateAnswers(answers); // domain codes propagate
  const seed = `init-answers:${canonicalDigest(answers)}`;
  const areas = [...areaIds].sort();
  const proposals = [];
  const add = (field, kind, title, text, inference) => {
    proposals.push(proposal(`${seed}:${field}`, 'preference',
      { kind, title, text, inference },
      { producer: 'init-answers', operationId: null, eventId: null,
        sourceKind: null, recordId: null },
      areas, subjectId ?? field, [`answers:${field}`]));
  };
  add('locale', 'declared', 'preferred locale',
    `The project locale was answered as '${validated.locale}'.`, null);
  add('hosts', 'declared', 'preferred hosts',
    `The answered hosts are: ${validated.hosts.join(', ')}.`, null);
  if (Object.hasOwn(answers, 'methodology')) {
    add('methodology', 'declared', 'preferred methodology',
      `The methodology was answered as '${validated.methodology}'.`, null);
  } else {
    add('methodology', 'inferred', 'methodology default',
      `No methodology was answered; the harness legacy default`
        + ` '${validated.methodology}' applies.`,
      DEFAULT_INFERENCE);
  }
  if (Object.hasOwn(answers, 'versioning')) {
    for (const key of VERSIONING_KEYS) {
      add(`versioning.${key}`, 'declared', `versioning preference: ${key}`,
        `Versioning for '${key}' was answered as ${validated.versioning[key]}.`,
        null);
    }
  } else {
    add('versioning', 'inferred', 'versioning defaults',
      'No versioning preferences were answered; all eight categories'
        + ' default to disabled.',
      DEFAULT_INFERENCE);
  }
  return proposals;
}

function reviewChanges(changes) {
  assertRecordObject(changes, CHANGE_KEYS, [], CODE, 'review changes');
  return cloneRecordJSON(changes);
}

// Pure review gate. Reject produces nothing. Approve/edit compose the
// wrapped capture DTO {areaIds, capture:{...}} and validate it through the
// existing capture input contract; an incomplete proposal fails closed.
// Approve preserves the statement basis (inferred never promotes); edit
// re-marks basis 'declared' because the text is now operator-authored.
export function reviewProposal(proposalValue, decision) {
  const p = validateProposal(proposalValue);
  assertRecordObject(decision, DECISION_KEYS, ['action'], CODE,
    'review decision');
  if (!['approve', 'reject', 'edit'].includes(decision.action)) {
    throw err(CODE, 'review decision action must be approve, reject or edit');
  }
  if (Object.hasOwn(decision, 'reason') && !nonblank(decision.reason)) {
    throw err(CODE, 'review decision reason must be a nonblank string');
  }
  const hasChanges = Object.hasOwn(decision, 'changes');
  if (decision.action === 'edit' && !hasChanges) {
    throw err(CODE, 'edit decision requires changes');
  }
  if (decision.action !== 'edit' && hasChanges) {
    throw err(CODE, 'changes are only allowed for edit decisions');
  }
  if (decision.action === 'reject') return { status: 'rejected' };
  const changes = decision.action === 'edit'
    ? reviewChanges(decision.changes) : {};
  const pick = (key, fallback) =>
    (Object.hasOwn(changes, key) ? changes[key] : fallback);
  const normalized = normalizeCaptureInput({
    category: pick('category', p.category),
    title: pick('title', p.statement.title),
    summary: pick('summary', p.statement.text),
    areaIds: pick('areaIds', p.suggestedAreaIds),
    basis: decision.action === 'edit' ? 'declared' : p.statement.kind,
    subjectId: pick('subjectId', p.suggestedSubjectId),
    supersedes: pick('supersedes', null),
  });
  return {
    status: 'approved',
    input: {
      areaIds: normalized.areaIds,
      capture: {
        category: normalized.category, title: normalized.title,
        summary: normalized.summary, basis: normalized.basis,
        subjectId: normalized.subjectId, supersedes: normalized.supersedes,
      },
    },
  };
}

// --- Review-decision store ---------------------------------------------------
//
// Persisted decisions live in an append-only JSONL log owned by the
// project under <paths.state>/capture-proposal-decisions.jsonl — same
// store family as the bounded worklog logs: one record per line, latest
// record per proposalId wins, bounded read, malformed lines reported
// rather than trusted. Each record carries the canonical digest of the
// reviewed proposal so a rejection suppresses only that exact proposal:
// a materially different proposal reusing the deterministic id is never
// silenced by a stale decision.
function decisionsAbs(target) {
  const bound = resolveBound(target);
  const { projectRoot, stateRel } = resolveWorkspaceState(bound);
  return resolveInside(projectRoot,
    `${stateRel}/${DECISIONS_REL}`, 'capture decisions log');
}

function validateDecisionRecord(value) {
  assertRecordObject(value, DECISION_KEYS_STORED, DECISION_KEYS_STORED,
    CODE, 'proposal decision record');
  if (value.schemaVersion !== 1 || !isRecordUUID(value.proposalId)
      || typeof value.proposalHash !== 'string' || !HASH_RE.test(value.proposalHash)
      || !DECISION_ACTIONS.includes(value.action)
      || (value.reason !== null && !nonblank(value.reason))
      || typeof value.decidedAt !== 'string' || value.decidedAt === '') {
    throw err(CODE, 'proposal decision record has invalid fields');
  }
  return cloneRecordJSON(value);
}

// Bounded read of every stored decision; absent log means no decisions.
export function listProposalDecisions(target) {
  const out = { decisions: [], malformed: [] };
  const abs = decisionsAbs(target);
  const st = lstatOrNull(abs);
  if (!st) return out;
  if (st.isSymbolicLink() || !st.isFile()) {
    throw err('INVALID_PATH', 'capture decisions log is not a real file');
  }
  const limited = readFileLimited(abs, DECISIONS_MAX_BYTES);
  if (limited.exceeded) {
    throw err('DOCUMENT_TOO_LARGE', 'capture decisions log exceeds bound');
  }
  const text = decodeUtf8Strict(
    limited.content, 'DECISIONS_MALFORMED', 'capture decisions log');
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      out.decisions.push(validateDecisionRecord(JSON.parse(line)));
    } catch {
      out.malformed.push({ line: line.slice(0, 120) });
    }
  }
  return out;
}

// Persisted review: the pure gate runs first (an invalid proposal or
// decision never writes), then the decision record is appended.
// Returns {review, decision} — review is the same outcome reviewProposal
// produces, decision is the stored record.
export function persistProposalDecision(target, proposalValue, decision) {
  const bound = resolveBound(target);
  const p = validateProposal(proposalValue);
  const review = reviewProposal(p, decision);
  const record = validateDecisionRecord({
    schemaVersion: 1, proposalId: p.proposalId,
    proposalHash: canonicalDigest(p), action: decision.action,
    reason: Object.hasOwn(decision, 'reason') ? decision.reason : null,
    decidedAt: new Date().toISOString(),
  });
  const line = JSON.stringify(record) + '\n';
  if (Buffer.byteLength(line, 'utf8') > DECISION_LINE_MAX) {
    throw err(CODE, 'proposal decision record exceeds line bound');
  }
  const abs = decisionsAbs(bound);
  mkdirpSync(path.dirname(abs));
  fs.appendFileSync(abs, line, 'utf8');
  return { review, decision: record };
}

// Pure filter: drop proposals whose latest decision is a hash-matching
// 'reject'. Approve/edit decisions stay visible — they are review
// history, not suppression; only an explicit rejection silences
// re-emission. Takes the plain decisions array from
// listProposalDecisions so pure producers (init answers) apply the same
// rule wherever a caller can supply the store.
export function filterRejectedProposals(proposals, decisions) {
  const latest = new Map();
  for (const d of decisions) latest.set(d.proposalId, d);
  return proposals.filter((p) => {
    const d = latest.get(p.proposalId);
    return !(d && d.action === 'reject'
      && d.proposalHash === canonicalDigest(p));
  });
}
