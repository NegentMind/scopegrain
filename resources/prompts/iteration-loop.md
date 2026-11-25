---
name: iteration-loop
description: Run exactly one iteration of the task lifecycle — state machine, per-state actions and a hard stop for step-by-step debugging.
---
# Iteration Loop

Advanced/debugging mode: process EXACTLY ONE lifecycle iteration per
invocation — not a whole task. For normal flow use the single-task or
plan-run commands (`plan-execution`). This prompt exists to debug a pipeline
one step at a time. At the end: continuation record + STOP.

State reads, transitions, verification records and budget counters go
through the harness task runtime when bound; otherwise through the records
under `.scopegrain/`. Under manual verification, propose exact commands and
record the owner's actual output — never self-report a check.

## Step 0 — Load capabilities

1. Read the next/active task through the runtime.
2. Run the skill-discovery pass (`select-capabilities`): task key files +
   lifecycle phase (`BUILD`, or `DEFINE` when spec-first) + contract
   keywords. Load each returned skill; record `SKILLS_LOADED` in the task
   record and the iteration's RESULT block.
3. Bug → `systematic-debugging`. New/complex logic →
   `test-driven-development`. Security-sensitive →
   `doubt-driven-development`.
4. Read the workflow profile for the task's declared `type` in
   `references/workflow-profiles`, if one exists — workflow profiles are
   guidance for which phases to apply and in what order; enforcement
   always uses the generic state machine in `policy/workflow.json`.
   Do not confuse the two sets of states.

## Step 1 — Read current state

Read the active task + its continuation record. A legible continuation
states the exact position; no continuation or new task → state is pending.

## Step 2 — Route by state

| Task record state | Action |
|---|---|
| No record / pending | DISCOVERY mode — investigate, write the record, start the first step |
| Record exists with pending steps | EXECUTION mode — next step through the state machine |
| Record exists, all steps done | CLOSURE mode — full verify, review, commit, handoff |
| Failed | Document, record, stop |

## State machine (policy/workflow.json — no skipping states)

```
PLAN      → ACT | RESEARCH | STALL | ABANDON
ACT       → VERIFY | STALL | ABANDON
VERIFY    → COLLATERAL | EVALUATE | ACT | STALL | ABANDON
COLLATERAL→ RESEARCH | ACT | EVALUATE | STALL | ABANDON
RESEARCH  → PLAN | ACT | STALL | ABANDON
EVALUATE  → REVIEW | ACT | STALL | ABANDON
REVIEW    → ACCEPT | ACT | STALL | ABANDON
ACCEPT    → CLOSE | ACT | STALL | ABANDON
STALL     → PLAN | ABANDON
CLOSE/ABANDON → terminal

Invalid examples: PLAN→EVALUATE (not implemented), ACT→ACCEPT (not
verified), ACT→CLOSE (not reviewed), ACT→REVIEW (not evaluated).
```

### Per-state allowed actions

Before each action, check it is permitted in the current state per
`policy/workflow.json` (PLAN: read/research/propose · ACT: read/edit/propose
· VERIFY: read/verify/propose · COLLATERAL/RESEARCH: read/research/propose ·
EVALUATE: read/evaluate · REVIEW: read/review ·
ACCEPT/CLOSE/STALL/ABANDON: read).
A denied action means the state is wrong — transition first via a recorded
state update; do not perform it anyway.

### PLAN

- Read the next step of the task record.
- Consult the memory logs (`lessons`, decisions records) for prior context;
  append entries in the declared format, never editing history by hand.
- Decide the atomic change (~100 lines max).
- Reuse ladder: existing implementation > standard library > existing
  dependency > minimal new code.

### ACT

- **Scope check (mandatory):** before any edit, validate each touched file
  is inside the declared blast radius of the task record. Outside → do not
  edit; report the violation.
- **Output check (mandatory):** before any edit/write/command that GENERATES
  content (shell commands, queries, generated code, file paths), validate
  the output against the declared safety policy. Failed → fix the output
  first.
- Prefer surgical edits (old/new string) over full-file rewrites.
- Risky/destructive commands (rm, format, generated scripts) run through
  the declared isolation mechanism if one exists — containment, not a
  security guarantee. Destructive effects need owner authorization.

### VERIFY

- A real mechanical check — never self-report. The declared command for the
  stack (build, typecheck, lint, test).
- Record the result through the runtime, or propose the command to the
  owner and record the returned output under manual verification.

**Diagnostic pass on verify failure:** do not hand the raw error back to the
implementer. Process the compiler/test/lint error, identify root cause
(file, line, message), and synthesize a precise technical instruction:
"the compiler failed at line 45: lifetime error — restructure the function
to avoid returning a local reference." Only then retry.

### Retry ladder + Gate V

Single same-error threshold = **2**. Each retry escalates one strategy tier
per the harness's declared capability; do not retry with the same approach
more than once.

