<!-- SCOPEGRAIN:BEGIN -->
# Scopegrain

Read `.scopegrain/instructions.md` before working on this repository.
Project configuration: `.scopegrain/config.json`.
Existing higher-priority instructions and explicit user decisions still apply.
Scopegrain provides a workflow, not a sandbox for native agent tools.

## Session start

At the start of every session, before the first task action, load the
session-start packet: run `scopegrain context --project .` (or the project's
equivalent invocation). It is read-only and returns the project instructions,
the user-owned knowledge file, task state, recent worklog entries, open goals
and pending journal events.

`.scopegrain/config.json`'s directory may hold a `context.md` file. It is the user's
persistent session knowledge (like AGENTS.md but harness-owned): read it every
session, do not edit it without asking the owner.

## Language

Canonical instructions and catalog resources stay in English; operational
artifacts this harness records or generates (task records, journal and
worklog entries, generated documents) follow the project `locale` declared
in `.scopegrain/config.json`.

## Request intake

When the packet's `intake.mode` field is not `off`, classify each user
request per the `intake` command resource before acting: a pure question
gets an answer with no record; one bounded change gets a task record; a
multi-part request gets a plan record. A persisted record in PLAN state
is bookkeeping, not authorization to implement.
<!-- SCOPEGRAIN:END -->

# Scopegrain - Repository Instructions

This repository develops a project-neutral engineering harness.

- Work only in the explicitly authorized workspace. Never change the source
  installation from which this repository was copied.
- Read README.md and docs/architecture.md before architectural changes.
- Check whether requested behavior already exists before planning.
- Keep core code independent of any coding-agent API or product domain.
- Treat policy/workflow.json as the canonical workflow contract.
- Keep model instructions in canonical resources/commands/, resources/agents/,
  resources/skills/, resources/rules/, resources/references/,
  resources/prompts/ or templates/, not scattered in executable code.
- Treat resources/manifest.json as the canonical resource catalog. Resources
  in project snapshots are not permission to activate hosts or run tools.
- Preserve existing user changes. Do not load or execute legacy/opencode/.
- Propose exact test/start commands and wait for the owner's authorization.
  Never claim unexecuted checks passed.
- Ask before network access, installations, destructive actions, publication
  or pushing. A local commit does not authorize a push.
- Validate paths and untrusted data at boundaries. Do not execute commands
  discovered in manifests and do not write outside an approved project root.
- Independent review requires a separate context or an explicit owner waiver;
  identifiers in evidence are declarations, not authenticated identity.
- Update documentation and tests with public behavior changes.
- Keep operational plans, reviews, notes and logs under the configured
  state paths (.scopegrain/ by default)
  rather than product documentation. Ask versioning preferences during
  onboarding.
- The initial archive is local-only pending provenance and license review.
