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

// opts: { tail?: number, timeoutMs?: number, noVantadb?: boolean,
//   noStructure?: boolean, structureDebounceMs?: number }
export async function assembleContextPacket(ctx, opts = {}) {
  const noVantadb = opts.noVantadb === true;
  const noStructure = opts.noStructure === true;
  const structureDebounceMs = opts.structureDebounceMs;
  const timeoutMs = opts.timeoutMs;
  const { listTasks } = await import('./tasks.mjs');
  const { readWorklog, listGoals } = await import('./worklog.mjs');
  const { getSession, sessionsDirAbs } = await import('./sessions.mjs');
  const { bindWorkspace, getWorkspace } = await import('./workspaces.mjs');
  const { countJournalPending } = await import('./journal.mjs');
  const { structureStatus, storedStructureStatus } =
    await import('../discovery/structure.mjs');
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
    // Preferred user language: generated operational artifacts and
    // interactive surfaces follow it (see templates Language policy).
    locale: ctx.config.locale ?? 'en',
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
    // Advisory warnings (e.g. packetBudgetTokens exceeded) — declared in
    // the packet itself, never silent. Populated after tokenEstimate.
    warnings: [],
    // Structural index freshness: stat-only rescan, never reads contents.
    // stale:true tells the agent to run `structure scan` before relying on
    // cached structure instead of re-analyzing the tree itself.
    // noStructure opts out of the live rescan entirely (stored-index view
    // only, checked:false); structureDebounceMs opts into a time-window
    // cache so repeated session starts skip the O(n) stat walk.
    structure: (() => {
      try {
        if (noStructure) return storedStructureStatus(ctx);
        return structureStatus(ctx, { debounceMs: structureDebounceMs });
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
  // per-section costs over the assembled packet plus two packet figures.
  // userContext is measured on the returned content — post 32 KiB cap —
  // and flagged when that content only covers a truncated file. Advisory
  // and degradable like the rest: a failure yields null, not an abort.
  //
  // `total` keeps its historical contract: the estimate of the packet
  // WITHOUT the tokenEstimate block (declared via excludesSelf). `wire`
  // is the honest self-inclusive figure — the serialized packet including
  // the block itself. The figure lives inside the block it measures, so
  // it is iterated to a fixed point: digit-width changes stabilize in a
  // few passes, after which wire === estimateJson(packet) exactly.
  try {
    const { loadLimits } = await import('./policy.mjs');
    const budget = loadLimits().packetBudgetTokens;
    // Two passes: when the wire figure exceeds the advisory budget a
    // warning is pushed and the block is recomputed once so the declared
    // figures already include the warning's own bytes.
    for (let pass = 0; pass < 2; pass++) {
      delete packet.tokenEstimate;
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
        excludesSelf: true,
        total: estimateJson(packet).estimatedTokens,
        wire: null,
        sections,
      };
      let prev = null;
      for (let i = 0; i < 8; i++) {
        const m = estimateJson(packet);
        if (prev !== null && m.estimatedTokens === prev.estimatedTokens
            && m.bytes === prev.bytes) break;
        prev = m;
        packet.tokenEstimate.wire = m;
      }
      const exceeded = Number.isInteger(budget) && budget > 0
        && packet.tokenEstimate.wire.estimatedTokens > budget;
      if (!exceeded || pass === 1 || packet.warnings.length > 0) break;
      packet.warnings.push(
        `context packet is ~${packet.tokenEstimate.wire.estimatedTokens} `
          + `estTok (estimator ${TOKEN_ESTIMATOR}), over advisory `
          + `packetBudgetTokens=${budget}`);
    }
  } catch {
    packet.tokenEstimate = null;
  }
  return packet;
}
