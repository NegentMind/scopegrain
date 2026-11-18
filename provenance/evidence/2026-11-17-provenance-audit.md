# Provenance audit — distribution readiness (block H)

- **Date:** 2026-11-17
- **Scope:** every resource that a distribution package could carry, plus the
  support material whose status decides whether redistribution is lawful.
- **Method:** local, mechanical, no execution. Legacy bodies were **not**
  opened, read, or copied (`legacy/opencode/` is out of circuit by policy and
  by `.gitignore`). Classification uses the repository's own frozen catalog
  metadata (`provenance/legacy-inventory.json`,
  `provenance/legacy-classification.json`,
  `provenance/legacy-source-manifest.json`), Git history (33 commits, all
  authored in this repository), sha256 cross-checks, and indicator greps.
- **Constraint honored:** this audit classifies; it never imports. No verdict
  below is a semantic license review of legacy bodies — such a review was
  explicitly out of scope.

## 1. Evidence base

| Evidence | Result |
| --- | --- |
| Git history | 33 commits, first `5dc2f87 feat: initialize project-neutral TaskSystem harness`; all content areas introduced by in-repo commits (`5dc2f87`, `973318d`, `5021a5c`, and later). No bulk-import commit of foreign files. |
| Manifest integrity | `resources/manifest.json`: 130 entries, 32 aliases; **0 declared paths missing on disk, 0 undeclared files** under `resources/` (131 files = 130 entries + manifest). |
| Verbatim-copy check | sha256 of **all 255** shippable/support files (`src/ bin/ policy/ resources/ schemas/ templates/ docs/ examples/ scripts/ provenance/ skills/` + root files) compared against the **267** frozen legacy hashes in `legacy-inventory.json`: **0 matches**. |
| Legacy inventory status | 268 entries (11 agents, 13 commands, 3 mcp-profiles, 1 plugin, 24 references, 14 rules, 197 skills, 5 workflows) + 1 resource-only dir. Every entry: `originalActivation: blocked`, `redistribution: unreviewed`, `licenseEvidence.frontmatterDeclaration: false`, `licenseEvidence.adjacentFiles: []`. Bodies not included in inventory (`sourceBodiesIncluded: false`). |
| Legacy containment | `legacy/opencode/` is gitignored (`git ls-files legacy` = 2 tracked: `README.md`, `provenance/copied-git-pointer.txt`); discovery excludes `legacy`; `legacy/README.md` states it is not distributed pending license/secrets review. |
| Declared provenance | `docs/migration.md` ("ningun recurso original se activa por copia ni por sustitucion masiva de nombres"; "fuentes nuevas"); `docs/component-migration.md` ("procedimientos nuevos, no importacion masiva"; replacements are `fresh-portable-procedure-not-verbatim-equivalence`, i.e. intent preserved, bodies new). |
| Indicator grep on fresh resources | `.opencode` strings appear only as **host-target configuration** in `policy/native-adapters.json` (OpenCode host paths) and as **reserved prefixes** in `src/core/paths.mjs`/`src/hosts/native.mjs`; `vantadb` matches only the declared `src/integrations/vantadb.mjs` feature and its policy file. No personal paths, no legacy doc fragments. |
| ID overlap (same identifier, different file) | 65 of 130 fresh entries reuse a legacy ID (30/42 skills, 21/24 references, 13/22 rules, 1/5 profiles, 0 commands, 0 agents). All 32 manifest aliases intentionally reuse legacy IDs — they are compatibility aliases by design. |

## 2. Classification by area

`origin` values: `fresh` (authored in-repo; no verbatim legacy match),
`derived-from-legacy` (body or structure traces to legacy content),
`unknown` (insufficient evidence).

### 2.1 Shippable surface (the `files` allowlist added to `package.json`)

