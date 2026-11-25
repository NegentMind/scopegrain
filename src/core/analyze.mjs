// SPDX-License-Identifier: Apache-2.0
// Cross-artifact analysis (spec-kit /speckit.analyze parity): reads the
// task's formal bindings and reports coverage + consistency findings with
// severities. Read-only — it never mutates records; findings feed review.

import { err } from './errors.mjs';
import { getTask } from './tasks.mjs';
import { getArtifact } from './artifacts.mjs';
import { getSpecification } from './specifications.mjs';
import { unresolvedQuestions } from './clarify.mjs';
import { getPlan } from './plans.mjs';

function finding(code, severity, detail) {
  return { code, severity, detail };
}

// Coverage of spec requirements/scenarios by task scenarioRefs and the
// plan's member task refs (union, like the V2 plan invariant).
export function analyzeTask(ctx, taskId) {
  const task = getTask(ctx, taskId);
  const findings = [];
  const coverage = { requirements: null, scenarios: null };
  if (typeof task.specId !== 'string' || typeof task.designId !== 'string') {
    findings.push(finding('NO_FORMAL_PAIR', 'minor',
      'task has no specId+designId pair; analysis is limited to state'));
    return Object.freeze({ taskId: task.id, findings, coverage });
  }
  let spec = null;
  try { spec = getSpecification(ctx, task.specId); }
  catch (e) {
    findings.push(finding('SPEC_MISSING', 'major',
      `spec ${task.specId}: ${e.code ?? e.message}`));
    return Object.freeze({ taskId: task.id, findings, coverage });
  }
  try { getArtifact(ctx, 'design', task.designId); }
  catch (e) {
    findings.push(finding('DESIGN_MISSING', 'major',
      `design ${task.designId}: ${e.code ?? e.message}`));
  }
  const reqs = spec.data.requirements;
  const covered = new Set(
    (Array.isArray(task.scenarioRefs) ? task.scenarioRefs : [])
      .map((r) => `${r.requirementId}/${r.scenarioId}`));
  // A plan's member tasks union-cover scenarios like the V2 invariant;
  // widening coverage to the plan keeps analysis consistent with it.
  if (task.planKey !== null) {
    try {
      const plan = getPlan(ctx, task.planKey);
      for (const memberRef of plan.tasks ?? []) {
        let member = null;
        try { member = getTask(ctx, memberRef.id); } catch { continue; }
        for (const r of member.scenarioRefs ?? []) {
          covered.add(`${r.requirementId}/${r.scenarioId}`);
        }
      }
    } catch (e) {
      findings.push(finding('PLAN_MISSING', 'major',
        `plan '${task.planKey}': ${e.code ?? e.message}`));
    }
  }
  let totalScen = 0; let coveredScen = 0;
  let reqsCovered = 0;
  for (const r of reqs) {
    let rCovered = false;
    for (const s of r.scenarios) {
      totalScen += 1;
      if (covered.has(`${r.id}/${s.id}`)) {
        coveredScen += 1; rCovered = true;
      } else {
        findings.push(finding('SCENARIO_UNCOVERED', 'major',
          `no task covers scenario ${r.id}/${s.id} (${s.then ?? s.id})`));
      }
    }
    if (rCovered) reqsCovered += 1;
    else {
      findings.push(finding('REQUIREMENT_UNCOVERED', 'major',
        `requirement ${r.id} has no covered scenario`));
    }
  }
  coverage.requirements = `${reqsCovered}/${reqs.length}`;
  coverage.scenarios = `${coveredScen}/${totalScen}`;
  for (const ref of task.scenarioRefs ?? []) {
    const ok = reqs.some((r) => r.id === ref.requirementId
      && r.scenarios.some((s) => s.id === ref.scenarioId));
    if (!ok) {
      findings.push(finding('REF_DANGLING', 'minor',
        `task references ${ref.requirementId}/${ref.scenarioId} `
        + 'absent from spec'));
    }
  }
  const unresolved = unresolvedQuestions(ctx, spec);
  if (unresolved.length > 0) {
    findings.push(finding('OPEN_QUESTIONS', 'minor',
      `${unresolved.length} unresolved open question(s)`));
  }
  return Object.freeze({
    taskId: task.id, slug: task.slug ?? null,
    generatedAt: new Date().toISOString(), findings, coverage,
  });
}
