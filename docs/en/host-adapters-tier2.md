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
existing adapters. Adapter scaffolding does not declare product support: the
README matrix classifies `copilot` and `cursor` as `absent` unless a
`supported` or `experimental` integration is declared.

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

## Implementation status (2026-11-24)

All five candidates were implemented after verifying the actual
conventions against current official documentation (sources in the
`policy/native-adapters.json` blocks). Divergences from this evaluation:

- **kilo**: the current product (kilo.ai, derived from OpenCode) uses
  `.kilo/` roots and `kilo.jsonc` with the `mcp` key
  (`type: "local"`), not `.kilocode/mcp.json`. The adapter targets
  `.kilo/`; the rules bridge uses `.kilocode/rules/` because it is the
  legacy directory the docs declare auto-included (`.kilo/rules/` only
  loads via `instructions` globs).
- **cline**: subagents are `.yaml` files under `.cline/agents` (CLI/
  Desktop only, per the repo loader) — no agent bridges are emitted. Its
  MCP is global-only (`~/.cline/data/settings/cline_mcp_settings.json`;
  the VS Code extension uses globalStorage).
- **roo**: no markdown agent surface (modes are YAML); skills
  `.roo/skills/` verified since v3.38.0; commands `.roo/commands/`;
  AGENTS.md with `useAgentRules` on by default.
- **gemini-cli**: implemented — the `commandFormat: 'toml'` extension
  turned out bounded (enum + validator + one render branch). Skills
  `.gemini/skills/` verified in docs and source; `GEMINI.md` entrypoint
  (AGENTS.md is opt-in via `context.fileName`); no agents.
- **windsurf**: implemented as a variant of the legacy Cascade surface
  (`.windsurf/skills|workflows|rules`, `AGENTS.md`). Its renamed product,
  Devin Desktop, reads the `.devin/` roots of the existing devin
  adapter; MCP is global-only (`~/.codeium/windsurf/mcp_config.json`).

Associated contract change: `agentRoot`/`agentFormat` are now optional in
policy — hosts without a documented markdown agent surface simply do not
declare it, and the absence of `agent/*` bridges is classified
structural in parity. Global MCP destinations use `kind: 'mcp-global'`
so the GLOBAL_DEST classification excludes them from `doctor`'s merge
targets.

None has a native pilot: `compatibility: documented-only` for all five.
