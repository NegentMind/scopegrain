---
name: git-workflow-and-versioning
description: Use when preparing a local commit, applying versioning or ignore policy, or deciding what generated artifacts may be shared
---
# Git Authority

Inspect status and preserve changes you did not make.
Review the complete intended diff and relevant verification before commit.
Follow the selected per-project versioning policy; ignore rules do not
remove already tracked files or override a parent directory ignore.
Do not auto-untrack, reset, amend, force-push, merge or publish.
Local commits, remote push and release are separate permissions.
Never include secrets or private historical sessions in shared artifacts.

Git is the safety net. Treat commits as save points, branches as sandboxes
and history as documentation. Disciplined version control is what keeps
fast-moving changes manageable, reviewable and reversible.

## Core Principles

### Short-lived branches over long-lived divergence

Keep the default branch (trunk) always deployable. Work in short-lived
branches that merge back quickly — the DORA/Accelerate research line
associates merging to trunk at least daily (a branch measured in hours,
at most a couple of days) with higher delivery performance. Long-lived
branches are hidden costs — they diverge, create merge conflicts and
delay integration.

- **Development branches are costs.** Every day a branch lives, it
  accumulates merge risk.
- **A PR branch can still be trunk-based** — what matters is branch age,
  not whether a branch exists.
- **Release branches are acceptable** when a release must stabilize while
  the default branch moves forward.
- **Feature flags > long branches.** Deploy incomplete work behind flags
  rather than keeping it on a branch for weeks.

If the project uses a different branching model, adapt — commit discipline
matters more than the specific strategy.

## Commit Convention

The bounded commit cycle — slice, narrow checks, diff inspection, commit,
save point, per-commit budget — is owned by `work-unit-commits`; delivery
slicing of larger forecasts belongs to `chained-pr`. What this skill fixes
is the *convention* the message and history follow.

### Messages explain the why, in Conventional Commits shape

```
<type>[optional scope][!]: <short description>

[optional body explaining why, not what]

[optional footer(s)]
```

| Type | Use |
|---|---|
| `feat` | New feature (correlates with SemVer MINOR) |
| `fix` | Bug fix (correlates with SemVer PATCH) |
| `refactor` | Change that neither fixes a bug nor adds a feature |
| `test` | Adding or updating tests |
| `docs` | Documentation only |
| `chore` | Tooling, dependencies, config |

Other types (`build`, `ci`, `perf`, `style`) are conventional but carry no
implicit SemVer effect. A breaking change is marked in *any* type with `!`
after the type/scope or a `BREAKING CHANGE:` footer (correlates with
MAJOR).

```
# Good: explains intent
feat: add email validation to registration endpoint

Prevents invalid email formats from reaching the database.
Uses schema validation at the route handler level, consistent
with existing validation patterns.

# Bad: describes what's obvious from the diff
update auth.ts
```

### One concern per commit

Each commit does one logical thing, and each kind of change is a separate
commit — never formatting mixed with behavior, or a refactor folded into a
feature. Trivial cleanups may ride along only at reviewer discretion.
Separate concerns make each change easier to review, revert and understand
in history.

Automate staged-file checks with hooks (lint-staged-style formatters)
where the project has them; the inspection steps themselves live in
`work-unit-commits`.

## Branching

```
main (always deployable)
  ├── feature/task-creation    ← one feature per branch
  ├── feature/user-settings    ← parallel work
  └── fix/duplicate-tasks      ← bug fixes
```

- Branch from the project's default branch.
- Keep branches short-lived — hours where possible, merge within 1-3 days
  at most; aim to integrate into trunk at least daily.
- Keep few active branches in flight at once.
- Delete branches after merge.
- Naming: `feature/<short>`, `fix/<short>`, `chore/<short>`,
  `refactor/<short>` — or the project's established convention.

### Worktrees for parallel work

Use worktrees to run multiple branches simultaneously without switching:

```bash
git worktree add ../project-feature-a feature/task-creation
git worktree add ../project-feature-b feature/user-settings
# each directory has its own branch; work proceeds in isolation
git worktree remove ../project-feature-a   # when merged or abandoned
```

Isolation means a failed experiment costs nothing, and parallel work never
collides until explicitly merged.

## Change Summaries

After any modification, provide a structured summary — it documents scope
discipline and surfaces unintended changes:

```
CHANGES MADE:
- src/routes/tasks.ts: Added validation middleware to POST endpoint
- src/lib/validation.ts: Added TaskCreateSchema

THINGS I DIDN'T TOUCH (intentionally):
- src/routes/auth.ts: similar validation gap, out of scope

POTENTIAL CONCERNS:
- The schema rejects extra fields — confirm this is desired.
```

The "didn't touch" section proves scope discipline rather than an
unsolicited renovation.

## Generated Files and Ignore Policy

