// SPDX-License-Identifier: Apache-2.0
// Local token estimation. The harness never observes the host's real
// token usage, so every surface reports this deterministic heuristic
// instead — bytes of UTF-8 divided by four — under `estimatedTokens`/
// `estimator` names, never bare `tokens`.
export const TOKEN_ESTIMATOR = 'utf8-bytes/4';

export function estimateTokens(text) {
  if (typeof text !== 'string') {
    throw new TypeError('estimateTokens expects a string');
  }
  const bytes = Buffer.byteLength(text.replace(/\r\n/g, '\n'), 'utf8');
  return {
    estimatedTokens: Math.ceil(bytes / 4),
    estimator: TOKEN_ESTIMATOR,
    bytes,
  };
}

export function estimateJson(value) {
  return estimateTokens(JSON.stringify(value));
}
