// SPDX-License-Identifier: Apache-2.0
// Task state operations: JSON documents under paths.tasks, guarded by
// per-task exclusive locks and compare-and-swap on revision.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { err } from './errors.mjs';
import { decodeUtf8Strict, lstatOrNull, mkdirpSync, readFileLimited, writeFileExclusive } from './fsx.mjs';
import { assertDestination, isSameOrAncestor, resolveInside }
  from './paths.mjs';
import { knownStates, loadLimits, loadPolicy } from './policy.mjs';
import { validateReview, validateVerification } from './evidence.mjs';
import { canonicalDigest } from './digests.mjs';
import { getArtifact } from './artifacts.mjs';
import { getSpecification } from './specifications.mjs';
import {
  classifyWork, normalizeScenarioRefs, validateMethodologyData,
} from './methodology-data.mjs';
import { validateSpecificationItemId } from './specification-data.mjs';
import { validateMethodologyMode } from './config.mjs';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUUID = (v) => typeof v === 'string' && UUID_RE.test(v);

const TASK_KEYS = new Set([
  'schemaVersion', 'id', 'title', 'contract', 'authorContext', 'scope',
  'state', 'revision', 'verification', 'review', 'createdAt', 'updatedAt',
  'history', 'methodology', 'specId', 'designId', 'planKey', 'scenarioRefs',
  'slug',
  // V3 semantic extensions (parity with the legacy backlog/task-file model)
  'backlog', 'disposition', 'priority', 'severity', 'type', 'effort',
  'estimate', 'source', 'relations', 'dependsOn', 'goalIds', 'analysis',
  'steps', 'notes', 'skills', 'uncertainty',
  // V3 extension fields (optional on read, emitted on write)
  'allowedTools', 'requiredCapabilities', 'agentRole', 'expectedOutputs',
  'sideEffects', 'executionType', 'outputContract', 'reviewRubric',
  'fallback', 'contextInheritance',
]);
const V3_KEYS = new Set([
  'backlog', 'disposition', 'priority', 'severity', 'type', 'effort',
  'estimate', 'source', 'relations', 'dependsOn', 'goalIds', 'analysis',
  'steps', 'notes', 'skills', 'uncertainty',
]);
// Additive fields introduced after V3 shipped. Stored V3 records may omit
// them entirely (same rule as slug): validated when present, never
// required on read, and always emitted by new writes via V3_DEFAULTS.
const V3_EXT_KEYS = new Set([
  'allowedTools', 'requiredCapabilities', 'agentRole', 'expectedOutputs',
  'sideEffects', 'executionType', 'outputContract', 'reviewRubric',
  'fallback', 'contextInheritance',
]);
const TASK_PRIORITIES = new Set(['p0', 'p1', 'p2', 'p3', 'backlog']);
const TASK_SEVERITIES = new Set(['critical', 'high', 'medium', 'low', 'info']);
const TASK_TYPES = new Set([
  'bug', 'feature', 'refactor', 'research', 'docs', 'ops', 'mixed',
]);
const TASK_EFFORTS = new Set(['hours', 'day', 'days', 'weeks']);
const TASK_DISPOSITIONS = new Set([
  'deferred', 'icebox', 'future', 'discarded', 'cancelled',
]);
const TASK_SIDE_EFFECTS = new Set(['none', 'reversible', 'irreversible']);
// 'consensus' (multi-agent debate) is deliberately absent: personas do
// not invoke personas per resources/references/orchestration-patterns.md.
const TASK_EXECUTION_TYPES = new Set(['atomic', 'delegated', 'hitl']);
const TASK_FALLBACK_ON_FAIL = new Set(['stall', 'abandon', 'needs-human']);
const TASK_CONTEXT_INHERITANCE = new Set(['isolated', 'summary', 'full']);
export const RELATION_KINDS = new Set(
  ['see', 'supersedes', 'duplicateOf', 'blocks']);
const STEP_STATUSES = new Set(['pending', 'done', 'skipped']);
const BACKLOG_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const META_KEYS = new Set([
  'priority', 'severity', 'type', 'effort', 'estimate', 'source',
  'relations', 'dependsOn', 'goalIds', 'analysis', 'skills', 'backlog',
  'allowedTools', 'requiredCapabilities', 'agentRole', 'expectedOutputs',
  'sideEffects', 'executionType', 'outputContract', 'reviewRubric',
  'fallback', 'contextInheritance',
]);
const CREATE_KEYS = new Set([
  'title', 'contract', 'authorContext', 'scope', 'methodology',
  'specId', 'designId', 'planKey', 'scenarioRefs',
  'backlog', 'priority', 'severity', 'type', 'effort', 'estimate',
  'source', 'relations', 'dependsOn', 'goalIds', 'analysis', 'steps',
  'notes', 'skills', 'uncertainty', 'allowedTools', 'requiredCapabilities',
  'agentRole', 'expectedOutputs', 'sideEffects', 'executionType',
  'outputContract', 'reviewRubric', 'fallback', 'contextInheritance',
]);
const V2_KEYS = new Set(
  ['methodology', 'specId', 'designId', 'planKey', 'scenarioRefs']);
const PLAN_KEY_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SLUG_RE = /^[0-9]{3}-[a-z0-9][a-z0-9-]{0,60}$/;

// NNN- slug from a title (spec-kit feature-dir parity). The sequence
// number is the max existing NNN among stored task slugs + 1, so slugs
// stay unique and monotonic even when tasks are deleted.
export function slugifyTitle(title) {
  const s = String(title).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
    .replace(/-+$/g, '');
  return s === '' ? 'task' : s;
}

