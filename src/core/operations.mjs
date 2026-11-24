// SPDX-License-Identifier: Apache-2.0
// Shared-operation descriptors (spec-kit parity): one transport-neutral
// contract per operation so CLI and MCP expose the same typed request /
// result / capability / error metadata. Descriptors are derived from the
// live tool descriptors where possible; the retryability taxonomy is the
// authoritative classification for structured errors.

import { isRetryable } from './errors.mjs';

export { isRetryable };

// Structured error descriptor attached to every operation.
export function operationErrors(kind) {
  const base = [
    { code: 'INVALID_ARGS', retryable: false },
    { code: 'INVALID_STATE', retryable: false },
    { code: 'MALFORMED', retryable: false },
    { code: 'NOT_FOUND', retryable: false },
    { code: 'FORBIDDEN_PATH', retryable: false },
  ];
  if (kind === 'local-write') {
    base.push(
      { code: 'CAS_MISMATCH', retryable: true },
      { code: 'REVISION_MISMATCH', retryable: true },
      { code: 'STATE_CONFLICT', retryable: true },
      { code: 'WRITE_FAILED', retryable: true },
      { code: 'APPROVAL_REQUIRED', retryable: false },
    );
  }
  return base;
}

const kindOf = (t) =>
  t.config?.annotations?.readOnlyHint === true ? 'read-only' : 'local-write';

// Typed request descriptor: argument name -> {required}. Required is
// probed by asking the zod schema whether undefined is valid input, so the
// descriptor always matches the runtime contract (no parallel table).
function requestDescriptor(t) {
  const params = {};
  for (const [name, schema] of Object.entries(t.config?.inputSchema ?? {})) {
    let required = true;
    try {
      required = !(schema && typeof schema.safeParse === 'function'
        && schema.safeParse(undefined).success);
    } catch { /* schema uninspectable: treat as required */ }
    params[name] = { required };
  }
  return params;
}

// One transport-neutral operation descriptor per tool.
export function operationDescriptor(t) {
  const kind = kindOf(t);
  return Object.freeze({
    name: t.name.replace(/^scopegrain_/, ''),
    tool: t.name,
    kind,
    contract_version: '1',
    request: requestDescriptor(t),
    result: { format: 'json', streaming: false },
    capabilities: {
      project_only: true,
      destructive: t.config?.annotations?.destructiveHint === true,
      open_world: t.config?.annotations?.openWorldHint === true,
    },
    network: t.config?.annotations?.openWorldHint === true
      ? 'local' : 'never',
    errors: operationErrors(kind),
  });
}

export function buildOperationRegistry(tools) {
  const ops = {};
  for (const t of tools) {
    const d = operationDescriptor(t);
    ops[d.name] = d;
  }
  return Object.freeze(ops);
}
