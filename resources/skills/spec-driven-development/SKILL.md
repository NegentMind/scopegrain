---
name: spec-driven-development
description: Use for explicitly requested formal specifications or sensitive and substantial changes that require a falsifiable change contract.
---
# Spec-Driven Development

Write a structured specification before any code. The spec is the shared
source of truth: it defines what is being built, why, and how completion is
proven. Code without a spec is guessing.

Inspect current behavior, callers, tests, existing specifications and actual
constraints before adding another contract. Honor the selected project mode:
do not impose formal documents on a genuinely light task.

Preserve the original request and exact examples in the structured spec.
If it contains secrets, obtain an approved redacted request before persisting;
do not silently alter requirements or put credentials in artifacts.
Give requirements and scenarios stable identifiers. Define observable
behavior, compatibility, failure paths, recovery, scope and non-goals.
Do not invent a baseline, metric or threshold.

Unresolved product questions block implementation and specification approval.
Keep the specification, design, plan, decisions and reports in configured
harness paths. Obtain current content-bound approvals before formal ACT.
Assign scenarios to tasks; the plan covers the complete specification,
while each task verifies its own declared coverage.

Passing checks and an approved report remain attributed evidence, not
authenticated proof of business outcomes or permission to publish.

## When to use

- A formal specification was explicitly requested.
- The change is sensitive or substantial and needs a falsifiable change
  contract — per the `organic-driven-development` named-risk classes
  (`security`, `public-contract`, `data-integrity`, `external-effects`,
  `concurrency`, `delivery`, `verification-gap`).

Do not impose the full document chain on genuinely light work (the bounded
record suffices — `organic-driven-development`), and do not write a full
spec for a feature-add inside a plan — the `spec-brief` mini-spec gate
covers that case. Question-round mechanics: the canonical gate contract
lives in `decision-request` (one round per gate, options + recommended
default); interview craft lives in `resolve-ambiguity`.

## The gated workflow

Four phases, each gated on owner approval of the artifact as written:

```
SPECIFY ──→ PLAN ──→ TASKS ──→ IMPLEMENT
   │          │        │          │
   ▼          ▼        ▼          ▼
 owner      owner    owner      owner
 approves   approves approves   verifies
```

Do not advance until the current artifact is approved. A persisted spec or
plan is not authorization to implement.

## Phase 1: Specify — derive first, ask second

Derive everything the repository already answers (code, existing docs,
decisions, prior specs). Anything derivable becomes a decided item with
cited evidence (`ref: file:line`). Do not ask the owner to rediscover
source facts.

Collect the remaining open decisions into **one** structured question round:

1. Batch all open decisions into a single round — do not drip questions.
2. Every question carries concrete options with the recommended default
   first. Never an open-ended "what do you want?"
3. Use the host's structured question/approval mechanism when it provides
   one. If none exists, emit a bounded decision table and **stop** — never
   assume the answers.
4. Refusal, skipped questions, custom answers and uncertainty are not
   approval.

```
| # | Decision              | Options (+ tradeoff)        | Recommended |
|---|-----------------------|-----------------------------|-------------|
| 1 | Auth mechanism        | session / token / both      | session     |
| 2 | Compatibility target  | current only / + legacy     | current     |
```

### Spec contents

Cover these areas; each gets a stable identifier:

1. **Objective** — what is being built, for whom, why now, what success
   looks like.
2. **Scenarios** — observable behavior as stable IDs (`S1`, `S2`, …) that
   tasks will later own via scenarioRefs.
3. **Interfaces and commands** — full signatures and executable commands,
   not tool names.
4. **Constraints and boundaries** — three tiers:
   - *Always:* run checks before closing work, follow conventions, validate
     inputs.
   - *Ask first:* schema changes, new dependencies, pipeline/config changes.
   - *Never:* commit secrets, edit generated/vendor code, remove failing
     checks without approval.
5. **Failure paths and recovery** — what can go wrong and how it is
   detected and undone.
6. **Non-goals** — explicit exclusions. Half of misalignment is silent
   disagreement about what is not being built.
