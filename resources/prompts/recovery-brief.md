---
name: recovery-brief
description: Resume from preserved evidence without replaying uncertain effects, and recover delegate results through a fixed ladder.
---
# Recovery Brief

Two uses: (a) resume a task/session from preserved evidence; (b) recover a
delegate (sub-agent, worker context, spawned process) that returned an
incomplete, failed, stopped, empty or unexpected result. Loaded by the
orchestrator on any non-DONE delegate result (`coordinate-plan`,
`plan-execution`) and when resuming interrupted work (`plan-recovery`).
Objective in both: **do not lose work already done**. Reuse the same
delegate session when possible; climb the recovery ladder before declaring
failure.

## Required slots

Required slots: project/workspace identity; last valid revisions; approved
contract and resource digests; completed/in-flight/uncertain actions;
receipts/logs; current locks/processes; remaining budget; next safe check.

Distinguish context reconstruction, resource restoration and MCP reconnection.
Validate current state before continuing. Reuse valid work and live processes;
do not restart or recompute merely because the conversation was interrupted.
Never infer that an old lock is abandoned or an external effect did not occur.
Preserve conflicting files and ask before replacement or activation.
Missing evidence means blocked/unknown, not an empty successful state.

## 1 — Classify the delegate result

Every delegate must return the structured RESULT block (canonical in
`session-recitation`; consumed per §4). If absent,
classify by observable evidence (output, commit log, task record, worktree):

| Observable evidence | Class | Meaning |
|---|---|---|
| `RESULT: COMPLETE` + commit + contract verify passes | DONE | Persist state, report, move on |
| `INCOMPLETE` (steps done < total, no commit) | INCOMPLETE | Partial work exists; resume at next pending step |
| Empty output / self-stopped / "I need X" / non-answer | UNEXPECTED | Re-invoke requesting the structured block + feedback |
| `FAILED` (verify fails after its internal retry ladder) | FAILED | Change strategy or escalate |
| `MALFORMED` (no parseable RESULT block, or gates line missing/without reasons) | UNEXPECTED | Same as UNEXPECTED |

**Golden rule:** never treat INCOMPLETE/UNEXPECTED as FAILED. Almost always
it recovers by resuming the SAME session — the worktree and the task record
already hold the work. Real FAILED is only when the delegate itself reports
its retry ladder exhausted.

## 2 — Recovery ladder (once per non-DONE result)

```
Rung 1  RESUME — same delegate session
        Re-invoke the same context with processed feedback: what was done
        (from the context save point / commit log), the next PENDING step
        from the task record, and a reminder to return the RESULT block.
        Never re-execute steps already done — continue from the first
        pending step.

Rung 2  RETRY — fresh context, same role
        New delegate of the same role with a ~200-token digest of what was
        learned + the task record location + processed feedback. Starts
        from durable state (task record + worktree), not from zero.

Rung 3  STRATEGY — materially different approach
        Another solution angle (may escalate model/strategy tier per the
        harness's declared capability). If the task is ambiguous, fork a
        read-only research delegate first (`research-brief`).

Rung 4  ESCALATE — to the owner
        Document all four rungs attempted, commit WIP if changes exist,
        record the task as failed through the harness task runtime, apply
        the declared failure policy (stop/skip), move the record to its
        closed disposition. stop-policy halts the pipeline.
```

## 3 — Protocol rules

1. **INCOMPLETE/UNEXPECTED → 1 RESUME; if still not DONE → RETRY.** It rarely
   reaches ESCALATE.
2. **FAILED → Gate V (`decision-request`) → RETRY(1) → STRATEGY → ESCALATE.**
   Two verify failures with the SAME error (file+line+message) are real
   FAILED; ask the owner before marking it — do not spend a RESUME on that.
3. **Total work preservation:**
   - Durable state lives in the task record (done/pending steps, context save
     point) plus the plan record via the harness task runtime.
   - Before each attempt, check whether the delegate wrote its context save
     point; if not, RESUME it to reconstruct position from the diff/commit
     log and the record.
   - Never `checkout`/`reset --hard` over a delegate's work. Only the task's
     own atomic commits.
4. **Mechanical verify between attempts:** before accepting a RESUME/RETRY as
   DONE, run the task's contract check (recorded verification operation, or
   propose the command to the owner under manual verification). No verify →
   not completed.
5. **Budgets:** every recovery consumes the declared failure/recovery budget.
   Exhausted → ESCALATE without further attempts. **Budget escape (not a
   task failure):** if the runtime reports `budget exceeded` on a verify,
   reset the counter with the reason recorded in the continuation record and
   retry the verify — do not count it as a failed attempt or a stall.
6. **Anti-stall:** 2 consecutive recoveries at the same rung without progress
   → climb a rung. 3 consecutive non-DONE results on the same task → pause
   and ask the owner (no-progress limit).
7. **Recovery trace (mandatory):** record the rung reached and the outcome
   (`DONE|INCOMPLETE|UNEXPECTED|FAILED` + reason) in the session/task record
   through the runtime. Without this entry the protocol's learning loop is
   incomplete.

## 4 — Return contract (what every delegate must return)

The parseable RESULT block is canonical in `session-recitation` — delegates
return it verbatim at the end of every invocation; this section states how
the orchestrator consumes it.

With this block the orchestrator picks the rung in one step, no guessing. A
delegate that stops silently without the block is UNEXPECTED → RESUME asking
for the block + feedback.

**GATES_EVALUATED validation:** the validation rules are canonical in
`decision-request` §mandatory gate-evaluation record. Applied here:
absent/incomplete → classify UNEXPECTED (not DONE) → rung 1 RESUME asking
only for that field. Evaluating the gates is part of the contract, not a
courtesy.

## 5 — Human checkpoint before starting

The ladder in §2 recovers work already done; this checkpoint acts BEFORE
executing a task, so attempts are not spent on directions the owner never
authorized.

**Rule:** every task of critical priority, or with an ambiguous contract (≥2
valid interpretations that change the expected result), requires human
confirmation BEFORE the first execution step.

**Exception — approved execution family:** individual confirmation is not
needed when the task belongs to a family already approved by the owner —
the plan passed its triage gate (`do`) or the owner launched the run, within
this session, for the same goal.

**Limit of the exception:** canonical in `decision-request` §Anti-abuse —
an approved family suppresses individual confirmation ONLY for
fix/test/docs/refactor tasks with no new public surface; feature-add or
new-public-symbol tasks still trigger ONE batched decision round with the
open spec decisions before the first ACT.

**Activation:** (1) pre-flight — picking up a pending critical/ambiguous
task before the first execution call; (2) mid-execution — the delegate
discovers a material ambiguity the contract did not foresee → stop and
escalate.

**Procedure — stop → ask → continue:**
1. STOP — launch no new steps; preserve done work (task record / worktree).
2. ASK via the native question interface (or structured report if none):
   task id, priority/ambiguity, options, request GO / adjust / NO-GO.
3. CONTINUE per the answer: GO → execute, record the confirmation; adjust →
   apply feedback (equivalent to RESUME with processed feedback); NO-GO →
   record failed + failure policy — do not consume the §2 ladder (no real
   execution attempt happened).
