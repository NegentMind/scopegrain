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

## Plan semantic layer (schemaVersion 3)

Plan records may carry the legacy plan-file semantics. Any semantic key
at `plan create` upgrades the stored plan to `schemaVersion: 3`;
`specId`/`designId` become present-but-nullable (both null or both
UUIDs). Every plan task entry may also carry `triage`
(`do|defer|skip|blocked`) + `triageReason`, and any task semantic field
except `dependsOn` (which inside a plan names plan keys, the DAG).

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

## Operational memory (`.tasksystem/memory/*.jsonl`)

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
