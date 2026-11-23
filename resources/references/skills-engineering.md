# Catalog Discipline

One manifest indexes active canonical resources. Bodies load only for the
selected task and required references. An indexed legacy source is not
an approved skill. Provenance, dependencies and activation status matter.
Do not fuse similarly named procedures without comparing behavior.
Do not claim that registration alone verifies a procedure's effectiveness.

## Skill Discovery Protocol (dynamic)

> **Mandatory on every task** (main agent and sub-agents), executed on each
> phase: PLAN, TASK, RUN, VERIFY, REVIEW, SHIP. If the runtime offers a
> discovery tool, use it; otherwise run the algorithm manually against the
> catalog.

### Discovery algorithm (runs automatically at each phase)

```
INPUT:  current_phase, task_id, key_files, contract_keywords, task_type
OUTPUT: ordered skill list to load (bounded, justified)

1. BASE      = base skills for task_type (canonical per-type table)
2. KEYWORDS  = extract(key_files, task_id, contract) — normalize aliases
               and plurals (e.g. "tests"→"test", "seguridad"→"security")
3. CANDIDATES= search catalog(KEYWORDS, phase) scored by relevance
4. FILTERED  = deduplicate(BASE + CANDIDATES)
               priority: phase match > type match > rating
5. SELECTED  = top_n(FILTERED, max_skills) — pins/base may exceed the cap
6. JUSTIFY   = per skill: "phase=X, keyword=Y, score=Z" — logged in the
               task record and result block
7. LOAD      = each selected skill in order
```

### Configuration parameters

```yaml
sdp_config:
  max_skills_per_phase: 5        # cap on score-selected fills (pins+base exempt)
  min_relevance_score: 0.6       # threshold 0–1
  boost_phase_match: 0.3         # skill in the phase's lifecycle mapping
  boost_type_match: 0.2          # skill matches task_type
  boost_rating: 0.1              # catalog rating bonus (1–10)
  exclude_deprecated: true       # never load DEPRECATED skills
  prefer_local: true             # project skills > global
  exclude_families_unless_exact: # heavy families only on exact keyword
    - "<family-a>"               #   (no fuzzy scoring into ~100 micro-skills)
    - "<family-b>"
```

### Per-phase flow

| Phase | Trigger | Looks for | Base (always) | Dynamic examples |
|---|---|---|---|---|
| PLAN | plan command | Backlog items, specs, architecture | `planning-and-task-breakdown`, `spec-driven-development` | `idea-refine`, `constraint-driven-development`, `architecture-decision-record` |
| TASK | task command | Task file, key files, task type | campaign/executor base + per-type | `systematic-debugging`, `test-driven-development`, domain skills |
| RUN | run command | Plan file, dependencies, waves | executor + progress skill | Per wave task's dynamic set |
| BUILD | Implementation | Files touched, language, domain | `incremental-implementation`, `test-driven-development` | `source-driven-development`, `security-and-hardening`, `api-and-interface-design`, `frontend-ui-engineering` |
| VERIFY | Post-implementation | Test results, builds, errors | `systematic-debugging` | `browser-testing-with-devtools`, `code-review-and-quality`, `performance-optimization` |
| REVIEW | Pre-merge | Diff, blast radius, security | `code-review-and-quality` | `code-simplification`, `security-and-hardening`, `deprecation-and-migration`, `observability-and-instrumentation` |
| SHIP | ship command | Release readiness, changelog | `git-workflow-and-versioning`, `shipping-and-launch` | `ci-cd-and-automation`, `documentation-and-adrs`, `deprecation-and-migration` |

### Policy pins (guardrails — non-negotiable)

Path/contract signals add mandatory skills at score 1.0, `pinned: true`:

```
.harness/|config|policy → doubt-driven-development
.github/|release|semver|workflow → ci-cd-and-automation + git-workflow-and-versioning
unsafe|ffi|wasm|auth|secret → security-and-hardening
docs/api → documentation-and-adrs + api-and-interface-design
tests/|fix|bug → test-driven-development + systematic-debugging
storage|wal|schema|migration → deprecation-and-migration
performance|bench|hot path → performance-optimization
```

