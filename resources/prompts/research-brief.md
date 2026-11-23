---
name: research-brief
description: Read-only research — digest contract, module/product investigation procedure and the decision synthesis that turns findings into tasks.
---
# Research Brief

Three contracts in one file: **§A — the read-only digest delegate** used to
isolate heavy reading; **§B — the deep investigation** of a module or
product surface; **§C — the decision room** that converts investigation
findings into owner decisions and executable records. Loaded by
`investigate` (per-area research), `compare-options` (synthesis/decision
room) and by orchestrators that isolate heavy reading (`plan-execution`,
`task-brief`). Research is read-only: no fixes; findings become reports +
decisions materialized by the owner.

Format principles inherit `decision-request`: concrete options + recommended
default first, never open questions without options, every decision recorded
in trace/continuation.

---

## §A — Digest delegate (research isolation)

A research delegate implements NOTHING — it reads and synthesizes. Spawn it
to keep heavy reading out of the executor's context.

Objective: a concise digest (≤500 words) of the requested material.

Mandatory output format:

```
## Digest
### Key findings
- finding 1
- finding 2
### Structure / Architecture
- relevant point
### Risks / Watch-outs
- what the implementer must know
### References (material read)
- path/to/file:32-45 (important function)
```

Rules:
- NO code generation, NO implementation, NO modification of project files.
- Include line numbers for key functions when reading code.
- If the material is confusing, say so — do not invent.
- Prefer the structural capability over grep/read when available.

Investigation criteria:
- **Saturation <20%:** when a new round adds <20% new sources, or none above
  the relevance threshold → STOP and synthesize.
- **Broadening:** insufficient or low-relevance results → widen
  scope/keywords.
- **Narrowing:** sufficient relevance → tighten scope to go deeper.
- **Retry discipline:** deterministic backoff per the declared policy is
  correct for a single-operator pipeline; retry with jitter.
- **Record the decision:** log every stop/broaden/narrow in References with
  the material read.

---

## §B — Deep investigation of {{MODULE}} (API-type module)

Produce a deep, broad investigation report evaluating `{{MODULE}}` against
(a) the real needs of its target users ({{USERS}}) and (b) the state of the
art of {{COMPETITOR_CATEGORY}} — to determine with evidence: **what it has,
what it lacks, what is improvable and what is optimizable**. Load the module
values from the project's research-areas registry (reference
`research-modules`).

### Scope

- Object: `{{MODULE}}` complete — public API, flows, packaging, tests, docs.
- Boundary: do NOT audit the core beyond the contracts {{MODULE}} consumes.
- Read-only mode: no fix during the investigation.

### 1. Target users and their daily flow

For each {{USERS}}: how they discover/install the package, what they expect
from the daily flow, known frictions (install vs portable builds, size,
versions, timeouts), and real evidence (competitor issues/discussions AND
our own issues).

### 2. Ecosystem standards {{ECOSYSTEM}}

Packaging/distribution conventions (registries, multi-platform release CI,
semver, typing/stubs), expected DX patterns (quickstart <5min, typed error
handling), and recent ecosystem changes that affect the module.

### 3. Competitors — mandatory minimum analysis

{{COMPETITORS}}. For each: architecture and backend, public API (exact
list), main flows, install/config DX, published performance (**with a
reproducible source or marked "unverified claim"**), license, activity,
adoption (stars/downloads). Main competitor for differentiation:
{{MAIN_COMPETITOR}}.

### 4. Current state of `{{MODULE}}` (internal, file:line evidence)

- Complete inventory of the exported public surface.
- Implemented flows and their quality (covering tests, gaps).
- Packaging/distribution: what ships, where, release CI.
- Docs: API docs, README, examples — existence and freshness.
- History: prior tasks/findings for this module in backlog/tasks.
- Performance: existing measured numbers or their absence.

### 5. Evaluation framework (score 0-10 per dimension, with evidence)

Onboarding DX · functional completeness · performance/overhead · robustness
· security · docs & examples · observability · testability · parity with
sibling surfaces (same feature elsewhere in the project) ·
**differentiation** (why choose this over {{MAIN_COMPETITOR}}?).

### Deliverables → `<research path>/research-{{MODULE}}-<YYYYMMDD>.md`

1. Competition matrix: features × products (including `{{MODULE}}`).
2. Prioritized gap analysis: missing (P0/P1/P2) · improvable · optimizable.
3. Quick wins (<1 day) vs strategic bets (>1 week).
4. **Mandatory findings appendix:** EVERY finding — even minor ones — with
   sequential id `H-NN`, suggested category (APPLY/IMPROVE/ADD/OPTIMIZE/
   STRATEGY/DISCARD), severity, estimated effort and `file:line`. This
   appendix feeds §C (per-finding decisions) — without it, data is lost.
5. Recommendations → finding records per owner decision (§C).
6. Performance claims only with a cited reproducible benchmark.

### Method and sources

- Internet (with owner authorization): competitor repos/issues/releases,
  registry stats, ecosystem changelogs — skill `web-research`.
- Internal: structural investigation of {{MODULE}}, its tests, backlog
  history, harness memory logs (`lessons`, decision records).
- Capabilities: `source-driven-development`, `web-research`; per-module
  report format: `review-deep`.
