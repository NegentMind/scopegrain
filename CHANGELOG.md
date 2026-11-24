# Changelog

All notable changes to this project are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **Suggestive task heuristic (`task suggest`, MCP `scopegrain_task_suggest`)** —
  deterministic scoring of catalog skills against task metadata
  (type/title/contract/scope) with declared `reasons`. Suggestive only:
  it never writes `task.skills` and never enters the skills bucket; the
  same suggestion is exposed as `packet.taskRouting.suggested` in
  workflow packets. MCP tool surface grows 34 → 35.
- **Native gate channel (`task gate`, `host gate`)** — `task gate` runs
  the full state+methodology+preAction check and returns a decision with
  the exit contract `0` allow / `2` deny / `3` require-gate / `1` error
  (fail-closed for hooks); `-` resolves `SCOPEGRAIN_TASK` then the active
  pointer. `host gate` emits read-only merge proposals for the native
  interception channel (PreToolUse hook for claude, declarative
  permission surfaces for opencode/codex, documented-only for
  devin/antigravity/hermes/generic); `interceptsNativeTools` stays
  `false` until owner merge plus a pilot.
- **`task check-action` (CLI + MCP `scopegrain_check_action`)** —
  shipped in v0.1.1, documented now: reports whether an action
  (`edit`, `verify`, `review`, …) is permitted for a task in its
  current state under the workflow policy and methodology gates,
  without performing it.
- **`dist` distribution family (21 verbs)** — shipped in v0.1.1,
  documented now: declarative catalog/bundle/extension/preset
  machinery constrained to `file://` sources (remote URIs validate
  their shape but refuse at load). Verbs: `run`, `stack`, `compose`,
  `validate`, `bundle-validate`, `bundle-install` (dry-run +
  `--apply`), `bundle-mount`, `bundle-unmount`, `bundle-uninstall`,
  `mounted-list`, `extension-register`, `extension-list`,
  `extension-activate`, `extension-deactivate`, `extension-remove`,
  `preset-register`, `preset-list`, `preset-remove`, `selftest`,
  `journal` (CAS mutation trail) and `pack`. See
  `docs/distribution.md`.
- **Capture review proposals (`capture proposals`, `capture review`)** —
  shipped in v0.1.1, documented now: `capture proposals` lists pending
  review proposals and `capture review --apply` creates an owned
  capture only from an approved decision.
- **Helper installation (`helper install`, `helper list`)** — shipped
  in v0.1.1, documented now: installs and lists host helper resources.

### Changed

- **Documentation resynchronized with the wave-1 implementation** (docs
  only, ES/EN pairs kept in sync): current counts (35 MCP tools in four
  annotation classes — 23 `READ_ONLY`, 6 `READ_BACKEND`, 4 `WRITE_LOCAL`,
  2 `WRITE_DISCARD` —, 30 API routes, 140 catalog entries, 7 discovery
  stacks, ~35 doctor checks incl. `host-merge-targets`); corrected
  `policy/hooks.json` example shape; `managed` lifecycle action and
  `update --reconcile`/`hostBridges` host-bridge handling; `activationMode`
  contract and deprecated `manualMerge`; context-packet `locale`,
  `warnings`, self-excluding `tokenEstimate` plus `wire`, `--no-structure`;
  workflow-packet `sameAsContent`/`posture`; `policy/workflow.json`
  `constraints`; closed `dist run` per-op args and `evidence` alias;
  VantaDB `binarySha256`, env allowlist and `secretEgressCheck`; bilingual
  wizard, locale-aware `task doc` and the dry-run/`--apply` matrix;
  `intake.mode` for operators; `scopegrain` as the single command name
  and bin entrypoint (the `tasksystem` compatibility alias and the
  `.tasksystem` legacy config fallback were retired); viewer/native-hosts
  docs re-marked Spanish-canonical with English translations.

## [0.1.1] - 2026-11-22

### Added

