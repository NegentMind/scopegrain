// SPDX-License-Identifier: Apache-2.0
// Canonical workflow policy loader: policy/workflow.json is the single
// source of truth for states, transitions, actions and acceptance rules.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { err } from './errors.mjs';
import { decodeUtf8Strict, readFileLimited, readJsonFile } from './fsx.mjs';

const LIMIT_BYTES = 1048576; // 1MiB policy-file bound (no policy/fsx cycle)

const POLICY_DIR = fileURLToPath(new URL('../../policy/', import.meta.url));
const POLICY_PATH = fileURLToPath(
  new URL('../../policy/workflow.json', import.meta.url));

// Policy objects are immutable declared facts: deep-freeze before caching
// so a caller can never tune them, and only cache on success so a failed
// load never poisons subsequent reads.
function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

// Authored workflow graph: transitions, actions and the acceptance
// contract are pinned in code like constraints (transition.mjs) and
// methodology.json — file divergence fails closed with POLICY_INVALID.
const AUTHORED = deepFreeze({
  initial: 'PLAN',
  transitions: {
    PLAN: ['ACT', 'RESEARCH', 'STALL', 'ABANDON'],
    ACT: ['VERIFY', 'STALL', 'ABANDON'],
    VERIFY: ['COLLATERAL', 'EVALUATE', 'ACT', 'STALL', 'ABANDON'],
    COLLATERAL: ['RESEARCH', 'ACT', 'EVALUATE', 'STALL', 'ABANDON'],
    RESEARCH: ['PLAN', 'ACT', 'STALL', 'ABANDON'],
    EVALUATE: ['REVIEW', 'ACT', 'STALL', 'ABANDON'],
    REVIEW: ['ACCEPT', 'ACT', 'STALL', 'ABANDON'],
    ACCEPT: ['CLOSE', 'ACT', 'STALL', 'ABANDON'],
    CLOSE: [],
    STALL: ['PLAN', 'ABANDON'],
    ABANDON: [],
  },
  actions: {
    PLAN: ['read', 'research', 'propose'],
    ACT: ['read', 'edit', 'propose'],
    VERIFY: ['read', 'verify', 'propose'],
    COLLATERAL: ['read', 'research', 'propose'],
    RESEARCH: ['read', 'research', 'propose'],
    EVALUATE: ['read', 'evaluate'],
    REVIEW: ['read', 'review'],
    ACCEPT: ['read'],
    CLOSE: ['read'],
    STALL: ['read'],
    ABANDON: ['read'],
  },
  acceptance: {
    verificationStatuses: ['pass'],
    recordableVerificationStatuses: ['pass', 'fail', 'error'],
    recordableReviewVerdicts: ['approve', 'reject', 'changes-requested'],
    reviewVerdict: 'approve',
    freshContextsMustDiffer: true,
    waiverRequiredFields: ['owner', 'reference', 'reason'],
  },
});
const POLICY_ROOT_KEYS = ['schemaVersion', 'initial', 'transitions',
  'actions', 'constraints', 'acceptance', 'execution'];

// Order-insensitive authored equality: arrays compare as sets (edge and
// vocabulary order is not semantic), objects compare as closed key sets
// recursively, scalars compare strictly.
function authoredEqual(got, want) {
  if (Array.isArray(want)) {
    return Array.isArray(got) && got.length === want.length
      && got.every((x) => want.includes(x));
  }
  if (want !== null && typeof want === 'object') {
    return got !== null && typeof got === 'object' && !Array.isArray(got)
      && Object.keys(got).length === Object.keys(want).length
      && Object.keys(want).every((k) => authoredEqual(got[k], want[k]));
  }
  return got === want;
}

let cached = null;

export function loadPolicy() {
  if (cached) return cached;
  const policy = readJsonFile(POLICY_PATH, 'workflow policy');
  if (policy.schemaVersion !== 1
      || typeof policy.initial !== 'string'
      || policy.transitions === null || typeof policy.transitions !== 'object'
      || policy.actions === null || typeof policy.actions !== 'object'
      || policy.acceptance === null || typeof policy.acceptance !== 'object') {
    throw err('POLICY_INVALID', 'policy/workflow.json has an unexpected shape');
  }
  if (!Array.isArray(policy.transitions[policy.initial])) {
    throw err('POLICY_INVALID', 'policy initial state is not declared in transitions');
  }
  for (const [state, next] of Object.entries(policy.transitions)) {
    if (!Array.isArray(next) || !Array.isArray(policy.actions[state])) {
      throw err('POLICY_INVALID', `policy state '${state}' lacks transitions or actions`);
    }
  }
  const rootKeys = Object.keys(policy);
  if (policy.initial !== AUTHORED.initial
      || rootKeys.length !== POLICY_ROOT_KEYS.length
      || !rootKeys.every((k) => POLICY_ROOT_KEYS.includes(k))
      || !authoredEqual(policy.transitions, AUTHORED.transitions)
      || !authoredEqual(policy.actions, AUTHORED.actions)
      || !authoredEqual(policy.acceptance, AUTHORED.acceptance)) {
    throw err('POLICY_INVALID',
      'policy/workflow.json diverges from the authored workflow graph');
  }
  cached = deepFreeze(policy);
  return cached;
}

