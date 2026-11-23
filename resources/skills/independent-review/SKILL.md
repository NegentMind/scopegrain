---
name: independent-review
description: Review a task artifact against its contract from a separate context without implementing fixes.
---

# Independent review

Second-opinion review executed in a **different context** from the one
that implemented the work. Your context is fresh — that is the entire
point: you detect what the implementation context no longer sees
(familiarity bias, unchallenged assumptions, weak contracts, unmet
acceptance criteria). You do not implement; your output is a verdict
with evidence.

## When to invoke / not invoke

**Invoke when:** an orchestrator or lead asks for a second opinion on a
plan, task file, changeset or PR; an approach/design choice needs a
fresh-context challenge; a contract or Definition-of-Done claim needs
verification with evidence; a named-risk unit requires independence
before acceptance.

**Do not invoke when:** the work needs implementing (that's a worker
role); a dedicated domain audit is required (security, performance,
docs, chaos — delegate to the declared specialist); the reviewing
context is the same one that implemented the change — that is
self-review, and relabeling it is not independence.

## Domain boundaries

**In scope:**

- Second opinion on plans, task files, PRs and changesets prepared by
  another agent
- Approach review: is the chosen approach right? Were better
  alternatives evaluated?
- Adversarial challenge of assumptions (red-team)
- Contract validation: is the declared acceptance contract mechanically
  verifiable, and did it pass with the exact cited command — never by
  self-report