export function nextTaskSlug(ctx, title, reserved = []) {
  let max = 0;
  const consider = (s) => {
    const m = typeof s === 'string' && s.match(/^([0-9]{3})-/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  };
  for (const t of listTasks(ctx).tasks) consider(t.slug);
  for (const s of reserved) consider(s);
  return `${String(max + 1).padStart(3, '0')}-${slugifyTitle(title)}`;
}

export function taskBySlug(ctx, slug) {
  return listTasks(ctx).tasks.find((t) => t.slug === slug) ?? null;
}

function validateV3Fields(task, label) {
  if (task.backlog !== null && (typeof task.backlog !== 'string'
      || !BACKLOG_NAME_RE.test(task.backlog))) {
    throw err('TASK_MALFORMED', `${label}.backlog must be a backlog name or null`);
  }
  if (task.disposition !== null) {
    const d = task.disposition;
    if (d === null || typeof d !== 'object' || Array.isArray(d)
        || !TASK_DISPOSITIONS.has(d.kind)) {
      throw err('TASK_MALFORMED',
        `${label}.disposition must be null or {kind:<disposition>,reason,at,by}`);
    }
    for (const k of Object.keys(d)) {
      if (!['kind', 'reason', 'at', 'by'].includes(k)) {
        throw err('TASK_MALFORMED', `${label}.disposition unknown key '${k}'`);
      }
    }
  }
  if (task.priority !== null && !TASK_PRIORITIES.has(task.priority)) {
    throw err('TASK_MALFORMED', `${label}.priority must be p0..p3/backlog or null`);
  }
  if (task.severity !== null && !TASK_SEVERITIES.has(task.severity)) {
    throw err('TASK_MALFORMED', `${label}.severity invalid`);
  }
  if (task.type !== null && !TASK_TYPES.has(task.type)) {
    throw err('TASK_MALFORMED', `${label}.type invalid`);
  }
  if (task.effort !== null && !TASK_EFFORTS.has(task.effort)) {
    throw err('TASK_MALFORMED', `${label}.effort invalid`);
  }
  if (task.estimate !== null) {
    const e = task.estimate;
    if (e === null || typeof e !== 'object' || Array.isArray(e)
        || (e.turns !== undefined
          && (!Number.isSafeInteger(e.turns) || e.turns < 0))
        || (e.appetite !== undefined && !TASK_EFFORTS.has(e.appetite))) {
      throw err('TASK_MALFORMED',
        `${label}.estimate must be null or {turns:int,appetite:<effort>}`);
    }
    for (const k of Object.keys(e)) {
      if (!['turns', 'appetite'].includes(k)) {
        throw err('TASK_MALFORMED', `${label}.estimate unknown key '${k}'`);
      }
    }
  }
  if (task.source !== null && typeof task.source !== 'string') {
    throw err('TASK_MALFORMED', `${label}.source must be a string or null`);
  }
  if (task.relations !== null) {
    const r = task.relations;
    if (typeof r !== 'object' || Array.isArray(r)) {
      throw err('TASK_MALFORMED', `${label}.relations must be an object or null`);
    }
    for (const k of Object.keys(r)) {
      if (!RELATION_KINDS.has(k)) {
        throw err('TASK_MALFORMED',
          `${label}.relations unknown kind '${k}'`);
      }
      if (!Array.isArray(r[k])
          || !r[k].every((v) => typeof v === 'string' && v.trim() !== '')) {
        throw err('TASK_MALFORMED',
          `${label}.relations.${k} must be an array of strings`);
      }
    }
  }
  if (task.dependsOn !== null && (!Array.isArray(task.dependsOn)
      || !task.dependsOn.every((v) => typeof v === 'string' && v.trim() !== ''))) {
    throw err('TASK_MALFORMED', `${label}.dependsOn must be an array of ids or null`);
  }
  if (task.goalIds !== null && (!Array.isArray(task.goalIds)
      || !task.goalIds.every((v) => typeof v === 'string' && v.trim() !== ''))) {
    throw err('TASK_MALFORMED', `${label}.goalIds must be an array of ids or null`);
  }
  if (task.analysis !== null) {
    const a = task.analysis;
    if (typeof a !== 'object' || Array.isArray(a)) {
      throw err('TASK_MALFORMED', `${label}.analysis must be an object or null`);
    }
    for (const k of Object.keys(a)) {
      if (!['blastRadius', 'impact', 'invariants', 'debt', 'debugEvidence',
        'security', 'performance'].includes(k)) {
        throw err('TASK_MALFORMED', `${label}.analysis unknown key '${k}'`);
      }
    }
  }
  if (task.steps !== null && (!Array.isArray(task.steps)
      || !task.steps.every((s) => s !== null && typeof s === 'object'
        && typeof s.name === 'string' && s.name.trim() !== ''
        && STEP_STATUSES.has(s.status)
        && (s.verify === undefined || typeof s.verify === 'string')))) {
    throw err('TASK_MALFORMED',
      `${label}.steps must be [{name,status:pending|done|skipped,verify?}]`);
  }
  if (task.notes !== null && (!Array.isArray(task.notes)
      || !task.notes.every((n) => typeof n === 'string'))) {
    throw err('TASK_MALFORMED', `${label}.notes must be an array of strings or null`);
  }
  if (task.skills !== null && (!Array.isArray(task.skills)
      || !task.skills.every((s) => typeof s === 'string' && s.trim() !== ''))) {
    throw err('TASK_MALFORMED', `${label}.skills must be an array of strings or null`);
  }
  if (task.allowedTools !== undefined && task.allowedTools !== null
      && (!Array.isArray(task.allowedTools)
        || !task.allowedTools.every((v) => typeof v === 'string' && v.trim() !== ''))) {
    throw err('TASK_MALFORMED',
      `${label}.allowedTools must be an array of tool names or null`);
  }
  if (task.requiredCapabilities !== undefined
      && task.requiredCapabilities !== null
      && (!Array.isArray(task.requiredCapabilities)
        || !task.requiredCapabilities.every(
          (v) => typeof v === 'string' && v.trim() !== ''))) {
    throw err('TASK_MALFORMED',
      `${label}.requiredCapabilities must be an array of capability names or null`);
  }
  if (task.agentRole !== undefined && task.agentRole !== null
      && (typeof task.agentRole !== 'string' || task.agentRole.trim() === '')) {
    throw err('TASK_MALFORMED',
      `${label}.agentRole must be a non-empty string or null`);
  }
  if (task.expectedOutputs !== undefined && task.expectedOutputs !== null) {
    const shapeOk = Array.isArray(task.expectedOutputs)
      && task.expectedOutputs.every((o) => o !== null
        && typeof o === 'object' && !Array.isArray(o)
        && typeof o.path === 'string'
        && (o.mustExist === undefined || typeof o.mustExist === 'boolean')
        && (o.mustBeNonEmpty === undefined
          || typeof o.mustBeNonEmpty === 'boolean')
        && Object.keys(o).every(
          (k) => ['path', 'mustExist', 'mustBeNonEmpty'].includes(k)));
    if (!shapeOk) {
      throw err('TASK_MALFORMED',
        `${label}.expectedOutputs must be [{path,mustExist?,mustBeNonEmpty?}] or null`);
    }
    for (const o of task.expectedOutputs) {
      // Stored paths must already be canonical (like stored scope).
      if (assertDestination(o.path, `${label}.expectedOutputs`) !== o.path) {
        throw err('TASK_MALFORMED',
          `${label}.expectedOutputs entry is not canonical: ${o.path}`);
      }
    }
  }
  if (task.sideEffects !== undefined && task.sideEffects !== null
      && !TASK_SIDE_EFFECTS.has(task.sideEffects)) {
    throw err('TASK_MALFORMED',
      `${label}.sideEffects must be none|reversible|irreversible or null`);
  }
  if (task.executionType !== undefined && task.executionType !== null
      && !TASK_EXECUTION_TYPES.has(task.executionType)) {
    throw err('TASK_MALFORMED',
      `${label}.executionType must be atomic|delegated|hitl or null`);
  }
  if (task.outputContract !== undefined && task.outputContract !== null
      && (typeof task.outputContract !== 'string'
        || task.outputContract.trim() === '')) {
    throw err('TASK_MALFORMED',
      `${label}.outputContract must be a non-empty string or null`);
  }
  if (task.reviewRubric !== undefined && task.reviewRubric !== null
      && (typeof task.reviewRubric !== 'string'
        || task.reviewRubric.trim() === '')) {
    throw err('TASK_MALFORMED',
      `${label}.reviewRubric must be a non-empty string or null`);
  }
  if (task.fallback !== undefined && task.fallback !== null) {
    const f = task.fallback;
    if (typeof f !== 'object' || Array.isArray(f)
        || !TASK_FALLBACK_ON_FAIL.has(f.onFail)
        || (f.note !== undefined && typeof f.note !== 'string')
        || Object.keys(f).some((k) => !['onFail', 'note'].includes(k))) {
      throw err('TASK_MALFORMED',
        `${label}.fallback must be null or {onFail: stall|abandon|needs-human, note?}`);
    }
  }
  if (task.contextInheritance !== undefined && task.contextInheritance !== null
      && !TASK_CONTEXT_INHERITANCE.has(task.contextInheritance)) {
    throw err('TASK_MALFORMED',
      `${label}.contextInheritance must be one of ${[...TASK_CONTEXT_INHERITANCE].join(', ')} or null`);
  }
  if (task.uncertainty !== null) {
    const u = task.uncertainty;
    if (typeof u !== 'object' || Array.isArray(u)
        || (u.uphill !== undefined
          && (!Number.isSafeInteger(u.uphill) || u.uphill < 0))
        || (u.downhill !== undefined
          && (!Number.isSafeInteger(u.downhill) || u.downhill < 0))) {
      throw err('TASK_MALFORMED',
        `${label}.uncertainty must be null or {uphill:int,downhill:int}`);
    }
    for (const k of Object.keys(u)) {
      if (!['uphill', 'downhill'].includes(k)) {
        throw err('TASK_MALFORMED', `${label}.uncertainty unknown key '${k}'`);
      }
    }
  }
}

function nowIso() {
  return new Date().toISOString();
}

export function tasksDirAbs(ctx) {
  return resolveInside(ctx.projectRoot, ctx.config.paths.tasks, 'paths.tasks');
}

export function taskFilePath(ctx, id) {
  if (!isUUID(id)) {
    throw err('INVALID_ID', `task id must be a UUID, got: ${String(id)}`);
  }
  return path.join(tasksDirAbs(ctx), `${id.toLowerCase()}.json`);
}

function requireNonEmpty(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw err('INVALID_VALUE', `${label} must be a non-empty string`);
  }
  return value;
}