| Failure | Action |
|---|---|
| 1st | fix with processed diagnostic feedback + tier up |
| 2nd, same error (file+line+message) | **Gate V** (`decision-request`): ask the owner — fresh retry / change strategy / FAILED |

Never mark FAILED unilaterally at threshold: no owner answer → STOP.

### Stagnation detection

One threshold system-wide: **2 verify failures with the same error →
Gate V**; no answer → STOP. Query stalled tasks through the runtime as a
supporting probe. 2 consecutive stalls → FAILED (no-progress limit).

### Fork/join

Independent work parallelizes via fresh delegated contexts — only through
an actually available authorized capability. Closure checks that do not
depend on each other (e.g. format/unused-deps vs post-build tests) can run
as parallel groups; join all before advancing. Respect the declared
concurrency cap (default max 3 simultaneous). An INCOMPLETE/empty/stopped
fork delegate → `recovery-brief` (RESUME same session → RETRY → STRATEGY →
ESCALATE).

## DISCOVERY mode

1. Detect task type from its key files (implementation / bindings / docs /
   research / mixed) → type, skills, checks, effort estimate.
2. Run the skill-discovery pass if not done in Step 0 — do not repeat it;
   verify `SKILLS_LOADED` is recorded.
3. Structural investigation: blast radius (callers/callees), transitive
   impact, architecture context, coverage — via the available structural
   capability before grep/read.
4. Zero-code planning: ≤3 pseudocode bullets (files, functions, signature,
   tests) before touching anything; ambiguity → research.
5. Gate D (`decision-request`) on the declared triggers BEFORE writing the
   record.
6. Record in the task record: callers/callees/implications/risk, verifiable
   contract, needed tools, planned solution, atomic steps.
7. Write the task record under the configured tasks path; sync last-updated
   on plan + task.
8. Run the first step (~100 lines); verify it.

## EXECUTION mode — step flow

1. Resume from the continuation record.
2. PLAN → ACT → VERIFY per the state machine; run the per-state checks
   above on every transition.
3. Verify failure → retry ladder with Gate V at threshold.
4. Collateral errors: quick (small, same file) → fix inline; slow → finding
   record per `finding-record`.
5. Evaluator-optimizer: correctness, simplicity, consistency.
6. Self-harness gate: propose → evaluate → accept.
7. Pre-commit gate: per-level DoD + checklists by type.
8. Recorded verify of the contract.
9. Budgets: declared limits (`policy/operation-limits.json` / runtime
   counters); 2 consecutive stalls → FAILED.

## CLOSURE mode

Full sequence in `plan-execution` Part B §Closure — one iteration covers
ONE of its steps: full verify (parallel groups where independent) →
cognitive pivot → deterministic checks → evaluator-optimizer (3 axes,
max 2 iterations) → collateral routing → self-harness gate (propose /
5-boolean evaluate / accept; 2 rejections → escalate) → risk-tiered
different-context review → mechanized ACCEPT review payload → pre-commit
checklist → selective commit (only touched paths, declared convention,
LOCAL only — push needs explicit owner authorization) → `session-handoff` →
context save point (date, branch, pending CI, decisions, known issues, next
task) → self-improvement note.

## FAILED mode

Record why it failed and what was tried (the ladder rungs), mark failed
through the runtime, record progress, STOP. Do not continue.

## Step 3 — Verify

Recorded verification only — the compiler/test runner/linter decides. On
failure → retry ladder. On pass → continue.

## Step 4 — Update state

After the action, ALWAYS record the transition + continuation through the
runtime: in-progress when starting a step (continuation pointing at the
next), completed when verified + committed, failed when the ladder is
exhausted. Sync the task record (done/failed step, last-updated). Never edit
the plan record around the runtime — use its operations.

## Step 5 — Continuation (handoff between iterations)

After each action write the structured continuation per
`session-recitation`: active goal, last action, result, next action (file +
command), contract, next task. Without it the next iteration starts lost.

## Step 6 — STOP

Do not proceed to the next task or iteration.

## Appendix — contracts

The vague-vs-verifiable contract table is canonical in `task-brief`
(appendix); write step contracts against it, never a vague condition.

## Rules

- Read the next task through the runtime or the plan record directly.
- Structural capability for source questions before grep/read; unindexed
  prose via bounded reads or read-only delegates.
- Context budget: keep initial usage low; delegate heavy reads rather than
  absorbing them.
- Prefer surgical edits; do not load capabilities unused by this task.
- No defensive prose — express problems by changing code.
- No scope creep: record extra findings per `finding-record`, do not
  implement them.
- The contract is law; verification is mechanical; ~100 lines per step;
  one step per turn; each step reversible.
- 2 same-error verify failures → Gate V; no answer → STOP.
- The continuation record IS the handoff — be specific.
- After updating state, STOP — never advance to the next task or iteration.
