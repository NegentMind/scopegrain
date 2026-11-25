// SPDX-License-Identifier: Apache-2.0
// Read-only gates over current declared facts and content-bound approvals.
// This is not identity/execution authentication, a cross-file transaction,
// workflow-edge authorization or interception of native host tools.
import { err } from './errors.mjs';
import { validateMethodologyMode } from './config.mjs';
import { classifyWork, allScenarioRefs } from './methodology-data.mjs';
import { collectFormalBindings } from './formal-bindings.mjs';
import { describeApprovalTarget, getApproval } from './approvals.mjs';
import { canonicalDigest, canonicalJSON } from './digests.mjs';
import { getArtifact } from './artifacts.mjs';
import { unresolvedQuestions } from './clarify.mjs';
import { getTask, listTasks } from './tasks.mjs';
import { validateReview, validateVerification } from './evidence.mjs';
import { resolveInside } from './paths.mjs';
import { actionsFor, loadMethodologyPolicy } from './policy.mjs';
import { applyPreActionHooks, loadHooksPolicy } from './hooks-policy.mjs';

const INPUT_KEYS = new Set(['taskId', 'to', 'outcomeEvidenceId']);
const FORWARD_SOURCES = new Set(['STALL', 'PLAN', 'RESEARCH']);
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const issue = (code, message) => ({ code, message });
const sameId = (a, b) => typeof a === 'string' && typeof b === 'string'
  && a.toLowerCase() === b.toLowerCase();
const pairKey = (r) => `${r.requirementId.toLowerCase()}/${r.scenarioId.toLowerCase()}`;
const scopeKey = (s) => canonicalJSON({
  paths: [...s.paths].sort(), effects: [...s.effects].sort(),
});

function checkApproval(ctx, input, expectedDigest, issues) {
  const label = input.artifactKind ?? input.kind;
  let desc;
  try { desc = describeApprovalTarget(ctx, input); }
  catch (e) {
    issues.push(issue(e.code, `${label} approval target: ${e.message}`));
    return;
  }
  if (desc.target.digest !== expectedDigest) {
    issues.push(issue('APPROVAL_STALE',
      `${label} current target digest does not match collected bindings`));
  }
  let a;
  try { a = getApproval(ctx, desc.target.digest); }
  catch (e) {
    issues.push(issue(e.code, `${label} approval: ${e.message}`));
    return;
  }
  if (a.status !== 'approved') {
    issues.push(issue('APPROVAL_NOT_APPROVED',
      `${label} approval status is '${a.status}', not approved`));
  }
  const t = a.target;
  const current = desc.target;
  if (t.kind !== current.kind || t.artifactKind !== current.artifactKind
      || t.digest !== current.digest
      || (current.kind === 'plan'
        ? t.id !== current.id : !sameId(t.id, current.id))) {
    issues.push(issue('APPROVAL_STALE',
      `${label} approved target does not match the current target`));
  }
  if (scopeKey(a.scope) !== scopeKey(desc.scope)) {
    issues.push(issue('APPROVAL_SCOPE_CHANGED',
      `${label} approval scope differs from current exact paths/effects`));
  }
}

function checkDependencies(task, b, issues) {
  if (!b.plan) return;
  const refs = new Map(b.plan.tasks.map((r) => [r.key, r]));
  const actual = new Map(b.planTasks.map((t) => [t.id.toLowerCase(), t]));
  const current = b.plan.tasks.find((r) => sameId(r.id, task.id));
  if (!current) return; // collector already reports invalid membership
  const seen = new Set();
  const pending = [...current.dependsOn];
  while (pending.length > 0) {
    const key = pending.pop();
    if (seen.has(key)) continue;
    seen.add(key);
    const ref = refs.get(key); // DAG and keys validated by the actual getter
    if (!ref) continue;
    const ancestor = actual.get(ref.id.toLowerCase());
    if (ancestor && ancestor.state !== 'CLOSE') {
      issues.push(issue('PLAN_DEPENDENCY_OPEN',
        `plan dependency '${key}' (${ref.id}) must be CLOSE, currently ${ancestor.state}`));
    }
    // Even a closed direct dependency cannot hide an unfinished ancestor.
    pending.push(...ref.dependsOn);
  }
}

function checkAcceptance(task, issues) {
  let verification = null;
  try { verification = validateVerification(task.verification); }
  catch (e) {
    issues.push(issue(e.code, `verification: ${e.message}`));
  }
  try { validateReview(task.review, task); }
  catch (e) {
    issues.push(issue(e.code, `review: ${e.message}`));
  }
  return verification;
}

