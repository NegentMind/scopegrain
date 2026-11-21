# Resource provenance and attestation

Per-ID attestation record for the canonical catalog
(`resources/manifest.json`). Complements and details the 2026-11-17
provenance audit (`../../provenance/evidence/2026-11-17-provenance-audit.md`)
with a body-by-body inspection of the 65 resources that reuse a legacy
identifier.

This document records verifiable evidence. It grants no licenses and does
not replace the owner's authorship attestation. Whatever could not be
verified is explicitly declared as unknown.

## 1. Scope and evidence sources

| Source | Content |
| --- | --- |
| `resources/manifest.json` | 130 entries + 32 aliases; active canonical catalog |
| `provenance/legacy-inventory.json` | 268 legacy entries with sha256, indicators and blocks; bodies not included |
| `provenance/legacy-classification.json` | Identifier triage of the 197 legacy skills |
| `provenance/legacy-source-manifest.json` | First-generation catalog (retired at `5021a5c`) |
| `provenance/retired-resources/` | 17 first-generation bodies, authored in this repository |
| Git history | No bulk-import commit; bodies introduced at `973318d`, migrated to `resources/` at `5021a5c` |
| `docs/migration.md`, `docs/component-migration.md` | Declared provenance and destination record for each component |

**Constraint honored:** the legacy bodies under `legacy/opencode/` were
not read or copied (archive blocked by policy and `.gitignore`). Every
comparison uses frozen hashes and inventory metadata, not a semantic diff
against the originals.

## 2. Classification methodology

Each resource reusing a legacy ID was classified as:

- **(a) Verbatim copy:** identical or near-identical bytes to the original.
- **(b) Adapted/derived:** body preserving the original's structure or
  wording with partial changes (includes paraphrase).
- **(c) Rewritten/fresh:** newly authored body; only the identifier and
  the resource's intent are preserved.

Signals applied, in order of strength:

1. **Hash:** sha256 of the current body against the 267 frozen hashes in
   the legacy inventory. Result: 0 matches across the 65 files.
2. **Size ratio:** bytes of the new body vs. bytes of the inventoried
   original. A paraphrase preserves magnitude; a rewrite into a compact
   procedure does not.
3. **Legacy domain terms:** search for `vanta`, `opencode`, `metasearch`,
   `argus`, `ponytail`, `ness-e`, personal paths and host names in the
   new bodies. Result: 0 matches across the 65 files (at that inspection
   only `tasksystem` appeared, as a legitimate product self-reference, in
   `backlog-format` and `task-system`; those terms were renamed to
   `scopegrain` with the product rename).
4. **New-architecture vocabulary:** the bodies describe concepts that
   postdate the legacy harness (Organic/SDD classification,
   `scenarioRefs`, expected revisions, configured harness paths,
   content-bound approvals). The legacy archive could not contain them.
5. **Git history:** every body enters through this repository's own
   commits (`973318d` first-generation catalog, `5021a5c` migration to
   `resources/`); no foreign-file import exists.
6. **Voice uniformity:** the 65 bodies share a compact imperative style
   consistent with a single rewrite pass, not with 65 heterogeneous
   originals of 660 to 52,877 bytes.
7. **Declared meaning:** the frozen inventory records each replacement as
   `fresh-portable-procedure-not-verbatim-equivalence`.
8. **Comparison against readable first-generation bodies:** the diff of
   `provenance/retired-resources/references/task-system.md` against
   `resources/references/task-system.md` shows an in-repo rewrite (new
   installation, snapshot and recovery vocabulary), not adaptation of
   the legacy original.

**Honest limit:** no mechanical signal excludes outline-level paraphrase
(same idea sequence in different words). Without reading the legacy
bodies — or without the owner's authorship attestation — the (b)
paraphrase residual cannot be closed. The *residual* column grades how
conceivable that paraphrase is given the size ratio; it does not measure
detected copying, because none was detected.

## 3. Attestation table: 65 resources with a legacy ID

Residual legend: **low** = new/original ratio <15%; **low-medium** =
15-40%; **medium** = >40% or a comparably small original. Proposed
disposition in every case: **conditional attest-as-ours** pending the
owner's authorship attestation (see §6).

### 3.1 Skills (30)

