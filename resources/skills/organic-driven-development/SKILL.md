---
name: organic-driven-development
description: Use for engineering requests to establish authority, inspect existing behavior, resolve uncertainty and select proportionate light or SDD work.
---
# Organic Driven Development

ODD means Organic Driven Development in Scopegrain. Observable outcomes are
acceptance criteria; Observability-Driven is a separate optional capability.

This skill owns **intake and route selection**: establishing authority,
verifying the request is real, and choosing the proportionate route — a
bounded light task or the formal SDD chain. Downstream canon:
`outcome-driven-development` (the outcome contract),
`spec-driven-development` (the formal document chain),
`contract-execution` (the per-task lifecycle), `plan-coordination`
(orchestration and delegation). The `plan-brief` and `plan-execution`
prompts operationalize the triage and execution sequences below.

1. Establish intent and authority. Explanation, investigation and proposals
   remain read-only. Do not reinterpret a question as permission to implement.
2. Inspect the existing behavior and conventions before proposing a change.
   Bound the first exploration batch to what proves the change is understood
   — a few targeted reads or one focused search round — and widen only on a
   named gap. Extend the existing seam; do not duplicate an implemented API.
3. Resolve named uncertainty with source evidence or authorized public
   research. Decision order: continue when no human decision remains; ask
   through a compatible structured tool when a decision is required (the
   gate contract is canonical in `decision-request`; interview craft in
   `resolve-ambiguity`); use plain text only for genuinely open
   clarification; batch independent ordinary decisions where the host
   supports it; wait for the answer. Skipping, declining or a custom
   response does not silently authorize work.
4. Classify using understanding, risk and resumability, not file or line
   count. Apply the resume test: light work is what a fresh context could
   finish from the original request plus the current diff alone
   (`diff-sufficient`); anything whose rationale would be lost on restart is
   `record-required`. Unknown risk or unresolved uncertainty blocks
   implementation. Named risk uses the formal route even when the diff is
   small: (1) irreversible data or external effects → `data-integrity` /
   `external-effects`; (2) security surface → `security`; (3) public
   contracts → `public-contract`; (4) concurrency → `concurrency`;
   (5) delivery and environment → `delivery`; (6) no existing check would
   catch the regression → `verification-gap`.
5. Track before the first write: open the bounded task record before
   changing source, not after. Preserve the original request verbatim,
   scope, classification rationale and actual evidence. For light work do
   not add specification/design/approval documents merely to imitate the
   formal route. Substantial or sensitive work uses SDD with explicit
   bindings, scenario ownership and approvals.
6. Implement the smallest coherent authorized unit in reviewable work-unit
   slices. Reproduce behavior with a causal failing test when a
   deterministic runner exists. Report exceptions rather than inventing
   RED, a runner, a tool or proof. Run checks only with actual
   authorization; do not execute project-discovered scripts implicitly.
7. Review the complete diff and raw evidence proportionate to risk; the
   review boundary is a finished work-unit slice, not the accumulated
   feature. Obtain a fresh independent review or the explicit scoped owner
   waiver required by project policy. Close only the covered task and
   report the four-part outcome — implemented, verified, pending, next
   step — including failures, unknown impact and continuation.

Delegate only settled, bounded work when useful and supported by the host —
the delegation triggers, brief contents and return contract are canonical
in `plan-coordination`. Pass immutable request/spec locators and runtime
state rather than summaries that alter requirements. A role or distinct
context label is not authentication. Neither the light route nor a
successful test authorizes installation, publication, paid models,
destructive effects or the next task.

If required runtime gates are unavailable, state that limit and ask for the
missing capability. Never present an instruction as native tool
interception.

## Reality verification (before accepting work)

Before classifying or planning a task, verify it is real against the code —
do not trust a written description:

1. **Extract references** — file paths, symbols, endpoints, public contracts
   named in the request.
2. **Verify in the code** — do they exist? Is the described gap real, or is
   the behavior already implemented? What calls it (blast radius)? Do
   referenced docs match the code?
3. **Classify the gate:**

| Evidence | Gate |
|----------|------|
| References exist + real behavior gap + bounded change | DO |
| References exist but gap ambiguous, or effort ≫ impact | DEFER |
| References missing, behavior already implemented, or done elsewhere | SKIP |
| Depends on work that is not ready or is blocked | BLOCKED |
| Cannot verify without investigation | record the uncertainty; DO only if impact justifies |

4. **Write the evidence into the record** — the verification is part of the
   contract: "symbol X exists at `path:line`, gap confirmed in `func`,
   callers: `a`, `b`."

### Pre-mortem (before committing effort)

For each candidate DO, list the 2-3 most likely failure modes — the wrong
hot path assumed, an unverifiable external dependency, a caller outside the
mapped blast radius. A high-probability, high-impact failure mode downgrades
the gate to DEFER or lands in the risk register as a live risk.

### Stop conditions (declared before starting)

