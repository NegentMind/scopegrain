---
title: Workflows, plans and operational continuity
kind: guide
---
# Workflows and continuity

> English translation of the canonical Spanish document
> (`../workflows.md`). The Spanish version prevails.

All commands on a project take `--project P` and accept
`--config relative/path/config.json`. The examples are syntax and
synthetic data, not execution evidence.

## Catalog and procedures

```powershell
node bin/tasksystem.mjs catalog list
node bin/tasksystem.mjs catalog show agent reviewer
node bin/tasksystem.mjs catalog check
node bin/tasksystem.mjs catalog legacy skill
node bin/tasksystem.mjs catalog legacy-show skill ponytail
node bin/tasksystem.mjs workflow audit --project P --mode review --profile core
```

A package resolves command, roles, skills, rules, references, profile,
configured paths and, with `--task UUID`, state and permitted actions.
Resource paths are relative to `resourceRoot`, which identifies the
configuration directory inside the project. `paths` contains artifact
destinations relative to the project root. The core profile always
complements any chosen profile. No instruction is executed
automatically and no agent is created.

Compatible aliases use the same `workflow` interface, not divergent
implementations. Declared modes are validated; unknown names or modes
are rejected. The web/rust/python/database profiles are optional and do
not install stacks, tools or services.

## Plans with dependencies

The following V1 example of `plan create --input plan.json` requires
`manual` mode. In Organic/SDD mode, use real structured references
`specId`, `designId` and per-task scenarios; see
[methodology](methodology.md).

```json
{
  "key": "entrega",
  "title": "Cambio acotado",
  "authorContext": "implementacion-a",
  "tasks": [
    {"key": "base", "title": "Base", "contract": "Contrato verificable", "scope": ["src"], "dependsOn": []},
    {"key": "api", "title": "Interfaz", "contract": "Contrato de interfaz", "scope": ["src"], "dependsOn": ["base"]}
  ]
}
```

The preview does not write. `--apply` creates exclusively plan and
tasks. A plan with the same key is not overwritten. Keys are lowercase
alphanumeric with hyphens, up to 64 characters; 1..100 tasks are
allowed. Cycles, nonexistent dependencies and unsafe scopes are
rejected. Persisted records are also revalidated: altering the JSON
does not bypass the DAG, identity, timestamp or size checks.

`plan list`, `plan show entrega` and `plan next entrega` read current
records. A dependency releases its successor when it reaches CLOSE, not
when it is declared finished in a conversation. The ready, active,
blocked and closed states do not replace each task's state machine.
Execution uses [transitions and evidence](../task-workflow.md).

## Immutable artifacts

```powershell
node bin/tasksystem.mjs artifact add review --project P --input review.json
node bin/tasksystem.mjs artifact list review --project P
node bin/tasksystem.mjs artifact show review UUID --project P
```

Input: `{"title":"Revision","body":"Hallazgos y limites","references":[]}`.
References are safe relative project paths; external citations can be
documented in the body. `--apply` authorizes the creation. Identity is
its own UUID; a historic artifact is not edited to rewrite evidence.
Contextual provenance is written in the body. The document limit
applies to the complete serialized JSON, not only the input text; an
oversized document is rejected before persisting
(`DOCUMENT_TOO_LARGE`).

| Type | Configured destination |
| --- | --- |
| spec | plans/specs |
| design (V2) | plans/designs |
| report | reports |
| review | reports/reviews |
| research | research |
| decision | decisions |
| lesson | memory/lessons |
| handoff | memory/handoffs |

By default, all those destinations live under `.scopegrain/`, not
`docs/`. A project may keep explicitly chosen old paths; existing files
are never moved or deleted because of a change of defaults.

The generic V1 `spec` does not satisfy a formal reference. Typed
operations distinguish structured specification, design bound to its
digest and a `report` bound to a REVIEW revision. An outcome is not a
new folder type or a certification of the cited files.

## Approvals and actions

The latest local full suite (serial `npm test`, 2026-11-17) finished with
1065 passing tests. The Devin Local pilot was certified in a real session;
the remaining hosts are still pending. See results and limits in
[verification](verification.md).

The `approval target/create/show/answer` operations separate content
identification, question, read and answer. Previewing an answer does
not modify persisted consent. Applying it requires current revision and
`expectedTargetDigest`, revalidated under lock; it is not a generic
overwrite nor an approval of native tools.

`methodology check` queries ACT or ACCEPT without writing. The workflow
package includes mode and methodological result and obtains its actions
from the same evaluation. A revocation removes `edit` where applicable;
querying the metadata does not replace the workflow edge or host
permissions. Session budgets use those effective actions.

## Sessions and recovery

```powershell
node bin/tasksystem.mjs session create --project P --task UUID --limit 20
node bin/tasksystem.mjs session record SESSION_UUID --project P --revision 0 --input event.json
node bin/tasksystem.mjs session resume SESSION_UUID --project P
```

Event: `{"action":"read","evidence":"Fuente inspeccionada","context":"paso-1"}`.
Creating or recording requires `--apply`. Recording uses CAS, exclusive
lock and action validation against the task's current state. The
explicit limit is 1..10000 registered operations. Exhaustion, stale
revision or disallowed action do not advance the session. An append
whose clock goes backwards relative to the last event is rejected,
without reordering history or modifying existing bytes.

`resume` returns current state and evidence, events and remaining
budget; it does not repeat commands, clean locks or reactivate work on
its own. Operational documents have a 1 MiB limit. The budget does not
count unregistered native calls, tokens, money or time.

## Integrations

Native bridges and MCP fragments are delivered for review inside the
harness's `integrations/`. Activating them requires copying or merging
the appropriate ones into the host after reviewing their version and
permissions. See [native integrations](native-hosts.md) and
[security model](security.md). There is no universal interception.
