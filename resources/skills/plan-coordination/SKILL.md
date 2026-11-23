---
name: plan-coordination
description: Use when executing one or more dependent tasks and preserving continuation across interruptions
---
# Plan Coordination

Coordinate the execution of a recorded plan: select dependency-ready work,
drive each task through the lifecycle in narrow slices, preserve durable
state so any interruption can resume, and stop at the agreed boundary.

The architecture is a loop (scheduler or repeated invocations) driving an
executor that performs exactly one meaningful action per turn and records
state in files:

```
SCHEDULER                              EXECUTOR (per turn)
┌────────────────────────┐          ┌──────────────────────────┐
│ for each pending task  │─────────▶│ 1. Read plan record      │
│  1. pick next ready    │          │ 2. Read task record      │
│  2. invoke executor    │          │ 3. One action:           │
│  3. wait + validate    │          │    a. discovery          │
│  4. detect stall       │◀─────────│    b. implement a step   │
│  5. repeat             │          │    c. verify + record    │
└────────────────────────┘          │ 4. Update plan + task    │
                                    │ 5. Write continuation    │
                                    │ 6. STOP                  │
                                    └──────────────────────────┘
```

Read the plan and actual tasks. Select only dependency-ready work.
For each task read state/revision, confirm scope, execute a narrow slice,
record authorized verification and obtain review before acceptance.
Parallelize only disjoint scopes whose inputs are settled.
On partial completion retain useful work and identify missing evidence.
Use resume context rather than rerunning completed operations blindly.
Report blockers and stop at the agreed boundary.

## When to use

- An approved plan holds multiple dependent tasks to execute — across
  turns, sessions or parallel units.
- Work must survive interruption and resume from durable state.

Do not use it for a single isolated task (`contract-execution` covers the
per-task lifecycle end to end) or for authoring the plan itself
(`planning-and-task-breakdown`, `writing-plans`). This skill owns the
**orchestration layer**: scheduling, durable state, handoff and failure
policy. The `plan-execution` prompt operationalizes this loop; the record
templates live in `task-brief` and `session-recitation`.

## Task states

```
⬜ PENDING → ⏳ IN PROGRESS → ✅ COMPLETED
                              ❌ FAILED
                              ⬛ CANCELLED (stop condition fired)
```

State lives in files, not context. Plan and task records are the only source
of truth: read before acting, write after acting.

## Plan record format

```markdown
# Execution Plan: [name]

> **Started:** YYYY-MM-DD
> **Status:** ⏳ IN PROGRESS
> **Source:** [backlog/spec/design record]

## Summary
| DO | DEFER | SKIP | BLOCKED |
|----|-------|------|---------|
| N  | N     | N    | N       |

### Task 1: KEY — description
- **Key files:** `path`
- **Gate rationale:** why this passed triage
- **Contract:** "<verifiable command + condition>"
- **Task record:** `.scopegrain/tasks/<KEY>.md`
- **Status:** ⬜ PENDING | ⏳ IN PROGRESS | ✅ COMPLETED | ❌ FAILED
- **last-synced:** YYYY-MM-DDTHH:MM
```

Plan and task records reference each other and both carry `last-synced`;
update both after every action. Choose the next task from current records —
not from a summary written earlier.

## Contracts: verifiable or not scheduled

Contract semantics — vague vs verifiable — are canonical in
`outcome-driven-development`. The orchestration rules that follow from
them: a task without a verifiable contract cannot be marked complete,
and a green contract claimed without a recorded run is not evidence.

## Integrity probes (before each task)

Before starting any task, verify:

- The plan record exists and holds at least one open task.
- The handoff block (if present) parses.
- The last processed task is not repeating without progress.
- The working tree is clean, or the changes belong to this pipeline.
- No previously stalled task sits unresolved.

A failed probe → pause and ask the owner; do not push through.

## Execution cycle (per task)

1. **Discovery (once per task):** if no task record exists, create one —
   read the affected code, map callers/callees/implications, resolve
   ambiguity, decompose into atomic steps, write the verifiable contract.
   Set status ⏳ IN PROGRESS. Hand off and stop.
2. **Execution (one step per iteration):** read the next pending step;
   run the lifecycle per `contract-execution` (PLAN → ACT → VERIFY, with
   diagnosis paths for failures); on pass, update records, write the
   handoff, stop.
3. **Close:** all steps done → full contract verification → independent
   review → record outcome → status ✅ COMPLETED. On exhausted retries →
   ❌ FAILED with the failed-task rules below.

## The handoff (continuation) block

After every action, write the continuation block at the end of the plan
record — it is the only thing that persists between turns. Whoever
continues must be able to proceed **without asking the predecessor**. The
canonical block (readable render, runtime field mapping and the RESULT
return contract) is defined in `session-recitation`; do not redefine its
fields here.

Invariants, verification commands and pending debt are mandatory in every
handoff — they are what makes it transferable.

## Bounded memory

Only what the next step needs survives between iterations:

