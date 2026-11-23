---
name: specify-change
description: Define an observable outcome and falsifiable change requirements.
---
# Specify a Change

Invoke `spec-driven-development`, `outcome-driven-development` and
`clarify-intent`. If requirements are ambiguous, also invoke
`resolve-ambiguity` to extract what the owner actually needs.
Ask consequential questions with `prompts/decision-request`.
Governing rules: `rules/api-contract`, `rules/methodology`.
Roles: `requirements-analyst` drafts, `architect` reviews boundaries.

This command produces the standalone feature/change spec. The lighter
mini-spec embedded in a task record uses `prompts/spec-brief` — same
decision-table depth, task scope.

## Step 1 — Context first (do not ask what the code already answers)

Before any question, derive everything possible from the repository:

1. Inspect the affected area: structure, patterns, actual stack
   (`references/architecture` boundaries). Use graph tooling when indexed
   and fresh, else source search (`references/graph-investigation`).
2. Read existing docs: README, prior specifications, architecture
   decision records, earlier specs; check the existing
   `references/definition-of-done` conventions before writing acceptance
   criteria.
3. Read prior recorded decisions in the configured decisions path.
4. If a decision involves an external library/API/technology, validate it
   against official documentation after network permission
   (`web-research`) **before** proposing it as an option. A cited
   tradeoff is worth more than an adjective.

Every fact derivable from context enters the spec directly as a **decided**
item with cited evidence (`ref: file:line`). This minimizes questions.

## Step 2 — Open-decision table

List only what context cannot answer. Each row needs at least two real
alternatives with a one-line tradeoff; if only one path is viable, record
it as decided-by-evidence — never pad with filler options.

| # | Decision | Options (+tradeoff) | Recommended default |
|---|----------|---------------------|---------------------|
| 1 | e.g. session vs token auth | session (simple, revocable) / token (stateless, complex revocation) | session |

If nothing is open (all derivable), skip to Step 4.

## Step 3 — One decision round

Ask all open questions in a single round, each with concrete options and
the recommended option first (`prompts/decision-request`).

- Never open-ended questions without options ("what do you want?").
- If the host exposes no question interface, emit the Step 2 table as a
  structured report and **stop** — never assume answers.
- Record responses in the table's resolved column and in the configured
  decisions path. A skipped or refused question is not approval.

## Step 4 — Write the specification (max 1 page + links)

Cover the six core areas using context (Step 1) and answers (Step 3):
objective, interfaces/commands, project structure, code style, testing
strategy, boundaries. The detail lives in linked decision records; a
five-page spec is neither read nor maintained.

Persist the spec in configured harness paths, not product docs
(`rules/methodology`). Record the key decision in the decisions path.
Consider an ADR per architectural decision (`documentation-and-adrs`).

Decision gates before writing:

- Do prior specs, ADRs or design docs exist? Read them first (Step 1).
- Is the objective clear enough for testable acceptance criteria? If not,
  it is another row of the Step 2 table.
- Does the stack need validation? Validate against official docs or an
  authorized local check; a mechanical gate run on a markdown spec is a
  no-op.

## Authority and verification

One question round, then the spec is written from recorded answers —
never from assumed ones. Decisions persist through approved harness
operations into the configured decisions path; the spec artifact goes to
the configured harness spec path, not product documentation.

## Output contract

```markdown
# Spec: [Project/Feature Name]

## Objective
[1-2 lines]

## Target Users
[who, what problem]

## Core Features
- [ ] Feature 1: [AC: what "done" looks like]

## Tech Stack
[language, framework, deps, constraints]

## Boundaries
- Always: [patterns to follow]
- Ask first: [decisions requiring approval]
- Never: [prohibited patterns]

## Testing Strategy
[how to verify each feature]

## Project Structure
[file tree or module layout if known]
```

Return the approved contract or the unresolved questions. Recorded
decisions land in the decisions path; the spec itself in the configured
spec path.

## Red flags

- Filler options invented to make a row look complete.
- An open question asked without concrete options, or a skipped answer
  treated as approval.
- An external stack proposed before validation against its primary
  documentation.
- Implementation started inside this command — `plan-work` consumes the
  spec next.

## Handoff

`plan-work` consumes the settled spec; `implement-task` consumes a
single-task spec directly for light scope.
