---
name: contract-execution
description: Use when executing a scoped engineering task through the recorded lifecycle, with acceptance criteria, verification evidence, review and a resumable handoff.
---

# Contract execution

Execute a task against its recorded contract: a verifiable condition checked
by real commands, never by self-report. The contract is law — if it does not
pass with recorded evidence, the task is not complete.

1. Read the approved configuration, relevant project rules and task contract.
2. Confirm the behavior does not already exist and identify affected modules.
3. Record scope, exclusions, acceptance criteria, risks and recovery strategy.
4. Use PLAN for investigation and ACT for authorized implementation.
5. Use VERIFY to propose exact commands. Wait for authorization and record
   actual output references; a proposed command is not a passing check.
6. Diagnose failures without hiding them. Use COLLATERAL or RESEARCH when
   needed, and STALL when blocked on a decision.
7. Use EVALUATE for self-assessment and REVIEW for a separate reviewer.
8. Accept only current verification and an independent approval or an
   explicit owner waiver with owner, reference and reason.
9. If implementation changes, invalidate old evidence and obtain a new review.
10. On completion or failure record the outcome:
    `memory add --log outcomes --input {taskId, outcome: ok|fail, skills:[...]}`.
    Durable learnings belong in `memory add --log lessons`; the advance
    archive (`progress`) is written automatically when the task reaches CLOSE.
11. Save changed files, results, evidence, unresolved risks and next action.
    Stop at the agreed boundary. Never push or publish implicitly.

Workflow modes (PLAN, ACT, VERIFY, COLLATERAL, RESEARCH, EVALUATE, REVIEW,
ACCEPT, STALL) are defined in `policy/workflow.json`.

Scopegrain state checks do not intercept all native host tools. Do not
describe the workflow as a sandbox or claim authenticated reviewer identity.

## When to use

- Executing **one** scoped, recorded task end to end — light route or
  SDD, in this session or as a delegate of a coordinated run.