| Area | Files | Origin | License evidence | Action needed |
| --- | --- | --- | --- | --- |
| `bin/` | 2 | fresh | in-repo authorship (init commit); delegates to `src/cli.mjs` | none |
| `src/` | 44 tracked (+2 untracked, see §2.4) | fresh | in-repo authorship across 30+ commits; no hash match; `vantadb`/`opencode` strings are product features/reserved prefixes, not copied text | none |
| `policy/` | 8 | fresh | in-repo authorship; `.opencode/*` values are declared host-target paths for the OpenCode adapter, not imported bodies | none |
| `resources/` (catalog) | 131 | fresh bodies, **derived intent** | declared `fresh-portable-procedure-not-verbatim-equivalence` in `legacy-inventory.json`; 0/255 hash matches; **65 entries reuse legacy IDs** (by kind: skills 30, references 21, rules 13, profiles 1) | residual: paraphrase-level derivation cannot be excluded mechanically; owner attestation or sampled semantic spot-review recommended before a *public* license change (see §4) |
| `schemas/` | 12 | fresh | in-repo authorship; contracts documented in `docs/architecture.md` | none |
| `templates/` | 9 | fresh | in-repo authorship; `templates/skills/{contract-execution,independent-review,project-onboarding}/` are **empty directories** — stale skeleton, harmless | optional cleanup of empty dirs |
| `docs/` | 18 (+`docs/en/` new) | fresh | in-repo authorship; Spanish canonical; `docs/component-migration.md` and `docs/migration.md` are themselves the provenance record | none |
| `examples/` | 1 | fresh | in-repo authorship; schema-validated by tests | none |
| `README.md` (+`README.en.md` new) | 2 | fresh | in-repo authorship | none |
| `package.json` | 1 | fresh | in-repo authorship | renamed to `scopegrain`; `private:true`/`UNLICENSED` kept per owner decision |
| `LICENSE*` | 0 | — | **no LICENSE file exists** — deliberate pending this audit | license decision remains open (out of this block's scope) |

### 2.2 Tracked but NOT shipped (excluded by the `files` allowlist)

| Area | Files on disk | Origin | License evidence | Action needed |
| --- | --- | --- | --- | --- |
| `tests/` | ~70 | fresh | in-repo authorship; test fixtures do not quote legacy bodies | none |
| `scripts/` | 2 | fresh | provenance tooling (`inventory-legacy.mjs`, `classify-legacy.mjs`); **note:** they still reference the pre-rename `catalog/` path — cosmetic debt, not a blocker | optional path update |
| `provenance/` (frozen evidence) | 20 | metadata fresh; `retired-resources/` bodies = first-generation catalog | `retired-resources/` holds the *previous* portable catalog (17 files) retired at `5021a5c`; its command IDs mirrored the legacy command set (intent-derived, bodies written in-repo at `973318d`); frozen evidence, never an active source | keep frozen; do not ship |
| `.github/` | 1 | fresh | `verify.yml` authored at `3adb693`; manual-only, never executed remotely | disclaimer comment added in this block |
| `skills/` (top level) | 3 files + 37 empty dirs | fresh, **stale duplicates** | the 3 `SKILL.md` are **byte-identical** (sha256 verified) to `resources/skills/*/SKILL.md` and `provenance/retired-resources/templates/skills/*/SKILL.md`; leftover from the pre-`resources/` layout | recommend removal (empty dirs + 3 dupes); excluded from package regardless |
| `agents/ commands/ profiles/ references/ rules/` (top level) | 0 (empty dirs) | — | empty leftovers of the first-generation layout at `973318d`, emptied by `5021a5c` | recommend removal; excluded from package |
| `docs/dev/` | 0 (empty dir) | — | empty | recommend removal |
| `AGENTS.md`, `CLAUDE.md`, `.gitignore` | 3 | fresh | in-repo authorship | none |

### 2.4 Concurrent-work caveat observed during audit

`src/api/` (`queries.mjs`, `server.mjs`) exists on disk but was **untracked in
git** at audit time (`?? src/api/`) — concurrent in-progress work by another
workstream, not legacy material. Because the npm `files` allowlist packs the
working tree (not the git index), the dry-run tarball included both files.
This is not a forbidden-path leak; it is a reminder that `npm pack` must be
re-run after concurrent work is committed, and that publishing while
uncommitted sibling work exists would ship unreviewed bytes.

### 2.3 Not tracked / never shipped

| Item | Status |
| --- | --- |
| `legacy/opencode/` | Untracked (gitignored), original archive, activation blocked, redistribution unreviewed. **Hard exclusion** — must never enter a package or a public repo. |
| `.tasksystem/` | Untracked (gitignored), operational notes incl. this audit and the design-preview PNG comps. |
| `node_modules/` | Untracked, installed deps (`@modelcontextprotocol/sdk`, `zod` — declared deps; their licenses apply only to the deps themselves, not to this code). |
| `nul` (repo root, 45 B) | **Untracked stray artifact** created 2026-11-17 ~08:02, almost certainly a literal file produced by a `> nul` redirect under Git Bash. Harmless to packaging (outside allowlist) but is a Windows-reserved name that breaks naive tooling; recommend deleting via `rm ./nul` in Git Bash or `\\?\` path. |
| `viewer/` | Does not exist; nothing to leak. |

## 3. License-evidence summary

- **Fresh surface:** the only explicit license signal is `package.json`
  `"license": "UNLICENSED"` + `private: true`, confirmed by README §"Codigo y
  licencia" ("source availability does not grant an open-source or
  redistribution license"). There is **no LICENSE file** and no per-file
  license headers. This is the owner's deliberate state, not an oversight.
- **Legacy archive:** `licenseEvidence` is uniformly empty across all 268
  inventoried entries; `redistribution: unreviewed` everywhere. Several
  inventoried IDs (`gsap-*`, `figma-*`, `a11y-*`, `emil-*`, `brandkit`,
  `awesome-claude-design`, `frontend-design`, …) strongly suggest the legacy
  skills directory aggregates **third-party/public skill material** whose
  upstream licenses were never recorded. Until each piece is reviewed,
  `legacy/opencode/` stays blocked — which is already enforced by
  `.gitignore`, discovery exclusions, and the package allowlist.
- **Derived intent vs derived body:** the fresh catalog preserves legacy
  *intent* (command aliases `pipeline/spec/audit/...`, role mapping
  `vanta-lead → lead`, and 65 reused IDs). Intent/ID mapping and
  compatibility aliases are interface surface, not verbatim content; all
  shipped bodies pass the zero-verbatim-hash check and are declared new
  authorship. However, **a hash check cannot prove a body is not a
  paraphrase** of the legacy file it replaces — the inventory itself warns
  its basis is `identifier-triage-not-semantic-audit`.

## 4. What blocks redistribution (and what does not)

**Does NOT block** (mechanically verified):
- Shipping `bin/ src/ policy/ resources/ schemas/ templates/ docs/ examples/
  README*.md package.json` — every file is in-repo authored with zero verbatim
  legacy overlap, and `private:true` prevents accidental `npm publish`.
- `legacy/`, `.tasksystem/`, `tests/`, `scripts/`, `provenance/`, `.github/`,
  stray `skills/` duplicates and empty dirs — all excluded by the `files`
  allowlist; `legacy/opencode/` additionally excluded by `.gitignore`.

**Blocks / gates a *public* redistribution decision** (owner decision pending):
1. **No license.** UNLICENSED = all rights reserved; that is a valid posture
   for private/source-available use but is itself the answer "do not
   redistribute yet." Choosing a license is a separate owner decision.
2. **Paraphrase-level provenance of the 65 same-ID resources is
   unattested.** Evidence today: declared new authorship + zero byte overlap
   + fresh bodies reviewed in-repo. Residual risk is concentrated in the 30
   skills / 21 references / 13 rules / 1 profile that reuse legacy IDs.
   Recommendation before a public license: either (a) owner attests
   authorship of those bodies, or (b) a sampled semantic review compares
   them against the frozen legacy bodies (requires lifting the no-read
   constraint under controlled scope).
3. **Third-party material inside `legacy/opencode/` was never
   license-audited.** It cannot ship today (excluded everywhere), so this
   blocks only any *future* incorporation of archived pieces — not the
   current package. Record as standing policy: no piece leaves the archive
   without per-piece license evidence.
4. **Name availability `scopegrain` on npm unverified** (would require a
   registry query; out of the local-only scope of this audit). Verify before
   any publish attempt; `private:true` makes this moot until then.

**Hygiene debt (not redistribution blockers):** `nul` stray file; top-level
`skills/` duplicates + 5 empty resource dirs + `docs/dev/` + `templates/skills/`
skeleton; `scripts/*` still referencing `catalog/` (renamed to `provenance/`
at `5021a5c`).

## 5. Verdict

> **Mechanically clean to package privately.** Everything inside the
> distribution allowlist traces to in-repo authorship with zero verbatim
> legacy copies; the unreviewed legacy archive is excluded at every layer
> (git, discovery, package). **Not yet clean to license publicly:** the
> residual question is paraphrase-level derivation in the 65 same-ID
> resources plus the absence of a license decision — both are owner calls
> this audit intentionally does not make.