| ID | Bytes new/legacy | Original indicators | Class | Residual | Disposition |
| --- | --- | --- | --- | --- | --- |
| api-and-interface-design | 565 / 10307 | — | (c) | low | attest-as-ours* |
| api-design-principles | 538 / 13722 | — | (c) | low | attest-as-ours* |
| brainstorming | 553 / 2509 | — | (c) | low-medium | attest-as-ours* |
| ci-cd-and-automation | 571 / 11324 | machine-path | (c) | low | attest-as-ours* |
| code-review-and-quality | 650 / 23309 | project-domain, opencode-path | (c) | low | attest-as-ours* |
| code-simplification | 602 / 15097 | machine-path, external-link | (c) | low | attest-as-ours* |
| constraint-driven-development | 615 / 20880 | — | (c) | low | attest-as-ours* |
| context-engineering | 604 / 11070 | — | (c) | low | attest-as-ours* |
| debugging-and-error-recovery | 663 / 1598 | global-dependency | (c) | medium | attest-as-ours* |
| deprecation-and-migration | 603 / 14616 | project-domain, opencode-path | (c) | low | attest-as-ours* |
| discernment-nudge | 560 / 10592 | — | (c) | low | attest-as-ours* |
| documentation-and-adrs | 647 / 9791 | — | (c) | low | attest-as-ours* |
| doubt-driven-development | 568 / 16521 | — | (c) | low | attest-as-ours* |
| git-workflow-and-versioning | 630 / 14000 | — | (c) | low | attest-as-ours* |
| incremental-implementation | 603 / 11965 | project-domain, opencode-path | (c) | low | attest-as-ours* |
| observability-and-instrumentation | 571 / 11053 | — | (c) | low | attest-as-ours* |
| performance-optimization | 591 / 11593 | — | (c) | low | attest-as-ours* |
| plan-design-review | 576 / 1256 | machine-path, external-link | (c) | medium | attest-as-ours* |
| planning-and-task-breakdown | 1244 / 14007 | project-domain, opencode-path | (c) | low | attest-as-ours* |
| release-notes-one-pager | 562 / 3750 | — | (c) | low-medium | attest-as-ours* |
| review-deep | 602 / 16879 | project-domain, opencode-path, execution-api | (c) | low | attest-as-ours* |
| security-and-hardening | 643 / 18878 | machine-path, execution-api, external-link | (c) | low | attest-as-ours* |
| shipping-and-launch | 632 / 10449 | project-domain, opencode-path | (c) | low | attest-as-ours* |
| source-driven-development | 655 / 11993 | project-domain, machine-path, external-link | (c) | low | attest-as-ours* |
| spec-driven-development | 1310 / 9418 | opencode-path | (c) | low | attest-as-ours* |
| systematic-debugging | 622 / 10994 | — | (c) | low | attest-as-ours* |
| test-driven-development | 613 / 19322 | project-domain, opencode-path | (c) | low | attest-as-ours* |
| unified-review | 632 / 50444 | project-domain, opencode-path, machine-path, native-agent-format, external-link | (c) | low | attest-as-ours* |
| web-research | 631 / 3685 | — | (c) | low-medium | attest-as-ours* |
| writing-plans | 932 / 3272 | — | (c) | low-medium | attest-as-ours* |

### 3.2 Rules (13)

| ID | Bytes new/legacy | Original indicators | Class | Residual | Disposition |
| --- | --- | --- | --- | --- | --- |
| api-contract | 476 / 7266 | project-domain | (c) | low | attest-as-ours* |
| concurrency-async | 473 / 6336 | project-domain | (c) | low | attest-as-ours* |
| core-engine | 381 / 3792 | project-domain | (c) | low | attest-as-ours* |
| durability | 419 / 2246 | project-domain | (c) | low-medium | attest-as-ours* |
| frontend-web | 397 / 2337+5128 | project-domain, opencode-path | (c) | low-medium | attest-as-ours* |
| indexes | 382 / 1386 | project-domain | (c) | low-medium | attest-as-ours* |
| js-ecosystem | 353 / 3113 | project-domain | (c) | low | attest-as-ours* |
| mcp-integration | 385 / 1664 | project-domain | (c) | low-medium | attest-as-ours* |
| memory-budget | 446 / 4890 | — | (c) | low | attest-as-ours* |
| python-bindings | 375 / 1609 | project-domain | (c) | low-medium | attest-as-ours* |
| query-dsl | 375 / 2529 | — | (c) | low-medium | attest-as-ours* |
| release-ci | 399 / 4569 | project-domain, opencode-path | (c) | low | attest-as-ours* |
| server-mcp | 407 / 2405 | project-domain, machine-path | (c) | low-medium | attest-as-ours* |

