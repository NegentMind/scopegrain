---
name: incremental-implementation
description: Use for changes that can be delivered as small vertical slices without broad unrelated churn
---
# Incremental Implementation

## Core discipline

Choose the smallest end-to-end behavior that advances the approved goal.
Identify its interface, storage and verification boundary.
Reproduce the gap, implement one coherent slice and inspect the diff.
Run the narrow authorized checks, recording limitations and collateral risk.
Do not refactor unrelated modules or re-run unchanged long jobs by default.
Carry settled results into the next slice instead of recomputing them.

Build in thin vertical slices — implement one piece, verify it, then expand.
Never implement an entire feature in one pass. Each increment leaves the
system in a working, checkable state. This is the execution discipline that
makes large work reviewable and revertible.

## When to use

- Any multi-file change or feature built from a task breakdown.
- Refactoring or migrating existing code.
- Any time more than ~100 lines would be written before verification.

**Not for:** single-file, single-function changes whose scope is already
minimal.

## The increment cycle

```
Implement ──→ Verify ──→ Commit ──┐
   ▲                            │
   └──────── Next slice ◄───────┘
```

For each slice:

1. **Implement** the smallest complete piece of the approved unit.
2. **Verify** — run the checks the task and repository authorize (test,
   build, type-check, lint — the project's declared verification commands).
3. **Inspect the diff** — confirm it contains only this slice.
4. **Commit** — one atomic, reviewable unit per `work-unit-commits`, when
   commits are authorized.
5. **Carry forward** — reuse verified results; do not restart or recompute
   what a previous slice already settled.

## Slicing strategies

### Vertical slices (default)

Cut one complete path through every layer the behavior touches:

```
Slice 1: Create a record (storage + boundary + one consumer)
Slice 2: List records (query + boundary + consumer)
Slice 3: Update a record
Slice 4: Delete a record (with its authorization and confirmation path)
```

Each slice delivers working end-to-end behavior, not a horizontal layer.

### Contract-first slicing

When two sides of an interface evolve in parallel:

```
Slice 0:  Fix the contract (types, schema, spec) — reviewed alone
Slice 1a: Implement side A against the contract + contract tests
Slice 1b: Implement side B against a fixture matching the contract
Slice 2:  Integrate and verify end-to-end
```

### Risk-first slicing

Take the riskiest or least certain piece first:

```
Slice 1: Prove the uncertain mechanism works (spike-grade, verified)
Slice 2: Build the real behavior on the proven mechanism
Slice 3: Add the edge cases and failure modes
```

If slice 1 fails, the loss is discovered before slices 2 and 3 are invested.

## Implementation rules

### Simplicity first

Before writing code, ask: "What is the simplest thing that could work?"
After writing it, check:

- Can this be done in fewer lines?
- Is each abstraction earning its complexity?
- Am I building for the current task or for hypothetical requirements?

```
SIMPLICITY CHECK:
✗ Generic event bus with middleware for one notification → ✓ a function call
✗ Abstract factory for two similar components           → ✓ two components + shared helper
✗ Config-driven form builder for three forms            → ✓ three form components
```

Three similar lines beat a premature abstraction. Implement the naive,
obviously-correct version first; optimize only after correctness is proven.

### Scope discipline

Touch only what the task requires. Do NOT:

- "Clean up" code adjacent to the change.
- Reformat or modernize files only being read.
- Remove comments whose purpose is not understood.
- Add features not in scope because they "seem useful".

Noticed-but-out-of-scope issues are recorded, not fixed:

```
NOTICED BUT NOT TOUCHING:
- <path>: unused import (unrelated to this task)
- <path>: error message could be clearer (separate task)
→ Recorded for the owner; not fixed here.
```

### One logical thing per increment

Do not mix a new component, a refactor, and a config change in one slice.
Separate concerns into separate commits — see `work-unit-commits`.

### Keep it green

After each increment the project must build and existing checks must pass.
Never leave the tree broken between slices.

### Feature flags for incomplete work

If increments must land before a feature is user-visible, gate them:

```
if (flags.isEnabled('new-behavior', context)) { /* new path */ }
```

Flags let small increments merge without exposing unfinished work. Default
new behavior to the safe, conservative option (opt-in, disabled, or
fallback-preserving).

### Rollback-friendly

Each increment is independently revertible:

- Prefer additive changes (new files, new functions) — trivially reverted.
- Keep modifications to existing code minimal and focused.
- Stored-data migrations ship with a tested reverse path — see
  `deprecation-and-migration` (expand/contract).
- Do not delete and replace in the same commit; separate them.

## Directing a delegate

When handing a slice to a sub-agent or teammate, state scope explicitly —
what is in and what is NOT:

```
"Implement task 3, database change plus the boundary endpoint only.
Do not touch the consumer yet — next slice.
After implementing, run the project's declared verification commands
and report raw results."
```

## Increment checklist

After each increment, verify with the repository's own commands:

- [ ] The change does one thing and does it completely.
- [ ] Existing tests still pass; build, type-check and lint are clean.
- [ ] The new behavior works as specified.
- [ ] The diff contains only this slice — no unrelated churn.
- [ ] Results are recorded as evidence (command + outcome + limitations).
- [ ] Progress is committed as an atomic unit, when authorized.

**Do not re-run unchanged checks.** After a successful run, repeat a
verification command only after code that could affect it has changed;
re-running on unchanged code adds no information and burns time.

## Output contract

Each slice produces a reviewable record:

- A diff containing only that slice's unit — no unrelated churn.
- Raw check output (command + outcome + limitations) as evidence.
- One atomic commit per `work-unit-commits`, when commits are authorized.
- Noticed-but-out-of-scope issues recorded for the owner, not fixed.

**Scope boundary.** This skill governs the implement–verify–commit cycle
*inside* a change. When the total authored-line forecast exceeds the
reviewable-slice budget, delivery slicing and PR-stacking mechanics belong
to `chained-pr`; the per-slice discipline is unchanged.

## Common rationalizations

| Rationalization | Reality |
|---|---|
| "I'll test it all at the end" | Bugs compound. A bug in slice 1 makes slices 2–5 wrong. Verify each slice. |
| "It's faster to do it all at once" | It feels faster until something breaks and 500 changed lines hide the cause. |
| "These changes are too small to commit separately" | Small commits are free. Large commits hide bugs and make rollbacks painful. |
| "I'll add the feature flag later" | Incomplete work that is user-visible is a defect. Add the flag now. |
| "This refactor is small enough to include" | Refactors mixed with behavior changes make both harder to review and revert. |
| "Let me run the check again just to be sure" | After a green run on unchanged code, a repeat adds nothing. Re-run after edits. |

## Red flags

- More than ~100 lines written without running any check.
- Multiple unrelated concerns in one increment or commit.
- "Let me just quickly add this too" scope expansion.
- Skipping verification to move faster.
- Build or tests broken between increments.
- Large uncommitted changes accumulating.
- Abstractions built before the third use case demands them.
- Files touched outside the task scope "while I'm here".
- New utility files created for a one-time operation.
- The same build/test command run twice in a row with no intervening change.

## Final verification

After all increments of a unit:

- [ ] Each increment was individually verified and committed.
- [ ] The project's full verification set passes (the declared commands,
      scoped or heavy per the task's verification contract).
- [ ] The behavior works end-to-end as specified.
- [ ] No uncommitted changes remain; evidence references commit identity.

## See also

- `work-unit-commits` — what belongs in each commit.
- `chained-pr` — when the total forecast exceeds the reviewable-slice budget.
- `deprecation-and-migration` — expand/contract slices for stored data.
- `systematic-debugging` — when slice verification fails.
- `resources/references/definition-of-done.md` — the standing gate every
  increment clears before a task is declared done.
