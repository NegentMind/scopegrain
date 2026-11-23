// SPDX-License-Identifier: Apache-2.0
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

const LOG_NAMES = new Set(['lessons', 'outcomes', 'progress', 'goals',
  'activity']);
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
      new Set(['taskId', 'title', 'result', 'summary', 'domain', 'ref',
        'kind', 'files', 'author', 'linked']),
      'progress');
    if (!isUUID(fields.taskId)) {
      throw err('INVALID_ID', 'progress.taskId must be a task UUID');
    }
    if (typeof fields.title !== 'string' || fields.title.trim() === '') {
      throw err('INVALID_VALUE', 'progress.title must be a non-empty string');
    }
    if (fields.files !== undefined
        && (!Array.isArray(fields.files)
          || !fields.files.every((f) => typeof f === 'string' && f !== ''))) {
      throw err('INVALID_VALUE', 'progress.files must be strings');
    }
    entry = {
      taskId: fields.taskId,
      title: fields.title,
      result: fields.result ?? null,
      summary: fields.summary ?? null,
      domain: fields.domain ?? null,
      ref: fields.ref ?? null,
      kind: fields.kind ?? null,
      files: fields.files ?? null,
      author: fields.author ?? null,
      linked: fields.linked ?? null,
    };
  } else if (name === 'activity') {
    // Retroactive activity evidence — a commit, an ad-hoc action — that
    // is bookkeeping, NOT a work item. taskId is nullable: unlinkable
    // activity is still recorded (evidence beats linkage), never forced
    // through task lifecycle gates it cannot honestly satisfy.
    validateEntryFields(fields,
      new Set(['taskId', 'title', 'summary', 'domain', 'ref',
        'kind', 'files', 'author', 'linked']),
      'activity');
    if (fields.taskId !== undefined && fields.taskId !== null
        && !isUUID(fields.taskId)) {
      throw err('INVALID_ID',
        'activity.taskId must be a task UUID or null');
    }
    if (typeof fields.title !== 'string' || fields.title.trim() === '') {
      throw err('INVALID_VALUE', 'activity.title must be a non-empty string');
    }
    if (fields.files !== undefined
        && (!Array.isArray(fields.files)
          || !fields.files.every((f) => typeof f === 'string' && f !== ''))) {
      throw err('INVALID_VALUE', 'activity.files must be strings');
    }
    entry = {
      taskId: fields.taskId ?? null,
      title: fields.title,
      summary: fields.summary ?? null,
      domain: fields.domain ?? null,
      ref: fields.ref ?? null,
      kind: fields.kind ?? null,
      files: fields.files ?? null,
      author: fields.author ?? null,
      linked: fields.linked ?? null,
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
  rotateIfOversized(ctx, file, name);
  fs.appendFileSync(file, line, 'utf8');
  return record;
}

// The active segment is rotated, whole and immutable, into
// <memory>/archive/ once it exceeds the document cap, so one log file
// never grows without bound. Archived segments are evidence and are
// never deleted; the bounded tail reader covers whatever the active
// segment still holds. Rotation is best-effort: another process holding
// the file open (Windows rename semantics) defers it rather than
// failing the append.
function rotateIfOversized(ctx, file, name) {
  const st = lstatOrNull(file);
  if (!st || !st.isFile() || st.size <= loadLimits().maxDocumentBytes) return;
  const archiveDir = path.join(memoryDirAbs(ctx), 'archive');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(archiveDir,
    `${name}-${stamp}-${crypto.randomBytes(3).toString('hex')}.jsonl`);
  try {
    mkdirpSync(archiveDir);
    fs.renameSync(file, dest);
  } catch { /* deferred — the append below still succeeds */ }
}

// Append-only logs outgrow the document cap eventually; session start
// must never break on them. Oversized logs are read from the tail: the
// newest bounded window is what callers consume anyway.
function readTailWindow(file, capBytes, label) {
  const fd = fs.openSync(file, 'r');
  try {
    const st = fs.fstatSync(fd);
    const size = Number(st.size);
    const take = Math.min(size, capBytes);
    const buf = Buffer.alloc(take);
    let off = 0;
    while (off < take) {
      const n = fs.readSync(fd, buf, off, take - off, size - take + off);
      if (n <= 0) break;
      off += n;
    }
    let start = 0;
    if (size > take) {
      // Drop the leading partial line at the BYTE level — its head lives
      // before the window and may cut a multi-byte UTF-8 sequence.
      const nl = buf.indexOf(0x0a);
      start = nl === -1 ? off : nl + 1;
    }
    return decodeUtf8Strict(buf.subarray(start, off), label);
  } finally {
    fs.closeSync(fd);
  }
}

export function readWorklog(ctx, name, { tail = 50 } = {}) {
  const file = logPath(ctx, name);
  const st = lstatOrNull(file);
  const out = { entries: [], malformed: [], truncated: false };
  if (!st) return out;
  if (st.isSymbolicLink() || !st.isFile()) {
    throw err('INVALID_PATH', `${name} log is not a real file`);
  }
  const take = Math.min(Math.max(0, tail), MAX_TAIL);
  if (take === 0) return out; // nothing is parsed — skip the read entirely
  const cap = loadLimits().maxDocumentBytes;
  // Bounded read: only the newest `take` lines are parsed and appendWorklog
  // caps each line at MAX_LINE_BYTES, so take*(MAX_LINE_BYTES+1) bytes of
  // tail provably cover them. `truncated` now means "the read window did
  // not cover the whole file" — true both for over-cap logs and for
  // smaller logs served from a bounded window. A foreign-written log with
  // lines longer than MAX_LINE_BYTES may surface fewer than `take`
  // entries, same degradation class as the over-cap path.
  const window = Math.min(cap, take * (MAX_LINE_BYTES + 1));
  let text;
  if (Number(st.size) > window) {
    text = readTailWindow(file, window, `${name} log`);
    out.truncated = true;
  } else {
    // size <= window <= cap: a full bounded read, never exceeded.
    const limited = readFileLimited(file, cap);
    text = decodeUtf8Strict(limited.content, `${name} log`);
  }
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  const slice = lines.slice(-take);
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
