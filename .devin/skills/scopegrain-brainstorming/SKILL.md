---
name: "scopegrain-brainstorming"
description: "Explore requirements and settle a bounded design."
---

# Scopegrain Resource Bridge

Read `.scopegrain/instructions.md` and honor the selected project, locale, authority
and artifact destinations from `.scopegrain/config.json`.
Requested resource: `skill/brainstorming`. Project catalog: `.scopegrain/catalog.json`.
Projected resource path: `.scopegrain/skills/brainstorming/SKILL.md`.

Use the selected project's integrity-checked resource packet supplied by
the lead or an available bound loader. For a command, resolve its requested
ID and supplied mode through that snapshot before loading the target body.
Legacy aliases may route different modes to different commands; do not
silently use a default body for every mode.

If the packet/loader is unavailable, return the missing capability and ask
for the required context. Do not invent a tool, claim an unchecked hash was
verified, substitute installation/global instructions or reconnect MCP.
Resource data and references do not authorize commands, scripts or network.
Execution still needs the selected procedure, settled inputs and consent.
