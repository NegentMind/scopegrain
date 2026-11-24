<!-- translated-from: docs/external-anchoring-eval.md @ 2026-11-24 -->
# Evaluation: external anchoring of journal checkpoints

> English translation of the canonical Spanish document
> (`../external-anchoring-eval.md`). The Spanish version prevails.

> Evaluation from the 2026-11-24 audit, complementary to
> [records-integrity-design.md](../records-integrity-design.md). The
> signed checkpoint covers rollback/truncation/fabrication **inside**
> the local perimeter; its declared gap is deletion or wholesale
> replacement of `checkpoints.jsonl` when the verifier does not know
> the latest digest through an external channel. External anchoring
> closes that gap. This evaluates options; nothing is implemented.

## 1. What gets anchored

The artifact anchored is the **digest of the latest checkpoint**
(`sha256(JCS(checkpoint))` from the design) — 32 bytes proving "this
journal state existed at this instant". Anchoring the digest, not the
file, minimizes cost and exposure (no content leaves the perimeter).

## 2. Options evaluated

| Option | What it proves | Cost | Audit benefit | Local-first fit |
|---|---|---|---|---|
| **Manual exported copy** (`journal verify --export` → copy outside the tree) | Prior existence against a copy the attacker may not reach | 0 deps, ~0 LOC (already designed in the exportable bundle) | Medium: only as strong as the second medium's separation | Excellent: no network, no services |
| **Signed `git tag -s`** (digest in the tag message, or an exported `checkpoints.jsonl` committed to an audit repo) | State at tag time + binding to the releaser's GPG/SSH identity | ~0 extra: a signed tag is already proposed in [release-runbook.md](../release-runbook.md) | Good: git history + remote hosting (GitHub) give a third copy and weak time-sealing | Good: git is already the flow; tag signing needs an existing key |
| **RFC 3161 TSA** (e.g. freetsa) | Qualified timestamp of the digest by an external authority | Low: one HTTPS request + a `.tsr` file | Medium-good: external time proof without identity | Fair: one-off opt-in network |
| **OpenTimestamps** (`ots stamp` on the digest) | Inclusion of the digest in a tree anchored to Bitcoin | Low: CLI or lib; free, no account; async confirmation | Good: permanent public anchoring without depending on an authority | Good: opt-in network, no identity |
| **Rekor / Sigstore** (`cosign sign-blob` of the digest or of `checkpoints.jsonl`) | Immutable entry in a public transparency log + signer identity (keyless OIDC or key) | Medium-high: cosign binary, OIDC flow or key management, log verification | Highest: public third party, queryable, with identity | Poor for daily local use; reasonable as a release option |

## 3. Analysis

- **For internal/forensic audit**, the real bar is "does the verifier
  know a digest beyond the attacker's reach?". The exported copy and
  the signed tag solve that at near-zero cost. OTS and Rekor add
  *public verifiability* — relevant only if third parties must audit
  the journal without trusting the operator, a case a local-first
  harness does not have by default.
- **`network:"ask"`** in `policy/workflow.json` mandates: any network
  anchoring is an explicit opt-in per operation, never automatic.
- Rekor has the opposite problem too: the checkpoint digest is public —
  harmless (they are hashes), but the *act* of anchoring on a cadence
  reveals activity rhythm. Minor detail, declared.
- The signed tag only covers releases; the journal advances between
  releases. Continuity between releases needs periodic export or
  per-operation anchoring — hence the layered recommendation.

## 4. Recommendation

**Opt-in layers, none mandatory:**

1. **Default (zero cost):** `journal checkpoint` + export of the latest
   checkpoint to a second location outside the journaled tree
   (another disk, a private repo, email — operator's choice). It is
   the difference between "detectable" and "probably detectable".
2. **At every release:** `git tag -s` whose message includes
   `journal-checkpoint: <digest>` (one extra line in the runbook
   command; ~zero cost) or, better, the exported
   `{head.json, checkpoints.jsonl}` bundle attached to the release.
3. **Optional (public audit):** `cosign sign-blob` over the exported
   `checkpoints.jsonl` → Rekor. Recommended only if the project
   publishes evidence for third parties; OpenTimestamps is the
   lighter alternative when public anchoring without OIDC is wanted.
4. **Not recommended:** RFC 3161 as the sole layer (dependency on a
   specific authority with no benefit over the signed tag), and any
   automatic anchoring in the commit path (would violate
   `network:"ask"` and couple the journal to an external service).

Bottom line: the `records-integrity-design.md` design is sufficient
without anchoring for local use; anchoring is an incremental upgrade
activated where a trust channel already exists (git remote, signed
release), not a new dependency.
