---
name: code-review-and-quality
description: Use when inspecting a change for behavioral defects, regressions, boundary risks and missing tests
---
# Code Review and Quality

Multi-axis review with quality gates. Every change gets reviewed before it
is accepted — no exceptions. Five axes: **correctness, readability,
architecture, security, performance.**

**The approval standard:** approve a change when it verifiably improves
overall code health, even if it isn't perfect. Perfect code doesn't exist —
the goal is continuous improvement. Don't block a change because it isn't
how you would have written it. If it improves the codebase and follows the
project's conventions, approve it.

## When to use

- Before merging any change or marking a work unit complete
- After completing a feature implementation
- When another agent, model, or human produced code you must evaluate
- When refactoring existing code
- After any bug fix — review both the fix **and** the regression test

## The Five-Axis Review

### 1. Correctness — does the code do what it claims?

- Does it match the spec, contract, or task requirements?
- Are edge cases handled (null, empty, boundary values)?
- Are error paths handled, not just the happy path?
- Does it pass the relevant tests — and do the tests actually test the
  right things?
- Any off-by-one errors, race conditions, or state inconsistencies?

### 2. Readability & simplicity — can another engineer understand it
without the author?

- Names descriptive and consistent with project conventions? (No bare
  `temp`, `data`, `result`.)
- Straightforward control flow (no nested ternaries, deep callbacks)?
- Logical organization — related code grouped, clear module boundaries?
- "Clever" tricks that should be simplified?
- **Could this be done in fewer lines?** 1000 lines where 100 suffice is a
  failure.
- **Are abstractions earning their complexity?** Don't generalize until
  the third use case.
- Would comments clarify non-obvious intent? (Never comment the obvious.)
- Dead artifacts: no-op variables, backwards-compat shims, `// removed`
  comments?
- **A new conditional bolted onto an unrelated flow is a design smell,
  not a nit** — push the logic into its own helper, state, or policy.
- **Repeated conditionals on the same shape signal a missing model or
  dispatcher.** A "temporary" branch is usually permanent debt.

### 3. Architecture — does the change fit the system's design?

- Follows existing patterns, or introduces a new one — and if new, is it
  justified and documented?
- Clean module boundaries maintained? Dependencies flowing the right
  direction — no circular deps?
- Duplication that should be shared?
- Abstraction level appropriate — not over-engineered, not too coupled?
- **Does this refactor reduce complexity or just relocate it?** Count the
  concepts a reader must hold to follow the change. If a "cleaner"
  version leaves that count unchanged, it isn't cleaner — prefer the
  restructuring that makes whole branches, modes or layers disappear.
  Prefer deleting an abstraction to polishing it.
- **Feature-specific logic leaking into a shared or general-purpose
  module?** Keep logic in its owning layer; reuse the canonical helper,
  not a near-duplicate; don't normalize architectural drift.
- **Are type boundaries explicit?** Question gratuitous
  `any`/`unknown`/optional/casts and silent fallbacks that paper over an
  unclear invariant — an explicit boundary often simplifies the
  surrounding control flow.

### 4. Security — does the change introduce vulnerabilities?

- User input validated and sanitized at system boundaries?
- Secrets out of code, logs, and version control?
- Authentication/authorization checked where needed?
- Queries parameterized — no string concatenation into SQL/commands?
- Output encoded against injection (XSS et al.)?
- Dependencies from trusted sources, no known vulnerabilities?
- External data (APIs, logs, user content, config) treated as untrusted
  and validated before use in logic or rendering?

For a dedicated security posture, defer to `security-and-hardening` and
`resources/references/security-checklist.md` — this axis gates the
change; that skill owns the full threat model.

### 5. Performance — does the change introduce performance problems?

- N+1 query patterns?
- Unbounded loops or unconstrained data fetching?
- Synchronous work that should be async?
- Unnecessary re-renders in UI components?
- Missing pagination on list endpoints?
- Large objects created in hot paths?

For a dedicated performance posture, defer to
`performance-optimization` and
`resources/references/performance-checklist.md`.

