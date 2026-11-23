# Research Areas

Derive areas from the selected repository's interfaces and risks, not from
a fixed list of another project's modules.
Each question needs a decision, scope, sources, observations, alternatives
and unresolved uncertainty. Keep findings separate from approved choices.
Research reports and decisions live in configured harness paths.

## Module registry schema

When a project runs per-module research (a `/research <module>`-style
command that fills placeholders in a shared template), keep a canonical
registry table. One row per module — **added only through the research
flow itself** (the command asks the owner for missing fields when a module
directory exists without a row). Never edit an existing row except as the
outcome of an investigation.

| Field | Content |
|---|---|
| Module | Directory/package identifier |
| Type | What kind of artifact it is (native binding, SDK, server wrapper, adapter set, product app, site) |
| Ecosystem | Where the package lives (npm, PyPI, release binaries, repo-internal) |
| Target users | Who evaluates/adopts this module |
| Minimum competitors | Named alternatives to compare against (products, not vague categories) |
| Specific note | Module-own debts/checkpoints: open findings, parity concerns, platform coverage, doc gaps — with IDs and dates |

Example shape (illustrative only — each project fills its own rows):

| Module | Type | Ecosystem | Target users | Minimum competitors | Specific note |
|---|---|---|---|---|---|
| `sdk-python` | PyO3 SDK | PyPI | Python/AI devs, agent frameworks | named SDKs + local engines | stub .pyi drift check, error-hierarchy parity, wheels matrix |

## Supporting tables a registry usually needs

- **Template per module class** — map module → research template variant
  (e.g. API-facing modules use the library template; user-facing apps use
  a product variant covering UX/a11y/perf instead of public API).
- **Default primary competitor per module** — the single comparison target
  for the differentiation dimension.
- **Canonical doc per module** — the doc that *should* exist for that
  module's API surface. "Verify existence; if missing, that's a finding."

## Research report discipline

- [ ] Each investigation has: decision to inform, scope, sources,
      observations, alternatives considered, unresolved uncertainty.
- [ ] Findings are kept separate from the owner's approved choices — a
      report recommends, it does not decide.
- [ ] Registry cells corrected by an investigation carry the finding ID
      and date inline, so the correction is traceable.
- [ ] Reports and decisions are stored under the configured harness state
      paths, not mixed into product documentation.

<!-- Cross-references: → see backlog-format.md, task-system.md, definition-of-done.md -->