The **appetite** is the time deliberately invested in this work, declared
before design — fixed time, variable scope (Shape Up). It is not an
estimate: an estimate starts from a design and produces a number; an
appetite starts from a number and constrains the design. Scope that will
not fit the appetite gets hammered down or re-triaged, never silently
overrun.

| Stop condition | Trigger | Action |
|---|---|---|
| Appetite exceeded | invested time > declared appetite | abort → re-classify DEFER |
| Rabbit hole | N iterations without verifiable progress | abort → re-plan approach |
| Budget exhausted | iteration/tool/time budget spent | abort → record in notes |
| Premise invalidated | new evidence contradicts reality-check | abort → re-evaluate the gate |

A fired stop condition marks the task CANCELLED (not skipped) with the
reason recorded.

### "Is it now?" — the timing check

Triage classifies; it does not decide whether the work belongs **now**.
Before confirming DO, answer yes to all three:

1. Is this the right problem — does it fit the current goal, or is it
   backlog noise?
2. Is the appetite/scope right — does the work fit the declared appetite?
   An appetite known to be insufficient is DEFER, not a DO scheduled to fail.
3. Is it now — does urgency justify it over the other ready work?

Any "no" → DEFER with the reason in the record.

### Complexity classification (Cynefin)

Classify before fixing effort; the domain decides the approach:

| Domain | Signal | Approach implication |
|--------|--------|----------------------|
| Clear (formerly Obvious) | cause-effect evident to any reasonable observer, known practice | execute directly, small effort |
| Complicated | cause-effect analyzable by expertise | analyze first; document the choice among valid approaches |
| Complex | cause-effect only emerges by experiment | do not plan everything upfront; short steps, frequent verify |
| Chaotic | no visible causality (crisis) | act to stabilize first; high uphill → DEFER if not an emergency |

Record the domain plus the top-3 risks (most probable / highest impact /
contract-breaker) — they seed the task's risk register.

## Uncertainty reporting: uphill vs downhill

The full reporting contract — counters, record fields and the completion
rule — is canonical in `contract-execution`. What intake must honor:
moving a task to in-progress without a known approach is uphill until the
contract is defined, and a task with open unknowns never reports complete,
even at 100%.

## Invariant principles

- **The contract is law** — a boolean verifiable condition per task; if it
  does not pass with recorded evidence, the task is not complete.
- **Understand before touching** — discovery is not optional; map the blast
  radius before the first edit.
- **Mechanical verification, never self-report** — the build, the test
  runner and the linter say "pass"; the agent's summary does not.
- **One step at a time** — small commits, each individually revertible.
- **Shortest sufficient path** — before writing code climb the ladder:
  already exists > standard library > platform feature > installed
  dependency > one line > minimal new code.
- **Collateral is caught, not ignored** — a bug found mid-task: quick fix
  handled and recorded; slow one logged for later. Never passed silently.
- **Progress is always visible** — update the record and handoff after
  every action; never more than ~3-5 iterations without reporting.
- **Stagnation means asking** — 2 verify failures with the same error
  (file+line+message) → ask the owner; no answer → stop.
- **Finite budget** — iteration/tool/time limits are declared; exceeding
  them is FAILED, not "keep trying."
- **Preserve valid progress** — completed steps and save points are durable
  state; interruption resumes, never redoes.

## Common rationalizations

| Rationalization | Reality |
|---|---|
| "Too small for a record" | The bounded record is what makes the light route legitimate — it takes a minute and survives the restart. |
| "I know what they meant" | Confirming intent before writing is cheaper than rework after. |
| "It compiles, it works" | Compiling is not the contract. Run the declared verification or say it was not run. |
| "Just this once, skip the check" | The check exists for exactly the change that wants to skip it. |
| "A green test proves the fix" | A green test proves a test passes. Root cause is proven by investigation; outcome is proven by the contract. |
| "Small diff means light work" | Classification is about risk and resumability, not line count. Named risks are formal at any size. |

## Red flags

- Writing to source before the bounded record exists.
- Reinterpreting an ambiguous ask as authorization to implement.
- Declaring "done" on a proposed-but-unexecuted verification.
- A failed check re-run unchanged in a loop instead of diagnosed.
- Light-route classification chosen to dodge the formal gates on a named
  risk.
- Scope grown mid-task on findings not recorded.
- Old evidence cited after the implementation changed.
- Closing beyond the agreed boundary — next task, push or publish assumed.

## Verification

- [ ] Authority was established before the first write; investigation and
      proposals stayed read-only until then
- [ ] The bounded task record was opened before changing source, with the
      original request preserved verbatim
- [ ] The classification (`diff-sufficient` / `record-required`, plus any
      named-risk class) was recorded with its rationale
- [ ] Named-risk work took the formal route regardless of diff size
- [ ] Reality verification evidence (references exist, gap confirmed,
      blast radius) was written into the record
- [ ] Stop conditions and appetite were declared before starting; a fired
      condition marked the task CANCELLED with its reason
- [ ] The close reported the four-part outcome — implemented, verified,
      pending, next step — including failures and unknown impact
