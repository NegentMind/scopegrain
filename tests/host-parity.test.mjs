// SPDX-License-Identifier: Apache-2.0
// Host binding parity: canonical source sets across activation plans.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hostParity } from '../src/hosts/parity.mjs';
import { bootstrappedCtx, cleanup, VALID_ANSWERS } from './helpers.mjs';

const HOSTS = VALID_ANSWERS.hosts; // claude, codex, opencode, devin

test('parity reports coverage, drift and structural absence per host', () => {
  const { dir, ctx } = bootstrappedCtx(VALID_ANSWERS);
  try {
    const r = hostParity(ctx, { hosts: HOSTS });
    assert.equal(typeof r.ok, 'boolean');
    assert.deepEqual(Object.keys(r.coverage).sort(), [...HOSTS].sort());
    for (const h of Object.keys(r.coverage)) {
      assert.ok(r.coverage[h].resources > 0, `${h} projects resources`);
    }
    for (const d of r.drift) {
      assert.ok(d.source.includes('/') && d.missingFrom.length > 0);
    }
    // codex emits no agent/* files — every agent absence must classify
    // as structural, never as unexpected drift.
    const unexpectedAgents = r.drift.filter(
      (d) => d.source.startsWith('agent/'));
    assert.equal(unexpectedAgents.length, 0);
  } finally { cleanup(dir); }
});

test('parity rejects unselected and unknown hosts', () => {
  const { dir, ctx } = bootstrappedCtx(VALID_ANSWERS);
  try {
    assert.throws(
      () => hostParity(ctx, { hosts: ['hermes'] }),
      (e) => e.code === 'HOST_NOT_SELECTED');
    assert.throws(
      () => hostParity(ctx, { hosts: ['bogus'] }),
      (e) => e.code === 'UNKNOWN_HOST');
  } finally { cleanup(dir); }
});
