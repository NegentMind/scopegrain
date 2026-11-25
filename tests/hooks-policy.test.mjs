// SPDX-License-Identifier: Apache-2.0
// hooks-policy contract: the REAL accepted shape is phase-first —
// {before|after: {<command-id>|'*': [{id, description, command?}]}}.
// The example historically shown in cli-reference.md used the inverted
// command-first shape with before_/after_ keys; this suite pins both the
// real shape and the rejection of the documented one (doc fix is a
// separate wave — this test defines the ground truth).
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPreActionHooks, hooksFor, loadHooksPolicy }
  from '../src/core/hooks-policy.mjs';
import { cleanup, makeTempDir, writeJson } from './helpers.mjs';

function installWithHooks(doc) {
  const root = makeTempDir('hooks');
  if (doc !== undefined) writeJson(root, 'policy/hooks.json', doc);
  return root;
}

test('missing policy file means empty hooks, not an error', () => {
  const root = installWithHooks(undefined);
  try {
    assert.deepEqual(loadHooksPolicy({ installRoot: root }),
      { before: {}, after: {}, preAction: [] });
    assert.deepEqual(hooksFor('anything', { installRoot: root }),
      { before: [], after: [] });
  } finally { cleanup(root); }
});

test('shipped policy/hooks.json parses as the canonical empty policy', () => {
  assert.deepEqual(loadHooksPolicy(),
    { before: {}, after: {}, preAction: [] });
});

test('real phase-first shape loads; globals precede command-specific hooks', () => {
  const root = installWithHooks({ schemaVersion: 1, hooks: {
    before: {
      '*': [{ id: 'announce', description: 'global pre' }],
      'implement-task': [{ id: 'pre-check', description: 'cmd pre' }],
    },
    after: {
      'implement-task': [{ id: 'post-check', description: 'cmd post',
        command: 'declared advisory command, never executed' }],
    },
  } });
  try {
    const policy = loadHooksPolicy({ installRoot: root });
    assert.equal(policy.before['*'][0].id, 'announce');
    const h = hooksFor('implement-task', { installRoot: root });
    assert.deepEqual(h.before.map((x) => x.id), ['announce', 'pre-check']);
    assert.deepEqual(h.after.map((x) => x.id), ['post-check']);
    assert.equal(h.after[0].command,
      'declared advisory command, never executed');
    // A command id without specific hooks sees only the '*' entries.
    assert.deepEqual(hooksFor('other-cmd', { installRoot: root }), {
      before: [{ id: 'announce', description: 'global pre' }],
      after: [],
    });
  } finally { cleanup(root); }
});

test('documented inverted shape (command-first, before_/after_ keys) is rejected', () => {
  // Verbatim example from docs/cli-reference.md (ES+EN): the parser must
  // NOT accept it — copying it would otherwise silently write a policy
  // that fails at load. Kept as ground truth for the doc-fix wave.
  const documented = { schemaVersion: 1, hooks: {
    '*': { before_: [{ id: 'log', description: 'aviso' }] },
    'implement-task': { after_: [{ id: 'check', description: 'verificar' }] },
  } };
  const root = installWithHooks(documented);
  try {
    assert.throws(() => loadHooksPolicy({ installRoot: root }),
      (e) => e.code === 'POLICY_MALFORMED' && /phase/.test(e.message));
  } finally { cleanup(root); }
});

test('unknown phases and malformed phase/command containers are rejected', () => {
  for (const hooks of [
    { before_: { '*': [] } }, // spec-kit spelling is not a phase
    { during: { '*': [] } },
    { before: [{ id: 'x', description: 'd' }] }, // phase value not an object
    { before: { '*': 'not-an-array' } },
    { before: { 'BAD CMD': [] } }, // command key must be a slug
  ]) {
    const root = installWithHooks({ schemaVersion: 1, hooks });
    try {
      assert.throws(() => loadHooksPolicy({ installRoot: root }),
        (e) => e.code === 'POLICY_MALFORMED', JSON.stringify(hooks));
    } finally { cleanup(root); }
  }
});

test('hook entries require {id, description} and reject unknown keys', () => {
  for (const hook of [
    { id: 'x' }, // missing description
    { description: 'd' }, // missing id
    { id: 'BAD ID', description: 'd' }, // id must be a slug
    { id: 'x', description: 'd', run: 'arbitrary' }, // unknown key
  ]) {
    const root = installWithHooks({ schemaVersion: 1,
      hooks: { before: { '*': [hook] } } });
    try {
      assert.throws(() => loadHooksPolicy({ installRoot: root }),
        (e) => e.code === 'POLICY_MALFORMED', JSON.stringify(hook));
    } finally { cleanup(root); }
  }
});

test('document shape is validated: schemaVersion 1 and object hooks', () => {
  for (const doc of [
    { schemaVersion: 2, hooks: {} },
    { schemaVersion: 1, hooks: [] },
    { schemaVersion: 1, hooks: {}, surprise: true }, // unknown top key
    null,
  ]) {
    const root = installWithHooks(doc);
    try {
      assert.throws(() => loadHooksPolicy({ installRoot: root }),
        (e) => e.code === 'POLICY_MALFORMED', JSON.stringify(doc));
    } finally { cleanup(root); }
  }
});