Do not use it to decide whether the task deserves a contract (that is
`organic-driven-development`'s classification), to author the plan
(`planning-and-task-breakdown`, `writing-plans`), or to schedule several
tasks (`plan-coordination`). This skill owns the **per-task lifecycle**:
discovery, state transitions, verification discipline and closure. The
`plan-execution` prompt (Part B) operationalizes it; `task-brief` holds
the canonical record template.

## Phases

### Phase 1 — Discovery (once per task, read-only)

Before the first edit:

- **Auto-classify** the task type from the affected paths (core logic,
  interface/binding, docs, mixed) and load the matching skills and checks.
  Emit the `DECLARED CAPABILITIES` block from `select-capabilities`
  before the first edit — a selection not declared is a selection not
  made, and it lets the owner correct a wrong route before it costs work.
- **Confirm the gap is real:** referenced files and symbols exist; the
  described behavior is not already implemented; docs match the code.
- **Map the blast radius:** callers, callees, implications — does anything
  break, does public behavior change, are migrations or re-indexing needed,
  are existing tests affected? Record risk low/medium/high.
- **Detect feature-add:** if the plan adds new public symbols, contracts,
  endpoints or user-visible capabilities, the task needs a valid spec
  section per `spec-brief` / `decision-request` §valid-spec (decision
  table or per-item evidence). A type label like "wrapper" does not exempt
  a public contract addition.
- **Research if ambiguous:** external API/pattern questions get checked
  against official sources when network is permitted, recorded as
  claim/evidence/confidence in the task notes.
- **Decompose into atomic steps:** one action per step, small enough to be
  individually revertible, each with a mechanical verify.
- **Impact gate:** every file to be modified or deleted is read completely
  and its inbound/outbound references mapped **before** the first editing
  step is written. No populated impact map → no edit steps.

### Phase 2 — Execution (one step per iteration)

Valid state transitions:

```
PLAN → ACT → VERIFY → PLAN        (verify failed → retry)
                ↘ → STALL        (2 same-error failures → owner gate)
                ↘ → COLLATERAL   (passed → handle side errors)
COLLATERAL → RESEARCH            (ambiguity → investigate)
RESEARCH → ACT                   (investigated → implement)
COLLATERAL → EVALUATE            (no errors → self-assess)
EVALUATE → REVIEW                (self-assessment passes → review)
EVALUATE → ACT                   (fails → re-implement)
REVIEW → VERIFY                  (issues found → re-verify)
REVIEW → ACCEPT → CLOSE          (review passes → accept → close)
STALL → ❌ FAILED                (budget/retries exhausted)
```

Retry ladder per step: 1 retry → fresh context → different strategy →
escalate. **Stagnation rule:** 2 verify failures with the same error
(file+line+message) triggers the owner gate (`decision-request` Gate V);
no answer → stop, do not keep circling.

**Collateral errors:** a bug found while working on something else —
quick (<~30 min) fix gets handled and recorded; slow gets routed into a
backlog record **at discovery time** per `finding-record`. Never ignored,
never silently fixed outside scope, and the current task's scope does not
silently grow.

**One step, one action:** each step is a single action on a bounded file
set, individually revertible. Do not batch steps into one turn.

### Phase 3 — Close (full verification)

1. All steps complete.
2. Full contract verification: build, test, format, lint and any
   task-specific checks — recorded, not summarized.
3. Self-review pivot: re-read the complete diff.
4. Evaluate on three axes: correctness, simplicity, consistency with
   project conventions.
5. Self-gate: propose the change → evaluate against the contract and
   invariants → accept or reject.
6. REVIEW by a different context — the review gate fields are defined in
   `task-brief` (different-context reviewer, anti-habit checklist,
   recorded verdict or owner waiver per `decision-request` Gate C).
7. Record outcome, write the save point, close.

## Task record — required fields

The canonical record template lives in the `task-brief` prompt; do not
redefine it. The lifecycle requires the record to carry, at minimum:

- **Metadata** — plan reference, source, type, effort/priority, state,
  revision, `last-synced`, and the uphill/downhill counters below.
- **Blast radius** — callers, callees, implications; recorded before edits.
- **Impact map** — every file to modify read completely, inbound
  references mapped, impact verdict. Populated **before** the first edit
  step; without it no edit step runs.
- **Contract** — the verifiable condition per `outcome-driven-development`.
- **Spec** — for feature-add tasks, a valid decision table or per-item
  evidence justification per `spec-brief` / `decision-request`
  §valid-spec; `N/A` is invalid and blocks ACT.
- **Domain invariants** — what must not break, verification commands,
  pending debt; they feed the continuation block (`session-recitation`).
- **Debugging evidence** — bug tasks only: repro, hypothesis, one
  controlled variable, a RED check verified failing before the fix. No
  root-cause investigation, no fix.
- **Domain assessment** — security and performance evaluated before
  coding (justify N/A), per the template's mandatory domain phases.
- **Steps** — one action each, files, an exact verify command, status.
- **Review** — a different context than the implementer, the anti-habit
  checklist, and a recorded verdict or owner waiver `{owner, reference,
  reason}` per `decision-request` Gate C.
- **Context save point** — date, branch, pending CI, decisions, known
  problems, next task.

## Uncertainty reporting: uphill vs downhill

Report progress on two axes plus percent, every status update:

| Axis | Counts |
|------|--------|
| ⬆ uphill | open unknowns — undecided approach, unverified dependency, open decision |
| ⬇ downhill | remaining execution steps — known work |
| % | steps done |

An unknown resolved moves to Notes with its answer. **A task with open
unknowns is never marked complete, even at 100%.** Moving to IN PROGRESS
without a known approach is uphill until the contract is defined.

## Refactor discipline — two hats

A structural change does not change behavior; a behavioral change does not
ride inside a refactor. Behavior and structure go in separate commits with
green checks between them. If a "refactor" needs tests edited to pass, it
changed behavior — split it.

## Definition of Done — multi-level gate

| Level | Gate |
|-------|------|
| Task | verifiable contract met + deterministic checks (format, lint, tests) + change's own checks pass |
| Commit | atomic, conventional message, clean diff, mechanical verification (never self-report) |
| Release | full verification, changelog, compatibility respected, release gate per project policy |

The task closes only when all applicable levels pass; justify inapplicable
levels in Notes.

## Common rationalizations

| Rationalization | Reality |
|---|---|
| "I checked it, trust the summary" | Self-report is not evidence. The runner says pass; the agent's prose does not. |
| "The record is ceremony" | The record is what survives a restart — the bounded record is what makes the light route legitimate. |
| "Scope grew a little, keep going" | Unrecorded growth is unauthorized scope. Record the finding and re-confirm, or stop. |
| "Same error, one more try" | Two verify failures with the same error is the owner gate — ask, or stop. |
| "I reviewed it myself, it is fine" | Same-context review shares the author's blind spots; a recorded different-context verdict or owner waiver is required to close. |

## Red flags

- An edit step written before the impact map is populated.
- A green check claimed from a proposed-but-unexecuted command.
- Steps batched into one turn, or a step that is not individually
  revertible.
- Old evidence cited after the implementation changed.
- A feature-add record entering ACT with `N/A` in the spec section.
- Collateral findings kept in notes instead of a finding record.
- A task closed at 100% steps with open unknowns still uphill.
- Accepting the implementer's own review as the independent verdict.

## Verification

- [ ] Discovery was read-only and the gap confirmed real before any edit
- [ ] Impact map populated before the first edit step
- [ ] Every step ran its verify with recorded output
- [ ] Contract passed by recorded command output, not self-report
- [ ] Open unknowns reached zero; collateral findings recorded
- [ ] Review by a different context (or explicit scoped owner waiver)
      recorded in the task record
- [ ] Save point written; outcome recorded to memory
- [ ] Closed at the agreed boundary — no implicit next task, push or publish
