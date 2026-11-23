// SPDX-License-Identifier: Apache-2.0
// withEnv fixture: exact prior-state restoration so a developer's exported
// env can never leak into a test (or between tests in this file's process).
import test from 'node:test';
import assert from 'node:assert/strict';
import { withEnv } from './helpers.mjs';

const KEY = 'SCOPEGRAIN_TESTENV_SCRATCH';

test('withEnv restores a pre-existing value after the callback', () => {
  process.env[KEY] = 'outer';
  try {
    const seen = withEnv({ [KEY]: 'inner' }, () => process.env[KEY]);
    assert.equal(seen, 'inner');
    assert.equal(process.env[KEY], 'outer');
  } finally { delete process.env[KEY]; }
});

test('withEnv restores prior absence — absent is not the same as empty', () => {
  delete process.env[KEY];
  withEnv({ [KEY]: 'inner' }, () => {
    assert.equal(process.env[KEY], 'inner');
  });
  assert.equal(Object.hasOwn(process.env, KEY), false);
  // Distinguish absent from empty-string: both directions preserved.
  process.env[KEY] = '';
  try {
    withEnv({ [KEY]: null }, () => {
      assert.equal(Object.hasOwn(process.env, KEY), false);
    });
    assert.equal(process.env[KEY], '');
    assert.equal(Object.hasOwn(process.env, KEY), true);
  } finally { delete process.env[KEY]; }
});

test('withEnv restores when the callback throws', () => {
  delete process.env[KEY];
  assert.throws(() => withEnv({ [KEY]: 'boom' }, () => {
    throw new Error('callback failure');
  }), /callback failure/);
  assert.equal(Object.hasOwn(process.env, KEY), false);
});

test('withEnv keeps vars through an async body and restores on settle', async () => {
  process.env[KEY] = 'outer-async';
  try {
    let during;
    await withEnv({ [KEY]: 'inner-async' }, async () => {
      await new Promise((r) => setTimeout(r, 10));
      during = process.env[KEY];
    });
    assert.equal(during, 'inner-async');
    assert.equal(process.env[KEY], 'outer-async');
    // Rejection path restores too.
    await assert.rejects(withEnv({ [KEY]: 'rejected' }, async () => {
      await new Promise((r) => setTimeout(r, 5));
      throw new Error('async failure');
    }), /async failure/);
    assert.equal(process.env[KEY], 'outer-async');
  } finally { delete process.env[KEY]; }
});

test('withEnv without a callback returns a manual restore handle', () => {
  delete process.env[KEY];
  const restore = withEnv({ [KEY]: 'manual' });
  assert.equal(process.env[KEY], 'manual');
  restore();
  assert.equal(Object.hasOwn(process.env, KEY), false);
});