- **Global user onboarding config (`config path|show|set`)** — optional
  user-level defaults (`locale`, `hosts`, `methodology`, `versioning`) at
  `~/.config/scopegrain/config.json` (or `$XDG_CONFIG_HOME` /
  `$SCOPEGRAIN_USER_CONFIG`, disable with `none`). Permissions,
  verification commands and project paths are forbidden; workspace config
  always takes strict precedence at runtime and re-init.
- **Persisted plan-run wave progress (`plan run KEY --apply`)** — bounded
  atomic checkpoints (max 50) under `<state>/plan-runs/<key>.json` under
  verified locks, surfaced via `GET /api/plans/:key` (`runState`) and
  `PlansView` (with clickable wave task chips, fixing `[object Object]`
  rendering).
- **Session resume context in viewer (`GET /api/sessions/:id`)** —
  read-only `resumeContext` panel in `SessionsView` (linked task state
  and refs, budget usage bar, last action, exact `session resume` CLI
  command).
- **VantaDB L3 persona/preferences projection (`vantadb sync-persona`)** —
  opt-in, preview-by-default, idempotent projection of ownership-proved
  `preference` and `decision` captures into `l3/sg-persona-<scopeHash>`
  with readback verification and rejection of unproved files.
- **Explicit structural index refresh (`structure refresh`)** — stat-only
  no-op when fresh, bounded preview/apply when stale, while keeping
  `context` strictly read-only (`refreshPolicy: "explicit"`).
- **Remaining `doctor` checks** — `mcp-deps` (optional, non-blocking),
  `viewer-build` (informational), `user-artifacts` (bounded JSON/UTF-8
  integrity check) and `user-config` (warning on malformed global file),
  bringing `doctor` to 32 checks.
- **CLI version/help flags (`--version`, `-v`, `-V`, `-h`)** — prints
  `{name, version, node}` without conflicting with `vantadb setup --version X`.
- **Legacy workflow parity & portable YAGNI preset** — expanded
  `resources/commands/investigate.md` with the 6-phase research procedure,
  mapped all 5 legacy workflows in `provenance/legacy-inventory.json` to
  canonical commands (`resources/manifest.json` bumped to `0.1.1`), and
  added `examples/preset-yagni.json`.
- **Test fixture optimization** — `bootstrappedMiniCtx`, `test:smoke`
  (215 tests in ~43 s), `test:fast` (`--test-concurrency=2`), and
  parameterized `assertOwnedStoreContract`; full serial suite recertified
  at **1411/1411 pass** plus **17/17 viewer tests** and 30-screen EN/ES
  Playwright visual audit with screenshots and walkthrough video under
  `docs/assets/`.

### Fixed

- **POSIX shebang in `bin/tasksystem.mjs`** — normalized CRLF to LF to
  match `bin/scopegrain.mjs` so global installs execute cleanly on
  Linux/macOS.
- **Trimmed npm tarball (<1 MB)** — excluded `docs/assets/` media from
  `package.json` `files` while keeping `viewer/dist` and all written docs.
- **Viewer layout & reload bugs** — fixed `TasksView` split-pane column
  clipping, `SessionsView` `[id]` reload dependency and `Close` header
  alignment, `PlansView` wave task object rendering, and `App.tsx`
  distinct header/boundary keys.

## [0.1.0] - 2026-11-21

### Added

- **Automatic context rehydration (VantaDB)** — when a backend is
  enrolled, `context` injects a bounded `memory_recall` over distilled
  L1 memories and `session resume` plus MCP `scopegrain_session_resume`
  inject `memory_context` per `recordId` over the `sg-formal-v1-*`
  namespaces. Both degrade to explicit markers (`{ enrolled: false }`
  unenrolled, `{ error }` on backend failure), never abort the packet;
  `--no-vantadb` skips the spawn and `--timeout MS` bounds it (15 s
  default). The MCP surface stays read-only.
- **`update --diff`** — attaches `discoveryDiff` to the update result,
  flagging evidence drift before generated files are re-projected.