export function knownStates() {
  return Object.keys(loadPolicy().transitions);
}

export function isTransitionAllowed(from, to) {
  const policy = loadPolicy();
  const next = policy.transitions[from];
  return Array.isArray(next) && next.includes(to);
}

// States with no outgoing transitions are terminal (CLOSE, ABANDON and
// any future terminal state the authored graph may add) — metrics and
// readiness counts must exclude them rather than name them one by one.
export function terminalStates() {
  const { transitions } = loadPolicy();
  return Object.keys(transitions)
    .filter((s) => Array.isArray(transitions[s])
      && transitions[s].length === 0);
}

export function knownActions() {
  const all = new Set();
  for (const list of Object.values(loadPolicy().actions)) {
    for (const a of list) all.add(a);
  }
  return all;
}

function loadPolicyFile(name, label, dir = POLICY_DIR) {
  const file = path.join(dir, name);
  let data;
  try {
    const limited = readFileLimited(file, LIMIT_BYTES);
    if (limited.exceeded) {
      throw err('POLICY_MALFORMED',
        `${label} exceeds ${LIMIT_BYTES} bytes: policy/${name}`);
    }
    data = JSON.parse(decodeUtf8Strict(
      limited.content, 'POLICY_MALFORMED', `${label}: policy/${name}`));
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      throw err('POLICY_NOT_FOUND', `${label} not found: policy/${name}`);
    }
    if (e && e.code === 'POLICY_MALFORMED') {
      throw e;
    }
    throw err('POLICY_MALFORMED', `${label} is not valid JSON: policy/${name}`);
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw err('POLICY_MALFORMED', `${label} must be a JSON object`);
  }
  if (data.schemaVersion !== 1) {
    throw err('POLICY_MALFORMED', `${label} schemaVersion must be 1`);
  }
  return data;
}

// Authored operation limits (policy/operation-limits.json): document size
// bounds, plan/session caps and capability flags.
// Cached per policyDir: production code always reads the canonical dir,
// while tests injecting fixtures keep isolated caches per temp root.
const limitsCache = new Map();
export function loadLimits(opts = {}) {
  const key = path.resolve(opts.policyDir ?? POLICY_DIR);
  const hit = limitsCache.get(key);
  if (hit) return hit;
  const d = loadPolicyFile('operation-limits.json', 'operation limits', key);
  for (const key of ['maxDocumentBytes', 'maxPlanTasks', 'maxSessionEvents']) {
    if (!Number.isInteger(d[key]) || d[key] <= 0) {
      throw err('POLICY_MALFORMED', `operation-limits.${key} must be a positive integer`);
    }
  }
  for (const key of ['executesProjectCommands', 'authenticatesEvidence',
    'interceptsNativeTools']) {
    if (typeof d[key] !== 'boolean') {
      throw err('POLICY_MALFORMED', `operation-limits.${key} must be boolean`);
    }
  }
  const frozen = deepFreeze(d);
  limitsCache.set(key, frozen);
  return frozen;
}

let cachedJournalPolicy = null;
export function loadJournalPolicy() {
  if (cachedJournalPolicy) return cachedJournalPolicy;
  const d = loadPolicyFile('journal.json', 'journal policy');
  const keys = ['schemaVersion', 'maxOperationEvents', 'maxPendingOperations',
    'defaultPageSize', 'maxPageSize'];
  if (Object.keys(d).some((key) => !keys.includes(key))
      || keys.some((key) => !Object.hasOwn(d, key))) {
    throw err('POLICY_MALFORMED', 'journal policy has missing or unknown keys');
  }
  for (const key of keys.slice(1)) {
    if (!Number.isSafeInteger(d[key]) || d[key] <= 0) {
      throw err('POLICY_MALFORMED', `journal.${key} must be a positive safe integer`);
    }
  }
  if (d.defaultPageSize > d.maxPageSize) {
    throw err('POLICY_MALFORMED', 'journal.defaultPageSize exceeds maxPageSize');
  }
  cachedJournalPolicy = deepFreeze(d);
  return cachedJournalPolicy;
}