| Keep | Discard |
|------|---------|
| Active goals | Closed tool outputs |
| Current step progress | Past build logs |
| Modified critical files | Full diffs (version control has them) |
| Currently failing checks | Success messages |
| The handoff block | Prior conversation |

When context pressure grows, isolate investigation in a delegated context
per the delegation contract. If a task produces noise without progress
beyond ~3 iterations, abort it — do not let it grind.

## Parallel execution (waves)

When independent tasks exist — no inter-dependencies, no shared files:

```
Wave 0: tasks with no dependencies → N parallel units
Wave 1: tasks depending on Wave 0
Wave 2: tasks depending on Wave 1
```

Cap concurrency low (≤3 per wave); each unit runs its own isolated
invocation with its own bounded scope.

## Failure and escalation

The recovery ladder — RESUME → RETRY fresh → STRATEGY → gate to owner →
ESCALATE — is canonical in `recovery-brief`, including the shared
threshold (**2 verify failures with the same error — file+line+message —
fires the owner gate per `decision-request` Gate V; no answer → stop**),
the never-redo-done-steps rule and the per-rung budget accounting.

Failed-task container rules specific to this layer:

- On ESCALATE, move the task record to a closed/failed container — never
  delete it; the plan keeps the ❌ FAILED row and the continuation block.
- Re-opening a failed task requires human review; it resumes from the
  first pending step, not from scratch.
- INCOMPLETE is not FAILED: an interrupted run almost always resolves
  with RESUME.
- Between attempts, re-run the contract verification — an unverified
  state does not count.

## Budgets (defaults; project policy may tighten)

| Control | Default | Behavior |
|---------|---------|----------|
| Iterations per task | 10 | reached → FAILED |
| Sub-units | 40 | hard stop + partial report |
| Consecutive failures | 5 | stop mode |
| Verify calls per task | 15 | reject further |
| Duration | 120 min | expired → FAILED |
| Same-error verify failures | 2 | owner gate; no answer → stop |

Session operation budgets do not measure native calls, tokens or money —
they bound iterations and stalls.

## Compaction

Every ~5 completed tasks or ~50 iterations, compact the plan record:
summarize old iterations into a consolidated table, keep only the current
handoff and active errors, archive past decisions into their task records,
refresh `last-synced` everywhere, and annotate the compaction at the top.

## Delegation contract

Delegate only when a named trigger applies and the work is settled — never
because the remaining context feels large or the file count looks high:

- **Mapping/exploration** — several disjoint lookups the parent should not
  serialise (roughly five or more independent traces).
- **Parallel disjoint units** — settled tasks with non-overlapping scopes
  and no shared intermediate state.
- **Independent verification** — a reviewer for a named-risk unit, whose
  context must differ from the author's.
- **Context backstop** — the parent approaches a hard context budget and
  remaining work is mechanical.

Every delegation states: the exact task/locator references (never
paraphrased requirements), the allowed edit surfaces (paths the delegate
may write — anything else is out of bounds), the return contract, and the
rework bound before escalation.

The delegate returns: completed work, actual evidence produced, deviations
from the assigned surfaces, and open questions — not a narrative summary.

The parent verifies the delegated result against the *original request and
task contract*, not against the delegate's self-report. Verification of a
request is not a review of the worker.

A role, agent name or fresh context label is not authentication and does
not widen authority; delegated work keeps the parent's authorized scope.

## Common rationalizations

| Rationalization | Reality |
|---|---|
| "I can hold plan state in context" | Context dies on compaction and handoff; the records are the only thing that persists. |
| "Two tasks in one turn saves time" | Batching blurs the audit trail and breaks resumability — one action per turn is what survives an interruption. |
| "Same retry, one more time" | Identical inputs produce identical failures. Change the strategy or ask — do not grind a loop. |
| "Delete the failed record, it is dead weight" | The failure is evidence: what was tried, which rungs were spent, where it stopped. Container it, never delete it. |
| "A scheduler that picked the task proves execution" | Scheduling is not executing. Completion needs recorded verification, not a selected row. |

## Red flags

- Two tasks executed in one turn ("one action per turn" is the rule).
- Progress reported without an updated plan record and handoff.
- A task marked complete on a self-reported or unrecorded check.
- A failed task deleted, or silently re-planned instead of containered.
- Retry loops that rerun identical actions without a strategy change.
- Parallel units sharing write surfaces or unsettled inputs.
- Choosing the next task from a stale summary instead of current records.

## Verification

- [ ] Plan and task records are current; `last-synced` refreshed after
      every action
- [ ] Every task selected was dependency-ready per current records, not a
      remembered order
- [ ] A continuation block was written after every action, with invariants,
      verification commands and pending debt
- [ ] Every completed task carries a recorded verification run
- [ ] Parallel-eligible tasks have disjoint write scopes and settled inputs
- [ ] Failures followed the recovery ladder; failed records were
      containered, not deleted
- [ ] Delegations carried exact locators, allowed write surfaces, a return
      contract and a rework bound
