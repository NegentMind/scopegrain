---
name: project-onboarding
description: Investigate an unfamiliar repository and configure Scopegrain with explicit owner consent before generating artifacts.
---

# Project onboarding

1. Confirm the authorized project root and inspect existing instructions.
2. Check existing state and current harness signals:
   - When local command execution is authorized, run `scopegrain adopt --project <root>` to check whether `.scopegrain/config.json` already exists, or `scopegrain investigate --project <root>` on an uninitialized repository to collect `investigation` and `suggestions` (`unanswered`, detected stacks, unapproved verification candidates, and active harness signals).
   - Otherwise inspect the manifests directly and report that limitation.
3. Check architecture, package boundaries, tests, tooling, existing workflows
   and whether the requested feature already exists. Cite file evidence.
4. Separate observed facts, inferred conventions and unanswered questions.
5. Enforce per-harness isolation around `.scopegrain/`:
   - Keep `.scopegrain/` as the single canonical home for Scopegrain engine state, configuration, catalog snapshots, policies, and all seven operational artifact paths (`plans`, `tasks`, `reports`, `research`, `decisions`, `memory`, `state`).
   - Keep active native host bridges isolated in each harness's own project root (`.devin/` for Devin, `.agents/` for Antigravity, `.claude/` for Claude Code, `.codex/` for Codex, `.opencode/` for OpenCode). Never mix, overwrite, or damage another harness's active folder when adding a new host.
6. Interactively ask the owner to resolve gaps (`suggestions.unanswered`) and confirm choices:
   - Project name, documentation language (`es`/`en`), coding-agent hosts (including the currently running harness), and methodology mode (`organic-sdd`, `sdd`, or `manual`).
   - Configuration path and the seven artifact locations under `.scopegrain/`, plus the eight Git versioning flags. Never assume `docs/dev` or invent consent.
   - Use a resumable `<stateDir>/init-session.json` or an explicit `answers.json` matching `schemas/answers.schema.json` when configuring across turns.
7. Propose verification commands with their directory and source; do not
   execute them or copy secrets into the configuration.
8. Preview every generated file before writing:
   - On a new project: preview with `scopegrain init --project <root> --answers <file>`.
   - When adding a harness to an already-configured project: update `hosts` in `.scopegrain/config.json` and preview with `scopegrain update --project <root> --reconcile`.
   - If an instruction or host configuration already exists, stop and propose a reviewed merge.
9. Ask explicit permission to apply creation (`--apply`). Save approved preferences for reuse; if configuration changes are needed later, ask again.
10. Activate only the current harness in its isolated root after previewing:
   - Preview with `scopegrain host activate --project <root> --host <harness> [--surface <app-cli|ide>]` (for Antigravity, select `app-cli` for skills, subagents, and `.agents/mcp_config.json`, or `ide` for skills and `.agents/mcp_config.json`).
   - Apply with `--apply` only after owner confirmation, then verify with `scopegrain doctor --project <root>`.
11. Explain what was detected automatically, what still needs semantic
    investigation and which integrations remain unverified.