- **Doctor: stale locks and host-fragment drift** — locks classify
  dead-pid (self-recoverable warning) vs live-pid (never broken) vs
  metadata-less beyond TTL; host fragments are re-rendered and compared
  against installed bytes, reporting divergence.
- **`researchEscalation` gate** — three `VERIFY→ACT` reworks without an
  intervening `RESEARCH` visit now block the next `→ACT` transition
  (`RESEARCH_ESCALATION_REQUIRED`), enforcing the actionable half of the
  authored methodology policy.
- **Structural project index (`structure`)** — bounded scan of the
  project tree producing a persisted index at
  `<state>/cache/structure-index.json`: file inventory, LOC/bytes per
  language, import specifiers, internal/external dependency edges,
  fan-in/fan-out and heuristic complexity, plus a deterministic
  fingerprint for change detection without rescanning. `scan` previews,
  `--apply` persists, `status` reports freshness, `show` returns the
  document. `init --apply` seeds the index and `context` surfaces its
  freshness so agents know when to refresh.
- **`investigate --diff`** — exposes `diffInvestigation`: compares the
  live semantic investigation against recorded discovery evidence and
  reports fingerprint drift, added/removed manifests, lockfiles, stacks,
  commands, new host signals, stale decisions and notes. `doctor` embeds
  the diff in its fingerprint warning.
- **Doctor operational checks** — Node runtime version, canonical policy
  parsing, journal internals (outbox/archive), verify store, sessions,
  worklogs (including rotated archives), record-ownership sidecars,
  `vantadb.json` shape (no runtime — the core stays free of
  `child_process`) and managed git hooks.
- **Owner essentials** — dedicated operator section in `README.md` /
  `README.es.md` and an operator card in the viewer's System view:
  the handful of verbs a human needs (`init`, `doctor`,
  `investigate --diff`, `structure`, `view`, `verify`, `approval`)
  plus the consent boundaries.
- **`docs/en/capability-map.md`** — English twin of the capability
  catalog; the Spanish map now records the resolved and remaining audit
  findings.

### Security

- **Viewer API hardened against DNS rebinding** — every request must be
  addressed to the loopback socket (`Host` hostname must be a loopback
  literal or `localhost`; a non-loopback `Origin` is rejected with
  `421 MISDIRECTED_REQUEST`). Responses now carry `Content-Security-Policy`,
  `Cross-Origin-Resource-Policy: same-origin`, `X-Frame-Options: DENY`
  and `Referrer-Policy`. `NOT_FOUND` now maps to HTTP 404.
- **VantaDB binary trust** — the enrolled `binaryPath` must name
  `vantadb-server(.exe)` and resolve outside the project root, so a
  versioned `vantadb.json` can never select in-repo bytes to execute.
  Enrollment pins `binarySha256` and every spawn verifies the digest
  when present; synchronous `spawn` failures now surface as
  `VANTADB_SPAWN_FAILED` instead of `INTERNAL`. The generated
  `.scopegrain/.gitignore` now ignores `/vantadb.json` and
  `/context.md`.
- **Hook installation containment** — a crafted `.git` `gitdir:` pointer
  can no longer redirect hook writes outside the project root, and
  interpolated paths in the managed hook block are single-quoted
  (project names containing `"` can no longer inject shell). Hook
  writes use a random exclusive temp name.

### Changed

- **Publication packaging** — `private` removed; `bin`
  (`scopegrain`/`tasksystem`), trimmed `files` (`bin`, `src`, `resources`,
  `policy`, `templates`, `schemas`, `provenance`, `docs/*.md`,
  `docs/en/*.md`, `viewer/dist`, `examples` — 979 kB tarball) and
  repository/homepage/bugs/keywords metadata declared so the package is
  installable (`npm i scopegrain` / `npx scopegrain` / `npm link`).