export function validateTaskShape(task, label = 'task') {
  if (task === null || typeof task !== 'object' || Array.isArray(task)) {
    throw err('TASK_MALFORMED', `${label} is not an object`);
  }
  for (const key of Object.keys(task)) {
    if (!TASK_KEYS.has(key)) {
      throw err('TASK_MALFORMED', `${label} contains unknown key '${key}'`);
    }
  }
  if (task.schemaVersion !== 1 && task.schemaVersion !== 2
      && task.schemaVersion !== 3) {
    throw err('TASK_MALFORMED',
      `${label}.schemaVersion must be 1, 2 or 3`);
  }
  // V1 forbids the methodology fields entirely; V2 requires all five in
  // their normalized forms — no defaults are ever invented on read.
  if (task.schemaVersion === 1) {
    for (const k of [...V2_KEYS, ...V3_KEYS, ...V3_EXT_KEYS]) {
      if (task[k] !== undefined) {
        throw err('TASK_MALFORMED',
          `${label} V1 may not carry '${k}'`);
      }
    }
  } else {
    for (const k of V2_KEYS) {
      if (task[k] === undefined) {
        throw err('TASK_MALFORMED',
          `${label} V2 requires '${k}'`);
      }
    }
    validateV2Fields(task, label);
    if (task.schemaVersion === 2) {
      for (const k of [...V3_KEYS, ...V3_EXT_KEYS]) {
        if (task[k] !== undefined) {
          throw err('TASK_MALFORMED',
            `${label} V2 may not carry '${k}'`);
        }
      }
    } else {
      for (const k of V3_KEYS) {
        if (task[k] === undefined) {
          throw err('TASK_MALFORMED',
            `${label} V3 requires '${k}'`);
        }
      }
      validateV3Fields(task, label);
    }
  }
  if (!isUUID(task.id)) {
    throw err('TASK_MALFORMED', `${label} has a non-UUID id`);
  }
  // slug is optional on stored records (legacy tasks predate it); when
  // present it must be the canonical NNN-slug form.
  if (task.slug !== undefined && task.slug !== null
      && (typeof task.slug !== 'string' || !SLUG_RE.test(task.slug))) {
    throw err('TASK_MALFORMED', `${label}.slug must match NNN-slug form`);
  }
  requireNonEmpty(task.title, `${label}.title`);
  requireNonEmpty(task.contract, `${label}.contract`);
  requireNonEmpty(task.authorContext, `${label}.authorContext`);
  if (!Array.isArray(task.scope)
      || !task.scope.every((s) => typeof s === 'string')) {
    throw err('TASK_MALFORMED', `${label}.scope must be an array of strings`);
  }
  for (const s of task.scope) {
    // Stored scope must already be canonical and safe.
    if (assertDestination(s, `${label}.scope`) !== s) {
      throw err('TASK_MALFORMED', `${label}.scope entry is not canonical: ${s}`);
    }
  }
  if (!knownStates().includes(task.state)) {
    throw err('TASK_MALFORMED', `${label} has unknown state '${task.state}'`);
  }
  if (!Number.isSafeInteger(task.revision) || task.revision < 0) {
    throw err('TASK_MALFORMED', `${label}.revision must be a non-negative integer`);
  }
  const isCanon = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v))
    && new Date(Date.parse(v)).toISOString() === v;
  for (const ts of ['createdAt', 'updatedAt']) {
    if (!isCanon(task[ts])) {
      throw err('TASK_MALFORMED', `${label}.${ts} must be a canonical ISO timestamp`);
    }
  }
  if (Date.parse(task.createdAt) > Date.parse(task.updatedAt)) {
    throw err('TASK_MALFORMED', `${label}.createdAt must not exceed updatedAt`);
  }
  if (!Array.isArray(task.history) || task.history.length === 0
      || !task.history.every((h) => h !== null && typeof h === 'object'
        && isCanon(h.at) && typeof h.event === 'string')) {
    throw err('TASK_MALFORMED',
      `${label}.history must be a non-empty array of {at,event,...} records`);
  }
  // Chronology: nondecreasing event times within [createdAt, updatedAt];
  // the first event IS creation, the last IS the latest update.
  const first = Date.parse(task.history[0].at);
  const last = Date.parse(task.history.at(-1).at);
  let prev = first;
  for (const h of task.history) {
    const t = Date.parse(h.at);
    if (t < prev || t < Date.parse(task.createdAt)
        || t > Date.parse(task.updatedAt)) {
      throw err('TASK_MALFORMED', `${label}.history chronology invalid`);
    }
    prev = t;
  }
  if (first !== Date.parse(task.createdAt)
      || last !== Date.parse(task.updatedAt)) {
    throw err('TASK_MALFORMED', `${label}.history bounds must match created/updated`);
  }
  // Stored evidence is structural data: validate it, never trust it.
  if (task.verification !== null && task.verification !== undefined) {
    validateVerification(task.verification);
  }
  if (task.review !== null && task.review !== undefined) {
    validateReview(task.review, task);
  }
  return task;
}

