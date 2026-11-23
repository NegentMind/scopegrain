---
name: select-capabilities
description: Use when choosing capabilities for a task or inspecting catalog and dependency availability
---
# Select Capabilities

Inspect the catalog and select only procedures relevant to this task.
Check required tools, scope, provenance and activation status.
Read selected skill bodies and necessary references, not all resources.
An archived entry is not approved for activation by existing on disk.
Report unavailable dependencies and degrade explicitly; do not fabricate
a tool, load private history or install an integration without consent.

Before finalizing the selection consult the outcomes log
(`memory list --log outcomes` or the `skillOutcomes` rates in `metrics`):
historical ok/fail rates per skill are a real signal — prefer skills with
a recorded success history and treat untried ones as higher-risk, not
inferior. Record what you chose in `task.skills` so the loop stays fed.

`task suggest --project PATH ID` (or `scopegrain_task_suggest`) runs the
metadata heuristic — ranked candidates with declared `reasons` from
`type`/`title`/`contract`/`scope`. Treat its output as a starting list to
confirm or correct through this skill's judgment, never as the selection
itself; the same list is also traced on `packet.taskRouting.suggested`.

## Discovery: task → phase → skills

Route the task to the phase it is in, then pick the smallest skill set:

```
Task arrives
    │
    ├── Intent unclear? ────────────────→ clarify-intent
    ├── Rough concept, need variants? ──→ brainstorming
    ├── Conflict/ambiguity in scope? ───→ resolve-ambiguity
    ├── New/unfamiliar repository? ─────→ project-onboarding
    ├── New feature/change, no spec? ───→ spec-driven-development
    │     └── organic mode? ────────────→ organic-driven-development
    ├── Spec exists, need tasks? ───────→ planning-and-task-breakdown
    │     └── need the plan written? ───→ writing-plans
    │     └── plan review before build? → plan-design-review
    ├── Implementing code? ─────────────→ incremental-implementation
    │     ├── commits per slice? ───────→ work-unit-commits
    │     ├── forecast > slice budget? ─→ chained-pr
    │     ├── API/interface work? ──────→ api-and-interface-design
    │     ├── need better context? ─────→ context-engineering
    │     ├── doc-verified code? ───────→ source-driven-development
    │     ├── high stakes/unfamiliar? ──→ doubt-driven-development
    │     └── hard constraints? ────────→ constraint-driven-development
    ├── Writing/running tests? ─────────→ test-driven-development
    ├── Something broke? ───────────────→ systematic-debugging
    │     └── error-path handling? ─────→ debugging-and-error-recovery
    ├── Reviewing code? ────────────────→ code-review-and-quality
    │     ├── mode undecided? ──────────→ unified-review
    │     ├── too complex? ─────────────→ code-simplification
    │     ├── security concerns? ───────→ security-and-hardening
    │     ├── performance concerns? ────→ performance-optimization
    │     ├── deep/focused review? ─────→ review-deep
    │     └── named-risk unit? ─────────→ independent-review
    ├── Committing/versioning? ─────────→ git-workflow-and-versioning
    ├── CI/CD pipeline work? ───────────→ ci-cd-and-automation
    ├── Deprecating/migrating? ─────────→ deprecation-and-migration
    ├── Writing docs/ADRs? ─────────────→ documentation-and-adrs
    ├── Logs/metrics/alerts? ───────────→ observability-and-instrumentation
    ├── External research needed? ──────→ web-research
    ├── Release notes? ─────────────────→ release-notes-one-pager
    ├── Session boundary/progress? ─────→ session-handoff
    └── Deploying/launching? ───────────→ shipping-and-launch
```

## Capability declaration (mandatory, once per phase)

Choosing capabilities silently is not selection — it is guessing. Before
the first mutating action of a task (and again on every phase change),
emit this block so the choice is auditable and correctable:

```
DECLARED CAPABILITIES
task-type:   <core-logic|interface|docs|research|ops|release|mixed>
phase:       <clarify|spec|plan|implement|test|review|ship|debug|handoff>
skills:      [<id>, ...]          — bodies read before acting
references:  [<id>, ...]          — consulted as needed
mcps/tools:  [<id>, ...]          — only entries actually available
unavailable: [<id> — reason]      — degraded explicitly, never fabricated
rationale:   one line per non-obvious pick
```

Rules:

1. Emit it before the first edit/command, not after — a declaration made
   post-hoc cannot be corrected in time.
2. Keep it the smallest set that covers the current phase. Loading the
   whole catalog is a failure of this skill, not thoroughness.
3. On a phase transition (plan → implement → test → review), re-emit
   with the delta — do not silently carry stale selections.
4. Record the final set in `task.skills` at close; it feeds the
   outcomes loop used to route future tasks.
5. When the runtime eventually supplies bindings automatically, this
   block becomes the verification that the auto-selection was right —
   the declaration stays either way.

## Core Operating Behaviors

