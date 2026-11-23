---
name: audit-harness
description: Inspect harness contracts, resources and capability claims.
---
# Audit the Harness

Closes the "who watches the harness" loop: audit the harness resources
(commands, agents, skills, prompts, rules, references, profiles, MCP
descriptors, catalog) without touching the product. This command is the
harness self-change gate (`prompts/decision-request`, Gate H): a diff
touching harness resources requires this audit green before its commit.

Load `select-capabilities` and `context-engineering` (context budgeting
for large resource sweeps). Governing rules: `rules/resource-integrity`,
`rules/mcp-integration`.

## Procedure

1. Determine scope: the current diff inside the harness resources
   directory (`git diff --name-only` restricted to it; fallback the last
   commit). No diff → full audit of the resources tree and catalog.
2. Delegate to `harness-maintainer` through the available delegation
   capability (bounded brief per `prompts/task-brief`: scope, read-only,
   return findings + verdict). Without delegation, audit inline and say
   so.
3. Apply the checks below; return a verdict PASS/FAIL with evidence.

## Checks

- **Catalog integrity** — every manifest/catalog entry resolves to an
  existing file; every alias target and mode exists; no orphaned
  resources missing from the catalog; no duplicate ids.
- **Link and reference integrity** — internal links and cross-resource
  references resolve; resource ids cited inside commands/skills exist in
  the catalog. Skill conventions: `references/skills-engineering`;
  MCP descriptor claims: `references/mcp-tools`.
- **Path contracts** — source/projection paths, configured state paths
  and report destinations are consistent and inside the approved project
  root; nothing writes outside it.
- **Byte and format limits** — model-facing files respect declared size
  limits and frontmatter schema (`name`, `description`).
- **Claim validation** — model-facing instructions and tool claims match
  actually available schemas and capabilities; read-only annotations and
  role text do not enforce access control; generated configuration,
  documented compatibility and a native pilot are distinct things.
- **Lifecycle consistency** — command/role responsibility boundaries,
  approval gates, lock/crash behavior and temporary-ownership rules are
  coherent across resources.
- **Workflow lint** — when the project records lint/typecheck tools for
  workflows or config files (e.g. a workflow linter), run them where
  authorized; otherwise static inspection.

## Authority and verification

Read-only on harness resources: report drift, unsupported capabilities
and corrections with evidence. A verdict cites what was actually
checked — an uninspected resource is reported as uninspected, not passed.

## Output contract

1. **Report:** `<reports path>/harness-<YYYYMMDD>-<HHMMSS>.md` plus a row
   in the reports index.
2. **Backlog:** each finding ≥ medium registers per
   `prompts/finding-record` — `source` names this report, schema per
   `references/backlog-format`.

## Red flags

- Auto-repairing resources, activating integrations or importing
  archived rules inside the audit.
- Interface changes without a published rename map first.
- Findings fixed in-place — corrections go through `implement-task`,
  never inside this audit.
- A red audit committed anyway — Gate H blocks the harness commit and
  ≥medium findings register as finding records fixed in the same harness
  change.

## Handoff

Registered findings flow to `implement-task`; triage of the new backlog
items goes through `plan-work`.
