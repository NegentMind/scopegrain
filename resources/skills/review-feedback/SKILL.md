---
name: review-feedback
description: Use when evaluating review feedback and preparing a coherent response and correction batch
---
# Review Feedback Quality Gate

Safely track change-request feedback: resolve review comments or merge
conflicts, validate fixes, and pass a read-only cross-review before
committing or pushing follow-up changes.

## When to use

- A PR/changeset has review comments to resolve
- Merge conflicts or pending checks need work
- A monitored follow-up is needed after a fix round
- You are preparing a coherent response + correction batch

## Procedure

1. **Inspect state first.** Read every review comment, the review
   verdicts, mergeability, check status, the target branch, and local
   worktree status. Keep unrelated local changes out of the change.
2. **Isolate when needed.** Use an isolated worktree/branch for review
   fixes or conflict resolution when the main checkout is dirty, behind
   remote, or occupied by another agent.
3. **Smallest safe fix.** Preserve the original bug invariant and any
   newer upstream structure the target branch introduced — resolve
   conflicts by keeping *both* intents, not by flattening one side.
4. **Narrow validation first, then required gates.** Run the narrowest
   check covering the fix, then the repository's declared gates
   (`verify-work` quick → certify as scope demands). Under a
   manual-execution policy, propose the exact commands and wait for
   output — never claim unexecuted checks.
5. **Read-only cross-review before commit/push.** Send the staged or
   proposed diff to a fresh-context reviewer through whatever mechanism
   the host provides — `independent-review` defines the reviewer-side
   contract. The cross-review is forbidden file edits and git
   write/coordination commands — it issues a verdict, nothing more.
6. **Cross-review is evidence, not authority.** Accept only findings
   grounded in the diff, project rules, the user's goal, or validation
   results. Downgrade or reject style preferences, broad scope
   expansion, and suggestions conflicting with safety or ownership
   boundaries — record the reason briefly per rejected finding.
7. **Close the loop honestly.** If accepted blockers remain: fix,
   re-validate, repeat the cross-review. Commit and push only after
   validation passes and no accepted blocker is open — and pushing
   itself requires explicit authority per project policy.

## Classifying incoming feedback

Separate each comment into:

- **Verified defect** — reproduce or trace it to an executable failure;
  fix with a regression case (per `test-driven-development`'s Prove-It
  pattern).
- **Valid risk** — cannot be dismissed; either fix or convert to a
  tracked finding with an explicit acceptance.
- **Unsupported preference** — no defect mechanism or rule citation;
  respond with a technical reason to disagree, or ask the reviewer what
  failure scenario motivates it.

Map incoming severity vocabulary onto `code-review-and-quality`'s
prefixes (Critical / Required / Optional / Nit / FYI) so the response
batch keeps the reviewer's own scale.

Batch coherent corrections together: same-file or same-mechanism fixes in
one batch, each with its exact regression case, preserving the approved
scope. Do not silently expand scope because "while I'm here".

## Responding to reviewers

Respond to every comment with one of: **evidence** (what changed, which
check proves it), an **unresolved question**, or a **technical reason to
disagree**. Never reply "done" without the check that proves it.

Keep the discussion on the review surface. Decisions made in side
channels (chat, calls, private messages) get written back into the
review thread — a resolution that lives only in a private medium does
not exist for the next reviewer.

Submitting replies, pushing, or changing PR state all need explicit
authority — none is implied by this procedure.

## Monitoring cadence

- **Active review or failing checks:** check often enough to unblock
  quickly.
- **Clean/approved change waiting for merge:** about every 12 hours.
- **Merged:** reduce to daily lightweight observation (CI, release,
  regression signals); stop making code changes unless asked.

## Common rationalizations

|| Rationalization | Reality |
||---|---|
|| "Accept every comment — it's faster than arguing" | Unverified preferences merge as defects' equals. Classification first; disagreement with a technical reason is a valid resolution. |
|| "This extra fix is tiny, I'll fold it in" | "While I'm here" is how a review fix becomes an unreviewed change. Batch only same-mechanism corrections inside the approved scope. |
|| "The cross-review is a formality" | It is the last fresh-eyes pass before the diff ships. Treating its findings as rubber-stampable defeats the step — evaluate each on evidence. |
|| "The conflict resolution just keeps our side" | Flattening one side deletes the other side's intent. Preserve both intents; if they truly conflict, that is a question, not an edit. |
|| "Replied to all comments — the work is done" | Replies without executed validation are claims. The loop closes when checks pass and no accepted blocker is open. |

## Red flags

- Answering "done" without the command + output that proves it.
- Resolving a merge conflict by keeping only one side's intent.
- A fix batch that silently expands scope beyond the reviewed change.
- Cross-review performed by the same context that wrote the fix,
  relabeled as independent — see `independent-review`'s waiver rule.
- Accepting cross-review findings that cite no diff line, project rule
  or failure mechanism — downgrade and record why.
- Pushing follow-up changes while an accepted blocker is still open.
- Decisions negotiated in side channels and never written back to the
  review thread.

## Output contract

Always report: current change state, actions taken, cross-review verdict,
accepted vs rejected findings (with reasons), validation run, commits
pushed, skipped checks with reasons, remaining risks, and the next step.
