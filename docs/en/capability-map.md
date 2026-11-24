<!-- translated-from: docs/capability-map.md @ 2026-11-24 -->
# Scopegrain — Complete capability map

Detailed catalog of surfaces, subsystems, commands and guarantees of the
harness. Reference state: `develop` branch, `scopegrain@0.1.1`, catalog
`140` entries (`manifest.json` v`0.1.2`); the current test-suite figure is
recorded in [verification](verification.md) (it changes with every run).

> English translation of the canonical Spanish document
> (`../capability-map.md`). The Spanish version prevails.

> Conventions: *(write)* = mutates state; *(preview/apply)* = dry-run by
> default, `--apply` confirms; everything else is read-only.
> `--yes`/`--force` do not exist: every confirmation is explicit. Output
> is always JSON (results on stdout, errors on stderr).

---

## 1. Entry surfaces

| Surface | Inventory | Access |
|---|---|---|
| CLI `bin/scopegrain.mjs` | 141 registered subcommands, lazy per-command imports | Human and agent |
| MCP `src/mcp/server.mjs` | 37 `scopegrain_*` tools: 23 `READ_ONLY` + 6 `READ_BACKEND` (`openWorldHint`, spawns the enrolled VantaDB binary) + 8 writers (6 `WRITE_LOCAL` + 2 `WRITE_DISCARD`) | MCP hosts (stdio) |
| Local API `src/api/server.mjs` | 30 GET routes `/api/*` | Loopback-only, GET-only |
| Viewer `viewer/` (`scopegrain view`) | 15 views, React 19 + TS + Vite + Tailwind | Read-only, human |
| Catalog `resources/manifest.json` | 140 entries + 32 aliases | Projectable into the project |

---

## 2. CLI — catalog by domain

### 2.1 Discovery and onboarding

| Command | What it does |
|---|---|
| `inspect` | Bounded manifest snapshot (7 `MANIFEST_STACK` stacks: node, rust, python, go, java, php, ruby — plus dotnet by extension, lockfiles by presence, package.json test/lint/build scripts, AGENTS/CLAUDE/README, sha256 fingerprint). Stores `discovery.json` |
| `investigate [--save] [--diff]` | Semantic analysis: + dart/flutter/swift/gradle, monorepo topology, platforms, test frameworks, CI, hosts, i18n, layout. Suggests init answers with confidence+evidence. `--save` persists a research record. `--diff` compares current evidence against `discovery.json`+config: fingerprint, added/removed/retained manifests and lockfiles, changed content, added/dropped stacks and commands, new host signals, stale decisions, notes |
| `assess --input DIFF` | Evidence-only risk classification over a unified diff (paths, modes, added content): `passive|medium|high` tier, reasons, `review_due`. Fail-closed, read-only, no git/child_process; `--assessment` reports discrepancy vs declared risk |
| `init` | Onboarding: investigates, asks name/locale/hosts/methodology, **7 paths** (`plans tasks reports research decisions memory state`), **8 versioning flags**, proposes a bounded `.gitignore` and seeds the structural index. `--defaults`/`--answers` for non-interactive |
| `adopt` | Deterministic: reports config, enrollment and journal of a project with prior remains; `--apply` only creates the enrollment when `adoptable` |
| `doctor` | ~35 checks: 26 named families + 7 `paths.*` always on, plus the conditional `journal-internals` (with journal) and `upgrade` (on snapshot divergence); installation + operational health |
| `structure scan/status/show` | Bounded structural index of the project tree: inventory, LOC/bytes per language, imports, internal/external edges, fan-in/fan-out, heuristic complexity, deterministic fingerprint. `scan --apply` persists at `<state>/cache/structure-index.json`; `status` reports freshness without rescanning; `context` exposes it to the agent |
| `update [--reconcile]` | Re-projects generated files from the current installation; `--reconcile` rewrites only divergent files under harness roots and provably-generated applyable host destinations (merge targets and hand-maintained files stay `conflict`); the `managed` action refreshes only `SCOPEGRAIN:BEGIN..END` regions in place; reports `hostBridges` |
| `uninstall` | Deletes only what the harness provably created; divergent files stay `leftBehind` |

