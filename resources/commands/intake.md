---
name: intake
description: Classify each user request into no-record, capture, task or plan per the project's intake.mode.
---
# Intake

Prompt-to-record routing. This command activates only when the project's
`intake.mode` is not `off`. Read the mode from the session-start packet's
`intake.mode` field (`scopegrain context` or the `scopegrain_context`
MCP tool); if the field is absent or `off`, stop — do not record
requests implicitly.

Load `clarify-intent`, `organic-driven-development` and
`planning-and-task-breakdown` for the classification; an ambiguous
request is asked, not guessed (`prompts/decision-request`). Task record
semantics: `references/task-system`. Governing rules: `rules/workflow`,
`rules/methodology`, `rules/human-decisions`. Role: `lead`.

## Step 1 — Classify the request

For each user request, classify once, before acting:

| Request | Record |
|---------|--------|
| Pure question, explanation, review, read-only inspection | **None** — answer directly. Do not record questions. |
| One bounded implementation change (single concern, identifiable scope) | **Task** — one `task create` input |
| Multi-part or ambitious request (several deliverables, phases or a DAG) | **Plan** — one `plan create` input with `dependsOn` edges |
| Ambiguous scope or unclear authorization | **Ask first** — never guess a task into the backlog |

When in doubt between "task" and "plan": prefer a task. A plan with one
task is ceremony; a task that later spawns a plan is honest evolution.

## Step 2 — Apply the configured mode

| Mode | Behavior |
|---|---|
| `off` | Nothing in this command applies. |
| `capture` | Additionally persist a `capture create` note recording the engineering request (category `event`). Captures are an inbox, not a commitment; the human decides whether to promote them. |
| `suggest` | Draft the `task create` / `plan create` input JSON and show it with the exact command. Apply only after explicit approval. |
| `auto` | Run the `create` command with `--apply` to persist the record. This records bookkeeping only. |

## Authority boundary (invariant)

A persisted task or plan in `PLAN` state is a **record of intent, not a
license to implement**. Regardless of mode — including `auto` — the
normal gates still apply: transitions follow the lifecycle,
`VERIFY`/`REVIEW`/`ACCEPT` require their evidence, and network access,
installs, destructive actions and publication still need explicit
authorization. `auto` automates classification and record creation;
it never automates implementation or approval.

## Step 3 — Input templates

Persist records through the CLI (writes stay out of the MCP boundary).
All create commands default to dry-run; `--apply` writes.

### Task (manual methodology)

```json
{
  "title": "<imperative title>",
  "contract": "<what done means, one paragraph>",
  "authorContext": "<host>-session-<date>",
  "scope": ["<paths the change may touch>"],
  "backlog": "<domain>",
  "priority": "p2"
}
```

### Task (organic-sdd methodology)

Same fields plus the light assessment; `methodology` replaces the formal
spec/design pair. The assessment must be honest — `risk: "named"` or
`sdd` classification routes back to formal work.

```json
{
  "title": "<imperative title>",
  "contract": "<what done means>",
  "authorContext": "<host>-session-<date>",
  "scope": ["<paths>"],
  "methodology": {
    "schemaVersion": 1,
    "request": "<the user's request verbatim or faithfully compressed>",
    "intent": "change",
    "authorization": { "status": "authorized",
      "actor": "owner", "reference": "<decision or session>" },
    "understanding": "sufficient",
    "uncertainty": "resolved",
    "risk": "contained",
    "riskCategories": [],
    "continuity": "diff-sufficient",
    "evidence": ["<what grounds the classification>"],
    "preferredRoute": "auto"
  }
}
```

### Plan (multi-task DAG)

Each task entry carries its own `methodology` assessment (per-task
light route in organic-sdd) plus `dependsOn` edges by task key.
Formal plans instead carry `specId` + `designId` at the top level.

```json
{
  "key": "<plan-key>",
  "title": "<plan title>",
  "authorContext": "<host>-session-<date>",
  "triage": {}, "appetite": null, "cynefin": null,
  "riskRegister": null, "premortem": null,
  "stopConditions": null, "budget": null,
  "tasks": [
    { "key": "<task-key>", "title": "...", "contract": "...",
      "scope": ["<paths>"], "dependsOn": [],
      "methodology": { "...": "same assessment shape as a task" } }
  ]
}
```

### Capture (mode `capture`, or low-commitment inbox record)

```json
{
  "category": "event",
  "title": "Intake: <request title>",
  "summary": "<what the user asked and how it was classified>",
  "areaIds": ["<workspace-area-key>"],
  "basis": "declared"
}
```

## Step 4 — Persist

```sh
scopegrain task create   --project . --input <file>.json --apply
scopegrain plan create   --project . --input <file>.plan.json --apply
scopegrain capture create --project . --input <file>.json --apply
```

## Output contract

- One classification decision per request — reclassify only when the
  user's own reply changes the request's shape.
- Intake drafts under the project's state paths
  (`.scopegrain/drafts/`), never in product documentation.
- Persisted records in `PLAN` state only; mode `suggest` persists
  nothing without approval.

## Red flags

- Recording a pure question as work.
- A guessed task written into the backlog on ambiguous scope.
- `auto` treated as a license to implement — classification is
  bookkeeping, not authorization.
- An inflated `methodology` assessment used to keep named-risk work on
  the light route — `risk: "named"` or `sdd` routes back to formal work.

## Handoff

Persisted tasks and plans stay in `PLAN`; `implement-task` or
`coordinate-plan` pick them up under their own gates.
