---
name: audit-web-performance
description: Assess an authorized web workload with reproducible performance evidence.
---
# Audit Web Performance

Targets web applications specifically. Do not use it for utility
libraries, CLIs or server-only code with no browser-facing output.

Checklists: `references/performance-checklist`,
`references/observability-checklist`. Governing rules:
`rules/frontend-web`, `rules/evidence`.

## Modes

| Mode | Activation | Evidence class |
|---|---|---|
| `deep` | Any measured input exists | Sourced values only |
| `quick` | Default — no measured input | Every finding labeled `potential impact` — static suspicion, not a measurement |

**deep** activates when any of these inputs is available:

- A lab-tool JSON report (e.g. Lighthouse/PSI output file or pasted JSON).
- A field-data API response (e.g. CrUX), where the project holds an
  authorized key.
- A browser performance trace artifact.
- A live URL plus authorized browser tooling to capture metrics
  directly.
- Local CLI equivalents whose JSON output the owner supplies.

### Quick-mode patterns

- Large JS bundles: no code splitting, no lazy loading.
- Unoptimized images: missing dimensions, no lazy loading.
- Render-blocking resources: scripts without defer/async.
- Missing cache headers: no `Cache-Control`/`ETag` policy.
- Layout-shift risks: embeds without dimensions, late-loading fonts.
- Long main-thread tasks (>50ms) visible in code structure.

## Step 1 — Confirm scope and permission

Confirm the web surface, workload, devices, the relevant user outcome
and permission to start a server/browser or contact an external URL.
Neither mode implies permission to install tools. Quick targets the
agreed critical path; deep expands to the agreed representative
scenarios.

## Step 2 — Run the audit

Delegate to `performance-engineer` through the available delegation
capability (else run inline and say so). Load
`performance-optimization`, `observability-and-instrumentation` and the
browser-capture capability when a live page is authorized. Pass
explicitly:

- The files, components or diff under review.
- Artifact paths or pasted JSON (lab report, field data, trace).
- The target URL or page name when known.
- The expected mode (quick/deep) so missing deep inputs surface early.

Lighter alternative: `verify-work quick` when only the recorded
mechanical checks are needed, not a profiling pass.

## Step 3 — Report

The auditor returns a scorecard populated **only with sourced values**,
a ranked findings list, positive observations and proactive
recommendations. Record environment, command, input, raw results,
variance and missing coverage. Use existing baselines; never invent
thresholds, scores or improvements.

## Authority and verification

Permissions are per-effect: starting a server, driving a browser and
contacting an external URL are each confirmed, none implied by the mode.
Do not claim real-user performance or accessibility conformance from a
synthetic run, screenshot or static review. Do not modify the product
here; fixes go through the backlog and `implement-task`.

## Output contract

- Report: `<reports path>/webperf-<mode>-<YYYYMMDD>-<HHMMSS>.md` under
  the configured reports path plus a row in the reports index.
- Each finding ≥ medium registers per `prompts/finding-record` —
  `source` names this report, schema per `references/backlog-format`.
- Return the full report — single-persona command, no merge step.

## Red flags

- Thresholds, scores or improvements invented without a baseline.
- `potential impact` findings presented as measured regressions.
- Real-user or conformance claims from synthetic evidence.
- Tools installed because the mode seemed to need them.

## Handoff

Findings flow to `implement-task` through the backlog; a mechanical
re-check uses `verify-work quick`.
