# Rules Format

Canonical contract for rule resources (`kind: "rule"`): markdown files
with optional bounded frontmatter, a status lifecycle, scope activation
and advisory verification references. Parsed by
`src/core/rule-meta.mjs`; enforced nowhere — metadata is data for hosts
and packet assembly, never executable policy.

## File shape

```
---
status: active
category: code-style
activation.globs: src/**/*.ts, tests/**
enforcement.verificationRef: vca1b2c3d4e5f6
---

# Rule title

> **Status:** Active

Free markdown body. The human-readable header is optional and only
acts as a status fallback (see Lifecycle).
```

- Frontmatter is OPTIONAL. A file without a `---` fence parses to
  defaults (`status: active`, `enforcement.level: advisory`).
- Grammar is deliberately flat: `key: value` lines only, dotted keys
  address nested fields. This is NOT YAML — no nested blocks, no
  anchors, no arrays; lists are comma-separated values on one line.
- A UTF-8 BOM before the fence is stripped, never silently downgrades
  the file to defaults.
- Only the head of the file is read (first 8192 characters — UTF-16
  code units, not bytes). The fence must close inside it or the file
  fails closed with `RULE_META_MALFORMED`. Blank lines and `#` comment
  lines inside the block are ignored; surrounding quotes on values are
  stripped.

## Closed key set

Unknown keys are rejected — the format evolves by extending the parser,
never by silent passthrough.

| Key | Type | Values / bounds |
|---|---|---|
| `category` | scalar | `code-style`, `architecture`, `testing`, `git-workflow`, `communication`, `security`, `other` |
| `status` | scalar | `active`, `proposed`, `archived` |
| `origin.source` | scalar | `canonical`, `local`, `user-manual`, `imported`, `auto-learned` |
| `origin.evidenceRefs` | list | ids, max 120 chars each |
| `activation.globs` | list | glob patterns (grammar below) |
| `activation.stacks` | list | stack slugs `[a-z0-9][a-z0-9+#.-]{0,39}`, lowercased |
| `activation.languages` | list | same slug grammar |
| `enforcement.level` | scalar | `advisory` (default), `strict` |
| `enforcement.verificationRef` | scalar | id slug `[a-z0-9][a-z0-9-]{0,63}`, lowercased |
| `examples.good` | scalar | free text, 500-char cap |
| `examples.bad` | scalar | free text, 500-char cap |

Scalars cap at 300 chars; lists cap at 32 comma-separated items of at
most 160 chars each (evidence refs cap per-item at 120 instead).
Empty values and duplicate keys fail closed.

## Lifecycle

`status` has three values:

- `proposed` — candidate, never enters workflow packets. Produced by
  `rule import`, `rule propose`, or an approved `rule`-category capture
  proposal (which writes a draft via the same gate).
- `active` — participates in packet assembly, subject to activation.
- `archived` — excluded; preserved for history. Re-activation requires
  a deliberate status change, not silence.

When a file has no frontmatter `status`, the human-authored header
`> **Status:** X` is the fallback, longest-prefix matched:
`Active → active`; `Proposed`, `In review`, `Draft → proposed`;
`Archived`, `Deprecated → archived`. A frontmatter key always wins.
Unrecognized header values keep the default (`active`).

Local overlay files (`rules/local/*.md`) are unpinned project-private
rules that merge over the canonical catalog — same format, same
lifecycle, `origin.source` resolves to `local` unless declared.

## Activation

`activation` scopes when a rule applies. Absent or empty means
transversal — the rule applies to every task.

- `activation.globs` — matched against `task.scope` paths during
  `buildWorkflowPacket`. No match moves the rule to
  `packet.rulesFiltered` with a reason — declared, never silently
  dropped. An empty or absent task scope fails closed: glob-scoped
  rules never fire on unknown file scope.
- `activation.stacks` / `activation.languages` — declared context hints
  for hosts; packet filtering today keys on `globs` only.

Glob grammar is intentionally small and dependency-free: `*` any chars
within a segment, `?` one char, `**` zero or more full segments.
Case-insensitive. No character classes, no negation. A `**` inside a
segment (e.g. `a**/x`) is conservative in lint overlap analysis.

## Enforcement and verification

`enforcement.level` is advisory metadata for the host (`advisory` |
`strict`) — the harness itself never enforces or executes anything from
a rule file.

`enforcement.verificationRef` names a command BY ID from the
`verification.commands` contract (`state/verify-commands.json`):
projected into packets as `verifyRef` next to each resolved rule
(declared and extension-contributed alike). It is a reference, never
an inline command — rule bodies and frontmatter carry no executable
text, and resolving the ref is a lookup, not a run.

## Provenance

`origin.source` records where a rule came from:

- `canonical` — shipped with the resource snapshot (pinned).
- `local` — project overlay (`rules/local/`).
- `user-manual` — hand-authored by the project owner.
- `imported` — produced by `rule import` from an existing instruction
  file (`AGENTS.md`, `.cursorrules`, …), one-way, as `proposed` drafts.
- `auto-learned` — reserved provenance for machine-learned drafts. It
  is author-declared today: nothing stamps it automatically — drafts
  produced by the memory-rules proposal producer land under
  `rules/local/` and parse `origin.source: local` unless the author
  declares otherwise. Still gated by human review before `active`.

`origin.evidenceRefs` may point at the journal operations, lessons or
import source sections that motivated the rule.

## Non-goals

- No inline commands, no `auto_fix`, no execution hooks. Verification
  is always by reference (`verificationRef`); anything executable lives
  in `verification.commands`, never in a rule file.
- No silent activation: `proposed` rules stay dormant until a human
  `rule approve` records the decision.
- No full YAML: the parser accepts the closed flat grammar only.
