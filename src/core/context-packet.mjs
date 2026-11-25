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

const CONTEXT_MD_MAX = 32 * 1024;
const SESSION_CAP = 3;

// opts: { tail?: number, timeoutMs?: number, noVantadb?: boolean,
//   noStructure?: boolean, structureDebounceMs?: number,
//   explain?: boolean, fields?: string, compact?: boolean }
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
  const { terminalStates } = await import('./policy.mjs');
  const { structureStatus, storedStructureStatus } =
    await import('../discovery/structure.mjs');
  const workspace = getWorkspace(ctx);
  const { tasks } = listTasks(ctx);
  const byState = {};
  for (const t of tasks) byState[t.state] = (byState[t.state] ?? 0) + 1;
  const terminal = new Set(terminalStates());
  const open = tasks.filter((t) => !terminal.has(t.state));
  const tail = opts.tail ?? 5;
  let pendingJournal = 0;
  try {
    const bound = bindWorkspace(ctx,
      { areaIds: workspace.areas.map((a) => a.id) });
    pendingJournal = countJournalPending(bound);
  } catch { /* journal absent or unreadable — surface as 0 */ }
  // User-owned session-start knowledge: .scopegrain/context.md, bounded.
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
      .slice(0, SESSION_CAP)
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
        // V1 records omit disposition entirely — absent == not disposed.
        (t) => t.state === 'PLAN' && t.disposition == null)
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
    // Automatic project-level rehydration: one bounded memory_search
    // over the project's own l1/sg-<projectHash> namespace when a
    // VantaDB backend is enrolled — project-scoped, never the global
    // L1 recall pool. Degradable like the rest of the packet.
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
  if (opts.explain === true) {
    packet.explain = explainPacket(ctx, packet, opts);
  }
  return packet;
}

