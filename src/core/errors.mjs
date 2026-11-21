// SPDX-License-Identifier: Apache-2.0
// Scopegrain error primitive: {code, message} carried on Error instances.
export class TaskError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TaskError';
    this.code = code;
  }
}

export function err(code, message) {
  return new TaskError(code, message);
}

export function isTaskError(e) {
  return e instanceof TaskError;
}

// Retryable codes come from concurrency or transient fs behavior; callers
// may re-attempt after refreshing state. Semantic rejections are final.
const RETRYABLE_CODES = new Set([
  'CAS_MISMATCH', 'REVISION_MISMATCH', 'STATE_CONFLICT', 'WRITE_FAILED',
  'JOURNAL_BUSY', 'LOCKED', 'ETIMEDOUT', 'EBUSY', 'EAGAIN',
]);

export function isRetryable(code) {
  return RETRYABLE_CODES.has(code);
}

export function toErrorPayload(e) {
  if (isTaskError(e)) {
    return { code: e.code, message: e.message, retryable: isRetryable(e.code) };
  }
  const msg = e && e.message ? String(e.message) : String(e);
  return { code: 'INTERNAL', message: msg, retryable: false };
}