### 2.2 Context and workflow

| Command | What it does |
|---|---|
| `context [--tail N] [--no-vantadb] [--no-structure]` | Session-start packet: instructions, user's `context.md`, `locale`, workspace, ready tasks, goals, pending journal, recent worklog (degradable, never aborts). `--no-structure` serves the persisted index without rescanning (`structureDebounceMs` exists at API level); `tokenEstimate` declares `excludesSelf:true` plus the self-inclusive `wire` figure; `warnings[]` flags the wire exceeding the advisory `packetBudgetTokens` budget (16000, `policy/operation-limits.json`) |
| `workflow COMMAND` | Packet for an installed command: resources + modes + host + profile + interaction |
| `task check-action` | Gate: may ACTION run against the task now? (abstract actions read/edit/propose/…; `interceptsNativeTools:false`) |
| `task gate` | Decision endpoint for host hooks: same check plus exit contract 0/2/3/1 (fail-closed) |
| `host gate` | Read-only merge proposal wiring the host's documented surface to the gate; `documented-only` when no verified surface exists |
| `task suggest` | Suggestive task-type → capability heuristic: ranked candidates with declared `reasons`; never injects into `task.skills` or the packet |
| `methodology check` | Task readiness toward `ACT`/`ACCEPT` per methodological mode; `--outcome-evidence` simulates the report |

### 2.3 Tasks, plans, sessions

| Command | What it does |
|---|---|
| `task create/list/show` | V3 records with dependencies, scope, methodology |
| `task meta` | Updates fields (controlled patch, revision bump) |
| `task disposition` | `deferred\|icebox\|future\|discarded\|cancelled`; discarded/cancelled block everything except ABANDON |
| `task note` / `task step` | Notes and per-step state (pending/done/skipped) |
| `task transition` | CAS + evidence + methodological gate + terminal dispositions |
| `task doc` | Renders the task's contract document |
| `plan create/list/show/next` | Plans with tasks and dependencies |
| `plan run` | Wave scheduling honoring the dependency DAG |
| `session create/show/record/resume` | Sessions with explicit operation budget (`maxSessionEvents` limit), CAS, own lock, ACT events; optional self-reported token budget (`tokenLimit`, `self-reported-unverified`) |

### 2.4 Journal (transactional integrity)

| Command | What it does |
|---|---|
| `journal list/show` | Operations and events; resolves `operations/` + `archive/operations/` |
| `journal recover` | Finalizes or abandons an interrupted operation (crash recovery, never replay) |
| `journal compact` | Archives terminal ops to `archive/operations/` (atomic rename, idempotent, provenance intact) |

### 2.5 Owned records (cryptographic ownership chain)

Each kind is a hash chain: genesis + chained updates, scope binding
(UUIDs), verifiable snapshot, ownership sidecar under
`<state>/record-ownership/`. Built on `owned-store.mjs` (factory) +
`owned-chain.mjs` (primitives).

| Domain | Commands |
|---|---|
| Specifications | `specification create/show [--owned]` |
| Designs | `design create/show --owned` (bound to spec by digest) |
| Outcomes | `outcome create/show --owned` (V2 report with 9 computed fields) |
| Captures | `capture create/show`, `capture proposals` (from journal), `capture review` (HITL) |
| Artifacts | `artifact add/list/show KIND` |
| Approvals | `approval target/create/show/answer` (pending/answered/revoked) |

### 2.6 Memory, goals, metrics, activity

| Command | What it does |
|---|---|
| `memory add/list --log lessons\|outcomes\|progress` | JSONL worklogs; rotation to `memory/archive/` >1 MiB (best-effort); bounded tail-window reads |
| `goal create/list/transition` | Goals linked to tasks, aggregate progress |
| `metrics` | Store aggregates + outcome rates |
| `report save/list` | Persisted reports |
| `activity record` | Activity linking task + progress |

### 2.7 Catalog, resources, hosts, hooks