Additional guardrails:

- **Diversity quota**: when risk signals appear (security, breaking,
  release, migration, debt), ≥1 quality skill must be selected
  (`code-review-and-quality` / `doubt-driven-development` /
  `security-and-hardening` / `test-driven-development`).
- **Feedback loop**: record task outcomes per skill
  (`<taskId> ok|fail <skills>`); skills with success ≥0.7 over ≥3 uses get
  +0.1; 0.4–0.7 → +0.05; <0.4 → −0.1.
- **Manual pins**: the task file ("tools needed") may pin extra skills —
  standard for critical tasks.
- **Overshoot rule**: `max_skills` caps the score-fill; pins+base are
  mandatory and may exceed it (typical overshoot ≤2–3).
- **Description re-rank**: after scoring, boost candidates whose
  description tokens overlap contract/task tokens (+0.05 per overlapping
  token, cap +0.15) — catches skills whose keywords do not literally match
  but whose stated purpose does.
- **Index freshness**: the scored candidate pool should come from a
  generated skills index (description + tokens + rating + deprecated flag
  per entry); regenerate it whenever a skill is added, renamed or
  deprecated — a stale index silently degrades every phase.

### Keyword → skill mapping (scoring table shape)

```yaml
keyword_to_skills:
  # Core / engine
  "rust":       ["source-driven-development", "test-driven-development", "systematic-debugging"]
  "engine":     ["api-and-interface-design", "performance-optimization"]
  "storage":    ["deprecation-and-migration", "observability-and-instrumentation"]
  "wal":        ["security-and-hardening", "deprecation-and-migration"]
  "index":      ["performance-optimization", "systematic-debugging"]
  "concurrency":["security-and-hardening", "doubt-driven-development"]
  "ffi":        ["security-and-hardening", "systematic-debugging"]
  # Bindings / SDK
  "python":     ["source-driven-development", "api-and-interface-design"]
  "sdk":        ["api-and-interface-design", "documentation-and-adrs"]
  "bindings":   ["security-and-hardening", "test-driven-development"]
  # Web / frontend
  "web":        ["frontend-ui-engineering", "browser-testing-with-devtools"]
  "ui":         ["frontend-ui-engineering", "design-taste-frontend"]
  "accessibility": ["<project a11y audit skill>"]
  # Testing / quality
  "test":       ["test-driven-development", "systematic-debugging"]
  "debug":      ["systematic-debugging", "browser-testing-with-devtools"]
  "flaky":      ["systematic-debugging", "code-review-and-quality"]
  "coverage":   ["test-driven-development", "constraint-driven-development"]
  "benchmark":  ["performance-optimization", "observability-and-instrumentation"]
  # Security
  "security":   ["security-and-hardening", "doubt-driven-development"]
  "unsafe":     ["security-and-hardening", "systematic-debugging"]
  "supply-chain":["security-and-hardening", "deprecation-and-migration"]
  # CI/CD / release
  "ci":         ["ci-cd-and-automation", "shipping-and-launch"]
  "release":    ["shipping-and-launch", "git-workflow-and-versioning"]
  "version":    ["git-workflow-and-versioning", "release-notes-one-pager"]
  "changelog":  ["documentation-and-adrs", "release-notes-one-pager"]
  "deploy":     ["shipping-and-launch", "observability-and-instrumentation"]
  # Architecture
  "architecture": ["api-and-interface-design", "deprecation-and-migration"]
  "api":        ["api-and-interface-design", "spec-driven-development"]
  "interface":  ["api-and-interface-design", "frontend-ui-engineering"]
  "refactor":   ["code-simplification", "incremental-implementation"]
  "simplify":   ["code-simplification", "incremental-implementation"]
  # Workflow
  "pipeline":   ["<executor skill>", "<progress skill>"]
  "task":       ["<executor skill>", "planning-and-task-breakdown"]
  "plan":       ["planning-and-task-breakdown", "spec-driven-development"]
  "backlog":    ["<progress skill>", "<executor skill>"]
  # Docs
  "docs":       ["documentation-and-adrs", "writing-guidelines"]
  "adr":        ["documentation-and-adrs", "deprecation-and-migration"]
  "spec":       ["spec-driven-development", "interview-me"]
```

