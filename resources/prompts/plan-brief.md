---
name: plan-brief
description: Build a verified execution plan from a backlog — reality check, triage gate, risks and stop conditions per task.
---
# Plan Brief

Build an execution plan from a backlog. Loaded by `plan-work` once an
authorized input exists (a recorded backlog, a settled specification or an
explicit owner request). Apply the triage gate
(`do | defer | skip | blocked`) to EVERY candidate task. Persist the plan
record under the configured plans path (`.scopegrain/plans`) containing only
`do` tasks. Finish by confirming the defer/skip set with the owner and
showing the recommended next command. The output is the persisted plan
record plus the owner-confirmed triage summary.

Load relevant capabilities first (`planning-and-task-breakdown`,
`writing-plans`, `brainstorming`/`clarify-intent`, `session-handoff`; add
`spec-driven-development` when substantial work lacks a settled
specification).

## Step 0 — Reality check (mandatory, per task)

Verify the task is **real and applicable against current code** before any
gate decision: the files/symbols it names exist, the described behavior or
gap persists (not already implemented), and the proposed work is not stale.
This prevents the pipeline from consuming an obsolete task and discovering
it at VERIFY.

**Skills by situation (load only matching ones):**

| Task situation | Skill | Why |
|---|---|---|
| Reported bug (crash, broken behavior) | `systematic-debugging` | Confirm the bug exists with a repro, not just the description |
| Touches public API / bindings / breaking change | `source-driven-development` | Verify the symbols exist and documented behavior is real |
| Ambiguous or high-risk | `doubt-driven-development` | Adversarial: do not trust the backlog's premise |
| Any code task | reuse-ladder convention (`code-simplification`) | YAGNI check before including the task in the plan |
| Migrating/completing prior work | `session-handoff` | Avoid duplicating already-recorded progress |

Also run the skill-discovery pass (`select-capabilities`): task files +
lifecycle `PLAN` phase + contract keywords against the catalog; record
`SKILLS_LOADED` in the plan.

**Per task (deeper as effort/ambiguity grows):**

1. **Extract references** from the task text: file paths, symbols (functions,
   types, tests, endpoints), feature flags, public API.
2. **Verify in real code** with the available structural capability
   (reference `graph-investigation`; grep/read fallback):
   - Does the file/symbol exist? (missing → stale or renamed path)
   - Is the behavior already implemented? (a "fix X" with X fixed → STALE)
   - What calls it / what does it affect? (blast radius — reused later in
     the task record)
   - Do referenced docs/API match current code?
3. **Classify the gate** from the evidence:

| Real evidence | Gate |
|---|---|
| References exist + real behavior gap + bounded change | `do` |
| References exist but gap ambiguous / effort ≫ impact | `defer` |
| References missing, already implemented, or done in another plan | `skip` |
| Depends on a not-ready or blocked task | `blocked` |
| Unverifiable without investigation (bug with no repro, external API) | note it; apply `do` only if impact justifies |

4. **Write the evidence into the plan** — verification is part of the
   contract: `Verified: symbol X exists at file:line, real gap, callers: A, B`
   plus the gate justification. If the symbol is missing, record that as the
   `skip` evidence.

## Pre-mortem (mandatory for every `do` candidate)

List the 2–3 most probable failure modes BEFORE committing effort — the
cheapest way to expose rabbit holes before the chosen approach becomes an
expensive commitment. Record each as `Likely failure N: ...`. A
high-probability high-impact failure mode lowers the gate to `defer` or
enters the risk register.

## Stop conditions / appetite (circuit breaker)

Define explicit CANCELLATION triggers BEFORE the task starts:

| Stop condition | Trigger | Action |
|---|---|---|
| Appetite exceeded | time invested > declared appetite | abort → re-triage as `defer` |
| Rabbit hole | N iterations with no verifiable progress | abort → re-plan the approach |
| Budget exhausted | declared operation budget spent | abort → record in notes |
| Premise invalidated | new evidence contradicts Step 0 | abort → re-evaluate the gate |

A triggered stop condition marks the task `cancelled` (not `skip`) with the
reason recorded. Stop conditions live in the plan record beside each
contract (`stopConditions`, `appetite` fields).

## Gate rules (applied AFTER Step 0)

> **Decision gates:** every critical task or ambiguous contract is confirmed
> with the owner per `decision-request` (Gate P) BEFORE fixing the gate; for
> feature-add/new logic, a mini-spec per `spec-brief` resolved by one
> question round before `do`.

1. Bug already absent or feature already implemented (**verified**) → `skip`
2. Cosmetic with no user complaint → `defer`
3. Effort ≫ impact → `defer` or `skip`
4. Dependency not ready → `blocked`
5. Original priority is a suggestion, not an ordering
6. Step-0 verification grounds the gate — do not re-decide from backlog
   prose when the code contradicts it

## "Is it NOW" checklist (mandatory before any `do`)

Triage classifies; it does not decide the work is right NOW. Before a `do`,
answer three questions — any "no" degrades to `defer` with the reason:

1. **Is it the right problem?** — fits the current goal/strategy, or lateral
   backlog noise?