- Final RESULT block with SKILLS_LOADED and GATES_EVALUATED.

### §B′ — Variant: product/surface module

When {{MODULE}} is a product surface (web/desktop/front-end), the unit of
analysis is the EXPERIENCE and the PRODUCT, not a public API. Same skeleton
with these substitutions:

- Object: pages/routes, components, user flows, design system, i18n,
  performance, packaging (if any), tests. Boundary: do not audit the core.
- Visual evidence permitted and recommended: captures via the available
  browser tooling against a local dev server (open/screenshot/console).
- §1 → critical user FLOWS: expected step-by-step, where it breaks today,
  frictions (confusing copy, undesign empty/loading states, dead-end errors).
- §3 → reference PRODUCTS: first impression (hero/messaging), the 2–3 core
  flows, onboarding, error/empty states, perceived performance (reproducible
  source or "unverified claim"), what to openly copy.
- §4 → inventory of routes/screens, components, design system in use;
  prior applicable audits; known debt (reference it, don't rediscover);
  measured perf/i18n/a11y or their absence.
- §5 → product dimensions: first impression & messaging · core flows
  without friction · accessibility (WCAG target level) · performance
  (declared web-vitals/interaction latency) · i18n · design-system
  consistency · robustness (errors, empty, loading, offline) · security
  (CSP/secrets/validation) · testability (E2E) · **differentiation**.
- Report name: `research-{{MODULE}}-prod-<YYYYMMDD>.md`.
- Capabilities: the project's front-end/design skills, visual-review/browser
  tooling, `web-research`.

---

## §C — Decision room (synthesis → owner decisions)

Trigger: run only AFTER the module reports and the cross-module synthesis
exist under the research path. Converts findings into owner decisions —
what to apply, improve, add, optimize or discard — and materializes each
decision into executable records.

### Phase C.1 — Consolidation (no questions yet)

Consolidate into ONE master table every finding from: the per-module
reports' `H-NN` appendices, the synthesis report, and the finding records
already derived to the backlog.

Classify each finding into ONE action category:

| Category | Meaning | Example |
|---|---|---|
| APPLY | Quick win <1 day, ready now | "add engines field to manifest" |
| IMPROVE | Exists but deficient (score ≤6 on a dimension) | "docs lack per-runtime examples" |
| ADD | Missing feature/capability (P0/P1 gap) | "feature X exists in no binding" |
| OPTIMIZE | Works but at measurable cost (perf/size/memory) | "bundle 2.3MB without lazy-load" |
| STRATEGY | Direction decision, not a task | "compete in browser-only or concede?" |
| DISCARD/WONTFIX | Not worth the cost — propose archiving | "support platform <1.0" |

Per item compute **impact** (high/medium/low) × **effort** (declared
buckets) × **affected quality dimension**, using what the reports say — do
not invent.

If >25 items: pre-select ALL P0/P1, the top-10 by impact/effort ratio, and
all STRATEGY items. The rest go to an annex "no question — straight to
backlog as low-priority unless objected".

### Phase C.2 — Question rounds (batched, max 4 rounds)

Use the question interface with MULTIPLE questions per call. Each question:
grouped by theme (not one per finding); mutually-exclusive alternatives
merged ("option A vs B vs both"); `(Recommended)` first, derived from the
synthesis scores; multi-select where options are not exclusive.

- **Round 1 — Verdict and strategy (most important):** present the
  consolidated verdict first (scores per module, competitor ranking,
  relative position). Ask: priority strategic bet? unacceptable global
  dimension (multi)? findings contradicting the current roadmap →
  re-prioritize?
- **Round 2 — Quick wins:** which APPLY items now (multi)? via a batch plan
  or single tasks?
- **Round 3 — Missing features:** which P0 gaps enter as a new phase? P1s:
  enter, defer or WONTFIX? parity policy between surfaces: full or case by
  case?
- **Round 4 — Improve/optimize + discards:** which improvables rise in
  priority? which optimizations demand a before/after benchmark before
  deciding (no unmeasured perf claims) and which are approved directly?
  confirm proposed WONTFIXes?

**Cut rule:** if after Round 2 the owner says "everything recommended", skip
the remaining rounds, apply the recommended defaults and list them as
explicit-by-default decisions (recorded the same).

### Phase C.3 — Materialize decisions

Per EACH owner decision:

1. **Executable record** in the backlog: canonical key per the registered
   taxonomy (generic findings → the findings scheme, `finding-record`),
   declared-schema row, verifiable contract ("done = the command that
   proves it"), effort, resulting priority, key files.
2. **WONTFIX/discards** → a decision record under `.scopegrain/decisions`
   with the reason.
3. **Strategy** → the harness memory/decisions log; an architectural
   trade-off → propose an ADR (the human owner authors it).
4. **Approved quick wins** → a new plan record ready for plan execution,
   with waves (independent items in wave 0).
5. Record a journal event (`<command>.completed`) with the decision counts.

### Final output

```markdown
## Recorded decisions
| # | Decision | Category | Destination | Task/plan id |

## Explicit-by-default (applied without asking)
...

## Rejected / WONTFIX
... (with reason)

## Recommended next step
<plan-execution command for the new plan, if quick wins were approved>
```

Final RESULT block with SKILLS_LOADED and GATES_EVALUATED.
