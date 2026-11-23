---
name: constraint-driven-development
description: Use when a change must preserve explicit product, security, compatibility or operational invariants
---
# Constraint Ledger

Prose about what "good" looks like does not survive the session and is not
checkable. This skill produces a written record of the project's bar — with
numbers, owners and the commands that produce each verdict — that outlives
the conversation and can be checked mechanically. An agent writes more in an
afternoon than anyone reads that week; judgement moves into checks that run
around the loop.

Identify constraints from authoritative project sources and owner decisions.
Separate hard invariants, preferences, assumptions and unknowns.
Map each hard constraint to affected interfaces and a check or explicit gap.
Design the smallest change that satisfies them without hidden exceptions.
Report conflicting requirements rather than silently weakening one.
Keep the ledger with the task, not scattered through product documentation.

Specification says what to build; tests prove it works; the constraint
ledger defines what "good enough to ship" means — before anyone argues
about it in review. Division: this skill owns the **project-wide** bar and
its ratchets; `outcome-driven-development` owns the per-unit outcome
contract and evidence classes; `spec-driven-development` owns the change
contract for a specific feature.

## When to use

- A project or significant feature starts with no written quality bar.
- The owner asks to "set up constraints", "define standards", or "stop
  shipping junk."
- Volume is produced faster than anyone reads it.
- Checks exist but nobody can say which block and which are decoration.
- Thresholds get re-argued per change instead of decided once.
- An autonomous run is planned and the only gate is a suite the agent also
  wrote.

**When not to use:** a ledger already exists and is not changing (read and
follow it); one-off spikes and throwaway prototypes; a change needed right
now with no bar-keeping question attached. A minimal floor is still worth it
even for short-lived code.

## Loading constraint

The intake needs a live owner. In non-interactive contexts, apply the floor
below, note that you did, and flag the rest for a human.

## Step 1: Detect before you ask

Never ask what you can read. Before the first question, gather:

| What | Where to look |
|------|---------------|
| Language and stack | package/manifest files |
| Test runner | dev dependencies, test scripts, existing tests |
| Existing linters/formatters | linter and formatter configs |
| Current coverage/quality | existing reports, or run the suite once |
| CI pipeline | CI configuration files |
| Agent/project rules | AGENTS.md, CLAUDE.md, harness policy |

Report what you found in two lines, then ask only what remains.

## Step 2: Four questions, each with a default

One question at a time, each carrying a guess and a default so "I don't
know" is a complete answer — the question mechanics are canonical in
`resolve-ambiguity`:

```
Q1: Beyond the floor, which dimensions do you want enforced?
    (a) coverage on new code  (b) security scanning
    (c) performance budgets   (d) accessibility   (e) architecture boundaries
GUESS: (a) and (b) — there is a test runner and user input is handled.
DEFAULT: (a) and (b). State each pick's cost: (c)/(d) need a running URL;
         (e) needs a written rules file.
```

```
Q2: When a check fails mid-task, block or warn?
GUESS: Block — an unread warning is a warning nobody reads.
DEFAULT: Block on the floor; warn on the rest for the first two weeks.
```

```
Q3: Target numbers in mind, or measure today and hold that line?
GUESS: Measure — an invented number gets ignored.
DEFAULT: Measure and hold (see Ratchets).
```

```
Q4: Slowest check tolerated before work is handed back?
GUESS: ~90 seconds — longer and it stops being run.
DEFAULT: 90s at task end; unlimited in CI.
```

Stop at four. A twelve-question intake produces a ledger nobody understands.

## Step 3: Write the ledger

One file at an approved destination — a project constraints file when the
project wants the bar in reviewable product space, otherwise under the
configured `.scopegrain/` decisions path or attached to the governing task
record. Wherever it lives, a change to it must be visible and reviewable.