- **Apache License 2.0 declared** — `LICENSE`, `NOTICE` and `AUTHORS`
  added at the root (`Copyright 2026 The Negent Mind Authors`);
  `package.json` license set to `Apache-2.0`; SPDX headers applied to
  every tracked `.mjs` and to `verify.yml`; `.md`/`.json` files are
  covered by `LICENSE` + `NOTICE`. Registry publication remains gated on
  explicit owner authorization. The provenance gates for license choice
  and the 65 reused-ID authorship attestation are recorded as resolved in
  `docs/provenance.md`.
- **Stale lock recovery** — lock payloads are now JSON `{t, pid, at}`.
  A lock whose writer pid is provably dead is reclaimed on the next
  acquire; a live pid is never broken; metadata-less locks (legacy bare
  tokens, zero-byte sentinels) reclaim only past a one-hour `mtime` TTL.
  Reclaim re-verifies `dev`/`ino` so a delete+recreate race preserves
  the successor's lock. The journal's `.lock` uses the same path, so a
  crashed writer no longer wedges every journaled write. The guarantee
  is documented in `docs/journal-recovery.md`.
- **`journal compact`** — new verb archiving terminal operations
  (committed + fully acknowledged, or abandoned after recovery) intact
  to `archive/operations/`; pending, active and unacked operations are
  kept. Provenance is preserved byte for byte and readers resolve both
  locations. `head.json` now maintains `pendingOperations`, and session
  start reads `pendingJournalOperations` from it instead of scanning
  intents (the context packet field was renamed accordingly).
- **Oversized worklogs no longer break `context`** — logs beyond the
  document cap are read from a bounded tail window (partial first line
  dropped at the byte level, so split UTF-8 sequences cannot fault the
  decode) and reported as `{ truncated: true, entries }`; unreadable
  logs and goals degrade to an error marker inside the packet rather
  than aborting session start.
- **Worklog rotation** — on append, an active segment already over the
  document cap rotates whole into `paths.memory/archive/` (immutable,
  never deleted), so a single log file no longer grows without bound.
  Rotation is best-effort: a file held open elsewhere defers it and the
  append still succeeds.
- **Lazy CLI imports** — `src/cli.mjs` defers every subsystem import to
  `await import()` inside each command body (plus dispatch-local loads
  for alias catalog, `inspect`, `doctor` and `metrics`), so startup no
  longer pays for modules the invoked command never uses. All command
  names, flags, help text and output contracts are unchanged.
- **Policy caching** — `loadPolicy`, `loadJournalPolicy`,
  `loadMethodologyPolicy`, `loadOnboardingDefaults` and `loadLimits`
  return deep-frozen cached objects (`loadLimits` keyed per `policyDir`
  so test fixtures stay isolated); a failed load never poisons the
  cache. `resetPolicyCaches()` exists for test fixtures only.
- **`preflightPlan` collision check is O(n log n)** — canonical sort +
  adjacent-pair prefix detection instead of comparing every ordered
  pair, canonicalizing once per destination.
- **Owned stores factored onto one creation protocol** — the four
  immutable stores (specifications, designs, outcomes, captures) now
  delegate the closed-input/scope/serialization/ownership-proof protocol
  to `createOwnedRecordStore` in `owned-store.mjs`; each store declares
  only its domain rules (−~370 duplicated lines). Public store APIs and
  error codes are unchanged.
- **Backup/restore stream one document at a time** — `applyBackup`
  classifies, re-reads, hash-verifies and writes each entry before
  loading the next source; `applyRestore` classifies all entries first,
  then re-reads and re-hashes each payload at write time (TOCTOU).
  Peak memory is one document instead of the whole bundle; files
  created by a failed apply are still rolled back.
- **Terminal `ABANDON` state** — reachable from every non-terminal state
  except `CLOSE`, requires no evidence or methodology gate, and is the
  only legal destination for tasks whose `disposition` is
  `discarded`/`cancelled` (`DISPOSITION_BLOCKS` otherwise). Soft
  dispositions (`deferred`/`icebox`/`future`) remain advisory.
