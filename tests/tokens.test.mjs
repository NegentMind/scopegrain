// SPDX-License-Identifier: Apache-2.0
// Local token estimator: deterministic utf8-bytes/4 heuristic, never
// the host tokenizer. Pure function, no fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateJson, estimateTokens, TOKEN_ESTIMATOR,
} from '../src/core/tokens.mjs';

test('empty string estimates zero tokens and zero bytes', () => {
  assert.deepEqual(estimateTokens(''), {
    estimatedTokens: 0, estimator: TOKEN_ESTIMATOR, bytes: 0,
  });
});

test('ASCII text measures bytes exactly and rounds up by four', () => {
  assert.deepEqual(estimateTokens('abcd'), {
    estimatedTokens: 1, estimator: TOKEN_ESTIMATOR, bytes: 4,
  });
  assert.equal(estimateTokens('abcde').estimatedTokens, 2);
  assert.equal(estimateTokens('hello world').estimatedTokens, 3);
});

test('non-ASCII text counts UTF-8 bytes, not characters', () => {
  const accents = estimateTokens('áéí');
  assert.equal(accents.bytes, 6);
  assert.equal(accents.estimatedTokens, 2);
  const cjk = estimateTokens('日本語');
  assert.equal(cjk.bytes, 9);
  assert.equal(cjk.estimatedTokens, 3);
  const emoji = estimateTokens('😀');
  assert.equal(emoji.bytes, 4);
  assert.equal(emoji.estimatedTokens, 1);
  const combined = estimateTokens('👍🏽');
  assert.equal(combined.bytes, 8);
  assert.equal(combined.estimatedTokens, 2);
});

test('CRLF normalizes to LF before measuring', () => {
  assert.deepEqual(estimateTokens('a\r\nb\r\n'), estimateTokens('a\nb\n'));
});

test('estimation is deterministic', () => {
  const text = 'una línea\r\n日本語 😀';
  assert.deepEqual(estimateTokens(text), estimateTokens(text));
});

test('non-string input throws TypeError', () => {
  for (const value of [1, {}, [], null, undefined, true]) {
    assert.throws(() => estimateTokens(value), TypeError);
  }
});

test('estimateJson matches the serialized form and stays deterministic', () => {
  const value = { a: 1, b: ['x', 'á'], c: { d: null } };
  assert.deepEqual(estimateJson(value),
    estimateTokens(JSON.stringify(value)));
  assert.deepEqual(estimateJson(value), estimateJson(value));
});