| Command | What it does |
|---|---|
| `catalog list/show/check` | Canonical manifest, SHA-pinned snapshots, drift |
| `catalog legacy/legacy-show` | Frozen provenance of legacy resources (metadata only) |
| `resource search/diagnose` | Installed resources vs snapshot; tamper-evidence |
| `resource restore-plan/restore` | CAS restore with TOCTOU re-verification |
| `host activate` | Native fragments per host+surface; hosts: claude, codex, opencode, devin, antigravity, hermes, generic (provisional). Every destination declares `activationMode: apply\|merge\|manual` (the legacy `manualMerge` field is retained, deprecated); merge targets (`.mcp.json`, `.codex/config.toml`, `opencode.jsonc`, `.devin/config.json`, `.agents/mcp_config.json`, `.devin/mcp_config.json`) are machine-local, gitignored and audited by `doctor`'s `host-merge-targets` check. Proposing ≠ activating; project-local destinations only |
| `hooks install/uninstall` | Managed block in `post-commit`, idempotent, never touches user hooks |
| `helper install/list` | Project-local helper scripts with a declarative manifest (the harness never runs them) |
| `specification clarify` | Dated clarification sessions, create-only, over the spec |
| `constitution show/set` | Semver-versioned constitution + complexity tracking |

### 2.7b Declarative distribution (`dist` family)

| Command | What it does |
|---|---|
| `dist run` | Declarative workflow runner: only whitelisted harness primitives (`task.transition`, `methodology.check`, `converge.*`, `analyze.task`, `checklist.*`, `noop`), closed per-op args — `task.transition` accepts `verification`/`review` (`evidence` as alias, both together rejected); atomic checkpoints under `<state>/workflow-runs/`, resume without re-execution |
| `dist stack` | Merges `file://` catalogs by priority; remote URIs = `REMOTE_CATALOG_UNSUPPORTED` (never downloads) |
| `dist compose` | Layered `replace/prepend/append/wrap` resource composition |
| `dist validate` / `dist bundle-validate` | Submission validation: slug id, semver, `source.uri`, mandatory sha256 on remote sources; bundles with pins + missing detection |
| `dist bundle-install` | Copies required `file://` sources under `<configDir>/bundles/<id>/` (256 files / 16 MiB max, create-only, idempotent, content-addressed provenance); dry-run by default, `--apply` writes |
| `dist bundle-mount/unmount` | Mounts/unmounts an installed bundle into the workspace catalog |
| `dist bundle-uninstall` | Removes an installed bundle; `--keep-files` keeps the copied files |
| `dist mounted-list` | Lists the active mounted entries |
| `dist extension-register/list/activate/deactivate` | Create-only registry + `registered→active⇄disabled` lifecycle; activate validates `contributes` against the workspace catalog |
| `dist extension-remove` | Removes a registered extension (must be `disabled` first) |
| `dist preset-register/list` | Create-only preset registry; `overrides` with `target` (`*`, `kind/*`, `kind/id`) are consumed in `buildWorkflowPacket` with a trace on `packet.presets.applied` |
| `dist preset-remove` | Removes a registered preset |
| `dist selftest` | Self-check of the dist subsystem |
| `dist journal` | Reads the CAS mutation trail (`--tail`, `--registry`, `--op`, `--id`) |
| `dist pack` | Packs a directory into a deterministic bundle (`--source DIR --out FILE`) |

### 2.8 Bounded verification

| Command | What it does |
|---|---|
| `verify discover` | Infers candidates from real manifests (never invented; ambiguous pm → skipped) |
| `verify add/approve/approve-discovered` | Explicit whitelist, tamper-evident, preview+apply |
| `verify run ID` | Executes only approved commands as literal argv (never shell): bounded timeout, capped output, optional `--fail-on-error` |

### 2.9 Installation lifecycle

| Command | What it does |
|---|---|
| `backup --to REL` | Self-describing bundle with per-entry hash; streaming, create-only |
| `restore --from REL` | Restore with TOCTOU re-verification and rollback via `createdAbs` |
| `view` | Serves the loopback read-only API + static viewer |

### 2.10 VantaDB integration (optional, never authoritative)

