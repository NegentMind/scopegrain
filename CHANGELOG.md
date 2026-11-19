# Changelog

All notable changes to this project are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **Task semantic layer (schemaVersion 3)** — optional backlog/task-file
  fields orthogonal to the lifecycle: named `backlog`, `disposition`
  (deferred/icebox/future/discarded/cancelled, `active` clears),
  `priority`, `severity`, `type`, `effort`, `estimate`, `source`,
  `dependsOn`, typed `relations`, `goalIds`, deep `analysis`, `steps`,
  `notes`, `skills` and `uncertainty`. Any semantic field at creation or
  any `task meta` write upgrades the record to V3; V1/V2 records stay
  valid. New verbs: `task meta|disposition|note|step`, `task list
  --backlog`. CAS revision discipline and stored-shape validation match
  the transition path.
- **Operational memory, goals and metrics** — bounded append-only JSONL
  logs under `paths.memory`: `lessons`, `outcomes` (per-skill ok/fail),
  `progress` (auto-archived on CLOSE) and `goals` (meta objectives linked
  from `task.goalIds`). New commands `memory add|list`, `goal
  create|list|transition` and `metrics` (derived aggregates: state/
  backlog/priority/disposition counts, verification and first-try rates,
  close-time p50/p95/p99, per-skill outcome rates).
- **Capability feedback loop** — `select-capabilities` now consults the
  `outcomes` log/`metrics` skill rates as a selection signal;
  `contract-execution` records `outcome: ok|fail` + used skills at task
  completion; `session-handoff` distills learnings into the `lessons`
  log. This closes the legacy `skill-outcomes.json` producer/consumer
  loop over the JSONL worklog.
- **Persisted reports** — `report save` writes the live doctor snapshot
  create-only under `paths.reports` (`<ISO>-status.json`); `report list`
  enumerates saved reports newest-first.
- **Plan semantic layer (schemaVersion 3)** — legacy plan-file semantics
  on `plan create`: per-task `triage` (`do|defer|skip|blocked` +
  `triageReason`), plan-level `triage` map, `appetite`, `cynefin`,
  `riskRegister`, `premortem`, `stopConditions` and `budget`. Plan task
  entries forward the full task V3 field set (except `dependsOn`, which
  stays the plan DAG) to the generated task records. `plan next` is
  triage-aware: defer/skip/blocked report `triaged`, never `ready`.
- **MCP wave-2 tools (23 → 32)** — `scopegrain_next_task` (priority- and
  dependency-aware selection with note-based `claimBy`),
  `scopegrain_task_meta`, `scopegrain_task_disposition`,
  `scopegrain_memory_add`, `scopegrain_memory_read`,
  `scopegrain_goal_create`, `scopegrain_goal_list`,
  `scopegrain_goal_transition`, `scopegrain_metrics`. Write tools are
  advertised `readOnlyHint: false` and run through the same CAS/lock
  validators as the CLI; the server is no longer strictly read-only.
- **VantaDB opt-in memory backend** — verified binary install from
  GitHub releases (sha256 sidecar enforced), stdio MCP client
  (NDJSON JSON-RPC), project-local enrollment at
  `.scopegrain/vantadb.json`, shared machine storage, auto-spawn of
  `vantadb-server --mcp`, `vantadb setup|status|sync|get` verbs.
- **Read-side memory path** — `vantadb list|search|recall` verbs and
  `callVantaDBTool` bounded proxy; `scopegrain_memory_status`,
  `scopegrain_memory_get`, `scopegrain_memory_search`,
  `scopegrain_memory_recall` MCP tools (tool inventory 18 to 22).
- **`vantadb context` verb** — record-level rehydration: enumerates
  `sg-formal-v1-*` namespaces and searches projected journal events
  for a record ID.
- **`vantadb distill` verb** — curated L1 dual-write: one episodic
  `MemoryRecord` (`l1/sg-<scopeHash>`) per remote-verified journal
  event, making projected history visible to `memory_recall`
  (`scope: agent`, verified end-to-end against vantadb-server 0.9.0).
- **CLI `journal list`** — pending-ops listing with `--limit` and
  `--since-sequence` pagination.
- **CI gates** — `verify.yml` now triggers on PRs to `develop` and
  pushes to `develop`/`main` (previously manual-only), plus a viewer
  typecheck+build lane; concurrency cancellation per ref.
- **Repository metadata** — GitHub topics, `CHANGELOG.md`,
  `.github/CODEOWNERS`, `packageManager` declaration.

### Fixed

- Antigravity pilot findings F-01 through F-07 (verified task lock,
  CLOSE gate, journal owned-path, and related remediations).
- Devin dogfooding findings D-01 (`packageManager` for discovery),
  D-02 (accepted-keys hint in `capture review` errors), D-03
  (`journal list` surface gap).
- Stale `verify.yml` header claiming no remote execution evidence.
