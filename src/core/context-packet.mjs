// SPDX-License-Identifier: Apache-2.0
// Session-start context packet: one bounded read assembling everything a
// host needs at the top of a new session — project instructions pointer,
// workspace identity, task distribution, ready work, recent progress,
// open goals, pending journal events and the latest session record.
// Read-only; the host reads, Scopegrain never injects or executes.
// Shared by the CLI 'context' command and the scopegrain_context MCP tool
// so both hosts always see the same packet shape.
import fs from 'node:fs';
import { configRel, resolveInside } from './paths.mjs';
import { estimateJson, estimateTokens, TOKEN_ESTIMATOR }
  from './tokens.mjs';

// opts: { tail?: number, timeoutMs?: number, noVantadb?: boolean }
export async function assembleContextPacket(ctx, opts = {}) {
  const noVantadb = opts.noVantadb === true;
  const timeoutMs = opts.timeoutMs;
  const { listTasks } = await import('./tasks.mjs');
  const { readWorklog, listGoals } = await import('./worklog.mjs');
  const { getSession, sessionsDirAbs } = await import('./sessions.mjs');
  const { bindWorkspace, getWorkspace } = await import('./workspaces.mjs');
  const { countJournalPending } = await import('./journal.mjs');
  const { structureStatus } = await import('../discovery/structure.mjs');
  const workspace = getWorkspace(ctx);
  const { tasks } = listTasks(ctx);
  const byState = {};
  for (const t of tasks) byState[t.state] = (byState[t.state] ?? 0) + 1;
  const open = tasks.filter((t) => t.state !== 'CLOSE');
  const tail = opts.tail ?? 5;
  let pendingJournal = 0;
  try {
    const bound = bindWorkspace(ctx,
      { areaIds: workspace.areas.map((a) => a.id) });
    pendingJournal = countJournalPending(bound);
  } catch { /* journal absent or unreadable — surface as 0 */ }
  // User-owned session-start knowledge: .scopegrain/context.md, bounded.
  const CONTEXT_MD_MAX = 32 * 1024;
  const contextMdPath = configRel(ctx, `context.md`);
  let userContext = null;
  try {
    const raw = fs.readFileSync(
      resolveInside(ctx.projectRoot, contextMdPath, 'context.md'), 'utf8');
    userContext = {
      path: contextMdPath, bytes: Buffer.byteLength(raw, 'utf8'),
      truncated: raw.length > CONTEXT_MD_MAX,
      content: raw.length > CONTEXT_MD_MAX
        ? raw.slice(0, CONTEXT_MD_MAX) : raw,
    };
  } catch { /* absent or unreadable — packet carries null */ }
  let sessions = [];
  try {
    const dir = sessionsDirAbs(ctx);
    sessions = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try { return getSession(ctx, f.slice(0, -5)); } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
      .slice(0, 3)
      .map((s) => ({ id: s.id, taskId: s.taskId, used: s.used,
        limit: s.limit, revision: s.revision, updatedAt: s.updatedAt }));
  } catch { /* sessions dir absent — empty list */ }
  const packet = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    instructions: configRel(ctx, `instructions.md`),
    config: configRel(ctx, `config.json`),
    methodology: ctx.config.methodology,
    intake: ctx.config.intake,
    userContext, sessions,
    project: { name: ctx.projectName ?? null, root: ctx.projectRoot },
    workspace: {
      revision: workspace.revision, areas: workspace.areas.length,
      areaKeys: workspace.areas.map((a) => a.key),
    },
    // Active-task pointer: env SCOPEGRAIN_TASK overrides the persisted
    // <configDir>/active-task file. A dangling pointer degrades to a
    // structured error, never aborts the session-start packet.
    activeTask: await (async () => {
      try {
        const { getActiveTask } = await import('./active.mjs');
        const { task, source } = getActiveTask(ctx);
        return task ? { id: task.id, slug: task.slug ?? null,
          title: task.title, state: task.state, source } : null;
      } catch (e) {
        return { error: { code: e.code ?? 'INTERNAL',
          message: String(e.message ?? e) } };
      }
    })(),
    tasks: {
      total: tasks.length, open: open.length, byState,
      ready: open.filter(
        (t) => t.state === 'PLAN' && t.disposition === null)
        .map((t) => ({ id: t.id, title: t.title,
          priority: t.priority ?? null, backlog: t.backlog ?? null })),
    },
    // Session start must survive an unreadable or oversized log: read
    // bounded, degrade to an error marker, never throw the packet.
    progress: (() => {
      try {
        const log = readWorklog(ctx, 'progress', { tail });
        return log.truncated
          ? { truncated: true, entries: log.entries }
          : { truncated: false, entries: log.entries };
      } catch (e) {
        return { truncated: false, entries: [],
          error: { code: e.code ?? 'INTERNAL',
            message: String(e.message ?? e) } };
      }
    })(),
    // Retroactive activity evidence (commits outside the task loop)
    // surfaces alongside progress so session start sees recent work.
    activity: (() => {
      try {
        const log = readWorklog(ctx, 'activity', { tail });
        return log.truncated
          ? { truncated: true, entries: log.entries }
          : { truncated: false, entries: log.entries };
      } catch (e) {
        return { truncated: false, entries: [],
          error: { code: e.code ?? 'INTERNAL',
            message: String(e.message ?? e) } };
      }
    })(),
    goals: (() => {
      try {
        return listGoals(ctx).goals.filter((g) => g.status === 'open')
          .map((g) => ({ id: g.id, title: g.title }));
      } catch {
        return [];
      }
    })(),
    pendingJournalOperations: pendingJournal,
    // Structural index freshness: stat-only rescan, never reads contents.
    // stale:true tells the agent to run `structure scan` before relying on
    // cached structure instead of re-analyzing the tree itself.
    structure: (() => {
      try {
        return structureStatus(ctx);
      } catch {
        return { indexed: false, stale: null, summary: null };
      }
    })(),
    // Automatic project-level rehydration: one bounded memory_recall
    // over the distilled L1 pool when a VantaDB backend is enrolled.
    // Degradable like the rest of the packet — never aborts.
    vantadb: await (async () => {
      if (noVantadb === true) {
        return { enrolled: null, recall: null, skipped: true };
      }
      try {
        const { projectRehydration } = await import(
          '../integrations/vantadb-rehydrate.mjs');
        return await projectRehydration({
          ctx, timeoutMs,
        });
      } catch (e) {
        return { enrolled: null, recall: null,
          error: { code: e.code ?? 'INTERNAL',
            message: String(e.message ?? e) } };
      }
    })(),
  };
  // Local token estimate (heuristic, never the host's real tokenizer):
  // per-section costs over the assembled packet plus a packet total.
  // userContext is measured on the returned content — post 32 KiB cap —
  // and flagged when that content only covers a truncated file. Advisory
  // and degradable like the rest: a failure yields null, not an abort.
  try {
    const sections = {};
    for (const [key, value] of Object.entries(packet)) {
      if (key === 'userContext') {
        const est = value !== null && typeof value === 'object'
            && typeof value.content === 'string'
          ? estimateTokens(value.content)
          : estimateJson(value);
        sections[key] = { ...est,
          coversTruncatedContent: value?.truncated === true };
      } else {
        sections[key] = estimateJson(value);
      }
    }
    packet.tokenEstimate = {
      estimator: TOKEN_ESTIMATOR,
      total: estimateJson(packet).estimatedTokens,
      sections,
    };
  } catch {
    packet.tokenEstimate = null;
  }
  return packet;
}