// X-ray layer (opt-in via opts.explain): per-section provenance of the
// assembled packet — where each section's data came from, the selection
// rule that included it and what degraded or was skipped by flags.
// Pure projection over the packet plus declared opts; it runs after
// tokenEstimate, so the estimate figures never cover this block.
// Unknown future keys degrade to a generic entry rather than going
// undocumented.
function explainPacket(ctx, packet, opts) {
  const sections = {};
  const push = (k, source, basis, notes = []) => {
    sections[k] = {
      source, basis,
      estimatedTokens:
        packet.tokenEstimate?.sections?.[k]?.estimatedTokens ?? null,
      ...(notes.length ? { notes } : {}),
    };
  };
  const memory = ctx.config.paths.memory;
  const state = ctx.config.paths.state;
  const tail = opts.tail ?? 5;
  for (const k of Object.keys(packet)) {
    if (k === 'explain') continue;
    switch (k) {
      case 'schemaVersion':
        push(k, 'packet contract', 'shape marker'); break;
      case 'generatedAt':
        push(k, 'runtime clock', 'assembly timestamp'); break;
      case 'instructions':
        push(k, packet.instructions,
          'pointer to the project instructions file'); break;
      case 'config':
        push(k, packet.config, 'pointer to the project config'); break;
      case 'methodology':
        push(k, 'config.methodology', 'workflow mode'); break;
      case 'intake':
        push(k, 'config.intake', 'request intake mode'); break;
      case 'locale':
        push(k, 'config.locale', 'operational-artifact language'); break;
      case 'userContext': {
        const notes = [];
        if (packet.userContext === null) {
          notes.push('file absent or unreadable — null');
        } else if (packet.userContext.truncated === true) {
          notes.push(`content truncated at the ${CONTEXT_MD_MAX / 1024} KiB cap`);
        }
        push(k, configRel(ctx, 'context.md'),
          `owner session knowledge, bounded ${CONTEXT_MD_MAX / 1024} KiB`,
          notes);
        break;
      }
      case 'sessions':
        push(k, `${state}/sessions`,
          `${packet.sessions.length} most recent by updatedAt `
            + `(cap ${SESSION_CAP})`);
        break;
      case 'project':
        push(k, 'project.root', 'project identity'); break;
      case 'workspace':
        push(k, `${state}/workspace.json`,
          `${packet.workspace.areas} area(s), revision `
            + `${packet.workspace.revision}`);
        break;
      case 'activeTask': {
        const notes = [];
        if (packet.activeTask?.error) {
          notes.push(`dangling pointer: ${packet.activeTask.error.code}`);
        } else if (packet.activeTask === null) {
          notes.push('no active task pointer');
        }
        push(k, 'env SCOPEGRAIN_TASK or <configDir>/active-task',
          'active task pointer', notes);
        break;
      }
      case 'tasks':
        push(k, ctx.config.paths.tasks,
          'ready = state PLAN && disposition == null '
            + `(${packet.tasks.ready.length} ready)`);
        break;
      case 'progress':
        push(k, `${memory}/progress.jsonl`, `tail ${tail}`,
          packet.progress.error
            ? [`read error: ${packet.progress.error.code}`] : []);
        break;
      case 'activity':
        push(k, `${memory}/activity.jsonl`, `tail ${tail}`,
          packet.activity.error
            ? [`read error: ${packet.activity.error.code}`] : []);
        break;
      case 'goals':
        push(k, `${memory}/goals.jsonl`, 'status == open',
          packet.goals.length === 0 ? ['no open goals'] : []);
        break;
      case 'pendingJournalOperations':
        push(k, 'journal outbox', 'pending operations count'); break;
      case 'warnings':
        push(k, 'assembly', 'advisory warnings emitted this packet',
          packet.warnings.length === 0 ? ['none'] : []);
        break;
      case 'structure': {
        const notes = [];
        if (opts.noStructure === true) {
          notes.push('--no-structure: stored-index view, no live rescan');
        } else if (opts.structureDebounceMs !== undefined) {
          notes.push(`debounce window ${opts.structureDebounceMs} ms`);
        }
        if (packet.structure?.stale === true) {
          notes.push('index stale — run structure refresh');
        }
        push(k, `${state}/cache/structure-index.json`,
          'structural code index freshness (stat-only)', notes);
        break;
      }
      case 'vantadb': {
        const notes = [];
        if (opts.noVantadb === true) {
          notes.push('excluded by --no-vantadb');
        }
        if (packet.vantadb?.error) {
          notes.push(`rehydration error: ${packet.vantadb.error.code}`);
        }
        if (packet.vantadb?.enrolled === false) {
          notes.push('backend not enrolled');
        }
        push(k, 'src/integrations/vantadb-rehydrate.mjs',
          'project-scoped memory rehydration (optional backend)', notes);
        break;
      }
      case 'tokenEstimate':
        push(k, 'tokens.mjs estimator',
          'per-section and wire figures; excludes the explain block',
          packet.tokenEstimate === null
            ? ['estimation unavailable — degraded packet'] : []);
        break;
      default:
        push(k, 'packet', 'section without registered provenance');
    }
  }
  const explain = {
    schemaVersion: 1,
    estimator: TOKEN_ESTIMATOR,
    note: 'debug provenance layer; tokenEstimate figures exclude '
      + 'this block',
    flags: {
      tail,
      timeoutMs: opts.timeoutMs ?? null,
      noVantadb: opts.noVantadb === true,
      noStructure: opts.noStructure === true,
      structureDebounceMs: opts.structureDebounceMs ?? null,
      fields: opts.fields ?? null,
      compact: opts.compact === true,
    },
    sections,
  };
  // --fields projects top-level keys downstream of assembly; the layer
  // reports the requested set, which names actually exist and which the
  // projection will silently drop (typo surface).
  if (typeof opts.fields === 'string') {
    const requested = opts.fields.split(',')
      .map((s) => s.trim()).filter(Boolean);
    explain.projection = {
      appliedAfter: 'assembly',
      requested,
      matched: requested.filter((k) => Object.hasOwn(packet, k)
        || k === 'explain'),
      unknown: requested.filter((k) => !Object.hasOwn(packet, k)
        && k !== 'explain'),
    };
  }
  return explain;
}
