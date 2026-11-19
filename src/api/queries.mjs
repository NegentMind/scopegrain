// Read-only query facade for the local JSON API. Wraps the core getters and
// store locations with hard response bounds: capped directory listings,
// per-item error surfacing and string-field truncation. No writes, no
// dynamic filesystem access outside the configured Scopegrain stores.
import fs from 'node:fs';
import { err, toErrorPayload } from '../core/errors.mjs';
import {
  decodeUtf8Strict, lstatOrNull, readDirBounded, readFileLimited,
} from '../core/fsx.mjs';
import { loadLimits } from '../core/policy.mjs';
import {
  listGoals, readWorklog, taskMetrics,
} from '../core/worklog.mjs';
import { resolveInside } from '../core/paths.mjs';
import { getTask, listTasks } from '../core/tasks.mjs';
import { getPlan, listPlans, nextPlanTasks } from '../core/plans.mjs';
import { artifactDirRel, getArtifact, listArtifacts } from '../core/artifacts.mjs';
import { getJournalOperation } from '../core/journal.mjs';
import { bindWorkspace, getWorkspace } from '../core/workspaces.mjs';
import { createCaptureStore } from '../core/captures.mjs';
import { classifyWork } from '../core/methodology-data.mjs';
import { getSession, sessionsDirAbs } from '../core/sessions.mjs';
import { getApproval } from '../core/approvals.mjs';
import { loadWorkspaceCatalog } from '../core/catalog.mjs';
import { listVerifyCommands } from '../core/verify-commands.mjs';
import { loadPolicy } from '../core/policy.mjs';
import { vantaDBStatus } from '../integrations/vantadb-runtime.mjs';

export const ARTIFACT_KINDS = Object.freeze(
  ['spec', 'design', 'report', 'research', 'decision', 'lesson',
    'handoff', 'review']);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Hard response bounds. LIST_LIMIT is the maximum items any endpoint
// returns per request; the directory scan ceiling is one page higher so a
// truncated flag can be reported honestly.
export const LIMITS = Object.freeze({
  defaultListLimit: 200,
  maxListLimit: 500,
  dirScanCap: 501,
  maxBodyChars: 16384,
  maxSummaryChars: 4096,
  maxFieldChars: 2048,
});

const TRUNCATED_MARKER = '\n[truncated by api]';

const MEMORY_LOGS = new Set(['lessons', 'outcomes', 'progress', 'goals']);
const REPORT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,120}-status\.json$/;