When you flag a structural problem, **propose the move — not just the
problem.** A review that only says "this is complex" leaves the author
guessing. Reach for a named restructuring:

- Replace a chain of conditionals with a typed model or explicit
  dispatcher.
- Collapse duplicate branches into a single clearer flow.
- Separate orchestration from business logic so each reads on its own.
- Move feature-specific logic out of a shared module into the package
  that owns the concept.
- Reuse the canonical helper instead of a bespoke near-duplicate.
- Make a type boundary explicit so downstream branching disappears.
- Delete a pass-through wrapper that adds indirection without clarifying
  the API.
- Extract a helper, or split a large file into focused modules.

Prefer the remedy that **removes moving pieces** over one that spreads the
same complexity around.

## Change sizing

Small, focused changes are easier to review, faster to merge, safer to
deploy:

```
~100 lines changed   → Good. Reviewable in one sitting.
~300 lines changed   → Acceptable if it's a single logical change.
~1000 lines changed  → Too large. Split it.
```

**Watch file size, not just diff size.** A small diff can push a file past
a healthy boundary — around 1000 *total* lines in one file is an
inspection signal, not a hard cap. When a change materially grows an
already-large file, ask whether to decompose *first* — extract helpers,
subcomponents, modules — then add.

**What counts as "one change":** a single self-contained modification
that addresses one thing, includes related tests, and keeps the system
functional. One part of a feature — not the whole feature.

**Splitting strategies:**

| Strategy | How | When |
|----------|-----|------|
| Stack | Submit a small change, build the next on it | Sequential dependencies |
| By file group | Separate changes per reviewer domain | Cross-cutting concerns |
| Horizontal | Shared code/stubs first, then consumers | Layered architecture |
| Vertical | Smaller full-stack slices | Feature work |

**When large changes are acceptable:** complete file deletions and
automated refactors where the reviewer verifies intent, not every line.

**Separate refactoring from feature work.** A change that refactors *and*
adds behavior is two changes — submit them separately. Small cleanups
(renames) may ride along at reviewer discretion.

## Change descriptions

Every change needs a description that stands alone in history.

- **First line:** short, imperative, standalone. "Delete the legacy RPC",
  not "Deleting the legacy RPC". Searchable without reading the diff.
- **Body:** what is changing and why — context, decisions, reasoning not
  visible in code. Link bugs, benchmarks, design docs. Acknowledge known
  shortcomings.
- **Anti-patterns:** "Fix bug", "Fix build", "Add patch", "Moving code
  from A to B", "Phase 1", "Add convenience functions".

## Review process

### Step 1 — Understand the context

Before looking at code: what is this change trying to accomplish? What
spec, contract or task does it implement? What is the expected behavior
delta?

### Step 2 — Review the tests first

Tests reveal intent and coverage:

- Do tests exist for the change?
- Do they test behavior, not implementation details?
- Are edge cases covered?
- Descriptive names?
- Would they catch a regression if the code changed?

### Step 3 — Review the implementation

Walk each changed file against the five axes. Trace suspected defects
into executable scenarios before stating them as findings — a finding
without a failure mechanism is a hypothesis, label it accordingly.

### Step 4 — Categorize findings by severity

Label every comment so the author knows what is required vs optional:

| Prefix | Meaning | Author action |
|--------|---------|---------------|
| **Critical:** | Blocks merge — vulnerability, data loss, broken functionality | Must fix |
| *(no prefix)* | Required change | Must address before merge |
| **Optional:** / **Consider:** | Suggestion | Worth considering, not required |
| **Nit:** | Minor — formatting, style preference | May ignore |
| **FYI** | Informational — context for the future | None |

**Lead with what matters.** Order findings by leverage: correctness and
security first, then structural regressions and missed simplifications,
then everything else. Don't bury a real issue under cosmetic nits — a few
high-conviction comments beat a long list. One structural problem plus
ten nits means the structural problem *is* the review.

### Step 5 — Verify the verification

Check the author's verification story:

