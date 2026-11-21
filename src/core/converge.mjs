// SPDX-License-Identifier: Apache-2.0
// Convergence check (spec-kit /speckit.converge parity): compares the
// declared task record against the real artifacts on disk and emits typed
// findings plus a verdict. Read-only analysis; records are persisted
// create-only under <configDir>/convergence/ so runs form an auditable
// history, never an overwrite.

import fs from 'node:fs';
import { err } from './errors.mjs';
import { resolveInside } from './paths.mjs';
import { lstatOrNull } from './fsx.mjs';
import { getTask } from './tasks.mjs';
import { getArtifact } from './artifacts.mjs';
import { getPlan } from './plans.mjs';
import { checklistFindings } from './checklists.mjs';

export const CONVERGE_VERSION = 1;
const DONE_STATES = new Set(['ACCEPT', 'CLOSE']);
const SEV = { blocking: 'blocking', major: 'major', minor: 'minor' };

function finding(code, severity, detail) {
  return { code, severity, detail };
}

// Pure read-only convergence evaluation for a task record.
export function evaluateConvergence(ctx, task) {
  const findings = [];
  if (!DONE_STATES.has(task.state)) {
    findings.push(finding('TASK_OPEN', SEV.blocking,
      `task state is ${task.state}; convergence requires ACCEPT or CLOSE`));
  }
  const steps = Array.isArray(task.steps) ? task.steps : [];
  const pending = steps.filter((s) => s.status === 'pending');
  if (pending.length > 0) {
    findings.push(finding('STEPS_PENDING',
      DONE_STATES.has(task.state) ? SEV.major : SEV.minor,
      `${pending.length} step(s) still pending`));
  }
  const specExists = (id) => {
    try { getArtifact(ctx, 'spec', id); return true; }
    catch { return false; }
  };
  const designExists = (id) => {
    try { getArtifact(ctx, 'design', id); return true; }
    catch { return false; }
  };
  if (task.specId && !specExists(task.specId)) {
    findings.push(finding('SPEC_MISSING', SEV.major,
      `specification ${task.specId} is unreadable`));
  }
  if (task.designId && !designExists(task.designId)) {
    findings.push(finding('DESIGN_MISSING', SEV.major,
      `design ${task.designId} is unreadable`));
  }
  if (task.planKey && !artifactExists(getPlan, ctx, task.planKey)) {
    findings.push(finding('PLAN_MISSING', SEV.major,
      `plan '${task.planKey}' is unreadable`));
  }
  if (DONE_STATES.has(task.state) && !task.verification) {
    findings.push(finding('VERIFICATION_ABSENT', SEV.major,
      'task reached a done state without a verification record'));
  }
  for (const s of Array.isArray(task.scope) ? task.scope : []) {
    let abs;
    try { abs = resolveInside(ctx.projectRoot, s, 'task.scope'); }
    catch {
      findings.push(finding('SCOPE_PATH_UNSAFE', SEV.major,
        `scope entry '${s}' fails path validation`));
      continue;
    }
    const st = lstatOrNull(abs);
    if (!st) {
      findings.push(finding('SCOPE_ABSENT', SEV.minor,
        `scope path '${s}' does not exist on disk`));
    } else if (st.isSymbolicLink()) {
      findings.push(finding('SCOPE_SYMLINK', SEV.major,
        `scope path '${s}' is a symbolic link`));
    }
  }
  // Reviewer-owned checklists bound to this task feed the verdict:
  // failed items block, pending items degrade to partial.
  try {
    findings.push(...checklistFindings(ctx, task.id));
  } catch { /* unreadable checklist dir is not a convergence fault */ }
  const worst = findings.reduce((w, f) => {
    const rank = { blocking: 3, major: 2, minor: 1 };
    return Math.max(w, rank[f.severity] ?? 0);
  }, 0);
  const verdict = findings.length === 0 ? 'converged'
    : worst === 3 ? 'diverged'
    : worst === 2 ? 'partial'
    : 'partial';
  return Object.freeze({ verdict, findings });
}

function convergenceDir(ctx) {
  return `${ctx.configDir}/convergence`;
}

// Persist a convergence record create-only: NNN is the next monotonic
// index for that task, so repeated runs never overwrite evidence.
export function recordConvergence(ctx, taskId) {
  const task = getTask(ctx, taskId);
  const result = evaluateConvergence(ctx, task);
  const dirRel = convergenceDir(ctx);
  const dirAbs = resolveInside(ctx.projectRoot, dirRel, 'convergence dir');
  const st = lstatOrNull(dirAbs);
  if (st && (st.isSymbolicLink() || !st.isDirectory())) {
    throw err('INVALID_STATE', `${dirRel} is not a real directory`);
  }
  let max = 0;
  if (st) {
    for (const name of fs.readdirSync(dirAbs)) {
      const m = name.match(/^([0-9]{3})-/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
  }
  const record = {
    schemaVersion: CONVERGE_VERSION,
    taskId: task.id,
    slug: task.slug ?? null,
    state: task.state,
    revision: task.revision,
    at: new Date().toISOString(),
    verdict: result.verdict,
    findings: result.findings,
  };
  const rel = `${dirRel}/${String(max + 1).padStart(3, '0')}-${task.id}.json`;
  const abs = resolveInside(ctx.projectRoot, rel, 'convergence record');
  fs.mkdirSync(dirAbs, { recursive: true });
  const fd = fs.openSync(abs, 'wx');
  try {
    fs.writeSync(fd, JSON.stringify(record, null, 2) + '\n');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return Object.freeze({ ...result, record: rel });
}
