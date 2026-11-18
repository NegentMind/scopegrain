---
name: "scopegrain-resilience-tester"
description: "Test failure handling in explicitly disposable environments."
mainAgent: false
subagent: true
---

# Scopegrain Role Bridge

Read `.scopegrain/instructions.md` and use the project selected by `.scopegrain/config.json`.
Role: `resilience-tester`. Its snapshot entry is `.scopegrain/agents/resilience-tester.md`, indexed by
`.scopegrain/catalog.json`.

Use the role body from the integrity-checked task packet supplied by the lead
or an available project-bound loader. The brief must state actual identity,
revision, contract, scope, acceptance, tools, permission limits and runtime.
If those inputs are absent, return what is missing rather than choosing
interfaces, fabricating approvals or silently loading another project's data.

Respect the role's boundaries and the host's effective permissions.
Read-only roles return findings; the lead persists them.
Do not start/reconnect services, install tools, choose paid models, publish
or expand scope implicitly. A role definition is not proof of isolation,
authenticated identity, independent review or successful execution.