function readTaskFile(file, id) {
  const st = lstatOrNull(file);
  if (!st) throw err('TASK_NOT_FOUND', `task not found: ${id}`);
  if (st.isSymbolicLink()) {
    throw err('SYMLINK_REJECTED', `task file may not be a symlink: ${id}`);
  }
  const limited = readFileLimited(file, loadLimits().maxDocumentBytes);
  if (limited.exceeded) {
    throw err('TASK_MALFORMED', `task ${id} exceeds document limit`);
  }
  const text = decodeUtf8Strict(
    limited.content, 'TASK_MALFORMED', `task ${id}`);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw err('TASK_MALFORMED', `task ${id} contains malformed JSON`);
  }
  let task;
  try {
    task = validateTaskShape(parsed, `task ${id}`);
  } catch (e) {
    // Any structural validation failure on STORED data is malformed data:
    // normalize to TASK_MALFORMED regardless of which check tripped.
    if (e && e.code === 'TASK_MALFORMED') throw e;
    throw err('TASK_MALFORMED',
      `task ${id} failed structural validation: ${e.message}`);
  }
  // A stored id that disagrees with its filename is malformed, not a task.
  const fileId = path.basename(file, '.json');
  if (UUID_RE.test(fileId) && task.id.toLowerCase() !== fileId.toLowerCase()) {
    throw err('TASK_MALFORMED',
      `task id ${task.id} does not match filename ${fileId}`);
  }
  return task;
}

