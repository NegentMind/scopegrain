// SPDX-License-Identifier: Apache-2.0
// Automatic context rehydration: wires the verified VantaDB read path
// (memory_search over the project's own l1/sg-<projectHash> namespace;
// memory_context over the sg-formal-v1-* namespaces) into session-start
// and session-resume flows. Both helpers are degradable and never throw:
// an unenrolled project fails closed with { enrolled: false } and any
// runtime failure degrades to an explicit error marker so the host
// packet survives a dead or slow backend.
//
// Why memory_search and not memory_recall: the engine's recall
// enumerates EVERY l1/* namespace and only filters on
// agent_id/team_id — values scopegrain pins to 'default' — so the
// recall pool is machine-global and would inject other projects'
// memories into this session's packet. memory_search addressed at the
// project-derived namespace is still cross-session (records persist in
// shared storage) but cannot surface another project's records.

import {
  loadVantaDBConfig, callVantaDBTool, vantaDBContext, projectL1Namespace,
  requireVantaDBConfig,
} from './vantadb-runtime.mjs';
import { getWorkspace } from '../core/workspaces.mjs';
import { estimateTokens } from '../core/tokens.mjs';

// Bounded defaults: session-start packets must stay fast even when the
// backend takes the full timeout. Callers may override with their own
// bound; nothing here spawns more than one stdio session per call.
export const REHYDRATE_TIMEOUT_MS = 15000;
export const REHYDRATE_RECALL_TOP_K = 5;
export const REHYDRATE_RECORD_TOP_K = 10;
const PREPEND_CAP_CHARS = 8 * 1024;
const MAX_HIT_CONTENT_CHARS = 512;

function marker(e) {
  return { code: e?.code ?? 'INTERNAL', message: String(e?.message ?? e) };
}

// A memory_search hit carries {record:{key,payload,...}, score} on the
// real engine and a flatter {key,payload,score} on the fixture; the
// payload is the serialized L1 MemoryRecord, so `content`/`type` live
// one level down. Untyped shapes degrade to the raw payload as content.
function hitContent(hit) {
  const record = hit?.record ?? hit;
  const payload = typeof record?.payload === 'string' ? record.payload : '';
  let content = payload;
  let type = null;
  try {
    const parsed = JSON.parse(payload);
    if (typeof parsed?.content === 'string') content = parsed.content;
    if (typeof parsed?.type === 'string') type = parsed.type;
  } catch { /* raw payload stays as content */ }
  return {
    key: typeof record?.key === 'string' ? record.key : null,
    content: content.slice(0, MAX_HIT_CONTENT_CHARS),
    score: typeof hit?.score === 'number' ? hit.score : null,
    type,
  };
}

// Project-scoped recall result: the recalled entries plus a locally
// built prepend_context (the engine's own prepend block never leaves
// the server because memory_search does not produce one — building it
// here keeps the packet contract AND the project boundary). Absent or
// empty hits yield prepend_context:null and no estimate field.
function scopedRecall(namespace, res) {
  const sc = res?.structuredContent;
  if (sc === null || typeof sc !== 'object' || Array.isArray(sc)) {
    return null;
  }
  const hits = Array.isArray(sc.hits) ? sc.hits : [];
  const recalled = hits.map(hitContent);
  const prepend = recalled.map((r) => r.content).filter(Boolean).join('\n');
  const out = {
    tool: 'memory_search',
    pool: 'project',
    namespace,
    recalled,
    prepend_context: prepend.length > 0 ? prepend.slice(0, PREPEND_CAP_CHARS) : null,
    truncated: sc.truncated === true || prepend.length > PREPEND_CAP_CHARS,
    abstained: sc.abstained === true,
    abstention_reason: sc.abstention_reason ?? null,
  };
  if (typeof out.prepend_context === 'string') {
    out.prependContextEstimate = estimateTokens(out.prepend_context);
  }
  return out;
}

// Project-level rehydration for the session-start `context` packet:
// one bounded memory_search over the project's own l1/sg-<projectHash>
// namespace — cross-session recall that can never surface another
// project's records. The namespace derives from the workspace identity
// (getWorkspace), not from ambient state; a project with no workspace
// degrades to the error marker before any spawn.
export async function projectRehydration({ ctx, query, topK, timeoutMs,
  spawnImpl }) {
  let cfg;
  try {
    cfg = loadVantaDBConfig(ctx);
  } catch (e) {
    return { enrolled: true, recall: null, error: marker(e) };
  }
  if (cfg === null) return { enrolled: false, recall: null };
  try {
    const namespace = projectL1Namespace(getWorkspace(ctx));
    const res = await callVantaDBTool({
      cfg, name: 'memory_search',
      arguments: {
        namespace,
        text_query: typeof query === 'string' && query.length > 0
          ? query.slice(0, 512) : 'scopegrain',
        top_k: topK ?? REHYDRATE_RECALL_TOP_K,
      },
      timeoutMs: timeoutMs ?? REHYDRATE_TIMEOUT_MS, spawnImpl,
    });
    return { enrolled: true, recall: scopedRecall(namespace, res) };
  } catch (e) {
    return { enrolled: true, recall: null, error: marker(e) };
  }
}

// Explicit recall (`vantadb recall` / scopegrain_memory_recall) with the
// project default: without an explicit `scope` the query searches the
// project's own l1/sg-<projectHash> namespace — the memory_recall agent
// pool is machine-global and would surface other projects' memories.
// scope=session|agent|team remains an opt-in passthrough to the engine.
// Unlike projectRehydration this fails LOUD: a dead backend on an
// operator-driven recall is an error, not a degraded packet field.
export async function projectScopedRecall({ ctx, query, topK, timeoutMs,
  spawnImpl }) {
  const namespace = projectL1Namespace(getWorkspace(ctx));
  const res = await callVantaDBTool({
    cfg: requireVantaDBConfig(ctx), name: 'memory_search',
    arguments: {
      namespace,
      text_query: typeof query === 'string' && query.length > 0
        ? query.slice(0, 512) : 'scopegrain',
      top_k: topK ?? REHYDRATE_RECALL_TOP_K,
    },
    timeoutMs, spawnImpl,
  });
  return scopedRecall(namespace, res);
}

// Record-level rehydration for `session resume`: scans every projected
// sg-formal-v1-* namespace for journal events naming the record. The
// result of vantaDBContext is already bounded (namespaces capped,
// hits per namespace capped, warnings surfaced).
export async function recordRehydration({ ctx, recordId, topK, timeoutMs,
  spawnImpl }) {
  let cfg;
  try {
    cfg = loadVantaDBConfig(ctx);
  } catch (e) {
    return { enrolled: true, context: null, error: marker(e) };
  }
  if (cfg === null) return { enrolled: false, context: null };
  try {
    const context = await vantaDBContext({
      cfg, recordId, topK: topK ?? REHYDRATE_RECORD_TOP_K,
      timeoutMs: timeoutMs ?? REHYDRATE_TIMEOUT_MS, spawnImpl,
    });
    return { enrolled: true, context };
  } catch (e) {
    return { enrolled: true, context: null, error: marker(e) };
  }
}
