// SPDX-License-Identifier: Apache-2.0
// Active-task pointer (spec-kit SPECIFY_FEATURE parity): one reference to
// the task a session is working on. Resolution order is explicit:
// SCOPEGRAIN_TASK env (id or NNN-slug) wins over the persisted pointer at
// <configDir>/active-task. The file is overwritten only through this
// module's atomic temp+rename write — never create-only state.

import fs from 'node:fs';
import { err } from './errors.mjs';
import { configRel, resolveInside } from './paths.mjs';
import { lstatOrNull, readFileLimited, decodeUtf8Strict } from './fsx.mjs';
import { getTask, listTasks, taskBySlug } from './tasks.mjs';

const POINTER_REL = 'active-task';
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function activeTaskRel(ctx) {
  return configRel(ctx, POINTER_REL);
}

// Resolve a user reference (uuid or NNN-slug) to a stored task record.
export function resolveTaskRef(ctx, ref) {
  const value = String(ref ?? '').trim();
  if (value === '') {
    throw err('INVALID_ARGS', 'task reference is empty');
  }
  if (UUID_RE.test(value)) return getTask(ctx, value);
  const task = taskBySlug(ctx, value);
  if (!task) {
    throw err('NOT_FOUND', `no task matches reference '${value}'`);
  }
  return task;
}

function pointerAbs(ctx) {
  return resolveInside(ctx.projectRoot, activeTaskRel(ctx), 'active-task');
}

// env is injectable for tests; production reads process.env.
export function getActiveTask(ctx, env = process.env) {
  const fromEnv = env.SCOPEGRAIN_TASK;
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') {
    const task = resolveTaskRef(ctx, fromEnv);
    return { task, source: 'env' };
  }
  const abs = pointerAbs(ctx);
  const st = lstatOrNull(abs);
  if (!st) return { task: null, source: null };
  if (st.isSymbolicLink() || !st.isFile()) {
    throw err('INVALID_STATE', `${activeTaskRel(ctx)} is not a regular file`);
  }
  const limited = readFileLimited(abs, 4096);
  if (limited.exceeded) {
    throw err('INVALID_STATE', `${activeTaskRel(ctx)} exceeds 4096 bytes`);
  }
  const ref = decodeUtf8Strict(
    limited.content, 'POINTER_MALFORMED', activeTaskRel(ctx)).trim();
  if (ref === '') return { task: null, source: null };
  const task = resolveTaskRef(ctx, ref);
  return { task, source: 'file' };
}

export function setActiveTask(ctx, ref) {
  const task = resolveTaskRef(ctx, ref);
  const abs = pointerAbs(ctx);
  const st = lstatOrNull(abs);
  if (st && (st.isSymbolicLink() || !st.isFile())) {
    throw err('INVALID_STATE', `${activeTaskRel(ctx)} is not a regular file`);
  }
  const tmp = `${abs}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${task.id}\n`, { flag: 'wx' });
  try {
    fs.renameSync(tmp, abs);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* best effort */ }
    throw e;
  }
  return { task, source: 'file' };
}

export function clearActiveTask(ctx) {
  const abs = pointerAbs(ctx);
  const st = lstatOrNull(abs);
  if (!st) return { cleared: false };
  if (st.isSymbolicLink() || !st.isFile()) {
    throw err('INVALID_STATE', `${activeTaskRel(ctx)} is not a regular file`);
  }
  fs.unlinkSync(abs);
  return { cleared: true };
}

// List-backed slug lookup lives here and in tasks.mjs (taskBySlug) so
// callers get a single canonical resolver.
export function slugsInUse(ctx) {
  return listTasks(ctx).tasks.map((t) => t.slug).filter(Boolean);
}