Note: the `frontend-web` ID existed in the legacy archive as both a rule
and a reference (two entries); both new bodies classify as (c).

### 3.3 References (21)

| ID | Bytes new/legacy | Original indicators | Class | Residual | Disposition |
| --- | --- | --- | --- | --- | --- |
| accessibility-checklist | 354 / 5206 | — | (c) | low | attest-as-ours* |
| architecture | 386 / 1314 | project-domain, opencode-path | (c) | low-medium | attest-as-ours* |
| backlog-format | 364 / 6262 | project-domain, opencode-path | (c) | low | attest-as-ours* |
| build-system | 354 / 2495 | project-domain, opencode-path | (c) | low | attest-as-ours* |
| clean-code-clean-architecture | 436 / 52877 | project-domain, opencode-path, machine-path, external-link | (c) | low | attest-as-ours* |
| definition-of-done | 385 / 11763 | project-domain, opencode-path | (c) | low | attest-as-ours* |
| dev-tools | 367 / 5118 | project-domain, opencode-path, global-dependency | (c) | low | attest-as-ours* |
| frontend-web | 357 / 2337+5128 | project-domain, opencode-path | (c) | low-medium | attest-as-ours* |
| mcp-tools | 392 / 11910 | project-domain, opencode-path | (c) | low | attest-as-ours* |
| observability-checklist | 369 / 4931 | — | (c) | low | attest-as-ours* |
| ocr-review | 353 / 3206 | project-domain, machine-path, external-link | (c) | low | attest-as-ours* |
| orchestration-patterns | 393 / 18292 | project-domain, opencode-path, global-dependency | (c) | low | attest-as-ours* |
| performance-checklist | 367 / 7447 | machine-path, external-link | (c) | low | attest-as-ours* |
| python-sdk | 376 / 660 | project-domain, opencode-path | (c) | medium | attest-as-ours* + targeted semantic review recommended |
| research-modules | 350 / 6267 | project-domain, machine-path, external-link | (c) | low | attest-as-ours* |
| security-checklist | 368 / 7318 | machine-path, execution-api, external-link | (c) | low | attest-as-ours* |
| ship-runbook | 439 / 4056 | project-domain, opencode-path | (c) | low | attest-as-ours* |
| skills-engineering | 383 / 18438 | project-domain, opencode-path | (c) | low | attest-as-ours* |
| task-system | 1393 / 3772 | project-domain, opencode-path | (c) | medium | attest-as-ours* |
| test-suite | 366 / 1817 | project-domain, opencode-path | (c) | low-medium | attest-as-ours* |
| testing-patterns | 394 / 7094 | — | (c) | low | attest-as-ours* |

### 3.4 Profiles (1)

| ID | Bytes new/legacy | Original indicators | Class | Residual | Disposition |
| --- | --- | --- | --- | --- | --- |
| core | 551 / 214 | — | (c) | n/a — ID collision across different kinds | attest-as-ours* |

Note: the legacy `core` was an **mcp-profile** (214 B); the current one is
a **resource profile** with a new schema (`skills`/`rules`/`references`/
`activation`). Same identifier, different semantics.

\* `attest-as-ours*` = proposed disposition, conditional on the owner
attesting authorship in this repository (§6, item 2). The auditor verifies
mechanical and inspection evidence; it does not attest authorship.

## 4. Resources without a legacy ID (65)

The rest of the catalog reuses no legacy identifier. Fresh bodies with no
known provenance link:

- **Commands (17):** `plan-work`, `implement-task`, `coordinate-plan`,
  `specify-change`, `triage-work`, `report-status`, `verify-work`,
  `review-change`, `audit-project`, `audit-harness`, `investigate`,
  `compare-options`, `assess-release`, `plan-recovery`, `simplify-code`,
  `analyze-structure`, `audit-web-performance`.
- **Agents (15):** `lead`, `architect`, `implementer`,
  `algorithm-specialist`, `security-auditor`, `resilience-tester`,
  `performance-engineer`, `documentation`, `researcher`, `reviewer`,
  `harness-maintainer`, `requirements-analyst`, `verification-engineer`,
  `integration-engineer`, `release-engineer`.