// --- preAction: bounded executable layer -------------------------------------
// Design contract: `when` conditions are closed keys over task metadata,
// `then` is a declared enum effect (block | require-gate | record). The
// evaluator is pure data — no argv, no scripts, no side effects. `block`
// prunes from permitted (enforced); `require-gate` flags (advisory);
// `record` annotates only.

function installWithPreAction(preAction) {
  return installWithHooks({ schemaVersion: 1, hooks: {}, preAction });
}

const TASK = { id: 't', state: 'ACT', scope: ['a', 'b'],
  skills: ['contract-execution'] };

test('preAction is optional; a missing or empty list leaves actions untouched', () => {
  for (const doc of [
    { schemaVersion: 1, hooks: {} },
    { schemaVersion: 1, hooks: {}, preAction: [] },
  ]) {
    const root = installWithHooks(doc);
    try {
      const r = applyPreActionHooks(TASK, ['read', 'edit'],
        { installRoot: root });
      assert.deepEqual(r, { permitted: ['read', 'edit'], applied: [],
        gated: [] });
    } finally { cleanup(root); }
  }
});

test('preAction schema is closed: malformed entries fail POLICY_MALFORMED', () => {
  const bad = [
    'not-an-object',
    { when: { action: 'edit' }, then: 'block' }, // missing id
    { id: 'BAD ID', when: { action: 'edit' }, then: 'block' },
    { id: 'x', then: 'block' }, // missing when
    { id: 'x', when: {}, then: 'block' }, // missing when.action
    { id: 'x', when: { action: 'edit' } }, // missing then
    { id: 'x', when: { action: 'edit' }, then: 'exec' }, // enum closed
    { id: 'x', when: { action: 'edit' }, then: 'block',
      command: 'rm -rf /' }, // unknown key — no argv ever
    { id: 'x', when: { action: 'edit', shell: 'x' }, then: 'block' },
    { id: 'x', when: { action: 'edit', stateIn: [] }, then: 'block' },
    { id: 'x', when: { action: 'edit', stateIn: ['act'] }, then: 'block' },
    { id: 'x', when: { action: 'edit', scopeOver: -1 }, then: 'block' },
    { id: 'x', when: { action: 'edit', scopeOver: 1.5 }, then: 'block' },
    { id: 'x', when: { action: 'edit', skillsMissing: 'no' },
      then: 'block' },
    { id: 'x', when: { action: 'edit' }, then: 'block', reason: 5 },
  ];
  for (const entry of bad) {
    const root = installWithPreAction([entry]);
    try {
      assert.throws(() => loadHooksPolicy({ installRoot: root }),
        (e) => e.code === 'POLICY_MALFORMED', JSON.stringify(entry));
    } finally { cleanup(root); }
  }
});

test('preAction.block prunes the action from permitted and is traced', () => {
  const root = installWithPreAction([
    { id: 'no-verify-in-act', when: { action: 'verify', stateIn: ['ACT'] },
      then: 'block', reason: 'verify only from VERIFY' },
  ]);
  try {
    const r = applyPreActionHooks(TASK, ['read', 'edit', 'verify'],
      { installRoot: root });
    assert.deepEqual(r.permitted, ['read', 'edit']);
    assert.deepEqual(r.gated, []);
    assert.deepEqual(r.applied,
      [{ id: 'no-verify-in-act', action: 'verify', effect: 'block',
        reason: 'verify only from VERIFY' }]);
    // Same hook does not match in a different state.
    const other = applyPreActionHooks({ ...TASK, state: 'VERIFY' },
      ['read', 'verify'], { installRoot: root });
    assert.deepEqual(other.permitted, ['read', 'verify']);
    assert.deepEqual(other.applied, []);
  } finally { cleanup(root); }
});

test('preAction.require-gate keeps the action but flags it on gated', () => {
  const root = installWithPreAction([
    { id: 'gate-large-scope', when: { action: 'edit', scopeOver: 1 },
      then: 'require-gate', reason: 'scope above 1 needs approval' },
  ]);
  try {
    const r = applyPreActionHooks(TASK, ['read', 'edit'],
      { installRoot: root });
    assert.deepEqual(r.permitted, ['read', 'edit']); // not pruned
    assert.deepEqual(r.gated, [{ action: 'edit', hook: 'gate-large-scope',
      reason: 'scope above 1 needs approval' }]);
    // scopeOver is strict: scope.length === 1 does not match > 1.
    const small = applyPreActionHooks({ ...TASK, scope: ['a'] },
      ['edit'], { installRoot: root });
    assert.deepEqual(small.gated, []);
  } finally { cleanup(root); }
});

test('preAction.record annotates without restricting; wildcard matches all', () => {
  const root = installWithPreAction([
    { id: 'audit-all', when: { action: '*' }, then: 'record',
      reason: 'trace' },
  ]);
  try {
    const r = applyPreActionHooks(TASK, ['read', 'edit'],
      { installRoot: root });
    assert.deepEqual(r.permitted, ['read', 'edit']);
    assert.deepEqual(r.gated, []);
    assert.deepEqual(r.applied.map((a) => a.action), ['read', 'edit']);
  } finally { cleanup(root); }
});

