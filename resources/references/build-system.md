# Build Discovery

Manifests and lockfile presence are evidence of stack and package manager.
They are not permission to execute scripts or install dependencies.
Unknown or conflicting signals require explicit resolution.
Inspect actual scripts and CI configuration before proposing a command.
Do not invent a test command for a detected non-Node stack.

This is the structure to fill in for a repository's build contract. Record
what is pinned, what each profile is *for*, and the platform workarounds
that already exist — do not invent new ones.

## What to record

### Toolchain

- [ ] Pinned toolchain/version files (`rust-toolchain.toml`, `.nvmrc`,
      `.python-version`, `mise.toml`, …) — the pin wins over a CI step that
      names a different channel.
- [ ] Package manager and lockfile (`Cargo.lock`, `package-lock.json`,
      `pnpm-lock.yaml`, `uv.lock`, …); whether the lockfile is committed.
- [ ] Minimum supported versions the project declares for consumers.

### Build/test profiles

Record each profile's name, settings, and *intended use* — not only the
command:

| Profile | Typical settings | Intended use |
|---|---|---|
| dev | fast iteration (low opt, no/limited debug info) | local edit loop |
| test | matching dev, plus test harness defaults | `test`-runner profile |
| ci | no LTO, moderate opt, parallel codegen | fast CI gate |
| release | thin/fat LTO, high opt, single codegen unit | shipped artifacts |
| audit/certify | whatever the pre-merge/certification profile is | deliberate full validation |

### Platform workarounds already in force

Every workaround must be discoverable and justified. Examples of the kind
to record:

- Parallelism caps required by RAM or OS limits (`--build-jobs 2`,
  `jobs = 2` in toolchain config) — note the *reason*.
- Forced linker/toolchain overrides in toolchain config files — note what
  the default tool did wrong (e.g. crash class) before replacing it.
- CI steps that pin an env var to disambiguate two competing toolchain
  definitions (channel flag vs. toolchain file).
- Feature unification hazards: an implicit "default members" build can
  unify features in a shared target dir and hang or collide — record which
  commands must stay scope-pinned.

### Fast-iteration strategies (workflow, no code change)

| Strategy | Why it is faster |
|---|---|
| Scope to the touched package(s) (`-p`, path filters) | Skips the rest of the workspace |
| Reduce features (`--no-default-features -F "…"`) | Excludes heavy optional deps |
| Use the native check/lint profile | Already minimal opt/debug settings |
| Ask the build for timings (`--timings`, build scan) | Shows exactly where time goes |
| Exclude known-slow leaf packages from workspace-wide runs | Adapters/wrappers rarely change |

Prioritize the scope flag: it usually dominates every other optimization.

### Default and optional features

- [ ] Record the default feature set and the *reason* heavy features are
      opt-in.
- [ ] Record features that gate whole subsystems (HTTP server, FFI bindings,
      remote integrations, instrumentation, test-only hooks such as
      `failpoints`) — tests and binaries that require them must name them.

## Verification

- [ ] Every command you propose exists in the project's scripts/CI and was
      read, not assumed.
- [ ] Scoped iteration commands and deliberate full-workspace commands are
      labeled as such; the full suite is never the iteration default.
- [ ] Platform-specific workarounds carry a stated cause, or are flagged
      as undocumented and untrusted.

<!-- Cross-references: → see test-suite.md, dev-tools.md, definition-of-done.md -->
