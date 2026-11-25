// SPDX-License-Identifier: Apache-2.0
// Deterministic eval-replay harness: a fixture declares cases that
// compile a real packet (context | workflow) and evaluate declarative
// expectations over the output. `eval replay` reports per-case
// satisfied counts; --baseline diffs against a previous replay output
// and emits a per-case + overall verdict better|worse|same — the
// regression floor for rule/catalog changes. The stochastic LLM judge
// stays external (eval/llm-judge); nothing here writes or calls out.
// Replay forces noVantadb+noStructure on context compiles and drops
// SCOPEGRAIN_TASK while evaluating — the deterministic floor does not
// admit service calls, cache writes or ambient task state.

import { err } from './errors.mjs';

const FIXTURE_KEYS = new Set(['schemaVersion', 'id', 'cases']);
const CASE_KEYS = new Set(['id', 'compile', 'expect']);
const COMPILE_KEYS = new Set(['kind', 'opts']);
const EXPECT_KEYS = new Set(['path', 'op', 'value']);
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const OPS = new Set(['exists', 'eq', 'contains', 'regex', 'gte', 'lte']);
const REGEX_PATTERN_MAX = 200;
const COMPILE_KINDS = new Set(['context', 'workflow']);
// Context compile opts are deliberately narrow: anything that could
// call out (VantaDB), write (structure-status cache debounce) or
// vary with wall time (timeoutMs) is out of the deterministic floor —
// replay forces noVantadb+noStructure instead. fields/compact shape
// CLI output, not the compiled packet, so they are not compile opts.
const CONTEXT_OPT_TYPES = { tail: 'number', explain: 'boolean' };
const WORKFLOW_OPT_TYPES = {
  command: 'string', mode: 'string', taskId: 'string', host: 'string',
  profile: 'string', interaction: 'string', arguments: 'string',
  script: 'string', lazy: 'boolean',
};

function label_(i) { return `eval fixture.cases[${i}]`; }

function validateOpts(opts, types, label) {
  if (opts === undefined) return {};
  if (opts === null || typeof opts !== 'object' || Array.isArray(opts)) {
    throw err('EVAL_MALFORMED', `${label}.opts must be an object`);
  }
  for (const [k, v] of Object.entries(opts)) {
    if (!Object.hasOwn(types, k)) {
      throw err('EVAL_MALFORMED', `${label}.opts has unknown key '${k}'`);
    }
    if (typeof v !== types[k]
        || (types[k] === 'number'
            && (!Number.isFinite(v) || v < 0))) {
      throw err('EVAL_MALFORMED',
        `${label}.opts.${k} must be ${types[k]}`);
    }
  }
  return { ...opts };
}