```markdown
# Constraints

Last reviewed: <date> by <owner>

## Floor (always enforced, no setup required)
- No new suppression comments (ignore/disable pragmas of any ecosystem)
- No unimplemented stubs: throws "not implemented", empty catch blocks
- No skipped or deleted tests without a reason in the commit message
- No secrets in source
- This file does not get weakened to make a change pass

## Enforced with numbers
| Dimension | Rule | Checked by | Runs at |
|-----------|------|-----------|---------|
| Types | zero type errors | `<typecheck cmd>` | every edit |
| Lint | zero errors from project config | `<lint cmd>` | every edit |
| Secrets | none in source | `<scanner> --redact` | every edit |
| Coverage | changed lines ≥ 80% | `<test cmd> --coverage` + diff | task end |
| Security: deps | nothing high or above | `<dep scanner>` | CI |

## Measured, not yet enforced
| Metric | Today | Direction |
|--------|-------|-----------|
| Project coverage | 62.4% | must not fall |

## Exceptions
| ID | Rule | Path | Reason | Owner | Expires |
|----|------|------|--------|-------|---------|
| W1 | <rule> | <path> | <tracked fix> | <owner> | <date> |
```

Every "Checked by" row names the command that produces the verdict. A
dimension with a number and no command is an aspiration, not a constraint.
Then add one line to the project's agent-instruction files pointing at the
ledger: "Read the constraints before writing code. Do not weaken them to
make a change pass."

## Step 4: Install what each dimension needs

Picking a dimension means installing a mechanism — do not hand the owner a
number with no checker, and do not invent a checker when a de facto one
exists (the ecosystem's rule formats and thresholds are what other tooling
targets):

| Dimension | Typical mechanism | Gate on |
|-----------|-------------------|---------|
| Types | the stack's typechecker | any error |
| Lint | existing project config | any error |
| Coverage | existing test runner + diff intersect | changed lines |
| Security: code | a ruleset scanner | any high finding |
| Security: secrets | a secret scanner with redaction | any finding |
| Security: deps | a vulnerability-database scanner | high or above |
| Performance: page | a lab-metric tool on a running URL | agreed budgets |
| Performance: bundle | a size-limit tool | per-entry byte budget |
| Accessibility | an axe/WCAG checker on a running URL | zero critical/serious |
| Architecture | a dependency-boundary checker | any violation |
| Assertion quality | mutation testing, scoped to the diff | mutation score |

Five things that bite if skipped:

1. **Redaction is not optional** in secret scanning — report the rule and
   location, never the value; a leaked secret in a transcript propagates.
2. **Runtime checks need a running target.** If the project has no URL —
   a CLI, a library — say so and drop the dimension rather than inventing
   a check that cannot run.
3. **Scope the expensive checks to the diff.** Hours on the whole repo get
   switched off; under a minute on touched files survives.
4. **Coverage needs no second run** — intersect the report the suite
   already writes with the diff.
5. **Check licences before redistributing rule packs**; prefer the format
   the ecosystem already uses.

Wire the commands into the project's own script surface so they are
reproducible without an agent: a `check:fast` (after an edit), `check:task`
(when work is believed done), `check:full` (CI). The ledger is canonical —
scripts mirror it, and if they drift, the file wins.

## Step 5: Wire to the lifecycle

The biggest mistake is running everything everywhere — a check that stalls
the agent gets switched off, and a switched-off gate is worse than none
because the bar still looks like it exists.

| Phase | What runs | Budget |
|-------|-----------|--------|
| Edit | types, lint, secrets, the floor | seconds, changed files only |
| Task end | related tests, coverage on changed lines | ~90s |
| Review | everything, plus the weakening guards below | minutes |
| Release | direction checks, no regressions | CI |

Two rules keep it tolerable: **scope to the diff** (changed lines are a
number the agent can move; project-wide numbers are inherited) and **cost
decides placement** (anything over a few seconds leaves the edit loop).

## Step 6: Guard the bar itself

If the agent writes the code and the checks, the checks can be gamed — not
cleverly, but by the cheapest road to green. Watch the diff for five moves:

1. **The threshold moved** — a budget lowered, a severity dropped, a check
   removed from the fast stage. Diff the ledger against its branch point.
2. **A test got easier** — a skip added, a test file deleted, assertions
   pulled from tests that stayed.
3. **A checker got silenced** — new suppression comments, including the
   quiet ones: coverage-exclude pragmas, mutation-disable, scanner-ignore
   comments.