- **Skills (12):** `outcome-driven-development`, `project-onboarding`,
  `contract-execution`, `independent-review`, `plan-coordination`,
  `session-handoff`, `select-capabilities`, `resolve-ambiguity`,
  `artifact-completeness`, `clarify-intent`, `review-feedback`,
  `organic-driven-development`.
- **Rules (9):** `safety`, `workflow`, `evidence`, `review`,
  `human-decisions`, `resource-integrity`, `research-escalation`,
  `methodology`, `licensing-and-provenance`.
- **References (3):** `quality-floor`, `graph-investigation`,
  `reference-maintenance`.
- **Prompts (4):** `task-brief`, `decision-request`, `review-request`,
  `recovery-brief`.
- **Profiles (4):** `web`, `rust`, `python`, `database`.
- **MCP (1):** `scopegrain`.

Classification: **(c) rewritten/fresh** for all 65, with a residual
equivalent to §3 — the same paraphrase limitation applies even without a
shared ID suggesting direct correspondence.

## 5. Aliases (32)

The 32 manifest aliases deliberately reuse legacy command, skill, rule
and reference IDs (`pipeline`, `spec`, `audit`, `progreso`,
`campaign-executor`, `floor-guard`, `understand-anything`, etc.) as a
compatibility surface resolving to the new canonical commands. They are
routing entries without a body of their own: interface surface, not
redistributable content. They require no body attestation; they do
require a conscious decision about keeping the legacy nomenclature as
public API.

## 6. What must be resolved before the package can go public

1. **License decision.** Resolved on 2026-11-20: the owner chose the
   Apache License 2.0. `LICENSE`, `NOTICE` and `AUTHORS` exist at the
   root; `package.json` declares `Apache-2.0`; SPDX headers were applied
   to every tracked `.mjs` and to `verify.yml`; `.md` and `.json` files
   are covered by `LICENSE` + `NOTICE` (frontmatter and JSON parsers
   preclude per-file headers). `private: true` is retained; publication
   remains a separate decision.
2. **Authorship attestation for the 65 reused IDs.** Closed on
   2026-11-20 by explicit owner attestation (option a): the bodies are
   the owner's own writing, not paraphrases of archived material.
   Mechanical evidence preserved: 0/267 hash matches, ~10% median size
   ratio, zero legacy domain terms, post-original architecture
   vocabulary, clean git history and the declared
   `fresh-portable-procedure-not-verbatim-equivalence` meaning. The
   sampled semantic review (option b; priority `python-sdk` 57%,
   `plan-design-review` 46%, `debugging-and-error-recovery` 41%,
   `task-system` 37%) remains available if a third party requires it.
3. **Third-party material inside `legacy/opencode/` was never audited.**
   IDs such as `gsap-*`, `figma-*`, `a11y-*`, `awesome-claude-design`
   suggest third-party skills with no recorded license. It does not block
   the current package (excluded by `.gitignore`, discovery and the
   `files` allowlist), but it is standing policy: no piece leaves the
   archive without per-piece license evidence.
4. **Keep the layered exclusion.** `legacy/`, `.tasksystem/`, `tests/`,
   `scripts/`, `provenance/` and top-level duplicates must remain outside
   the `package.json` `files` allowlist.
5. **Verify the `scopegrain` name on npm** before any publish attempt
   (unverified; `private: true` makes it moot until then).

## 7. Verdict

| Classification | IDs | Residual |
| --- | --- | --- |
| (a) Verbatim copy | 0 | — |
| (b) Adapted/derived | 0 detected; paraphrase not mechanically excludable in the 65 | open until owner attestation |
| (c) Rewritten/fresh | 130 (65 with a legacy ID + 65 without) | among the 65 with a legacy ID: low in 46, low-medium in 14, medium in 4 (`python-sdk`, `plan-design-review`, `debugging-and-error-recovery`, `task-system`), n/a in `core` |

**No positive evidence of copying or adaptation in any of the 130
resources.** The residual question — outline-level paraphrase in the 65
reused IDs — is an owner attestation or a controlled semantic review, not
a finding. This document does not attest what was not verified; it
records exactly what the mechanical evidence and the new-body inspection
support.