export function getTask(ctx, id) {
  return readTaskFile(taskFilePath(ctx, id), id);
}

// Malformed entries are surfaced, never silently dropped.
export function listTasks(ctx) {
  const dir = tasksDirAbs(ctx);
  const out = { tasks: [], malformed: [] };
  const st = lstatOrNull(dir);
  if (!st) return out;
  if (st.isSymbolicLink() || !st.isDirectory()) {
    throw err('INVALID_PATH', `tasks path is not a real directory`);
  }
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(dir, name);
    const fst = lstatOrNull(file);
    if (!fst || fst.isSymbolicLink() || !fst.isFile()) continue;
    const stem = name.slice(0, -'.json'.length);
    if (!UUID_RE.test(stem)) {
      out.malformed.push({
        file: name,
        error: { code: 'TASK_MALFORMED', message: 'filename is not a UUID' },
      });
      continue;
    }
    try {
      out.tasks.push(readTaskFile(file, name));
    } catch (e) {
      out.malformed.push({
        file: name,
        error: { code: e.code || 'INTERNAL', message: e.message },
      });
    }
  }
  return out;
}

// Stored V2 field coherence — OWN record shape only, no live foreign-key
// lookups (a historical task stays readable if its spec disappears).
function validateV2Fields(task, label) {
  if (task.methodology !== null) {
    try {
      validateMethodologyData(task.methodology,
        `${label}.methodology`, { stored: true });
    } catch (e) {
      throw err('TASK_MALFORMED',
        `${label}.methodology: ${e.message}`);
    }
  }
  const hasSpec = task.specId !== null || task.designId !== null;
  if (hasSpec) {
    if (task.specId === null || task.designId === null
        || !isUUID(task.specId) || !isUUID(task.designId)) {
      throw err('TASK_MALFORMED',
        `${label} formal refs require specId AND designId UUIDs`);
    }
    if (task.planKey !== null && (typeof task.planKey !== 'string'
        || !PLAN_KEY_RE.test(task.planKey))) {
      throw err('TASK_MALFORMED', `${label}.planKey must be a slug or null`);
    }
    if (!Array.isArray(task.scenarioRefs) || task.scenarioRefs.length === 0) {
      throw err('TASK_MALFORMED',
        `${label} formal tasks require >=1 scenario pair`);
    }
    const seen = new Set();
    for (const r of task.scenarioRefs) {
      if (r === null || typeof r !== 'object' || Array.isArray(r)
          || Object.keys(r).length !== 2) {
        throw err('TASK_MALFORMED',
          `${label}.scenarioRefs pairs need exactly 2 keys`);
      }
      let rid;
      let sid;
      try {
        rid = validateSpecificationItemId(r.requirementId,
          `${label}.scenarioRefs.requirementId`);
        sid = validateSpecificationItemId(r.scenarioId,
          `${label}.scenarioRefs.scenarioId`);
      } catch (e) {
        throw err('TASK_MALFORMED',
          `${label}.scenarioRefs: ${e.message}`);
      }
      const k = `${rid.toLowerCase()}/${sid.toLowerCase()}`;
      if (seen.has(k)) {
        throw err('TASK_MALFORMED',
          `${label}.scenarioRefs duplicate ${rid}/${sid}`);
      }
      seen.add(k);
    }
  } else {
    // No formal refs: only a light assessment may occupy V2. null or a
    // methodology whose classification requires formal refs is malformed.
    if (task.designId !== null || task.planKey !== null
        || !Array.isArray(task.scenarioRefs) || task.scenarioRefs.length !== 0) {
      throw err('TASK_MALFORMED',
        `${label} light tasks store null refs and empty scenarioRefs`);
    }
    if (task.methodology === null && task.schemaVersion !== 3) {
      throw err('TASK_MALFORMED',
        `${label} V2 without refs requires a methodology assessment, not null`);
    }
    // V3 manual-mode records (upgraded V1) legitimately store a null
    // methodology with empty refs; the methodology requirement lives at
    // input normalization and the transition gates, not the stored shape.
    if (task.methodology === null) {
      return;
    }
    // A structurally valid assessment that classifies sdd without formal
    // refs is a gate problem (METHODOLOGY_REQUIRED at ACT), not malformed
    // data: the record must stay readable so `task reassess` can repair
    // it — a TASK_MALFORMED here wedges the record past every verb.
    try {
      classifyWork(task.methodology);
    } catch (e) {
      throw err('TASK_MALFORMED',
        `${label}.methodology: ${e.message}`);
    }
  }
}

