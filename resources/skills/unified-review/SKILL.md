---
name: unified-review
description: Use to choose quick verification, certification, focused review or wider inspection proportional to evidenced risk, without duplicating audit procedures
---
# Unified Review & Audit Orchestration

Project-neutral orchestrator for review, audit and pre-delivery
certification. Built around **fresh-context fan-out**: the orchestrator
detects the project, launches one independent sub-review per phase through
whatever subagent mechanism the host provides, collects structured reports,
consolidates findings and writes one prioritized report — while keeping its
own context under ~10% budget.

Modes: `quick`, `certify`, `review`, `full`. In scopegrain terms these map
onto the existing commands rather than a new surface: `quick`/`certify`
extend `verify-work`, `review` extends `review-change`, and `full` extends
`audit-project`. Do not invent a parallel command surface; the mode
selects *depth*, not *authority*.

---

## What the orchestrator does

1. **Phase 0 — Detect.** Inspect the working tree, identify languages,
   bindings, web framework, CI/CD, docs and optional tooling, then load the
   matching profile. Runs synchronously; must complete in seconds.
2. **Phases L1..L9 — Fan-out.** Launch one independent context per phase.
   Each runs mechanical checks (compile, lint, test), applies cognitive
   review skills, and returns a structured JSON report — only the JSON.
3. **Phase L10 — Fan-in.** Aggregate, dedupe, detect cross-cutting
   patterns, compute scores, evaluate the quality gate.
4. **Phase L11 — Report.** Write the final report to the project's review
   directory (default `.scopegrain/reviews/` or the project's declared
   state path) and register it in the report index.

## When to use

| Trigger | Mode |
|---------|------|
| "Did I break anything?" before saving | `quick` |
| About to push / hand off a work unit | `certify` |
| Reviewing a PR / diff / change request | `review` |
| Periodic deep review / release preparation | `full` |

## Division of labor

This skill owns the **orchestration contract only**: detection, profiles,
mode selection, fan-out/fan-in, the findings taxonomy, scoring and the
report. It deliberately does not own reviewer methodology:

- `code-review-and-quality` — the reviewer's checklist, severity prefixes
  and feedback discipline (loaded inside L9, never in the orchestrator).
- `review-deep` — the per-module deep loop; L6 may delegate a module
  deep-dive to it, and it may be invoked standalone between audits.
- `independent-review` — the fresh-context verdict contract for
  named-risk units (see Proportionality); a sub-review phase is not a
  substitute for it.
- `review-feedback` — acting on received review feedback; out of scope
  here — this skill produces findings, that one resolves them.

A phase that needs reviewer judgment loads the sibling skill **inside the
sub-review context**; findings still come back in the canonical taxonomy
so L10 can dedupe and score them.

---

## Proportionality by evidenced risk

Classify the review depth from evidence — paths, diff content and declared
risk categories — never from change size or author confidence alone:

- **Contained/passive** (docs, comments, tests for existing behavior):
  structural readback — confirm scope boundaries and that nothing
  executable changed; no deep inspection needed.
- **Ordinary/medium**: self-verification plus the standard diff review.
- **Named risk** (security, data-integrity, public-contract, concurrency,
  delivery, external-effects, verification-gap): independent fresh-context
  review is mandatory for that unit; a same-context label change is not
  independence. Owner waiver must explicitly cover the named risk and
  carry the fields the workflow contract requires (owner, reference,
  reason).

The review boundary is the finished work-unit commit or PR slice, not the
accumulated feature. A high-risk unit reviewed inside a bulked diff is
treated as unreviewed: isolate it and review that boundary alone.

Review findings and tiers are attestations of evidence seen — never an
authorization to merge, publish or deliver.

---

## Phase 0 — Detection Engine

Runs **synchronously in the orchestrator** — no subagent. Produces a
`DetectionResult` object that every downstream phase receives so it never
re-detects. Steps, in order:

### 0.1 Working tree state

```
git status --short
git diff --name-only HEAD
git log --oneline -10
```

If nothing changed and the requested mode is `quick`/`certify`, suggest
`full` and stop — a gate on an empty diff is theatre.

