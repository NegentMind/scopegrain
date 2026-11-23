# Delivery and CI — Rules

> **Scope:** release procedure: build configuration, CI acceleration,
> packaging manifests, version synchronization, soft-fail policy and the
> gate chain from acceptance to publication.
> **Not here:** documented-version mechanics inside API docs
> (`api-contract.md` cross-references here as canonical), general
> authorization boundaries (`safety.md`), license/distribution models
> (`licensing-and-provenance.md`).
> **Status:** Active
> **Sources:** CI/release audits (toolchain pin drift, moved manifests
> breaking image builds, untagged soft-fail inventory, documented
> acceleration that did not exist); release-workflow policy.

Read this project's release procedure and supported environment matrix
before changing delivery configuration.

## Rules

### 1 — Production builds use the documented per-platform build options

- **Must:** release artifacts build with the platform-tuned options the
  project documents (e.g., a custom allocator or target-specific
  optimizations), selected per platform.
- **Must not:** ship release binaries with default configuration where a
  documented platform option exists; do not enable an option on a
  platform it cannot compile for.
- **Why:** for memory-intensive workloads the platform default causes
  heap fragmentation and contention; tuned options exist because
  measurement justified them — shipping defaults throws that work away.

### 2 — Shared CI acceleration lives in one shared setup step

- **Must:** keep build-cache and tool-install acceleration in a single
  shared setup or composite action consumed by all jobs; every CI
  capability documented must actually exist in the workflows.
- **Must not:** duplicate acceleration steps per workflow, reinstall
  tools from source where a fast install action exists, or document CI
  acceleration that is not implemented.
- **Why:** a single point benefits every job; documentation claiming a
  capability that does not exist has already cost real debugging time.

### 3 — Packaging manifests: toolchain ≥ declared minimum, copied paths must exist

- **Must:** the build toolchain version in container and packaging
  manifests is at least the project's declared minimum toolchain version,
  and every copied manifest path points to a directory that exists in the
  repo.
- **Must not:** pin a toolchain below the declared minimum, or copy
  manifests for components that were moved, renamed or never existed.
- **Why:** a single stale pin or moved directory breaks the entire image
  build; any new component whose manifest is copied must exist first.

### 4 — Version sync: docs, packaging and workflows take the canonical version

- **Must:** API docs, package manifests and release workflows declare the
  same version as the project's canonical version source — this rule is
  the canonical home; `api-contract.md` points here.
- **Must not:** hardcode divergent versions across the docset or
  packaging files.
- **Why:** audits have found three different versions inside one docset
  plus a fourth in packaging; mechanical bumps always leave literals
  behind.

### 5 — No soft-fail in CI without a category tag and justification

- **Must:** every continue-on-error or equivalent soft-fail step carries
  an explicit category comment (experimental / best-effort /
  non-critical / informational) per the project's CI policy.
- **Must not:** add a new soft-fail without justification, a category
  tag, and — for flaky tests — a tracked issue.
- **Why:** untagged soft-fail hides real regressions; the classified
  inventory is the only thing keeping existing instances honest.

### 6 — Acceptance, commit, push, merge and publication are distinct gates

- **Must:** treat acceptance, local commit, push, merge and publication
  as separate authorization points — passing one never implies the next
  (`→ see safety.md`).
- **Must not:** chain into pushing or publishing because committing was
  allowed.
- **Why:** each gate has a different blast radius; a local commit is
  reversible, a push is visible, a publication is effectively permanent.

### 7 — No implicit changes to tags, versions, changelogs, registries or CI tooling

- **Must:** change release surface elements — tags, version fields,
  changelogs, registry targets, CI tooling — only through explicit,
  declared changes.
- **Must not:** modify them as a side effect of other work.
- **Why:** release surface changes alter what ships and how it is
  attributed; implicit edits bypass every release gate.

### 8 — Confirm credentials and authority for each action without exposing secrets

- **Must:** verify that credentials exist and that the specific action is
  authorized before a publish or registry operation — referencing secret
  variables by name only (`→ see safety.md`).
- **Must not:** display, echo or log credential values, or assume a
  credential's presence implies permission for every action.
- **Why:** a presence check proves the variable exists, not that it
  authorizes this publish; an exposed value is compromised permanently.

### 9 — A release requires a feasible recovery plan; unverified effects are reported

- **Must:** have a feasible rollback or recovery path before publishing,
  and report deployment effects that could not be verified rather than
  assuming success (`→ see evidence.md`).
- **Must not:** declare a release verified when its post-publish effects
  were never observed.
- **Why:** publication failures are discovered by consumers; without a
  recovery path the only fix is a second emergency release.