// Pure input normalization shared by prepareTask/createTask/preparePlan:
// strict keys, non-empty fields, canonical scope contained in the root,
// methodology refs resolved against live artifacts at prepare time.
export function normalizeTaskInput(ctx, input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw err('INVALID_VALUE', 'task input must be an object');
  }
  for (const key of Object.keys(input)) {
    if (!CREATE_KEYS.has(key)) {
      throw err('UNKNOWN_KEY', `task input received unknown key '${key}'`);
    }
  }
  const title = requireNonEmpty(input.title, 'title');
  const contract = requireNonEmpty(input.contract, 'contract');
  const authorContext = requireNonEmpty(input.authorContext, 'authorContext');
  const scope = input.scope === undefined ? [] : input.scope;
  if (!Array.isArray(scope)) {
    throw err('INVALID_VALUE', 'scope must be an array of relative paths');
  }
  const cleanScope = [...new Set(
    scope.map((s, i) => assertDestination(s, `scope[${i}]`)))];
  for (const s of cleanScope) {
    resolveInside(ctx.projectRoot, s, 'scope');
  }
  const mode = validateMethodologyMode(
    ctx.config.methodology, 'config.methodology');
  const hasRefs = input.specId !== undefined || input.designId !== undefined;
  if (!hasRefs && (input.planKey !== undefined || input.scenarioRefs !== undefined)) {
    throw err('METHODOLOGY_REQUIRED',
      'planKey/scenarioRefs require the specId+designId pair');
  }
  if (hasRefs
      && (!isUUID(input.specId) || !isUUID(input.designId))) {
    throw err('INVALID_ID', 'specId and designId must both be UUIDs');
  }
  // Explicit null without formal refs is a silent-V1 downgrade, not a
  // legal form — the field only means something with the pair.
  if (!hasRefs && input.methodology === null) {
    throw err('METHODOLOGY_REQUIRED',
      'methodology: explicit null requires the specId+designId pair');
  }
  const assessment = input.methodology === undefined
    ? undefined
    : input.methodology === null ? null
      : validateMethodologyData(input.methodology, 'task.methodology');
  const out = { title, contract, authorContext, scope: cleanScope };
  out.v3 = normalizeV3Input(input);
  if (!hasRefs) {
    // Mode gating for non-formal creation.
    if (mode === 'sdd') {
      throw err('METHODOLOGY_REQUIRED',
        'mode sdd requires the specId+designId pair');
    }
    if (mode === 'organic-sdd' && assessment === undefined) {
      throw err('METHODOLOGY_REQUIRED',
        'mode organic-sdd requires an assessment or the formal pair');
    }
    if (assessment) {
      const { route } = classifyWork(assessment);
      if (route === 'sdd') {
        throw err('METHODOLOGY_REQUIRED',
          'classified sdd requires the formal refs pair');
      }
      // light / blocked / read-only draft: stores assessment, no refs.
      out.methodology = assessment;
      out.specId = null; out.designId = null; out.planKey = null;
      out.scenarioRefs = [];
      out.schemaVersion = 2;
    } else if (mode !== 'manual') {
      throw err('METHODOLOGY_REQUIRED',
        'explicit formal refs or a methodology assessment required');
    }
    return out; // V1 manual: no new fields
  }
  // Formal: resolve the pair, verify binding, scope subset, scenarios.
  const spec = getSpecification(ctx, input.specId);
  const design = getArtifact(ctx, 'design', input.designId);
  // UUID refs are case-insensitive: bind on folded ids, not raw spelling.
  if (design.schemaVersion !== 2 || design.data === undefined
      || design.data.specId.toLowerCase() !== spec.id.toLowerCase()
      || design.data.specDigest !== canonicalDigest(spec)) {
    throw err('METHODOLOGY_REQUIRED',
      'design must belong to the referenced spec at its current digest');
  }
  for (const s of cleanScope) {
    const ok = spec.data.scope.some((sp) =>
      isSameOrAncestor(sp, s, { caseSensitive: true }));
    if (!ok) {
      throw err('METHODOLOGY_REQUIRED',
        `scope '${s}' is not contained in spec scope`);
    }
  }
  out.specId = spec.id;
  out.designId = design.id;
  out.planKey = input.planKey === undefined ? null
    : (() => {
      if (typeof input.planKey !== 'string' || !PLAN_KEY_RE.test(input.planKey)) {
        throw err('INVALID_VALUE', 'planKey must be a slug');
      }
      return input.planKey;
    })();
  out.scenarioRefs = normalizeScenarioRefs(spec, input.scenarioRefs);
  out.methodology = assessment === undefined ? null : assessment;
  out.schemaVersion = 2;
  return out;
}