- Commit generated files only when the project expects them (lockfiles,
  checked-in migrations).
- Never commit build output, `.env`, or private session/tooling state.
- Maintain an ignore file covering standard exclusions.
- Ignore rules do not remove already-tracked files (untracking is a
  separate authorized action) and do not override a parent directory's
  ignore.

## Git for Debugging

```bash
git bisect start && git bisect bad HEAD && git bisect good <known-good>
git log --oneline -20
git diff HEAD~5..HEAD -- src/
git blame <file>
git log --grep="keyword" --oneline
```

## Release and Versioning

Commits are how *you* track change; a **version** is how *consumers* track
it. Once anything depends on the code — a team, a published package, a
deployed client — "latest on main" stops answering "what am I running, and
is it safe to upgrade?"

### Semantic versioning

```
MAJOR  breaking change — consumers must change their code
MINOR  new functionality, backward-compatible
PATCH  bug fix, backward-compatible
```

The number is a promise. A "patch" that changes behavior consumers relied
on is a breaking change in disguise (Hyrum's Law — see
`api-and-interface-design`). SemVer also allows a deprecation notice to
ride in a MINOR bump; the actual retirement path is
`deprecation-and-migration`'s job. When unsure whether a change is
breaking, assume it is.

### Tag the release; the tag is the source of truth

```bash
git tag -a v1.4.0 -m "Release 1.4.0"
git push origin v1.4.0        # only with explicit push authorization
```

Derive the version from the tag rather than hand-editing scattered files,
so artifact, tag and changelog can never disagree. Tagging and pushing
tags are release actions — separate from local commits.

### Curated changelog

A changelog is not `git log`. It is the consumer-facing answer to "what
changed and do I care?" — grouped by `Added / Changed / Fixed / Deprecated
/ Removed / Security`, newest on top, every entry phrased around user
impact:

```markdown
## [1.4.0] - 2025-06-12
### Added
- Bulk task import via CSV
### Fixed
- Timezone drift in recurring task due dates
### Deprecated
- `GET /v1/tasks/all` — use paginated `GET /v1/tasks` (removal in 2.0)
```

Write the entry in the same change that makes the change — not
reconstructed from commit archaeology at release time. The consumer-facing
release page derived from this changelog is `release-notes-one-pager`'s
job; shipping the release itself is `shipping-and-launch`'s job — this
section is the versioning contract that feeds both.

## Authority Boundaries

- Local commit, remote push, merge, tag and publish are **separate
  permissions**. A commit authorization implies nothing about push or
  release.
- Never amend, force-push, reset --hard, auto-untrack or publish without
  explicit instruction.
- Preserve pre-existing uncommitted changes that are not yours — work
  around them, never sweep them into your commit or discard them.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "The message doesn't matter" | Messages are documentation for future readers and agents. |
| "I'll squash it all later" | Squashing destroys the development narrative. Commit cleanly from the start. |
| "Branches add overhead" | Short-lived branches are cheap; long-lived ones are the real cost. |
| "I don't need an ignore file" | Until `.env` with production secrets gets committed. |
| "It's just a small fix, bump the patch" | Check what consumers observe; a relied-on behavior change is breaking whatever the diff size. |
| "The changelog is the commit log" | Commits are for you; the changelog is curated for consumers. |
| "We'll write the changelog at release" | By then the impact is reconstructed from memory. Write it with the change. |

## Red Flags

- Large uncommitted changes accumulating
- Messages like "fix", "update", "misc"
- Formatting mixed with behavior changes
- No ignore file; committed `node_modules/`, `.env`, build artifacts
- Long-lived branches diverging far from the default branch
- Force-pushing to shared branches
- A breaking change shipped under a minor/patch bump
- A release with no tag, or a version hand-edited out of sync with the tag
- A changelog that is just dumped commit messages
- Secrets or private session history in any shared artifact

## Verification

For every commit, run the `work-unit-commits` per-commit checklist
(single purpose, tests/docs with the unit, scoped checks green, sha
recorded, no foreign changes, reversible in isolation).

For every release (anything with consumers):

- [ ] Version bump matches the change: breaking → major, additive →
      minor, fix → patch
- [ ] Release is tagged; version derives from the tag
- [ ] Changelog has a curated, human-readable entry grouped by impact
- [ ] Push/tag/publish performed only with explicit authorization

## See Also

- `work-unit-commits` — the bounded commit cycle, per-commit budget and
  pre-commit inspection this convention assumes.
- `chained-pr` — delivery slicing when a forecast exceeds the budget.
- `api-and-interface-design` — Hyrum's Law and what counts as breaking.
- `deprecation-and-migration` — retiring surface with a deprecation window.
- `shipping-and-launch` / `release-notes-one-pager` — what the versioning
  contract feeds at release time.
- `resources/references/definition-of-done.md` — the standing gate every
  change clears before commit.
