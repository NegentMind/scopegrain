// SPDX-License-Identifier: Apache-2.0
// Declarative scenario driver: executes scenario steps against a fresh
// temporary project root, either by spawning the real bin/scopegrain.mjs
// as a child process or by importing run() in-process for parity.
//
// Scenario step contract (see scenarios/*.json and README.md):
//   {
//     "cmd": ["task", "create", "--project", "@root", ...],   argv array
//     "expectExit": 0,                     default 0
//     "expectEnvelope": { ... },           deep subset of stdout JSON
//     "expectError": { "error": {...} },   deep subset of stderr JSON
//     "expectState": {                     persisted-state assertions
//       "exists": ["rel/path", ...],
//       "notExists": ["rel/path", ...],
//       "json": [{ "path": "rel", "subset": {...} }]
//     },
//     "save": { "name": "dot.path" }       extract from stdout JSON
//   }
// Placeholders: "@root" -> temp project root, "${name}" -> saved vars.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  hashStateTree, normalizeString, rootForms, stepEnvelope,
} from './normalize.mjs';

export const EVAL_ROOT = fileURLToPath(new URL('../', import.meta.url));
export const REPO_ROOT = path.resolve(EVAL_ROOT, '..', '..');
export const BIN = path.join(REPO_ROOT, 'bin', 'scopegrain.mjs');
export const SCENARIOS_DIR = path.join(EVAL_ROOT, 'scenarios');
export const FIXTURES_DIR = path.join(EVAL_ROOT, 'fixtures');
const TMP_ROOT = path.join(EVAL_ROOT, '.tmp');

const DEFAULT_TIMEOUT_MS = 120_000; // doctor validates the full catalog (~25s)

// Children see a scrubbed environment: a developer-exported
// SCOPEGRAIN_*/VANTADB_* variable must never make an eval nondeterministic.
export function cleanEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(SCOPEGRAIN_|VANTADB_)/.test(key)) continue;
    env[key] = value;
  }
  return env;
}

// Runs the real binary in a child process. argv is an array — never a
// shell string — so spaces in the repo path ("VantaDB Proyect") and in
// arguments survive verbatim on Windows.
export function execCli(argv, { cwd, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = execFile(process.execPath, [BIN, ...argv], {
        cwd,
        env: cleanEnv(),
        timeout: timeoutMs,
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
        encoding: 'utf8',
      }, (error, stdout, stderr) => {
        if (error && error.killed) {
          resolve({
            code: null,
            stdout,
            stderr: `${stderr}\n[eval] killed after ${timeoutMs}ms`,
          });
          return;
        }
        resolve({
          code: error ? (Number.isInteger(error.code) ? error.code : 1) : 0,
          stdout,
          stderr,
        });
      });
      child.stdin.end(); // never a TTY: interactive prompts must refuse
    } catch (e) {
      resolve({ code: null, stdout: '', stderr: `[eval] spawn failed: ${e}` });
    }
  });
}

// Same argv through the exported run() with a captured IO — the parity
// mode that verifies the binary wrapper and the library agree.
let cliModule = null;
export async function runInProc(argv) {
  cliModule ??= await import('../../../src/cli.mjs');
  const out = { stdout: [], stderr: [] };
  const io = {
    isTTY: false,
    stdout: (s) => out.stdout.push(s),
    stderr: (s) => out.stderr.push(s),
    ask: async () => {
      throw new Error('eval io: unexpected interactive prompt');
    },
  };
  const scrubbed = {};
  for (const key of Object.keys(process.env)) {
    if (/^(SCOPEGRAIN_|VANTADB_)/.test(key)) {
      scrubbed[key] = process.env[key];
      delete process.env[key];
    }
  }
  let code;
  try {
    code = await cliModule.run(argv, io);
  } finally {
    Object.assign(process.env, scrubbed);
  }
  return { code, stdout: out.stdout.join('\n'), stderr: out.stderr.join('\n') };
}

// "@root" -> project dir, "${name}" -> saved variable.
export function substitute(value, vars, projectRoot) {
  if (typeof value === 'string') {
    return value
      .split('@root').join(projectRoot)
      .replace(/\$\{([A-Za-z_][\w]*)\}/g, (match, name) => {
        if (!Object.hasOwn(vars, name)) {
          throw new Error(`eval: unbound variable '${name}' in '${value}'`);
        }
        return String(vars[name]);
      });
  }
  if (Array.isArray(value)) {
    return value.map((item) => substitute(item, vars, projectRoot));
  }
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = substitute(item, vars, projectRoot);
    }
    return out;
  }
  return value;
}

