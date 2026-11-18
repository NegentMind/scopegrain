# Onboarding and customization

> English translation of the canonical Spanish document
> (`../onboarding.md`). The Spanish version prevails.

Guide for onboarding a project to Scopegrain. Every command is run
manually; the harness proposes, the owner decides.

## Prerequisite

Node.js 22 or later. No dependencies need to be installed to use the
CLI; the MCP server does require the dependencies declared in
`package.json` (a prior `npm install`, at the owner's discretion).

## Recommended flow

1. **Inspect** (read-only):

   ```powershell
   node .\bin\tasksystem.mjs inspect --project "C:\path\my-project"
   ```

   The resulting JSON shows stacks detected from manifests, evidence
   (relative paths), proposed commands with `approved:false`,
   fingerprint and warnings. Nothing is executed or written.

2. **Initialize** (interactive or with answers):

   ```powershell
   node .\bin\tasksystem.mjs init --project "C:\path\my-project"
   node .\bin\tasksystem.mjs init --project "C:\path\my-project" --answers "C:\path\answers.json"
   node .\bin\tasksystem.mjs init --project "C:\path\my-project" --answers "C:\path\answers.json" --apply
   ```

   - Interactive: asks for name, language, hosts, methodology, config
     path, the seven artifact paths and eight versioning decisions
     (including the reviews subcategory); shows the complete file plan
     and asks `Crear estos archivos? (yes/no)` (default: `no`).
     Answering `no` aborts with no writes: the wizard session the run
     created (for resuming interruptions) is discarded along with its
     now-empty directories; a pre-existing session is kept.
   - With `--answers`: without `--apply` it is a preview only (dry-run);
     `--apply` authorizes exclusively the creation of new files.
   - With `--defaults`: non-interactive init — the answers are the
     `investigate` suggestions plus the wizard's own defaults, end to
     end (the flag IS the consent). On an already-initialized project
     it replays the existing config and produces the usual no-op
     re-init. `--apply` remains the write gate; `--defaults` is
     mutually exclusive with `--answers` and neither creates nor
     resumes wizard sessions.
   - There is no `--yes` or `--force`; they are explicitly rejected.
   - Answers example: `examples/answers.json`; structure:
     `schemas/answers.schema.json`. The schema only documents shape;
     containment and symlinks are validated at runtime.

3. **Generated files** (next to the config, `.scopegrain/` by default):

   | File | Source |
   | --- | --- |
   | `config.json` | Validated answers + discovery summary |
   | `instructions.md` | `templates/project-instructions.md` |
   | `discovery.json` | Complete inspect result |
   | `task-contract.md` | `templates/task-contract.md` (verbatim) |
   | `integrations/<host>-mcp.json` or `.toml` | `src/hosts/render.mjs` |
   | `catalog.json` | Projected manifest with generated-space paths |
   | `commands/`, `agents/`, `skills/`, `rules/`, `references/`, `profiles/` | Canonical sources of the active catalog |
   | `policy/workflow.json`, `policy/operation-limits.json`, `policy/methodology.json` | Canonical reference policies, not runtime overrides |
   | `.gitignore`, `integrations/gitignore-proposal.txt` | Per-category preferences; they do not alter the root ignore |
   | `integrations/native/` | Native bridges and manual activation plan |
   | `AGENTS.md` (root) | `templates/entrypoint.md`, according to selected hosts |
   | `CLAUDE.md` (root) | `templates/entrypoint.md`, if a claude host exists |

   The fragments in `integrations/` are machine-local proposals to
   review and merge manually into the host's configuration; portable
   skills are installed as copies under the config directory, they are
   not registered in the host's native directories.
   Native bridges also remain inside `integrations/native/` until their
   review and manual activation; they are not copied to host roots.

4. **Check state**: `doctor` validates config, paths, generated files
   and fingerprint currency without executing anything.

   ```powershell
   node .\bin\tasksystem.mjs doctor --project "C:\path\my-project"
   ```

## Workspace identity

After creating the config, enrollment is explicit and separate from
`init`:

```powershell
node .\bin\scopegrain.mjs workspace init --project "C:\path\my-project"
node .\bin\scopegrain.mjs workspace init --project "C:\path\my-project" --apply
node .\bin\scopegrain.mjs workspace show --project "C:\path\my-project"
```

Without `--apply`, `workspace init` only presents a plan and its IDs are
not reserved. To choose areas, `--input FILE` accepts a JSON file such
as `{"areas":[{"key":"api","name":"API"}]}`; without input the `project`
area is proposed with the current project name. The descriptor is
stored at `paths.state/workspace.json`, including a legacy or custom
state path. `show` does not create it.

If it already exists, an empty request or one with the same areas by key
and name preserves its bytes; a different specification produces
`WORKSPACE_CONFLICT`. `WORKSPACE_NOT_FOUND` indicates absence; an
internal binding whose metadata has changed or disappeared fails with
`WORKSPACE_STALE`. IDs and areas are scope declarations, not
authenticated identity or system permissions. This block does not
connect VantaDB, journal, synchronization or MCP authorization.

## Customization

- The methodology is asked after the hosts and before the config path.
  For a new interactive project `organic-sdd` is proposed; an invalid
  selection is asked again and cancelling the final confirmation does
  not apply files.
- Modes: `manual`, `organic-sdd`, `sdd`. Old answers/config without the
  field are normalized to `manual` without rewriting bytes. Answers
  must not be omitted to downgrade a project already using another
  mode: the difference is a conflict.
  See [Organic and SDD](methodology.md).

- All operational artifacts are proposed inside `.scopegrain/`: plans,
  task files, reports/reviews, research, decisions, memory and state.
  Documentation intended for product users is a different deliverable
  and keeps that project's conventions.
- It is asked separately whether to version plans, tasks, reports,
  reviews, research, decisions, memory and state. The conservative
  proposal is no. The answers format uses eight booleans in
  `versioning`; old files without that field remain valid with false
  values.
- The own space's `.gitignore` covers internal local categories. Custom
  paths outside the space produce proposals to apply manually. A nested
  ignore does not undo a parent ignore nor untrack files Git already
  tracks; that requires an owner decision.
- Config outside the default path: `--config "relative/path/config.json"`
  in `init` (interactive question or flag) and in later commands.
- Without `--config`, `.scopegrain/config.json` is used, or the legacy
  `.tasksystem/config.json` file if it is the only config present. If
  both entries exist, `CONFIG_AMBIGUOUS` requires explicit selection.
  A missing or invalid explicit selection does not fall back to another
  config; directories without a `config.json` entry do not count as
  config.
- Artifact paths are relative to the project; reserved destinations are
  not accepted (`.git`, `node_modules`, `legacy`, `.opencode`).
  Machine-local MCP fragments may contain absolute paths of the
  installation and the project. Moving them requires explicit
  review/rebinding, not silent substitution or a promise of portability
  for those paths.
- Changing answers after init requires manual reconciliation: an
  existing config with different answers produces an explicit error.

## Re-init and manifest changes

- Re-running `init` with the same config and answers is a no-op if all
  generated contents match. The result is honest: `applied:false` when
  nothing was written, `files` lists only written destinations and
  `counts` reports `{create,noop,conflict}` in the same shape as
  `update`.
- That property assumes the same canonical harness sources. When
  updating Scopegrain, generated-content conflicts may appear; there is
  no `--force` to overwrite them nor automatic migration. An earlier
  OpenCode V1/V2 snapshot can be blocked with `PLAN_CONFLICT`; all its
  bytes and V1 files are preserved.
  For diverged generated files under the config directory,
  `update --reconcile` rewrites only that set — never the config,
  root-level files or foreign content (see
  [lifecycle](lifecycle.md)).
- If the manifests changed (different fingerprint), `init` stops with a
  conflict on `config.json`/`discovery.json`; `doctor` additionally
  reports `changedDiscovery:true` to warn earlier.