7. **Success criteria** — falsifiable, testable conditions.
8. **Open questions** — anything unresolved; these block approval.

### Spec template

```markdown
# Spec: [project/feature name]

## Objective
[What and why. Original request preserved verbatim.]

## Scenarios
| ID  | Scenario | Observable behavior | Failure path |
|-----|----------|--------------------|--------------|
| S1  | ...      | ...                | ...          |

## Interfaces and commands
[Signatures; full commands with working directories]

## Constraints
- Always: [...]
- Ask first: [...]
- Never: [...]

## Failure paths and recovery
[Detection, rollback, authority required]

## Non-goals
- [Explicit exclusion — and why]

## Success criteria
[Specific, falsifiable conditions]

## Open questions
[Unresolved — blocks approval]
```

### Reframe vague requirements as falsifiable criteria

Translate instructions into concrete conditions:

```
REQUIREMENT: "Make the dashboard faster"

REFRAMED:
- First meaningful render < 2.5s on the reference environment
- Initial data load completes < 500ms
- No visible layout shift during load
→ Are these the right targets? (open question until approved)
```

This lets you loop toward a clear goal instead of guessing what "faster"
means. If no baseline exists, propose an authorized measurement rather than
inventing a number. The falsifiable-outcome contract — actors, evidence
classes, baselines and ratchets — is canonical in
`outcome-driven-development`.

## Phase 2: Plan

With the approved spec, produce a technical plan per `writing-plans` and
`planning-and-task-breakdown` — they own the dependency-graph, slicing,
ordering and sizing mechanics; this phase only adds the SDD-specific
rules:

- Assign every scenario to exactly one task; the union covers the spec.
- The plan must be reviewable: the owner can say "yes, that approach" or
  "no, change X" without executing anything. For consequential plans, run
  `plan-design-review` before presenting for approval.

## Phase 3: Tasks

Break the plan into discrete task records per `planning-and-task-breakdown`:
each completable in one focused session, each with acceptance criteria, a
proposed verification command, declared write scope, and at least one
owned scenario.

## Phase 4: Implement

Execute one task at a time under the `contract-execution` lifecycle
(PLAN → ACT → VERIFY → …). Load only the spec sections and files the
current unit needs rather than the whole spec at once.

## Keeping the spec alive

The spec is a living contract, not a one-time artifact:

- Decision changes update the spec first, then the code.
- Scope changes (added or cut) are reflected with their rationale.
- The spec lives in the configured harness paths alongside the task records.
- Task records and reviews reference scenario IDs back to the spec.

## Common rationalizations

| Rationalization | Reality |
|---|---|
| "This is simple, no spec needed" | Simple tasks need short specs, not none. A two-line spec with acceptance criteria is fine — the light route is a decision, not a default. |
| "I'll write the spec after coding" | That is documentation, not specification. The value is forced clarity before code. |
| "The spec slows us down" | A 15-minute spec prevents hours of rework. |
| "Requirements will change anyway" | That is why the spec is living. An outdated spec beats none. |
| "The user knows what they want" | Clear requests carry implicit assumptions. The spec surfaces them. |

## Red flags

- Writing code with no written requirements.
- Asking "should I just start building?" before "done" is defined.
- Implementing features absent from any spec or task record.
- Architectural decisions taken and never recorded.
- Scenarios assigned to no task, or tasks claiming scenarios not in the spec.
- `N/A` written into a spec section that contains real technical decisions.

## Verification

Before proceeding to implementation:

- [ ] The spec covers objective, scenarios, interfaces, constraints,
      failure/recovery, non-goals, success criteria, open questions
- [ ] Every requirement and scenario carries a stable identifier
- [ ] Success criteria are falsifiable and testable
- [ ] Boundaries (always / ask-first / never) are defined
- [ ] The original request is preserved verbatim; secrets were redacted
      with approval
- [ ] The owner approved the spec as written; open questions are resolved
      or explicitly deferred
- [ ] The spec is persisted under the configured harness paths
