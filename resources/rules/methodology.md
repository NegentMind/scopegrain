# Methodology — Rules

> **Scope:** how work is selected, sized and executed under Organic Driven
> Development (ODD): mode proportionality, request fidelity, read-only
> intents, and precedence between methodology text and runtime gates.
> **Not here:** rule loading and workflow mechanics (`workflow.md`), what
> counts as proof (`evidence.md`), when to ask the owner
> (`human-decisions.md`), authorization boundaries (`safety.md`), retry and
> escalation policy (`research-escalation.md`).
> **Status:** Active
> **Sources:** scopegrain workflow contract (`policy/workflow.json`).

ODD means Organic Driven Development. Inspect existing behavior, establish
authority, resolve uncertainty and select proportionate work.

## Rules

### 1 — Honor the selected project mode

- **Must:** keep light work to one bounded task record, authorized scope and
  real verification/review evidence; route sensitive or substantial work
  through SDD with current content-bound approvals and scenario traceability.
- **Must not:** impose the formal specification/design/approval chain on
  light work, or run substantial work without it.
- **Why:** proportionality is the methodology's core trade — under-formalized
  substantial work loses traceability; over-formalized light work wastes it.

### 2 — Unknown risk is not low risk

- **Must:** classify work by what is known about security, data, shared
  contracts, concurrency and external effects — never by diff size.
- **Must not:** justify weaker treatment of a change because the diff is
  small.
- **Why:** a one-line change to a shared contract or a security boundary can
  break every consumer; size is not a risk proxy.

### 3 — Questions and proposal-only requests stay read-only

- **Must:** treat a question or a proposal-only request as read-only:
  inspect, analyze and answer without mutating anything.
- **Must not:** implement, migrate or "fix" in response to a question.
- **Why:** the request defines the authorized scope; a question grants none.

### 4 — Preserve the original request; invent nothing

- **Must:** keep the request's stated intent, constraints and facts as given;
  surface consequential ambiguities to the owner (`→ see human-decisions.md`)
  and disclose every missing check or unavailable runtime capability
  (`→ see evidence.md`).
- **Must not:** invent decisions, metrics, approvals, research, tools, test
  results or authenticated identity.
- **Why:** fabricated approvals or results corrupt the record the owner
  relies on; an ambiguity silently resolved is a decision stolen.

### 5 — Host rules and runtime gates prevail over methodology text

- **Must:** defer to existing host/repository instructions and actual
  runtime gates when they conflict with this document; treat classification
  and outcome evidence as attributed attestations, not proof of semantic
  truth (`→ see evidence.md`).
- **Must not:** treat methodology text as a sandbox or a universal tool
  interceptor.
- **Why:** the methodology describes judgment, not enforcement; pretending
  otherwise produces false confidence about what was actually blocked.

## Rules for rules (authoring)

- One area per file. Declare the scope in the header and do not overlap with
  another file; cross-reference instead (`→ see <file>.md`). Check the catalog
  before creating a new rule file.
- Header format: `# <Area> — Rules`, then `> **Scope:**`, `> **Not here:**`
  (areas owned by other files), `> **Status:**` (Active | In review |
  Obsolete), `> **Sources:**` (supporting decisions/research, if any).
- Numbered imperative rules: `### <N> — <short imperative title>` with
  `Must:`, `Must not:` and `Why:`. The `Why:` is mandatory — a rule without a
  reason gets ignored. Optionally `Exceptions:` and `Fixes:`.
- Be specific and imperative: "wrap X in Y", not "it would be good to
  consider". When citing code, name the symbol — line numbers drift.
- Do not duplicate content across rules, references and skills: rules are
  hard constraints, references are consultation material, skills are
  procedures. Each statement lives in exactly one place.
- A rule loaded for a touched area is mandatory: it cannot be skipped or
  relaxed without an explicit, recorded exception (`→ see workflow.md`).
- Rule lifecycle: add new rules at the end of their file, numbered
  sequentially, starting at `In review` status until the owner approves;
  edit existing rules in place and annotate material changes with
  `<!-- Changed YYYY-MM-DD: reason -->`; mark a rule `Obsolete` with its
  reason instead of deleting it — the owner decides deletion.
- Rule text is authored in English as the source of truth
  (`→ see workflow.md` documentation language).
- Before merging a rule change, verify the file parses, the scope does not
  collide and the index/catalog is updated.
