# Portable Backlog

A useful item states identity, goal, scope, acceptance, dependencies and
status. The owner's backlog may use a different representation.
Scopegrain plans use stable task keys mapped to UUID task records.
Readiness is derived from current dependencies; CLOSE is not inferred from
a prose summary. Priority and dependency readiness are distinct.

## Task semantic layer (schemaVersion 3)

Task records may carry an optional semantic layer. Any semantic field at
creation, or any `task meta`/`task disposition`/`task note`/`task step`
write, upgrades the stored record to `schemaVersion: 3`. V1/V2 records
remain valid forever; the layer is orthogonal to the lifecycle
(`PLAN -> ACT -> VERIFY -> REVIEW -> CLOSE`) and never changes `state`.

| Field | Type | Meaning |
|---|---|---|
| `backlog` | slug or null | Named backlog (`[a-z0-9][a-z0-9-]{0,63}`); `null` = `default`. A project may hold several named backlogs. |
| `disposition` | object or null | Non-lifecycle status: `{kind: deferred|icebox|future|discarded|cancelled, reason, at, by}`; `null` = active. Set via `task disposition` (or `active` to clear). |
| `priority` | `p0|p1|p2|p3|backlog` or null | Owner-declared priority. |
| `severity` | `critical|high|medium|low|info` or null | Impact grading. |
| `type` | `bug|feature|refactor|research|docs|ops|mixed` or null | Work kind. |
| `effort` | `hours|day|days|weeks` or null | Sized effort bucket. |
| `estimate` | `{turns: int>=0, appetite: <effort>}` or null | Estimated turns plus appetite bucket. |
| `source` | string or null | Provenance (finding id, audit, plan). |
| `dependsOn` | `[id]` or null | Other task records this one waits on. |
| `relations` | `{see?: [id], supersedes?: [id], duplicateOf?: [id], blocks?: [id]}` or null | Typed edges to other tasks or external refs. |
| `goalIds` | `[UUID]` or null | Links into the goals log (`goal *`). |
| `analysis` | `{blastRadius?, impact?, invariants?, debt?, debugEvidence?, security?, performance?}` or null | Deep context, each a string. |
| `steps` | `[{name, status: pending|done|skipped, verify?, files?, action?}]` or null | Atomic decomposition; `task step` mutates one entry by index. |
| `notes` | `[string]` or null | Append-only narrative (`task note`). |
| `skills` | `[string]` or null | Capability names exercised. |
| `uncertainty` | `{uphill: int, downhill: int}` or null | Known-unknown vs settled work split. |
| `allowedTools` | `[string]` or null | Per-task least-privilege tool list. Declarative only: the record carries the intent, hosts and `preAction` hooks enforce it — the harness never executes or intercepts tools itself. Optional on stored V3 records (additive extension); always emitted on new writes. |
| `requiredCapabilities` | `[string]` or null | Capabilities the executor must have for dispatch. Distinct semantics: `skills` = capabilities exercised (historical record), `allowedTools` = permitted boundary, `requiredCapabilities` = required for routing — a declarative hint the host uses to pick an executor. Additive extension, same read/write rule as `allowedTools`. |
| `agentRole` | string or null | Declarative profile assigned to the task (e.g. a `resources/agents/*` persona). Reference is not resolved at write time: stored records stay readable even if the profile later disappears. Additive extension, same read/write rule as `allowedTools`. |
| `expectedOutputs` | `[{path, mustExist?, mustBeNonEmpty?}]` or null | Artifacts the task must produce for its definition-of-done. `path` is a canonical relative path inside the project root (same rule as `scope`); existence is not required at write time. VERIFY/EVALUATE consumers may check the files as a deterministic check. Additive extension, same read/write rule as `allowedTools`. |
| `sideEffects` | `none|reversible|irreversible` or null | Declarative impact classification of the task's effects (e.g. `irreversible` for production deploys or external sends). Consumable by `preAction` hooks and hosts — the classification is data, not enforcement: the harness does not execute the effects. Additive extension, same read/write rule as `allowedTools`. |
| `executionType` | `atomic|delegated|hitl` or null | Declarative execution pattern for the host's routing. `consensus`/debate is deliberately excluded: personas do not invoke personas (`resources/references/orchestration-patterns.md`). Additive extension, same read/write rule as `allowedTools`. |
| `outputContract` | string or null | Declarative pointer to the schema or template the deliverable must satisfy (e.g. `schemas/`, `templates/` or a doc). The field points; the harness does not run schema validation over the agent's output. Additive extension, same read/write rule as `allowedTools`. |
| `reviewRubric` | string or null | Scorable criteria the fresh reviewer applies. Guides the attestation without becoming an automatic LLM judge — the review stays a declared attestation (non-executing posture). Additive extension, same read/write rule as `allowedTools`. |
| `fallback` | `{onFail: stall|abandon|needs-human, note?}` or null | Preferred destination if the task fails; the task-level complement of plan `stopConditions`. The runtime does not force the transition — the policy guides the operator/host. Additive extension, same read/write rule as `allowedTools`. |

## Plan semantic layer (schemaVersion 3)

Plan records may carry the legacy plan-file semantics. Any semantic key
at `plan create` upgrades the stored plan to `schemaVersion: 3`;
`specId`/`designId` become present-but-nullable (both null or both
UUIDs). Every plan task entry may also carry `triage`
(`do|defer|skip|blocked`) + `triageReason`, and any task semantic field
except `dependsOn` (which inside a plan names plan keys, the DAG). On
materialization those key edges propagate into each generated V3 task
record as resolved UUID `dependsOn`, so task-level consumers (ordering,
viewers) see the same structure the ACT gate enforces.

