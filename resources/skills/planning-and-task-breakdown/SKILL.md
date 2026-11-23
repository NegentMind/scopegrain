---
name: planning-and-task-breakdown
description: Use when substantial settled work needs dependency-aware tasks and explicit scenario ownership.
---
# Planning and Task Breakdown

Decompose approved, settled work into small, verifiable tasks with explicit
acceptance criteria and scenario ownership. Good decomposition is the
difference between work that completes reliably and work that produces a
tangled, unverifiable mess. Every task must be small enough to implement,
verify and review in a single focused session.

Inspect existing implementation, plans and decisions first. State the actual
gap, scope, acceptance checks, risks and recovery needs.
Use Organic to avoid a multi-task planning pipeline for genuinely light work.

## When to use

- A specification or approved design exists and needs implementable units.
- A task feels too large or vague to start.
- Work must be parallelized across agents or sessions.
- Scope must be communicated to a human for approval.
- The implementation order is not obvious.

Do not decompose single-scope changes with obvious acceptance, and do not
re-plan work that is already implemented — verify against the code first.

## Division of labor

This skill decides **what the units are**: decomposition, dependency order,
scenario ownership and sizing. Neighboring canon:

- `writing-plans` — how each unit reads for a zero-context executor: exact
  files, one-action steps, proposed commands with expected output.
- `outcome-driven-development` — what makes acceptance criteria and their
  evidence falsifiable.
- `plan-design-review` — the gate that challenges the finished plan.
- `plan-coordination` — orchestrates approved tasks through execution.
- The `plan-brief` prompt operationalizes backlog triage into a plan
  record; `task-brief` holds the runtime task record template these
  planning fields populate.

## The planning process

### Step 1: Read-only discovery

Before writing any task, operate read-only:

- Read the specification, approved design and the relevant code.
- Identify existing patterns, conventions and reusable seams.
- Map dependencies between components and existing task records.
- Note risks, unknowns and anything the spec left undecided.
- Confirm the gap is real: referenced files and symbols exist, the described
  behavior is not already implemented, and no other plan or completed task
  covers it. A task whose premise is stale gets flagged, not planned.

Do not implement during planning. The outputs are a plan record and task
records under the configured harness paths (`.scopegrain/plans` and
`.scopegrain/tasks` by default), not code.

### Step 2: Map the dependency graph

Map what depends on what. Foundations build first; dependents follow:

```
Storage / schema
    |
    +-- Domain models / types
    |       |
    |       +-- Interface endpoints
    |       |       |
    |       |       +-- Consumers (clients, UI, integrations)
    |       |
    |       +-- Validation logic
    |
    +-- Seed data / migrations
```

Implementation order follows the graph bottom-up. Record the graph in the
plan so ordering is auditable, not implicit.

### Step 3: Slice vertically

Deliver one complete feature path at a time instead of building all of one
layer, then the next:

**Horizontal slicing (avoid):**
```
Task 1: entire storage schema
Task 2: all interface endpoints
Task 3: all UI components
Task 4: connect everything
```

**Vertical slicing (prefer):**
```
Task 1: user can register (schema + endpoint + UI for registration)
Task 2: user can log in (auth + endpoint + UI for login)
Task 3: user can create a record (model + endpoint + UI)
Task 4: user can list records (query + endpoint + UI)
```

Each vertical slice leaves the system in a working, testable state.

### Step 4: Write task records

Each task record states the planning-time fields below; at execution time
they populate the runtime record whose canonical template lives in the
`task-brief` prompt:

```markdown
## Task [key]: [short descriptive title]

**Scope:** one paragraph — what this task delivers and what it excludes.
**scenarioRefs:** [S1, S3] — scenarios this task closes.
**Acceptance criteria:**
- [ ] Specific, testable condition
- [ ] Specific, testable condition
**Verification:**
- [ ] Proposed command: <exact command + working directory> — expected result
- [ ] Manual check: what to verify and how
**Depends on:** [task keys, or "none"]
**Files likely touched:** `path/to/file`, `tests/path/to/test`
**Write scope:** [paths this task may modify — everything else is out of bounds]
**Recovery:** [how to roll back this unit if verification fails]
**Estimated scope:** Small (1-2 files) | Medium (3-5) | Large (5+)
```

Verification commands are proposals until authorized and executed; record
the actual command and output reference after the run. Prefer the project's
own build/test/lint commands over invented ones.

If the project designates an external tracker (issue tracker, board,
external work system), map these fields onto its items — acceptance and
verification in the item body, dependencies via its linking mechanism —
and note the tracker in the plan record instead of duplicating the task
list.

### Step 5: Order, checkpoint, approve

Arrange tasks so that:

1. Dependencies are satisfied — foundations first.
2. Each task leaves the system in a working state.
3. Verification checkpoints occur after every 2-3 tasks.
4. High-risk tasks are early — fail fast while course-correction is cheap.

Add explicit checkpoints to the plan:

```markdown
## Checkpoint: after Tasks 1-3
- [ ] All proposed checks pass with recorded output
- [ ] The project builds without errors
- [ ] Core flow works end-to-end
- [ ] Review with the owner before proceeding
```

Keep the DAG acyclic and parallel writes disjoint: no two concurrently
runnable tasks may write the same paths. Present the complete plan and its
destinations for approval. Dry-run before apply; a persisted PLAN is not
authorization to implement. Choose next work from current task records, not
a stale summary. A scheduler does not demonstrate actual agent execution.

## Scenario ownership

For formal work, reference the structured specification and approved design.
Split coherent deliverables with stable keys, bounded scopes, prerequisite
keys and scenarioRefs.

- Every assigned scenario belongs to that specification; the union of all
  tasks covers it completely — nothing outside it, nothing missing.
- Every formal task must own at least one verifiable scenario. If preparation
  has none, ask to agree a technical scenario or regroup the task; do not
  invent requirements or accept an empty assignment.
- Do not require unrelated future scenarios to pass before the first
  dependency-ready task can close. Each task closes its own scenarios.

## Task sizing

| Size | Files | Scope | Example |
|------|-------|-------|---------|
| XS | 1 | Single function or config change | Add a validation rule |
| S | 1-2 | One component or endpoint | Add a new endpoint |
| M | 3-5 | One feature slice | Registration flow |
| L | 5-8 | Multi-component feature | Search with filtering and pagination |
| XL | 8+ | **Too large — break down further** | — |

An agent performs best on S and M tasks. Break a task down further when:

- It would take more than one focused session.
- You cannot state its acceptance criteria in three or fewer bullets.
- It touches two or more independent subsystems.
- The title contains "and" — a sign it is two tasks.

Keep coherent behavior with its tests and docs in the same unit; file or
line counts alone do not decide task risk or force artificial splits.

## Plan record template

```markdown
# Implementation Plan: [feature/project name]

## Overview
[One paragraph — what is being built and why]

## Design decisions
- [Key decision and rationale, or reference to the approved design]

## Task list

### Phase 1: Foundation
- [ ] Task A: ... (scenarioRefs: S1)
- [ ] Task B: ... (scenarioRefs: S2)

### Checkpoint: foundation
- [ ] Checks pass, builds clean

### Phase 2: Core
- [ ] Task C: ... (scenarioRefs: S3, S4)

### Checkpoint: complete
- [ ] All assigned scenarios verified
- [ ] Ready for review

## Risks and mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| ...  | H/M/L  | ...        |

## Open questions
- [Decision needing owner input — a blocker, not a guessed parameter]
```

## Overwrite protection

Never overwrite an incomplete plan. Before writing to a plan or task record
destination, check whether it already exists and still holds open tasks:

- Same work being replanned (the owner asked to revise or extend this plan)
  → update the existing records in place.
- Different work → stop and ask. Open tasks may be mid-build in another
  session. Do not delete, overwrite or rename them on your own; present the
  conflict and let the owner decide.

The same rule applies to any external tracker: never bulk-close another
plan's open items to make room for new ones.

## Parallelization

- **Safe to parallelize:** independent feature slices with disjoint write
  scopes, tests for already-implemented behavior, documentation.
- **Must be sequential:** migrations, shared state changes, dependency
  chains.
- **Needs coordination:** units sharing a contract — settle the contract
  first, then parallelize.

## Common rationalizations

| Rationalization | Reality |
|---|---|
| "I'll figure it out as I go" | That is how tangled rework happens. Ten minutes of planning saves hours. |
| "The tasks are obvious" | Write them anyway. Explicit tasks surface hidden dependencies and forgotten edge cases. |
| "Planning is overhead" | Planning is the task. Implementation without a plan is typing. |
| "I can hold it in my head" | Context is finite. Written records survive session boundaries. |
| "The old plan is stale, I'll replace it" | Open tasks may be mid-build elsewhere. Overwriting destroys state that exists nowhere else. Stop and ask. |

## Red flags

- Starting implementation without a written task list.
- Overwriting a plan or task record with open items for different work.
- Tasks that say "implement the feature" with no acceptance criteria.
- No verification step anywhere in the plan.
- Every task rated XL, or every task rated the same effort.
- No checkpoints between phases; dependency order unexamined.
- A phase named "integration" or "polish" that hides unresolved design.

## Verification

Before starting implementation, confirm:

- [ ] Every task has acceptance criteria tied to its scenarioRefs
- [ ] Every task has a verification step with a real proposed command
- [ ] Dependencies are identified, acyclic, and ordered correctly
- [ ] Write scopes of parallel-eligible tasks are disjoint
- [ ] No pre-existing incomplete plan was overwritten without confirmation
- [ ] The union of scenarioRefs covers the specification exactly
- [ ] Checkpoints exist between major phases
- [ ] The owner reviewed and approved the plan and its destinations