function validateFixture(fixture) {
  if (fixture === null || typeof fixture !== 'object'
      || Array.isArray(fixture)) {
    throw err('EVAL_MALFORMED', 'eval fixture must be an object');
  }
  for (const k of Object.keys(fixture)) {
    if (!FIXTURE_KEYS.has(k)) {
      throw err('EVAL_MALFORMED', `eval fixture has unknown key '${k}'`);
    }
  }
  if (fixture.schemaVersion !== 1
      || typeof fixture.id !== 'string' || !ID_RE.test(fixture.id)
      || !Array.isArray(fixture.cases) || fixture.cases.length === 0) {
    throw err('EVAL_MALFORMED',
      'eval fixture requires {schemaVersion:1, id:slug, cases:[..]}');
  }
  const seen = new Set();
  return fixture.cases.map((c, i) => {
    const label = label_(i);
    if (c === null || typeof c !== 'object' || Array.isArray(c)) {
      throw err('EVAL_MALFORMED', `${label} must be an object`);
    }
    for (const k of Object.keys(c)) {
      if (!CASE_KEYS.has(k)) {
        throw err('EVAL_MALFORMED', `${label} has unknown key '${k}'`);
      }
    }
    if (typeof c.id !== 'string' || !ID_RE.test(c.id) || seen.has(c.id)) {
      throw err('EVAL_MALFORMED', `${label}.id must be a unique slug`);
    }
    seen.add(c.id);
    const comp = c.compile;
    if (comp === null || typeof comp !== 'object' || Array.isArray(comp)
        || !COMPILE_KINDS.has(comp.kind)) {
      throw err('EVAL_MALFORMED',
        `${label}.compile requires kind context|workflow`);
    }
    for (const k of Object.keys(comp)) {
      if (!COMPILE_KEYS.has(k)) {
        throw err('EVAL_MALFORMED', `${label}.compile unknown key '${k}'`);
      }
    }
    const opts = comp.kind === 'context'
      ? validateOpts(comp.opts, CONTEXT_OPT_TYPES, `${label}.compile`)
      : validateOpts(comp.opts, WORKFLOW_OPT_TYPES, `${label}.compile`);
    if (comp.kind === 'workflow' && typeof opts.command !== 'string') {
      throw err('EVAL_MALFORMED',
        `${label}.compile.opts.command is required for workflow`);
    }
    if (!Array.isArray(c.expect) || c.expect.length === 0) {
      throw err('EVAL_MALFORMED', `${label}.expect must be non-empty`);
    }
    const expect = c.expect.map((e, j) => {
      const el = `${label}.expect[${j}]`;
      if (e === null || typeof e !== 'object' || Array.isArray(e)
          || typeof e.path !== 'string' || e.path === ''
          || !OPS.has(e.op)) {
        throw err('EVAL_MALFORMED',
          `${el} requires {path, op: ${[...OPS].join('|')}}`);
      }
      for (const k of Object.keys(e)) {
        if (!EXPECT_KEYS.has(k)) {
          throw err('EVAL_MALFORMED', `${el} has unknown key '${k}'`);
        }
      }
      if (e.op !== 'exists' && e.value === undefined) {
        throw err('EVAL_MALFORMED', `${el} requires value for '${e.op}'`);
      }
      if ((e.op === 'gte' || e.op === 'lte')
          && (typeof e.value !== 'number' || !Number.isFinite(e.value))) {
        throw err('EVAL_MALFORMED',
          `${el}.value must be a finite number for '${e.op}'`);
      }
      let re;
      if (e.op === 'regex') {
        // Patterns are untrusted input: bounded length and compiled at
        // validation so a bad pattern is EVAL_MALFORMED, never a crash
        // mid-replay. In-process regex has no timeout — the length cap
        // plus owner-authored fixtures is the accepted bound.
        if (typeof e.value !== 'string'
            || e.value.length > REGEX_PATTERN_MAX) {
          throw err('EVAL_MALFORMED',
            `${el}.value must be a pattern (<= ${REGEX_PATTERN_MAX} chars)`);
        }
        try {
          re = new RegExp(e.value);
        } catch {
          throw err('EVAL_MALFORMED',
            `${el}.value is not a valid regex pattern`);
        }
      }
      return { path: e.path, op: e.op, value: e.value, re };
    });
    return { id: c.id, kind: comp.kind, opts, expect };
  });
}

// Dot-path resolver: numeric segments index arrays, anything else
// keys objects. Missing or type-mismatched hops report found:false —
// expectations on absent paths fail honestly, never throw.
function getPath(root, pathStr) {
  let cur = root;
  for (const seg of pathStr.split('.')) {
    if (cur === null || typeof cur !== 'object') {
      return { found: false, value: undefined };
    }
    const key = Array.isArray(cur) && /^\d+$/.test(seg)
      ? Number(seg) : seg;
    // Own properties only — inherited names (__proto__, constructor)
    // are not packet data.
    if (!Object.hasOwn(cur, key)) {
      return { found: false, value: undefined };
    }
    cur = cur[key];
  }
  return { found: true, value: cur };
}

function check(expect, output) {
  const { found, value } = getPath(output, expect.path);
  switch (expect.op) {
    case 'exists': return found;
    case 'eq': {
      return found
        && JSON.stringify(value) === JSON.stringify(expect.value);
    }
    case 'contains': {
      if (!found) return false;
      // String membership requires a string needle — no silent
      // coercion ('abc5'.includes(5) would coerce and pass).
      if (typeof value === 'string') {
        return typeof expect.value === 'string'
          && value.includes(expect.value);
      }
      if (Array.isArray(value)) {
        return value.some((v) =>
          JSON.stringify(v) === JSON.stringify(expect.value));
      }
      return false;
    }
    case 'regex': {
      if (!found || typeof value !== 'string') return false;
      return expect.re.test(value);
    }
    case 'gte': return found && typeof value === 'number'
      && Number.isFinite(value) && value >= expect.value;
    case 'lte': return found && typeof value === 'number'
      && Number.isFinite(value) && value <= expect.value;
    default: return false;
  }
}

async function compileCase(ctx, c) {
  if (c.kind === 'context') {
    const { assembleContextPacket } = await import('./context-packet.mjs');
    // Forced exclusions: the replay floor never calls VantaDB and never
    // touches the structure-status cache (write + wall-time dependent).
    return assembleContextPacket(ctx,
      { ...c.opts, noVantadb: true, noStructure: true });
  }
  const { buildWorkflowPacket } = await import('./workflows.mjs');
  return buildWorkflowPacket(ctx, c.opts);
}

