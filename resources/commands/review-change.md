---
name: review-change
description: Review a change for behavioral risks and missing verification.
---
# Review a Change

Two focuses, selected by argument or owner intent:

| Focus | Invocation | Behavior |
|---|---|---|
| Change review (default) | `review-change [scope]` | Deep review of a diff or unit of work |
| Architecture / clean-code audit | `review-change` with `focus: architecture` + optional path | Rule-book compliance sweep; reports only, never edits |

Load skills: `unified-review` (review mode), `review-deep`,
`code-review-and-quality`, `independent-review` when a separate reviewer
context is available. Brief it with `prompts/review-request`; register
findings per `prompts/finding-record`. Governing rules: `rules/review`,
`rules/api-contract`.

## Focus: change review

1. Read the approved contract, the complete diff, callers and actual
   check evidence. If the working diff is empty, use the last commit's
   diff as the review scope and say so.
2. Prioritize bugs, security, compatibility and missing regression
   cases. Trace data, authority, ownership, persistence and concurrency
   where relevant; check adversarial and interrupted states, not only
   the success path (`review-deep`).
3. With architecture focus, inspect boundaries and dependency direction;
   do not substitute stylistic scores for demonstrated risks.
4. Return severity-ordered findings with file locations, evidence,
   impact and a concrete acceptance condition for correction
   (`references/definition-of-done`). Separate confirmed defects from
   hypotheses and from unavailable checks.
5. If nothing is found, state that and record residual gaps.

Do not edit the change, and do not approve work you authored as
independent review — the reviewer context (`reviewer`, or `architect`
for boundary questions) must differ from the author; a waiver must be an
explicit owner decision, never an invented reviewer.

## Focus: architecture / clean-code audit (cleanCA port)

Report-only sweep of the named file/directory, or a module-by-module
sweep of the whole repo when no path is given. Load the checklist in
`references/clean-code-clean-architecture` before auditing; project
appendices there override generic examples.

### Checklist

| # | Rule | What to detect | Default severity |
|---|---|---|---|
| N1 | Intention-revealing names | Lying or disinformative names (`data`, `info`, `tmp`, one-letter names outside short loops) | medium |
| N2 | No gratuitous context | Stuttering parent→child names (`Store::store_get`, `Pool.pool_saturated`) | medium |
| N3 | Idiomatic conventions | Language casing/naming conventions violated | medium |
| F1 | Small, single-purpose, single abstraction level | Long functions mixing orchestration + formatting + I/O | medium |
| F2 | ≤3 args, no flag params | ≥4 params without an object/builder; `bool` that switches behavior | medium |
| F3 | No hidden side effects, CQS | `get*` that mutates; a command that queries and changes state | medium |
| E1 | Explicit error handling | Unchecked unwrap/panic in production paths; untyped throws; silent catch-all | high |
| C1 | Comments compensating failure | Redundant comments, commented-out code | low/medium |
| S1–S5 | SOLID | Multiple change reasons; edit-instead-of-extend; fat interfaces; concrete-over-abstraction (high when domain depends on infrastructure) | medium |
| A1 | Dependency rule | Inner layer naming outer-layer tech (SQL/HTTP/UI/framework types in domain logic) | high |
| A2 | Humble object + DTOs | Business logic in controllers/handlers; storage models crossing into domain | high/medium |
| A3 | Acyclic dependencies | Dependency cycles between modules | high |
| G1–G7 | Design smells | Rigidity, fragility, immobility, opacity, feature envy, train-wreck chains, primitive obsession | medium |
| T1 | Test quality | Slow/coupled/non-repeatable tests; tests without arrange-act-assert structure | medium |

### Impact per finding (medium/high, mandatory)

For each finding map: **dependents** (who relies on it), **dependencies**
(what it relies on), **function** (one line), **what breaks if changed**
(contracts, serialization, public API, generated code, dynamic
consumers) and **proposed improvement** (minimal before/after sketch —
never applied here). Use graph tooling when indexed; else caller search.

### Output format

```markdown
# Clean-code/architecture audit — <scope> — <date>
## Summary: high X · medium Y · low Z (verdict: PASS / DEBT / BLOCKED)
## High findings
### [<rule>] `path:line` — title
- Evidence: `snippet`
- Violates: <rule + section>
- Dependents / Dependencies / Function / Risk / Proposal (before→after)
## Medium findings (same, grouped by rule)
## Low suggestions (one line each)
## Out of scope (files skipped and why)
```

## Authority and verification

Both focuses are read-only on the change under review: findings,
evidence and proposals — never edits, never a fix slipped into the
report. Independence is real or explicitly waived by the owner; a renamed
author role is not independence.

## Output contract

- Report under the configured reports path
  (`review-<focus>-<YYYYMMDD>-<HHMMSS>.md`) and indexed; the lead may
  persist a delegated report through approved harness operations.
- Each finding ≥ medium registers per `prompts/finding-record` —
  `source` names this report, schema per `references/backlog-format`,
  deduplicated first.
- New debt accepted to fix findings stays subject to the project's
  declared debt balance; a finding is a record, not silent debt.

## Red flags

- Stylistic scores substituted for demonstrated risk.
- Hypotheses reported as confirmed defects; unavailable checks reported
  as run.
- Fixes implemented inside this command — correction is a separate,
  explicitly requested task.
- Overlap confusion: `verify-work` runs mechanical gates,
  `analyze-structure` maps structure/impact, `simplify-code` applies
  reductions — this command reviews, it does not replace them.

## Handoff

Stop after reporting. Findings become backlog items; implementation goes
through `implement-task`.
