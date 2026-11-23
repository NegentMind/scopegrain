---
name: plan-work
description: Prepare a dependency graph for settled formal work without executing it.
---
# Plan Work

Entry condition: an authorized input — the recorded backlog source, a
settled specification, or an explicit owner request for a formal plan.
With no argument, use the project's recorded backlog.

Load skills: `select-capabilities`, `planning-and-task-breakdown`,
`writing-plans`, `brainstorming`, `plan-design-review`. When backlog items
describe substantial or sensitive work without a settled specification,
also load `spec-driven-development`. Backlog semantics:
`references/backlog-format`. Governing rules: `rules/workflow`,
`rules/api-contract`. Roles: `lead` coordinating, `architect` for
boundary decisions.

The deep planning procedure lives in `prompts/plan-brief` — per-task
reality check, pre-mortem, stop conditions, "is it NOW" checklist, Cynefin
classification, per-task registration fields and the plan record format.
This command owns routing, the gate summary and the output contract; owner
confirmations use `prompts/decision-request` (Gate P) and feature-add
candidates use `prompts/spec-brief`.

## Modes

| Invocation | Behavior |
|---|---|
| `plan-work` | Build a plan from the project's recorded backlog |
| `plan-work <input>` | Build a plan from the named backlog/spec input |

## Step 0 — Specification gate

Look for a settled specification in the harness workspace or an approved
spec artifact. If one exists, use it as context. If none exists and the
backlog contains substantial feature work, run `specify-change` first —
context derivation, open-decision table, one decision round, written spec.
Do not triage past unresolved product decisions.

## Step 1 — Inspect before planning

Read-only. Inspect existing plans under the configured plans path, current
task records, prior specifications and the implementation itself. Identify
the actual gap. Re-running `plan-work` is idempotent: reconcile against
what already exists and never produce a second plan for the same work.

- Do not produce another plan for completed work, and do not impose a
  formal graph on a genuinely light task — light work keeps its bounded
  task record (`rules/methodology`).
- An explicitly requested formal plan uses the SDD path even when a
  lighter route would have been possible.
- Read the settled structured specification, approved design and evidence
  PLAN. Final outcome evidence cannot be required before the work exists.
- Preserve the original request, constraints and exact behavioral examples.

## Step 2 — Triage gate

Classify every backlog item `do` / `defer` / `skip` / `blocked` with a
one-line reason (the plan `triage` record; `references/backlog-format`).
Apply the full per-task verification of `prompts/plan-brief` — reality
check against current code, pre-mortem failure modes, "is it NOW"
checklist, Cynefin class and top-3 risks, appetite and stop conditions.

Gate rules:

1. Bug already fixed or feature already implemented (verified against
   code, not trusted from backlog prose) → `skip`.
2. Cosmetic change with no user complaint → `defer`.
3. Effort far exceeds impact → `defer` or `skip`.
4. Dependency not ready → `blocked`, naming the blocker.
5. Recorded priority is a suggestion, not an ordering — the real
   dependency order wins.
6. Critical priority, an ambiguous contract, or a candidate adding new
   public symbols → one owner round per `decision-request` (Gate P);
   feature-adds resolve their `spec-brief` open decisions before `do`.
7. An unrelated defect surfaced by the reality check registers per
   `prompts/finding-record` — it is not silently added to the plan.

Exclude items whose recorded disposition is deferred/icebox/future/
discarded/cancelled. If the backlog does not match a known schema,
interpret it directly and state the assumption instead of forcing a parse.

## Step 3 — Build the plan

1. Identify the dependency graph between components; keep the DAG acyclic.
2. Slice vertically: one complete working path per task, not horizontal
   layers. Coherent behavior keeps its tests and docs in the same unit.
3. Every task gets: a stable key, bounded scope and exclusions, assigned
   scenarioRefs from the specification, exact proposed checks discovered
   in this project, dependencies expressed as plan keys, and the required
   capabilities — plus the `plan-brief` fields (gate justification,
   mechanically verifiable contract, pre-mortem, stop conditions, risk
   register, uphill/downhill). The task record created later on demand
   follows `prompts/task-brief`; module boundaries conform to
   `references/architecture`.
4. Cover all specification scenarios across the plan, not inside every
   task. Each formal task owns at least one verifiable scenario; if a
   candidate task has none, agree a technical scenario or regroup it —
   never invent requirements.
5. Keep parallel writes independent and disjoint; mark unknowns `blocked`
   instead of guessing parameters.
6. Add checkpoints between phases where an owner decision or an external
   effect gates the next phase.
7. Do not select paid models, budgets or external effects without
   approval.

## Step 4 — Present and persist

Present the complete plan — summary table (do/defer/skip/blocked counts),
task table, operational destinations — for owner confirmation, including
the complete defer/skip set (Gate P). Persist only `do` tasks, only
through available approved harness operations, into the configured plans
path (`plan-brief` plan record format). Record the backlog source of every
task. Creation leaves tasks in PLAN; a persisted plan is not authorization
to implement it.

## Authority and verification

Read-only until the owner confirms the plan; persistence goes only through
approved harness operations into the configured plans path — never into
product documentation. Exact requested behavior and constraints are
preserved verbatim into task records.

## Output contract

- Plan record in `plan-brief` format under the configured plans path:
  summary counts, per-task verified evidence, gate justifications,
  contracts, risk registers, DAG dependencies.
- Owner decision recorded for the defer/skip set.
- Tasks remain in PLAN state; downstream commands create task records on
  demand.

## Red flags

- Planning already-built work because backlog prose was trusted over code.
- A second plan over an in-flight one instead of reconciling it.
- A formal graph imposed on a light task, or a light shortcut on sensitive
  named-risk work.
- `do` fixed before the Step-0 reality check ran.
- Execution started inside this command — `plan-work` never implements.

## Handoff

Report the plan identity and the next gate:

- `coordinate-plan` — execute the ready tasks of this plan.
- `implement-task` — define and run one specific task.
- `specify-change` — settle unresolved product decisions first.

Stop after handoff; do not begin execution without the owner's choice.
