<!-- translated-from: docs/skills-distribution-eval.md @ 2026-11-24 -->
# Evaluation: distributing the skills catalog via skills.sh / `npx skills add`

> English translation of the canonical Spanish document
> (`../skills-distribution-eval.md`). The Spanish version prevails.

> Evaluation from the 2026-11-24 audit. Goal: decide whether publishing
> `resources/skills/` as a package consumable by the Agent Skills
> ecosystem (skills.sh, `vercel-labs/skills` CLI) is worthwhile.

## 1. Verified current state

| Fact | Value | Reference |
|---|---|---|
| Skills | **44 directories** `resources/skills/<id>/SKILL.md` | `resources/skills/` |
| Frontmatter | Only `name` + `description` across all 44 (verified; no extra fields). `name` matches the directory in all 44; max `description` ~173 chars — within spec | `resources/skills/*/SKILL.md` |
| i18n mirror | **44 ES mirrors** at `resources/i18n/es/skills/<id>/SKILL.md` with the **same names** | `resources/i18n/es/skills/` |
| Harness catalog | `resources/manifest.json` indexes skills as `{kind:"skill", id, path, description}` plus `kind:"skill"` aliases (e.g. `using-agent-skills`→`select-capabilities`) | `resources/manifest.json` |
| Coupling | **14/44 skills reference** `resources/references\|rules\|commands` or the `scopegrain` CLI; 2-3 cite `task gate`/`scopegrain_*`. The rest is generic methodology | grep over `resources/skills/` |

## 2. What the Agent Skills standard requires (agentskills.io/specification)

- `<skill-name>/` directory with mandatory `SKILL.md`; optional
  `scripts/`, `references/`, `assets/`.
- YAML frontmatter: required `name` (1-64, lowercase+hyphens, **must
  match the directory**) and `description` (≤1024); optional
  `license`/`compatibility`/`metadata`/`allowed-tools`.
- `npx skills add` (vercel-labs/skills, released 2026-01-20) installs
  from GitHub `owner/repo` shorthand, GitHub/GitLab/Azure/git URLs and
  local paths; `--skill <id>` selects one; direct in-repo skill paths
  are supported (`.../tree/main/<path>/<id>`). Installs into the skills
  directories of ~75 agents. Anonymous telemetry by default
  (`DISABLE_TELEMETRY=1` to opt out).

## 3. Compatibility

| Criterion | Status | Assessment |
|---|---|---|
| `dir/SKILL.md` layout | ✅ 100% compliant | The tree already IS the standard format |
| Minimal frontmatter | ✅ Compliant (name==dir, description ≤1024) | Verified across all 44 |
| Standard `skills/` root | ⚠️ Partial | Skills live under `resources/skills/`, not `skills/`. The CLI accepts direct `tree/main/resources/skills/<id>` paths, but auto-discovery of `npx skills add owner/repo` at non-conventional roots is **not empirically verified** — must be tested before promising it |
| Duplicate names (i18n) | ⚠️ Risk | `resources/i18n/es/skills/` duplicates all 44 `name`s. If discovery scans recursively it will find 88 SKILL.md files with 44 duplicated names → predictable ambiguity or arbitrary picks. Confirmation pending |
| Manifest aliases | n/a | `kind:"skill"` aliases are a harness concept; the ecosystem does not understand them (irrelevant, not a blocker) |
| Functional independence | ⚠️ Partial | 14/44 cite harness resources that would not travel (references/rules) — the skill would work but with dangling references. The rest is portable |

## 4. Options

| Option | Effort | Pros | Cons |
|---|---|---|---|
| **A. Publish the repo as-is** (`npx skills add NegentMind/scopegrain --skill <id>` or `tree/` paths) | ~0 (document) | Zero work; works today via direct path | Ambiguous discovery (non-standard root + i18n duplicates); 14/44 coupling; messy `skills.sh` listing |
| **B. Dedicated mirror repo** `NegentMind/scopegrain-skills` with `skills/` populated from `resources/skills/` at release | S-M (sync script + CI) | Clean discovery, conventional root, no duplicates; allows curating the portable subset | A second repo to maintain; drift risk between `resources/skills` and the mirror (mitigable with the same `check-manifest-version` pattern) |
| **C. Do not publish; the binary already installs them** | 0 | `scopegrain init`/`host activate` already projects skills to each host via the catalog + manifest — the native channel exists | Zero skills.sh visibility; does not leverage the ecosystem |

## 5. Recommendation

**C short-term; B if ecosystem presence is wanted.** A is free but
mediocre (ambiguous discovery + dangling references in a third of the
catalog).

Honest arguments:

- The real distribution channel for these skills **already exists and
  is superior for its purpose**: `resources/manifest.json` + per-host
  projection (`native.mjs`) installs them where each agent reads them,
  preserving the command↔skill↔rule↔reference coherence that defines
  the harness. `npx skills add` would break that coherence: it would
  install loose skills without the references/rules 14 of them cite.
- The standalone value of the catalog is **partial**: ~2/3 are
  exportable generic methodology (TDD, debugging, reviews), but that
  niche is saturated on skills.sh; Scopegrain's differentiator is the
  *system*, not loose skills.
- If B is chosen: curate a portable subset (no `resources/*`
  references), add `license: Apache-2.0` to the frontmatter, and
  empirically verify the CLI's discovery before advertising the
  install command.

Pending empirical verification (not checkable without running the
external CLI): whether `npx skills add owner/repo` auto-discovers
`resources/skills/` and how it handles the 44 duplicated names in the
i18n mirror.
