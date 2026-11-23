---
name: outcome-driven-development
description: Use when agreeing observable acceptance criteria and result evidence, independently of the selected engineering methodology.
---
# Observable Outcomes

This capability concerns results and evidence; it is NOT the definition of
ODD in Scopegrain. ODD means Organic Driven Development.

Agree what observable result the work must produce, who observes it, and
what evidence would establish that it happened — before deciding how to
build it. The outcome contract is methodology-independent: it applies to a
bounded light task as much as to a full SDD scenario.

Inspect what is already implemented. Agree the intended observable result,
actors, constraints, non-goals and the evidence that would establish success.
Preserve exact requested behavior and examples. If a baseline or metric is
unknown, propose authorized collection rather than inventing a number.

For light work, keep acceptance and actual evidence in its bounded task record.
For SDD, link scenarios, task scope, checks, review and the bound outcome report.
Distinguish produced files, passing checks and demonstrated product outcomes.
Unknown impact remains unknown; an operator attestation is not authenticated
proof that an external outcome occurred.

## When to use

- Agreeing what "done" means for any unit of work — before or while a task
  record, spec scenario or plan is written.
- Judging whether an acceptance criterion or a "done" claim is falsifiable.

This skill owns the **outcome contract and evidence semantics** for the
family: the verifiable-contract tables that `plan-coordination` and
`task-brief` reference live here. `organic-driven-development` supplies
the routes the contract binds to; `spec-driven-development` expresses it
as scenarios; `constraint-driven-development` owns the project-wide bar
and its ratchets — this skill owns per-outcome baselines.

## The outcome contract

For each unit of work, record:

```markdown
## Outcome contract
- **Actors:** who/what observes the result
- **Observable result:** what is true in the world when done
- **Constraints:** what must not change while achieving it
- **Non-goals:** what is explicitly out of scope
- **Evidence:** what would establish success — exact check, observation,
  or measurement, and who/what produces it
- **Baseline:** today's measured value, or "unknown — collection proposed"
```

## Reframe vague asks into falsifiable outcomes

Translate adjectives into conditions:

| Vague | Falsifiable |
|-------|-------------|
| "make it faster" | "operation X completes < N ms under load Y, measured by Z" |
| "fix the bug" | "repro steps produce correct result R; regression check T added" |
| "improve reliability" | "failure mode F no longer observable under scenario S" |
| "works well" | "named behavior B demonstrable via check C" |

If the reframed criteria are not the right targets, that surfaces **before**
code — which is the point.

## Contracts: vague vs verifiable

| ❌ Vague | ✅ Verifiable |
|---------|----------------|
| "Fix the memory bug" | "leak-check clean; suite green; memory repro passes" |
| "Improve the UI" | "typecheck 0 errors; lint 0 errors; named flow completes" |
| "Refactor the module" | "workspace builds; no new warnings; existing tests unmodified and green" |
| "Works well" | "build + suite pass, and <specific behavior> is observed" |

## Baselines and ratchets

- An unknown baseline is unknown: propose an authorized measurement and
  record the result. Never write a number you did not measure.
- Where no target exists, adopt a ratchet: record today's value with a
  direction ("must not fall"), enforce against the recorded value.
  Project-wide ratchets belong to the constraint ledger in
  `constraint-driven-development`; a per-outcome ratchet stays in the
  unit's contract.
- A threshold carries its rationale next to it — a bare number gets
  deleted by the next person who hits it.

## Evidence classes — distinguish them

| Class | What it proves | What it does not prove |
|-------|----------------|------------------------|
| Artifact produced | the file exists | that it works, that anyone uses it |
| Check passed | the check observed the contracted condition | that the product outcome occurred in the world |
| Outcome demonstrated | an authorized observation of the real result | — (the strongest class) |
| Operator attestation | an identifier claims an outcome | nothing by itself — it is a declaration, not authenticated proof |

Report which class each claim rests on. Passing checks and an approved
report are attributed evidence, not proof of business outcomes and not
permission to publish.

## Binding to the routes

- **Light work:** the outcome contract and its evidence live inside the
  bounded task record — no extra documents to imitate the formal route.
- **SDD:** each scenario binds its observable result, the task owning it
  via scenarioRefs verifies its declared coverage, and the outcome report
  links scenario → task → check → review.

## Common rationalizations

| Rationalization | Reality |
|---|---|
| "The diff is the outcome" | An artifact produced proves existence, not the result. Name which evidence class the claim rests on. |
| "Tests green means done" | A passing check proves the contracted condition was observed — not that the product outcome happened in the world. |
| "We will add the metric after shipping" | Criteria written after implementation curve-fit what was built. The reframe happens before code — that is the point. |
| "An attestation confirms it happened" | An identifier declaring an outcome is a claim, not proof — it is attributed evidence, and it authorizes nothing by itself. |

## Red flags

- Acceptance criteria that restate the task title.
- A metric or baseline asserted without a recorded measurement.
- "Done" claimed on artifact production with no observable check.
- An external outcome claimed on attestation alone.
- Success criteria added after implementation to match what was built.
- Non-goals absent from the contract — silent scope disagreement.

## Verification

- [ ] Each outcome names actors, observable result, constraints, non-goals,
      evidence and baseline (or proposed collection)
- [ ] Every success criterion is falsifiable as written
- [ ] Evidence class is stated per claim; unattributed claims are flagged
- [ ] Light work keeps the contract in its bounded record; SDD binds
      scenarios to tasks and reports
- [ ] Unknown impact is reported as unknown — never resolved by decree
