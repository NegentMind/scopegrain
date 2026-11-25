// SPDX-License-Identifier: Apache-2.0
// Read-only query facade for the local JSON API. Wraps the core getters and
// store locations with hard response bounds: capped directory listings,
// per-item error surfacing and string-field truncation. No writes, no
// dynamic filesystem access outside the configured Scopegrain stores.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { err, toErrorPayload } from '../core/errors.mjs';
import {
  decodeUtf8Strict, lstatOrNull, readDirBounded, readFileLimited,
  readJsonFile, removeIfExists, writeFileExclusive,
} from '../core/fsx.mjs';
import { loadLimits } from '../core/policy.mjs';
import {
  listGoals, readWorklog, taskMetrics,
} from '../core/worklog.mjs';
import { configRel, resolveInside } from '../core/paths.mjs';
import { getTask, listTasks } from '../core/tasks.mjs';
import { getChecklist } from '../core/checklists.mjs';
import { getConstitution } from '../core/constitution.mjs';
import { getActiveTask } from '../core/active.mjs';
import {
  getPlan, listPlans, nextPlanTasks, planRunState, planWaves,
} from '../core/plans.mjs';
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

const MEMORY_LOGS = new Set(['lessons', 'outcomes', 'progress', 'goals',
  'activity']);
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

