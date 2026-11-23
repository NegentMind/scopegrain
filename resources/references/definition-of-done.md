# Levels of Done

Task acceptance needs the agreed behavior, scope, relevant passing checks
and independent review or explicit owner waiver.
Commit readiness additionally needs a reviewed, coherent intended diff.
Release readiness also includes target environment, compatibility,
publication authority and feasible recovery.
Passing one level does not authorize or establish the next.

A standing, project-wide bar that every change must clear before it counts
as done. Unlike acceptance criteria, which vary per task and answer "did we
build the right thing?", the Definition of Done is the same every time and
answers "is this finished to our standard?"

## Definition of Done vs. Acceptance Criteria

| | Acceptance Criteria | Definition of Done |
|---|---|---|
| Scope | Specific to one task or spec | Applies to every increment |
| Changes | Different for each item | Fixed and reused |
| Answers | "Did we build *this thing*?" | "Is it *ready*?" |
| Owner | Defined when planning the task | Defined once for the project |
| Example | "User can reset password via email link" | "Tests pass, no regressions, docs updated" |

The two are complementary. A task is done only when **its** acceptance
criteria are met **and** the standing Definition of Done is satisfied.
Skipping either leaves work that looks finished but is not.

## The Standing Checklist

Apply this to every change before declaring it done.

### Correctness
- [ ] All acceptance criteria for the task are met
- [ ] Code runs and behaves as intended, verified at runtime, not just compiled or typechecked
- [ ] New behavior is covered by tests that fail without the change and pass with it
- [ ] Existing tests still pass; no regressions introduced
- [ ] Edge cases and error paths are handled, not just the happy path

### Quality
- [ ] Code reveals intent through naming and structure; no comments needed to explain *what* it does
- [ ] No duplicated business logic
- [ ] No dead code, debug output, or commented-out blocks left behind
- [ ] Changes are scoped to the task; no unrelated refactors snuck in
- [ ] Linting and formatting pass

### Integration
- [ ] Change works with the rest of the system, not just in isolation
- [ ] Database migrations, config changes, and feature flags are accounted for
- [ ] Backward compatibility considered for any public interface or API change

### Documentation
- [ ] Public interfaces, APIs, and user-facing behavior are documented
- [ ] Architectural decisions worth preserving are recorded as decision records
- [ ] Documentation describes the current state in timeless language, not the change history

### Ship-readiness
- [ ] Security implications reviewed for any untrusted input, auth, or data handling
- [ ] Observability in place for new critical paths (logs, metrics, traces)
- [ ] Rollback path exists for anything risky
- [ ] Rollback plan declared explicitly in the task file for features touching production or risky paths (concrete revert steps or a flag-off), with feature flags in place when gradual deployment is required
- [ ] The human has reviewed and approved before merge or deploy

## How to Apply

- **Per task**: confirm the Correctness and Quality sections before checking the task off.
- **Per feature**: confirm Integration and Documentation before considering the feature complete.
- **Per release**: the full checklist is the floor; the ship gate adds deploy-specific checks on top.
- **Per release — post-release**: verify in production that the release broke nothing before closing the iteration.
- **Per release — monitoring**: monitor logs, metrics, and error rates as part of post-release verification.

Tailor the list to the project once, then reuse it unchanged. A Definition
of Done that is renegotiated every sprint is not a Definition of Done.

## Red Flags

- "It's done, I just haven't run it yet": unverified work is not done.
- "Tests pass" used as a synonym for done while docs, regressions, or runtime verification are skipped.
- A different bar applied depending on deadline pressure.
- Acceptance criteria treated as the whole bar, with no standing quality floor.
- "Done" declared before human review on changes that need it.

---

## Companion contracts a project should also define

### Definition of Ready (DoR)

An item is ready to enter the active backlog only when:

- [ ] The row/record uses the canonical backlog schema
- [ ] Unique ID assigned
- [ ] Priority defined
- [ ] Involved files known (`file:line`)
- [ ] Effort estimated
- [ ] Relations / dependencies declared
- [ ] Verified against real code (not assumed)

### Concrete DoD commands

Beyond the standing checklist, name the exact commands that must pass —
the equivalent of "the project's verify script":

- [ ] Compiles/typechecks clean
- [ ] Test suite passes
- [ ] Linter passes with zero warnings
- [ ] Delegated/independent review with no Critical/High open
- [ ] Docs updated if applicable; changelog if user-visible
- [ ] Progress/task record updated
- [ ] Change is shippable: PR open with green CI, or merged — the task ends
      when the work can ship, not when it commits

### Feature-shippable gate (merge-to-release branch)

A feature is **shippable** only if all of:

- [ ] **(a) Tests** — unit tests that fail without the feature and pass with it; integration tests where applicable
- [ ] **(b) Docs** — API/usage updated in the same change; a decision record exists for architectural decisions
- [ ] **(c) Monitoring/observability** — a log or metric evidencing the feature works in production; critical paths have structured logs or metrics
- [ ] **(d) Viable rollback** — clean revert of the change, or flag-off via feature flag; no irreversible migration blocking the revert
- [ ] **(e) No loose ends** — every known debt (stub, shortcut, deferred edge case) is documented with a backlog ID; silent debt = not shippable

**Red flag:** "ship and see" without (c) or (d) — if it can't be observed or
reverted, it isn't shippable, it's an experiment.

### Deterministic layer (unbypassable mechanical gates)

The checks that must hold regardless of task type; enforced by tooling,
not judgment. Typical members:

- [ ] Output validation: anything the agent generated that will be executed
      (shell, SQL, code, paths) is validated before being written
- [ ] Linter with zero warnings; formatter check clean
- [ ] Test suite passes
- [ ] Unsafe/FFI diffs carry a documented safety invariant and the extra
      verification the project requires (e.g. Miri-class checks)
- [ ] Critical components (parser, serializer, WAL, network protocol) are
      marked for fuzzing/property tests
- [ ] Language safety rules: no shared-mutable-state primitives that are
      not thread-safe in concurrent code; no panic-path constructs on
      untrusted input or I/O

### Versioned DoD (ratchet)

Thresholds that only go up, never down; you can't skip a version. A typical
ladder:

| Version | Adds on top of the previous |
|---|---|
| v1 baseline | Deterministic layer + a pre-commit gate checklist (DoD applied, domain checklists where relevant, tests pass, affected docs updated) |
| v2 coverage | Minimum coverage on new modules, zero unjustified unused dependencies, a second vulnerability scanner next to the first, security checklist mandatory (not conditional) |
| v3 hardening | Mandatory fuzzing on every parser/serializer; zero audit warnings; extended unsafe-code verification |
| v4 enterprise | Zero advisories on deny-checks; higher coverage floor; external review before merge |

Ratchet rule: promotion to the next version only after N consecutive clean
tasks at the current one; the version is recorded where the gate reads it.

### Close-out checklist (what "task closed" means)

- [ ] Per modified file, its canonical doc was checked for needed updates
- [ ] Task data extracted: ID, name, date, goal, files, result
- [ ] Backlog row handled per schema (completed rows are removed; discarded
      rows are removed + archived in history)
- [ ] Progress/domain log entry written
- [ ] Changelog updated only for user-visible changes
- [ ] Doc-coverage checks pass
- [ ] Relevant decisions recorded to the decisions memory with a reference
- [ ] Code compiles and the agreed test gate passes

<!-- Referencias cruzadas: → ver quality-floor.md, ship-runbook.md, backlog-format.md, test-suite.md -->
