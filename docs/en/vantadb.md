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
  storagePath}`. Closed document; absolute paths required.

## Deployment model

- **Machine-shared instance**: one storage (default `~/.vantadb/data`).
  Each project writes into scope-derived namespaces
  (`sg-formal-v1-<scopeHash>`, `sg-snapshot-v1-<scopeHash>`), so separation
  is by namespace, not by process.
- **Auto-spawn per operation**: `sync`/`get` launch `vantadb-server --mcp`
  with `VANTADB_STORAGE_PATH`, speak JSON-RPC over stdio and the process
  exits on close. VantaDB's writer discovery (`.vanta.server.json`) covers
  concurrent clients on the same storage. The spawn environment is
  controlled: `VANTADB_MCP_PROFILE` is pinned to `brain` (restricted
  profiles reject unlisted tools), the injection ACL is `l1/` and any
  inherited `VANTADB_MCP_*` override is stripped.
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

# L1 memory recall with dual-pool RRF (memory_recall)
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
`l1/sg-<scopeHash>` (`l1/*` is recall's cross-session pool) with a
deterministic one-line summary. Key `sg-event-<eventId>` — re-runs are
idempotent upserts. The formal truth stays in `sg-formal-v1-*`; L1
records are derived and their metadata points back to the formal record.

`sync-memory` projects the local operational worklogs
(`.tasksystem/memory/{lessons,outcomes,progress,goals}.jsonl` — the
authoritative store, unchanged) into the same project-scope
`l1/sg-<scopeHash>` namespace, keyed `sg-worklog-<log>-<digest16>` from the
entry content: unchanged entries report `skipped` and re-runs produce no
duplicates. Each record carries `metadata.record_type: 'sg-worklog'`
(filterable via `memory_list.filters`), `log`, `entryDigest`, `taskId` and
`kind`, plus the full entry in the payload.

The read verbs (`get`/`list`/`search`/`recall`) are bounded proxies over the
same stdio channel: server auto-spawn, argument validation before config
access, no local writes.

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
