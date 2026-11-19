// Operational memory: bounded JSONL stores under paths.memory.
// Lessons, skill outcomes, progress archive and goals reproduce the
// legacy lessons.md / skill-outcomes.json / avance / strategy loops as
// machine-readable, journal-friendly append logs. Metrics are derived
// on read from the task store — nothing is precomputed on write.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { err } from './errors.mjs';
import { decodeUtf8Strict, lstatOrNull, mkdirpSync, readFileLimited }
  from './fsx.mjs';
import { resolveInside } from './paths.mjs';
import { loadLimits } from './policy.mjs';
import { listTasks } from './tasks.mjs';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUUID = (v) => typeof v === 'string' && UUID_RE.test(v);

const LOG_NAMES = new Set(['lessons', 'outcomes', 'progress', 'goals']);
const MAX_LINE_BYTES = 16 * 1024;
const MAX_TAIL = 1000;
const GOAL_STATUSES = new Set(['open', 'achieved', 'dropped']);

function memoryDirAbs(ctx) {
  return resolveInside(ctx.projectRoot, ctx.config.paths.memory, 'paths.memory');
}

function logPath(ctx, name) {
  if (!LOG_NAMES.has(name)) {
    throw err('INVALID_ARGS', `unknown memory log '${String(name)}'`);
  }
  return path.join(memoryDirAbs(ctx), `${name}.jsonl`);
}

function validateEntryFields(entry, allowed, label) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    throw err('INVALID_VALUE', `${label} must be an object`);
  }
  for (const k of Object.keys(entry)) {
    if (!allowed.has(k)) {
      throw err('UNKNOWN_KEY', `${label} received unknown key '${k}'`);
    }
  }
}

export function appendWorklog(ctx, name, fields) {
  let entry;
  if (name === 'lessons') {
    validateEntryFields(fields,
      new Set(['topic', 'text', 'ref', 'taskId']), 'lesson');
    if (typeof fields.text !== 'string' || fields.text.trim() === '') {
      throw err('INVALID_VALUE', 'lesson.text must be a non-empty string');
    }
    entry = {
      topic: fields.topic ?? null,
      text: fields.text,
      ref: fields.ref ?? null,
      taskId: fields.taskId === undefined ? null : fields.taskId,
    };
  } else if (name === 'outcomes') {
    validateEntryFields(fields,
      new Set(['taskId', 'outcome', 'skills']), 'outcome');
    if (!isUUID(fields.taskId)) {
      throw err('INVALID_ID', 'outcome.taskId must be a task UUID');
    }
    if (!['ok', 'fail'].includes(fields.outcome)) {
      throw err('INVALID_VALUE', "outcome.outcome must be 'ok' or 'fail'");
    }
    if (!Array.isArray(fields.skills)
        || !fields.skills.every((s) => typeof s === 'string' && s.trim())) {
      throw err('INVALID_VALUE', 'outcome.skills must be an array of strings');
    }
    entry = { taskId: fields.taskId, outcome: fields.outcome, skills: fields.skills };
  } else if (name === 'progress') {
    validateEntryFields(fields,
      new Set(['taskId', 'title', 'result', 'summary', 'domain', 'ref']),
      'progress');
    if (!isUUID(fields.taskId)) {
      throw err('INVALID_ID', 'progress.taskId must be a task UUID');
    }
    if (typeof fields.title !== 'string' || fields.title.trim() === '') {
      throw err('INVALID_VALUE', 'progress.title must be a non-empty string');
    }
    entry = {
      taskId: fields.taskId,
      title: fields.title,
      result: fields.result ?? null,
      summary: fields.summary ?? null,
      domain: fields.domain ?? null,
      ref: fields.ref ?? null,
    };
  } else if (name === 'goals') {
    validateEntryFields(fields,
      new Set(['id', 'title', 'description', 'status', 'horizon', 'metrics']),
      'goal');
    if (!isUUID(fields.id)) {
      throw err('INVALID_ID', 'goal.id must be a UUID');
    }
    if (typeof fields.title !== 'string' || fields.title.trim() === '') {
      throw err('INVALID_VALUE', 'goal.title must be a non-empty string');
    }
    if (fields.status !== undefined && !GOAL_STATUSES.has(fields.status)) {
      throw err('INVALID_VALUE', 'goal.status must be open|achieved|dropped');
    }
    entry = {
      id: fields.id,
      title: fields.title,
      description: fields.description ?? null,
      status: fields.status ?? 'open',
      horizon: fields.horizon ?? null,
      metrics: fields.metrics ?? null,
    };
  }
  const record = { at: new Date().toISOString(), ...entry };
  const line = JSON.stringify(record) + '\n';
  if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) {
    throw err('INVALID_VALUE', `${name} entry exceeds ${MAX_LINE_BYTES} bytes`);
  }
  const file = logPath(ctx, name);
  mkdirpSync(path.dirname(file));
  fs.appendFileSync(file, line, 'utf8');
  return record;
}

