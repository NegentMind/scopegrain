# Provenance and Licensing — Rules

> **Scope:** source attribution, license evidence, redistribution
> permission, open-core/commercial separation (where the project uses that
> model) and content hygiene of distributable packages.
> **Not here:** version/release mechanics (`release-ci.md`), secrets in
> runtime channels (`safety.md`), workspace membership mechanics
> (`js-ecosystem.md`).
> **Status:** Active
> **Sources:** open-core model decision record; license-model research
> (permissive core vs proprietary edition trade-offs).

These rules apply where a licensing model exists; they do not impose an
open-core model, a private edition, a registry or a package name on a
project that has none — distribution terms are an owner decision
(`→ see human-decisions.md`).

## Rules

### 1 — The open core keeps its license; commercial-exclusive features stay out

- **Must:** where the project uses an open-core model, keep the core
  package's declared permissive license and do not add features designed
  to be exclusive to a commercial edition.
- **Must not:** relicense the core, or move existing features out of it,
  without an explicit human decision.
- **Why:** in an open-core model the moat is features plus brand, not the
  license; extracting features from the core breaks adoption and
  contributor trust.

### 2 — A proprietary edition lives outside the open workspace

- **Must:** keep any commercial or proprietary package in a separate
  repository or directory that never appears in the open workspace's
  member list, default builds, packaging or publish configuration.
- **Must not:** bundle proprietary code into the open package's build,
  package or publish pipeline.
- **Why:** the open core must neither depend on nor drag proprietary code;
  a failure there cannot be allowed to block core CI or releases.

### 3 — Proprietary deliverables ship compiled, never as source — no secrets in VCS

- **Must:** deliver commercial editions as compiled artifacts through a
  private registry or a signed-artifact channel.
- **Must not:** expose proprietary source publicly or inside the open
  repository, nor embed registry credentials or license-signing secrets in
  version control.
- **Why:** a proprietary license protects revenue only while the source
  stays withheld and credentials stay out of history.

### 4 — License validation is local and enforced in every build type

- **Must:** gated features validate a license artifact (format, expiry,
  seat/node limit) before enabling — with no license server and no
  call-home.
- **Must not:** relax or skip validation in release or production builds.
- **Why:** the license declares the usage ceiling; verification that
  depends on build type is no verification at all.

### 5 — Preserve attribution and license evidence for third-party material

- **Must:** keep the source, license and attribution of any third-party
  content (code, data, documentation, generated artifacts) recorded and
  verifiable; ask the owner to decide distribution terms and review
  third-party obligations.
- **Must not:** infer permission to redistribute from local availability —
  presence in the workspace is not a license.
- **Why:** redistributing without verified terms converts a provenance gap
  into a legal liability that only surfaces after publication.

### 6 — Distributable packages carry no secrets or private history

- **Must:** audit what goes into a distributable package — secrets,
  credentials and private historical data stay out (`→ see safety.md`).
- **Must not:** copy secrets or private historical data into an artifact
  that leaves the workspace.
- **Why:** a published artifact is unrecoverable; content embedded in it is
  public forever.