4. **Work is unfinished** — a stub that throws, an empty `catch`, a `TODO`
   standing where implementation belongs.
5. **An exception appeared** — a new Exceptions row nobody discussed.

None of this needs more than a diff. Tightening the bar should be silent;
loosening it should be loud. Since the floor has no de facto tool, use a
reference floor-guard (diff-scoped, exit codes `0` clean / `1` violation /
`2` could-not-run — never let a `2` read as `0`; extend only the pattern
lists per ecosystem) rather than hand-rolling a new one each time.

**Not all checks are equally circular.** Rank by: can the agent pass this
by writing code that does not work?

- **External** — a checker encoding an external standard or database; the
  agent cannot argue with it.
- **Project** — your lint rules, your boundaries; a human owns the file.
- **Suite** — your own tests; most useful and the only genuinely circular
  one.

A bar made entirely of the third kind is worth less. Require at least one
external constraint.

## Step 7: Ratchets, when there is no number

Setting 80% coverage on a codebase at 62% produces a red build forever and
a team that learns to ignore red. Instead: record today's value with a
direction ("must not fall") in "Measured, not yet enforced." Every check
compares against the recorded value; improving numbers get updated, drops
are the finding. Ratchet tolerance ~0.5% absorbs drift from unrelated files.

## Sane defaults

| Constraint | Default | Why |
|------------|---------|-----|
| Coverage of changed lines | ≥ 80% | Forces a test, allows config lines |
| Project coverage | today's value, must not fall | Adoptable without argument |
| Mutation score (if used) | ≥ 60% start | Typical for an unmutated suite |
| Dependency vulnerabilities | nothing high or above | Below is mostly noise |
| Exception lifetime | 90 days | Long enough to fix, short enough to remember |
| Ratchet tolerance | 0.5% | Absorbs unrelated drift |

State the number and the reason together — a threshold without rationale
gets deleted by the next person who hits it.

## Escalation path

1. **Written only** — the ledger exists and is read. Catches honest
   mistakes.
2. **Scripted** — a `check` script wired into the edit loop and CI.
3. **Tool-backed** — a dedicated runner handling diff scoping, budgets,
   ratchets and the weakening guards.

Most projects stop at 2. A first run can be floor-only: the floor guard is
diff-scoped and needs no installs, so the floor can be enforced on day one
while numbered dimensions are added per installed tool.

## Common rationalizations

| Excuse | Reality |
|--------|---------|
| "Add constraints once code settles" | Code settles around whatever was allowed while it moved. |
| "The tests are the constraints" | Tests you wrote prove you agree with yourself — nothing about coverage of new code, dependency risk or growth. |
| "We can't hit 80%" | Then don't set 80%. Set today's number and hold it. |
| "This slows the agent down" | Only if slow checks sit in the fast loop — a placement error, not an argument. |
| "I'll remember our standards" | The agent won't, and it is writing most of the code. |
| "Constraints block shipping" | An exception with an owner and a date unblocks you; deleting the constraint unblocks everyone forever. |

## Red flags

- The intake ran past four questions or produced a ledger the owner cannot
  explain.
- A budget set that the codebase fails today, with no plan to reach it.
- A dimension written with a number and no tool behind it.
- A hand-rolled checker where a de facto one exists.
- Every constraint judged by the project's own suite — no external opinion.
- The ledger changed in the same commit as the feature that was failing.
- An exception with no owner, or expiry a year out.
- A proposed threshold relaxation instead of a fix.
- Slow checks in the edit loop and `--no-verify` appearing.
- Nobody has opened the ledger since it was written.
- A hard invariant and a preference silently treated as the same thing, or
  a conflict between requirements resolved by quietly weakening one.

## Verification

- [ ] The ledger exists; every number has a stated reason
- [ ] The floor is enforced and passes on the current code unchanged
- [ ] Every picked dimension has a tool and a command that runs today
- [ ] Each constraint says where it runs; the fast stage stays under a few
      seconds
- [ ] At least one constraint is external
- [ ] Measured-only metrics record today's value and a direction
- [ ] Exceptions have an owner and an expiry
- [ ] The project's agent instructions point at the ledger
- [ ] A trial run produced no failures the owner disagrees with