test('preAction.skillsMissing matches when the task lacks any listed skill', () => {
  const root = installWithPreAction([
    { id: 'need-capabilities',
      when: { action: 'edit',
        skillsMissing: ['contract-execution', 'verify-evidence'] },
      then: 'require-gate' },
  ]);
  try {
    // TASK has contract-execution but lacks verify-evidence → matches.
    const hit = applyPreActionHooks(TASK, ['edit'], { installRoot: root });
    assert.equal(hit.gated.length, 1);
    // Task holding both skills → no match.
    const miss = applyPreActionHooks(
      { ...TASK, skills: ['contract-execution', 'verify-evidence'] },
      ['edit'], { installRoot: root });
    assert.deepEqual(miss.gated, []);
    // Task without the field at all → treated as empty skill set.
    const bare = applyPreActionHooks({ id: 't', state: 'ACT', scope: [] },
      ['edit'], { installRoot: root });
    assert.equal(bare.gated.length, 1);
  } finally { cleanup(root); }
});

test('block wins over require-gate when multiple hooks match one action', () => {
  const root = installWithPreAction([
    { id: 'g', when: { action: 'edit' }, then: 'require-gate' },
    { id: 'b', when: { action: 'edit' }, then: 'block' },
  ]);
  try {
    const r = applyPreActionHooks(TASK, ['read', 'edit'],
      { installRoot: root });
    assert.deepEqual(r.permitted, ['read']);
    // Both effects are still declared on the trace — nothing silent.
    assert.deepEqual(r.applied.map((a) => a.id), ['g', 'b']);
  } finally { cleanup(root); }
});

test('preAction.scopeOverlapIn matches peers in the listed states only', () => {
  const root = installWithPreAction([
    { id: 'overlap-act',
      when: { action: 'edit', scopeOverlapIn: ['ACT'] },
      then: 'require-gate', reason: 'concurrent write region' },
    { id: 'overlap-block',
      when: { action: 'verify', scopeOverlapIn: ['ACT', 'VERIFY'] },
      then: 'block', reason: 'no verify over a contested region' },
  ]);
  try {
    // TASK: { id: 't', state: 'ACT', scope: ['a', 'b'] }
    const peers = [
      { id: 'p-act', state: 'ACT', scope: ['a/x'] }, // inside 'a'
      { id: 'p-plan', state: 'PLAN', scope: ['b'] }, // wrong state
      { id: 't', state: 'ACT', scope: ['a', 'b'] }, // self — excluded
      { id: 'p-empty', state: 'ACT', scope: [] }, // no write region
      { id: 'p-far', state: 'ACT', scope: ['elsewhere'] },
    ];
    const hit = applyPreActionHooks(TASK, ['edit', 'verify'],
      { installRoot: root, peers });
    // edit: only p-act qualifies → gated, kept in permitted.
    assert.deepEqual(hit.permitted, ['edit']);
    assert.deepEqual(hit.gated, [{ action: 'edit', hook: 'overlap-act',
      reason: 'concurrent write region' }]);
    const editEntry = hit.applied.find((a) => a.id === 'overlap-act');
    assert.deepEqual(editEntry.with, ['p-act']);
    // verify: p-act qualifies for the block list too.
    const verifyEntry = hit.applied.find((a) => a.id === 'overlap-block');
    assert.deepEqual(verifyEntry.with, ['p-act']);
    // Prefix in the other direction: peer 'a' contains task entry 'a/x'.
    const up = applyPreActionHooks({ ...TASK, scope: ['a/x'] }, ['edit'],
      { installRoot: root,
        peers: [{ id: 'p', state: 'ACT', scope: ['a'] }] });
    assert.equal(up.gated.length, 1);
    // No peers supplied → the condition cannot match.
    const noPeers = applyPreActionHooks(TASK, ['edit'],
      { installRoot: root });
    assert.deepEqual(noPeers.gated, []);
    // Empty task scope declares no write region → no overlap.
    const emptyScope = applyPreActionHooks({ ...TASK, scope: [] }, ['edit'],
      { installRoot: root, peers });
    assert.deepEqual(emptyScope.gated, []);
  } finally { cleanup(root); }
});

test('preAction.scopeOverlapIn schema is closed like stateIn', () => {
  for (const w of [
    { action: 'edit', scopeOverlapIn: 'ACT' },
    { action: 'edit', scopeOverlapIn: [] },
    { action: 'edit', scopeOverlapIn: ['act'] },
    { action: 'edit', scopeOverlapIn: [42] },
  ]) {
    const root = installWithPreAction([{ id: 'x', when: w, then: 'block' }]);
    try {
      assert.throws(() => loadHooksPolicy({ installRoot: root }),
        (e) => e.code === 'POLICY_MALFORMED', JSON.stringify(w));
    } finally { cleanup(root); }
  }
});