function checkOutcome(ctx, task, b, verification, previousRevision, issues) {
  if (verification && b.spec) {
    const known = new Set(allScenarioRefs(b.spec).map(pairKey));
    const expected = new Set(b.scenarioRefs.map(pairKey));
    const actual = new Set((verification.coverage ?? []).map(pairKey));
    if ([...actual].some((k) => !known.has(k))
        || actual.size !== expected.size
        || [...expected].some((k) => !actual.has(k))) {
      issues.push(issue('SCENARIO_COVERAGE_MISMATCH',
        'verification coverage must exactly match this task assigned scenarios in the current spec'));
    }
  }
  const id = verification?.outcomeEvidenceId;
  if (!id) {
    issues.push(issue('OUTCOME_REQUIRED',
      'formal ACCEPT requires verification.outcomeEvidenceId'));
    return;
  }
  let report;
  try { report = getArtifact(ctx, 'report', id); }
  catch (e) {
    issues.push(issue(e.code, `outcome report ${id}: ${e.message}`));
    return;
  }
  if (report.schemaVersion !== 2 || !report.data) {
    issues.push(issue('OUTCOME_BINDING_MISMATCH',
      `outcome report ${id} must be a typed V2 report`));
  } else {
    // Nine existing typed fields; the verification projection deliberately
    // excludes the locator so report identity cannot hash itself.
    const expected = {
      schemaVersion: 1, taskId: task.id, taskRevision: previousRevision,
      taskDigest: b.taskDigest, specId: b.spec?.id ?? task.specId,
      specDigest: b.specDigest, designDigest: b.designDigest,
      planDigest: b.planDigest,
      verificationDigest: canonicalDigest({
        checks: verification.checks, coverage: verification.coverage ?? [],
      }),
    };
    for (const [key, value] of Object.entries(expected)) {
      const equal = key === 'taskId' || key === 'specId'
        ? sameId(report.data[key], value) : report.data[key] === value;
      if (!equal) {
        issues.push(issue('OUTCOME_BINDING_MISMATCH',
          `outcome report ${id} ${key} does not match current task/bindings`));
      }
    }
  }
  checkApproval(ctx, { kind: 'artifact', artifactKind: 'report', id },
    canonicalDigest(report), issues);
}

// V3 records preserve the methodology metadata and formal refs that V2
// carries (transition.mjs keeps them through meta updates). A task
// "carries" methodology metadata when it is V2, or V3 with an assessment
// or the formal specId+designId pair — metadata-less V3 records (e.g.
// V1-upgraded) stay on the manual route in manual mode.
function carriesMethodologyMetadata(task) {
  return task.schemaVersion === 2
    || (task.schemaVersion === 3
        && (task.methodology !== null
            || (typeof task.specId === 'string'
                && typeof task.designId === 'string')));
}

// Internal seam: supplied task is already validated (stored or prospective).
// Static fields of a prospective transition have not changed.
export function evaluateMethodology(ctx, task,
    { to = 'ACT', previousRevision = task.revision } = {}) {
  const mode = validateMethodologyMode(ctx.config.methodology, 'config.methodology');
  const enforced = mode !== 'manual' || carriesMethodologyMetadata(task);
  const issues = [];
  const result = (route) => ({
    mode, enforced, allowed: issues.length === 0, route,
    classificationBasis: 'operator-attestation', issues,
    authenticatesEvidence: false, interceptsNativeTools: false,
  });
  if (!enforced) return result('manual');
  // Range admission is fail-closed: versions below 2 lack the metadata
  // shape entirely; versions above 3 are unknown and must not be silently
  // evaluated as if they were V2.
  if (task.schemaVersion < 2 || task.schemaVersion > 3) {
    issues.push(issue('METHODOLOGY_REQUIRED',
      'selected methodology mode requires V2 or V3 task metadata'));
    return result('blocked');
  }
  let classification = null;
  if (task.methodology !== null) {
    classification = classifyWork(task.methodology);
    if (classification.route === 'read-only') {
      issues.push(issue('READ_ONLY_INTENT',
        'read-only intent cannot enter product ACT, ACCEPT or CLOSE'));
      return result('read-only');
    }
    if (classification.route === 'blocked') {
      issues.push(...classification.issues);
      return result('blocked');
    }
  }
  const formal = typeof task.specId === 'string' && typeof task.designId === 'string';
  const route = formal || mode === 'sdd' ? 'sdd' : classification?.route;
  if (!route || (route === 'sdd' && !formal)) {
    issues.push(issue('METHODOLOGY_REQUIRED',
      'methodology requires a current assessment or the formal specId+designId pair'));
    return result(route ?? 'blocked');
  }
  // researchEscalation enforcement (policy/methodology.json): returning
  // to ACT from any downstream gate (VERIFY, COLLATERAL, EVALUATE,
  // REVIEW, ACCEPT) is a recorded rework cycle — an attempt that went
  // back to implementation without closing. Entries from PLAN, RESEARCH
  // or STALL are forward progress or the sanctioned research escape,
  // never rework. At the authored
  // revisitDesignAfterAttemptsWithoutProgress threshold (3 reworks),
  // further ->ACT requires a RESEARCH visit after the last rework. Only
  // recorded transitions count: investigateAfterSimilarFailures (2) is
  // declared but NOT mechanized — the policy's causalGrouping states
  // hypothesis-grouped "similar failures" are never inferred from counts,
  // failure hypotheses are not yet a record field, and judging causal
  // similarity stays the agent's obligation per rules/research-escalation.md.
  if (to === 'ACT') {
    const esc = loadMethodologyPolicy().researchEscalation;
    const history = Array.isArray(task.history) ? task.history : [];
    let reworks = 0;
    let lastRework = -1;
    history.forEach((h, i) => {
      if (h?.event === 'transition' && h.to === 'ACT'
          && !FORWARD_SOURCES.has(h.from)) {
        reworks += 1;
        lastRework = i;
      }
    });
    const researchedSince = history.slice(lastRework + 1).some(
      (h) => h?.event === 'transition' && h.to === 'RESEARCH');
    if (reworks >= esc.revisitDesignAfterAttemptsWithoutProgress
        && !researchedSince) {
      issues.push(issue('RESEARCH_ESCALATION_REQUIRED',
        `${reworks} rework cycle(s) into ACT without a RESEARCH visit; `
        + 'researchEscalation requires investigation'
        + (formal ? ' and design revisit' : '')
        + ' before re-implementing (escape: RESEARCH via COLLATERAL, or '
        + 'STALL -> PLAN -> RESEARCH)'));
    }
  }
  if (route === 'light') {
    for (const s of task.scope) {
      try { resolveInside(ctx.projectRoot, s, 'task.scope'); }
      catch (e) { issues.push(issue(e.code, `task scope '${s}': ${e.message}`)); }
    }
    if (to === 'ACCEPT') checkAcceptance(task, issues);
    return result(route);
  }
  const b = collectFormalBindings(ctx, task);
  issues.push(...b.issues);
  if (b.spec) {
    const unresolved = unresolvedQuestions(ctx, b.spec);
    if (unresolved.length > 0) {
      issues.push(issue('APPROVAL_OPEN_QUESTIONS',
        `spec ${b.spec.id} has ${unresolved.length} unresolved open question(s)`));
    }
  }
  checkApproval(ctx, { kind: 'artifact', artifactKind: 'spec', id: task.specId },
    b.specDigest, issues);
  checkApproval(ctx, { kind: 'artifact', artifactKind: 'design', id: task.designId },
    b.designDigest, issues);
  checkApproval(ctx, task.planKey !== null
    ? { kind: 'plan', id: task.planKey } : { kind: 'task', id: task.id },
  task.planKey !== null ? b.planDigest : b.taskDigest, issues);
  checkDependencies(task, b, issues);
  if (to === 'ACCEPT') {
    const verification = checkAcceptance(task, issues);
    checkOutcome(ctx, task, b, verification, previousRevision, issues);
  }
  return result(route);
}