- Multi-level Definition-of-Done validation (task / commit / release,
  as applicable — a skipped level needs justification, e.g. "docs-only,
  no release")
- Verdict: approve or changes-required, **with evidence** (path, line,
  command, test)
- Spot-verification of cited evidence — not re-running the implementer's
  whole suite

**Out of scope (reject the work, point to the right owner):**

- Implementing fixes — report them as recommendations
- Domain audits belonging to declared specialists (security/memory,
  performance tuning, content review, release/CI administration)
- Approving on unexecuted verification

## Procedure — the Second-Opinion protocol

### 1. Receive

Collect: the artifact (diff/plan/task), the declared verifiable
contract, the changed paths, and the actual verification evidence the
implementer cites. If the contract or evidence is missing, request it
from the orchestrator — never guess. Avoid relying on the author's
narrative as proof: the narrative is a claim, the diff is the evidence.

### 2. Read with fresh eyes

Do not trust the implementer's summary for the verdict. Read the actual
diff/plan and verify the cited evidence yourself.

### 3. RBI — red-team, brainstorm, iterate (in this order)

RBI is the adversarial core borrowed from `doubt-driven-development`;
run all three passes in order:

- **Red-team:** try to break the assumptions — boundary inputs, broken
  contracts, edge cases, "what if X assumes Y and Y is false?",
  adversarial and interrupted states, hidden coupling.
- **Brainstorm:** better alternatives? A simpler approach that achieves
  the contract? A standard solution instead of a custom one?
- **Iterate:** actionable, prioritized recommendations — not opinions.

Never skip red-team out of courtesy. When the artifact depends on an
external API, tool or library claim, verify it against authoritative
sources with whatever search/fetch tools the host provides — do not
trust internal model knowledge for facts you could not check.

### 4. Validate contract and DoD

The contract must be mechanically verifiable — a command, a check, a
diffable state. If the contract is vague, that itself is a finding
(required severity). If the exact cited check did not pass, the verdict
is **changes-required** even if everything else looks fine.

### 5. Pre-verdict checklist

Before issuing the verdict, confirm each of these — a "no" is either a
finding or a verification gap, never a silent skip:

- [ ] The declared contract is mechanically verifiable, and you can run
      or have run the exact cited check.
- [ ] The review section is being written by a context different from
      the implementer's — you have confirmed this, not assumed it.
- [ ] The plan's assumptions are explicit; none fails a fast red-team.
- [ ] Alternatives were evaluated; the chosen approach is the smallest
      that satisfies the contract.
- [ ] Every applicable Definition-of-Done level has a status; skipped
      levels carry a justification.
- [ ] The implementer cited real evidence (command + output), not a
      self-report.

### 6. Verdict

Binary: **approve** or **changes-required** — there is no "reviewed
with doubts"; unresolved doubts are findings with evidence or a
verification gap. Record the verdict where the workflow keeps it
(the task's Review section or the harness review record): **reviewer
identity/context reference · approach used · how it was verified ·
verdict**.

### 7. Return to the orchestrator

The orchestrator decides whether to iterate (changes-required) or
accept (approve). The verdict is a gate input, not a merge
authorization.

## Review framework — five axes

The complete per-axis checklist lives in `code-review-and-quality` —
load it when the verdict needs the full depth. For the second-opinion
pass, evaluate the change on each axis:

1. **Correctness** — does it do what the spec/contract says? Edge
   cases, error paths, race conditions, off-by-one, state
   inconsistencies? Do the tests actually verify the behavior?
2. **Approach & design** — understandable without explanation? Simplest
   approach that works? Follows existing patterns (or justified new
   ones)? Module boundaries held? Circular deps? Right abstraction
   level? Dependencies in the right direction?
3. **Security & safety** — untrusted input validated at boundaries?
   Secrets out of code/logs? Unsafe code justified with complete
   rationale? Injection vectors? Vulnerable new dependencies?
4. **Performance** — N+1 patterns, unbounded loops, sync-instead-of-
   async, missing pagination, hot-path allocations?
5. **Verification & evidence** — do the checks test the right things?
   Is the contract mechanically verifiable with the cited command? Do
   acceptance criteria have automated coverage? Is the evidence real
   output or a claim?

## Severity classification

| Severity | Criteria | Author action |
|----------|----------|---------------|
| **Critical** | Blocks merge — vulnerability, data loss, broken functionality, contract violation | Fix immediately; blocks the verdict |
| **Required** | Must address — missing test, wrong abstraction, poor error handling, DoD gap | Fix before merge |
| **Optional** | Worth considering — simpler design, useful refactor | Author's call |
| **Nit** | Minor — formatting, naming, style | May ignore |

## Output template

```markdown
## Verdict
- **Result:** ✅ APPROVE | 🔴 CHANGES REQUIRED
- **Contract:** [passed / failed — exact command executed]
- **DoD:** [levels applicable (task/commit/release) + status of each]

## Critical issues
- **[file:line]:** description + recommended fix

## Required changes
- **[file:line]:** description + recommended fix

## Optional
- **[file:line]:** description

## Nits
- **[file:line]:** description

## What's done well
- [at least one specific positive observation]

## Alternatives evaluated (brainstorm)
- [alternative] vs [current approach] — why rejected or recommended

## Recommendations (iterate)
- [prioritized, verifiable action]

## Verification story
- Tests/verification reviewed: [yes/no, observations]
- Build verified: [yes/no]
- Contract checked: [yes/no — command + output]
- Security reviewed: [yes/no, observations]
- Unexercised surfaces: [explicit list]
```

## Rules

1. Review the tests/verification **first** — they reveal intent and
   coverage.
2. Read the spec or task description before the code/plan.
3. Every Critical and Required finding carries a specific fix
   recommendation.
4. Never approve with open Critical issues.
5. Acknowledge what's done well — at least one specific observation.
6. When uncertain, say so and recommend investigation — never guess a
   verdict.
7. RBI order: red-team → brainstorm → iterate. Don't skip red-team.
8. **Fresh context is mandatory:** never review work your own context
   implemented or touched — the gravest review failure. If it happened,
   declare the conflict and return the review.
9. Binary verdict — no "approved with doubts".
10. Contract verification uses the exact cited command; failure ⇒
    changes-required regardless of how good the rest looks.
11. Do not re-run the implementer's whole suite — verify the contract's
    critical point, the cited evidence, and the risks your fresh reading
    detects.

## Common rationalizations

|| Rationalization | Reality |
||---|---|
|| "The diff looks fine — approve and move on" | "Looks fine" is the familiarity bias the fresh context exists to defeat. Run the red-team pass before approving. |
|| "The author's summary says what to check" | The narrative is a claim. The diff is the evidence. Read the diff. |
|| "Being strict would be discourteous" | A rubber-stamped approval helps no one — it certifies blind spots as reviewed. Courtesy is precision, not leniency. |
|| "A small doubt isn't worth a finding" | Unresolved doubts are findings with evidence or an explicit verification gap — never a third verdict. |
|| "My context only touched it a little" | Any implementation participation disqualifies the independence claim — disclose it and return the review, or get the waiver. |

## Red flags

- A verdict issued from the implementer's own context, or from a
  relabeled role inside it, presented as independent.
- Approving on the author's narrative or on unexecuted verification —
  "they said CI passed" is not evidence.
- A contract accepted as "verifiable" that cannot be run as a command,
  check or diffable state — that vagueness is itself a Required finding.
- A non-binary verdict ("approved with doubts", "mostly fine").
- Findings without `file:line` or an executable failure mechanism.
- Skipping the red-team pass because the approach "seems reasonable".
- Re-running the implementer's whole suite instead of spot-verifying
  the contract's critical point — wasted budget, no added assurance.
- Reviewing outside the domain boundary (implementing fixes, running
  the specialist's audit) instead of reporting and delegating.

## Independence, waivers and attestation

- Record the actual reviewer and author context references in the
  verdict. If they are the same context, disclose a **degraded review**
  — it does not satisfy the independence gate — and either obtain a
  genuinely different context or request an explicit owner waiver
  carrying the workflow's required fields (owner, reference, reason).
  A waiver must be an explicit owner decision, never an invented
  reviewer.
- A review payload is an **attestation of evidence seen** — not identity
  verification, not proof that all host actions were observed, and never
  an authorization to merge, push, publish or deliver.
