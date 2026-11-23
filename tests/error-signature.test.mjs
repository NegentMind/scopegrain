// SPDX-License-Identifier: Apache-2.0
// Error-signature extraction + doctor escalation check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { errorSignature, failureSignatures } from '../src/core/error-signature.mjs';
import { appendWorklog } from '../src/core/worklog.mjs';
import { runDoctor } from '../src/core/doctor.mjs';
import { bootstrappedCtx, cleanup } from './helpers.mjs';

test('errorSignature normalizes volatile parts to placeholders', () => {
  const a = errorSignature(
    'Task 550e8400-e29b-41d4-a716-446655440000 failed in /tmp/x/file.mjs at 2026-11-23: timeout after 30s');
  const b = errorSignature(
    'Task 7c9e6679-7425-40de-944b-e07fc1f90ae7 failed in /home/u/file.mjs at 2026-11-24: timeout after 12s');
  assert.equal(a, b);
  assert.ok(!a.match(/\d{4}-\d{2}-\d{2}/));
});

test('failureSignatures counts only failure-looking text', () => {
  const map = failureSignatures([
    { summary: 'apply failed: EACCES on file one.ts' },
    { summary: 'apply failed: EACCES on file two.ts' },
    { summary: 'all good' },
    { outcome: 'fail' }, // no text — skipped
    null,
  ]);
  assert.equal(map.size, 1);
  assert.equal([...map.values()][0].count, 2);
});

test('doctor escalates a repeated error signature', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const r0 = runDoctor(ctx);
    const check0 = r0.checks.find((c) => c.name === 'error-signatures');
    assert.equal(check0.ok, true);
    for (const f of ['alpha.ts', 'beta.ts']) {
      appendWorklog(ctx, 'activity', {
        title: `verify failed on ${f}`,
        summary: `verify failed on ${f}: check suite exited 2`,
      });
    }
    const r1 = runDoctor(ctx);
    const check1 = r1.checks.find((c) => c.name === 'error-signatures');
    assert.equal(check1.ok, false);
    assert.match(check1.detail, /x2/);
  } finally { cleanup(dir); }
});