// Optional V3 semantic fields: normalized at input, validated against the
// same enums the stored shape enforces. Any V3 field present upgrades the
// record to schemaVersion 3; absence keeps the record at its natural version.
// Exported for metadata patches (updateTaskMeta): same per-key rules apply.
export function normalizeV3Input(input) {
  const v3 = {};
  const has = (k) => input[k] !== undefined;
  if (has('backlog')) {
    if (input.backlog !== null
        && (typeof input.backlog !== 'string'
          || !BACKLOG_NAME_RE.test(input.backlog))) {
      throw err('INVALID_VALUE', 'backlog must be a backlog-name slug or null');
    }
    v3.backlog = input.backlog;
  }
  const enumField = (k, set, label) => {
    if (!has(k)) return;
    if (input[k] !== null && !set.has(input[k])) {
      throw err('INVALID_VALUE',
        `${label} must be one of ${[...set].join('|')} or null`);
    }
    v3[k] = input[k];
  };
  enumField('priority', TASK_PRIORITIES, 'priority');
  enumField('severity', TASK_SEVERITIES, 'severity');
  enumField('type', TASK_TYPES, 'type');
  enumField('effort', TASK_EFFORTS, 'effort');
  enumField('sideEffects', TASK_SIDE_EFFECTS, 'sideEffects');
  enumField('executionType', TASK_EXECUTION_TYPES, 'executionType');
  if (has('estimate')) {
    v3.estimate = input.estimate === null ? null : (() => {
      const e = input.estimate;
      if (typeof e !== 'object' || Array.isArray(e)
          || (e.turns !== undefined
            && (!Number.isSafeInteger(e.turns) || e.turns < 0))
          || (e.appetite !== undefined && !TASK_EFFORTS.has(e.appetite))) {
        throw err('INVALID_VALUE',
          'estimate must be {turns:int,appetite:<effort>} or null');
      }
      for (const k of Object.keys(e)) {
        if (!['turns', 'appetite'].includes(k)) {
          throw err('UNKNOWN_KEY', `estimate received unknown key '${k}'`);
        }
      }
      return { turns: e.turns, appetite: e.appetite };
    })();
  }
  if (has('source')) {
    if (input.source !== null && typeof input.source !== 'string') {
      throw err('INVALID_VALUE', 'source must be a string or null');
    }
    v3.source = input.source;
  }
  const nonEmptyStr = (k) => {
    if (!has(k)) return;
    if (input[k] !== null
        && (typeof input[k] !== 'string' || input[k].trim() === '')) {
      throw err('INVALID_VALUE', `${k} must be a non-empty string or null`);
    }
    v3[k] = input[k];
  };
  nonEmptyStr('agentRole');
  nonEmptyStr('outputContract');
  nonEmptyStr('reviewRubric');
  if (has('fallback')) {
    v3.fallback = input.fallback === null ? null : (() => {
      const f = input.fallback;
      if (typeof f !== 'object' || Array.isArray(f)
          || !TASK_FALLBACK_ON_FAIL.has(f.onFail)
          || (f.note !== undefined && typeof f.note !== 'string')) {
        throw err('INVALID_VALUE',
          'fallback must be {onFail: stall|abandon|needs-human, note?} or null');
      }
      for (const k of Object.keys(f)) {
        if (!['onFail', 'note'].includes(k)) {
          throw err('UNKNOWN_KEY', `fallback received unknown key '${k}'`);
        }
      }
      const clean = { onFail: f.onFail };
      if (f.note !== undefined) clean.note = f.note;
      return clean;
    })();
  }
  enumField('contextInheritance', TASK_CONTEXT_INHERITANCE,
    'contextInheritance');
  if (has('expectedOutputs')) {
    v3.expectedOutputs = input.expectedOutputs === null ? null : (() => {
      const arr = input.expectedOutputs;
      if (!Array.isArray(arr)) {
        throw err('INVALID_VALUE',
          'expectedOutputs must be an array of output entries or null');
      }
      return arr.map((o, i) => {
        if (o === null || typeof o !== 'object' || Array.isArray(o)) {
          throw err('INVALID_VALUE',
            `expectedOutputs[${i}] must be an object`);
        }
        for (const k of Object.keys(o)) {
          if (!['path', 'mustExist', 'mustBeNonEmpty'].includes(k)) {
            throw err('UNKNOWN_KEY',
              `expectedOutputs[${i}] received unknown key '${k}'`);
          }
        }
        if (typeof o.path !== 'string' || o.path.trim() === '') {
          throw err('INVALID_VALUE',
            `expectedOutputs[${i}].path must be a non-empty string`);
        }
        for (const k of ['mustExist', 'mustBeNonEmpty']) {
          if (o[k] !== undefined && typeof o[k] !== 'boolean') {
            throw err('INVALID_VALUE',
              `expectedOutputs[${i}].${k} must be a boolean`);
          }
        }
        const item = { path: assertDestination(o.path, `expectedOutputs[${i}].path`) };
        if (o.mustExist !== undefined) item.mustExist = o.mustExist;
        if (o.mustBeNonEmpty !== undefined) item.mustBeNonEmpty = o.mustBeNonEmpty;
        return item;
      });
    })();
  }
  if (has('relations')) {
    v3.relations = input.relations === null ? null : (() => {
      const r = input.relations;
      if (typeof r !== 'object' || Array.isArray(r)) {
        throw err('INVALID_VALUE', 'relations must be an object or null');
      }
      const clean = {};
      for (const k of Object.keys(r)) {
        if (!RELATION_KINDS.has(k)) {
          throw err('UNKNOWN_KEY', `relations received unknown kind '${k}'`);
        }
        if (!Array.isArray(r[k])
            || !r[k].every((v) => typeof v === 'string' && v.trim() !== '')) {
          throw err('INVALID_VALUE',
            `relations.${k} must be an array of non-empty strings`);
        }
        clean[k] = r[k];
      }
      return clean;
    })();
  }
  const idArray = (k, label = 'ids') => {
    if (!has(k)) return;
    if (input[k] !== null && (!Array.isArray(input[k])
        || !input[k].every((v) => typeof v === 'string' && v.trim() !== ''))) {
      throw err('INVALID_VALUE', `${k} must be an array of ${label} or null`);
    }
    v3[k] = input[k];
  };
  idArray('dependsOn');
  idArray('goalIds');
  idArray('skills');
  idArray('allowedTools', 'tool names');
  idArray('requiredCapabilities', 'capability names');
  if (has('analysis')) {
    if (input.analysis !== null
        && (typeof input.analysis !== 'object' || Array.isArray(input.analysis))) {
      throw err('INVALID_VALUE', 'analysis must be an object or null');
    }
    if (input.analysis !== null) {
      for (const k of Object.keys(input.analysis)) {
        if (!['blastRadius', 'impact', 'invariants', 'debt', 'debugEvidence',
          'security', 'performance'].includes(k)) {
          throw err('UNKNOWN_KEY', `analysis received unknown key '${k}'`);
        }
      }
    }
    v3.analysis = input.analysis;
  }
  if (has('steps')) {
    if (input.steps !== null && (!Array.isArray(input.steps)
        || !input.steps.every((s) => s !== null && typeof s === 'object'
          && typeof s.name === 'string' && s.name.trim() !== ''
          && (s.status === undefined || STEP_STATUSES.has(s.status))
          && (s.verify === undefined || typeof s.verify === 'string')
          && Object.keys(s).every((k) =>
            ['name', 'status', 'verify', 'files', 'action'].includes(k))))) {
      throw err('INVALID_VALUE',
        'steps must be [{name,status?,verify?,files?,action?}]');
    }
    v3.steps = input.steps === null ? null
      : input.steps.map((s) => ({ status: 'pending', ...s }));
  }
  if (has('notes')) {
    if (input.notes !== null && (!Array.isArray(input.notes)
        || !input.notes.every((n) => typeof n === 'string'))) {
      throw err('INVALID_VALUE', 'notes must be an array of strings or null');
    }
    v3.notes = input.notes;
  }
  if (has('uncertainty')) {
    v3.uncertainty = input.uncertainty === null ? null : (() => {
      const u = input.uncertainty;
      if (typeof u !== 'object' || Array.isArray(u)
          || (u.uphill !== undefined
            && (!Number.isSafeInteger(u.uphill) || u.uphill < 0))
          || (u.downhill !== undefined
            && (!Number.isSafeInteger(u.downhill) || u.downhill < 0))) {
        throw err('INVALID_VALUE',
          'uncertainty must be {uphill:int,downhill:int} or null');
      }
      for (const k of Object.keys(u)) {
        if (!['uphill', 'downhill'].includes(k)) {
          throw err('UNKNOWN_KEY', `uncertainty received unknown key '${k}'`);
        }
      }
      return { uphill: u.uphill ?? 0, downhill: u.downhill ?? 0 };
    })();
  }
  return Object.keys(v3).length ? v3 : null;
}

