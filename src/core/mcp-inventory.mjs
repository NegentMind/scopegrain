// SPDX-License-Identifier: Apache-2.0
// Formal MCP tool inventory (spec-kit parity): every registered tool gets
// an explicit contract entry with disposition, contract version,
// capability metadata and network posture. The inventory is derived from
// the live tool descriptors, so it can never drift from what the server
// actually registers.

import { operationDescriptor } from './operations.mjs';

export const MCP_CONTRACT_VERSION = '1';

const disposition = (t) =>
  t.config?.annotations?.readOnlyHint === true ? 'read-only' : 'local-write';

// `tools` is the array returned by createMCPTools (post-strictify).
// Each entry embeds the shared-operation descriptor (typed request /
// result / capabilities / retryable errors) so the inventory doubles as
// the transport-neutral contract surface for CLI and MCP consumers.
export function buildMcpInventory(tools) {
  return tools.map((t) => {
    const op = operationDescriptor(t);
    return Object.freeze({
      name: t.name,
      disposition: disposition(t),
      contract_version: MCP_CONTRACT_VERSION,
      capabilities: {
        arguments: Object.keys(t.config?.inputSchema ?? {}),
        destructive: t.config?.annotations?.destructiveHint === true,
        open_world: t.config?.annotations?.openWorldHint === true,
      },
      // The MCP boundary is local stdio; tools never reach the network.
      network: 'never',
      // Local-write tools still go through bounded CAS/append core paths;
      // a retry is safe because writes are idempotent or version-checked.
      retryable: true,
      operation: op,
    });
  });
}
