<!-- translated-from: docs/getting-started.md @ 2026-11-24 -->
# Getting started: end-to-end tutorial

> English translation of the canonical Spanish document
> (`../getting-started.md`). The Spanish version prevails.

A real walkthrough of a task's lifecycle: inspection, init, context,
creation, transitions, bounded verification, closure and the viewer.
Every command is run manually; mutating verbs preview as a dry-run and
only write with `--apply`.

The examples use PowerShell from the clone root. On bash the same
commands work with `node ./bin/scopegrain.mjs` (forward slashes) and
identical flags.

## 0. Requirements and installation

Node.js 22 or later. The CLI needs no installed dependencies;
`npm install` is only required for the MCP server and the test suite
(`@modelcontextprotocol/sdk`, `zod`).

```powershell
# Optional: only for the MCP server
npm install

# Without a global install, from the clone root:
node .\bin\scopegrain.mjs --version
```

To make `scopegrain` available on PATH: `npm link` (see
[onboarding](onboarding.md)).

## 1. Inspect the project (read-only)

```powershell
node .\bin\scopegrain.mjs inspect --project .
```

Returns a JSON with manifest-detected stacks, evidence and proposed
commands marked `approved:false`. Nothing is written or executed.

## 2. Initialize

```powershell
# Interactive (bilingual wizard — the first question is the language):
node .\bin\scopegrain.mjs init --project .

# Or non-interactive with defaults plus investigate's suggestions:
node .\bin\scopegrain.mjs init --project . --defaults --apply
```

- Interactively, `init` shows the complete file plan and asks for
  confirmation (default `no`); answering `no` aborts with no writes.
- `--defaults` is the non-interactive path: the flag IS the consent for
  the answers, and `--apply` remains the write gate.
- Without `--apply`, `init` only presents the preview (dry-run).
- Configuration lands in `.scopegrain/config.json` (proposed
  methodology: `organic-sdd`).

Check the state:

```powershell
node .\bin\scopegrain.mjs doctor --project .
```

## 3. Session context packet

```powershell
node .\bin\scopegrain.mjs context --project .
```

Read-only: returns instructions, config, `locale`, the owner's
knowledge file `.scopegrain/context.md`, a task summary, open goals,
resumable sessions and pending journal events. It is the entry point
of every agent session.

## 4. Create the first task

Create `task.json` (under `organic-sdd`, the `methodology` assessment
is required unless the formal `specId`+`designId` pair is supplied):

```json
{
  "title": "Document the verification flow",
  "contract": "The guide describes the PLAN to CLOSE cycle with real commands",
  "authorContext": "getting-started",
  "scope": ["docs/en/getting-started.md"],
  "methodology": {
    "schemaVersion": 1,
    "request": "Document the verification flow",
    "intent": "change",
    "authorization": {
      "status": "authorized",
      "actor": "owner",
      "reference": "getting-started"
    },
    "understanding": "sufficient",
    "uncertainty": "resolved",
    "risk": "contained",
    "riskCategories": [],
    "continuity": "diff-sufficient",
    "evidence": ["docs/en/getting-started.md"],
    "preferredRoute": "auto"
  }
}
```

```powershell
# Preview (dry-run), then persist:
node .\bin\scopegrain.mjs task create --project . --input task.json
node .\bin\scopegrain.mjs task create --project . --input task.json --apply
```

The `--apply` result returns the task `id` (UUID) in state `PLAN`,
revision 0. Query it:

```powershell
node .\bin\scopegrain.mjs task list --project .
node .\bin\scopegrain.mjs task show --project . <UUID>
```

In `manual` mode the flag form `--title/--contract/--author [--scope]`
also exists; under `organic-sdd` or `sdd` without the formal pair,
those flags alone fail with `METHODOLOGY_REQUIRED`.

## 5. Check an action before acting

```powershell
node .\bin\scopegrain.mjs task check-action --project . <UUID> edit
node .\bin\scopegrain.mjs task gate --project . <UUID> edit
```

`check-action` reports whether the action is permitted in the current
state; `gate` is the decision endpoint for host hooks with the exit
contract `0` allow / `2` deny / `3` require-gate / `1` error.

## 6. Transition cycle (CAS with `--revision`)

The usual progression is
`PLAN -> ACT -> VERIFY -> [COLLATERAL] -> EVALUATE -> REVIEW -> ACCEPT -> CLOSE`.
Every transition requires the record's expected revision; a mismatch
returns `REVISION_MISMATCH`. Like every mutating verb, each transition
previews as a dry-run and writes with `--apply`.

```powershell
node .\bin\scopegrain.mjs task transition --project . <UUID> ACT --revision 0 --apply      # -> rev 1
node .\bin\scopegrain.mjs task transition --project . <UUID> VERIFY --revision 1 --apply   # -> rev 2
node .\bin\scopegrain.mjs task transition --project . <UUID> EVALUATE --revision 2 --apply # -> rev 3
node .\bin\scopegrain.mjs task transition --project . <UUID> REVIEW --revision 3 --apply   # -> rev 4
```

`ACCEPT` requires evidence: a JSON file with `verification` (non-empty
checks carrying `command`, `cwd`, `status:"pass"` and `evidence`) and
`review` (verdict `approve`, `fresh` or `waived` mode):

```json
{
  "verification": {
    "checks": [
      {"command": "node --check src/example.mjs", "cwd": ".",
       "status": "pass", "evidence": "output captured by the operator"}
    ]
  },
  "review": {
    "mode": "waived", "owner": "owner",
    "reference": "getting-started", "reason": "documentation change",
    "verdict": "approve"
  }
}
```

```powershell
node .\bin\scopegrain.mjs task transition --project . <UUID> ACCEPT --revision 4 --evidence evidence.json --apply  # -> rev 5
node .\bin\scopegrain.mjs task transition --project . <UUID> CLOSE --revision 5 --apply                            # -> rev 6, terminal
```

`STALL`, `RESEARCH` and `ABANDON` are planned detours; returning to
`ACT` invalidates the stored verification and review. The exact edges
are in [task workflow](task-workflow.md) and `policy/workflow.json`.
`task doc --project . <UUID>` renders the task's readable document.

## 7. Bounded command verification

`verify` runs only approved commands as literal argv (never shell):

```powershell
# Register a command (preview, then --apply):
node .\bin\scopegrain.mjs verify add --project . --command "node --version" --apply

# List the registry (each command has an ID):
node .\bin\scopegrain.mjs verify list --project .

# Approve it and run it:
node .\bin\scopegrain.mjs verify approve <ID> --project . --apply
node .\bin\scopegrain.mjs verify run <ID> --project .
```

`verify discover --project .` infers candidates from the project's real
manifests (it never runs them without approval).

## 8. Read-only viewer

```powershell
node .\bin\scopegrain.mjs view --project .
```

Local web dashboard (15 views, EN/ES) on loopback: tasks, DAG plans,
sessions, approvals, journal and system health. It never mutates state;
mutations go through the CLI or the MCP tools.

## 9. Further reading

- [Task flow and evidence](task-workflow.md) — edges, CAS, evidence
  format and dispositions.
- [Onboarding and customization](onboarding.md) — answers,
  methodologies, paths and versioning.
- [Declarative distribution](distribution.md) — bundles, extensions and
  presets (`dist`).
- [System report](system-report.md) — boundaries, security and
  verification status.