// V2/V3 formal refs mean the SDD route; a stored assessment classifies on
// the fly (pure function); V1 manual tasks carry no route signal.
function taskRoute(task) {
  if (task.schemaVersion !== 2 && task.schemaVersion !== 3) return null;
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
    allowedTools: Array.isArray(task.allowedTools) ? task.allowedTools : null,
    requiredCapabilities: Array.isArray(task.requiredCapabilities)
      ? task.requiredCapabilities : null,
    agentRole: task.agentRole ?? null,
    expectedOutputs: Array.isArray(task.expectedOutputs)
      ? task.expectedOutputs : null,
    sideEffects: task.sideEffects ?? null,
    executionType: task.executionType ?? null,
    outputContract: task.outputContract ?? null,
    reviewRubric: task.reviewRubric ?? null,
    fallback: task.fallback ?? null,
    contextInheritance: task.contextInheritance ?? null,
    modelTier: task.modelTier ?? null,
    directives: task.directives ?? null,
    sharedContext: task.sharedContext ?? null,
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
// `options.allowWrite` opts the instance into the bounded catalog-doc
// mutation channel (PUT /api/catalog/:kind/:id); without it the facade is
// strictly read-only.
export function createApiQueries(ctx, options = {}) {
  const allowWrite = options.allowWrite === true;
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

  // Rendered task document (<tasksDir>/<uuid>.md) produced by `task doc`.
  // Read-only bounded file fetch - null doc when the task file does not
  // exist yet (the JSON record stays authoritative).
  function taskDoc(id) {
    const uuid = requireUuid(id, 'task id');
    getTask(ctx, uuid); // 404s on missing/malformed records first
    const dir = resolveInside(ctx.projectRoot,
      ctx.config.paths.tasks, 'paths.tasks');
    const file = resolveInside(dir, `${uuid}.md`, 'task doc');
    const st = lstatOrNull(file);
    if (!st) return { id: uuid, doc: null };
    if (st.isSymbolicLink() || !st.isFile()) {
      throw err('SYMLINK_REJECTED', `task doc may not be a link: ${uuid}`);
    }
    const limited = readFileLimited(file, loadLimits().maxDocumentBytes);
    const text = decodeUtf8Strict(limited.content, 'MALFORMED', 'task doc');
    const cut = truncateString(text, LIMITS.maxBodyChars);
    return {
      id: uuid,
      doc: cut.value,
      docTruncated: cut.truncated || limited.exceeded || null,
      bytes: st.size,
      updatedAt: st.mtime.toISOString(),
    };
  }

  // Plan documents (<plansDir>/*.md): human-readable plan files, listed
  // alongside the semantic plan records. Names are filename slugs only -
  // resolved inside the plans dir, never arbitrary paths.
  const PLAN_DOC_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}\.md$/;

  function planDocs() {
    const dir = resolveInside(ctx.projectRoot,
      ctx.config.paths.plans, 'paths.plans');
    const st = lstatOrNull(dir);
    const out = { docs: [] };
    if (!st) return out;
    if (st.isSymbolicLink() || !st.isDirectory()) {
      throw err('INVALID_PATH', 'plans path is not a real directory');
    }
    const names = fs.readdirSync(dir).sort()
      .filter((n) => PLAN_DOC_RE.test(n));
    for (const name of names.slice(0, LIMITS.dirScanCap)) {
      const file = resolveInside(dir, name, 'plan doc');
      const fst = lstatOrNull(file);
      if (!fst || fst.isSymbolicLink() || !fst.isFile()) continue;
      const fm = frontmatterSummary(file);
      out.docs.push({
        name,
        title: fm.title ?? name.replace(/\.md$/, ''),
        status: fm.status ?? null,
        kind: fm.kind ?? null,
        date: fm.date ?? (/^(\d{4}-\d{2}-\d{2})/.exec(name)?.[1] ?? null),
        bytes: fst.size,
        updatedAt: fst.mtime.toISOString(),
      });
    }
    out.truncated = names.length > LIMITS.dirScanCap || null;
    return out;
  }

  // Minimal scalar frontmatter peek (bounded head of file): only flat
  // `key: value` lines, never full YAML. Used for listing metadata.
  function frontmatterSummary(file) {
    const limited = readFileLimited(file, 8192);
    let text;
    try {
      text = decodeUtf8Strict(
        limited.content, 'MALFORMED', 'frontmatter');
    } catch {
      return {};
    }
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    if (!m) return {};
    const out = {};
    for (const line of m[1].split(/\r?\n/)) {
      const kv = /^([A-Za-z][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line);
      if (!kv) continue;
      const v = kv[2].trim().replace(/^["']|["']$/g, '');
      if (v !== '') out[kv[1]] = v.slice(0, 300);
    }
    return out;
  }

  // Loose artifact documents (*.md) inside the canonical artifact dir and
  // legacy flat dirs (`.scopegrain/<kind>/`, `.scopegrain/<kind>s/`) that
  // predate the formal UUID-keyed artifact store. Listing is read-only;
  // registered artifacts still come from `artifacts()`/`artifact()`.
  const DOC_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}\.(md|markdown)$/;

  function artifactDocDirs(kind) {
    if (!ARTIFACT_KINDS.includes(kind)) {
      throw err('INVALID_KIND', `unknown artifact kind '${kind}'`);
    }
    const dirs = [artifactDirRel(ctx, kind)];
    const stateRoot = path.posix.dirname(
      ctx.config.paths.decisions.replaceAll('\\', '/'));
    for (const flat of [`${stateRoot}/${kind}`, `${stateRoot}/${kind}s`]) {
      if (!dirs.includes(flat)) dirs.push(flat);
    }
    return dirs;
  }

  function artifactDocs(kind) {
    const out = { kind, docs: [] };
    for (const dirRel of artifactDocDirs(kind)) {
      const dir = resolveInside(ctx.projectRoot, dirRel, 'artifact doc dir');
      const st = lstatOrNull(dir);
      if (!st) continue;
      if (st.isSymbolicLink() || !st.isDirectory()) {
        throw err('INVALID_PATH', `${dirRel} is not a real directory`);
      }
      const names = fs.readdirSync(dir).sort()
        .filter((n) => DOC_RE.test(n));
      for (const name of names.slice(0, LIMITS.dirScanCap)) {
        const file = resolveInside(dir, name, 'artifact doc');
        const fst = lstatOrNull(file);
        if (!fst || fst.isSymbolicLink() || !fst.isFile()) continue;
        const fm = frontmatterSummary(file);
        out.docs.push({
          name,
          dir: dirRel,
          title: fm.title ?? name.replace(/\.(md|markdown)$/, ''),
          status: fm.status ?? null,
          date: fm.date
            ?? (/^(\d{4}-\d{2}-\d{2})/.exec(name)?.[1] ?? null),
          bytes: fst.size,
          updatedAt: fst.mtime.toISOString(),
        });
      }
    }
    return out;
  }

  function artifactDoc(kind, name) {
    if (typeof name !== 'string' || !DOC_RE.test(name)) {
      throw err('INVALID_VALUE',
        'artifact doc name must be a markdown filename slug');
    }
    for (const dirRel of artifactDocDirs(kind)) {
      const dir = resolveInside(ctx.projectRoot, dirRel, 'artifact doc dir');
      const file = resolveInside(dir, name, 'artifact doc');
      const st = lstatOrNull(file);
      if (!st) continue;
      if (st.isSymbolicLink() || !st.isFile()) {
        throw err('SYMLINK_REJECTED', `artifact doc may not be a link: ${name}`);
      }
      const limited = readFileLimited(file, loadLimits().maxDocumentBytes);
      const text = decodeUtf8Strict(
        limited.content, 'MALFORMED', 'artifact doc');
      const cut = truncateString(text, LIMITS.maxBodyChars);
      return {
        kind, name, dir: dirRel,
        doc: cut.value,
        docTruncated: cut.truncated || limited.exceeded || null,
        bytes: st.size,
        updatedAt: st.mtime.toISOString(),
      };
    }
    throw err('ARTIFACT_DOC_NOT_FOUND', `artifact doc not found: ${name}`);
  }

  function planDoc(name) {
    if (typeof name !== 'string' || !PLAN_DOC_RE.test(name)) {
      throw err('INVALID_VALUE',
        'plan doc name must be a markdown filename slug');
    }
    const dir = resolveInside(ctx.projectRoot,
      ctx.config.paths.plans, 'paths.plans');
    const file = resolveInside(dir, name, 'plan doc');
    const st = lstatOrNull(file);
    if (!st) {
      throw err('PLAN_DOC_NOT_FOUND', `plan doc not found: ${name}`);
    }
    if (st.isSymbolicLink() || !st.isFile()) {
      throw err('SYMLINK_REJECTED', `plan doc may not be a link: ${name}`);
    }
    const limited = readFileLimited(file, loadLimits().maxDocumentBytes);
    const text = decodeUtf8Strict(limited.content, 'MALFORMED', 'plan doc');
    const cut = truncateString(text, LIMITS.maxBodyChars);
    return {
      name,
      doc: cut.value,
      docTruncated: cut.truncated || limited.exceeded || null,
      bytes: st.size,
      updatedAt: st.mtime.toISOString(),
    };
  }

  // Member tasks of a plan joined with their live records: state,
  // disposition and title per entry, plus derived done/open counts,
  // progress ratio and a coarse status for the whole plan.
  const PLAN_DONE = new Set(['CLOSE']);
  const PLAN_DROPPED = new Set(
    ['discarded', 'cancelled', 'icebox', 'future', 'deferred']);
  const PLAN_ACTIVE = new Set(
    ['ACT', 'VERIFY', 'COLLATERAL', 'EVALUATE', 'REVIEW', 'ACCEPT']);

  function planTaskBreakdown(p) {
    const tasks = p.tasks.map((t) => {
      let rec = null;
      let error = null;
      try { rec = getTask(ctx, t.id); } catch (e) {
        error = toErrorPayload(e);
      }
      return {
        key: t.key, id: t.id, dependsOn: t.dependsOn,
        title: rec?.title ?? null, state: rec?.state ?? null,
        disposition: rec?.disposition ?? null,
        triage: t.triage ?? null, triageReason: t.triageReason ?? null,
        rationale: t.rationale ?? null, error,
      };
    });
    const done = tasks.filter((t) => PLAN_DONE.has(t.state)
      || PLAN_DROPPED.has(t.disposition?.kind)).length;
    const active = tasks.filter((t) => PLAN_ACTIVE.has(t.state)).length;
    const status = tasks.length === 0 ? 'empty'
      : done === tasks.length ? 'completed'
      : active > 0 ? 'in_progress'
      : 'pending';
    return {
      tasks, done, total: tasks.length, active,
      progress: tasks.length === 0 ? null
        : Math.round((done / tasks.length) * 100),
      status,
    };
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
          request: p.request ?? null,
          planType: p.planType ?? null,
          trigger: p.trigger ?? null,
          acceptanceCriteria: p.acceptanceCriteria ?? null,
          deliverables: p.deliverables ?? null,
          synthesisStrategy: p.synthesisStrategy ?? null,
          replanPolicy: p.replanPolicy ?? null,
          executiveSummary: p.executiveSummary ?? null,
          autonomyPolicy: p.autonomyPolicy ?? null,
          concurrencyPolicy: p.concurrencyPolicy ?? null,
          ttlSeconds: p.ttlSeconds ?? null,
          supersedes: p.supersedes ?? null,
          version: p.version ?? null,
          createKey: p.createKey ?? null,
          ioBindings: p.ioBindings ?? null,
          directives: p.directives ?? null,
          sharedContext: p.sharedContext ?? null,
          taskCount: p.tasks.length,
          readiness,
          readinessError,
          ...planTaskBreakdown(p),
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
    let waves = null;
    let wavesError = null;
    let runState = null;
    try { waves = planWaves(ctx, key); } catch (e) {
      wavesError = toErrorPayload(e);
    }
    try { runState = planRunState(ctx, key); } catch {
      runState = null;
    }
    return {
      plan: p,
      readiness: nextPlanTasks(ctx, key),
      waves, wavesError, runState,
      ...planTaskBreakdown(p),
    };
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

  // Goals enriched with their linked tasks (task.goalIds -> goal.id)
  // and derived progress: total/done counts and a completion ratio.
  function goals() {
    const base = listGoals(ctx);
    const taskDir = resolveInside(ctx.projectRoot,
      ctx.config.paths.tasks, 'paths.tasks');
    const linked = new Map();
    const st = lstatOrNull(taskDir);
    if (st && !st.isSymbolicLink() && st.isDirectory()) {
      for (const name of fs.readdirSync(taskDir).sort()) {
        if (!name.endsWith('.json')) continue;
        const id = name.slice(0, -'.json'.length);
        if (!UUID_RE.test(id)) continue;
        let rec;
        try { rec = getTask(ctx, id); } catch { continue; }
        for (const gid of rec.goalIds ?? []) {
          if (typeof gid !== 'string') continue;
          if (!linked.has(gid)) linked.set(gid, []);
          linked.get(gid).push({
            id: rec.id, title: rec.title, state: rec.state,
            disposition: rec.disposition ?? null,
            priority: rec.priority ?? null, type: rec.type ?? null,
          });
        }
      }
    }
    const DONE = new Set(['CLOSE']);
    const DROPPED = new Set(
      ['discarded', 'cancelled', 'icebox', 'future', 'deferred']);
    base.goals = base.goals.map((g) => {
      const tasks = linked.get(g.id) ?? [];
      const done = tasks.filter(
        (tk) => DONE.has(tk.state)
          || DROPPED.has(tk.disposition?.kind)).length;
      return {
        ...g,
        tasks,
        taskCount: tasks.length,
        tasksDone: done,
        progress: tasks.length === 0 ? null
          : Math.round((done / tasks.length) * 100),
      };
    });
    return base;
  }

  function metrics() {
    return taskMetrics(ctx);
  }

  function checklistSummary(c) {
    const title = truncateString(c.title, LIMITS.maxFieldChars);
    const counts = { pending: 0, pass: 0, fail: 0, na: 0 };
    const items = c.items.map((it) => {
      const text = truncateString(it.text ?? '', LIMITS.maxFieldChars);
      counts[it.status] = (counts[it.status] ?? 0) + 1;
      return {
        id: it.id, status: it.status,
        text: text.value, textTruncated: text.truncated,
        note: it.note ?? null,
      };
    });
    return {
      id: c.id, taskId: c.taskId,
      title: title.value, titleTruncated: title.truncated,
      revision: c.revision, createdAt: c.createdAt, updatedAt: c.updatedAt,
      items, counts,
    };
  }

  function checklists({ limit, offset }) {
    const dir = resolveInside(ctx.projectRoot,
      configRel(ctx, 'checklists'), 'checklists');
    const { items, malformed, truncated } = listStoreDir(
      dir, (id) => checklistSummary(getChecklist(ctx, id)), limit, offset);
    return { checklists: items, malformed, truncated };
  }

  function constitution() {
    return { constitution: getConstitution(ctx) };
  }

  function activeTask() {
    try {
      const { task, source } = getActiveTask(ctx);
      return { task: task ? taskSummary(task) : null, source };
    } catch (e) {
      return { task: null, source: null, error: toErrorPayload(e) };
    }
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
    return {
      name,
      report: readJsonFile(abs, 'report file', loadLimits().maxDocumentBytes),
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
    const s = getSession(ctx, requireUuid(id, 'session id'));
    let task = null;
    try {
      const t = getTask(ctx, s.taskId);
      task = {
        id: t.id,
        title: truncateString(t.title, 256, 'title').value,
        state: t.state,
        revision: t.revision,
        scope: Array.isArray(t.scope) ? t.scope : [],
        planKey: t.planKey ?? null,
        specId: t.specId ?? null,
        designId: t.designId ?? null,
        goalIds: Array.isArray(t.goalIds) ? t.goalIds : [],
      };
    } catch {
      task = null;
    }
    const remaining = Math.max(0, s.limit - s.used);
    const pct = s.limit > 0 ? Math.min(100, Math.round((s.used / s.limit) * 100)) : 0;
    // Self-reported token accounting: caller-declared totals, never
    // observed; percent stays null when no tokenLimit was declared.
    const reported = s.events.reduce(
      (n, ev) => n + (ev.tokens ? ev.tokens.total : 0), 0);
    const tokenLimit = s.tokenLimit ?? null;
    const tokenPct = tokenLimit === null || tokenLimit === 0
      ? null : Math.min(100, Math.round((reported / tokenLimit) * 100));
    return {
      session: s,
      resumeContext: {
        task,
        budget: { used: s.used, limit: s.limit, remaining, percent: pct },
        tokenUsage: {
          reported,
          limit: tokenLimit,
          remaining: tokenLimit === null
            ? null : Math.max(0, tokenLimit - reported),
          percent: tokenPct,
          measures: loadLimits().tokenMeasures,
        },
        lastEvent: s.events.length > 0 ? s.events[s.events.length - 1] : null,
        resumeCommand: `scopegrain session resume --project . ${s.id}`,
      },
    };
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

  // Manifest dependency keys surfaced verbatim so the viewer can render
  // bindings (e.g. command -> prompts) without re-reading the catalog.
  const CATALOG_DEP_KEYS = Object.freeze(
    ['agents', 'skills', 'rules', 'references', 'prompts', 'mcps']);

  function catalog() {
    const c = loadWorkspaceCatalog(ctx);
    const byKind = {};
    const totals = {};
    let dropped = 0;
    for (const e of c.entries ?? []) {
      totals[e.kind] = (totals[e.kind] ?? 0) + 1;
      const list = byKind[e.kind] ?? (byKind[e.kind] = []);
      if (list.length >= LIMITS.maxListLimit) {
        dropped += 1;
        continue;
      }
      const desc = truncateString(e.description ?? '', LIMITS.maxFieldChars);
      const item = { id: e.id, description: desc.value, path: e.path ?? null };
      if (Array.isArray(e.modes)) item.modes = e.modes;
      for (const dk of CATALOG_DEP_KEYS) {
        if (Array.isArray(e[dk]) && e[dk].length > 0) item[dk] = e[dk];
      }
      list.push(item);
    }
    return { catalog: { counts: totals, entries: byKind,
      truncated: dropped > 0 || null, aliases: c.aliases ?? {} } };
  }

  const CATALOG_ID_RE = /^[a-z0-9][a-z0-9-]{0,120}$/;

  // Alias-aware entry resolution shared by the read and write paths: the
  // canonical id wins; otherwise a same-kind alias resolves to its target.
  function catalogDocEntry(c, kind, id) {
    const entries = c.entries ?? [];
    let entry = entries.find((e) => e.kind === kind && e.id === id);
    if (!entry) {
      const alias = (c.aliases ?? []).find(
        (a) => a.kind === kind && a.id === id && a.target);
      if (alias) {
        entry = entries.find(
          (e) => e.kind === kind && e.id === alias.target);
      }
    }
    return entry ?? null;
  }

  const catalogConfigDir = () => (ctx.configDir === '.'
    ? ctx.projectRoot
    : resolveInside(ctx.projectRoot, ctx.configDir, 'config directory'));

  // Body of a catalog entry's projected file (configDir/<entry.path>). The
  // served bytes are the hash-pinned projection, not the canonical source.
  // `writable` reports whether this server accepts the PUT channel for the
  // doc right now: write opt-in plus a pinned sha256 the client can CAS
  // against (legacy unpinned snapshots stay read-only).
  // Locale variant of a catalog doc lives in the canonical source tree,
  // not in the projection: resources/i18n/<locale>/<entry.path>. The
  // projected (hash-pinned) English file stays the writable canonical;
  // variants are read-only display copies. Falling back to the canonical
  // English projection is explicit via doc.locale.
  const LOCALE_DOC_RE = /^[a-z]{2}$/;

  function catalogDoc(kind, id, locale) {
    if (!CATALOG_ID_RE.test(id)) {
      throw err('INVALID_ID', 'catalog entry id must be a lowercase slug');
    }
    const c = loadWorkspaceCatalog(ctx);
    const entry = catalogDocEntry(c, kind, id);
    if (!entry?.path) {
      throw err('NOT_FOUND', `catalog entry not found: ${kind}/${id}`);
    }
    const configDir = catalogConfigDir();
    let file = resolveInside(configDir, entry.path, 'catalog doc');
    let servedLocale = 'en';
    if (LOCALE_DOC_RE.test(locale ?? '') && locale !== 'en') {
      const variant = resolveInside(ctx.projectRoot,
        `resources/i18n/${locale}/${entry.path}`, 'catalog doc locale');
      const vst = lstatOrNull(variant);
      if (vst && !vst.isSymbolicLink() && vst.isFile()) {
        file = variant;
        servedLocale = locale;
      }
    }
    const st = lstatOrNull(file);
    if (!st) {
      return { doc: null,
        entry: { kind, id: entry.id, path: entry.path } };
    }
    if (st.isSymbolicLink() || !st.isFile()) {
      throw err('SYMLINK_REJECTED',
        `catalog doc may not be a link: ${kind}/${id}`);
    }
    const limited = readFileLimited(file, loadLimits().maxDocumentBytes);
    const text = decodeUtf8Strict(
      limited.content, 'MALFORMED', 'catalog doc');
    const cut = truncateString(text, LIMITS.maxBodyChars);
    return {
      doc: {
        kind, id: entry.id, path: entry.path,
        sha256: entry.sha256 ?? null,
        locale: servedLocale,
        writable: servedLocale === 'en' && allowWrite
          && typeof entry.sha256 === 'string',
        body: cut.value,
        truncated: cut.truncated || limited.exceeded || null,
        bytes: st.size,
        updatedAt: st.mtime.toISOString(),
      },
    };
  }

  // Bounded catalog-doc mutation — reachable only when the server was
  // started with the write opt-in (view --allow-write → allowWrite).
  //
  // NOT journaled, by design: the owned-record journal
  // (applyJournaledRecordUpdate) covers workspace records authorized by
  // area scope — tasks, captures, the workspace descriptor — and requires
  // an enrolled workspace binding. A catalog projection under configDir is
  // a harness-owned generated file, not an area-scoped record, and this
  // endpoint must also answer on unenrolled projects where no binding
  // exists. The honest boundary is therefore the snapshot's own integrity
  // model: the write is atomic (exclusive temp + fsync + rename), CAS
  // checked against live bytes, and the manifest pin is updated so the
  // snapshot stays internally consistent. A later `update` still reports
  // the file as diverged from the install catalog — edits are never
  // silently reverted; `update --reconcile` is the owner's explicit
  // revert.
  const CATALOG_DOC_WRITE_KEYS = new Set(['content', 'expectedSha256']);

  function catalogDocWrite(kind, id, body) {
    if (!allowWrite) {
      throw err('WRITE_DISABLED',
        'catalog doc writes require the write opt-in (--allow-write)');
    }
    if (!CATALOG_ID_RE.test(id)) {
      throw err('INVALID_ID', 'catalog entry id must be a lowercase slug');
    }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw err('INVALID_BODY', 'catalog doc write requires a JSON object');
    }
    for (const key of Object.keys(body)) {
      if (!CATALOG_DOC_WRITE_KEYS.has(key)) {
        throw err('INVALID_BODY',
          `catalog doc write has unknown key '${key}'`);
      }
    }
    if (typeof body.content !== 'string') {
      throw err('INVALID_BODY', 'catalog doc write requires content: string');
    }
    if (typeof body.expectedSha256 !== 'string'
        || !SHA_RE.test(body.expectedSha256)) {
      throw err('INVALID_BODY',
        'expectedSha256 must be a sha256 hex digest');
    }
    // Same byte cap the read path enforces on documents.
    const content = Buffer.from(body.content, 'utf8');
    if (content.length > loadLimits().maxDocumentBytes) {
      throw err('DOCUMENT_TOO_LARGE',
        'catalog doc content exceeds document limit');
    }
    const c = loadWorkspaceCatalog(ctx);
    const entry = catalogDocEntry(c, kind, id);
    if (!entry?.path) {
      throw err('NOT_FOUND', `catalog entry not found: ${kind}/${id}`);
    }
    const configDir = catalogConfigDir();
    const file = resolveInside(configDir, entry.path, 'catalog doc');
    const st = lstatOrNull(file);
    if (!st) {
      throw err('NOT_FOUND',
        `catalog doc not found on disk: ${kind}/${id}`);
    }
    if (st.isSymbolicLink() || !st.isFile()) {
      throw err('SYMLINK_REJECTED',
        `catalog doc may not be a link: ${kind}/${id}`);
    }
    // CAS: the live bytes must hash to expectedSha256. On a verified V2
    // snapshot this equals the pin, but the check still matters — another
    // writer can land between the catalog load above and the rename.
    const limited = readFileLimited(file, loadLimits().maxDocumentBytes);
    if (limited.exceeded) {
      throw err('DOCUMENT_TOO_LARGE',
        'catalog doc exceeds document limit');
    }
    const currentSha = crypto.createHash('sha256')
      .update(limited.content).digest('hex');
    if (currentSha !== body.expectedSha256.toLowerCase()) {
      throw err('WRITE_CONFLICT',
        `catalog doc changed since the read: ${kind}/${id} — reload and retry`);
    }
    const newSha = crypto.createHash('sha256').update(content).digest('hex');
    // Re-lstat immediately before replacing to narrow the symlink-swap
    // window; the residual TOCTOU caveat is the one already documented for
    // reads.
    const before = lstatOrNull(file);
    if (!before || before.isSymbolicLink() || !before.isFile()) {
      throw err('WRITE_CONFLICT',
        `catalog doc changed since the read: ${kind}/${id} — reload and retry`);
    }
    // Atomic replace: exclusive temp in the same directory (same volume as
    // the rename target), fsync, then rename. A failed write removes only
    // the temp we own.
    const tmp = `${file}.tmp-${crypto.randomBytes(8).toString('hex')}`;
    writeFileExclusive(tmp, content);
    try {
      fs.renameSync(tmp, file);
    } catch (e) {
      removeIfExists(tmp);
      throw err('WRITE_FAILED',
        `catalog doc rename failed: ${kind}/${id} (${e.code ?? e})`);
    }
    // Pin update: snapshot entries live in catalog.json, mounted bundle
    // entries in mounted-catalog.json. The manifest is fresh-read NOW (it
    // may have changed since the catalog load), exactly one entry's sha256
    // is updated, and the manifest is replaced atomically. If the pin
    // cannot be updated, the pre-edit bytes are restored best-effort so
    // file and manifest never sit diverged longer than needed — and any
    // residual divergence is reported, never hidden.
    const manifestAbs = resolveInside(configDir,
      entry.bundle ? 'mounted-catalog.json' : 'catalog.json',
      'catalog manifest');
    try {
      const manifest = readJsonFile(manifestAbs, 'catalog manifest');
      if (manifest === null || typeof manifest !== 'object'
          || Array.isArray(manifest) || !Array.isArray(manifest.entries)) {
        throw err('CATALOG_MALFORMED', 'catalog manifest lost its entries');
      }
      const target = manifest.entries.find(
        (e) => e && e.kind === entry.kind && e.id === entry.id);
      if (!target) {
        throw err('WRITE_PIN_FAILED',
          `catalog manifest no longer lists ${entry.kind}/${entry.id}`);
      }
      target.sha256 = newSha;
      const mtmp =
        `${manifestAbs}.tmp-${crypto.randomBytes(8).toString('hex')}`;
      writeFileExclusive(mtmp,
        Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8'));
      try {
        fs.renameSync(mtmp, manifestAbs);
      } catch (e) {
        removeIfExists(mtmp);
        throw e;
      }
    } catch (pinErr) {
      let rolledBack = false;
      try {
        const rtmp = `${file}.tmp-${crypto.randomBytes(8).toString('hex')}`;
        writeFileExclusive(rtmp, limited.content);
        fs.renameSync(rtmp, file);
        rolledBack = true;
      } catch { /* best effort: residual divergence is reported below */ }
      const base = pinErr && typeof pinErr.message === 'string'
        ? pinErr.message : 'pin update failed';
      throw err('WRITE_PIN_FAILED',
        `${base}; file rollback ${rolledBack ? 'applied'
          : 'FAILED — the edit is still on disk'} `
        + '(recover with `update --reconcile`)');
    }
    return {
      kind, id: entry.id, path: entry.path, sha256: newSha, applied: true,
    };
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
    health, workspace, tasks, task, taskDoc, plans, plan,
    planDocs, planDoc, artifactDocs, artifactDoc,
    artifacts, artifact, journalOperations, journalOperation, captures,
    memory, goals, metrics, reports, report,
    sessions, session, approvals, approval, catalog, catalogDoc,
    catalogDocWrite, verifyCommands,
    vantadb, workflow, checklists, constitution, activeTask,
  });
}