### 0.2 Language detection

Check marker files at the repo root and inside workspace directories:

| Marker | Language | Notes |
|--------|----------|-------|
| `Cargo.toml` (with `[workspace]`) | Rust multi-crate | Inspect `members` |
| `Cargo.toml` (single) | Rust | |
| `pyproject.toml` / `setup.py` / `setup.cfg` | Python | Check `[build-system]` (maturin ⇒ Rust bindings) |
| `package.json` | TypeScript / JavaScript | Inspect `workspaces` |
| `go.mod` | Go | |
| `pom.xml` / `build.gradle` | Java / Kotlin | |
| `CMakeLists.txt` | C / C++ | |
| `mix.exs` | Elixir | |
| `Gemfile` | Ruby | |

### 0.3 Bindings / SDK detection

- `pyproject.toml` with `maturin` build-backend → Python bindings via PyO3
- `crate-type = ["cdylib"]` + wasm tooling → WASM bindings
- `package.json` + `tsconfig.json` + entry `index.ts` → TypeScript SDK
- `bindings/` or `sdk/` directory → inspect contents

### 0.4 Web framework detection

`next.config.*` → Next.js · `vite.config.*` → Vite · `astro.config.*` →
Astro · `nuxt.config.*` → Nuxt · `remix.config.*` → Remix ·
`svelte.config.js` → SvelteKit · `angular.json` → Angular · plain
`index.html` with no framework → static.

### 0.5 CI/CD detection

`.github/workflows/*.yml` → GitHub Actions · `.gitlab-ci.yml` → GitLab CI ·
`.circleci/config.yml` → CircleCI · `azure-pipelines.yml` → Azure ·
`Jenkinsfile` → Jenkins · `.drone.yml` → Drone.

### 0.6 Documentation detection

`docs/` directory (mdbook, docusaurus, mkdocs, sphinx …), `README.md`,
`CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, and the project's plan /
task directories if the workflow declares them.

### 0.7 Optional tooling detection

- A code knowledge graph or structural index (e.g. a `.codegraph/` dir or
  an equivalent host tool) → enables impact analysis at L0 and structural
  queries at L6. If absent, phases fall back to static inspection — note
  the degraded mode in the report.
- Project-declared specialized subagent types / reviewer roles.
- A declared simplicity/tolerance mode (see Integrations).
- A task-tracking or campaign system the host exposes.

### 0.8 Profile loading and merge

- Always load the generic baseline first.
- If the caller passed a profile name, load it and deep-merge on top.
- Else if a profile exists for the auto-detected project, load it.
- Else stay with the baseline.
- Merge semantics: scalars override, objects deep-merge, arrays replace —
  except `phases`, which is merged by `id`.

### DetectionResult contract

Every sub-review receives this in its prompt:

```json
{
  "profile": "default",
  "mode": "certify",
  "working_tree": {
    "dirty": true,
    "changed_files": ["src/routes.rs", "manifest.json"],
    "staged_files": [],
    "recent_commits": ["abc1234 feat: ..."]
  },
  "languages": ["rust", "typescript"],
  "bindings": {"python": "maturin", "wasm": "wasm-pack"},
  "web_framework": "next",
  "ci_system": "github-actions",
  "docs_system": "mdbook",
  "structural_index_available": false,
  "simplicity_mode": "standard",
  "scopegrain_available": true,
  "phases_to_run": ["L0","L1","L2","L3","L4","L5","L6"]
}
```

---

## Profile system

A profile is a declarative file (YAML or equivalent) that says *how each
phase runs* for one project: commands per language, subagent type,
timeouts, quality-gate conditions, scoring weights, integrations. The mode
says *which phases run*. They compose freely.

### Profile schema (validated at load)

```yaml
profile:
  name: string                    # must match filename
  description: string
  inherits: [string]              # optional base profile

project:
  type: string                    # library | service | monorepo | embedded
  languages: [string]
  bindings: [string]
  web_framework: string
  ci_system: string

