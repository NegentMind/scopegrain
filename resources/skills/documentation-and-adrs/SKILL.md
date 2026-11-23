---
name: documentation-and-adrs
description: Use when documenting actual APIs, changing architecture records or explaining a consequential design choice
---
# Documentation and Decisions

Read the current implementation and documentation conventions.
Document supported behavior, failure semantics, examples and limitations.
For a decision record state context, considered alternatives, chosen
outcome and positive and negative consequences.
Use resolvable relative links and label proposals versus existing features.
Keep operational notes inside the harness workspace; publish product
documentation only as an explicitly requested deliverable.

Document decisions, not just code. Code shows *what* was built;
documentation explains *why it was built this way* and *which alternatives
were rejected*. Write plain CommonMark that renders correctly on the
project's primary forge first, and behaves in any second consumer (vaults,
site generators) second.

## When to Use

- Making a significant architectural decision or choosing between
  competing approaches.
- Adding or changing a public API or user-facing behavior.
- Writing or reorganizing any document under the project's docs tree.
- Explaining the same thing repeatedly — that repetition is an
  undocumented decision.

Not for: self-explanatory code, throwaway prototypes, or operational notes
that belong in the harness workspace rather than product docs.

## Non-Negotiables

1. **Never write `[[wikilinks]]` in prose.** They render as literal
   `[[text]]` on common forges. Use `[Label](relative/path.md)`.
