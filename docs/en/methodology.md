<!-- translated-from: docs/methodology.md @ 2026-11-23 -->
# Organic and SDD

> English translation of the canonical Spanish document
> (`../methodology.md`). The Spanish version prevails.

ODD means **Organic Driven Development** in Scopegrain. Observable
outcomes are acceptance criteria, not another definition of ODD.
Observability-Driven Development is a different, optional capability.

The runtime classifies declared facts; it does not automatically deduce
that the agent understood the code or that an authentic owner authorized
the change. Manifest inspection does not demonstrate semantic
understanding either.

## Implementation status

Classification, V2 tasks/plans, configuration, approvals, evidence and
ACT/ACCEPT gates are implemented. The evidence and gate blocks have
scoped tests recorded in [verification](verification.md).
The local full foundation suite completed one test file at a time;
scope and separate runs are in [verification](verification.md). The
Devin Local native pilot was certified in a real session on 2026-11-17
and the Antigravity App/CLI pilot on 2026-11-19; Claude, Codex, OpenCode,
the Antigravity IDE surface and Hermes still lack a native pilot. This
guide does not certify behavior inside an uncertified host.

## Modes

| `methodology` config | Behavior |
| --- | --- |
| `manual` | V1 compatibility; does not impose a migration of old records |
| `organic-sdd` | Lightweight record or SDD chain according to the declared facts |
| `sdd` | Requires formal references for change work |

An old configuration without the field is normalized to `manual` in
memory, without rewriting its bytes. New interactive onboarding
proposes `organic-sdd` and asks for confirmation; it is not applied
silently.

A V2 record keeps its controls even if `manual` is selected. Switching
a project to a strict mode does not convert its V1 tasks to V2: they
remain queryable, but need appropriate metadata to pass the gates.
There is no implicit upgrade of history.

`intake.mode` is a separate configuration (`off` by default): it
controls whether the agent classifies each request into a record
(capture, task or plan) following the catalog's `intake` resource. It
changes neither the methodology nor any gate.

## Proportional classification

The evaluation uses intent, authorization, understanding, uncertainty,
risk and continuity need. It does not use the number of lines or files.

- A read-only question or proposal does not authorize ACT or ACCEPT.
- Missing/rejected authorization, insufficient understanding, pending
  uncertainty or unknown risk block the change.
- Named risks, continuity requiring a formal record or an explicit SDD
  choice require the formal route.
- Bounded, understood work can use the lightweight route: a task with
  original request, scope, classification, verifications and review.
  It does not need fictional formal documents.

MCP does not register or reclassify facts; `scopegrain_methodology_check`
queries gates on existing records and does not authorize tools.
The agent must investigate and present the real decisions; not invent
authorization nor reduce a risk to obtain a permitted result.
A request containing secrets must be redacted with approval before
being saved.

## Formal chain

1. Create a structured specification with request, outcome,
   requirements, scenarios, scope and open questions.
2. Create a design bound to that specification's current digest.
3. Create a task or plan with real references and assigned scenarios.
4. Obtain current approvals of specification, design and plan; without
   a plan, the task approval stands in as its mini-plan.
5. Check ACT, implement within scope and walk the workflow.
6. Record checks and coverage of the assigned scenarios.
7. At REVIEW, prepare a report with operator-supplied evidence,
   approve that report and supply independent review or explicit
   waiver.
8. Check ACCEPT and then CLOSE according to the canonical workflow.

Every formal task has at least one scenario, including preparatory
ones. If none is verifiable, a technical scenario must be agreed or the
work regrouped; the system does not invent requirements or accept an
empty list. The plan covers the complete union of the specification's
scenarios. Each task verifies only its assignments: it must not wait
for a successor's work to close its own contribution.

Transitive dependencies must be in CLOSE. Approving a plan does not
turn its tasks into executed ones nor start agents.

## Gates and permissions

ACT revalidates references, digests, plan membership, scenarios, scope
containment, absence of open questions, current approvals and closure
of dependencies. ACCEPT repeats those checks and requires exact
coverage of this task, verification, a current approved report and
review/waiver.

Scope paths are compared with their exact canonical spelling and
segment boundaries, without confusing `src/a` with `src/ab` or `SRC/a`.
UUIDs are resolved case-insensitively. Links and junctions are rejected
in containment checks.

Revoking consent or changing records invalidates the next gate. A block
occurs before creating the transition temp or replacing the task; own
locks are cleaned without recovering foreign locks.