phases:
  - id: string                    # L0..L11
    name: string
    description: string
    critical: bool                # abort pipeline on fail
    parallel: bool                # launch as independent sub-review
    subagent_type: string         # built-in generic | project-declared role
    detect: [string]              # all must match or phase is skipped
    commands:
      <language>: [string]
    skills_to_load: [string]      # skills loaded INSIDE the sub-review
    timeout_ms: int               # default 300000
    score_max: int                # default 10
    quality_gates: [string]

modes:
  quick:    [phase_id, ...]
  certify:  [phase_id, ...]
  review:   [phase_id, ...]
  full:     [phase_id, ...]

scoring:
  enabled: bool                   # default false
  weights: { <model>: int }       # declared models; must sum to 100
  thresholds:
    pass_score: int               # default 7
    rating_bands: { A: 9, B: 7, C: 5, D: 3, E: 0 }

orchestration:
  max_parallel: int               # default 4
  timeout_ms: int                 # default 300000
  abort_on_critical_fail: bool    # default true
  retry_mechanical: bool          # default true (one retry on L1 fail)
  keep_raw_logs: bool             # write per-phase logs under the review dir

report:
  format: markdown                # markdown | html | both
  output_dir: ".scopegrain/reviews"   # or the project's declared state path
  filename_pattern: "review-<mode>-<YYYYMMDD>-<HHMMSS>"

pre_push_hook:
  enabled: bool
  platform: string                # powershell | bash

integrations:
  simplicity_mode:
    respect_mode: bool
    skip_phases_in_tolerant: [phase_id]
    escalate_in_strict: [phase_id]
  scopegrain:
    enabled: string               # auto | always | never
  structural_index:
    use_if_available: bool
    phase: string                 # default L0
