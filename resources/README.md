# Canonical resource bundle

`manifest.json` is the catalog contract: `entries` are the canonical
resources, `aliases` map deprecated identifiers onto canonical targets,
and `version` is a content semver that must be bumped strictly whenever
anything under `resources/` changes (enforced by
`scripts/check-manifest-version.mjs`).

## File format per kind

| Kind | Location | File format |
|---|---|---|
| `command` | `commands/*.md` | YAML frontmatter (`name`, `description`) + Markdown body |
| `skill` | `skills/<id>/SKILL.md` | YAML frontmatter (`name`, `description`) + Markdown body |
| `agent` | `agents/*.md` | YAML frontmatter (`name`, `description`) + Markdown body |
| `prompt` | `prompts/*.md` | YAML frontmatter (`name`, `description`) + Markdown body |
| `rule` | `rules/*.md` | Flat Markdown; optional bounded rule-meta frontmatter (below) |
| `reference` | `references/*.md` | Flat Markdown, **no frontmatter** |
| `mcp` | `mcps/*.json` | JSON descriptor (`schemaVersion`, `id`, transport) |
| `profile` | `profiles/*.json` | JSON descriptor (`schemaVersion`, `id`, dependency lists) |

## Why rules and references carry no descriptive frontmatter

Flat format is deliberate, not an omission. Rules and references are
never individually selectable host units: they are bundled as body text
into commands, skills and agents through the manifest dependency keys
(`rules:`, `references:`). Their human-readable `description` lives only
in `manifest.json`. The native renderer reads file frontmatter
exclusively for `skill` and `command` entries (`descFor` in
`src/hosts/native.mjs`); duplicating descriptions into rule/reference
files would create a second source of truth with no consumer — the same
drift hazard the loader comment already records for skills and commands.

## Optional rule metadata frontmatter

`rule` files are the single exception: they may open with a `---`
fenced block of flat `key: value` lines (dotted keys address nested
fields — the same line grammar as the queries frontmatter peek, never
nested YAML) declaring activation and lifecycle metadata. The closed
key set is `category`, `status` (`active|proposed|archived`),
`origin.source`, `origin.evidenceRefs`, `activation.globs`,
`activation.stacks`, `activation.languages`, `enforcement.level`
(`advisory|strict`), `enforcement.verificationRef`, `examples.good`
and `examples.bad`, defined in `src/core/rule-meta.mjs` and exposed on
`kind=rule` resources as `meta` through `getResource` after the
integrity check. When no `status` key is declared, the file's human
`> **Status:**` header is the fallback (`Active | In review | Draft |
Deprecated` map to `active | proposed | proposed | archived`).
Files without a block get the declared defaults
(`status: active`, `origin.source: canonical`,
`enforcement.level: advisory`); a malformed block fails closed.
Bounds: scalar values ≤300 chars, comma-separated list values ≤32
items of ≤160 chars each (evidence refs ≤120), and the block must
close within the file's first 8 KiB. The block carries
machine-consumable metadata only:
no `name`, no `description` (that stays in `manifest.json`) and never
executable commands — `enforcement.verificationRef` is an id
reference into `verification.commands`, nothing more. The full
contract (activation, lifecycle, provenance, non-goals) lives in
`references/rules-format.md`.
