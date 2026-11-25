# External Runner Contract

The legacy `opencode-loop` plugin embedded the plan driver: it re-injected
the iteration prompt per task until the campaign finished. Scopegrain has
no embedded loop — execution continuity is a **host concern**. This
document is the canonical protocol an external scheduler must honor to
run a plan resumably without any loop inside the harness.

Any scheduler that satisfies this contract works: a Devin scheduled
session, a cron job, a CI trigger, a chat turn — the mechanism is the
host's choice. The contract is deliberately scheduler-agnostic.

## The runner loop

One iteration = one turn of the host scheduler. Repeat until a terminal
condition (§Terminal states).

```
plan next KEY                → ready members (triage-aware)
      ↓ pick one ready task
claim                        → atomic task transition PLAN→ACT (CAS on
                               --revision); a claimed task cannot be
                               double-started by a second runner
      ↓
brief                        → assemble the member packet per
                               prompts/plan-execution.md Part B
                               (the ten mandatory blocks)
      ↓ execute the task
RESULT block                 → verification/review evidence and the
                               outcome, recorded through task
                               transition --evidence
      ↓
plan run KEY --apply         → checkpoint appended at
                               <state>/plan-runs/<KEY>.json
      ↓ repeat
```

`plan next` is triage-aware: members triaged `defer|skip|blocked`
report `triaged`, not `ready` — a runner never dispatches them.

## Checkpoints and resume

`plan run KEY` (dry-run) and `planRunState` expose the same resume view:
closed members, remaining members, next wave, completion percent, and
`completedSinceLastCheckpoint` against the latest persisted checkpoint.
`plan run KEY --apply` persists a bounded checkpoint record
(`schemaVersion:1`, last `MAX_PLAN_RUN_CHECKPOINTS` entries) under a
verified lock — that file IS the resumable state. A fresh scheduler
reads it instead of reconstructing progress.

## Terminal states

Stop the loop when any holds:

- `resume.complete` — no ready, remaining or unscheduled members.
- `plan status KEY` derives a terminal/complete status; `plan conclude
  KEY` records the terminal close-out.
- The kill switch: `hooks halt` — a runner must check halt state each
  iteration and stop regardless of remaining work.
- Stall: consecutive failed iterations on the same member reach the
  stall threshold → the runner stops and asks the owner (Gate V per
  `prompts/decision-request`), never loops a stuck member silently.

## Failure policy

`FAIL_MODE` (stop | skip | parallel) is declared per run, not by the
harness. `stop`: halt on first failure. `skip`: record the failure and
continue to independent members. `parallel`: wave execution of mutually
independent members (`waves[].parallel` in the run record). A member
failure is recorded as evidence on the task, never as silent retry.

## Enforcement caveat (explicit, not a bug)

Gates are **advisory**: `actionHooks.applied`/`require-gate` and the
budget defaults only engage when the host invokes `check_action` before
acting. A scheduler that never calls `check_action` faces no mechanical
resistance — the contract's honest guarantee is auditability of what
was recorded, not blocking of what was attempted. Runners SHOULD call
`check_action` for every mutating step and honor `hooks halt`.

## Honesty boundaries

- The harness never executes project commands
  (`executesProjectCommands:false`): runners propose verify commands;
  the owner or host executes them and the outcome lands as recorded
  evidence (`verification.checks[]`), declared unauthenticated
  (`authenticatesEvidence:false`).
- Claims are CAS writes under the verified lock — two schedulers on
  the same plan collide explicitly, never silently.
- `budget` fields (record `budget`, `budgetDefaults`) count recorded
  operations only; a runner cannot budget native tool calls it does
  not see.

## Suggested scheduler mapping

| Host mechanism | Loop driver |
|---|---|
| Chat session | Each user/agent turn = one iteration; read checkpoint first |
| Scheduled session / reminder | Cron tick reads `plan run`, dispatches one iteration |
| CI trigger | Job runs one iteration or drains until terminal |

The host owns scheduling, fan-out and model routing; the harness owns
records, CAS claims, checkpoints and gate evaluation.