export const V3_DEFAULTS = {
  backlog: null, disposition: null, priority: null, severity: null,
  type: null, effort: null, estimate: null, source: null, relations: null,
  dependsOn: null, goalIds: null, analysis: null, steps: null, notes: null,
  skills: null, uncertainty: null,
  allowedTools: null, requiredCapabilities: null, agentRole: null,
  expectedOutputs: null, sideEffects: null, executionType: null,
  outputContract: null, reviewRubric: null, fallback: null,
  contextInheritance: null,
};

// Pure task record factory: no I/O, no side effects. V2 records carry the
// normalized methodology bundle; V1 stays byte-identical to before.
export function buildTaskRecord(input, { id, at, initial, slug }) {
  const base = {
    schemaVersion: 1,
    id,
    title: input.title,
    slug: slug ?? null,
    contract: input.contract,
    authorContext: input.authorContext,
    scope: input.scope,
    state: initial,
    revision: 0,
    verification: null,
    review: null,
    createdAt: at,
    updatedAt: at,
    history: [{ at, event: 'created', state: initial, revision: 0 }],
  };
  const v3 = input.v3;
  if (input.schemaVersion === 2 || input.schemaVersion === 3) {
    return {
      ...base,
      schemaVersion: v3 ? 3 : input.schemaVersion,
      methodology: input.methodology,
      specId: input.specId,
      designId: input.designId,
      planKey: input.planKey,
      scenarioRefs: input.scenarioRefs,
      ...(v3 ? { ...V3_DEFAULTS, ...v3 } : {}),
    };
  }
  if (v3) {
    // V1 manual records cannot carry methodology, but V3 semantic fields
    // are orthogonal: upgrade to V3 and store the methodology keys as null
    // so the stored shape stays canonical.
    return {
      ...base,
      schemaVersion: 3,
      methodology: null,
      specId: null,
      designId: null,
      planKey: null,
      scenarioRefs: [],
      ...V3_DEFAULTS,
      ...v3,
    };
  }
  return base;
}

// Read-only prospective creation: returns the record and its file plan
// without writing. Shared factory with createTask.
export function prepareTask(ctx, input) {
  const clean = normalizeTaskInput(ctx, input);
  const policy = loadPolicy();
  const id = crypto.randomUUID();
  const at = nowIso();
  const task = buildTaskRecord(clean, {
    id, at, initial: policy.initial, slug: nextTaskSlug(ctx, clean.title),
  });
  validateTaskShape(task, `prepared task`);
  const content = JSON.stringify(task, null, 2) + '\n';
  if (Buffer.byteLength(content, 'utf8') > loadLimits().maxDocumentBytes) {
    throw err('DOCUMENT_TOO_LARGE',
      `task record exceeds ${loadLimits().maxDocumentBytes} bytes`);
  }
  const rel = `${ctx.config.paths.tasks}/${id.toLowerCase()}.json`;
  const abs = resolveInside(ctx.projectRoot, rel, 'task file');
  return { task, file: { rel, abs, content } };
}

export function createTask(ctx, input) {
  const { task, file } = prepareTask(ctx, input);
  mkdirpSync(path.dirname(file.abs));
  try {
    writeFileExclusive(file.abs, file.content); // own-file cleanup on fail
  } catch (e) {
    if (e && e.code === 'EEXIST') {
      throw err('TASK_CONFLICT', `task id collision: ${task.id}`);
    }
    throw e;
  }
  return task;
}