`vantadb setup/status/sync/get/search/list/reinforce/recall/context/distill/sync-memory`
— L1 projection of the journal/worklogs into the external memory engine;
`binarySha256` mandatory in `vantadb.json` (verified before every spawn),
spawn with an env allowlist (no `process.env` inheritance), `secretEgressCheck`
blocks secret filenames/patterns from projection; drains only
committed+acked events.

### 2.11 Other

| Command | What it does |
|---|---|
| `mcp` | Starts the MCP server (stdio) |
| `workspace show/init` | Enrollment with opaque binding |

---

## 3. MCP — 37 `scopegrain_*` tools

### Local read-only (23) — `readOnlyHint`, `openWorldHint:false`

`approval_get`, `artifact_get`, `catalog_get`, `catalog_list`, `check_action`,
`get_task`, `goal_list`, `inspect`, `list_tasks`, `mcp_inventory`, `memory_read`,
`memory_status`, `methodology_check`, `metrics`, `plan_get`, `plan_next`,
`resource_diagnose`, `resource_search`, `session_get`, `specification_get`,
`status`, `task_suggest`, `workflow_packet`

### Backend read-only (6) — `readOnlyHint` + `openWorldHint:true`

Read semantics, but the handler spawns the enrolled `vantadb-server`
binary and sends data to the configured memory backend:

`context`, `memory_context`, `memory_get`, `memory_recall`, `memory_search`,
`session_resume`

### Local write (8)

| Tool | Mutation | Annotation |
|---|---|---|
| `scopegrain_next_task` | Claims the next task when `claimBy` is passed (read when omitted) | `WRITE_LOCAL` |
| `scopegrain_task_meta` | Applies a controlled metadata patch with revision CAS | `WRITE_LOCAL` |
| `scopegrain_memory_add` | Appends to a `lessons\|outcomes\|progress` worklog | `WRITE_LOCAL` |
| `scopegrain_goal_create` | Creates a goal | `WRITE_LOCAL` |
| `scopegrain_task_transition` | Task FSM transition with `--apply` (dry-run when omitted) | `WRITE_LOCAL` |
| `scopegrain_task_create` | Creates a task (input record or flat fields) | `WRITE_LOCAL` |
| `scopegrain_task_disposition` | Sets/clears a task disposition | `WRITE_DISCARD` (`destructiveHint`: discard semantics) |
| `scopegrain_goal_transition` | Goal transition (`open\|achieved\|dropped`) | `WRITE_DISCARD` (`destructiveHint`: `dropped` discards the goal) |

See `resources/references/mcp-tools.md` for the canonical per-tool
classification.

Rules: bounded arguments and strict schemas; importing `server.mjs`
never starts transport nor requires extra deps; core errors pass through
untranslated.

---

## 4. Local API — 30 GET routes

`/api/health` · `workspace` · `tasks` · `tasks/:id` · `tasks/:id/doc` ·
`plans` · `plan-docs` · `plan-docs/:name` · `plans/:key` · `artifact-docs` ·
`artifact-docs/:kind/:name` · `artifacts` · `artifacts/:kind/:id` ·
`journal/operations` · `journal/operations/:id` · `captures` · `memory` ·
`goals` · `metrics` · `reports` · `reports/:name` · `sessions` · `sessions/:id` ·
`approvals` · `approvals/:id` · `catalog` · `catalog/:kind/:id` · `verify` ·
`vantadb` · `workflow`

Security: loopback only, GET only, anti-DNS-rebinding (Host/Origin),
`Cache-Control: no-store`, `nosniff`, `no-referrer`.

## 5. Viewer — 15 views

Tasks · Plans · Goals · Sessions · Journal · Captures · Artifacts · Catalog ·
Memory · Reports · Approvals · Metrics · Workspace · System · Graph
(dependency DAG + lifecycle funnel).

Product: rendered Markdown (react-markdown+GFM), EN/ES i18n, per-tab
`ErrorBoundary` with retry and collapsible details, a11y (keyboard rows,
`aria-*`, labeled SVGs), full toolchain (vitest+RTL, eslint flat,
typecheck, CI lane). The System view opens with an "owner essentials"
card summarizing the few verbs a human operator needs.