These apply at all times, across all skills. Non-negotiable.

### 1. Surface assumptions

Before implementing anything non-trivial, state assumptions explicitly:

```
ASSUMPTIONS I'M MAKING:
1. [assumption about requirements]
2. [assumption about architecture]
3. [assumption about scope]
→ Correct me now or I'll proceed with these.
```

Do not silently fill ambiguous requirements — surfacing uncertainty early
is cheaper than rework.

### 2. Manage confusion actively

On inconsistencies, conflicting requirements or unclear specs:

1. **STOP.** Do not proceed on a guess.
2. Name the specific confusion.
3. Present the tradeoff or the clarifying question.
4. Wait for resolution.

### 3. Push back when warranted

Not a yes-machine. When an approach has clear problems: point it out,
quantify the downside ("adds ~200ms latency", not "might be slower"),
propose an alternative, and accept the owner's decision once they override
with full information. Sycophancy is a failure mode.

### 4. Enforce simplicity

Before finishing any implementation, ask:

- Can this be done in fewer lines?
- Are these abstractions earning their complexity?
- Would a senior engineer say "why didn't you just..."?

Prefer the boring, obvious solution. Cleverness is expensive.

### 5. Maintain scope discipline

Touch only what the task requires. Do not remove comments you do not
understand, "clean up" orthogonal code, refactor adjacent systems, delete
apparently-unused code without approval, or add unrequested features.
Surgical precision, not unsolicited renovation.

### 6. Verify, do not assume

A task is not complete until verification passes. "Seems right" is never
sufficient — require evidence: passing tests, build output, runtime data.
Per-skill verification is the local check; the project-wide Definition of
Done (`resources/references/definition-of-done.md`) applies to every
change regardless of which skills are active.

## Failure Modes to Avoid

1. Wrong assumptions left unchecked
2. Plowing ahead while confused
3. Noticing inconsistencies and not surfacing them
4. Withholding tradeoffs on non-obvious decisions
5. Sycophantic agreement with flawed approaches
6. Overcomplicated code and APIs
7. Modifying code or comments outside the task
8. Removing what you do not fully understand
9. Building without a spec because "it's obvious"
10. Skipping verification because "it looks right"

## Skill Rules

1. **Check for an applicable skill before starting work** — skills encode
   processes that prevent common mistakes.
2. **Skills are workflows, not suggestions.** Follow steps in order; do
   not skip verification steps.
3. **Multiple skills can apply in sequence.** A feature may run
   spec → plan → implement → test → review → ship end to end.
4. **When in doubt, start with a spec.** Non-trivial work without a spec
   begins at `spec-driven-development`.
5. **Selection is not activation.** An archived or unprovisioned entry is
   not available; check activation status, scope and provenance first.
6. **Degrade explicitly.** A missing dependency is reported and worked
   around — never fabricated, never silently substituted.

## Lifecycle Sequence

For a complete feature, the typical sequence is:

```
1.  clarify-intent                 → what the owner actually wants
2.  brainstorming                  → variants for vague ideas
3.  spec-driven-development        → what we are building
4.  planning-and-task-breakdown    → verifiable chunks
5.  writing-plans                  → the plan artifact
6.  context-engineering            → right context loaded
7.  source-driven-development      → verify against official docs
8.  incremental-implementation     → build slice by slice
9.  observability-and-instrumentation → instrument as you build (parallel)
10. doubt-driven-development       → cross-examine decisions in-flight
11. test-driven-development        → prove each slice
12. work-unit-commits              → reviewable commit per unit
13. code-review-and-quality        → review before merge
14. code-simplification            → reduce accidental complexity
15. git-workflow-and-versioning    → clean history
16. documentation-and-adrs         → document the why
17. shipping-and-launch            → deploy safely
18. release-notes-one-pager        → communicate the release
19. session-handoff                → persist progress and learnings
```

Not every task needs every skill. A bug fix may only need
`systematic-debugging` → `test-driven-development` →
`code-review-and-quality` → `work-unit-commits`.

## Anti-Rationalization (MUST)

The following excuses are wrong — ignore them:

- "This is too small for a skill"
- "I'll implement it quickly, no spec/test/review needed"
- "I know the code, no need to load skills"
- "I'll add the tests after"

Correct behavior: always evaluate which skills apply and load them before
acting — then verify per their own procedures.

## Verification

- [ ] A `DECLARED CAPABILITIES` block was emitted before the first
      mutating action and re-emitted on every phase change.
- [ ] The selected set is the smallest that covers the task's phases —
      not the whole catalog.
- [ ] Every selected entry was checked for activation status, scope and
      provenance before use.
- [ ] Missing tools/dependencies were reported and degraded explicitly —
      nothing fabricated or silently substituted.
- [ ] The selection was recorded in `task.skills` so the outcomes loop
      stays fed.
- [ ] Skill bodies were actually read, not inferred from their names.
