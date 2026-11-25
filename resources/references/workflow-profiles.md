# Workflow Profiles by Task Type

Phase guides per task `type`, recovered from the legacy per-type state
machines (`task-system/workflows/*.json`) and adapted to the generic
lifecycle. **Guidance only**: enforcement is always the C0 machine in
`policy/workflow.json` (`PLAN→ACT→VERIFY→EVALUATE→REVIEW→ACCEPT→CLOSE`).
Profiles say which phases apply and in what order; they never authorize
skipping a lifecycle state.

## Detection

The profile key is the record's declarative `type` field
(`bug|feature|refactor|research|docs|ops|mixed`) — set at creation or
via `task meta`. There is no type classifier: a task with no declared
`type` gets no profile. `docs|ops|mixed` follow the generic loop
without a per-type guide.

## Phase vocabulary

Each profile lists phases in order. A phase names the work focus, the
lifecycle state it lives in, advisory iteration guidance (a soft cap —
exceeding it means reassess, not force-fail) and the exit signal that
moves work forward. Failure at any phase routes back per the table or
to `STALL` for owner attention.

## bug-fix (`type: bug`)

| Phase | Lifecycle | Advisory iter | Exit signal |
|---|---|---|---|
| localizing | PLAN/RESEARCH | ≤3 | Bug scope captured: file:line and repro evidence in the record |
| planning | PLAN | ≤5 | Fix plan declared; no edits yet |
| implementing | ACT | ≤8 | Targeted edits done |
| testing | VERIFY | ≤3 | Proposed checks executed by owner/host; evidence recorded |
| review | EVALUATE→REVIEW | ≤2 | Self-check on correctness/simplicity/consistency + blast radius |
| accept | ACCEPT | ≤2 | Acceptance evidence satisfied |
| close | CLOSE | ≤2 | Outcome archived to progress log |

Failures: `TESTS_FAIL`/`ISSUES_FOUND`/`REJECTED` loop back to
implementing.

## feature-add (`type: feature`)

| Phase | Lifecycle | Advisory iter | Exit signal |
|---|---|---|---|
| spec | PLAN | ≤3 | Boundary settled: signatures, types, callers; no code yet |
| implement | ACT | ≤10 | Incremental slices (~100 lines each), compiling per slice |
| verify | VERIFY | ≤3 | Build+test evidence recorded; failures return to implement |
| review | EVALUATE→REVIEW | ≤2 | Three-axis self-review + blast radius |
| accept | ACCEPT | ≤2 | DoD: contract, outputs, blast radius, debt, docs |
| close | CLOSE | ≤2 | Commit (conventional) + progress log |

## refactor (`type: refactor`)

| Phase | Lifecycle | Advisory iter | Exit signal |
|---|---|---|---|
| audit | PLAN/RESEARCH | ≤3 | Targets and invariants enumerated; move plan declared |
| migrate | ACT | ≤15 | Structural change applied |
| cleanup | ACT | ≤3 | Residue removed; dirty states return to migrate |
| verify | VERIFY | ≤3 | Behavior preserved: same checks green as before the change |
| review | EVALUATE→REVIEW | ≤2 | Review; issues return to migrate |
| accept | ACCEPT | ≤2 | Acceptance evidence |
| close | CLOSE | ≤2 | Commit + log |

## research (`type: research`)

| Phase | Lifecycle | Advisory iter | Exit signal |
|---|---|---|---|
| scoping | PLAN/RESEARCH | ≤3 | Questions and source list declared |
| searching | RESEARCH | ≤15 | Sources collected |
| extracting | RESEARCH | ≤12 | Findings extracted per source |
| synthesizing | RESEARCH | ≤5 | Answer drafted |
| verifying | VERIFY/EVALUATE | ≤3 | Claims checked against sources; gaps return to searching |
| review | REVIEW | ≤2 | Review; issues return to synthesizing |
| accept | ACCEPT | ≤2 | Acceptance evidence |
| close | CLOSE | ≤2 | Record + log |

## Usage

`iteration-loop` step 0d reads this profile after the skill-discovery
pass and applies phases in order. Per-phase iteration numbers are
advisory budgets (compare `budgetDefaults.maxIterations` for the
recorded-operations equivalent); the lifecycle machine is the only
authority on which transitions are legal.