- Which tests ran — and where is the evidence (command + output)?
- Did the build pass?
- Was the change exercised manually where tests don't reach?
- Screenshots / before-after evidence for UI changes?
- Anything claimed but not actually run → the finding is a
  **verification gap**, not a pass.

## Output contract

The deliverable is a review, not a fix: severity-labeled findings
ordered by leverage (critical/required first), each with `file:line`
and a concrete recommendation, plus a verdict — **Approve** or
**Request changes** — and the verification story. The checklist below
is the canonical shape. A finding that cannot name a failure mechanism
is labeled a hypothesis, not stated as a defect. The verdict attests
what the evidence shows; it never authorizes merge, push or release.

## Independent / multi-context review pattern

Different contexts have different blind spots — rotate the reviewer:

```
Author context writes the code
        │
        ▼
Independent fresh context reviews for correctness and architecture
        │
        ▼
Author addresses the feedback
        │
        ▼
Owner makes the final call
```

Launch the reviewer through whatever mechanism the host provides
(subagent, delegated session). Give it the diff, the contract, and the
severity prefixes — nothing else it needs to trust. If the reviewing
context is the same one that implemented the change, that is self-review:
disclose it; it does not satisfy independence for named-risk work (see
`independent-review`), and needs an explicit owner waiver.

## Dead-code hygiene

After any refactor or implementation change:

1. Identify code now unreachable or unused.
2. List it explicitly.
3. **Ask before deleting:** "Remove these now-unused elements: [list]?"

```
DEAD CODE IDENTIFIED:
- formatLegacyDate() in src/utils/date.ts — replaced by formatDate()
- OldTaskCard component — replaced by TaskCard
- LEGACY_API_URL constant — no remaining references
→ Safe to remove these?
```

Don't leave dead code lying around; don't silently delete what you're
unsure about.

## Review speed

Slow reviews block entire teams — context-switch cost < waiting cost:

- **Respond within one business day** — the maximum, not the target.
- Ideal: respond shortly after the request; a typical change completes
  multiple rounds in a day.
- Prioritize fast individual responses over quick final approval.
- Large changes: ask the author to split rather than reviewing one
  massive changeset.

## Handling disagreements

Resolution hierarchy:

1. **Technical facts and data** override opinions and preferences.
2. **Style guides** are the absolute authority on style.
3. **Software design** is evaluated on engineering principles, not
   personal taste.
4. **Codebase consistency** is acceptable if it doesn't degrade health.

**Don't accept "I'll clean it up later."** Deferred cleanup rarely
happens — require it before submission unless it's a genuine emergency.
If surrounding issues can't be addressed in this change, require a
tracked finding with an owner.

## Honesty in review

- **Don't rubber-stamp.** "LGTM" without evidence helps no one.
- **Don't soften real issues.** A bug that will hit production is not a
  "minor concern".
- **Quantify problems.** "This N+1 adds ~50 ms per item" beats "could be
  slow".
- **Push back on approaches with clear problems.** Sycophancy is a
  failure mode — say so directly and propose alternatives.
- **Accept override gracefully.** If the author has full context and
  disagrees, defer to their judgment. Comment on code, not people.

## Dependency discipline

Dependency review is part of code review.

**Before adding any dependency:**