2. **Always give a new document frontmatter** with at least `title` and
   `kind` (or the project's established equivalent).
3. **`kind` is derived from the path, never chosen independently.** Path
   and kind must agree, or the doc gate fails.
4. **Never hand-edit a generated index.** Files carrying a generated
   banner are regenerated with the project's tooling.
5. **Never write self-reported freshness fields** (`last_reviewed` et al.).
   Freshness is `git log -1 --format=%cs -- <file>` — exact and free.

## Links

| Purpose | Write | Renders on forge |
|---|---|---|
| Internal document | `[Name](../path/doc.md)` | yes |
| Heading inside a doc | `[Section](./API.md#section)` | yes |
| Image | `![Diagram](../assets/x.png)` | yes |
| External | `[docs](https://example.com)` | yes |

- Paths are **relative to the containing file**, never "shortest" —
  projects accumulate duplicate basenames and only relative paths resolve
  unambiguously.
- Link to the canonical file, not a generated copy or mirror tree —
  linking into a copy creates a second source of truth.
- Links inside tables: a `|` inside a label or URL breaks the cell —
  escape it as `\|`.
- **Broken links: report, never guess.** A wrong link is worse than a
  broken one: broken is loud, wrong silently misdirects readers *and*
  agents while passing existence checks. If the target is unknown, flag it.
- If the project keeps vault-style property links in frontmatter, leave
  them — rewriting typed properties corrupts them tool-wide.

## Frontmatter

```yaml
---
title: "Hybrid retrieval: lexical + vector fused with RRF"
kind: reference
status: active
description: "One line. This text appears in generated indexes."
tags: [api, retrieval]
---
```

| Key | Required | Notes |
|---|---|---|
| `title` | yes | Must match the H1, or the H1 should be absent. Two titles reads unfinished. |
| `kind` | yes | From the project's enum; must agree with the path. |
| `status` | no | e.g. `draft` `active` `stable` `proposed` `accepted` `rejected` `deprecated` `superseded` |
| `description` | no | One line; files without it are typically omitted from indexes. |
| `tags` | no | Few, lowercase-hyphenated, reuse the project's vocabulary. |
| `supersedes` / `superseded_by` | no | ADR chains only. |

Keep the schema small: forges render frontmatter as a visible key/value
table on every page. A few flat keys is the sweet spot.

### `kind` decides the path (typical map — follow the project's)

```
index      README.md / index.md
concept    docs/concepts|architecture|strategy/
tutorial   docs/tutorials/
howto      docs/guides|howto|user/
runbook    docs/operations|runbooks|workflow/
reference  docs/api/
glossary   docs/glossary/
adr        docs/**/adr/
plan       docs/plans/
research   docs/research/
review     docs/reviews|progress/
report     docs/reports|benchmarks/
changelog  CHANGELOG.md
```

## Document Kinds: what each owes the reader

Borrowed from Diátaxis — four needs, not one (`concept` here is the
Diátaxis *explanation* quadrant; keep the project's `kind` vocabulary):

| Kind | The reader's question | Rule |
|---|---|---|
| tutorial | "Teach me, I'm stuck." | One working path, end to end; no alternatives offered as if options |
| howto | "Do this specific thing." | Starts from a goal; assumes competence |
| reference | "What exactly does this do?" | Exhaustive, uniform, no narrative; prefer generated over hand-written |
| concept | "Why is it like this?" | The only kind where prose is the point; keep it short |

**A public API change not reflected in the reference docs is incomplete.**
The doc page ships in the same change as the code.

## Architecture Decision Records

### When to write one

Framework/dependency choice, data model, auth strategy, API architecture,
platform or infrastructure selection — any decision expensive to reverse.

### Match the existing convention first

Before creating an ADR, inspect the repository for an established
convention — existing ADRs, doc config (e.g. an adr-dir file), templates.
Match:

- **Location and format** — directory, extension, markup.
- **Numbering and naming** — continue the sequence; never restart at 001
  or introduce a second scheme.
- **Section headings** — reuse the project's heading set.

Conflicting evidence is surfaced, not silently resolved with a new scheme.
Only absent any convention do you apply the template below.

### ADR template (MADR-style, the safe default)

```markdown
# NNNN. Decision title

Status: proposed | accepted | superseded by ADR-NNNN   (or frontmatter `status:`)
Date: YYYY-MM-DD

## Context and problem statement
What forces are at play? What is the actual problem?

## Decision drivers
- The quality, constraint or force that decides this.

## Considered options
- Option A — pros / cons
- Option B — pros / cons
- Option C — pros / cons

## Decision outcome
Chosen option and why.

### Positive consequences
### Negative consequences          ← an ADR without this is incomplete
```

Rules:

- **Immutable once accepted.** A change of mind is a *new* ADR naming the
  superseded one via `supersedes:`/`superseded_by:`. Never edit the body of
  an accepted ADR to change the decision.
- **Record at least two considered options.** A decision that names no
  alternatives is not a decision — and a reader will re-propose the
  rejected option.
- Lifecycle: `proposed → accepted → (superseded | deprecated)`. Do not
  delete old ADRs; they hold historical context.
- Not every file deserves to be an ADR: one implementation detail is not
  a decision record.

## Inline Documentation

Comment the *why*, not the *what*:

```typescript
// BAD: restates the code
// Increment counter by 1
counter += 1;

// GOOD: non-obvious intent
// Sliding window resets at the boundary, not on a schedule,
// to prevent burst attacks at window edges
if (now - windowStart > WINDOW_SIZE_MS) { counter = 0; windowStart = now; }
```

Do not: comment self-explanatory code, leave TODOs for work you can do
now, or keep commented-out code (history is the archive).

Document known gotchas where they bite:

```typescript
/**
 * IMPORTANT: must run before first render; after hydration the theme
 * context is unavailable and the UI flashes unstyled. See ADR-003.
 */
```

## API Documentation

- Prefer inline typed documentation on public surfaces: purpose, params,
  returns, thrown errors, one runnable example.
- REST surfaces get a spec (OpenAPI or the project's format) — generated
  or authored, never both drifting.
- Document failure semantics and limitations, not only the happy path.

## README Structure

```markdown
# Project Name
One-paragraph description.

## Quick Start      — clone, install, env setup, run
## Commands         — build / test / lint / dev table
## Architecture     — brief map; link ADRs for the why
## Contributing     — standards and PR process
```

## Changelog

Curated entries grouped by impact (`Added / Changed / Fixed / Deprecated /
Removed / Security`), newest first, phrased for the consumer — never a raw
`git log` dump. Write the entry with the change. The versioning contract
behind the changelog is `git-workflow-and-versioning`'s; the per-release
consumer page is `release-notes-one-pager`'s.

## Documentation for Agents

- Rules/instruction files — conventions so agents follow them.
- Specs — kept current so agents build the right thing.
- ADRs — prevent re-deciding settled questions.
- Inline gotchas — prevent falling into known traps.

## Length: the Nygard constraint

> "Large documents are never kept up to date. Small, modular documents
> have at least a chance. Nobody ever reads large documents."

- No document beyond ~300 lines without a table of contents and a split
  plan.
- If a reader needs two documents to answer one question, the boundary
  between them is wrong.

## Generated vs Hand-Written

**One fact, one file. Everywhere else, a link.** A link fails loudly; a
copy fails silently (content drift outlives 404s).

- If a value can be generated (versions, indexes, API surfaces, doc
  coverage), generate it — hand-copying a generated value means one copy
  is already wrong.
- Version strings, API surfaces, indexes and changelogs have exactly one
  owner each; everything else links.

## Definition of Done

Run the project's doc checks (all offline, seconds): link check, schema/
frontmatter check, index regeneration, prose lint — then confirm by
reading:

- [ ] Would a project-familiar reader find this in the generated index?
- [ ] Does the H1 match `title`, or is one absent?
- [ ] Is every claim sourced or verifiable by a repo command?
- [ ] Would each code example still run?
- [ ] If this document goes stale, what makes it visible? (A gate — not a
      date in frontmatter.)

## Anti-Patterns

| Anti-pattern | Why it is wrong |
|---|---|
| `[[wikilink]]` in prose | Literal text on forges |
| A duplicate of a doc in a second tree | Second source of truth; drifts silently |
| Adding a file without regenerating the index | The orphan is invisible until the index regenerates |
| `last_reviewed` style fields | Self-report, not measurement; stale in the same commit |
| Hand-maintained `related:` lists | Same failure mode as a hand index, smaller scale |
| 500-line architecture document | Never updated, never read |
| ADR with one option | The rejected choice gets re-proposed |
| Guessing a link target to make CI green | A wrong link is worse than a broken one |
| Bulk lint-fix on hand-written prose | Churn that hides real edits in the diff |

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "The code is self-documenting" | Code shows what — not why, or what was rejected. |
| "Docs when the API stabilizes" | APIs stabilize faster when documented; the doc is the design's first test. |
| "Nobody reads docs" | Agents do. Future engineers do. Future you does. |
| "ADRs are overhead" | Ten minutes now prevents a two-hour re-debate in six months. |
| "Comments get outdated" | Comments on *what* go stale; comments on *why* are stable. Write only the latter. |

## Red Flags

- Architectural decisions with no written rationale
- Public APIs with no documentation or types
- README that cannot get a new developer running
- Commented-out code instead of deletion
- TODO comments aging for weeks
- Docs that restate code instead of explaining intent
- Internal links pointing at generated/mirror copies

## Verification

- [ ] ADRs exist for all significant architectural decisions
- [ ] README covers quick start, commands, architecture overview
- [ ] Public API surfaces have parameter/return/failure documentation
- [ ] Gotchas documented inline where they matter
- [ ] No commented-out code remains
- [ ] Links resolve; frontmatter valid; indexes regenerated
- [ ] Rules/instruction files (AGENTS.md or the project's equivalent) are
      current and accurate
- [ ] Operational notes stayed in the harness workspace; product docs were
      an explicitly requested deliverable

## See Also

- `git-workflow-and-versioning` — the SemVer/tag/changelog contract the
  Changelog section summarizes.
- `release-notes-one-pager` — the per-release consumer-facing page.
- `project-onboarding` — configures the harness workspace and reference
  layout where operational notes live.
- `resources/references/definition-of-done.md` — the standing gate docs
  changes also clear.
