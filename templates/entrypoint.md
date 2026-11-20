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
