---
name: implement-task
description: Implement one authorized dependency-ready task using its selected light or SDD route.
---
# Implement One Task

Entry condition: a task identifier or an explicit owner-approved unit of
work.

Load skills: `select-capabilities`, `contract-execution`,
`incremental-implementation`, `test-driven-development`,
`systematic-debugging` on failure, `session-handoff` on close.
Governing rules: `rules/workflow`, `rules/evidence`, `rules/review`.
Roles: `implementer` executes; `reviewer` owns the Step-4 gate.

The task-record procedure lives in `prompts/task-brief` (classify,
discovery, atomic steps, record template, review gate); worker briefs
follow its required slots. Owner gates use `prompts/decision-request`
(P/D/V/C); feature-adds use `prompts/spec-brief`; collateral findings use
`prompts/finding-record`; the continuation record and RESULT block follow
`prompts/session-recitation`; review briefs follow
`prompts/review-request`. One lifecycle iteration at a time —
step-by-step debugging — runs `prompts/iteration-loop`.

## Modes

| Invocation | Behavior |
|---|---|
| `implement-task <ID>` | Full depth: locate, define, implement, verify, review, close |
| `implement-task <ID>` + "step through" | One lifecycle iteration per invocation via `iteration-loop` |

## Step 0 — Locate and classify (not skippable)

1. Resolve the task in order: the newest plan under the configured plans
   path, the recorded backlog source, then task records under the
   configured tasks path — active, completed and closed locations, not
   only the active list. If it cannot be found, ask the owner; never
   invent the task.
2. Read the real task record, original request, revision, scope and
   current code. Confirm authority, acceptance criteria, dependency
   readiness and the actual authorized checks. An unknown task,
   unresolved product decision, missing consent or a blocked methodology
   gate prevents implementation — report it, do not work around it.
3. Resolve its route (`rules/methodology`):
   - **Light (ODD):** keep its bounded record and recorded authorization;
     do not fabricate specification/design approvals.
   - **SDD:** read the approved specification, design, plan or
     single-task contract and the assigned scenarios.
4. Apply feature-add detection (`task-brief` Phase 1): a task that adds
   new public symbols or contracts is a feature-add regardless of its
   type label — it needs a valid `spec-brief` mini-spec before ACT.
5. If a required capability (runtime verb, tool, delegation channel) is
   unavailable, report the gap instead of claiming that a prompt or a
   distinct context label enforced the gate.

## Step 1 — Prepare the task record

If no bounded task record exists, create one under the configured tasks
path per the `task-brief` template containing at minimum:

- Identity, original request, selected route and recorded authority.
- Impact analysis: blast radius, callers and dependents, domain
  invariants that must keep holding (`analysis` fields in
  `references/backlog-format`).
- Assigned scenarioRefs (SDD) or classification facts (light).
- Security/performance notes and known-unknowns.
- Atomic steps, each with a verifiable check (`references/testing-patterns`).
- Definition of done (`references/definition-of-done`): behavior,
  regression coverage, docs/contract sync and the evidence that proves
  each.

## Step 2 — Discovery

- Inspect the affected surface: definitions, callers, blast radius and
  prior decisions. Use graph tooling when it is indexed and fresh;
  otherwise search source and state the weaker guarantee
  (`references/graph-investigation`).
- Heavy discovery — multi-document external research or a wide blast
  radius — is delegated read-only to `researcher` (digest contract:
  `prompts/research-brief` §A); fold the returned bounded digest with
  sources into the task record. Keep light discovery inline. Do not
  fragment delegation per step.
- For external API, library or platform choices, validate against primary
  documentation after network permission (`web-research`); a cited
  tradeoff outranks an adjective.

## Step 3 — Execute

1. Reproduce a defect with a causal failing check before changing
   behavior whenever a runnable deterministic check exists; explain any
   exception.
2. Apply the smallest fix upstream; preserve unrelated work; keep edits
   inside authorized scope (ACT).
3. Verification is manual by default: propose the project's recorded
   verification commands and working directory, then record actual owner
   output. Run only authorized checks — a proposed command is not a
   passing check, and an unexecuted check is never claimed green.
4. Retry discipline: two verify failures with the same error
   (file+line+message) trigger Gate V (`decision-request`) — ask the
   owner before further attempts. On repeated failure follow
   `rules/research-escalation`; do not retry blindly. Diagnose via
   COLLATERAL/RESEARCH; STALL when blocked on a decision.
5. Route defects discovered that are not this task's objective per
   `prompts/finding-record` — backlog record at discovery time, never
   only in notes.

## Step 4 — Review gate (not skippable)

The task does not close without review registered in the task record:

- Preferred: a separate reviewer context (`independent-review`) briefed
  via `prompts/review-request` — contract, complete diff, raw evidence.
- Without a delegation capability: `doubt-driven-development` self-review
  explicitly marked **degraded**, plus an explicit scoped owner waiver
  recorded with owner, reference and reason.
- A renamed role for the author is not independence. Named risks
  (security, data-integrity, public-contract, concurrency, delivery,
  external-effects, verification-gap) require real fresh-context review.
- Mechanized acceptance (Gate C): recording completion requires the
  review payload — `fresh` with reviewer context ≠ author context +
  verdict `approve`, or `degraded` + owner waiver — per
  `session-recitation`. No payload, no CLOSE.

## Step 5 — Close

1. Inspect the complete diff and raw evidence; record actual verification
   and continuation in the configured harness paths
   (`prompts/session-recitation` format).
2. If the task authorizes commits, create a local Conventional Commit
   carrying the task identity only after verification — never push;
   publication is a separate owner decision (`work-unit-commits`).
3. Update the backlog item and plan state; run `session-handoff` for the
   progress record and durable learnings.
4. For SDD, close only assigned scenario coverage — one task does not
   certify the entire feature.
5. Stop after this task: neither publication, destructive effects nor the
   next task is implicitly authorized.

## Authority and verification

Execution edits only inside the authorized scope (ACT state). Every
check is either a recorded executed result or an explicitly proposed
command awaiting owner output — manual verification by default. Review
and acceptance follow the mechanized payload above; waivers are recorded
owner decisions, never self-granted.

## Output contract

- Task record under the configured tasks path, updated through the
  lifecycle, with continuation block per `session-recitation`.
- Per-invocation RESULT block (`session-recitation` §RESULT) whenever the
  work ran as a delegate or in step-through mode.
- Review record with reviewer identity/mode, verdict and evidence.
- Local commit where authorized; backlog and plan state updated.

## Red flags

- Working around an unknown task, missing consent or a blocked
  methodology gate.
- An `N/A` spec section on a feature-add — blocking review finding.
- A renamed role offered as independent review; a self-reported green
  check offered as evidence.
- Findings kept in notes or commit messages instead of `finding-record`.
- Commits staged with `add -A` or pushed without explicit authorization.

## Handoff

Report: task record path, delegated role if any, executed checks with
evidence, review record. Next options for the owner: `implement-task`
for the next task, or `coordinate-plan` for the remaining plan.