1. Does the existing stack solve this? (Often it does.)
2. How large is it? (Check bundle/link impact.)
3. Actively maintained? (Last commit, open issues.)
4. Known vulnerabilities? (Run the project's audit command.)
5. License compatible?

**Rule:** prefer standard library and existing utilities. Every
dependency is a liability.

**Upgrading a dependency is a code change** — and bulk "bump deps"
merges are the riskiest kind:

1. **Read the changelog, not the version number.** Semver is a promise
   the maintainer may not have kept; a "patch" can carry a behavioral
   change. For majors, read the migration notes.
2. **One dependency per change** (or a small related group). A bulk bump
   that breaks the build hides which package did it; a single-package
   change keeps the cause obvious and the revert clean.
3. **Let the tests decide.** Verified by a green suite before *and*
   after — not by "it installed". Thin coverage around the dependency's
   behavior is itself the finding; add a test first.
4. **Mind the transitive graph.** Review the lockfile diff, not just the
   manifest — one direct bump can pull dozens of indirect changes.
5. **Keep the lockfile honest.** Commit it, review its diff, never
   hand-edit it.

## The review checklist

```markdown
## Review: [change title]

### Context
- [ ] I understand what this change does and why

### Correctness
- [ ] Matches spec/contract requirements
- [ ] Edge cases handled
- [ ] Error paths handled
- [ ] Tests cover the change adequately

### Readability
- [ ] Names clear and consistent
- [ ] Logic straightforward
- [ ] No unnecessary complexity

### Architecture
- [ ] Follows existing patterns
- [ ] No unnecessary coupling or dependencies
- [ ] Appropriate abstraction level
- [ ] Refactors reduce complexity rather than relocate it
- [ ] No feature logic in shared modules; file stays healthy-sized

### Security
- [ ] No secrets in code
- [ ] Input validated at boundaries
- [ ] No injection vectors
- [ ] Auth checks in place
- [ ] External data treated as untrusted

### Performance
- [ ] No N+1 patterns
- [ ] No unbounded operations
- [ ] Pagination on list endpoints

### Verification
- [ ] Tests pass (evidence, not claim)
- [ ] Build succeeds
- [ ] Manual verification done where applicable

### Verdict
- [ ] **Approve** — ready
- [ ] **Request changes** — issues must be addressed
```

## Presumptive blockers

Surface and propose the simpler design for each; escalate to Required
only when the change actively makes structure worse:

- A refactor that relocates complexity instead of reducing it.
- A change that pushes a file past the size boundary with no
  decomposition.
- Feature logic added to a shared module.
- A near-duplicate of an existing canonical helper.
- A silent fallback that hides an unclear invariant.

## Common rationalizations — reject them

| Rationalization | Reality |
|---|---|
| "It works, that's good enough" | Working code that's unreadable, insecure, or architecturally wrong creates compounding debt. |
| "I wrote it, so I know it's correct" | Authors are blind to their own assumptions. |
| "We'll clean it up later" | Later never comes. The review is the gate — use it. |
| "AI-generated code is probably fine" | AI code needs *more* scrutiny — it's confident and plausible even when wrong. |
| "The tests pass, so it's good" | Tests don't catch architecture, security, or readability problems. |
| "The refactor makes it cleaner" | Relocating complexity isn't reducing it — look for the version where branches disappear. |
| "It's only a small addition to this file" | Judge the resulting structure, not the diff size. |
| "It's just a version bump" | A bump is a behavior change you didn't write — read the changelog. |
| "I'll upgrade everything in one PR to save time" | Bulk bumps hide which package broke it. One per change. |

## Red flags

- Changes merged without any review
- Review that only checks whether tests pass
- "LGTM" without evidence of actual review
- Security-sensitive changes without security-focused review
- Large changes "too big to review properly" — split them
- Bug fixes without regression tests
- Review comments without severity labels
- Accepting "I'll fix it later"
- A refactor that moves code without reducing the concept count
- New conditionals scattered into unrelated paths (missing abstraction)
- A bespoke helper duplicating a canonical one; feature logic in shared
  modules
- A bulk dependency bump with no changelog review and no per-package
  isolation
- A lockfile change hand-edited, uncommitted, or merged unreviewed

## Verification after review

- [ ] All Critical issues resolved
- [ ] All Required changes resolved or explicitly deferred with
      justification and a tracked finding
- [ ] Tests pass — with executed evidence, not claims
- [ ] Build succeeds
- [ ] The verification story is documented (what changed, how verified)
- [ ] Dependency upgrades reviewed against changelogs, isolated per
      package, green suite, lockfile diff reviewed

## Boundaries

- A report-only review does not implement fixes — findings and
  recommendations are its output.
- Do not claim independence from a different role label inside the same
  implementation context; state residual gaps honestly.
- Findings and verdicts are attestations of evidence seen — they do not
  authorize merge, push, or release.