---

## 6. State machine (`policy/workflow.json`)

States (11): `PLAN → ACT → VERIFY → [COLLATERAL] → EVALUATE → REVIEW → ACCEPT → CLOSE`,
plus `RESEARCH`, `STALL`, `ABANDON` (terminal). Rules:

- Mandatory CAS (`expectedRevision`); evidence forbidden on `→ACT` (voids it).
- `REVIEW→REVIEW` only to attach verification/review evidence.
- Universal ACCEPT gate: all checks `pass` + review `approve`
  (`fresh`: reviewerContext ≠ authorContext; `waived`: owner+reference+reason).
- Methodological gate re-evaluated on `→ACT`, `→ACCEPT` and `→CLOSE`.
- `discarded`/`cancelled` dispositions → only `→ABANDON`.
- The canonical contract's `constraints` block declares these runtime
  gates the edges cannot express — `terminalDispositions`
  (`discarded`/`cancelled` → `ABANDON`) and `methodologyRevalidatedTargets`
  (`ACT`, `ACCEPT`, `CLOSE`) — and `transition.mjs` pins them: divergence
  between policy and runtime fails `POLICY_INVALID`.
- C0 legacy origin: faithful spine; deliberate divergences — COLLATERAL
  optional (direct `VERIFY→EVALUATE`), `VERIFY→ACT`/`REVIEW→ACT` rework,
  recoverable STALL, new ABANDON, quantitative legacy guards
  (Gate V, budgets, WIP) declared but unenforced.

## 7. Methodologies (`policy/methodology.json`)

| Mode | ACT requires | ACCEPT additionally |
|---|---|---|
| `manual` | Nothing (V1 without gates) | Universal gate |
| `organic-sdd` `light` route | Valid assessment classified `light` + scope | + verification/review shapes |
| `organic-sdd` `sdd` route / `sdd` | `specId`+`designId` pair, healthy bindings, spec without open questions, live approvals, deps in CLOSE, ≥1 scenario | + exact `scenarioRefs` coverage + `OUTCOME_REQUIRED` (approved V2 report) |

- **ODD = Organic-Driven Development** (`oddDefinition:"organic-driven"`, enforced).
- "Outcome-Driven" is NOT a mode: outcome records are acceptance evidence.
- Internal routes: `manual`, `read-only`, `blocked`, `light`, `sdd`.
- `researchEscalation`: half enforced — `revisitDesignAfterAttemptsWithoutProgress` (3 `VERIFY→ACT` reworks without a `RESEARCH` visit block `→ACT`); `investigateAfterSimilarFailures` (2 causally similar failures → investigate) is declared and NOT mechanized — judging causal similarity is the agent's obligation (`causalGrouping: explicitly-recorded-hypothesis-not-inferred-from-counts`), see `rules/research-escalation.md`.

## 8. Structural guarantees

- **Fail-closed**: malformed/tampered/stale binding/insufficient scope → typed error before writing.
- **Create-only + CAS**: foreign bytes are never overwritten; foreign files always preserved.
- **Transactional journal**: committed + ACK; receipt-based recovery; `{t,pid,at}` locks (dead pid reclaimable, live never, legacy by TTL, dev/ino anti-race).
- **Symlinks/junctions rejected** in journal, scopes, restore, metadata.
- **Determinism**: same input → same bytes; caller-provided timestamps.
- **Bounded**: size/depth budgets on every untrusted-state read.
- **No implicit effects**: MCP import does not start a server; lazy CLI; execution `manual`, network `ask`, push `ask`.
- **Privacy**: secret-adjacent material is never read or listed in discovery; `.env`-style files are excluded from the structural index entirely.

## 9. Canonical resources (projectable)

`resources/` — 44 skills · 22 rules · 18 commands · 15 agents · 24 references ·
11 prompts · 5 profiles · 1 mcp = **140 entries** + 32 aliases. `manifest.json`
is the catalog with SHA snapshots (`catalog check` verifies drift;
byte-deterministic, no `generatedAt`); installation via
`init`/`update`, opt-in versioning per category. Required profile keys
are `skills`/`rules`/`references`; `mcps` is optional (per-profile MCP
descriptor gating — `core` declares `mcp/scopegrain`, supplementing
every packet).

