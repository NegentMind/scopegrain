<!-- translated-from: docs/distribution.md @ 2026-11-24 -->
# Declarative distribution (`dist`)

> English translation of the canonical Spanish document
> (`../distribution.md`). The Spanish version prevails.

The `dist` family is the catalog's distribution machinery: multi-source
catalog stacks, installable bundles, resource-contributing extensions
and presets that layer over served resources. Everything is
declarative — validation, composition and planning; remote content is
never downloaded or executed.

**Remote boundary closed by design:** sources are limited to `file://`
URIs. An `http(s)` URI validates its shape but is refused at load with
`REMOTE_CATALOG_UNSUPPORTED`; no inert "future remote" flags exist.
Mutations are recorded in a dedicated CAS journal and serialized under
the subsystem lock.

## Verb inventory (21)

### Declarative workflow runner

| Verb | What it does |
|---|---|
| `dist run --project PATH --input FILE [--no-resume]` | Runs a declarative workflow document with the whitelisted harness primitives (`task.transition`, `methodology.check`, `converge.*`, `analyze.task`, `checklist.*`, `noop`), closed per-op args. Atomic checkpoints under `<state>/workflow-runs/`; resumes without re-executing unless `--no-resume`. |

### Catalog composition and validation

| Verb | What it does |
|---|---|
| `dist stack --project PATH --input FILE` | Merges `file://` catalogs by priority from `{sources:[{uri,priority}]}`. |
| `dist compose --project PATH --input FILE` | Composes a base text with `{base, layers}` using the `replace`/`prepend`/`append`/`wrap`/`replace-section` ops. |
| `dist validate --project PATH --input FILE` | Validates a catalog submission: slug `id`, semver `version`, `source.uri`, mandatory `sha256` on remote sources. |
| `dist bundle-validate --project PATH --input FILE` | Validates a bundle document: `requires` with pins and missing-entry detection. |

### Bundles (install, mount, uninstall)

| Verb | What it does |
|---|---|
| `dist bundle-install --project PATH --input FILE [--apply]` | Preview by default; with `--apply` copies the required `file://` sources under `<configDir>/bundles/<id>/` (256-file / 16 MiB cap, create-only, idempotent, content-addressed provenance with per-pin sha256 verification). |
| `dist bundle-mount --project PATH ID` | Mounts an installed bundle into the workspace catalog. |
| `dist bundle-unmount --project PATH ID` | Unmounts a bundle from the catalog. |
| `dist bundle-uninstall --project PATH ID [--keep-files]` | Removes the installed bundle; `--keep-files` keeps the copied files. Direct journaled mutation (no preview). |
| `dist mounted-list --project PATH` | Lists the active mounted entries. |

### Extensions

| Verb | What it does |
|---|---|
| `dist extension-register --project PATH --input FILE` | Create-only registration: `id`, semver `version`, `source`, `lifecycle` (`onInstall`/`onActivate`/`onRemove`) and `contributes` in `<kind>/<id>` form. |
| `dist extension-list --project PATH` | Lists the extension registry. |
| `dist extension-activate --project PATH ID` / `dist extension-deactivate --project PATH ID` | `registered -> active <-> disabled` lifecycle; activation validates `contributes` against the workspace catalog. Active extensions contribute their declared resources into workflow packets. |
| `dist extension-remove --project PATH ID` | Removes an extension; it must be `disabled` first. Direct journaled mutation. |

### Presets

| Verb | What it does |
|---|---|
| `dist preset-register --project PATH --input FILE` | Create-only registration of a preset `{id, priority, overrides:[]}`; each override carries a `target` (`*`, `<kind>/*` or `<kind>/<id>`) and an `op`. |
| `dist preset-list --project PATH` | Lists registered presets. |
| `dist preset-remove --project PATH ID` | Removes a preset. Direct journaled mutation. |

### Maintenance and trail

| Verb | What it does |
|---|---|
| `dist selftest --project PATH` | Subsystem self-check. |
| `dist journal --project PATH [--tail N] [--registry R] [--op O] [--id I]` | Reads the CAS mutation trail (bundle/extension/preset) with optional filters. |
| `dist pack --project PATH --source DIR --out FILE` | Packs a directory into a deterministic bundle file. |

## How presets are consumed

A preset's overrides apply when catalog resources are served inside
workflow packets (`workflow` and the catalog aliases such as
`pipeline`/`status`): `buildWorkflowPacket` selects the layers of
registered presets matching `target` in ascending `priority` order (the
highest priority applies last), composes the resource text with
`composeResource` and leaves an auditable trace on
`packet.presets.applied` (or on the deferred list when the packet is
lazy). `dist compose` lets you test the composition over any base text
without writing anything.

Layer ops: `replace` (substitutes the whole text), `prepend`, `append`,
`wrap` (mandatory `{{BODY}}`) and `replace-section` (replaces the body
under the Markdown heading whose lowercase anchor matches `selector`;
no match leaves the text unchanged).

## Guide to `examples/preset-yagni.json`

`examples/preset-yagni.json` is a ready-to-register preset: the portable
YAGNI ladder and concise execution discipline, the host-agnostic
equivalent of the legacy "ponytail mode". Its content:

```json
{
  "id": "yagni-concise",
  "version": "1.0.0",
  "priority": 10,
  "description": "Portable YAGNI ladder and concise execution preset (host-agnostic equivalent of legacy ponytail mode).",
  "overrides": [
    {
      "target": "command/*",
      "op": "append",
      "content": "\n\n## Concise / YAGNI discipline (preset: yagni-concise)\n\nPrefer the smallest verified change that satisfies the stated contract:\nreuse existing abstractions > stdlib > installed dependencies > minimal new code.\nAvoid speculative generality, unnecessary wrappers and unrelated edits.\n"
    }
  ]
}
```

- `target: "command/*"` applies the override to every catalog command;
  `op: "append"` appends the YAGNI discipline to the body.
- `priority: 10` orders the layer against other presets (lower = earlier).

Register it and check it:

```powershell
node .\bin\scopegrain.mjs dist preset-register --project . --input examples/preset-yagni.json
node .\bin\scopegrain.mjs dist preset-list --project .
```

```bash
node ./bin/scopegrain.mjs dist preset-register --project . --input examples/preset-yagni.json
node ./bin/scopegrain.mjs dist preset-list --project .
```

Effect: when a workflow packet is built, every served command carries
the appended "Concise / YAGNI discipline" section, and the packet
declares the override on `packet.presets.applied`. To remove it:

```powershell
node .\bin\scopegrain.mjs dist preset-remove --project . yagni-concise
```

Extension and preset registries live under the project's config
directory; mutations go through the `dist` CAS journal, queryable with
`dist journal`.

## Related documents

- [release-runbook.md](release-runbook.md) — npm package release
  process (distinct from the `dist` subsystem, which moves catalogs
  between projects).
- [skills-distribution-eval.md](skills-distribution-eval.md) —
  evaluation of distributing `resources/skills/` through the Agent
  Skills ecosystem (`npx skills add`), an alternative channel to
  per-host projection.