```

### Adding a project profile

1. Create a profile file next to the baseline, inheriting it.
2. Override only what differs — commands, paths, thresholds, subagent
   types, scoring.
3. Keep project-specific taxonomy subcategories in the project profile,
   not in the baseline.

---

## Modes matrix

| Mode | Phases | Critical gate | Cognitive review | Scoring | Typical duration |
|------|--------|---------------|------------------|---------|------------------|
| `quick` | L0 + L1 | L1 must pass | no | no | < 1 min |
| `certify` | L0 + L1–L6 | L1 must pass; L2–L5 must pass | L6 warns only | no | 5–15 min |
| `review` | L0 + L1 + L6 + L9 | L1 must pass | L9 may veto (records objection, continues) | no | 5–10 min |
| `full` | L0–L9 | L1 must pass | L9 may veto | yes, if the project declares a scoring model | 15–45 min |

---

## Phase catalog

L0, L10, L11 always run inside the orchestrator. L1–L9 are fan-out
candidates — each runs in its own fresh context when `parallel: true`.
A phase whose `detect` conditions do not match is **skipped silently**.

| ID | Name | Critical | Parallel | What it does |
|----|------|----------|----------|--------------|
| L0 | Diff impact analysis | no | no | `git diff` analysis; query the structural index for affected modules if available. Apply declared escalation rules (e.g. diff touching CI manifests ⇒ strengthen the CI parity phase). |
| L1 | Core language check | **yes** | yes | Compile, lint, unit-test the primary language(s). The only phase that aborts the pipeline alone. |
| L2 | Bindings / SDKs | no | yes | Build + test foreign-language bindings (maturin/PyO3, wasm-pack, standalone SDKs, JNI) when detected. |
| L3 | Web frontend | no | yes | Lint, typecheck, production build of the web app when detected. |
| L4 | CI/CD + dependencies | no | yes | Workflow YAML lint, CI parity (every new manifest dependency has a CI install step), dependency audit. |
| L5 | Documentation | no | yes | Docs coverage on public API, broken links, stale references. |
| L6 | Architecture review | no | yes | Circular deps, layering violations, god modules, feature leakage — via the structural index or static import analysis. Per-module deep dives may delegate to `review-deep`. |
| L7 | Security audit | no | yes (full only) | Dependency vuln scanners, unsafe/eval/injection scan on the diff, input-validation checks, declared security checklist. |
| L8 | Performance audit | no | yes (full only) | Benchmarks vs baseline, binary/bundle size regression, hot-path allocation review. |
| L9 | Code review (cognitive) | no | yes (review/full) | Multi-axis review via `code-review-and-quality` and declared companion skills. May veto. |
| L10 | Findings consolidation | no | no | Aggregate, dedupe, cross-cutting detection, scoring, gate verdict. |
| L11 | Final report | no | no | Write + register the report. |
| L11b | Registry/backlog sync | no | no | Register the report in the project index; derive medium+ findings into the project's declared backlog, deduped. |

### Reference commands per language (baseline)

Adapt to the project's own gates — use checked-in wrappers
(`./gradlew`, `make`, repo scripts) over global tools, and the commands
the project's CI actually enforces.

- **Rust:** `cargo fmt --all -- --check` · `cargo check --workspace
  --all-targets` · `cargo clippy --workspace --all-targets --
  -D warnings` · `cargo test --workspace`
- **Python:** `python -m pytest -x --tb=short` · `python -m mypy src/` (if
  configured)
- **TypeScript:** `npx tsc --noEmit` · `npx vitest run` (or repo `test`)
- **JavaScript:** repo `test` script
- **Go:** `go vet ./...` · `go test ./...`
- **Java/Kotlin:** `./mvnw verify` or `./gradlew build`
- **C/C++:** `cmake --build build && ctest --test-dir build`
- **Elixir:** `mix test` · **Ruby:** `bundle exec rake test`

Bindings (L2): `maturin develop && python -m pytest tests/` ·
`wasm-pack build --release` · `npm ci --ignore-scripts && npx tsc
--noEmit && npm test`. Web (L3): `npm ci --ignore-scripts` → repo `lint`
→ `tsc --noEmit` → `build`. CI (L4): workflow linter if installed +
dependency audit (`cargo deny check`, `npm audit --audit-level=moderate`,
`pip-audit`). Docs (L5): doc-build warnings + doc tests + link check.
Security (L7): `cargo audit`, `pip-audit`, `npm audit --audit-level=high`,
plus a diff scan for new `unsafe`/`eval`/`innerHTML`/SQL concatenation.
Performance (L8): benchmarks, size comparison vs the baseline branch,
hot-path allocation review.

### Baseline quality gates per phase

- **L1:** all compile/lint commands exit 0; all unit tests pass; no new
  warnings vs the baseline branch.
- **L2:** all detected bindings build and pass their tests.
- **L3:** lint 0 errors; typecheck passes; production build succeeds.
- **L4:** workflow YAML parses and lints; no new dependency without a CI
  install step; no unmaintained/vulnerable dependency introduced.
- **L5:** no doc-build warnings; no broken links; README references match
  the current API.
- **L6:** no new circular deps; no new layering violations; no new god
  modules (e.g. >1000 lines or >30 public exports — project-tunable).
- **L7:** no new vulnerabilities; no new unsafe code without a safety
  justification; no new input-validation gaps.
- **L8:** no benchmark regression >10%; no size regression >5%; no new
  allocations in declared hot paths.
- **L9:** no unaddressed critical finding; veto count below the declared
  escalation threshold (default 3).

---

## Fan-out orchestration

```
ORCHESTRATOR (Phase 0 + L10 + L11 — context budget < 10%)
│
│  Phase 0: detect (sync, fast)
│
│  Launch L1 ALONE (critical — must pass before fan-out)
│    └── subagent("L1-core-language", prompt) → { phase, status, score, findings }
│
│  if L1 failed AND abort_on_critical_fail → write failure report, exit
│
│  Launch L2..L6 in PARALLEL (cap = orchestration.max_parallel, default 4)
│  (only phases whose detect matched)
│  Await all (per-phase timeout)
│
│  if mode == "full": launch L7, L8, L9 in PARALLEL (second wave)
│
│  L10 consolidate (sync) → L11 report (sync)
```

### Sub-review invocation contract

Launch each phase as an independent, fresh-context sub-review through
whatever mechanism the host provides (subagent tool, delegated session,
separate reviewer invocation). The fresh context is the point — a
same-context self-check does not satisfy the independence requirement
for named risks.

Each sub-review prompt contains:

1. The phase id/name and the `DetectionResult` JSON (so it never
   re-detects).
2. The phase configuration from the profile (commands, gates, skills).
3. The changed-file list / diff context.
4. Instructions: run the commands in order; for each record
   `command, exit_code, duration, summary (≤200 chars)`; evaluate each
   quality gate; scan the diff for findings; load each declared skill
   **inside the sub-review context** (never in the orchestrator); compute
   the phase score.
5. Return contract: **only a single JSON object — no prose, no fences.**

```json
{
  "phase": "L1",
  "phase_name": "Core Language Check",
  "status": "pass|fail|warn|skip|timeout|error",
  "score": 8, "score_max": 10,
  "duration_ms": 23456,
  "subagent_type_used": "generic",
  "commands_run": [
    {"cmd": "...", "exit": 0, "duration_ms": 1234, "summary": "≤200 chars"}
  ],
  "quality_gates": [
    {"condition": "All compile/lint commands exit 0", "passed": false}
  ],
  "findings": [
    {
      "id": "H01-CODE-001",
      "severity": "critical|high|medium|low|info",
      "category": "CODE",
      "subcategory": "Panic in library code",
      "file": "src/engine.rs", "line": 142,
      "description": "unwrap() on user-provided index",
      "recommendation": "Return a typed error instead",
      "skills_loaded": ["code-review-and-quality"],
      "cross_cutting": false
    }
  ],
  "vetoes": [
    {"skill": "doubt-driven-development", "reason": "...", "severity": "high"}
  ],
  "scoring_breakdown": { "<declared model>": { } },
  "raw_log_path": "…/logs/L1-<ts>.log"
}
```

On any failure to produce JSON the sub-review returns
`{"phase": "<id>", "status": "error", "error": "<one-line reason>"}`.

**Suggested phase-score formula:** start at `score_max`; −2 per failed
quality gate; −1 per critical finding, −0.5 per high, −0.2 per medium;
floor at 0.

### Subagent type resolution

The profile names a type per phase. Verify the type exists (built-in or
project-declared) before launching; if missing, fall back to the generic
reviewer type and emit a warning in the report, recording
`subagent_type_used` honestly. Typical mapping: generic worker for
mechanical phases (L1–L5), read-only explorer for L6, research-capable
reviewer for L4 supply-chain work, declared security reviewer for L7/L9,
declared performance reviewer for L8 — when the project defines them.

### Concurrency control

- `max_parallel` (default 4) caps simultaneous sub-reviews.
- L1 always runs alone first.
- L7–L9 launch as a second wave after L1–L6 complete (mode `full` only).
- The orchestrator **never** streams sub-review logs into its own context
  — it reads only the final JSON. Raw output goes to the review `logs/`
  dir when `keep_raw_logs` is enabled, and is linked, never inlined.

### Failure handling matrix

| Phase | Failure type | Action |
|-------|-------------|--------|
| L1 (critical) | any | Abort. Write failure report listing remaining phases `skipped`. Gate FAIL. Exit. |
| L2–L5 | command failure | Mark `fail`, continue other phases. One automatic retry if `retry_mechanical`. |
| L6, L9 | skill veto | Mark `warn`, record objection, continue. If a single phase reaches the declared veto threshold (default 3), the overall gate is FAIL. |
| L7, L8 | failure | Mark `warn`, continue. |
| any | sub-review timeout | Mark `timeout`, continue, warn in report. |
| any | crash / non-JSON | Mark `error`, continue; store raw output truncated to 500 chars. |
| any | subagent type missing | Fall back to generic; record actual type; warn. |

Mechanical phases get one retry; cognitive and optional phases never retry
(subjective output — retrying wastes context).

### When the host cannot fan out

If the host provides no subagent mechanism, run the phases **sequentially
in-session**, keep the same phase order, JSON discipline and gates, and
record `orchestration_degraded: "sequential"` in the report. The
procedure survives; the context-budget guarantee does not. For named-risk
units the REVIEW phase still requires a separate context — that part is
not optional and cannot be degraded by convenience; obtain it or request
an explicit owner waiver (owner, reference, reason).

---

## Fan-in consolidation (L10)

Synchronous in the orchestrator. No subagent.

1. **Aggregate** all findings into one list, tagged with source phase.
2. **Dedupe** findings sharing `file:line` + `category` — keep highest
   severity, merge recommendations.
3. **Cross-cutting detection** — the same finding appearing in 2+ phases
   gets `cross_cutting: true` and escalates one severity level.
4. **Scoring** — per phase and overall: weighted by the declared scoring
   model if enabled, else the unweighted mean of phase scores.
5. **Quality gate** — pass iff every critical phase passed and no finding
   has severity `critical`.
6. **Apply the declared simplicity/tolerance mode** (below).
7. **Sync Scopegrain** if the project declares it and it is
   available (record findings, update state per the workflow contract).

---

## Findings taxonomy (12 categories)

Every finding is classified into exactly **one primary category** and may
carry secondary categories. Baseline subcategories live in the profile;
projects extend them in their own profile.

| # | ID | Covers |
|---|----|--------|
| 1 | `LOGIC` | Off-by-one, race conditions, incorrect branching, state management, edge cases, input validation, error handling, type confusion, serialization, async/sync mismatch |
| 2 | `PATTERN` | Design-pattern violations, language/framework anti-patterns, API design, database anti-patterns |
| 3 | `ARCH` | Circular deps, layering violations, god objects, feature leakage, tight coupling, missing/leaky/premature abstractions, incorrect module boundaries |
| 4 | `DIRECTION` | Scope creep, abandoned effort, unprioritized tech debt, strategic misalignment, over/under-engineering, missing roadmap |
| 5 | `CLARITY` | Confusing naming, magic numbers, deep nesting, missing comments, dead code, incomprehensible tests, stale docs, confusing errors, hidden config |
| 6 | `CODE` | Compiler warnings, unfixed lints, unjustified suppressions, unsafe without justification, unnecessary clones/allocs, bad casts, TOCTOU, error swallowing, panics in library code |
| 7 | `DESIGN` | Visual inconsistency, accessibility, broken responsive, excessive motion, touch targets, loading/empty/error states |
| 8 | `ERROR` | Compilation errors, test failures, flaky tests, runtime panics, deadlocks, memory leaks, CI failures, vulnerabilities, dependency conflicts |
| 9 | `MISSING` | Missing tests, validation, error handling, docs, CI gates, monitoring, recovery, migrations, env config |
| 10 | `FEATURE` | Feature gaps vs alternatives, missing integrations, missing platform support, missing observability |
| 11 | `ALGO` | Wrong complexity, wrong data structure, numerical instability, algorithmic off-by-one |
| 12 | `ANY` | Catch-all — always reviewed manually before the report is published |

### Finding ID format

`H<phase-number><CATEGORY>-<NNN>` — e.g. `H01-CODE-001` (L1, CODE, #1),
`H09-ARCH-002` (L9, ARCH, #2).

### Severity levels

| Severity | Meaning | Handling |
|----------|---------|----------|
| `critical` | Blocks release / data loss / security hole | Fix before delivery |
| `high` | Will break in production soon | Fix this iteration |
| `medium` | Real problem, manageable | Backlog |
| `low` | Minor, polish | When convenient |
| `info` | Observation, no action required | None |

---

## Scoring

**Baseline:** each phase returns 0–10; overall = unweighted mean of the
phases that ran. Gate passes iff every critical phase passed and overall
≥ `pass_score` (default 7). Do not manufacture scores or conformance:
report what was measured, and name what was not exercised.

**Extended (only when the project declares a model):** a declared scoring
model such as ISO/IEC 25010, a SonarQube-style quality gate, OpenSSF CII
best practices, OWASP ASVS, or a maintainability rating — configured per
profile with weights summing to 100. Final score = Σ(system × weight).
Each phase contributes a `scoring_breakdown` keyed by the declared models.
Rating bands: A ≥9, B ≥7, C ≥5, D ≥3, E <3.

| Declared system | Example weight | What it measures |
|-----------------|----------------|------------------|
| ISO/IEC 25010 | 20% | 9 product characteristics scored 0–10 (2023 edition; the withdrawn 2011 model had 8 — a profile must declare which edition it measures) |
| SonarQube-style gate | 25% | pass/fail conditions on new code |
| CII best practices | 20% | None / Passing / Silver / Gold |
| OWASP ASVS | 15% | L1 / L2 / L3 |
| Maintainability rating | 20% | A–E |

A system is reported only if it was actually evaluated — a weight without
evidence is dropped from the report, not guessed.

---

## Report format (L11)

Written to the project's review directory
(`<output_dir>/review-<mode>-<YYYYMMDD>-<HHMMSS>.md`; zero-padded local
timestamp — chronologically sortable). Format `markdown` by default;
`html` or `both` only when the project declares and ships a template.

```markdown
# Unified Review — <mode> — <YYYY-MM-DD>

