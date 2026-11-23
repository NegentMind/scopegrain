---
name: writing-plans
description: Use after settling substantial requirements and design to write a scoped executable plan.
---
# Writing Plans

Write the implementation plan assuming the executor has zero project
context: exact files, exact interfaces, exact commands with expected
output, and the tests and docs to consult. Assume a skilled engineer who
knows nothing about this codebase's conventions or test design. Document
everything needed to execute without guessing. DRY. YAGNI. Small, atomic
commits.

State verified existing behavior, missing behavior and the approved design.
Do not create another plan for implemented work or a formal document chain
for a light task that only needs its bounded record.

## When to use

- A specification or approved design is settled and substantial work needs
  an executable plan.
- The executor will not share your session context — the plan must carry
  everything.
- Work must pause and resume across sessions without re-explaining.

Do not use it for a genuinely light task (its bounded record suffices, per
`organic-driven-development`), and do not use it to decide what the units
are — that is `planning-and-task-breakdown`. This skill owns **how each
unit is specified for execution**; `plan-design-review` gates the result,
and `organic-driven-development` decides whether a plan is proportionate
at all.

## Granularity: one action per step

Each step is a single action, completable in minutes:

- "Write the failing check" — step
- "Run it; confirm it fails for the stated reason" — step
- "Implement the minimum that makes it pass" — step
- "Run it; confirm it passes" — step
- "Commit the unit" — step

## Plan record header

Every plan record starts with:

```markdown
# [Feature name] Implementation Plan

**Goal:** [one sentence describing what this builds]
**Approach:** [2-3 sentences — architecture and why]
**Stack and conventions:** [key technologies + the project's actual
build/test/lint commands]
**Executor note:** implement task-by-task per the coordination skill;
each unit ends in a verification and a commit boundary.
```

## Task unit structure

For each formal task specify inputs, actual files, exact interface, assigned
scenarios, acceptance checks, dependencies, write scope and authority.

```markdown
### Task [key]: [unit name]

**scenarioRefs:** [S1, S3]
**Files:**
- Create: `exact/path/to/file`
- Modify: `exact/path/to/existing` — which symbol/section
- Test: `tests/exact/path`

**Step 1: write the failing check**

<concrete check code or exact command, not "add a test">

**Step 2: run to confirm it fails**

Run: `<exact command>` in `<directory>`
Expected: FAIL with <named reason>

**Step 3: minimal implementation**

<the actual interface/signature and approach — not "add validation">

**Step 4: run to confirm it passes**

Run: `<exact command>`
Expected: PASS

**Step 5: commit**

`<exact commit boundary>` — atomic, conventional message
```

## Rules

- Exact paths always; complete interfaces and signatures, never "add
  validation" or "handle errors".
- Exact commands with expected output, marked as proposed until authorized
  and executed. Name the working directory.
- State commands and working directories as proposed until actually
  authorized and executed. Name unresolved decisions as blockers, not
  guessed parameters.
- Keep coherent behavior with its tests and docs; file or line counts alone
  do not decide task risk or force artificial splits.
- One commit boundary per task unit; a unit must be individually revertible.
- Reference the spec scenario each unit closes.

## Store and hand off

Store the plan in configured harness paths (`.scopegrain/plans` by default)
and dry-run before apply. Do not delegate an unsettled choice or claim that
persistence is approval.

After the plan is approved, present the execution options and wait for the
choice — never auto-start:

1. **This session, step-by-step** — execute units in order with verification
   and review between each, per `contract-execution`.
2. **Coordinated run** — schedule dependency-ready units (parallel only
   where write scopes are disjoint), per `plan-coordination`; the
   `plan-execution` prompt operationalizes that run.

## Common rationalizations

| Rationalization | Reality |
|---|---|
| "The executor will figure it out" | The plan exists because the executor has zero context. Ambiguity delegated to a plan becomes an improvised decision in a diff. |
| "Details belong in the code" | An unsettled choice written around is a decision made silently. Name it as a blocker, not a parameter. |
| "One bigger step saves ceremony" | Batched steps break verify-per-step and per-unit revertibility — the two properties that make a plan resumable. |
| "Exact paths slow me down" | A path the plan never verified is a finding waiting for the executor. Check it now or mark it unverified. |

## Red flags

- Steps that bundle several actions ("write tests and implement").
- Commands without expected output, or paths the plan never verified exist.
- Acceptance criteria that restate the task title.
- A plan that leaves an open decision to the executor's judgment.
- Treating a persisted plan file as authorization to implement.

## Verification

Before hand-off, confirm:

- [ ] Every step is a single action with a proposed command, working
      directory and expected output
- [ ] Every path and interface named in the plan was verified to exist
- [ ] Each unit closes named scenarioRefs and ends in a commit boundary
- [ ] No open decision is delegated to the executor — blockers are named
- [ ] The plan is stored under the configured plans path and was dry-run
- [ ] The owner approved the plan and chose an execution mode — no
      auto-start
