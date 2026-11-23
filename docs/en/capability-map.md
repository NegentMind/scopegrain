# Scopegrain — Complete capability map

Detailed catalog of surfaces, subsystems, commands and guarantees of the
harness. Reference state: `develop` branch, `scopegrain@0.1.1`, suite
`1411/1411` tests + `17/17` viewer tests, catalog `132` entries (`v0.1.1`).
Canonical Spanish version: `docs/capability-map.md`;
this is its English twin.

> Conventions: *(write)* = mutates state; *(preview/apply)* = dry-run by
> default, `--apply` confirms; everything else is read-only.
> `--yes`/`--force` do not exist: every confirmation is explicit. Output
> is always JSON (results on stdout, errors on stderr).

---

## 1. Entry surfaces

| Surface | Inventory | Access |
|---|---|---|
| CLI `bin/scopegrain.mjs` (alias `bin/tasksystem.mjs`) | ~95 subcommands, lazy per-command imports | Human and agent |
| MCP `src/mcp/server.mjs` | 32 `scopegrain_*` tools: 26 `READ_ONLY` + 6 `WRITE_LOCAL` | MCP hosts (stdio) |
| Local API `src/api/server.mjs` | 29 GET routes `/api/*` | Loopback-only, GET-only |
| Viewer `viewer/` (`scopegrain view`) | 15 views, React 19 + TS + Vite + Tailwind | Read-only, human |
| Catalog `resources/manifest.json` | 130 entries + 32 aliases | Projectable into the project |

---

## 2. CLI — catalog by domain

### 2.1 Discovery and onboarding

| Command | What it does |
|---|---|
| `inspect` | Bounded manifest snapshot (8 stacks, lockfiles by presence, package.json test/lint/build scripts, AGENTS/CLAUDE/README, sha256 fingerprint). Stores `discovery.json` |
| `investigate [--save] [--diff]` | Semantic analysis: + dart/flutter/swift/gradle, monorepo topology, platforms, test frameworks, CI, hosts, i18n, layout. Suggests init answers with confidence+evidence. `--save` persists a research record. `--diff` compares current evidence against `discovery.json`+config: fingerprint, added/removed/retained manifests and lockfiles, changed content, added/dropped stacks and commands, new host signals, stale decisions, notes |
| `assess --input DIFF` | Evidence-only risk classification over a unified diff (paths, modes, added content): `passive|medium|high` tier, reasons, `review_due`. Fail-closed, read-only, no git/child_process; `--assessment` reports discrepancy vs declared risk |
| `init` | Onboarding: investigates, asks name/locale/hosts/methodology, **7 paths** (`plans tasks reports research decisions memory state`), **8 versioning flags**, proposes a bounded `.gitignore` and seeds the structural index. `--defaults`/`--answers` for non-interactive |
| `adopt` | Deterministic: reports config, enrollment and journal of a project with prior remains; `--apply` only creates the enrollment when `adoptable` |
| `doctor` | ~21 checks: installation + operational health (see §7) |
| `structure scan/status/show` | Bounded structural index of the project tree: inventory, LOC/bytes per language, imports, internal/external edges, fan-in/fan-out, heuristic complexity, deterministic fingerprint. `scan --apply` persists at `<state>/cache/structure-index.json`; `status` reports freshness without rescanning; `context` exposes it to the agent |
| `update [--reconcile]` | Re-projects generated files from the current installation; `--reconcile` rewrites only divergent files under harness roots |
| `uninstall` | Deletes only what the harness provably created; divergent files stay `leftBehind` |

### 2.2 Context and workflow

| Command | What it does |
|---|---|
| `context [--tail N]` | Session-start packet: instructions, user's `context.md`, workspace, ready tasks, goals, pending journal, recent worklog (degradable, never aborts) |
| `workflow COMMAND` | Packet for an installed command: resources + modes + host + profile + interaction |
| `task check-action` | Gate: may ACTION run against the task now? (abstract actions read/edit/propose/…; `interceptsNativeTools:false`) |
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
| `session create/show/record/resume` | Sessions with explicit operation budget (`maxSessionEvents` limit), CAS, own lock, ACT events |

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
| `host activate` | Native fragments per host+surface; hosts: claude, codex, opencode, devin, antigravity, hermes. Proposing ≠ activating; project-local destinations only |
| `hooks install/uninstall` | Managed block in `post-commit`, idempotent, never touches user hooks |

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
binary with sha256 + cache, spawn with pinned env; drains only
committed+acked events.

### 2.11 Other

| Command | What it does |
|---|---|
| `mcp` | Starts the MCP server (stdio) |
| `workspace show/init` | Enrollment with opaque binding |

---

## 3. MCP — 32 `scopegrain_*` tools

### Read-only (26)

`artifact_get`, `approval_get`, `catalog_get`, `catalog_list`, `check_action`,
`get_task`, `goal_list`, `inspect`, `list_tasks`, `memory_context`, `memory_get`,
`memory_read`, `memory_recall`, `memory_search`, `memory_status`,
`methodology_check`, `metrics`, `plan_get`, `plan_next`,
`resource_diagnose`, `resource_search`, `session_get`, `session_resume`,
`specification_get`, `status`, `workflow_packet`

### Write-local (6)

