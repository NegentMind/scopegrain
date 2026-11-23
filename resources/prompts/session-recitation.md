---
name: session-recitation
description: Canonical continuation/handoff block — readable render, runtime field mapping and the parseable RESULT block.
---
# Session Recitation

Single canonical format for the continuation record that lets the NEXT
context resume without asking the previous one. Pipeline prompts reference
this file; they never redefine it. Loaded after every action, invocation
end and task close — the RESULT block below is the parseable return
contract every delegate must emit. Two renders of the same content: a
human-readable block persisted in plan/task records, and the field mapping
for the harness task runtime's state-update operation.

## Readable render (plan record / task record)

```
=== CONTINUATION ===
Active goal: TASK-N — <id>
State: PLAN | ACT | VERIFY | COLLATERAL | RESEARCH | EVALUATE | REVIEW | ACCEPT | CLOSE | STALL | ABANDON
Last action: what was just done
Result: pass | fail
Previous state: <state it came from>
Next action: concrete step (file + command)
Contract: exact verification command + result
Invariants: what must NOT be broken when continuing (or "none")
Verification commands: exact command + expected/obtained result
Debt: what remains incomplete at this iteration's close (or "none")
Next task if this completes: TASK-N+1 — <id>
Last-synced: YYYY-MM-DDTHH:MM
=== END CONTINUATION ===
```

## Runtime field mapping

| Runtime field | ← readable-block source |
|---|---|
| `activeGoal` | Active goal |
| `lastAction` | Last action (≈ summary, max ~200 tokens) |
| `result` | `OK` ↔ completed · `PARTIAL` ↔ in progress with pending steps · `FAILED` ↔ failed |
| `nextAction` | Next action (file + command) |
| `contract` | Contract + verification + per-claim evidence (`claim / evidence / confidence`) + persisted artifact paths + invariants + debt + pending-for-orchestrator |
| `nextTask` | Next task if this completes |

Large outputs are persisted as artifact paths, not inlined in the message.

## RESULT block (orchestrator-parseable)

The per-invocation return contract (mandatory at the end of every delegate
or iteration):

```
RESULT: COMPLETE | INCOMPLETE | FAILED | MALFORMED
STEPS_OK: <n>/<M> total steps
NEXT_STEP: <next pending step, or "none">
COMMIT_HASH: <hash or "none">
FILES: <paths touched>
CONTRACT_VERIFY: pass | not-run | fail
BLOCKER: none | <what prevented finishing>
GATES_EVALUATED: P:<no|fired> D:<no|fired> V:<no|fired> C:<no|fired> | <reason ≤6 words per gate>
SKILLS_LOADED: <loaded skills, or "base-only, no additional candidates">
```

`MALFORMED` = block absent, or a `GATES_EVALUATED` line missing / without a
reason per gate. Mapping to the runtime `result` field: COMPLETE↔OK,
INCOMPLETE↔PARTIAL, FAILED↔FAILED, MALFORMED↔no valid status.

When closing a task (`result: OK`), the runtime's acceptance gate requires
the `review` payload alongside: `fresh` — reviewer context ≠ author context
+ verdict `approve`; or `degraded` + owner waiver `{owner, reference,
reason}` recorded in decisions/trace. Without it the completion write is
rejected; the payload itself is validated, not persisted into the plan
block — only the recorded waiver reference remains in trace/decisions.