// Authored methodology policy (policy/methodology.json): modes, defaults,
// risk categories, gated states, research escalation and false capabilities.
// Immutable declared facts — never tunable thresholds. Validated against
// the authored contract BEFORE any .includes access (no raw TypeErrors),
// deep-frozen before caching, and a failed load never poisons the cache.
let cachedMethodology = null;
export function loadMethodologyPolicy() {
  if (cachedMethodology) return cachedMethodology;
  const d = loadPolicyFile('methodology.json', 'methodology policy');
  const bad = (field, why) => err('POLICY_MALFORMED',
    `methodology.${field}: ${why}`);
  const closed = (v, keys, label) => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) {
      throw bad(label, 'must be an object');
    }
    for (const k of Object.keys(v)) {
      if (!keys.includes(k)) {
        throw bad(label, `unknown key '${k}'`);
      }
    }
  };
  closed(d, ['schemaVersion', 'modes', 'legacyDefault', 'interactiveDefault',
    'oddDefinition', 'smallTaskTracking', 'riskCategories', 'gatedTaskStates',
    'researchEscalation', 'authenticatesApprovalIdentity',
    'authenticatesEvidence', 'interceptsNativeTools', 'executesAgents'],
    'root');
  const exactUniqueSet = (v, want, field) => {
    if (!Array.isArray(v) || v.length !== want.length
        || !v.every((x) => typeof x === 'string')
        || new Set(v.map((s) => s.toLowerCase())).size !== v.length
        || ![...v].every((x) => want.includes(x))) {
      throw bad(field, `must be exactly ${JSON.stringify(want)}, unique`);
    }
  };
  exactUniqueSet(d.modes, ['manual', 'organic-sdd', 'sdd'], 'modes');
  if (d.legacyDefault !== 'manual') {
    throw bad('legacyDefault', "must be 'manual'");
  }
  if (d.interactiveDefault !== 'organic-sdd') {
    throw bad('interactiveDefault', "must be 'organic-sdd'");
  }
  if (d.oddDefinition !== 'organic-driven') {
    throw bad('oddDefinition', "must be 'organic-driven'");
  }
  if (d.smallTaskTracking !== 'task-record') {
    throw bad('smallTaskTracking', "must be 'task-record'");
  }
  exactUniqueSet(d.gatedTaskStates, ['ACT', 'ACCEPT'], 'gatedTaskStates');
  exactUniqueSet(d.riskCategories, [
    'security', 'data-integrity', 'public-contract', 'concurrency',
    'delivery', 'external-effects', 'verification-gap', 'other'],
    'riskCategories');
  closed(d.researchEscalation, [
    'investigateAfterSimilarFailures',
    'revisitDesignAfterAttemptsWithoutProgress', 'network',
    'causalGrouping'], 'researchEscalation');
  const esc = d.researchEscalation;
  if (esc.investigateAfterSimilarFailures !== 2) {
    throw bad('researchEscalation.investigateAfterSimilarFailures',
      'must be 2');
  }
  if (esc.revisitDesignAfterAttemptsWithoutProgress !== 3) {
    throw bad('researchEscalation.revisitDesignAfterAttemptsWithoutProgress',
      'must be 3');
  }
  if (esc.network !== 'ask') {
    throw bad('researchEscalation.network', "must be 'ask'");
  }
  if (esc.causalGrouping
      !== 'explicitly-recorded-hypothesis-not-inferred-from-counts') {
    throw bad('researchEscalation.causalGrouping', 'must be the authored value');
  }
  for (const k of ['authenticatesApprovalIdentity', 'authenticatesEvidence',
    'interceptsNativeTools', 'executesAgents']) {
    if (d[k] !== false) {
      throw bad(k, 'must be false');
    }
  }
  // Deep-freeze the whole graph before caching — the returned object is
  // immutable declared policy, never a tunable.
  const frozen = Object.freeze({
    ...d,
    modes: Object.freeze([...d.modes]),
    riskCategories: Object.freeze([...d.riskCategories]),
    gatedTaskStates: Object.freeze([...d.gatedTaskStates]),
    researchEscalation: Object.freeze({ ...d.researchEscalation }),
  });
  cachedMethodology = frozen;
  return frozen;
}

// Authored onboarding defaults (policy/onboarding-defaults.json): workspace,
// default artifact paths, versioning flags and review subdirectory.
let cachedOnboarding = null;
export function loadOnboardingDefaults() {
  if (cachedOnboarding) return cachedOnboarding;
  const d = loadPolicyFile('onboarding-defaults.json', 'onboarding defaults');
  if (typeof d.workspace !== 'string' || d.workspace === '') {
    throw err('POLICY_MALFORMED', 'onboarding-defaults.workspace must be a string');
  }
  cachedOnboarding = deepFreeze(d);
  return cachedOnboarding;
}

// Test seam: drops every cached policy so a fixture can re-author one.
// Production callers must not rely on this — a reset only releases the
// frozen references; already-returned objects stay immutable either way.
export function resetPolicyCaches() {
  cached = null;
  cachedJournalPolicy = null;
  cachedMethodology = null;
  cachedOnboarding = null;
  limitsCache.clear();
}

export function actionsFor(state) {
  return loadPolicy().actions[state] || [];
}
