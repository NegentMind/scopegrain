---
name: organic-driven-development
description: Use for engineering requests to establish authority, inspect existing behavior, resolve uncertainty and select proportionate light or SDD work.
---
# Organic Driven Development

ODD means Organic Driven Development in Scopegrain. Observable outcomes are
acceptance criteria; Observability-Driven is a separate optional capability.

1. Establish intent and authority. Explanation, investigation and proposals
   remain read-only. Do not reinterpret a question as permission to implement.
2. Inspect the existing behavior and conventions before proposing a change.
   Bound the first exploration batch to what proves the change is understood
   — a few targeted reads or one focused search round — and widen only on a
   named gap. Extend the existing seam; do not duplicate an implemented API.
3. Resolve named uncertainty with source evidence or authorized public
   research. Decision order: continue when no human decision remains; ask
   through a compatible structured tool when a decision is required; use
   plain text only for genuinely open clarification; batch independent
   ordinary decisions where the host supports it; wait for the answer.
   Skipping, declining or a custom response does not silently authorize work.
4. Classify using understanding, risk and resumability, not file or line
   count. Apply the resume test: light work is what a fresh context could
   finish from the original request plus the current diff alone
   (`diff-sufficient`); anything whose rationale would be lost on restart is
   `record-required`. Unknown risk or unresolved uncertainty blocks
   implementation. Named risk uses the formal route even when the diff is
   small: (1) irreversible data or external effects → `data-integrity` /
   `external-effects`; (2) security surface → `security`; (3) public
   contracts → `public-contract`; (4) concurrency → `concurrency`;
   (5) delivery and environment → `delivery`; (6) no existing check would
   catch the regression → `verification-gap`.
5. Track before the first write: open the bounded task record before
   changing source, not after. Preserve the original request verbatim,
   scope, classification rationale and actual evidence. For light work do
   not add specification/design/approval documents merely to imitate the
   formal route. Substantial or sensitive work uses SDD with explicit
   bindings, scenario ownership and approvals.
6. Implement the smallest coherent authorized unit in reviewable work-unit
   slices. Reproduce behavior with a causal failing test when a
   deterministic runner exists. Report exceptions rather than inventing
   RED, a runner, a tool or proof. Run checks only with actual
   authorization; do not execute project-discovered scripts implicitly.
7. Review the complete diff and raw evidence proportionate to risk; the
   review boundary is a finished work-unit slice, not the accumulated
   feature. Obtain a fresh independent review or the explicit scoped owner
   waiver required by project policy. Close only the covered task and
   report the four-part outcome — implemented, verified, pending, next
   step — including failures, unknown impact and continuation.

Delegate only settled, bounded work when useful and supported by the host.
Pass immutable request/spec locators and runtime state rather than summaries
that alter requirements. A role or distinct context label is not
authentication. Neither the light route nor a successful test authorizes
installation, publication, paid models, destructive effects or the next
task.

If required runtime gates are unavailable, state that limit and ask for the
missing capability. Never present an instruction as native tool
interception.
