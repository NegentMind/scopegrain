// SPDX-License-Identifier: Apache-2.0
// Automatic context rehydration: wires the verified VantaDB read path
// (memory_recall over distilled L1 memories; memory_context over the
// sg-formal-v1-* namespaces) into session-start and session-resume
// flows. Both helpers are degradable and never throw: an unenrolled
// project fails closed with { enrolled: false } and any runtime
// failure degrades to an explicit error marker so the host packet
// survives a dead or slow backend.

import {
  loadVantaDBConfig, callVantaDBTool, vantaDBContext,
} from './vantadb-runtime.mjs';
import { estimateTokens } from '../core/tokens.mjs';

// Bounded defaults: session-start packets must stay fast even when the
// backend takes the full timeout. Callers may override with their own
// bound; nothing here spawns more than one stdio session per call.
export const REHYDRATE_TIMEOUT_MS = 15000;
export const REHYDRATE_RECALL_TOP_K = 5;
export const REHYDRATE_RECORD_TOP_K = 10;
const PREPEND_CAP_CHARS = 8 * 1024;

function marker(e) {
  return { code: e?.code ?? 'INTERNAL', message: String(e?.message ?? e) };
}

function boundRecall(res) {
  const sc = res?.structuredContent;
  if (sc === null || typeof sc !== 'object' || Array.isArray(sc)) {
    return null;
  }
  const out = { ...sc };
  if (typeof out.prepend_context === 'string'
      && out.prepend_context.length > PREPEND_CAP_CHARS) {
    out.prepend_context = out.prepend_context.slice(0, PREPEND_CAP_CHARS);
    out.prependContextTruncated = true;
  }
  // Local estimate over the post-cap prepend_context — heuristic, never
  // the host tokenizer. Absent/non-string fields simply carry no estimate.
  if (typeof out.prepend_context === 'string') {
    out.prependContextEstimate = estimateTokens(out.prepend_context);
  }
  return out;
}

// Project-level rehydration for the session-start `context` packet:
// one bounded memory_recall over the distilled L1 pool (agent scope).
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
    const res = await callVantaDBTool({
      cfg, name: 'memory_recall',
      arguments: {
        query: typeof query === 'string' && query.length > 0
          ? query.slice(0, 512) : 'scopegrain',
        scope: 'agent',
        top_k: topK ?? REHYDRATE_RECALL_TOP_K,
      },
      timeoutMs: timeoutMs ?? REHYDRATE_TIMEOUT_MS, spawnImpl,
    });
    return { enrolled: true, recall: boundRecall(res) };
  } catch (e) {
    return { enrolled: true, recall: null, error: marker(e) };
  }
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