| Tool | Mutation |
|---|---|
| `scopegrain_next_task` | Claims the next task when `claimBy` is passed (read when omitted) |
| `scopegrain_task_meta` | Applies a controlled metadata patch with revision CAS |
| `scopegrain_task_disposition` | Sets/clears a task disposition |
| `scopegrain_memory_add` | Appends to a `lessons\|outcomes\|progress` worklog |
| `scopegrain_goal_create` | Creates a goal |
| `scopegrain_goal_transition` | Goal transition (`open\|achieved\|dropped`) |

See `resources/references/mcp-tools.md` for the canonical per-tool
classification.

Rules: bounded arguments and strict schemas; importing `server.mjs`
never starts transport nor requires extra deps; core errors pass through
untranslated.

---

## 4. Local API — 29 GET routes

`/api/health` · `workspace` · `tasks` · `tasks/:id` · `tasks/:id/doc` ·
`plans` · `plan-docs` · `plan-docs/:name` · `plans/:key` · `artifact-docs` ·
`artifact-docs/:kind/:name` · `artifacts` · `artifacts/:kind/:id` ·
`journal/operations` · `journal/operations/:id` · `captures` · `memory` ·
`goals` · `metrics` · `reports` · `reports/:name` · `sessions` · `sessions/:id` ·
`approvals` · `approvals/:id` · `catalog` · `verify` · `vantadb` · `workflow`

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
- `researchEscalation` (2 failures → investigate, 3 → review design): declared, unenforced.

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

`resources/` — 44 skills · 22 rules · 17 commands · 15 agents · 24 references ·
4 prompts · profiles · mcps. `manifest.json` is the catalog with SHA
snapshots (`catalog check` verifies drift); installation via
`init`/`update`, opt-in versioning per category.

## 10. State and paths

| Key | Default | Contents |
|---|---|---|
| `state` | `.scopegrain/state/` | journal, sessions, workspace, verify-commands, record-ownership, init-session, `cache/structure-index.json` |
| `plans` | `.scopegrain/plans/` | plans + `specs/` |
| `tasks` | `.scopegrain/tasks/` | task records |
| `reports` | `.scopegrain/reports/` | reports + `reviews/` (fixed) |
| `research` | `.scopegrain/research/` | research records |
| `decisions` | `.scopegrain/decisions/` | `approvals/` |
| `memory` | `.scopegrain/memory/` | JSONL worklogs, `archive/`, `captures/`, goals |
| config dir | `.scopegrain/` | config.json, instructions.md, discovery.json, catalog.json, installed resources, policy, context.md |

Legacy `.tasksystem/` remains honored as an alternative state path.

## 11. Known debt and gaps (audit 2026-11-20, updated 2026-11-22)

1. **Discovery / Structural index**: actionable items resolved — `structure scan|status|show|refresh` implemented (2026-11-21..22); `context` stays strictly read-only reporting `refreshPolicy: "explicit"`. Out of core by design: real AST/symbols (delegated to host), Deno/Makefile/Docker/devcontainer and CI workflow contents.
2. ~~**Agentic research legacy**~~: resolved (2026-11-22) — `resources/commands/investigate.md` formalizes the 6-phase structured research workflow, all 5 legacy workflows in `provenance/legacy-inventory.json` map to portable canonical commands (`manifest.json` v`0.1.1`), and `examples/preset-yagni.json` provides the host-agnostic equivalent of legacy `ponytail` mode.
3. ~~**`diffInvestigation`**~~: resolved — exposed as `investigate --diff` (2026-11-21) and embedded in `doctor`'s fingerprint warning.
4. ~~**Doctor**~~: resolved (2026-11-22) — 32 total checks including `mcp-deps`, `viewer-build`, `user-artifacts`, `user-config`, `stale-locks`, `host-fragments`, `host-cli` and `docs-cli-drift`.
5. **Quantitative legacy guards**: partially resolved — `researchEscalation` enforced 2026-11-21 (3 `VERIFY→ACT` reworks without a `RESEARCH` visit block `→ACT`). Still open: iteration/duration budgets, WIP, and the "similar failures" half of escalation (requires hypotheses as a record field).
6. ~~**Tests**~~: resolved (2026-11-22) — added `bootstrappedMiniCtx`, `test:smoke` and `test:fast` (`--test-concurrency=2`), migrated unit suites and `methodology-fixtures.mjs`, and added parameterized `assertOwnedStoreContract` with zero adversarial coverage removed.
7. **Init and global config**: resolved (2026-11-22) — global user config (`~/.config/scopegrain/config.json`, `config path|show|set`) for onboarding defaults only with strict workspace precedence; internal store layouts remain fixed by design.
8. ~~**Context rehydration & VantaDB L3**~~: resolved (2026-11-21..22) — `context` injects automatic L1 `memory_recall`, `session resume` + MCP inject per-record `memory_context`, and `vantadb sync-persona` projects proved `preference`/`decision` captures into `l3/sg-persona-*`.
9. ~~**Plan wave persistence & viewer**~~: resolved (2026-11-22) — `plan run --apply` persists atomic checkpoints under `<state>/plan-runs/<key>.json`, surfaced in `/api/plans/:key` and `PlansView`; `/api/sessions/:id` and `SessionsView` surface `resumeContext`.
