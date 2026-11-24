# Scopegrain

Read `{{instructionsPath}}` before working on this repository.
Project configuration: `{{configPath}}`.
Existing higher-priority instructions and explicit user decisions still apply.
Scopegrain provides a workflow, not a sandbox for native agent tools.

## Session start

At the start of every session, before the first task action, load the
session-start packet: run `scopegrain context --project .` (or the project's
equivalent invocation). It is read-only and returns the project instructions,
the user-owned knowledge file, task state, recent worklog entries, open goals
and pending journal events.

`{{configPath}}`'s directory may hold a `context.md` file. It is the user's
persistent session knowledge (like AGENTS.md but harness-owned): read it every
session, do not edit it without asking the owner.

## Language

Canonical instructions and catalog resources stay in English; operational
artifacts this harness records or generates (task records, journal and
worklog entries, generated documents) follow the project `locale` declared
in `{{configPath}}`.

## Request intake

When the packet's `intake.mode` field is not `off`, classify each user
request per the `intake` command resource before acting: a pure question
gets an answer with no record; one bounded change gets a task record; a
multi-part request gets a plan record. A persisted record in PLAN state
is bookkeeping, not authorization to implement.

## Self-repair

When the harness itself misbehaves, work this list before guessing:

- `scopegrain` fails to start (MODULE_NOT_FOUND, stale shim): the
  installed entry point is stale — reinstall from the source checkout
  (`npm install -g <checkout>`) or bypass the shim with
  `node <checkout>/bin/scopegrain.mjs <command>`; every command also
  runs through that equivalent invocation.
- Node older than 22: upgrade the runtime; the CLI requires >=22.
- Config or path errors on first use: the project is not initialized —
  run `scopegrain init --project .` (dry-run) and review before
  applying.
- Project-level problems: `scopegrain doctor --project .`. Every
  failing check carries a `fix` field with the repair command or
  action; propose it to the owner instead of executing writes
  silently.
- Stale structure index in the session packet: run the packet's
  `structure.recommendedCommand`
  (`scopegrain structure refresh --project . --apply`).