// Deep-subset match: objects recurse key-wise, arrays must have equal
// length and match element-wise, scalars are strict-equal. An expected
// {"%regex": "..."} matches any actual string against the pattern.
export function matchSubset(actual, expected, at = '$') {
  const diffs = [];
  const walk = (a, e, p) => {
    if (e !== null && typeof e === 'object' && !Array.isArray(e)) {
      if (Object.keys(e).length === 1 && Object.hasOwn(e, '%regex')) {
        if (typeof a !== 'string' || !(new RegExp(e['%regex'])).test(a)) {
          diffs.push(
            `${p}: expected string matching /${e['%regex']}/, `
            + `got ${JSON.stringify(a)}`);
        }
        return;
      }
      if (a === null || typeof a !== 'object' || Array.isArray(a)) {
        diffs.push(`${p}: expected object, got ${JSON.stringify(a)}`);
        return;
      }
      for (const [key, item] of Object.entries(e)) {
        if (!Object.hasOwn(a, key)) {
          diffs.push(`${p}.${key}: missing key`);
          continue;
        }
        walk(a[key], item, `${p}.${key}`);
      }
      return;
    }
    if (Array.isArray(e)) {
      if (!Array.isArray(a) || a.length !== e.length) {
        diffs.push(`${p}: expected array of length ${e.length}, `
          + `got ${JSON.stringify(a)}`);
        return;
      }
      e.forEach((item, i) => walk(a[i], item, `${p}[${i}]`));
      return;
    }
    if (a !== e) {
      diffs.push(`${p}: expected ${JSON.stringify(e)}, `
        + `got ${JSON.stringify(a)}`);
    }
  };
  walk(actual, expected, at);
  return diffs;
}

function getPath(obj, ptr) {
  let cur = obj;
  for (const seg of String(ptr).split('.')) {
    if (cur === null || cur === undefined) return undefined;
    cur = Array.isArray(cur) ? cur[Number(seg)] : cur[seg];
  }
  return cur;
}

function checkState(projectRoot, spec) {
  const failures = [];
  const inside = (rel) => {
    const abs = path.resolve(projectRoot, ...rel.split('/'));
    if (!abs.startsWith(path.resolve(projectRoot) + path.sep) && abs !== path.resolve(projectRoot)) {
      failures.push({ message: `expectState path escapes project: ${rel}` });
      return null;
    }
    return abs;
  };
  for (const rel of spec.exists ?? []) {
    const abs = inside(rel);
    if (abs && !fs.existsSync(abs)) {
      failures.push({ message: `expectState.exists missing: ${rel}` });
    }
  }
  for (const rel of spec.notExists ?? []) {
    const abs = inside(rel);
    if (abs && fs.existsSync(abs)) {
      failures.push({ message: `expectState.notExists present: ${rel}` });
    }
  }
  for (const entry of spec.json ?? []) {
    const abs = inside(entry.path);
    if (!abs) continue;
    if (!fs.existsSync(abs)) {
      failures.push({ message: `expectState.json missing file: ${entry.path}` });
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(abs, 'utf8'));
    } catch (e) {
      failures.push({ message: `expectState.json unreadable ${entry.path}: ${e}` });
      continue;
    }
    for (const d of matchSubset(parsed, entry.subset, entry.path)) {
      failures.push({ message: `expectState.json ${d}` });
    }
  }
  return failures;
}

function checkStep(record, spec, vars, projectRoot) {
  const failures = [];
  const expectedExit = spec.expectExit ?? 0;
  if (record.exit !== expectedExit) {
    failures.push({ message: `exit ${record.exit} !== expected ${expectedExit}; `
      + `stderr: ${String(record.stderr).slice(0, 400)}` });
  }
  if (spec.expectEnvelope !== undefined) {
    if (record.stdoutJson === undefined) {
      failures.push({ message: 'stdout is not JSON: '
        + String(record.stdout).slice(0, 400) });
    } else {
      const expected = substitute(spec.expectEnvelope, vars, projectRoot);
      for (const d of matchSubset(record.stdoutJson, expected)) {
        failures.push({ message: `envelope ${d}` });
      }
    }
  }
  if (spec.expectError !== undefined) {
    if (record.stderrJson === undefined) {
      failures.push({ message: 'stderr is not JSON: '
        + String(record.stderr).slice(0, 400) });
    } else {
      const expected = substitute(spec.expectError, vars, projectRoot);
      for (const d of matchSubset(record.stderrJson, expected, '$.error')) {
        failures.push({ message: `stderr ${d}` });
      }
    }
  }
  if (spec.expectState !== undefined) {
    failures.push(...checkState(
      projectRoot, substitute(spec.expectState, vars, projectRoot)));
  }
  return failures;
}

