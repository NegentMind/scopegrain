// SPDX-License-Identifier: Apache-2.0
// hooks-policy contract: the REAL accepted shape is phase-first —
// {before|after: {<command-id>|'*': [{id, description, command?}]}}.
// The example historically shown in cli-reference.md used the inverted
// command-first shape with before_/after_ keys; this suite pins both the
// real shape and the rejection of the documented one (doc fix is a
// separate wave — this test defines the ground truth).
import test from 'node:test';
import assert from 'node:assert/strict';
import { hooksFor, loadHooksPolicy } from '../src/core/hooks-policy.mjs';
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
      { before: {}, after: {} });
    assert.deepEqual(hooksFor('anything', { installRoot: root }),
      { before: [], after: [] });
  } finally { cleanup(root); }
});

test('shipped policy/hooks.json parses as the canonical empty policy', () => {
  assert.deepEqual(loadHooksPolicy(), { before: {}, after: {} });
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
    null,
  ]) {
    const root = installWithHooks(doc);
    try {
      assert.throws(() => loadHooksPolicy({ installRoot: root }),
        (e) => e.code === 'POLICY_MALFORMED', JSON.stringify(doc));
    } finally { cleanup(root); }
  }
});
