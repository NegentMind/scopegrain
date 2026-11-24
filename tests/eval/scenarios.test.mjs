// SPDX-License-Identifier: Apache-2.0
// Runs every declarative scenario in tests/eval/scenarios/ twice: once
// against the real bin/scopegrain.mjs spawned as a child process and once
// through the in-process run(), asserting step expectations in both and
// requiring identical normalized envelopes (cross-mode parity).
// Opt-in suite — not picked up by `npm test` (tests/*.test.mjs is flat).
// Run: node --test tests/eval/scenarios.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listScenarios, normalizedEnvelopes, runScenario,
} from './lib/driver.mjs';

for (const entry of listScenarios()) {
  test(`scenario ${entry.name}: process + inproc parity`, async (t) => {
    const proc = await runScenario(entry.scenario, { mode: 'process' });
    const inproc = await runScenario(entry.scenario, { mode: 'inproc' });
    try {
      const fmt = (run) => run.failures
        .map((f) => `step ${f.step} ${JSON.stringify(f.cmd)}: ${f.message}`)
        .join('\n');
      assert.deepEqual(proc.failures, [],
        `process-mode failures:\n${fmt(proc)}`);
      assert.deepEqual(inproc.failures, [],
        `inproc-mode failures:\n${fmt(inproc)}`);
      // Parity: normalized envelopes must be identical between the
      // spawned binary and the library entry point.
      assert.deepEqual(
        normalizedEnvelopes(inproc), normalizedEnvelopes(proc),
        'process/inproc envelopes diverge');
    } finally {
      proc.cleanup();
      inproc.cleanup();
    }
    t.diagnostic(`project was ${proc.projectRoot}`);
  });
}