- **Honest evidence** — verification checks may now record
  `status: pass|fail|error` and reviews `approve|reject|changes-requested`
  (`recordableVerificationStatuses`/`recordableReviewVerdicts` in
  `policy/workflow.json`); `ACCEPT` still requires every check `pass`
  and verdict `approve`, now enforced explicitly.
- **`task meta` no longer rewrites `title`/`contract`** — approved
  content bound into the acceptance digest is immutable outside the
  lifecycle again.
- **Source writes are durable** — `writeFileExclusive` and `applyPlan`
  `fsync` before close, matching the journal's committed marker.
- **Private package posture** — `files`/`bin` removed from the manifest
  until a release direction is decided.

### Fixed

- **Plan V3 `update` emitted an invalid document** — the re-emission now
  preserves `specId`/`designId` (schemaVersion >= 2) and all
  `PLAN_V3_KEYS` (schemaVersion 3), and revalidates the emitted shape
  before the CAS write so an update can never persist an unreadable tip.
- `sessions.mjs` passed positional args to `readOwnedCurrent`'s options
  object, degrading failures to `undefined:`.
- `docs/security.md` (ES/EN) no longer claims the core never uses
  `child_process` or opens sockets; the bounded exceptions
  (`verify run`, loopback viewer, VantaDB downloader) are documented.
- `.agents/mcp_config.json` and `.devin/mcp_config.json` use
  project-relative paths instead of committed absolute machine paths.
- **MCP docs no longer claim read-only** — the server has carried six
  locally-mutating tools for a while (`memory_add`, `goal_create`,
  `goal_transition`, `task_disposition`, `next_task --claimBy`);
  `architecture.md`, `vantadb.md`, `README*.md`,
  `resources/mcps/scopegrain.json` and
  `resources/references/mcp-tools.md` now describe the real boundary.
  Historical session counts in `native-hosts.md`/`verification.md` keep
  their point-in-time numbers.

### Added

- **Viewer `ErrorBoundary`** — a render crash in one view now swaps to
  an accessible fallback (`role="alert"`, details, Retry, i18n) instead
  of unmounting the whole shell; the boundary is keyed by the active
  view so navigation auto-recovers. `TaskDag`'s SVG label is localized.
- **Viewer test/lint tooling** — Vitest + Testing Library + jsdom and
  a flat ESLint config (typescript-eslint + react-hooks) with `npm run
  test`/`npm run lint` scripts, wired into the viewer CI lane. Covers
  the i18n fallback, the cross-view navigation queue, the API error
  contract and the ErrorBoundary.
- **`owned-chain` unit coverage** — `tests/owned-chain.test.mjs`
  exercises the shared proof primitives (hash/bounds/parsing, scope
  validation, genesis/update pairing, binding, chain walk) against a
  real journaled fixture.
- **MCP contract tests always execute** — SDK/zod are hard
  dependencies, so the three MCP suites no longer skip when imports
  fail; a broken install now fails loudly.
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

- **Viewer: markdown rendering, plan/goal progress and artifact docs** —
  `react-markdown` + `remark-gfm` render task docs, plan files, artifact
  bodies and loose documents (no `dangerouslySetInnerHTML`, GFM tables).
  `/api/plans` and `/api/plans/:key` now join member tasks with their
  live records: per-plan `status` (pending/in_progress/completed), done/
  total counts, `progress` % and execution `waves`. `/api/goals` joins
  tasks by `goalIds` (tasks, taskCount, tasksDone, progress). New
  `/api/artifact-docs?kind=` and `/api/artifact-docs/:kind/:name`
  surface loose `.md` documents (canonical dirs plus legacy
  `.scopegrain/<kind>/` flats) with parsed frontmatter. Memory view
  renders per-log columns (topic/text/ref, task/outcome/skills) and the
  Goals view shows progress bars plus linked-task rows that navigate
  into the task detail. `/api/plan-docs` entries carry title, status,
  kind and date parsed from frontmatter/filename.

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
