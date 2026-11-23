# Evidence — Rules

> **Scope:** what counts as proof of a claim: facts vs inference, executed
> checks, attestations, inspection limits, staleness, fixtures, and the duty
> to report evidence gaps.
> **Not here:** workflow process and failing-check handling
> (`workflow.md`), retry budgets (`research-escalation.md`), review
> standards (`review.md`).
> **Status:** Active

## Rules

### 1 — Label every claim as fact, inference or speculation

- **Must:** distinguish observed facts, inference and speculation, and state
  which one each claim is.
- **Must not:** present an inference or a plausible guess as an observed
  fact.
- **Why:** downstream decisions are only as sound as the weakest silently
  upgraded claim.

### 2 — Name the exact proof

- **Must:** cite the exact command, working directory, result and inspected
  artifact behind a verification claim.
- **Must not:** claim "verified" or "tested" without a reproducible
  reference.
- **Why:** an unnamed check cannot be re-run, audited or falsified.

### 3 — Never mark an unexecuted check as passing

- **Must:** report proposed-but-not-run checks as not run.
- **Must not:** record a check as passed on the strength of intent or prior
  state.
- **Why:** a check that never ran produced no evidence; claiming it did is
  fabrication.

### 4 — Attestations record claims; they do not authenticate execution

- **Must:** treat classification and outcome attestations as attributed
  declarations about the work.
- **Must not:** read an attestation as proof the work ran or that an
  identity is authenticated.
- **Why:** an attestation binds a claim to a declared author; it is not a
  signature over an execution trace.

### 5 — Do not overclaim what static inspection can prove

- **Must:** treat runtime behavior, data-population properties and
  environment-dependent outcomes as requiring runtime evidence.
- **Must not:** assert them from code reading alone.
- **Why:** static inspection cannot observe scheduling, production data
  shape or platform variance.

### 6 — A stale pass does not prove a changed implementation

- **Must:** re-verify after modification and tie the result to the inspected
  revision (`→ see workflow.md`).
- **Must not:** cite a pre-change pass as evidence for the changed work.
- **Why:** a result binds to the revision that produced it; new code voids
  old evidence.

### 7 — Report missing, corrupted or unavailable evidence

- **Must:** surface evidence gaps and lost or unavailable artifacts, and
  price them into the claim.
- **Must not:** suppress the gap or fill it with a plausible narrative
  (`→ see workflow.md` — never hide a failing check).
- **Why:** the owner prices risk on reported evidence; silent gaps convert
  unknowns into assumed coverage.

### 8 — Test doubles must mirror the real contract

- **Must:** keep fixtures, fakes and mocks aligned with the real contract
  shape they stand in for.
- **Must not:** treat a suite green against a drifting double as evidence of
  behavior.
- **Why:** the test then verifies the double, not the system.