2. **Is the appetite/scope right?** — does the work fit the declared
   appetite? A known-insufficient appetite is a `defer`, not a `do` with a
   failure date. For complex-classified tasks, validate appetite first.
3. **Is it NOW?** — does urgency justify pulling it over the other tasks?

## Cynefin + top-3 risks (mandatory for every task)

Classify complexity BEFORE fixing effort/priority:

| Domain | Signal | Approach implication |
|---|---|---|
| Clear | known cause-effect, known best practice | execute directly → small effort |
| Complicated | cause-effect analyzable by expertise | needs analysis → medium effort; record choice among valid approaches |
| Complex | cause-effect emerges only by probing | do NOT plan everything upfront: probe-sense-respond, short steps, frequent verify |
| Chaotic | no visible causal relation (crisis) | act-first: stabilize before planning; high uphill → `defer` unless on fire |

Record in the plan per task: `Cynefin: <class> — why` plus the **top-3
prioritized risks** (most probable / highest impact / the one that would
break the contract). These seed the task's risk register — an identified
triage risk cannot be absent from it.

## Register every `do` task

- Unique key/id, short description (≤80 chars)
- **Appetite:** the time we WILL invest, declared before effort; triggers
  the "appetite exceeded" stop condition
- **Effort / priority / severity / type** per the semantic layer
- **Key files**, **real verification** (Step-0 evidence), **gate
  justification**, **gate result**
- **Contract:** mechanically verifiable condition
- **Pre-mortem**, **stop conditions**, **risk register** (≤5-8 live risks:
  likelihood×impact, mitigation, trigger)
- **Cynefin** + **top-3 risks**
- **Uphill/downhill**: open unknowns vs settled pending work
- **DoD** per level (below)
- **Appetite-vs-effort consistency:** appetite ≥ estimated effort; if
  appetite < effort → re-estimate, widen appetite, or scope down to `defer`
  BEFORE fixing `do`
- **Methodology bindings** (`rules/methodology`): SDD tasks carry the
  settled spec/design references and assigned scenarioRefs; light work
  carries classification facts and recorded bounded authorization instead —
  never fabricate formal approvals for a light task
- **Dependencies** (plan task keys — the DAG); initial state PLAN; task
  record under `.scopegrain/tasks` created on demand

## Definition of Done — per level (gate, not afterthought)

| Level | Minimum |
|---|---|
| Task | mechanical contract verified (recorded verification) · task record synced · continuation updated |
| Commit | declared commit convention · declared checks pass · no net new debt · learnings recorded |
| Release | changelog/version policy · docs synced · declared release gate |

Checkboxes are marked only with mechanical evidence, never intent.

## Uncertainty reporting (mandatory)

Report plan state on TWO axes, not just % done:

- ⬆ **uphill** — open unknowns: undecided choices, unverified external
  dependencies, ambiguous behavior, unresolved Cynefin.
- ⬇ **downhill** — settled pending execution: atomic steps with a clear
  contract, no unknowns.

Moving a task to in-progress without a known approach is uphill until the
contract is defined. The per-task counters live in the task record; the plan
reports the aggregate.

## `plan-adjust` event (re-planning)

Re-planning (pending→do, re-estimation, contract change) is not free: it
changes the uncertainty report. Record in plan notes:

```
plan-adjust [YYYY-MM-DD]: <id> — what changed (gate / re-estimate / contract)
- uphill before: <resolved or new unknown>
- uphill after: <state after the adjust>
- downhill before/after: <pending steps>
```

Without the event, "progress" and "resolved unknown" are indistinguishable.

## Backlog intake

Read the project's backlog in its declared format (named backlog records or
the owner's file). Parse deterministically where a schema is declared;
exclude terminal dispositions (`icebox`, `future`, `discarded`, `cancelled`)
from triage unless explicitly decided otherwise. If the format is
unrecognized, interpret conservatively and mark unparseable items.

## Plan record format

```markdown
# Execution Plan: <name>
> Started: YYYY-MM-DD · State: in-progress · Source: <backlog ref>
> Autonomous: false   # true = only Gate V + Gate C safety cases apply

## Summary
| Result | Count |
| do | N |  defer | N |  skip | N |  blocked | N |
Status: ⬆ uphill = <open unknowns> · ⬇ downhill = <pending steps>

## Tasks
### Task 1: <key> — <description>
- Appetite / Effort / Priority / Type
- Key files: `path`
- Verified: ✅ real-code (symbol X at file:line, gap confirmed) |
  🟡 verify-in-discovery | ❌ stale
- Gate justification · Gate result: do
- Contract: "<mechanical check>"
- Task record: <tasks path>/<id> · State: PLAN
- Branch: · Commit:
- Risk register: | likelihood×impact | risk | mitigation | trigger |
- Iterations: | # | action | result | tool |
- Notes:
```

## On finish

Before persisting the plan: **confirm the complete defer/skip set with the
owner** (`decision-request`, Gate P — final triage summary). Then show the
exact next command: `coordinate-plan` — which loads `plan-execution` — for
the new plan record, or `implement-task` for a single task.