**Profile:** <name>   **Mode:** <mode>   **Duration:** <N> min
**Quality Gate:** ✅ PASS / ❌ FAIL    **Overall score:** <N>/10 (rating A–E)
**Context:** orchestrator ≈ <n>% | sub-reviews: <n> | degraded: <none/sequential/…>

## Executive Summary
<2–3 paragraphs: what was checked, passed, failed, what next. Plain language.>

## Scoreboard
| Phase | Status | Score | Findings (C/H/M/L/I) | Duration |
| L0 … | ✅/⚠️/❌/⏭️/⏱️ | n/10 | … | … |

## Findings by Category
| Category | Critical | High | Medium | Low | Info | Total |

## Top Critical Findings
1. **[H05-MISSING-001]** `file:line` — description → recommendation (severity)

## Cross-Cutting Patterns
- <pattern> appears in phases <list> — recommend <systemic fix>

## Per-Phase Detail
### L1 — <name> (<score>, <status>)
**Commands:** `cmd` ✅/❌ summary
**Quality gates:** [x]/[ ] per condition
**Findings:** [id] (severity) `file:line` — description

## Recommendations (prioritized)
1. (critical, before push) …  2. (high, this iteration) …

## Declared scoring sections (only if scoring.enabled and evaluated)
<ISO 25010 heatmap | Sonar-style gate | CII level | OWASP level | rating>

