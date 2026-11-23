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

## Investigation discipline

- Read the project's own instruction files before its code — they are the
  highest-density signal for conventions, boundaries and forbidden zones.
- Classify every finding: **observed fact** (file/path evidence cited),
  **inferred convention** (pattern repeated across files, marked as
  inference), **unanswered question** (routed to the owner, never guessed).
- Check whether the requested capability already exists before planning
  its construction — search the codebase, the backlog and the completed-
  work registry.
- Verify nothing is silently writable outside the authorized project root.

## Session-start ritual (once the harness is live)

At the start of every work session, in order:

1. **Load the session packet** — read the project instructions, the
   configured knowledge file, task state, recent worklog entries, open
   goals and pending events (e.g. `scopegrain context --project .`).
2. **Check repository state** — uncommitted changes? last commits?
   (`git status --short`, `git log --oneline -5`). Foreign uncommitted
   work is preserved and reported, never absorbed.
3. **Check for in-progress work** — resume recorded state rather than
   restarting from conversation memory.
4. **Load only task-relevant capabilities** — per `select-capabilities`;
   read the selected skill bodies and the rule/reference files for the
   exact area touched, not the whole catalog.
5. **Verify environment only when the task touches it** — toolchain
   version checks and the project's fast verification command.

At session end: run `session-handoff` (register completed work, distill
lessons, save the handoff record) and the project's close-out checks.

## Harness self-audit (who watches the harness)

When harness files change (commands, agents, skills, prompts, rules,
references) or drift is suspected, audit the harness — not the product:

**Scope:** the harness configuration surface only — `.scopegrain/` state
layout, the active host bridge directories, command/skill/agent/prompt/
rule files and manifests. Product code, releases and product performance
are out of scope (other roles own them).

**Procedure:**

1. Determine the audit scope: the diff inside the harness surface
   (`git diff --name-only HEAD`, fallback `HEAD~1`); a full audit when
   there is no diff.
2. Run the checks below, each finding with `path:line` evidence — a claim
   without evidence is not a finding.
3. Verdict is binary: **healthy** | **changes required**.
4. Findings at or above the agreed severity become findings rows in the
   active registry with origin recorded; the report lands under
   `.scopegrain/reports/` with an index row.
5. The auditor reports; it does not implement fixes. Implementation is a
   separate role/action.

**Checks, in order:**

- Per changed skill: structural verification where tooling exists.
- Count drift: skill/agent/command directories vs manifests and indexes —
  an unregistered directory is drift, not activation.
- Declared limits vs real permissions: instruction tables that contradict
  actual role/agent permission blocks.
- Thin routers: commands route to skills/runbooks; logic duplicated in a
  command is a defect.
- Portability: absolute paths, machine-specific paths, host names baked
  into shared resources.
- Cross-layer references: links and paths between commands, skills and
  references that no longer resolve.
- Templates citing deleted files.

**Resolution rule:** paths written inside harness resources resolve
against the **project root**, not the harness directory — an external
linter resolving them against the harness dir produces false positives;
document them as such, do not "fix" the references.

## Reference-file discipline

Keep long-form references out of the always-loaded instructions; consult
them lazily:

- Read a reference file only when its trigger applies (a specific error,
  a bug workflow, a tool's output format).
- If a file was read to solve an issue and the solution is undocumented,
  **add the missing entry** in the file's own format.
- Keep the established structure when editing (section table, code blocks
  for commands); frontmatter, links and `kind`/path conventions for new
  documents are `documentation-and-adrs`' domain.
- Area rules are hard rules: load exactly the file for the area being
  touched; never skip or relax one; never bulk-load the whole set.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "Detection found the stack, just write the config" | Detection is a proposal, not authorization — the owner confirms every choice. |
| "A docs/dev default exists in other projects" | Artifact paths are never assumed from convention; they come from explicit answers. |
| "Applying now saves a round-trip" | Preview-first exists so generated files are reviewed, not trusted blindly. |
| "This folder is unused, I can reuse it" | Another harness's active bridge folder is never mixed, overwritten or damaged. |

## Red Flags

- A configuration written without a preview or without owner consent.
- Secrets or private session data inside generated configuration.
- `.scopegrain/` state mixed into a host bridge folder, or one harness's
  bridge damaged by another's activation.
- Assumed `docs/dev` paths that were never confirmed.
- Verification commands executed during onboarding instead of proposed.
- A merge that silently overwrote existing instructions or host config.

## Verification

- [ ] The authorized project root was confirmed; nothing was written
      outside it.
- [ ] Findings are classified: observed fact (with evidence), inferred
      convention (marked), unanswered question (routed to owner).
- [ ] Every generated file was previewed before `--apply`; consent was
      explicit.
- [ ] `scopegrain doctor` (or the equivalent health check) was run after
      activation and its output reported.
- [ ] Unverified integrations and remaining semantic gaps were stated.

## Boundaries

- Preview before write, always; `--apply` only on explicit consent.
- Detection is not authorization: detected stacks, hosts and candidate
  verification commands are proposals until the owner confirms.
- Never copy secrets, tokens or private session data into configuration
  or generated files.
- Onboarding configures the harness; it does not authorize installs,
  network calls, pushes or workflow activation.

## See Also

- `context-engineering` — the rules-file and context hierarchy onboarding
  bootstraps.
- `select-capabilities` — lazy capability loading after the harness is live.
- `session-handoff` — the session-end record the ritual delegates to.
- `documentation-and-adrs` — authoring conventions for documents created
  during or after onboarding.
