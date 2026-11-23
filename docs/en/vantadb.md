# VantaDB as the memory backend

Scopegrain can project `committed` journal events into a machine-shared
VantaDB instance. The integration is opt-in: nothing downloads, installs
or syncs without an explicit command.

## Components

- `src/integrations/vantadb.mjs` — internal projector (cooperative lease,
  readback, fail-closed `BRAIN_*`). Spawns no processes: takes `invoke`.
- `src/integrations/vantadb-runtime.mjs` — runtime: verified binary
  download, MCP stdio client (NDJSON JSON-RPC), enrollment and sync.
- `.scopegrain/vantadb.json` (or the chosen config dir) — backend
  enrollment: `{schemaVersion, backendId, version, binaryPath,
  binarySha256, storagePath}`. Closed document; absolute paths required.
  `binarySha256` is mandatory: the 64-hex digest pinned at enrollment is
  verified against the binary before every spawn, so a binary swapped
  after enrollment fails (`VANTADB_HASH_MISMATCH`/
  `VANTADB_CONFIG_MALFORMED`) instead of executing.

## Deployment model

- **Machine-shared instance**: one storage (default `~/.vantadb/data`).
  Each project writes into identity-derived namespaces: the formal
  projection uses the event scope
  (`sg-formal-v1-<scopeHash>`, `sg-snapshot-v1-<scopeHash>`) and the
  derived layers use the project identity
  (`l1/sg-<projectHash>`, `l3/sg-persona-<projectHash>`, where
  `projectHash` digests `{workspaceId, projectId, repositoryId}` from
  the workspace descriptor — no `areaIds`). Separation is by
  namespace, not by process.
- **Project-isolated rehydration**: the `vantadb.recall` section of the
  `context` packet reads ONLY the project's L1 namespace via
  `memory_search`. It does not use `memory_recall` because the
  engine's recall pool enumerates EVERY `l1/*` namespace filtering
  only on `agent_id`/`team_id` — values scopegrain pins to `default` —
  so the pool is machine-global and would inject other projects'
  memories. `memory_search` addressed at the project namespace is
  still cross-session recall (records persist in shared storage) but
  cannot surface foreign records. `vantadb recall` and
  `scopegrain_memory_recall` share the same default: without `scope`
  they query the project namespace via `memory_search`; an explicit
  `--scope session|agent|team` opts into the engine's global pool
  (`memory_recall`), whose output may include `l1/*` records from
  other projects or tools.
