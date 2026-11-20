# Changelog

All notable changes to this project are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **Session-start context packet + persistent user knowledge** — new
  read-only `context` verb returns a bounded JSON packet
  (`schemaVersion: 1`): instructions/config paths, task counts and the
  `ready` list (PLAN tasks without disposition), open goals, recent
  `progress` entries, up to 3 resumable sessions and pending journal
  events. `.scopegrain/context.md` is the owner's persistent session
  knowledge file: read into the packet (capped at 32 KiB), never written
  by the harness. Session-start instructions were added to the generated
  entrypoints (AGENTS.md/CLAUDE.md template) and to
  `templates/project-instructions.md`.

- **Human-readable task documents** — `task doc --project P <UUID>`
  renders a task record to `<paths.tasks>/<uuid>.md`: front matter plus
  contract, scope, methodology, dependencies, steps, verification,
  review, notes and history sections. Idempotent: an unchanged record
  reports `changed: false` without rewriting.

- **Plan execution agenda** — `plan run <KEY>` derives the full
  dependency-respecting wave schedule from the validated DAG: parallel
  waves of tasks whose pending dependencies all landed in earlier waves,
  with triaged (`defer|skip|blocked`) tasks reported separately. The verb
  is read-only (`{plan, waves, triaged, unscheduled}`); the host/agent
  executes the actual task work — Scopegrain orders, it does not execute.

- **Viewer: full task metadata, task/plan files and localized states** —
  the Tasks view now renders every V3 field (methodology, estimate,
  source, scenarioRefs, relations, goals, verification, review, files,
  rendered task doc) and an 11-column table (priority, type, effort,
  backlog, disposition, deps, steps). New endpoints
  `/api/tasks/:id/doc`, `/api/plan-docs` and `/api/plan-docs/:name`
  expose the rendered task document and the human-readable plan files;
  a new Plans view lists both semantic plans and `.md` plan docs.
  `StateBadge` shows localized labels (`PLAN` → "Por hacer"/"To do")
  with the raw state code in the tooltip, and the top nav moved into a
  responsive sidebar. `task meta` now accepts `title`/`contract` so
  records can be rewritten (used to translate the whole backlog to
  Spanish via `scripts/translate-tasks.mjs`).

- **State root migration `.tasksystem` → `.scopegrain`** — this project
  now uses the canonical default state paths (`.scopegrain/*`); all state
  was relocated. Journal/ownership validation is relocation-safe:
  `snapshotRef` and `sourceRel` anchors compare the record-identity tail
  (`snapshots/<hash>.blob`, `<kind>/<id>.json`) and the content digest,
  never a specific historical state root — committed events keep their
  original `.tasksystem` locators as immutable history.

- **Viewer: operational surfaces + visualizations** — new read-only API
  routes (`/api/sessions`, `/api/approvals`, `/api/catalog`,
  `/api/verify`, `/api/vantadb`, `/api/workflow`) expose session records,
  the HITL approval queue, the resource catalog, verified commands,
  backend status and the C0 workflow policy. New views: Sessions,
  Approvals, Catalog, System, Graph; task summaries now carry semantic V3
  fields (priority, backlog, disposition, type, dependsOn, relations,
  goalIds, steps, uncertainty) with list filters, badges and a detail
  panel that renders all V3 sections with cross-links. `viz.tsx` renders
  the lifecycle funnel (live counts per state) and a layered dependency
  DAG in pure SVG; `usePoll` gives data views auto-refresh.

- **Worklog → VantaDB projection** — `vantadb sync-memory` upserts the
  local operational logs (lessons/outcomes/progress/goals, still the
  authoritative store) as L1 `MemoryRecord`s under the project-scope
  `l1/sg-*` namespace, keyed by content digest (`sg-worklog-<log>-<h16>`)
  so re-runs report `skipped` and produce no duplicates. Each record
  carries `metadata.record_type: 'sg-worklog'` plus `log`, `entryDigest`,
  `taskId`, `kind` and the full entry payload.

- **Rule: subprocess environment isolation** — `mcp-integration` now
  requires spawned MCP servers to pin or strip the target server's
  profile/injection/taint/budget variables explicitly instead of
  inheriting the ambient environment (C1-class defect).

- **VantaDB integration hardening (audit-driven)** — spawn environment is
  now controlled: `VANTADB_MCP_PROFILE` pinned to `brain` (restricted
  profiles reject dispatch-only tools), injection ACL scoped to `l1/`,
  inherited `VANTADB_MCP_*` overrides stripped. `vantaDBContext` surfaces
  engine `abstained`/`abstention_reason`/`truncated` signals instead of
  letting them look like empty results. New `vantadb reinforce` verb
  (host-declared confidence via `memory_reinforce`), `vantadb list
  --cursor` pagination, `vantadb search --mode keyword|vector|hybrid`
  search-profile override (also on `scopegrain_memory_search`), `vantadb
  recall --scope` validated locally, `vantadb status --probe` aggregates
  an `embedding-model-missing` warning, and projected formal records now
  carry filterable `metadata` (`record_type`, `event_id`, `operation_id`).

- **Viewer surface: memory, goals, metrics, reports + i18n** — new
  read-only API routes (`/api/memory`, `/api/goals`, `/api/metrics`,
  `/api/reports`) expose the JSONL worklogs, goals, derived metrics and
  persisted doctor reports. New React views consume them and the whole
  viewer UI is localized ES/EN via `useT()` + locale toggle; project
  `locale` seeds the UI language. Canonical agent resources stay English.
- **Retroactive activity registration** — `activity record` (dry-run /
  `--apply`, `--input` JSON) creates an ops task (`source:
  activity:<kind>`) plus a `progress` worklog entry for work done outside
  the task lifecycle; `taskId` links to an existing task instead. Gated
  methodology modes get a declared assessment (actor-authorized, never a
  fabricated approval). `hooks install|uninstall` manages an idempotent
  `.git/hooks/post-commit` block that auto-records every out-of-loop
  commit and never breaks the commit (always exits 0).
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
- `task doc` rendering crashed with `n.at.slice is not a function` on
  records whose `notes` are plain strings (the field accepts strings and
  `{at,by,text}` objects); notes are now normalized before rendering.
