# Bounded semantic investigation

> English version of the canonical document (`../semantic-discovery.md`).

`src/discovery/semantic.mjs` extends manifest discovery with a
read-only semantic layer. It does not write, does not execute, does
not use the network and does not modify the project. Every detection
comes from permitted evidence; the undetermined is reported as
explicit unknown and stacks, frameworks or commands are never
invented.

## API

```text
investigateProject(projectRoot, {config?})   -> typed investigation
suggestAnswers(investigation)                -> init proposals
diffInvestigation(config, investigation)     -> stale decisions
buildResearchRecord(investigation, {timestamp?})
                                             -> {record, suggestedPath}
validateResearchRecord(record)               -> record or RESEARCH_INVALID_RECORD
```

Command distinction: `inspect` is the bounded manifest snapshot that
`init` persists as `discovery.json` (stacks, proposed commands,
fingerprint, warnings — nothing else). `investigate` runs this full
semantic layer — topology, platforms, tests, hosts, i18n — and also
prints the `suggestAnswers` proposals; `--save` persists the research
record. `init --defaults` consumes `suggestAnswers` as its
non-interactive answer source.

### investigateProject

Composes `inspectProject` (it does not reimplement it) and adds
signals:

- **Topology:** `monorepo` (`workspaces` fields, turbo/nx/lerna/
  pnpm-workspace/rush, Cargo `[workspace]`, `settings.gradle`, or
  manifests in two or more directories), `single-package`,
  `unstructured` (layout without manifest) or `empty`.
- **Extra stacks** (`detectedBy:'semantic'`): `dart`/`flutter`
  (pubspec.yaml), `gradle`, `swift`, `python` via requirements.txt/
  setup.py. `inspectProject`'s keep `detectedBy:'manifest'`.
- **Platforms:** `mobile` (android/, ios/), `desktop` (src-tauri/,
  tauri.conf.json, electron-builder, electron/tauri dependencies),
  `web` (web configs and dependencies), `cli` (package.json bin,
  Cargo `[[bin]]`, src/main.rs with rust stack).
- **Tests:** frameworks by permitted configuration (vitest, jest,
  playwright, cypress, karma, mocha, pytest, phpunit, cargo-nextest) or
  by declared dependencies; `cargo-test`, `go-test`, `dotnet-test`,
  `xunit`, `nunit`, `mstest`, `flutter_test` per manifest.
- **Docs:** instruction files (AGENTS.md, CLAUDE.md, README variants)
  by existence and docs/ or doc/ directories.
- **CI:** `.github/workflows` listed only by `*.yml`/`*.yaml` names
  (<=64 entries, no content); other providers by existence (GitLab,
  Azure, Jenkins, Travis, CircleCI, Bitbucket, Woodpecker).
- **Hosts:** existence signals (.claude/, .codex/, .opencode/,
  .devin/, .antigravity/, .agents/, .agent/, opencode.json, CLAUDE.md,
  AGENTS.md, GEMINI.md). A
  directory signal never lists its content.
- **i18n:** locales/i18n/l10n directories, i18next.config.* and
  internationalization dependencies.

With `{config}` it additionally probes the existence of the seven
configured artifact paths (`harness.artifactDirs`); the config is
never mutated nor are limits weakened. Options are closed objects:
unknown keys produce `INVESTIGATION_INVALID_OPTIONS` and a non-object
config `INVESTIGATION_INVALID_CONFIG`.

### suggestAnswers

Each proposal is `{value, confidence:'detected'|'default', evidence:[]}`:

| Field | Detected basis | Fallback |
| --- | --- | --- |
| `name` | root manifest `name` | directory basename (`default`) |
| `hosts` | existing host signals | `[]` + `unanswered` |
| `paths` (7) | — | `policy/onboarding-defaults.json` proposals (`default`) |
| `verification` | commands already proposed by inspectProject, `approved:false` | `manual` + `[]` |
| `versioning` | — | the eight categories at `false` |

Only hosts with a detected signal are suggested and only commands that
`inspectProject` already extracted from manifest-declared scripts.
`unanswered` lists fields without a detected basis (today only
`hosts`).

### diffInvestigation

Pure, read-only comparison between a persisted config and a fresh
investigation. The config is cloned before validating it (frozen
inputs are not mutated). It reports:

- expected vs current `fingerprint`; `manifests.added/removed/retained`
  and `lockfiles.added/removed` by stored evidence.
- `contentIndeterminate:true` when the manifest set is identical but
  the fingerprint differs: the stored evidence cannot name the file
  that changed (honest, it does not guess).
- `stacks`, `commands` (persisted vs proposed) and `hosts.newSignals`
  (host signals not configured).
- `staleDecisions`: persisted decisions potentially obsolete.

### Investigation record

`buildResearchRecord` returns `{record, suggestedPath}` where
`suggestedPath` is the `semantic-<fingerprint16>.json` segment to be
saved under `paths.research`. The record is plain JSON:

```json
{
  "schemaVersion": 1,
  "fingerprint": "<sha256>",
  "stacks": [],
  "topology": {},
  "evidence": [],
  "suggestions": {},
  "unknowns": [],
  "timestamp": "<optional, only if the caller provides it>"
}
```

Without `timestamp` the output is deterministic. Writing the file does
not belong to this layer. `validateResearchRecord` enforces the closed
shape (exact keys, sha256 fingerprint, topology/evidence enums,
well-formed proposals) and throws `RESEARCH_INVALID_RECORD`.

## Extended limits relative to inspectProject

There is no second tree traversal. The new work is:

- ~90 fixed `lstat` probes (existence; a link counts as absent),
- at most one bounded listing of `.github/workflows` (64 names),
- bounded rereads (<=128 KiB) of permitted manifest names already
  discovered by the scanner or by the probe list.

Read contents are limited to package.json, Cargo.toml, pyproject.toml,
pubspec.yaml and *.csproj. Because reads are allowlist-based and not
denylist-based, `.env*`, `*.pem`, `*.key`, `credentials*`, `.npmrc`,
`.ssh/*` and the like are unreachable. Host directories are detected
by existence; their content is never listed.

## Errors

`INVESTIGATION_INVALID_OPTIONS`, `INVESTIGATION_INVALID_CONFIG`,
`INVESTIGATION_INVALID_INPUT` (malformed arguments in pure functions),
`RESEARCH_INVALID_RECORD`. Root/project errors (`INVALID_PROJECT`,
`PROJECT_NOT_FOUND`, `SYMLINK_REJECTED`, ...) propagate unwrapped from
`resolveProjectRoot`/`inspectProject`.

## What it does not do

It does not claim to understand the project: it remains signal
detection. It does not write the record, does not fill `answers.json`
or run `init`, does not approve commands (all `approved:false`), does
not choose methodology or language, and does not replace owner
confirmation. Proposals are starting points for the owner to confirm
only.
