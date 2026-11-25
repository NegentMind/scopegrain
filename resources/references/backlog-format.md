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
| `contextInheritance` | `isolated\|summary\|full` or null | How much prior context the executor receives when the task (or session) resumes. Declarative guidance for the host that assembles the packet — the harness does not pack context. Additive extension, same read/write rule as `allowedTools`. |
| `modelTier` | `fast\|standard\|reasoning` or null | Declared model profile the host should route to. The host owns routing and cost; the field only records intent. Additive extension, same read/write rule as `allowedTools`. |
| `directives` | `[non-empty string]` or null | Custom instructions the host should inject when executing this task (e.g. "always strict TS, answer in Spanish"). Declarative — the harness carries them, hosts apply them. Additive extension, same read/write rule as `allowedTools`. |
| `sharedContext` | `{string: string}` or null | Shared key-value variables visible to the task (`repo_url`, `brand_tone`…). Max 32 keys, values ≤1KiB. Declarative; hosts inject them. Additive extension, same read/write rule as `allowedTools`. |

`history[]` events carry an optional `runId` (UUID) correlating the
mutation with the operation that wrote it: for journaled (owned) writes
it IS the journal `operationId`; for legacy writes it is a fresh UUID per
call. Events written before the field existed stay valid — `runId` is
tolerated when present, never required on read. Transitions do not open
sessions, so a session cannot inherit a runId; session↔task correlation
stays on the session's own record.

`createKey` (non-empty string, create input only — not a V3 field and
never meta-settable) makes creation idempotent: `task create` fails
`TASK_CONFLICT` when a stored record already holds the key while still
active. Active means not `ABANDON` and not `cancelled`/`discarded`
disposition — a `CLOSE`d record still conflicts (the intent was
delivered; a new task needs a new key). An explicit conflict is returned
rather than silently returning the existing record, so retries cannot
hide a real collision.

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

The V3 layer also tolerates additive extension fields on stored plans:
older V3 records missing them remain valid; whenever a plan is written
as V3 all extension keys are emitted (defaulting to null). Using any
semantic or extension key still requires the full required V3 set above.

| Field | Type | Meaning |
|---|---|---|
| `request` | non-empty string or null | The user's verbatim intent for the plan — the shared "north" every member task should remember. Declarative; hosts may inject it into member packets. |
| `planType` | `static|dynamic|hybrid` or null | How the plan was assembled: from a fixed template, generated at runtime, or template plus injected items. Declarative. |
| `trigger` | `{kind: manual|scheduled|event|derived, ref?: string}` or null | What originated the plan. The harness records provenance only — it never executes schedules or consumes webhooks. |
| `acceptanceCriteria` | `[non-empty string]` or null | Plan-level success conditions — distinct from `stopConditions` (abort) and per-task contracts. Declarative; hosts evaluate them. |
| `deliverables` | `[{path, mustExist?, mustBeNonEmpty?}]` or null | Files the plan promises to leave behind; same entry shape as task `expectedOutputs`, `path` canonicalized. |
| `synthesisStrategy` | `last-task|aggregate|summarizer|manual` or null | How the final user-facing answer should be assembled from member outputs. Declarative hint for the host. |
| `replanPolicy` | `strict-abort|insert-remediation|prune-branch|manual` or null | What the host may do when a member fails: kill the plan, inject remediation tasks, prune a branch, or ask a human. The harness stores the policy; hosts execute it. |
| `executiveSummary` | non-empty string or null | Human-readable one-paragraph summary of what the plan does, for fast approval review. |
| `autonomyPolicy` | `full-auto|approve-first|gate-on-critical` or null | Human-supervision level for the whole plan. Declarative; enforcement lives in hosts and `preAction` hooks. |
| `concurrencyPolicy` | `allow-parallel|queue|cancel-replace` or null | What a host should do if the same plan triggers while a prior run is active. |
| `ttlSeconds` | int >= 0 or null | Declared time-to-live; expiry itself is host-side. |
| `supersedes` | plan key or null | Points to the plan this one replaces — replanning creates `v+1` with `supersedes` naming the prior plan, preserving the chain. The referenced plan must exist (`PLAN_NOT_FOUND`). |
| `version` | int >= 1 (default `1`) | Human-meaningful revision of the planning chain, independent of the storage-layer `revision`. |
| `createKey` | non-empty string or null | Idempotent-creation key: a second `plan create` carrying a key already held by an existing plan fails with `PLAN_CONFLICT`. Plans have no terminal state, so the key stays reserved while the plan exists. |

Individual `tasks[]` member entries on a V3 plan may also carry
annotations (optional on input, emitted as null defaults on V3 writes):

| Field | Type | Meaning |
|---|---|---|
| `rationale` | non-empty string or null | Why the planner picked this member — distinct from `triageReason`, which justifies the triage decision. |
| `parameterOverrides` | `{key: string|number|boolean}` or null | Scalar values overriding the member's defaults for this instance (e.g. timeout, input payload). Declarative; hosts resolve them. |
| `instructionPatches` | `[non-empty string]` or null | Extra instructions appended only to this instance of the member. |

Declarative data-flow wiring also lives on the V3 plan record:

| Field | Type | Meaning |
|---|---|---|
| `ioBindings` | `[{to, input, from, output}]` or null | `from.output` of one member feeds `input` of member `to`. `to`/`from` must be plan member keys, self-bindings and duplicate `(to,input)` pairs are rejected. The harness validates shape and references only — hosts resolve bindings at run time. |
| `directives` | `[non-empty string]` or null | Plan-wide custom instructions. Forwarded into every member task record that doesn't declare its own (members may override whole-field). Same semantics as the task field. |
| `sharedContext` | `{string: string}` or null | Plan-wide shared variables (≤32 keys, ≤1KiB values). On materialization the plan map merges under each member's own map (member keys win; an explicit member `null` clears the map for that member). |

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
