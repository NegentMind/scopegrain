// SPDX-License-Identifier: Apache-2.0
// Retroactive activity registration: actions performed outside the task
// lifecycle (a direct commit, an ad-hoc edit, a manual fix) get recorded
// as an activity-log entry — bookkeeping evidence, NEVER an actionable
// task. The workflow policy has no legal path for a retroactive record
// (ACCEPT requires verification+review it cannot honestly produce), so
// the post-commit hook must not create tasks that pollute PLAN forever.
// Shapes:
//   - taskId given or an active task pointer exists: the entry LINKS to
//     that task (evidence attributed to real work).
//   - otherwise: entry with taskId:null — evidence without a work item.
//   - input.record === 'task': explicit opt-in keeps the legacy shape —
//     an ops task in PLAN plus the entry (for manual `activity record`
//     where the caller wants an actionable record).
import { err } from './errors.mjs';
import { createTask, getTask } from './tasks.mjs';
import { appendWorklog } from './worklog.mjs';
import { validateMethodologyMode } from './config.mjs';
import { getActiveTask } from './active.mjs';

const KINDS = new Set(['action', 'commit', 'note']);
const MAX_TITLE = 4096;
const MAX_FILES = 500;
const MAX_TEXT = 16384;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function reqText(v, label, max) {
  if (typeof v !== 'string' || v.trim() === '') {
    throw err('INVALID_VALUE', `${label} must be a non-empty string`);
  }
  if (Buffer.byteLength(v, 'utf8') > max) {
    throw err('INVALID_VALUE', `${label} exceeds ${max} bytes`);
  }
  return v;
}

export function normalizeActivityInput(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw err('INVALID_VALUE', 'activity input must be an object');
  }
  const allowed = new Set(['kind', 'title', 'summary', 'ref', 'files',
    'taskId', 'author', 'methodology', 'record']);
  for (const k of Object.keys(input)) {
    if (!allowed.has(k)) {
      throw err('UNKNOWN_KEY', `activity input received unknown key '${k}'`);
    }
  }
  const kind = input.kind ?? 'action';
  if (!KINDS.has(kind)) {
    throw err('INVALID_VALUE',
      `kind must be one of: ${[...KINDS].join(', ')}`);
  }
  const out = {
    kind,
    title: reqText(input.title, 'title', MAX_TITLE),
    summary: input.summary === undefined ? null
      : reqText(input.summary, 'summary', MAX_TEXT),
    ref: input.ref === undefined ? null : reqText(input.ref, 'ref', MAX_TEXT),
    author: input.author === undefined ? null
      : reqText(input.author, 'author', 512),
    files: [],
    taskId: input.taskId === undefined ? null : input.taskId,
    methodology: input.methodology,
    record: input.record,
  };
  if (out.record !== undefined && out.record !== 'task') {
    throw err('INVALID_VALUE', "record must be 'task' when present");
  }
  if (out.taskId !== null
      && (typeof out.taskId !== 'string' || !UUID_RE.test(out.taskId))) {
    throw err('INVALID_ID', 'taskId must be a UUID');
  }
  if (input.files !== undefined) {
    if (!Array.isArray(input.files)
        || input.files.length > MAX_FILES
        || !input.files.every((f) => typeof f === 'string' && f !== '')) {
      throw err('INVALID_VALUE',
        `files must be an array of up to ${MAX_FILES} strings`);
    }
    out.files = input.files;
  }
  return out;
}

// A truthful attestation authored by the registrant: the action already
// happened outside the loop; the registrant declares it was authorized,
// naming the actor and the observable reference (commit sha, session id).
function declaredAssessment(activity) {
  return {
    schemaVersion: 1,
    request: `retroactive registration: ${activity.title.slice(0, 200)}`,
    intent: 'change',
    authorization: {
      status: 'authorized',
      actor: activity.author ?? 'activity-record',
      reference: activity.ref ?? 'no external reference',
    },
    understanding: 'sufficient',
    uncertainty: 'resolved',
    risk: 'contained',
    riskCategories: [],
    continuity: 'diff-sufficient',
    evidence: [`auto-registered ${activity.kind}`],
  };
}

export function recordActivity(ctx, rawInput) {
  const input = normalizeActivityInput(rawInput);
  const progress = {
    kind: input.kind,
    ref: input.ref,
    title: input.title,
    summary: input.summary,
    domain: `activity:${input.kind}`,
    files: input.files.length ? input.files : undefined,
    author: input.author ?? undefined,
  };

  if (input.taskId !== null) {
    const task = getTask(ctx, input.taskId); // throws TASK_NOT_FOUND
    const entry = appendWorklog(ctx, 'activity', {
      ...progress, taskId: task.id, linked: true,
    });
    return { taskId: task.id, created: false, activity: entry };
  }

  // No explicit taskId: link to the active-task pointer when one
  // resolves — the commit then lands as evidence on the real work item.
  // A missing or unreadable pointer never blocks the write: evidence
  // beats linkage.
  let linkWarning = null;
  if (input.record !== 'task') {
    try {
      const active = getActiveTask(ctx);
      if (active.task) {
        const entry = appendWorklog(ctx, 'activity', {
          ...progress, taskId: active.task.id, linked: true,
        });
        return { taskId: active.task.id, created: false,
          activity: entry, linkedVia: active.source };
      }
    } catch (e) {
      linkWarning = `active-task pointer unreadable: ${e.code}`;
    }
    const entry = appendWorklog(ctx, 'activity', {
      ...progress, taskId: null, linked: false,
    });
    return { taskId: null, created: false, activity: entry,
      ...(linkWarning ? { linkWarning } : {}) };
  }

  const mode = validateMethodologyMode(
    ctx.config.methodology, 'config.methodology');
  const gated = mode !== 'manual';
  const methodology = input.methodology !== undefined
    ? input.methodology
    : gated ? declaredAssessment(input) : undefined;

  const notes = [input.summary ?? `auto-registered ${input.kind}`];
  if (input.ref) notes.push(`ref: ${input.ref}`);

  const task = createTask(ctx, {
    title: input.title,
    contract: input.summary ?? `auto-registered ${input.kind}: ${input.title}`,
    authorContext: input.author ?? 'activity-record',
    scope: input.files,
    methodology,
    type: 'ops',
    source: `activity:${input.kind}`,
    notes,
  });
  const entry = appendWorklog(ctx, 'activity', {
    ...progress, taskId: task.id, linked: false,
  });
  return { taskId: task.id, created: true, task, activity: entry };
}
