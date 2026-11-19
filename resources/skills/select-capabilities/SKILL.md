---
name: select-capabilities
description: Use when choosing capabilities for a task or inspecting catalog and dependency availability
---
# Select Capabilities

Inspect the catalog and select only procedures relevant to this task.
Check required tools, scope, provenance and activation status.
Read selected skill bodies and necessary references, not all resources.
An archived entry is not approved for activation by existing on disk.
Report unavailable dependencies and degrade explicitly; do not fabricate
a tool, load private history or install an integration without consent.

Before finalizing the selection consult the outcomes log
(`memory list --log outcomes` or the `skillOutcomes` rates in `metrics`):
historical ok/fail rates per skill are a real signal — prefer skills with
a recorded success history and treat untried ones as higher-risk, not
inferior. Record what you chose in `task.skills` so the loop stays fed.
