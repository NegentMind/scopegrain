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
  concurrent clients on the same storage.
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

# Drain pending committed events to VantaDB (auto-spawn)
scopegrain vantadb sync --project PATH [--limit N] [--timeout MS]

# Point read against the backend (memory_get)
scopegrain vantadb get --project PATH --namespace NS --key K
```

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
