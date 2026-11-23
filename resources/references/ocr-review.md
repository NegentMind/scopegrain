# Visual and Extracted-Text Review

Inspect the actual image/page when available. Separate layout defects,
content errors and extraction/OCR artifacts.
Record which surfaces, sizes, states and languages were exercised.
An inaccessible visual surface is an evidence gap, not an implicit pass.
Do not infer screen-reader behavior from a screenshot alone.

## Visual review checklist

- [ ] The actual rendered image/page was inspected — not inferred from code
      or markup alone.
- [ ] Layout defects (overflow, clipping, misalignment, contrast) are
      reported separately from content errors and from extraction/OCR
      artifacts; the three categories must not be conflated.
- [ ] Which surfaces, viewport sizes, interaction states and languages were
      exercised is recorded. An unexercised state is "not reviewed", not
      "passing".
- [ ] When the visual surface is inaccessible to the reviewer (headless,
      no screenshot channel), report an evidence gap — never mark the
      criterion green by default.
- [ ] A screenshot alone does not establish keyboard order or screen-reader
      behavior; those need their own exercise
      (see `accessibility-checklist.md`).

---

# Delegated Code Review (deterministic scaffolding + agent reasoning)

This section describes a *delegation-mode* code-review gate: a tool
supplies the deterministic scaffolding (which files to review, bundled
diffs, per-path rule groups, positioning) and the reviewing agent supplies
the reasoning with its own model — no extra LLM endpoint or key required.
If the project has such a tool configured, use it; if not, the workflow
below still applies manually.

## When to gate it

| Gate | How it runs | Verdict |
|---|---|---|
| Close of each task | Run the review spec over the pending diff | Critical/High block the commit |
| Independent review by a different agent | Hand the review spec to the reviewer as input | Reviewer verifies Critical/High before its verdict |
| Audit step | Review spec as cognitive input | Counts as review evidence |

## Workflow (5 steps; the agent executes 3–5)

```bash
# 1+2. Produce a review spec — one JSON { preview, rules } for the diff
<review-tool> --format json [--output result.json] [--background "<task contract>"]

# 3. Get the per-file diff according to the preview's mode/ref:
git diff HEAD -- <path>                 # working tree (tracked)
git diff <merge_base>..<to> -- <path>   # range (see the preview's mode/ref fields)
git show <commit> -- <path>             # a single commit
cat <path>                              # new untracked file

# 4. Review each file against its Rule Group + the task contract as context.
# 5. Report by severity:
#    Critical/High → block; fix now
#    Medium        → log as a backlog finding
#    Low           → discard silently unless clear value
```

Useful wrapper variants: `--commit <hash>` (one commit),
`--from <base> --to <branch>` (range), `--background "<contract>"` (task
business context), `--output result.json` (persist spec for the reviewer).

## What a built-in rule engine typically covers

Per-path rules that map to a project's hard rules: panic/unwrap-style
constructs in production paths, unsafe blocks without a documented SAFETY
invariant, gratuitous clones, lock guards held across `.await`, unvalidated
FFI inputs, avoidable O(n²). A rule engine complements linters rather than
duplicating them — the linter says *what*, the review reasons *why it
matters*.

## Upgrade path and CI

- If a dedicated endpoint/model is ever configured, the delegation wrapper
  can be swapped for the tool's native review command; delegation remains
  the zero-cost, zero-secret default.
- A CI job may publish the review spec as an informational artifact on each
  PR — informational only, never merge-blocking.

<!-- Cross-references: → see definition-of-done.md, security-checklist.md, accessibility-checklist.md, testing-patterns.md -->
