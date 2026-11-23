// SPDX-License-Identifier: Apache-2.0
// Suggestive task-type -> capability heuristic. Pure read path: scores
// catalog skill metadata against the task record and reports ranked
// candidates with declared reasons. It NEVER writes to the task record
// and NEVER injects into packet skill buckets — declaration stays
// explicit through task.skills, exactly like command-declared deps.
import { err } from './errors.mjs';
import { loadWorkspaceCatalog } from './catalog.mjs';

const STOP = new Set([
  'the', 'a', 'an', 'of', 'for', 'and', 'to', 'in', 'on', 'with', 'is',
  'are', 'or', 'when', 'that', 'this', 'it', 'as', 'be', 'by', 'at',
  'must', 'should', 'from', 'into', 'not', 'no', 'if', 'then', 'its',
]);
const toks = (s) => new Set(String(s ?? '').toLowerCase()
  .split(/[^a-z0-9]+/)
  .filter((t) => t !== '' && !STOP.has(t)));

// Closed type -> signal-token map. Only the seven TASK_TYPES values
// tasks.mjs validates can appear; an unknown or null type contributes
// no signal rather than guessing.
const TYPE_SIGNALS = {
  bug: ['debug', 'debugging', 'fix', 'error', 'recovery', 'systematic'],
  feature: ['plan', 'planning', 'spec', 'tdd', 'test', 'incremental',
    'implementation'],
  refactor: ['refactor', 'simplification', 'simplify', 'dedup', 'review',
    'cleanup'],
  research: ['research', 'investigate', 'web', 'search', 'discernment',
    'doubt', 'ambiguity'],
  docs: ['documentation', 'docs', 'adr', 'adr', 'writing', 'handoff',
    'release', 'notes'],
  ops: ['ci', 'automation', 'shipping', 'release', 'launch', 'deploy',
    'verify', 'verification'],
  mixed: [],
};
// Scope path segments that carry a capability signal.
const SCOPE_SIGNALS = {
  test: ['test', 'tdd'],
  tests: ['test', 'tdd'],
  spec: ['spec', 'planning'],
  specs: ['spec', 'planning'],
  docs: ['documentation', 'docs', 'writing'],
  migrations: ['deprecation', 'migration'],
  '.github': ['ci', 'automation'],
};

// Deterministic ranking over catalog skill metadata. Every point is
// declared in `reasons` so a suggestion stays auditable — never an
// opaque model guess. Already-declared task.skills are excluded from
// candidates and echoed under `declared` for the caller's trace.
export function suggestCapabilities(ctx, task, { limit = 5 } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw err('INVALID_ARGS', 'limit must be an integer in [1,50]');
  }
  const catalog = loadWorkspaceCatalog(ctx, { verifyResources: false });
  const declared = Array.isArray(task.skills) ? [...task.skills] : [];
  const declaredSet = new Set(declared.map((s) => s.toLowerCase()));

  const titleToks = toks(task.title);
  const contractToks = toks(task.contract);
  const authorToks = toks(task.authorContext);
  const typeSignals = new Set(TYPE_SIGNALS[task.type] ?? []);
  const scopeSignals = new Set();
  const scopeSegs = new Set();
  for (const p of Array.isArray(task.scope) ? task.scope : []) {
    for (const seg of String(p).split('/')) {
      const s = seg.toLowerCase();
      if (s === '') continue;
      scopeSegs.add(s);
      for (const sig of SCOPE_SIGNALS[s] ?? []) scopeSignals.add(sig);
    }
  }

  const out = [];
  for (const e of catalog.entries) {
    if (e.kind !== 'skill') continue;
    if (declaredSet.has(e.id.toLowerCase())) continue;
    let score = 0;
    const reasons = [];
    const idToks = toks(e.id);
    const body = new Set([...idToks, ...toks(e.description)]);
    if (task.type && TYPE_SIGNALS[task.type]) {
      const hit = [...typeSignals].filter((t) => body.has(t));
      if (hit.length) {
        score += hit.length * 3;
        reasons.push(`type:${task.type}~${hit.join(',')}`);
      }
    }
    const sh = [...titleToks].filter((t) => body.has(t));
    if (sh.length) { score += sh.length * 2; reasons.push(`title:${sh.join(',')}`); }
    const sc = [...contractToks].filter((t) => body.has(t));
    if (sc.length) { score += sc.length; reasons.push(`contract:${sc.join(',')}`); }
    const sa = [...authorToks].filter((t) => body.has(t));
    if (sa.length) { score += sa.length; reasons.push(`context:${sa.join(',')}`); }
    const ss = [...scopeSignals].filter((t) => body.has(t));
    if (ss.length) { score += ss.length * 2; reasons.push(`scope:${ss.join(',')}`); }
    if (score > 0) out.push({ kind: e.kind, id: e.id, score, reasons });
  }
  out.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return {
    taskId: task.id,
    type: task.type ?? null,
    declared,
    suggestions: out.slice(0, limit),
    note: 'suggestive only — nothing was injected; declare via task.skills'
      + ' (task meta) to route a suggestion into packets',
  };
}
