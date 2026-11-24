// SPDX-License-Identifier: Apache-2.0
// Golden-session replay: for each committed fixture in
// tests/eval/fixtures/*.golden.json, re-executes the recorded steps
// against the real binary in a fresh temp project and requires the
// normalized envelopes and the canonical state-tree hash to match the
// recording byte-for-byte (modulo UUIDs, timestamps and temp roots).
// Record/refresh fixtures with: node tests/eval/run-scenarios.mjs --record
// Run: node --test tests/eval/golden.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { listFixtures, replayFixture } from './lib/driver.mjs';

const fixtures = listFixtures();

test('golden fixtures exist (record with --record)', () => {
  assert.ok(fixtures.length > 0,
    'no fixtures found under tests/eval/fixtures/');
});

for (const entry of fixtures) {
  test(`golden replay ${entry.name}`, async () => {
    const diffs = await replayFixture(entry.fixture);
    assert.deepEqual(diffs, [], `golden drift:\n${diffs.join('\n')}`);
  });
}