// Runs every step of a scenario (or a golden fixture, which carries the
// same steps array) inside a fresh temp project. Returns the per-step
// records, collected expectation failures and a cleanup() handle.
export async function runScenario(source, {
  mode = 'process',
  checkExpect = true,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  const base = fs.mkdtempSync(path.join(TMP_ROOT, `${source.name}-`));
  const projectRoot = path.join(base, 'project');
  fs.mkdirSync(projectRoot, { recursive: true });
  for (const [rel, content] of Object.entries(source.setup?.files ?? {})) {
    const abs = path.resolve(projectRoot, ...rel.split('/'));
    if (!abs.startsWith(path.resolve(projectRoot) + path.sep)) {
      throw new Error(`eval: setup file escapes project root: ${rel}`);
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, typeof content === 'string'
      ? content : `${JSON.stringify(content, null, 2)}\n`);
  }
  const vars = {};
  const steps = [];
  const failures = [];
  for (let i = 0; i < source.steps.length; i++) {
    const spec = source.steps[i];
    let cmd;
    try {
      cmd = substitute(spec.cmd, vars, projectRoot);
    } catch (e) {
      failures.push({ step: i, cmd: spec.cmd, message: String(e) });
      steps.push({ cmd: spec.cmd, exit: null, stdout: '', stderr: '',
        skipped: true });
      continue;
    }
    const res = mode === 'inproc'
      ? await runInProc(cmd)
      : await execCli(cmd, { cwd: projectRoot, timeoutMs });
    const record = { cmd, exit: res.code, stdout: res.stdout,
      stderr: res.stderr };
    try { record.stdoutJson = JSON.parse(res.stdout.trim()); } catch { /* not JSON */ }
    try { record.stderrJson = JSON.parse(res.stderr.trim()); } catch { /* not JSON */ }
    steps.push(record);
    // save runs before the expectation check so a step may reference its
    // own extracted ids (e.g. files:[.../${taskId}.json]) in expects.
    for (const [name, ptr] of Object.entries(spec.save ?? {})) {
      const value = getPath(record.stdoutJson, ptr);
      if (value === undefined) {
        failures.push({ step: i, cmd,
          message: `save '${name}': path '${ptr}' missing in stdout` });
      } else {
        vars[name] = value;
      }
    }
    if (checkExpect) {
      for (const f of checkStep(record, spec, vars, projectRoot)) {
        failures.push({ step: i, cmd, message: f.message });
      }
    }
  }
  return {
    name: source.name, projectRoot, base, steps, failures, vars,
    cleanup() { fs.rmSync(base, { recursive: true, force: true }); },
  };
}

export function normalizedEnvelopes(run) {
  const forms = rootForms(run.projectRoot);
  return run.steps.map((step) => stepEnvelope(step, forms));
}

export { hashStateTree, rootForms };

export function listScenarios() {
  return fs.readdirSync(SCENARIOS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({
      name: f.slice(0, -5),
      path: path.join(SCENARIOS_DIR, f),
      scenario: JSON.parse(fs.readFileSync(path.join(SCENARIOS_DIR, f), 'utf8')),
    }));
}

export function listFixtures() {
  if (!fs.existsSync(FIXTURES_DIR)) return [];
  return fs.readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith('.golden.json'))
    .sort()
    .map((f) => ({
      name: f.slice(0, -'.golden.json'.length),
      path: path.join(FIXTURES_DIR, f),
      fixture: JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, f), 'utf8')),
    }));
}

// Replays a recorded golden fixture in a fresh temp project and returns
// the human-readable differences found (empty list == identical session).
export async function replayFixture(fixture, { timeoutMs } = {}) {
  const run = await runScenario(
    { name: `replay-${fixture.name}`, setup: fixture.setup ?? {},
      steps: fixture.steps },
    { mode: 'process', checkExpect: true, timeoutMs });
  try {
    const diffs = run.failures.map(
      (f) => `step ${f.step} expectation: ${f.message}`);
    const actual = normalizedEnvelopes(run);
    const expected = fixture.envelopes;
    const n = Math.max(actual.length, expected.length);
    for (let i = 0; i < n; i++) {
      const a = actual[i];
      const e = expected[i];
      if (a === undefined || e === undefined) {
        diffs.push(`step ${i}: step count differs (recorded `
          + `${expected.length}, replayed ${actual.length})`);
        break;
      }
      const aJson = JSON.stringify(a);
      const eJson = JSON.stringify(e);
      if (aJson !== eJson) {
        diffs.push(`step ${i} envelope differs:\n  recorded: ${eJson}\n`
          + `  replayed: ${aJson}`);
      }
    }
    const storeHash = hashStateTree(run.projectRoot);
    if (storeHash !== fixture.storeHash) {
      diffs.push(`storeHash differs: recorded ${fixture.storeHash}, `
        + `replayed ${storeHash}`);
    }
    return diffs;
  } finally {
    run.cleanup();
  }
}