### Base skills per task type

| Task type | Base skills (always) |
|---|---|
| `feature-add` | `incremental-implementation`, `test-driven-development`, `spec-driven-development`, `planning-and-task-breakdown` |
| `bug-fix` | `systematic-debugging`, `test-driven-development`, `incremental-implementation` |
| `refactor` | `code-simplification`, `incremental-implementation`, `test-driven-development` |
| `security` | `security-and-hardening`, `doubt-driven-development`, `systematic-debugging` |
| `performance` | `performance-optimization`, `observability-and-instrumentation`, `source-driven-development` |
| `release` | `shipping-and-launch`, `git-workflow-and-versioning`, `ci-cd-and-automation` |
| `docs` | `documentation-and-adrs`, `writing-guidelines`, `spec-driven-development` |
| `research` | `web-research`, `coordinated-web-search`, `spec-driven-development` |

### Lifecycle mapping (phase boost targets)

```
DEFINE   → spec-driven-development, interview-me, idea-refine, constraint-driven-development
PLAN     → planning-and-task-breakdown, spec-driven-development
BUILD    → incremental-implementation, test-driven-development, context-engineering,
           source-driven-development, doubt-driven-development, frontend-ui-engineering,
           api-and-interface-design
VERIFY   → systematic-debugging, browser-testing-with-devtools
REVIEW   → code-review-and-quality, code-simplification, security-and-hardening,
           performance-optimization, deprecation-and-migration,
           observability-and-instrumentation
SHIP     → git-workflow-and-versioning, ci-cd-and-automation, shipping-and-launch,
           documentation-and-adrs, deprecation-and-migration,
           observability-and-instrumentation
```

### Category quick-load guide

- **UI/frontend design**: design-orchestrator → taste skill → dynamic: responsive, wireframing, UX-flow
- **Animation**: motion core → dynamic: scroll/timeline variants
- **Bug fixing**: `systematic-debugging` → `writing-plans` → dynamic: browser-devtools, review
- **Multi-step features**: `brainstorming` → `writing-plans` → dynamic: spec-driven, task-breakdown, incremental
- **SEO**: audit skills → dynamic: programmatic-seo, schema-markup
- **Branding/art**: brandkit, canvas, theme, color, platform-design

## Registration of loaded skills (mandatory)

In each task file and result block:

```markdown
## Required tools → Skills

| Skill | Phase | Justification | Score |
|---|---|---|---|
| <executor> | TASK | base type=feature-add | 1.0 |
| spec-driven-development | PLAN | keyword=spec, phase boost | 0.9 |
| systematic-debugging | VERIFY | keyword=debug, phase boost | 0.9 |
| security-and-hardening | BUILD | keyword=ffi, type=security | 0.8 |

SKILLS_LOADED: <executor>, spec-driven-development, systematic-debugging, security-and-hardening
```

## Verification checklist

The discovery protocol was applied correctly when:

- [ ] It ran in **every phase** (PLAN, TASK, BUILD, VERIFY, REVIEW, SHIP)
- [ ] `max_skills_per_phase` not exceeded (except pins+base overshoot)
- [ ] Every loaded skill has a justification in the task file
- [ ] `SKILLS_LOADED:` block present in the result
- [ ] No DEPRECATED skills loaded
- [ ] Project-local skills prioritized over global
- [ ] ≥1 dynamic (non-base) skill loaded per phase

<!-- Cross-references: → see orchestration-patterns.md, task-system.md, definition-of-done.md, reference-maintenance.md -->