## 10. State and paths

| Key | Default | Contents |
|---|---|---|
| `state` | `.scopegrain/state/` | journal, sessions, workspace, verify-commands, record-ownership, init-session, `cache/structure-index.json`, `cache/catalog-fingerprint.json` (verify-then-pin catalog fingerprint cache; per-resource re-hash still enforced at serve time) |
| `plans` | `.scopegrain/plans/` | plans + `specs/` |
| `tasks` | `.scopegrain/tasks/` | task records |
| `reports` | `.scopegrain/reports/` | reports + `reviews/` (fixed) |
| `research` | `.scopegrain/research/` | research records |
| `decisions` | `.scopegrain/decisions/` | `approvals/` |
| `memory` | `.scopegrain/memory/` | JSONL worklogs, `archive/`, `captures/`, goals |
| config dir | `.scopegrain/` | config.json, instructions.md, discovery.json, catalog.json, installed resources, policy, context.md |

## 11. Known debt and gaps (audit 2026-11-20, updated 2026-11-22)

1. **Discovery / Structural index**: actionable items resolved — `structure scan|status|show|refresh` implemented (2026-11-21..22); `context` stays strictly read-only reporting `refreshPolicy: "explicit"`. Out of core by design: real AST/symbols (delegated to host), Deno/Makefile/Docker/devcontainer and CI workflow contents.
2. ~~**Agentic research legacy**~~: resolved (2026-11-22) — `resources/commands/investigate.md` formalizes the 6-phase structured research workflow, all 5 legacy workflows in `provenance/legacy-inventory.json` map to portable canonical commands (`manifest.json` v`0.1.1`), and `examples/preset-yagni.json` provides the host-agnostic equivalent of legacy `ponytail` mode.
3. ~~**`diffInvestigation`**~~: resolved — exposed as `investigate --diff` (2026-11-21) and embedded in `doctor`'s fingerprint warning.
4. ~~**Doctor**~~: resolved (2026-11-22) — ~35 checks: 27 named families + 7 `paths.*` always on, including `mcp-deps`, `viewer-build`, `user-artifacts`, `user-config`, `stale-locks`, `host-fragments`, `host-merge-targets` (machine-local merge targets: `.mcp.json`, `.codex/config.toml`, `opencode.jsonc`, `.devin/config.json`), `host-cli` and `docs-cli-drift`; plus the conditional `journal-internals` and `upgrade`.
5. **Quantitative legacy guards**: partially resolved — `researchEscalation` enforced 2026-11-21 (3 `VERIFY→ACT` reworks without a `RESEARCH` visit block `→ACT`). Still open: iteration/duration budgets, WIP, and the "similar failures" half of escalation (requires hypotheses as a record field).
6. ~~**Tests**~~: resolved (2026-11-22) — added `bootstrappedMiniCtx`, `test:smoke` and `test:fast` (`--test-concurrency=2`), migrated unit suites and `methodology-fixtures.mjs`, and added parameterized `assertOwnedStoreContract` with zero adversarial coverage removed.
7. **Init and global config**: resolved (2026-11-22) — global user config (`~/.config/scopegrain/config.json`, `config path|show|set`) for onboarding defaults only with strict workspace precedence; internal store layouts remain fixed by design.
8. ~~**Context rehydration & VantaDB L3**~~: resolved (2026-11-21..22) — `context` injects a bounded `memory_search` over the per-project `l1/sg-<projectHash>` namespace, `session resume` + MCP inject per-record `memory_context`, and `vantadb sync-persona` projects proved `preference`/`decision` captures into `l3/sg-persona-<projectHash>`.
9. ~~**Plan wave persistence & viewer**~~: resolved (2026-11-22) — `plan run --apply` persists atomic checkpoints under `<state>/plan-runs/<key>.json`, surfaced in `/api/plans/:key` and `PlansView`; `/api/sessions/:id` and `SessionsView` surface `resumeContext`.