function boundedInt(raw, fallback, { min, max, label }) {
  if (raw === null) return fallback;
  if (!/^\d+$/.test(raw)) {
    throw err('INVALID_QUERY', `${label} must be a non-negative integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw err('INVALID_QUERY', `${label} must be an integer ${min}..${max}`);
  }
  return value;
}

export function parseListOptions(url) {
  return {
    limit: boundedInt(url.searchParams.get('limit'), LIMITS.defaultListLimit,
      { min: 1, max: LIMITS.maxListLimit, label: 'limit' }),
    offset: boundedInt(url.searchParams.get('offset'), 0,
      { min: 0, max: Number.MAX_SAFE_INTEGER - 1, label: 'offset' }),
  };
}

export function requireUuid(value, label) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw err('INVALID_ID', `${label} must be a UUID, got: ${String(value)}`);
  }
  return value.toLowerCase();
}

function truncateString(value, max, label) {
  if (typeof value !== 'string' || value.length <= max) {
    return { value, truncated: false };
  }
  return {
    value: `${value.slice(0, max)}${TRUNCATED_MARKER}`,
    truncated: true,
  };
}

// Lists `<dirAbs>` JSON documents boundedly, reading each through `read`.
// Mirrors listTasks/listArtifacts semantics: malformed entries surface,
// non-UUID stems are malformed, symlinks/non-files are skipped.
function listStoreDir(dirAbs, read, limit, offset, idPattern = UUID_RE) {
  const out = { items: [], malformed: [], truncated: false };
  const st = lstatOrNull(dirAbs);
  if (!st) return out;
  if (st.isSymbolicLink() || !st.isDirectory()) {
    throw err('INVALID_PATH', `store path is not a real directory`);
  }
  const scanned = readDirBounded(dirAbs, LIMITS.dirScanCap);
  out.truncated = scanned.truncated;
  const names = scanned.entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort();
  if (names.length === 0) return out;
  let collected = 0;
  for (const name of names) {
    const stem = name.slice(0, -'.json'.length);
    if (!idPattern.test(stem)) {
      out.malformed.push({
        file: name,
        error: { code: 'MALFORMED_NAME', message: 'filename is not a valid id' },
      });
      continue;
    }
    let item;
    try {
      item = read(stem);
    } catch (e) {
      out.malformed.push({
        file: name,
        error: toErrorPayload(e),
      });
      continue;
    }
    if (collected >= offset && out.items.length < limit) {
      out.items.push(item);
    }
    collected += 1;
  }
  if (offset + out.items.length < collected) out.truncated = true;
  return out;
}

// Same bounded contract for directories of UUID-named entries (journal
// operations are folders, not files).
function listUuidDirs(dirAbs, read, limit, offset) {
  const out = { items: [], malformed: [], truncated: false };
  const st = lstatOrNull(dirAbs);
  if (!st) return out;
  if (st.isSymbolicLink() || !st.isDirectory()) {
    throw err('INVALID_PATH', 'store path is not a real directory');
  }
  const scanned = readDirBounded(dirAbs, LIMITS.dirScanCap);
  out.truncated = scanned.truncated;
  const names = scanned.entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();
  let collected = 0;
  for (const name of names) {
    if (!UUID_RE.test(name)) {
      out.malformed.push({
        file: `${name}/`,
        error: { code: 'MALFORMED_NAME', message: 'dirname is not a UUID' },
      });
      continue;
    }
    let item;
    try {
      item = read(name);
    } catch (e) {
      out.malformed.push({ file: `${name}/`, error: toErrorPayload(e) });
      continue;
    }
    if (collected >= offset && out.items.length < limit) {
      out.items.push(item);
    }
    collected += 1;
  }
  if (offset + out.items.length < collected) out.truncated = true;
  return out;
}

// V2 formal refs mean the SDD route; a stored assessment classifies on the
// fly (pure function); V1 manual tasks carry no route signal.
function taskRoute(task) {
  if (task.schemaVersion !== 2) return null;
  if (task.specId !== null && task.designId !== null) return 'sdd';
  if (task.methodology === null || task.methodology === undefined) return null;
  try {
    return classifyWork(task.methodology).route;
  } catch {
    return null;
  }
}

function taskSummary(task) {
  const title = truncateString(task.title, LIMITS.maxFieldChars);
  return {
    id: task.id,
    schemaVersion: task.schemaVersion,
    title: title.value,
    titleTruncated: title.truncated,
    state: task.state,
    revision: task.revision,
    scopeCount: task.scope.length,
    methodologyRoute: taskRoute(task),
    specId: task.specId ?? null,
    designId: task.designId ?? null,
    planKey: task.planKey ?? null,
    scenarioRefCount: Array.isArray(task.scenarioRefs)
      ? task.scenarioRefs.length : 0,
    verificationStatus: task.verification?.status ?? null,
    reviewVerdict: task.review?.verdict ?? null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    // V3 semantic layer (null/absent on V1/V2 records).
    backlog: task.backlog ?? null,
    disposition: task.disposition ?? null,
    priority: task.priority ?? null,
    type: task.type ?? null,
    effort: task.effort ?? null,
    source: task.source ?? null,
    dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn : [],
    relations: task.relations ?? {},
    goalIds: Array.isArray(task.goalIds) ? task.goalIds : [],
    stepsTotal: Array.isArray(task.steps) ? task.steps.length : 0,
    stepsDone: Array.isArray(task.steps)
      ? task.steps.filter((s) => s.status === 'done').length : 0,
    uncertainty: task.uncertainty ?? null,
  };
}

function taskDetail(task) {
  const contract = truncateString(task.contract, LIMITS.maxFieldChars);
  const author = truncateString(task.authorContext, LIMITS.maxFieldChars);
  return {
    ...task,
    contract: contract.value,
    contractTruncated: contract.truncated,
    authorContext: author.value,
    authorContextTruncated: author.truncated,
  };
}

function artifactSummary(a) {
  const body = truncateString(a.body, LIMITS.maxBodyChars);
  return {
    id: a.id,
    kind: a.kind,
    schemaVersion: a.schemaVersion,
    title: a.title,
    body: body.value,
    bodyTruncated: body.truncated,
    references: a.references,
    createdAt: a.createdAt,
    data: a.data === undefined ? null : a.data,
  };
}

function operationSummary(loaded, operationId) {
  const events = loaded.intent.events;
  return {
    operationId,
    state: loaded.state,
    intentDigest: loaded.intentDigest,
    createdAt: loaded.intent.createdAt,
    eventCount: events.length,
    sourceKinds: [...new Set(events.map((e) => e.sourceKind))],
    recordIds: events.map((e) => `${e.sourceKind}/${e.recordId}`),
    hasRecovery: loaded.recovery !== null,
  };
}

function captureStatus(e) {
  switch (e && e.code) {
    case 'CAPTURE_SOURCE_CHANGED': return 'drifted';
    case 'CAPTURE_NOT_COMMITTED': return 'unconfirmed';
    case 'CAPTURE_NOT_FOUND': return 'unproved';
    case 'CAPTURE_MALFORMED': return 'malformed';
    default: return 'error';
  }
}

// The API facade holds one resolved context and, when the project is
// enrolled, one all-areas binding - the same grants the local CLI uses.
export function createApiQueries(ctx) {
  const workspaceOrNull = () => {
    try {
      return getWorkspace(ctx);
    } catch (e) {
      if (e && e.code === 'WORKSPACE_NOT_FOUND') return null;
      throw e;
    }
  };

  // Lazily built shared handles: the all-areas binding and a capture store
  // scoped to every enrolled area (mirrors cli.mjs).
  let bound = null;
  let captureStore = null;
  const boundOrThrow = () => {
    if (!bound) {
      const workspace = getWorkspace(ctx); // throws WORKSPACE_NOT_FOUND
      bound = bindWorkspace(ctx, {
        areaIds: workspace.areas.map((area) => area.id),
      });
    }
    return bound;
  };
  const capturesOrThrow = () => {
    if (!captureStore) {
      const workspace = getWorkspace(ctx);
      captureStore = createCaptureStore(ctx, {
        areaIds: workspace.areas.map((area) => area.id),
        origin: 'api-viewer',
      });
    }
    return captureStore;
  };

  const stateDirRel = (rel) =>
    `${ctx.config.paths.state}/${rel}`;

  const journalOpsDirAbs = () =>
    resolveInside(ctx.projectRoot,
      stateDirRel('journal/operations'), 'journal operations');

  const capturesDirAbs = () =>
    resolveInside(ctx.projectRoot,
      `${ctx.config.paths.memory}/captures`, 'captures');

  function health() {
    return {
      status: 'ok',
      api: 'scopegrain-viewer',
      schemaVersion: 1,
      serverTime: new Date().toISOString(),
    };
  }

  function workspace() {
    const ws = workspaceOrNull();
    const { tasks, malformed: malformedTasks } = listTasks(ctx);
    const { plans } = listPlans(ctx);
    const byState = {};
    for (const t of tasks) byState[t.state] = (byState[t.state] ?? 0) + 1;
    const artifacts = {};
    for (const kind of ARTIFACT_KINDS) {
      try {
        artifacts[kind] = listArtifacts(ctx, kind).artifacts.length;
      } catch {
        artifacts[kind] = null;
      }
    }
    let captureCount = null;
    let operationCount = null;
    if (ws) {
      try {
        const scanned = readDirBounded(capturesDirAbs(), LIMITS.dirScanCap);
        captureCount = scanned.entries.filter(
          (e) => e.isFile() && e.name.endsWith('.json')).length;
        if (scanned.truncated) captureCount = `${captureCount}+`;
      } catch { captureCount = null; }
      try {
        const st = lstatOrNull(journalOpsDirAbs());
        if (st && st.isDirectory() && !st.isSymbolicLink()) {
          const scanned = readDirBounded(journalOpsDirAbs(), LIMITS.dirScanCap);
          operationCount = scanned.entries.filter((e) => e.isDirectory()
            && UUID_RE.test(e.name)).length;
          if (scanned.truncated) operationCount = `${operationCount}+`;
        } else {
          operationCount = 0;
        }
      } catch { operationCount = null; }
    }
    return {
      project: {
        name: ctx.config.project.name,
        configPath: ctx.configPath,
        methodology: ctx.config.methodology ?? 'manual',
        locale: ctx.config.locale,
        hosts: ctx.config.hosts,
        paths: ctx.config.paths,
      },
      workspace: ws && {
        workspaceId: ws.workspaceId,
        projectId: ws.projectId,
        repositoryId: ws.repositoryId,
        revision: ws.revision,
        createdAt: ws.createdAt,
        updatedAt: ws.updatedAt,
        areas: ws.areas.map((a) => ({ id: a.id, key: a.key, name: a.name })),
      },
      counts: {
        tasks: tasks.length,
        tasksByState: byState,
        malformedTasks: malformedTasks.length,
        plans: plans.length,
        artifacts,
        captures: captureCount,
        journalOperations: operationCount,
      },
    };
  }

  function tasks({ limit, offset }) {
    const dir = resolveInside(ctx.projectRoot,
      ctx.config.paths.tasks, 'paths.tasks');
    const { items, malformed, truncated } = listStoreDir(
      dir, (id) => taskSummary(getTask(ctx, id)), limit, offset);
    return { tasks: items, malformed, truncated };
  }

  function task(id) {
    return { task: taskDetail(getTask(ctx, requireUuid(id, 'task id'))) };
  }

  function plans() {
    const { plans: found, malformed } = listPlans(ctx);
    return {
      plans: found.map((p) => {
        let readiness = null;
        let readinessError = null;
        try {
          readiness = nextPlanTasks(ctx, p.key);
        } catch (e) {
          readinessError = toErrorPayload(e);
        }
        return {
          key: p.key,
          schemaVersion: p.schemaVersion,
          title: p.title,
          authorContext: p.authorContext,
          inputDigest: p.inputDigest,
          createdAt: p.createdAt,
          specId: p.specId ?? null,
          designId: p.designId ?? null,
          taskCount: p.tasks.length,
          readiness,
          readinessError,
        };
      }),
      malformed,
    };
  }

  function plan(key) {
    if (typeof key !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(key)) {
      throw err('INVALID_VALUE', 'plan key must be a slug');
    }
    const p = getPlan(ctx, key);
    return { plan: p, readiness: nextPlanTasks(ctx, key) };
  }

  function artifacts(url, { limit, offset }) {
    const kind = url.searchParams.get('kind');
    if (kind === null) {
      throw err('INVALID_QUERY',
        `artifacts requires ?kind= (${ARTIFACT_KINDS.join(', ')})`);
    }
    if (!ARTIFACT_KINDS.includes(kind)) {
      throw err('INVALID_KIND', `unknown artifact kind '${kind}'`);
    }
    const dir = resolveInside(ctx.projectRoot, artifactDirRel(ctx, kind),
      'artifact dir');
    const { items, malformed, truncated } = listStoreDir(
      dir, (id) => artifactSummary(getArtifact(ctx, kind, id)),
      limit, offset);
    return { kind, artifacts: items, malformed, truncated };
  }

  function artifact(kind, id) {
    if (!ARTIFACT_KINDS.includes(kind)) {
      throw err('INVALID_KIND', `unknown artifact kind '${kind}'`);
    }
    const a = getArtifact(ctx, kind, requireUuid(id, 'artifact id'));
    return { artifact: artifactSummary(a) };
  }

  function journalOperations({ limit, offset }) {
    const boundNow = boundOrThrow();
    const { items, malformed, truncated } = listUuidDirs(
      journalOpsDirAbs(),
      (id) => operationSummary(getJournalOperation(boundNow, id), id),
      limit, offset);
    return { operations: items, malformed, truncated };
  }

  function journalOperation(id) {
    const operationId = requireUuid(id, 'operation id');
    const loaded = getJournalOperation(boundOrThrow(), operationId);
    return {
      operationId,
      state: loaded.state,
      intentDigest: loaded.intentDigest,
      intent: loaded.intent,
      recovery: loaded.recovery,
    };
  }

  function captures({ limit, offset }) {
    const store = capturesOrThrow();
    const { items, malformed, truncated } = listStoreDir(
      capturesDirAbs(), (id) => {
        try {
          const got = store.get(id);
          const summary = truncateString(
            got.record.summary, LIMITS.maxSummaryChars);
          return {
            id,
            status: 'proved',
            ownershipConfirmed: true,
            record: {
              kind: got.record.kind,
              revision: got.record.revision,
              category: got.record.category,
              title: got.record.title,
              summary: summary.value,
              summaryTruncated: summary.truncated,
              subjectId: got.record.subjectId,
              supersedes: got.record.supersedes,
              capturedAt: got.record.capturedAt,
              provenance: got.record.provenance,
            },
            scope: { areaIds: got.ownership.scope.areaIds },
            locator: got.locator,
          };
        } catch (e) {
          return {
            id,
            status: captureStatus(e),
            ownershipConfirmed: false,
            record: null,
            scope: null,
            locator: null,
            error: toErrorPayload(e),
          };
        }
      }, limit, offset);
    return { captures: items, malformed, truncated };
  }

  function memory(url) {
    const log = url.searchParams.get('log');
    if (log === null || !MEMORY_LOGS.has(log)) {
      throw err('INVALID_QUERY',
        `memory requires ?log= (${[...MEMORY_LOGS].join(', ')})`);
    }
    const tail = boundedInt(url.searchParams.get('tail'),
      LIMITS.defaultListLimit, { min: 1, max: 1000, label: 'tail' });
    const { entries, malformed } = readWorklog(ctx, log, { tail });
    return { log, entries, malformed };
  }

  function goals() {
    return listGoals(ctx);
  }

  function metrics() {
    return taskMetrics(ctx);
  }

  const reportsDirAbs = () =>
    resolveInside(ctx.projectRoot, ctx.config.paths.reports, 'paths.reports');

  function reports({ limit, offset }) {
    const out = { reports: [], malformed: [], truncated: false };
    const dir = reportsDirAbs();
    const st = lstatOrNull(dir);
    if (!st) return out;
    if (st.isSymbolicLink() || !st.isDirectory()) {
      throw err('INVALID_PATH', 'reports path is not a real directory');
    }
    const scanned = readDirBounded(dir, LIMITS.dirScanCap);
    out.truncated = scanned.truncated;
    const names = scanned.entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('-status.json'))
      .map((entry) => entry.name)
      .sort()
      .reverse();
    out.reports = names.slice(offset, offset + limit);
    if (offset + out.reports.length < names.length) out.truncated = true;
    return out;
  }

  function report(name) {
    if (!REPORT_NAME_RE.test(name)) {
      throw err('INVALID_VALUE',
        'report name must match <stamp>-status.json');
    }
    const abs = resolveInside(reportsDirAbs(), name, 'report file');
    const st = lstatOrNull(abs);
    if (!st || st.isSymbolicLink() || !st.isFile()) {
      throw err('NOT_FOUND', `report '${name}' not found`);
    }
    const limited = readFileLimited(abs, loadLimits().maxDocumentBytes);
    if (limited.exceeded) {
      throw err('DOCUMENT_TOO_LARGE', 'report exceeds document limit');
    }
    return {
      name,
      report: JSON.parse(decodeUtf8Strict(limited.content, 'report file')),
    };
  }

  const approvalsDirAbs = () =>
    resolveInside(ctx.projectRoot,
      `${ctx.config.paths.decisions}/approvals`, 'approvals');

  const SHA_RE = /^[0-9a-f]{64}$/;

  function sessions({ limit, offset }) {
    const { items, malformed, truncated } = listStoreDir(
      sessionsDirAbs(ctx),
      (id) => {
        const s = getSession(ctx, id);
        return {
          id: s.id, taskId: s.taskId, limit: s.limit, used: s.used,
          revision: s.revision, createdAt: s.createdAt,
          updatedAt: s.updatedAt, events: s.events.length,
        };
      }, limit, offset);
    return { sessions: items, malformed, truncated };
  }

  function session(id) {
    return { session: getSession(ctx, requireUuid(id, 'session id')) };
  }

  function approvals({ limit, offset }) {
    const { items, malformed, truncated } = listStoreDir(
      approvalsDirAbs(),
      (id) => {
        const a = getApproval(ctx, id);
        return {
          id: a.id, status: a.status,
          target: a.target,
          specId: a.specId ?? null,
          createdAt: a.createdAt, updatedAt: a.updatedAt,
          answers: Array.isArray(a.answers) ? a.answers.length : 0,
        };
      }, limit, offset, SHA_RE);
    return { approvals: items, malformed, truncated };
  }

  function approval(id) {
    if (!SHA_RE.test(id)) {
      throw err('INVALID_ID', 'approval id must be a sha256 digest');
    }
    return { approval: getApproval(ctx, id) };
  }

  function catalog() {
    const c = loadWorkspaceCatalog(ctx);
    const byKind = {};
    for (const e of c.entries ?? []) {
      const list = byKind[e.kind] ?? (byKind[e.kind] = []);
      if (list.length < LIMITS.maxListLimit) {
        const desc = truncateString(e.description ?? '', LIMITS.maxFieldChars);
        list.push({ id: e.id, description: desc.value, path: e.path ?? null });
      }
    }
    const counts = Object.fromEntries(
      Object.entries(byKind).map(([k, v]) => [k, v.length]));
    return { catalog: { counts, entries: byKind,
      aliases: c.aliases ?? {} } };
  }

  function verifyCommands() {
    const { store, commands } = listVerifyCommands(ctx);
    const page = commands.slice(0, LIMITS.maxListLimit);
    return { store, commands: page,
      truncated: commands.length > page.length };
  }

  function vantadb() {
    let boundNow = null;
    let pendingCommittedEvents = null;
    try {
      boundNow = boundOrThrow();
    } catch { /* unenrolled workspace: status still reports config */ }
    try {
      const status = vantaDBStatus({ ctx, bound: boundNow });
      return { vantadb: status };
    } catch (e) {
      return { vantadb: { configured: false,
        error: toErrorPayload(e) } };
    }
  }

  function workflow() {
    return { workflow: loadPolicy() };
  }

  return Object.freeze({
    health, workspace, tasks, task, plans, plan,
    artifacts, artifact, journalOperations, journalOperation, captures,
    memory, goals, metrics, reports, report,
    sessions, session, approvals, approval, catalog, verifyCommands,
    vantadb, workflow,
  });
}