export function readWorklog(ctx, name, { tail = 50 } = {}) {
  const file = logPath(ctx, name);
  const st = lstatOrNull(file);
  const out = { entries: [], malformed: [] };
  if (!st) return out;
  if (st.isSymbolicLink() || !st.isFile()) {
    throw err('INVALID_PATH', `${name} log is not a real file`);
  }
  const limited = readFileLimited(file, loadLimits().maxDocumentBytes);
  if (limited.exceeded) {
    throw err('DOCUMENT_TOO_LARGE', `${name} log exceeds document limit`);
  }
  const text = decodeUtf8Strict(limited.content, `${name} log`);
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  const take = Math.min(Math.max(0, tail), MAX_TAIL);
  const slice = take === 0 ? [] : lines.slice(-take);
  for (const l of slice) {
    try {
      out.entries.push(JSON.parse(l));
    } catch {
      out.malformed.push({ line: l.slice(0, 120) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Goals — the meta/objective layer tasks link to via task.goalIds.
// Implemented over the goals.jsonl log: latest entry per id wins.
// ---------------------------------------------------------------------------

export function listGoals(ctx) {
  const { entries, malformed } = readWorklog(ctx, 'goals', { tail: MAX_TAIL });
  const byId = new Map();
  for (const e of entries) {
    if (e && isUUID(e.id)) byId.set(e.id.toLowerCase(), e);
  }
  return { goals: [...byId.values()], malformed };
}

export function createGoal(ctx, input) {
  validateEntryFields(input,
    new Set(['title', 'description', 'horizon', 'metrics']), 'goal input');
  if (typeof input.title !== 'string' || input.title.trim() === '') {
    throw err('INVALID_VALUE', 'goal.title must be a non-empty string');
  }
  const record = appendWorklog(ctx, 'goals', {
    id: crypto.randomUUID(),
    title: input.title,
    description: input.description ?? null,
    horizon: input.horizon ?? null,
    metrics: input.metrics ?? null,
  });
  return record;
}

// Status change for an existing goal: the log is append-only, so a
// transition re-appends the current entry with the new status (latest
// entry per id wins on read).
export function transitionGoal(ctx, id, status) {
  if (!isUUID(id)) {
    throw err('INVALID_ID', 'goal id must be a UUID');
  }
  if (!GOAL_STATUSES.has(status)) {
    throw err('INVALID_VALUE', 'goal status must be open|achieved|dropped');
  }
  const { goals } = listGoals(ctx);
  const current = goals.find((g) => g.id.toLowerCase() === id.toLowerCase());
  if (!current) {
    throw err('INVALID_ID', `goal ${id} not found`);
  }
  return appendWorklog(ctx, 'goals', {
    id: current.id,
    title: current.title,
    description: current.description,
    status,
    horizon: current.horizon,
    metrics: current.metrics,
  });
}

// ---------------------------------------------------------------------------
// Metrics — derived aggregates, the tracer/eval-summary equivalent.
// ---------------------------------------------------------------------------

export function taskMetrics(ctx) {
  const { tasks, malformed } = listTasks(ctx);
  const byState = {};
  const byBacklog = {};
  const byType = {};
  const byPriority = {};
  const byDisposition = { active: 0, deferred: 0, icebox: 0, future: 0, discarded: 0, cancelled: 0 };
  const durations = [];
  let verifyPass = 0;
  let verifyTotal = 0;
  let firstTryPass = 0;
  let firstTryTotal = 0;
  for (const t of tasks) {
    byState[t.state] = (byState[t.state] ?? 0) + 1;
    const backlog = t.backlog ?? 'default';
    byBacklog[backlog] = (byBacklog[backlog] ?? 0) + 1;
    if (t.type) byType[t.type] = (byType[t.type] ?? 0) + 1;
    if (t.priority) byPriority[t.priority] = (byPriority[t.priority] ?? 0) + 1;
    byDisposition[t.disposition?.kind ?? 'active'] += 1;
    if (t.state === 'CLOSE') {
      const span = Date.parse(t.updatedAt) - Date.parse(t.createdAt);
      if (Number.isFinite(span) && span >= 0) durations.push(span);
    }
    const checks = t.verification?.checks;
    if (Array.isArray(checks) && checks.length) {
      verifyTotal += checks.length;
      verifyPass += checks.filter((c) => c.status === 'pass').length;
      firstTryTotal += 1;
      if (checks[0].status === 'pass') firstTryPass += 1;
    }
  }
  durations.sort((a, b) => a - b);
  const pct = (p) => durations.length
    ? durations[Math.min(durations.length - 1, Math.floor(durations.length * p))]
    : null;
  const { entries: outcomeEntries } = readWorklog(ctx, 'outcomes', { tail: MAX_TAIL });
  const skillRates = {};
  for (const e of outcomeEntries) {
    for (const s of e.skills ?? []) {
      const agg = skillRates[s] ?? (skillRates[s] = { ok: 0, fail: 0 });
      agg[e.outcome === 'ok' ? 'ok' : 'fail'] += 1;
    }
  }
  return {
    schemaVersion: 1,
    tasks: {
      total: tasks.length,
      byState,
      byBacklog,
      byType,
      byPriority,
      byDisposition,
    },
    verification: {
      checksTotal: verifyTotal,
      checksPassed: verifyPass,
      passRate: verifyTotal ? verifyPass / verifyTotal : null,
      firstTryTotal,
      firstTryPass,
      firstTryRate: firstTryTotal ? firstTryPass / firstTryTotal : null,
    },
    durationMs: { count: durations.length, p50: pct(0.5), p95: pct(0.95), p99: pct(0.99) },
    skillOutcomes: skillRates,
    malformed,
  };
}