_Generated by unified-review. Profile: <name>. Mode: <mode>._
```

### HTML report (optional)

Only when the profile sets `report.format: html|both` and the project
provides a template: self-contained (inline CSS, no CDN, print-friendly,
dark-mode aware). Substitution contract: `{{NAME}}` scalars;
`{{#NAME}}…{{/NAME}}` conditional blocks rendered when truthy; every
value derived from findings is HTML-escaped before substitution; list
sections are concatenated rendered items; the output stays human-readable
for diffing.

---

## Registry & backlog sync (L11b)

Runs after L11. Reports must never be orphaned artifacts.

1. **Register** one row in the project's report index
   (`.scopegrain/reports/INDEX.md` or the declared equivalent):
   `timestamp | mode | file | gate | C/H/M/L/I | status | one-liner`.
   Flip a superseded same-mode report to `superseded` in the same edit.
2. **Derive** every open finding ≥ medium into the project's declared
   backlog — one row per finding using the project's canonical finding-ID
   scheme and row format; `Origin: <report file>` recorded in the row's
   relations field. Skip items already tracked (same `file:line` +
   description) and note `already tracked as <ID>` in the report.
3. **Lazy gate:** `quick` mode or zero findings ≥ medium skips derivation;
   the index registration always runs.
4. Close the report with `Backlog sync: created <IDs>` or `skipped
   (<reason>)`.

---

## Declared-mode integrations

These are opt-in profile integrations, applied only when the project
declares them — the skill detects and adapts; it never assumes them.

| Integration | Effect |
|-------------|--------|
| **Simplicity/tolerance mode** (`off`, `tolerant`, `standard`, `strict`) | `tolerant`: drop `DIRECTION/Over-engineering` findings, skip declared opinionated phases (default L6). `strict`: escalate those findings one severity (never beyond critical) and add the declared audit skill to L6/L9. Read the mode from the caller, host config, or default `standard`. |
| **Scopegrain** | `auto` (default): use the declared task tools if present, skip silently otherwise. `always`: use or warn. `never`: skip. Record findings/state per the workflow contract. |
| **Structural index** | If a code knowledge graph exists, L0 queries it for affected modules and L6 uses it for dependency/cycle analysis. Absent ⇒ static analysis; note the degradation. |
| **Web research tools** | L4/L7 may use whatever search/fetch tools the host provides for advisories; absent ⇒ local checks only, noted. |

---

## Context budget

The point of fan-out is keeping the orchestrator lean:

| Component | Target |
|-----------|--------|
| Orchestrator (P0 + L10 + L11) | < 10% — coordination only, never streams sub-review logs |
| Each sub-review | 15–20% — one phase, JSON out, context freed on return |
| L10 consolidation | < 5% — JSON aggregation only, no re-reading sources |
| L11 report | < 5% — structured output, no raw logs inline |

Approximate orchestrator footprint: `quick` ~8 KB · `certify` ~28 KB ·
`review` ~20 KB · `full` ~50 KB of reports + overhead.

**What breaks the budget:** streaming sub-review logs (≈30 KB each) into
the orchestrator; loading review skills in the orchestrator instead of
inside the sub-review; re-reading large sources during L10; embedding raw
command output in the report. If the orchestrator exceeds ~50% context
after L10, warn in the report and recommend a smaller mode.

---

## Self-validation at load

Refuse to run with a clear error if:

1. The baseline profile is missing or unparseable; a named `--profile`
   does not exist.
2. A `modes.*` entry references a phase ID absent from `phases`.
3. `scoring.enabled` with weights that do not sum to 100.
4. A referenced `subagent_type` is neither built-in nor declared — warn
   and fall back to generic rather than block.
5. `report.format` requests `html`/`both` without an available template.

---

## Common rationalizations

|| Rationalization | Reality |
||---|---|
|| "The orchestrator can review the diff itself" | Orchestrator review destroys the context budget and, for named-risk units, the independence guarantee. Fan out or run sequentially — but keep the phases. |
|| "A same-context phase counts as independent" | A new role label in the same context is a label change, not independence. Named-risk units need a genuinely different context or an explicit owner waiver. |
|| "The gate passed, so delivery is approved" | A passed gate attests evidence was seen. It authorizes nothing — merge, publish and release remain owner decisions. |
|| "More modes means more assurance" | Re-running `full` on an unchanged diff adds cost, not evidence. Depth follows evidenced risk, not anxiety. |
|| "Scores are the point" | Scores summarize measured phases. An unmeasured surface reported as a high score is fabrication — name what was not exercised. |

## Red flags

- A `quick`/`certify` run on a dirty tree that returns "all pass" without
  a single executed command — the gate is theatre; report commands, not
  confidence.
- Sub-review output that is prose instead of the JSON contract, or a
  `status: "pass"` with empty `commands_run`.
- Findings without `file`/`line`, without severity, or with severities
  inflated to justify the review's existence.
- A declared scoring model reported as evaluated when only some of its
  characteristics were measured — report the measured subset and name
  the rest unexercised.
- Streaming raw sub-review logs into the orchestrator, or loading review
  skills in the orchestrator instead of inside the sub-review.
- A named-risk unit "independently reviewed" by the context that wrote
  it, with no waiver on record.
- Reports written but never registered — orphaned artifacts that later
  audits cannot find.
- A `certify`/`full` run used to skip `review-feedback` on findings the
  same run produced — gates detect; feedback resolves.

---

## Boundaries

- A passed gate is an **evidence attestation**, not merge/publish/release
  authorization. Findings, scores and tiers describe what was observed —
  never what is permitted.
- Use the project's declared commands and gates; never a hardcoded stack.
- Mechanical checks run only under the host's permission model — propose
  exact commands and wait when execution is owner-reserved; never claim
  unexecuted checks.
- Named-risk units require a genuinely different review context or an
  explicit scoped owner waiver; reviewer identifiers are attestations,
  not authenticated identity.
- Write inside the harness workspace (`.scopegrain/` by default); never
  scatter reports into product documentation.
