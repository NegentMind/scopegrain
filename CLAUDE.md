# Scopegrain

Read `.scopegrain/instructions.md` before working on this repository.
Project configuration: `.scopegrain/config.json`.
Existing higher-priority instructions and explicit user decisions still apply.
Scopegrain provides a workflow, not a sandbox for native agent tools.

## Session start

At the start of every session, before the first task action, load the
session-start packet: run `node bin/scopegrain.mjs context --project .`.
It is read-only. `.scopegrain/context.md` is the user's persistent session
knowledge: read it every session, do not edit it without asking the owner.

Read AGENTS.md and follow the repository instructions before making changes.
Read docs/architecture.md for module boundaries.
Do not execute tests, services or installations without owner authorization.
