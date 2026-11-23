---
name: coordinate-plan
description: Coordinate ready tasks within an approved plan and explicit limits.
---
# Coordinate a Plan

Entry condition: a persisted plan. With no argument, select the most
recent plan under the configured plans path. If none exists, stop:
"No plan found — create one with `plan-work` first."

Load skills: `plan-coordination`, `select-capabilities`,
`session-handoff`, `context-engineering` (orchestrator context budget).
Governing rules: `rules/workflow`, `rules/memory-budget`. Orchestrator
role: `lead`. Task record semantics: `references/task-system`. Every
dispatched task
runs the same depth as `implement-task` — discovery, execution,
verification, review, close.

The orchestrator loop — integrity probes, atomic task claims, the
ten-block delegate brief, result classification, waves, budget ceilings
and the closing retrospective — lives in `prompts/plan-execution` Part A;
the per-task protocol is its Part B. Worker briefs follow
`prompts/task-brief`; interrupted work resumes via
`prompts/recovery-brief`; continuation and RESULT blocks follow
`prompts/session-recitation`; collateral findings route per
`prompts/finding-record`. Owner gates inside delegates use
`prompts/decision-request`.

## Modes

The fail mode is recorded on the plan or chosen by the owner:

| Fail mode | Behavior |
|---|---|
| `stop` | Halt the plan at the first failure. Default when uncertain. |
| `skip` | Mark the failed task, continue independent tasks, report all failures at the end. |
| `parallel` | Wave execution: group ready tasks by dependency level; run each wave through the available delegation capability (default concurrency limit 3); a failed task leaves its dependents blocked. Only disjoint scopes with settled inputs may share a wave. |

Guided step-through is a separate granularity, not a fail mode — see
below.

## Step 1 — Load and reconcile

- Load the plan record, current task states and revisions, approvals,
  available host capabilities and remaining authorized budget. Reuse
  completed and in-flight work — the dependency scheduler does not prove
  that any agent executed; trust current task records, not a stale
  summary.
- Run the integrity probes (`plan-execution` §A.3): plan exists and has
  tasks, continuation block legible, no task repeating without progress,
  working tree consistent with this run, declared index/graph capability
  healthy enough for the task's key files. A failed probe → ask the owner
  before continuing.
- If a checkpoint or state record in the configured state path names an
  in-progress task, resume there instead of restarting the plan.

## Step 2 — Select and brief

- Select only dependency-ready tasks: triage `do` entries whose
  prerequisites closed. Entries triaged `defer`/`skip`/`blocked` report
  as triaged, not ready.
- Prepare one bounded brief per ready task (`prompts/task-brief` required
  slots; the ten mandatory blocks of `plan-execution` §A.5.f): exact task
  references (never paraphrased requirements), allowed write surfaces,
  acceptance, exact authorized checks, return contract (complete diff +
  raw evidence + open questions) and the rework bound before escalation.
  Settle ambiguous contracts before dispatch; an unresolved product or
  permission decision blocks it.
- Keep decisions, critical policies and final approval with the lead;
  read-only roles return findings for the lead to persist
  (`references/orchestration-patterns`).

## Step 3 — Dispatch per fail mode

Claim each task atomically before dispatching it — a second run must not
start discovery on the same task (`plan-execution` §A.4). Delegate only
through an actually available authorized host capability. Without one,
run tasks sequentially in this context and say so — never claim fan-out
that did not happen.

## Step 4 — Per-task close

For each returned result:

1. Inspect the complete diff and artifacts against the original task
   contract — not against the delegate's self-report.
2. Apply the mechanical check recorded in the task before accepting it;
   a summary is not verification.
3. On an incomplete, failed, empty or self-stopped result apply the
   recovery ladder in `prompts/recovery-brief` (RESUME same session →
   RETRY fresh → STRATEGY → ESCALATE). Never redo recorded work, and
   never mark a result failed without the ladder; validate the
   GATES_EVALUATED record on receipt.
4. Record state, verification evidence and a local commit where the task
   authorizes it (`work-unit-commits`); update the plan record and the
   run-state checkpoint under the configured state path.
5. Track stagnation and budgets per `plan-execution` (§A.5.k–n):
   3 consecutive non-DONE results on one task → pause and ask the owner;
   declared budgets are hard stops and every recovery rung counts.

## Step 5 — Plan close

When every task is terminal: run `session-handoff`, report completed,
failed and blocked tasks with their evidence, and produce the closing
retrospective (`plan-execution` §A.8 — keep/stop/continue plus one
measurable process-improvement action). Stop. Do not publish, merge or
start new work; `assess-release` is a separate owner decision.

## Guided step-through

For owner-supervised debugging, process exactly one task — or one step —
per invocation and preserve session state between iterations:

- One complete task per invocation → `prompts/plan-execution` Part B.
- One lifecycle iteration per invocation → `prompts/iteration-loop`.

If several plans are active, list them and ask which one to drive.

## Authority and verification

Delegation happens only through available authorized capabilities;
verification is the task's own mechanical check, recorded — never a
delegate's summary. Commits stay local; push, merge and publication are
separate owner decisions.

## Output contract

- Run-state checkpoint under the configured state path after each task.
- Per-task RESULT blocks, review payloads and recorded verification.
- Updated plan record plus the closing retrospective; progress records
  via `session-handoff`.

## Red flags

- Claimed fan-out without an actual delegation capability.
- A result marked failed without the recovery ladder; recorded work
  re-executed instead of resumed.
- Waves mixing overlapping write scopes or unsettled inputs.
- Acceptance recorded without a valid review payload.
- Publication, merge or new work started inside the close.

## Handoff

Report completed, active, blocked and next-ready work with the plan
identity. Suggest `verify-work` for the mechanical gate or
`report-status` for the dashboard; do not execute them implicitly.
