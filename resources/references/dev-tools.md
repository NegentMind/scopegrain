# Optional Development Tools

Inventory tools by actual availability, supported version, required
permissions and scope. Absence is not permission to install.
Prefer existing project commands and the smallest adequate tool.
A generated integration proposal does not prove a service is configured,
reachable or authorized. Report fallbacks and capability limitations.

This is the structure for a project's dev-tooling inventory. The concrete
tool list is the owner's documentation — record these *categories* and the
fields below, verified against the machine, not assumed.

## Inventory record format

| Field | What to record |
|---|---|
| Tool | Name and install method |
| Installed | ✅/❌ — verified on the machine, not assumed |
| Command | The exact invocation used in this project |
| Purpose | One line: what problem it removes |
| Scope | Global, project-local, or CI-only |

## Categories worth inventorying

### Fast feedback loop
- File-watcher + check/test runners (`watch`-style tools): sub-second
  re-verification on each save.
- A task runner file at the repo root (Justfile/Makefile/Taskfile) that
  names the canonical commands. Read it before proposing alternatives.
  Record: quick check · full verify · watch loop · fmt-fix · lint ·
  unused-dependency scan · binary-size audit · outdated-deps ·
  security audit · changelog generation · CI-order replicate ·
  heavy certification · release build · run entrypoints.

### Dependency and supply-chain hygiene
- Unused-dependency detectors, outdated-dependency reports,
  advisory/vulnerability scanners, license/deny checkers.
- Automated dependency-PR bot config: ecosystems covered, schedule,
  PR limits, grouping rules.

### Binary/artifact inspection
- Size profilers, build-timing reporters, artifact diffing.

### Release automation
- Version-bump + changelog + tag + publish automation (e.g. a
  release-plz-class tool): where its config lives, what it bumps
  (conventional-commit-driven semver), what it publishes and in what order.
- Changelog generators driven by commit conventions.

### Editor/IDE setup
- `.vscode/` (or equivalent): recommended extensions, formatter-on-save,
  analyzer settings matching the project's feature flags, task
  definitions that mirror the task runner, assistant/tooling config.

### Git aliases and ergonomics
- Record globally configured aliases only if the project relies on them;
  otherwise treat as personal preference, not project contract.

### CI acceleration
- Compiler caches / object caches in CI (sccache-class, dependency-layer
  caches): which backend they use and how they're wired (env vars written
  per-step because composite actions can't take `env` at the top level —
  that kind of wiring detail is exactly what belongs here).

## Recommended daily flow (template)

```bash
# Iterative development — terminal 1
<task-runner> watch                 # instant feedback loop

# Before commit
<task-runner> verify                # fmt + lint + scoped tests + audit

# Commit
git add -p && git commit -m "feat: ..."

# Release — only via the project's release automation
<release-tool> release              # bump + changelog + tag + publish
```

## Verification rules

- [ ] "Installed" was verified (binary on PATH / version reported), never
      inferred from documentation.
- [ ] Every command in this reference was read from the project's task
      runner or CI config.
- [ ] For each tool, the fallback is stated (what to run when the tool is
      absent — usually the language's native equivalent).

<!-- Referencias cruzadas: → ver build-system.md, test-suite.md, ship-runbook.md, quality-floor.md -->