- **Auto-spawn per operation**: `sync`/`get` launch `vantadb-server --mcp`
  with `VANTADB_STORAGE_PATH`, speak JSON-RPC over stdio and the process
  exits on close. VantaDB's writer discovery (`.vanta.server.json`) covers
  concurrent clients on the same storage. The spawn environment is an
  explicit allowlist — the child receives only the pinned keys
  (`VANTADB_STORAGE_PATH`, `VANTADB_QUIET`, `VANTADB_MCP_PROFILE=brain`
  so restricted profiles reject unlisted tools,
  `VANTADB_MCP_INJECT_NAMESPACES=l1/,l3/` as the injection ACL — the l1/*
  pool plus the persona projection l3/sg-persona-*, never arbitrary
  namespaces such as `sg-formal-v1-*`,
  `VANTADB_MCP_ALLOW_TOOLS=capabilities,memory_get,memory_list,`
  `memory_list_namespaces,memory_put,memory_recall,memory_reinforce,`
  `memory_search` as a hard server-side allowlist — exactly the tools
  this client invokes; contract drift rejects with -32601 rather than
  dispatching a renamed tool,
  `VANTADB_DEDUP_POLICY=off` because the projector already enforces
  idempotent exact-key upserts with readback — semantic dedup would
  rewrite payloads silently, and
  `VANTADB_STRICT_EMBEDDINGS=true` for fail-closed embeddings — under
  strict mode the server rejects `embed_texts` and persists vectorless
  records with `fallback:true`+`warning` instead of synthetic vectors —
  the VB-6 contract verified live on `vantadb-server 0.9.0`): nothing
  else is inherited from the parent, so neither external `VANTADB_MCP_*`
  overrides nor credential-bearing variables can leak into the process.
- **Secret-free egress**: before any payload is projected or synced to
  the backend, `secretEgressCheck` screens it against sensitive file
  names (`.pem`, `id_rsa`, `credentials`, ...) and high-confidence
  credential content patterns (PEM private keys, GitHub/Slack/Google
  tokens, `password=`/`"apiKey":` with long values, ...). A hit blocks
  the projection returning only a pattern tag — the matched bytes are
  never copied into reports or logs.
- **Distribution**: official GitHub release assets (`ness-e/Vantadb`),
  verified against the `.sha256` sidecar before adoption. A mismatch
  yields `VANTADB_HASH_MISMATCH` and adopts nothing.

## Commands

```bash
# Preview (downloads and writes nothing)
scopegrain vantadb setup --project PATH

# Enroll: download/verify the binary and persist the config
scopegrain vantadb setup --project PATH --version 0.9.0 --apply

# Explicit local binary (no download)
scopegrain vantadb setup --project PATH --binary /abs/vantadb-server --apply

# Status: enrollment, binary presence, pending events
scopegrain vantadb status --project PATH

# Status + capability probe (one spawn; reports the embedding
# provider: fallback, model_present, status and backend notice)
scopegrain vantadb status --project PATH --probe [--timeout MS]

# Drain pending committed events to VantaDB (auto-spawn)
scopegrain vantadb sync --project PATH [--limit N] [--timeout MS]

# Point read against the backend (memory_get)
scopegrain vantadb get --project PATH --namespace NS --key K

# List keys in a namespace (memory_list; --cursor paginates via next_cursor)
scopegrain vantadb list --project PATH --namespace NS [--cursor N]

# Hybrid search within a namespace (memory_search;
# --mode keyword|vector|hybrid forces the engine search_profile)
scopegrain vantadb search --project PATH --namespace NS --query TEXT [--top-k N] [--mode keyword|vector|hybrid]

# L1 recall: project namespace by default (memory_search); --scope opts
# into the engine's dual-pool RRF memory_recall (agent = machine-global)
scopegrain vantadb recall --project PATH --query TEXT [--scope session|agent|team] [--top-k N]

# Host-declared confidence reinforcement (memory_reinforce;
# used +0.05, corrected/unused -0.10 — derived records are rejected)
scopegrain vantadb reinforce --project PATH --namespace NS --key K --outcome used|corrected|unused

# Record-level rehydration: searches its recordId across every
# projected sg-formal-v1-* namespace (single stdio session)
scopegrain vantadb context --project PATH --record-id ID [--top-k N] [--limit N]

# L1 dual-write: one curated episodic MemoryRecord per remote-verified
# (acked) journal event — makes events visible to memory_recall
scopegrain vantadb distill --project PATH [--limit N] [--timeout MS]

# Operational worklogs (paths.memory lessons/outcomes/progress/goals)
# as L1 MemoryRecords — content-digest keys (idempotent)
scopegrain vantadb sync-memory --project PATH [--limit N] [--timeout MS]
```

`distill` writes a valid `MemoryRecord` (`type: episodic`,
`agent_id/team_id: default`, `session_key: scopegrain`) under
`l1/sg-<projectHash>` (`l1/*` is the engine's cross-session recall pool)
with a deterministic one-line summary. Key `sg-event-<eventId>` —
re-runs are idempotent upserts. The formal truth stays in
`sg-formal-v1-*`; L1 records are derived and their metadata points back
to the formal record.

`sync-memory` projects the local operational worklogs
(`.scopegrain/memory/{lessons,outcomes,progress,goals}.jsonl` — the
authoritative store, unchanged) into the same project-scope
`l1/sg-<projectHash>` namespace, keyed `sg-worklog-<log>-<digest16>` from the
entry content: unchanged entries report `skipped` and re-runs produce no
duplicates. An existing remote record whose payload differs from the
expected one reports `conflicted` — the divergence is declared, never
overwritten nor silently skipped. Each record carries
`metadata.record_type: 'sg-worklog'`
(filterable via `memory_list.filters`), `log`, `entryDigest`, `taskId` and
`kind`, plus the full entry in the payload.

`sync-persona` projects proved `preference`/`decision` captures into
`l3/sg-persona-<projectHash>` (same project identity as L1), keyed
`sg-persona-<category>-<captureId>`.

Migration note: records projected by earlier versions under
`l1/sg-<scopeHash>` (per-area-set digests) and
`l3/sg-persona-<scopeHash>` stay inert — they are not deleted and the
global recall pool can still see them. Re-running `distill --apply`,
`sync-memory --apply` and `sync-persona --apply` reprojects them into
the per-project namespace.

The read verbs (`get`/`list`/`search`/`recall`) are bounded proxies over the
same stdio channel: server auto-spawn, argument validation before config
access, no local writes.

The rehydration surfaces (the `vantadb.recall` section of the `context`
packet and `session resume`'s `vantadb.context`) attach
`prependContextEstimate` (`{estimatedTokens, estimator, bytes}`) whenever
the output carries a string `prepend_context`, measured after the
harness character cap. In the `vantadb.recall` section the
`prepend_context` is composed locally by joining the `content` of the
project-namespace `memory_search` hits (8192-character cap; 512
characters per individual hit) — it is not the engine block. It is a
local `utf8-bytes/4` heuristic estimate, never the host tokenizer
count; an absent or non-string `prepend_context` produces no field.

## `scopegrain_memory_*` MCP tools

The MCP server exposes additional `memory_*` tools. Five are read-only:

| Tool | Equivalent |
|---|---|
| `scopegrain_memory_status` | `vantadb status` (enrollment, binary, pending) |
| `scopegrain_memory_get` | `vantadb get` (`memory_get`) |
| `scopegrain_memory_search` | `vantadb search` (`memory_search`; optional `query`, `topK` 1..100) |
| `scopegrain_memory_recall` | `vantadb recall` (`memory_recall`; `scope` session/agent/team, `topK`) |
| `scopegrain_memory_context` | `vantadb context` (record-level `recordId` rehydration over `sg-formal-v1-*` namespaces) |

Without enrollment they return `VANTADB_NOT_CONFIGURED` as a structured
error; arguments are validated against the bound ctx with no path redirect.

Two additional `memory_*` tools operate on the local operational worklog
(not on VantaDB; no enrollment required):

| Tool | Equivalent | Annotation |
|---|---|---|
| `scopegrain_memory_add` | `worklog append` (`log` = lessons\|outcomes\|progress) | mutating |
| `scopegrain_memory_read` | `worklog read --tail N` | read-only |

## Errors and bounds

- `VANTADB_NOT_CONFIGURED` — sync/get without prior enrollment.
- `VANTADB_BINARY_MISSING` — enrolled binary vanished; re-run setup.
- `VANTADB_UNSUPPORTED_PLATFORM` — no upstream asset for the platform.
- `VANTADB_DOWNLOAD_FAILED` / `VANTADB_HASH_MISMATCH` /
  `VANTADB_EXTRACT_FAILED` — fail-closed supply chain.
- `VANTADB_TIMEOUT` / `VANTADB_PROCESS_EXIT` / `VANTADB_PROTOCOL` /
  `VANTADB_RPC_ERROR` — stdio channel failures.
- `VANTADB_INVALID_INPUT` — out-of-bounds namespace/key.
- `VANTADB_CONFIG_MALFORMED` — invalid `.scopegrain/vantadb.json`.

## Deliberate bounds

- The network is only touched inside `setup --apply` (or an explicit
  `sync`/`get`, which only opens the local process). Preview downloads
  nothing.
- The binary cache lives in `~/.scopegrain/vantadb/<version>/`;
  reinstalling reuses it without a new download.
- A remote `memory_put` is *uncertain* if the channel dies mid-call
  (`BRAIN_REMOTE_UNCERTAIN`); the local ack is only emitted after
  readback.
- Windows ARM64 has no upstream asset yet.
