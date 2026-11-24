// SPDX-License-Identifier: Apache-2.0
// Shared helpers for tests that spawn real child node processes
// (kill-9 durability, multi-process lock contention, MCP stdio e2e).
// Additive module: everything here is a new export; existing eval/lib
// signatures are untouched.
import { spawn } from 'node:child_process';
import { cleanEnv } from './driver.mjs';

// Deterministic PRNG (mulberry32) so kill points and jitter are
// reproducible run over run.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Spawns a node child with an argv ARRAY (never a shell string), so the
// space in "VantaDB Proyect" survives verbatim on Windows. Returns the
// ChildProcess with a `.lines` collector (stdout split on newlines) and
// an `.exited` promise resolving to {code, signal, stderr}.
export function spawnNode(scriptAbs, args, { env, timeoutMs = 120_000 } = {}) {
  const child = spawn(process.execPath, [scriptAbs, ...args], {
    env: env ?? cleanEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.lines = [];
  child.stderrText = '';
  let rest = '';
  child.stdout.on('data', (chunk) => {
    rest += chunk;
    const parts = rest.split('\n');
    rest = parts.pop();
    for (const line of parts) {
      if (line.length) child.lines.push(line);
    }
  });
  child.stderr.on('data', (chunk) => {
    child.stderrText += chunk;
  });
  child.exited = new Promise((resolve) => {
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      resolve({ code: null, signal: 'TIMEOUT', timedOut: true });
    }, timeoutMs);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      if (rest.length) child.lines.push(rest);
      resolve({ code, signal, timedOut: false });
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: null, signal: `SPAWN_ERROR:${e.code ?? e.message}`,
        timedOut: false });
    });
  });
  return child;
}

// Waits until `predicate(child.lines)` holds or the child exits/times
// out. Polls on data events with a small interval fallback.
export async function waitForLines(child, predicate, { timeoutMs = 60_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate(child.lines)) return true;
    if (child.exitCode !== null || child.killed) return predicate(child.lines);
    await sleep(5);
  }
  return predicate(child.lines);
}

// Terminates a child the hard way. On POSIX 'SIGKILL' is the untrappable
// signal; on Windows every signal collapses to TerminateProcess (the OS
// has no signal granularity), which is exactly the abrupt-death
// semantics a kill-9 durability test needs. The signal name is kept
// explicit for readability on both platforms.
export function hardKill(child) {
  try { child.kill('SIGKILL'); } catch { /* already gone */ }
}