A methodology query is **only a methodological check**. It does not
replace the workflow edge, `checkAction`, native permissions or
authorization for network, installations, publication or destructive
effects. A V2 task with empty scope may enter ACT, but does not receive
`edit` in `checkAction` or in the workflow package.

## Evidence and report

`verification` keeps `checks` and may include `coverage` and
`outcomeEvidenceId`. Each coverage contains `requirementId`,
`scenarioId` and a non-empty list of valid `checkIndexes`. Pairs cannot
repeat ignoring case. Indexes point to declared checks, not executed by
this validator.

The report is a V2 `report` artifact, not an additional type. Its
`data` has nine fields: `schemaVersion`, `taskId`, `taskRevision`,
`taskDigest`, `specId`, `specDigest`, `designDigest`, `planDigest`,
`verificationDigest`. The `data` version is 1; the artifact version is
2. Without a plan, `planDigest` is null.

The verification digest includes checks and coverage, excluding the
report's own identifier to avoid self-reference. The report binds the
REVIEW revision prior to the ACCEPT transition. A new implementation
round requires a current report, even if the textual checks match the
previous round's.

Returning to ACT clears verification and review. Attaching a new
verification invalidates the previous review unless another is supplied
explicitly in the same call. Including `outcomeEvidenceId` inside a new
verification at ACCEPT does not avoid this rule either.

### Operational order for a formal ACCEPT

1. `REVIEW` (or `REVIEW -> REVIEW`): attach the complete
   `verification`{checks, coverage} plus a valid `review` in one call.
2. `outcome create`: the report binds the current REVIEW revision and
   `canonicalDigest({checks, coverage})` of the stored verification.
3. `approval create` + `approval answer` for the report artifact
   (content-bound to its digest).
4. `task transition ACCEPT --evidence` carrying
   `verification`{the same checks+coverage,
   `outcomeEvidenceId`: report id} and `review`{...}. The attestation is
   evaluated on the candidate at `previousRevision` — the revision the
   report bound — so the locator belongs to the ACCEPT evidence itself.

Pitfall: a `REVIEW -> REVIEW` attach performed *after* `outcome create`
bumps the revision; the report goes stale
(`OUTCOME_BINDING_MISMATCH`) and must be recreated with a fresh
approval. Never attach `outcomeEvidenceId` through a self-loop.

## Interface and continuity

The new interface distinguishes work procedures (`plan-work`,
`implement-task`) from data operations (`specification create`,
`design create`, `approval`, `outcome create`, `methodology check`).
Creating a PLAN record or previewing an approval does not authorize
product. JSON creations preview by default; `--apply` is explicit.
Preview identifiers are not reserved.

Approval responses use expected revision and digest under CAS; they are
not applied as a generic file substitution. Old task/plan examples
without formal references require `manual` mode. The generic V1 `spec`
artifact is not a formal specification.

The runtime context is bound when loading the configuration or
starting MCP. After changing configuration/paths it must be resolved
again or the process restarted; there is no watcher. Project snapshots
do not replace the installed runtime's policies nor update silently.
There is no re-evaluation operation for blocked drafts: records must
not be covertly edited to make them pass. It may be necessary to create
an explicit new record and keep the previous one as history.

## Trust limits

Hashes bind validated records and declared payloads, not the complete
worktree, mutable log bytes or the truth of an assertion. Author,
reviewer and approver are attributed identities, not authenticated.
A historic report can be queried even if it no longer allows accepting
work.

There is no serializable transaction across all files nor continuous
permission locking. Path checks are not an operating-system sandbox
against hostile concurrent filesystem substitutions. Scopegrain does
not intercept native tools nor turn a prompt chain into a guarantee of
security or universal absence of hallucinations.

Investigation escalation is a policy and a procedure: record the causal
hypothesis, review repeated failures and request network access when
needed. It is not a hidden executor of searches, models or agents.

Enforcement boundary: the runtime only mechanizes the reworks counter —
`revisitDesignAfterAttemptsWithoutProgress` (3 `VERIFY→ACT` rework cycles
without a `RESEARCH` visit block `→ACT`). The causal-similarity half
(`investigateAfterSimilarFailures`, 2 causally similar failures →
investigate) is declared and NOT mechanized: failure hypotheses are not
a record field and causal similarity is never inferred from counts —
judging it remains the agent's obligation per
`resources/rules/research-escalation.md`.
