---
name: release-notes-one-pager
description: Use when preparing release communication to describe actual delivered changes and upgrade risks without inventing a release
---
# Release Communication

Read the actual change range, user-visible behavior and release procedure.
Summarize compatibility, required actions, known limitations and recovery.
Separate delivered features from experiments and planned work.
Link inspectable evidence without exposing private logs or credentials.
Do not edit versions, tags or changelogs outside the approved process.
Drafting notes does not publish a release.

The deliverable is a single-page release notes document (HTML or Markdown,
per the project's channel). If the project provides a template or design
system, start from it — do not write styling from scratch unless a bespoke
structure is explicitly requested.

## Workflow

### Step 0 — Gather the change range

1. Identify the exact range being released: previous tag → release target
   (commit list, merged PRs, changelog draft).
2. Read the existing changelog and the release procedure.
3. If a project template exists for release notes, read it before writing;
   reuse its structure and class inventory instead of inventing one.

### Step 1 — Build the required section structure

Compose the document in this order:

1. **Header**: version, date, one-sentence summary of the release.
2. **Added** — new user-visible capabilities.
3. **Fixed** — user-visible bug fixes.
4. **Breaking changes** — anything requiring consumer action.
5. **Known issues** — shipped limitations, each with status or workaround.
6. **Upgrade note** — concrete steps, or an explicit no-action statement.
7. **Closing pointer** — link to full changelog or docs, only if a real
   destination exists.

Give each section a stable anchor/id matching its name (`added`, `fixed`,
`breaking-changes`, `known-issues`, `upgrade-note`) so navigation targets
resolve.

### Step 2 — Honesty rules for missing details

Never invent versions, dates, metrics or claims. When details are missing,
write explicit placeholders:

| Section | Missing-detail text |
|---|---|
| Summary | `No summary provided.` |
| Added | `No additions provided` |
| Fixed | `No fixes provided` |
| Breaking changes | `None` |
| Known issues | `None reported` |
| Upgrade note | `No upgrade actions required based on provided information` |

If version or date is missing, use `—` and label the field rather than
guessing.

### Step 3 — Evidence and links

- Every Added/Fixed entry names what changed concretely — not generic
  "improvements".
- Entries may link to inspectable evidence (PR, issue, doc) but never to
  private logs, tokens or credentials.
- Every call to action uses a real, safe destination. If none exists, omit
  it — never `href="#"`, placeholder tokens like `REPLACE_WITH_REAL_URL`,
  or misleading anchors. CTA copy must accurately describe the destination.

### Step 4 — Self-check gate

Run the P0 gate below before emitting. Every P0 must pass.

### Step 5 — Emit the artifact

Emit one page. One sentence before the artifact; nothing after it.

## P0 Gate (must pass)

- [ ] Required sections exist and are visible: Added, Fixed, Breaking
      changes, Known issues, Upgrade note.
- [ ] Each section uses its explicit missing-detail text when the user
      supplied nothing for it.
- [ ] No invented dates, versions, metrics or claims; missing fields are
      labelled placeholders (`Version: —`), not guesses.
- [ ] No filler copy or lorem ipsum.
- [ ] Delivered work is separated from experiments, flags and planned work.
- [ ] Every CTA/link has a real destination; no `href="#"`, placeholder
      tokens or example domains.
- [ ] Breaking changes carry a migration note when consumers must act.
- [ ] The page reflows without horizontal scroll at narrow widths (HTML).

## P1 (should pass)

- [ ] Added/Fixed entries are concrete (what changed, not "improvements").
- [ ] Known issues include status or workaround when provided.
- [ ] Upgrade steps use clear verbs (`Run`, `Update`, `Restart`, `Rebuild`).
- [ ] Headlines stay concise (under ~14 words).
- [ ] CTA labels are specific (`Read full changelog`), not `Learn more`.

## Red Flags

- Versions, dates or metrics invented to fill a section — the missing-
  detail text exists precisely for that case.
- A CTA or link with a placeholder, `href="#"` or a destination the copy
  does not describe.
- Experiments, flagged-off work or planned items presented as delivered.
- The notes treated as approval to tag, publish or announce.
- Sections present but empty — an empty section communicates nothing; the
  explicit `None`-style text does.

## Boundaries

- Drafting notes is not approval to tag, publish or announce a release —
  each is a separate authorized action.
- Do not edit versions, tags, manifests or the canonical changelog outside
  the project's approved release process; propose the entry instead.

## See Also

- `git-workflow-and-versioning` — the SemVer/tag/changelog contract that
  supplies the change range.
- `shipping-and-launch` — the launch decision and rollout these notes
  communicate.
- `resources/references/ship-runbook.md` — the project's release procedure
  when one exists.
