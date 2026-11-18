# Task workflow and evidence

> English translation of the canonical Spanish document
> (`../task-workflow.md`). The Spanish version prevails.

Factual description of the task commands, the review progression and
the evidence format per `policy/workflow.json` and
`docs/implementation.md`. The examples are synthetic: they are not
execution results.

## Compatibility and methodology

The historical examples on this page use V1 tasks in `manual` mode.
Under `organic-sdd` or `sdd`, a creation without the required
metadata does not represent an authorized task. The
[Organic and SDD](methodology.md) guide describes lightweight
records, V2 specifications/designs, approvals, scenarios and linked
reports.

ACT and ACCEPT keep the workflow edges and add the mode/record
gates. An allowed methodology query does not by itself authorize a
transition or native tools. Revoking consent may remove `edit` from
a task that was already in ACT.

## States and transitions

The canonical state machine is in `policy/workflow.json`:

```text
PLAN -> ACT | RESEARCH | STALL
ACT -> VERIFY | STALL
VERIFY -> COLLATERAL | EVALUATE | ACT | STALL
COLLATERAL -> RESEARCH | ACT | EVALUATE | STALL
RESEARCH -> PLAN | ACT | STALL
EVALUATE -> REVIEW | ACT | STALL
REVIEW -> ACCEPT | ACT | STALL
ACCEPT -> CLOSE | ACT | STALL
STALL -> PLAN
CLOSE -> (terminal)
```

There is one exception that is not a policy edge: `REVIEW -> REVIEW`
is admitted in code exclusively as an evidence attachment. It allows
accumulating `verification` and/or `review` while the task is parked
in REVIEW, without the detour via ACT that would empty the stored
evidence. The state stays in REVIEW and the review advances as in
every CAS transition. A `REVIEW -> REVIEW` without evidence is
rejected (`INVALID_TRANSITION`): an empty self-transition would only
add noise to the history. Self-loops of any other state remain
invalid.

Allowed actions per state (also in the policy): `read` in all;
`research` in PLAN/COLLATERAL/RESEARCH; `propose` in PLAN/ACT/VERIFY/
COLLATERAL/RESEARCH; `edit` only in ACT; `verify` in VERIFY;
`evaluate` in EVALUATE; `review` in REVIEW.

## CLI commands

```powershell
# Create (PLAN state, revision 0, own UUID): via --input JSON with
# preview by default; --apply persists
node .\bin\tasksystem.mjs task create --project P --input task.json [--apply]
```

`task.json` carries `{title, contract, authorContext, scope}` plus
the mode metadata: a `methodology` assessment under `organic-sdd`
(`schemas/organic-assessment.schema.json`) or the `specId`+`designId`
pair. The flags form `--title/--contract/--author [--scope] [--spec
--design --plan]` remains available only in projects with
`methodology: "manual"`, where it creates the V1 task directly;
under `organic-sdd` or `sdd` without the formal pair it fails with
`METHODOLOGY_REQUIRED` pointing to `--input`.

```powershell
# List / show
node .\bin\tasksystem.mjs task list --project P
node .\bin\tasksystem.mjs task show --project P <UUID>

# Transition (mandatory CAS with --revision N)
node .\bin\tasksystem.mjs task transition --project P <UUID> ACT --revision 0
node .\bin\tasksystem.mjs task transition --project P <UUID> VERIFY --revision 1 [--evidence evidence.json]

# Check an action in the current state
node .\bin\tasksystem.mjs task check-action --project P <UUID> edit
```

`--config` points to an alternative config in any of them.
`--evidence` only accepts the `verification` and/or `review` keys.

## Typical progression

1. `create` -> PLAN, revision 0.
2. `transition ... ACT --revision 0` -> ACT, revision 1.
3. `VERIFY --revision 1` -> revision 2.
4. `EVALUATE --revision 2` -> revision 3.
5. `REVIEW --revision 3` -> revision 4.
6. `ACCEPT --revision 4 --evidence e.json` -> revision 5, requires evidence.
7. `CLOSE --revision 5` -> revision 6, terminal.

If the expected revision does not match the stored one:
`REVISION_MISMATCH`. A transition forbidden by the policy:
`INVALID_TRANSITION`. An existing lock (`<id>.json.lock`):
`TASK_LOCKED`, never recovered automatically.

## Evidence format (declared attestations)

`verification` requires non-empty checks; each check requires
`command`, `cwd`, `status:"pass"` (the only one accepted by the
policy) and non-empty `evidence`. `review` admits two modes, both
with `verdict:"approve"`:

```json
{
  "verification": {
    "checks": [
      {"command": "npm test", "cwd": ".", "status": "pass", "evidence": "output.log"}
    ]
  },
  "review": {
    "mode": "fresh", "reviewer": "agent-b",
    "authorContext": "ctx-a", "reviewerContext": "ctx-b",
    "verdict": "approve"
  }
}
```

`waived` alternative: `{"mode":"waived","owner":"...","reference":"...",
"reason":"...","verdict":"approve"}`. In `fresh` mode, `authorContext`
must match the stored author and `reviewerContext` must be non-empty
and different. These are recorded declarations, not authenticated
identity.

## Invalidation

- Returning to `ACT` clears the stored `verification` and `review`;
  approval cannot be carried over from a previous implementation.
- Attaching a new `verification` without `review` in the same call
  invalidates the previous review. This also applies to the
  `REVIEW -> REVIEW` attachment: to keep the review it must be
  resent or attached in a later self-transition.
- A transition rejected by validation or by the policy leaves the
  file, the state and the revision intact. This does not promise
  recovery from hardware failures or a power cut mid-write.

## Scope and reads

`scope` is a list of normalized relative paths. Creation validates
destinations and the V2 gates revalidate their current containment;
a historical reader is not a continuous check of permissions or
foreign references. `..` and reserved prefixes are not accepted.
`list` returns `{tasks, malformed}`; corrupted or non-UUID-named
files are reported, never silently discarded.
