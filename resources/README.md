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
| `rule` | `rules/*.md` | Flat Markdown, **no frontmatter** |
| `reference` | `references/*.md` | Flat Markdown, **no frontmatter** |
| `mcp` | `mcps/*.json` | JSON descriptor (`schemaVersion`, `id`, transport) |
| `profile` | `profiles/*.json` | JSON descriptor (`schemaVersion`, `id`, dependency lists) |

## Why rules and references carry no frontmatter

Flat format is deliberate, not an omission. Rules and references are
never individually selectable host units: they are bundled as body text
into commands, skills and agents through the manifest dependency keys
(`rules:`, `references:`). Their human-readable `description` lives only
in `manifest.json`. The native renderer reads file frontmatter
exclusively for `skill` and `command` entries (`descFor` in
`src/hosts/native.mjs`); duplicating descriptions into rule/reference
files would create a second source of truth with no consumer — the same
drift hazard the loader comment already records for skills and commands.
