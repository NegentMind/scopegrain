// SPDX-License-Identifier: Apache-2.0
// loadPolicy authored-graph pinning: transitions, actions and the
// acceptance contract in policy/workflow.json are declared policy, not
// tunables. Any divergence fails closed with POLICY_INVALID at load —
// before a forged edge (e.g. REVIEW -> CLOSE) can bypass the universal
// ACCEPT gate. Fixture copies the loader plus a mutable policy file;
// the canonical file is never touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { makeTempDir, cleanup } from './helpers.mjs';

const SRC = 'src/core';
const FIXTURE_FILES = ['policy.mjs', 'errors.mjs', 'fsx.mjs'];
const POLICY_SRC = 'policy/workflow.json';

function makeFixture() {
  const dir = makeTempDir('pa-');
  fs.mkdirSync(`${dir}/src/core`, { recursive: true });
  fs.mkdirSync(`${dir}/policy`, { recursive: true });
  for (const f of FIXTURE_FILES) {
    fs.copyFileSync(`${SRC}/${f}`, `${dir}/src/core/${f}`);
  }
  fs.copyFileSync(POLICY_SRC, `${dir}/policy/workflow.json`);
  return dir;
}

const loadMod = (dir, tag) =>
  import(pathToFileURL(`${dir}/src/core/policy.mjs`).href
    + `?case=${tag}`);
const writePol = (dir, v) => fs.writeFileSync(
  `${dir}/policy/workflow.json`, JSON.stringify(v, null, 2) + '\n');
const BASE = JSON.parse(fs.readFileSync(POLICY_SRC, 'utf8'));
const invalid = (e) => e.name === 'TaskError' && e.code === 'POLICY_INVALID';

test('baseline: canonical workflow.json loads, deep-frozen', async () => {
  const dir = makeFixture();
  try {
    const m = await loadMod(dir, 'base');
    const p = m.loadPolicy();
    assert.equal(p.initial, 'PLAN');
    assert.ok(Object.isFrozen(p));
    assert.ok(Object.isFrozen(p.transitions.REVIEW));
    assert.ok(Object.isFrozen(p.acceptance));
  } finally { cleanup(dir); }
});

const cases = [
  ['universal-gate bypass: forged REVIEW->CLOSE edge',
    (d) => { d.transitions.REVIEW.push('CLOSE'); }],
  ['removed edge: ACCEPT loses CLOSE',
    (d) => { d.transitions.ACCEPT = ['ACT', 'STALL', 'ABANDON']; }],
  ['extra transition state',
    (d) => { d.transitions.BYPASS = ['CLOSE']; }],
  ['missing transition state',
    (d) => { delete d.transitions.REVIEW; }],
  ['edge re-target: VERIFY->ACCEPT',
    (d) => { d.transitions.VERIFY[0] = 'ACCEPT'; }],
  ['action grant: REVIEW gains edit',
    (d) => { d.actions.REVIEW.push('edit'); }],
  ['missing actions state', (d) => { delete d.actions.ACT; }],
  ['acceptance: relaxed verdict',
    (d) => { d.acceptance.reviewVerdict = 'reject'; }],
  ['acceptance: fail becomes acceptable',
    (d) => { d.acceptance.verificationStatuses.push('fail'); }],
  ['acceptance: extra recordable verdict',
    (d) => { d.acceptance.recordableReviewVerdicts.push('maybe'); }],
  ['acceptance: waiver fields dropped',
    (d) => { d.acceptance.waiverRequiredFields = []; }],
  ['acceptance: key removed',
    (d) => { delete d.acceptance.freshContextsMustDiffer; }],
  ['acceptance: key added', (d) => { d.acceptance.extra = true; }],
  ['initial state moved', (d) => { d.initial = 'REVIEW'; }],
  ['extra root block', (d) => { d.tunables = {}; }],
  ['removed root block', (d) => { delete d.execution; }],
];

for (const [label, mutate] of cases) {
  test(`authored pin: ${label} -> POLICY_INVALID`, async () => {
    const dir = makeFixture();
    try {
      const bad = JSON.parse(JSON.stringify(BASE));
      mutate(bad);
      writePol(dir, bad);
      const m = await loadMod(dir, label.replace(/\W+/g, '-'));
      assert.throws(() => m.loadPolicy(), invalid);
    } finally { cleanup(dir); }
  });
}

test('cache not poisoned: divergent then repaired reloads fine', async () => {
  const dir = makeFixture();
  try {
    const bad = JSON.parse(JSON.stringify(BASE));
    bad.transitions.REVIEW.push('CLOSE');
    writePol(dir, bad);
    const m = await loadMod(dir, 'no-poison');
    assert.throws(() => m.loadPolicy(), invalid);
    writePol(dir, BASE);
    assert.equal(m.loadPolicy().initial, 'PLAN');
  } finally { cleanup(dir); }
});