export function checkMethodology(ctx, input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw err('INVALID_ARGS', 'methodology options must be an object');
  }
  for (const key of Object.keys(input)) {
    if (!INPUT_KEYS.has(key)) {
      throw err('UNKNOWN_KEY', `unknown methodology option '${key}'`);
    }
  }
  const to = input.to === undefined ? 'ACT' : input.to;
  const gated = loadMethodologyPolicy().gatedTaskStates;
  if (!gated.includes(to)) {
    throw err('INVALID_STATE',
      `methodology target must be one of ${gated.join(', ')}`);
  }
  if (input.outcomeEvidenceId !== undefined
      && (to !== 'ACCEPT' || typeof input.outcomeEvidenceId !== 'string'
        || !UUID_RE.test(input.outcomeEvidenceId))) {
    throw err('INVALID_ARGS', 'outcomeEvidenceId must be a UUID string only for ACCEPT');
  }
  const task = getTask(ctx, input.taskId);
  const candidate = input.outcomeEvidenceId !== undefined && task.verification
    ? { ...task, verification: {
      ...task.verification, outcomeEvidenceId: input.outcomeEvidenceId,
    } } : task;
  return evaluateMethodology(ctx, candidate, { to, previousRevision: task.revision });
}

export function evaluateTaskActions(ctx, task, { installRoot } = {}) {
  const methodology = evaluateMethodology(ctx, task);
  const statePermitted = actionsFor(task.state).filter((action) =>
    action !== 'edit' || (methodology.allowed
      && !(carriesMethodologyMetadata(task) && task.scope.length === 0)));
  // Bounded declarative pre-action hooks (policy/hooks.json `preAction`):
  // `block` prunes, `require-gate` flags, `record` annotates — applied
  // AFTER the state/methodology floor, never a bypass of it. Cross-task
  // `when.scopeOverlapIn` conditions resolve their peer view here (the
  // layer that owns ctx); the full task scan only runs when the policy
  // actually declares the key.
  const policy = loadHooksPolicy(
    installRoot ? { installRoot } : {});
  const peers = policy.preAction.some((h) => h.when.scopeOverlapIn)
    ? listTasks(ctx).tasks.map((t) =>
        ({ id: t.id, state: t.state, scope: t.scope ?? [] }))
    : undefined;
  const hooks = applyPreActionHooks(task, statePermitted,
    { ...(installRoot ? { installRoot } : {}), peers });
  return { permitted: hooks.permitted, methodology,
    actionHooks: { applied: hooks.applied, gated: hooks.gated } };
}
