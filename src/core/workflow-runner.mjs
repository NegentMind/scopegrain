// SPDX-License-Identifier: Apache-2.0
// Declarative workflow runner (spec-kit workflow parity, restricted): a
// workflow document lists steps naming ONLY whitelisted harness
// primitives — never arbitrary shell or third-party code. Run state
// persists under <configDir>/workflow-runs/ so a stopped run resumes at
// the first incomplete step. Every step executes through the same core
// functions the CLI uses; nothing bypasses gates or CAS.

import fs from 'node:fs';
import { err } from './errors.mjs';
import { resolveInside } from './paths.mjs';
import { lstatOrNull, readFileLimited, decodeUtf8Strict } from './fsx.mjs';
import { loadLimits } from './policy.mjs';
import { getTask } from './tasks.mjs';
import { transitionTask } from './transition.mjs';
import { evaluateConvergence, recordConvergence } from './converge.mjs';
import { analyzeTask } from './analyze.mjs';
import { evaluateMethodology } from './methodology.mjs';
import { markChecklistItem, checklistFindings } from './checklists.mjs';

const RUN_DIR = (ctx) => `${ctx.configDir}/workflow-runs`;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

// Whitelisted step operations — the trust boundary. New ops must map to
// existing core functions; 'shell' or arbitrary commands are rejected at
// document validation, before any state exists.
const OPS = {
  'task.transition': (ctx, a) => transitionTask(ctx, {
    id: a.taskId, to: a.to, expectedRevision: a.expectedRevision,
    ...(a.evidence ? { evidence: a.evidence } : {}),
  }),
  'methodology.check': (ctx, a) => evaluateMethodology(ctx,
    getTask(ctx, a.taskId), { to: a.to ?? 'ACT' }),
  'converge.evaluate': (ctx, a) => evaluateConvergence(ctx,
    getTask(ctx, a.taskId)),
  'converge.record': (ctx, a) => recordConvergence(ctx, a.taskId),
  'analyze.task': (ctx, a) => analyzeTask(ctx, a.taskId),
  'checklist.mark': (ctx, a) => markChecklistItem(ctx, a.checklistId,
    a.itemId, { status: a.status, note: a.note,
      expectedRevision: a.expectedRevision }),
  'checklist.findings': (ctx, a) => ({
    findings: checklistFindings(ctx, a.taskId),
  }),
  'noop': () => ({ skipped: false }),
};

function validateWorkflow(doc) {
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    throw err('INVALID_VALUE', 'workflow document must be an object');
  }
  for (const k of Object.keys(doc)) {
    if (!['schemaVersion', 'id', 'steps'].includes(k)) {
      throw err('UNKNOWN_KEY', `workflow has unknown key '${k}'`);
    }
  }
  if (doc.schemaVersion !== 1 || !ID_RE.test(doc.id ?? '')
      || !Array.isArray(doc.steps) || doc.steps.length === 0
      || doc.steps.length > 100) {
    throw err('INVALID_VALUE',
      'workflow requires schemaVersion 1, slug id and 1-100 steps');
  }
  const seen = new Set();
  doc.steps.forEach((s, i) => {
    if (s === null || typeof s !== 'object' || Array.isArray(s)
        || !ID_RE.test(s.id ?? '') || typeof s.op !== 'string') {
      throw err('INVALID_VALUE', `steps[${i}] requires {id, op}`);
    }
    if (!(s.op in OPS)) {
      throw err('INVALID_OP',
        `steps[${i}].op '${s.op}' is not a whitelisted harness primitive`);
    }
    for (const k of Object.keys(s)) {
      if (!['id', 'op', 'args'].includes(k)) {
        throw err('UNKNOWN_KEY', `steps[${i}] has unknown key '${k}'`);
      }
    }
    if (seen.has(s.id)) throw err('INVALID_VALUE', `duplicate step '${s.id}'`);
    seen.add(s.id);
  });
  return doc;
}

const runRel = (ctx, id) => `${RUN_DIR(ctx)}/${id}.json`;

export function loadRun(ctx, id) {
  const rel = runRel(ctx, id);
  const abs = resolveInside(ctx.projectRoot, rel, 'workflow run');
  const st = lstatOrNull(abs);
  if (!st) return null;
  if (st.isSymbolicLink() || !st.isFile()) {
    throw err('INVALID_PATH', `${rel} is not a regular file`);
  }
  const l = readFileLimited(abs, loadLimits().maxDocumentBytes);
  if (l.exceeded) throw err('DOCUMENT_TOO_LARGE', rel);
  return JSON.parse(decodeUtf8Strict(l.content, 'MALFORMED', rel));
}

function saveRun(ctx, run) {
  const abs = resolveInside(
    ctx.projectRoot, runRel(ctx, run.id), 'workflow run');
  fs.mkdirSync(resolveInside(
    ctx.projectRoot, RUN_DIR(ctx), 'workflow runs'), { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(run, null, 2) + '\n', { flag: 'wx' });
  try { fs.renameSync(tmp, abs); }
  catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* best effort */ }
    throw e;
  }
}

// Execute pending steps in order, persisting progress after each one.
// Resume is idempotent: completed steps are never re-run.
export function runWorkflow(ctx, doc, { resume = true } = {}) {
  const workflow = validateWorkflow(doc);
  let run = resume ? loadRun(ctx, workflow.id) : null;
  if (!run) {
    run = {
      schemaVersion: 1, id: workflow.id,
      status: 'running',
      completed: [], results: {},
      startedAt: new Date().toISOString(),
    };
  }
  for (const step of workflow.steps) {
    if (run.completed.includes(step.id)) continue;
    try {
      const result = OPS[step.op](ctx, step.args ?? {});
      run.results[step.id] = { ok: true, result };
      run.completed.push(step.id);
    } catch (e) {
      run.results[step.id] = {
        ok: false,
        error: { code: e.code ?? 'INTERNAL',
          message: String(e.message ?? e) },
      };
      run.status = 'failed';
      run.failedStep = step.id;
      saveRun(ctx, run);
      return Object.freeze({ run, workflow: { id: workflow.id,
        steps: workflow.steps.length } });
    }
    saveRun(ctx, run); // resumable checkpoint after every step
  }
  run.status = 'completed';
  saveRun(ctx, run);
  return Object.freeze({ run, workflow: { id: workflow.id,
    steps: workflow.steps.length } });
}