// Per-case verdict vs a baseline replay output: satisfied counts
// compared case-by-case. A case absent in the baseline is `new`
// (not a regression); a case absent in the replay output is `dropped`
// and counts against the overall verdict.
export function compareReplay(baseline, replay) {
  // Strict shape: a baseline must be a prior replay output, not just
  // any {schemaVersion:1, cases:[..]} JSON — passing the fixture itself
  // would silently compare against `undefined` counts and report
  // 'same' over a corrupt baseline.
  if (baseline === null || typeof baseline !== 'object'
      || baseline.schemaVersion !== 1
      || baseline.kind !== 'eval-replay'
      || !Array.isArray(baseline.cases)) {
    throw err('EVAL_MALFORMED',
      'baseline must be a prior eval replay output');
  }
  for (const [i, c] of baseline.cases.entries()) {
    if (c === null || typeof c !== 'object'
        || typeof c.id !== 'string'
        || typeof c.satisfied !== 'number'
        || !Number.isFinite(c.satisfied)) {
      throw err('EVAL_MALFORMED',
        `baseline.cases[${i}] requires {id:string, satisfied:number}`);
    }
  }
  if (replay === null || typeof replay !== 'object'
      || !Array.isArray(replay.cases)) {
    throw err('EVAL_MALFORMED', 'replay must carry a cases array');
  }
  const before = new Map(
    baseline.cases.map((c) => [c.id, c]));
  const items = replay.cases.map((c) => {
    const b = before.get(c.id);
    before.delete(c.id);
    if (b === undefined) {
      return { id: c.id, verdict: 'new',
        before: null, after: c.satisfied };
    }
    const verdict = c.satisfied > b.satisfied ? 'better'
      : c.satisfied < b.satisfied ? 'worse' : 'same';
    return { id: c.id, verdict,
      before: b.satisfied, after: c.satisfied };
  });
  for (const [id, b] of before) {
    items.push({ id, verdict: 'dropped',
      before: b.satisfied, after: null });
  }
  const count = (v) => items.filter((i) => i.verdict === v).length;
  const worse = count('worse') + count('dropped');
  const better = count('better');
  const overall = worse > 0 ? 'worse' : better > 0 ? 'better' : 'same';
  return { cases: items, summary: {
    better, worse: count('worse'), same: count('same'),
    new: count('new'), dropped: count('dropped') }, overall };
}

export async function replayEval(ctx, fixture, { baseline } = {}) {
  const cases = validateFixture(fixture);
  const results = [];
  // Ambient active-task state must not leak into compiled packets —
  // the pre-existing tests/eval harness sanitizes the environment the
  // same way. Restored even on failure. Mutating process.env is safe
  // for the single-shot CLI; concurrent in-process replays (embedders)
  // would interleave the drop — serialize them if that ever matters.
  const savedTask = process.env.SCOPEGRAIN_TASK;
  delete process.env.SCOPEGRAIN_TASK;
  try {
    for (const c of cases) {
      let output;
      try {
        output = await compileCase(ctx, c);
      } catch (e) {
        // A compile failure is a reported case error — 0 satisfied,
        // not a hidden crash.
        results.push({ id: c.id, kind: c.kind,
          error: e.code ?? 'error',
          satisfied: 0, total: c.expect.length, failures: [] });
        continue;
      }
      try {
        const failures = [];
        for (const e of c.expect) {
          if (!check(e, output)) {
            const { found, value } = getPath(output, e.path);
            failures.push({ path: e.path, op: e.op,
              expected: e.value ?? null,
              actual: found ? value : null, found });
          }
        }
        results.push({ id: c.id, kind: c.kind,
          satisfied: c.expect.length - failures.length,
          total: c.expect.length, failures });
      } catch (e) {
        // An evaluation fault is likewise contained per case — one
        // bad expectation never discards the rest of the replay.
        results.push({ id: c.id, kind: c.kind,
          error: e.code ?? 'error',
          satisfied: 0, total: c.expect.length, failures: [] });
      }
    }
  } finally {
    if (savedTask === undefined) {
      delete process.env.SCOPEGRAIN_TASK;
    } else {
      process.env.SCOPEGRAIN_TASK = savedTask;
    }
  }
  const replay = {
    schemaVersion: 1, kind: 'eval-replay',
    fixture: { id: fixture.id, cases: cases.length },
    cases: results,
    summary: {
      satisfied: results.reduce((a, r) => a + r.satisfied, 0),
      total: results.reduce((a, r) => a + r.total, 0),
      errors: results.filter((r) => r.error !== undefined).length,
    },
  };
  if (baseline !== undefined) {
    replay.comparison = compareReplay(baseline, replay);
  }
  return replay;
}
