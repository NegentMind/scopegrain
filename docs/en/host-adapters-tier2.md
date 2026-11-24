---
title: Tier-2 host adapter evaluation
kind: analysis
---
<!-- translated-from: docs/host-adapters-tier2.md @ 2026-11-24 -->
# Tier-2 Host Adapter Evaluation

> English translation of the canonical Spanish document
> (`../host-adapters-tier2.md`). The Spanish version prevails.

Analysis of the remaining candidates for `policy/native-adapters.json`
after `copilot` and `cursor` landed. This is an evaluation document, not an
implementation plan: nothing here is certified; each candidate would require
the same verified-sources, declarative-policy and native-pilot cycle as the
existing adapters.

## Current tier status

| Host | Covered surfaces |
| --- | --- |
| copilot | `.github/copilot-instructions.md` (managed-section entrypoint), `.agents/skills/<n>/SKILL.md`, `.github/agents/<n>.md`, `.vscode/mcp.json` merge (`servers`) |
| cursor | `AGENTS.md`, `.cursor/skills/<n>/SKILL.md`, `.cursor/agents/<n>.md` (`readonly` for read-only roles), `.cursor/rules/scopegrain.mdc` (`alwaysApply`), `.cursor/mcp.json` merge (`mcpServers`) |

## Candidates

### gemini-cli

- **Format**: context via `GEMINI.md`/`AGENTS.md`; custom commands in
  `.gemini/commands/<name>.toml` (TOML with `prompt` and `description`); MCP
  in `.gemini/settings.json` under `mcpServers`; skills coverage
  (`.gemini/skills`) requires source verification before being declared.
- **Cost**: MEDIUM. The declarative model keeps `commandFormat` closed
  (`skill|markdown`); TOML commands require extending the enum, the
  validator and a render branch (comparable to the codex TOML agent branch).
  Everything else (entrypoint, MCP fragment) is the existing pattern.
- **Priority**: MEDIUM. Relevant market share but the TOML command is the
  only candidate that touches the renderer contract.

### cline / roo code / kilo code

- **Format**: all three read `AGENTS.md` plus markdown rules directories
  (`.clinerules/`, `.roo/rules/`, `.kilocode/rules/`); `SKILL.md`-style
  skills verifiable per source; MCP: cline uses `cline_mcp_settings.json`
  (global path, manual merge), roo `.roo/mcp.json`, kilo
  `.kilocode/mcp.json` (`mcpServers` shape).
- **Cost**: LOW. Pure declarative markdown: one policy block per host plus
  one `*.md` rule per directory (same mechanism as the cursor `.mdc`) and
  one MCP fragment entry in `render.mjs`. Three hosts for the cost of one.
- **Priority**: HIGH. Maximum coverage per line of code; the risk is
  documentary (the three families diverge on rules frontmatter details),
  not structural.

### windsurf

- **Format**: `AGENTS.md` + `.windsurf/rules/` markdown; global MCP at
  `~/.codeium/windsurf/mcp_config.json` (never writable: global target).
- **Cost**: LOW as a devin variant (Cognition/Codeium family): a policy
  block with `.windsurf/` roots and the existing AGENTS.md entrypoint. The
  global MCP would be classified manual-only like hermes.
- **Priority**: MEDIUM-LOW. Surface overlaps devin; the real value is host
  detection, not new formats.

## Recommendation

1. **cline/roo/kilo** first: groupable low cost, no contract changes.
2. **gemini-cli** next, only if extending `commandFormat` with a TOML
   command dialect is accepted; it is the only schema change in the batch.
3. **windsurf** last: cheap but redundant with devin; do it if signal-based
   detection justifies it.

Every candidate lands as `compatibility: documented-only` and requires a
native pilot before any support claim.
