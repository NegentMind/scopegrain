<!-- translated-from: docs/mcp-http-eval.md @ 2026-11-24 -->
# Evaluation: Streamable HTTP transport for the MCP server

> English translation of the canonical Spanish document
> (`../mcp-http-eval.md`). The Spanish version prevails.

> Evaluation from the 2026-11-24 audit. Status: **the MCP server is
> stdio-only today** (`src/mcp/server.mjs:805-812`; `server.json`
> declares `"transport": {"type": "stdio"}`). No HTTP-MCP code exists.
> This is a design evaluation, not an authorized implementation plan.

## 1. Verified current state

| Piece | Status | Reference |
|---|---|---|
| Transport | Single `StdioServerTransport`; importing the module starts nothing | `src/mcp/server.mjs:805-812` |
| Server/transport split | `createMCPServer({project,config})` returns `{server, ctx}` **without connecting a transport** — the injection seam already exists | `src/mcp/server.mjs:787-803` |
| Tools | 37 tools with handlers closing over a single `ctx` (one project, one config); strict input via `strictify` + zod `.strict()`; honest annotations (`readOnlyHint`, `openWorldHint`) | `src/mcp/server.mjs:139-166, 169-779` |
| SDK | `@modelcontextprotocol/sdk@1.32.2` ships `server/streamableHttp.js` (`StreamableHTTPServerTransport`) and auth middleware (`server/auth/`) | `node_modules/@modelcontextprotocol/sdk/dist/esm/server/` |
| Reusable pattern | `src/api/server.mjs`: literal-loopback bind only (`LOOPBACK_HOSTS`), anti-DNS-rebinding guard `requestOriginAllowed` (Host must be a loopback literal/`localhost`; Origin, when present, likewise), whitelisted routes, bounded body | `src/api/server.mjs:28-32, 222-262, 276-303` |

## 2. What the Streamable HTTP transport requires (MCP spec)

- Single endpoint accepting `POST` (JSON-RPC), `GET` (SSE stream for
  server→client messages) and `DELETE` (session teardown).
- `Mcp-Session-Id` header in stateful mode; a *stateless* mode exists
  (one transport per request).
- **Mandatory security per the spec**: `Origin` validation (DNS
  rebinding mitigation — exactly the `requestOriginAllowed` pattern),
  loopback binding recommended for local servers, and authentication
  (OAuth 2.1 as a resource server; for a loopback endpoint a static
  bearer token is the honest minimum).

## 3. Realistic cost estimate

Components on top of the existing seam:

| Piece | Est. LOC | Notes |
|---|---|---|
| `node:http` server + endpoint routing | ~60-90 | Reuse the `createApiServer` shape (literal bind, `MAX_URL_BYTES`, bounded body — `readBoundedBody` already exists) |
| Host/Origin guard | ~40 | Copy `requestOriginAllowed`/`TRUSTED_HOSTNAMES` almost verbatim; the spec mandates it |
| Bearer auth | ~30-60 | Timing-safe `Authorization: Bearer <token>` comparison; token generated at startup or in config, never in visible argv |
| Sessions | ~50-120 | Two options: **stateless** (new transport per request — viable because tools hold no MCP session state) or **stateful** (`sessionId → transport` map, TTL, DELETE cleanup) |
| CLI verb + wiring | ~30 | `scopegrain mcp --transport http [--host 127.0.0.1 --port N]` |

**Realistic total: ~200-350 LOC** in a new `src/mcp/http.mjs` plus
touches in `cli.mjs`. The brief's estimate (150-300) is right in
magnitude, perhaps optimistic if full stateful session lifecycle is
included.

What does NOT change: the 37 tools, `strictify`, zod,
`createMCPServer` — all transport-agnostic by SDK design.

## 4. Added risks (FMEA)

| Risk | Mitigation | Residual |
|---|---|---|
| DNS rebinding from a browser | `requestOriginAllowed` (loopback-literal Host+Origin) — pattern already tested in `api-server.test.mjs` | Low if reused verbatim |
| Unauthenticated loopback endpoint | Bearer token + literal bind | Any local process under the same user could read the token if it sits in a readable file — same boundary as the whole threat model |
| stdout leakage | n/a — HTTP does not use stdio; current stderr logging stays | None |
| Zombie sessions | TTL + session cap + `server.close()` on SIGTERM | Medium if stateful; nil in stateless |
| `Mcp-Session-Id` replay | UUID v4 + in-memory map | Low on loopback |
| Larger surface vs stdio | Inherent: stdio inherits parent-process isolation (host spawns it); HTTP exposes a socket to EVERY local process | This is the main cost, not the LOC |

## 5. When it is worth it

- **Yes**: hosts/consumers that cannot spawn stdio — an MCP client in a
  container, a web IDE, a gateway multiplexing several projects, access
  from another LAN machine (which would additionally demand TLS + real
  auth — outside the local-first scope).
- **Not now**: the five supported hosts (`devin`, `claude`, `codex`,
  `antigravity`, `opencode`) consume MCP over stdio; `server.json`
  already declares stdio for the registry. No real consumer asks for
  HTTP today.

## 6. Recommendation

**Defer.** Stdio is strictly superior for the current use case: zero
socket surface, auth inherited from the spawn, and it is the transport
hosts and the MCP Registry expect. The cost is not the ~300 LOC — it
is maintaining a second security surface (auth, sessions, rebinding)
with its own test set and threat model.

If a concrete consumer appears, the lowest-risk path is:

1. A new `src/mcp/http.mjs` reusing `createMCPServer` (the seam already
   exists).
2. Copy `LOOPBACK_HOSTS`/`TRUSTED_HOSTNAMES`/`requestOriginAllowed`
   literally from `src/api/server.mjs` (or extract them into a shared
   module — better, avoids divergence).
3. **Stateless** mode by default (tools use no MCP session state);
   stateful only if a client demands it.
4. Mandatory bearer token even on loopback; ephemeral port by default
   (`port: 0`).
5. Update `server.json` only if the registry supports declaring
   alternative transports (verify at that time; today it declares
   stdio).