| Field | Type | Meaning |
|---|---|---|
| `triage` | `{taskKey: {decision: do|defer|skip|blocked, reason?}}` or null | Per-item gate; keys must be plan task keys. |
| `appetite` | `hours|day|days|weeks` or null | Shape-Up time budget. |
| `cynefin` | `clear|complicated|complex|chaotic|confused` or null | Domain classification for approach selection. |
| `riskRegister` | `[{risk, likelihood?, impact?, mitigation?}]` or null | likelihood/impact: `low|medium|high`. |
| `premortem` | string or null | Recorded pre-mortem analysis. |
| `stopConditions` | `[string]` or null | Conditions that halt execution. |
| `budget` | `{turns?: int>=0, notes?: string}` or null | Turn ceiling + notes. |

`plan next` is triage-aware: entries triaged `defer|skip|blocked` report
status `triaged` instead of `ready`/`blocked`.

## Operational memory (`.scopegrain/memory/*.jsonl`)

Bounded append-only JSONL logs; `memory add --log X --input FILE`,
`memory list --log X [--tail N]`.

- `lessons.jsonl` — `{topic?, text, ref?, taskId?}` durable learnings.
- `outcomes.jsonl` — `{taskId, outcome: ok|fail, skills[]}`; feeds the
  `skillOutcomes` success rates in `metrics`.
- `progress.jsonl` — `{taskId, title, result, summary?, domain?, ref?}`
  written automatically when a task reaches `CLOSE`.
- `goals.jsonl` — meta/objectives; `goal create|list|transition`, latest
  entry per `id` wins; tasks link via `goalIds`.

## Derived metrics

`metrics --project P` aggregates the store on read: counts by state,
backlog, type, priority and disposition; verification pass/first-try
rates; close-time p50/p95/p99; per-skill outcome rates.

## Markdown-table backlog schema (when the project keeps a table backlog)

If the owner keeps backlogs as markdown tables (one file or several named
backlogs), use a single canonical row schema for every task table. Ten
columns, in this order:

`| ID | Severity | Finding | File:line | Effort | Priority | Status | Description | Relations | Dependencies |`

| Column | Content | Vocabulary |
|---|---|---|
| **ID** | `` `PREFIX-NN` `` backticked in the first cell | Backticking lets tooling parse rows deterministically. Prefixes come from the project's registered taxonomy (e.g. `FIND-*` for derived findings); ad-hoc prefixes are prohibited — register them first |
| **Severity** | Impact if NOT resolved | `🔴 Critical` · `🟠 High` · `🟡 Medium` · `🟢 Low` · `ℹ️ Info` · `—` (n/a: features, decisions, minor debt) |
| **Finding** | Short bold title, one line | — |
| **File:line** | Exact location | `path:line`; several separated by ` · `; `—` if n/a |
| **Effort** | Work estimate | `🟢 1h` · `🟡 1d` · `🟠 2-3d` · `🔴 1-2wk` (or explicit ranges) |
| **Priority** | Order of attack | `🔴 High` · `🟠 Medium` · `🟡 Low` · `🟢 Nice-to-have` · `🔵 Future` · `⬜ Unprioritized` (or a `P0..P3` tier where used) |
| **Status** | Current situation | `🆕 Pending` (optional `(YYYY-MM-DD)`) · `⏳ In progress` · `⏸️ Blocked: <reason>` · `🧊 Icebox` · `🔮 Future: <trigger>` · `❌ Discarded: <reason>`. **`✅` does not exist in active tables**: a completed row is REMOVED (recorded in the progress log; removed-unresolved rows go to a history file) |
| **Description** | Context: problem → action → result; absorbs former extra columns as labeled fragments (`Type: … · Source: …`) | — |
| **Relations** | Traceability and links | `Origin: <plan#task · commit · report · audit>` · `Source: <research/report>` · `See: <IDs>` · `Supersedes: <ID>` · `Duplicate of: <ID>` · `Owner: <agent/human>` |
| **Dependencies** | Blocks / prerequisites | `Dep: <ID>` · `Requires: <condition>` · `—` |

### Row rules

1. One row = one task/finding, in ONE backlog only (no duplication across
   files; cross-reference with `See:`).
2. A column with no data → `—`, never an empty cell (deterministic render
   and parse).
3. Pipes inside cell content are escaped `\|`.
4. Summary tables (exec summaries, close-out notes, completed migration
   logs) are NOT task tables — outside this schema.

### Example rows

**Finding:**
``| `FIND-213` | 🟠 High | **Thread-local pool grows unbounded** | `src/index/search/pool.rs` | 🟡 1d | 🟠 Medium | 🆕 Pending | The pool grows without limit under many search threads; drop doesn't reclaim retained buffers. | Origin: audit 2026-09-30 | — |``

**Phase task:**
``| `SCH-09` | — | **Confidence: scheduled revalidation** | `src/sdk/…` | 🟠 2-3d | 🔴 High | 🆕 Pending | 🎯 OP: … · OS: … | Origin: external audit | Dep: SCH-04 |``

**Future row:**
``| `FUT-24` | — | **Deterministic seed in index build** | `src/index/ivf.rs` | 🟡 1d | 🔵 Future | 🔮 Future: use case | Randomized init without a fixed seed → non-reproducible indexes. | Origin: audit | — |``

**Business row (human):**
``| `BIZ-16` | — | **Sign binaries (code-signing cert)** | — | 🟠 2-3d + cost | 🟠 Medium | 🆕 Pending | Cert + signing step in release + checksums. | Owner: owner | Dep: certificate |``

<!-- Cross-references: → see definition-of-done.md, task-domain.md, research-modules.md -->
