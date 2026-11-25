<!-- translated-from: docs/journal-recovery.md @ 2026-11-20 -->
# Explicit journal recovery

> English translation of the canonical Spanish document
> (`../journal-recovery.md`). The Spanish version prevails.

Recovery operates on a known operation, in an already enrolled project
and workspace. Coordinate writer and worker inactivity first; the lock
is cooperative, not operating-system isolation or administrative
identity authentication.

List pending, unacknowledged events through a bounded window
(`--since-sequence` pages by journal sequence, `--limit` bounds the page):

```text
scopegrain journal list --project PATH [--config REL] [--since-sequence N] [--limit N]
```

Query the operation and its intent digest:

```text
scopegrain journal show OPERATION --project PATH [--config REL]
```

Prepare a JSON file with `action`, `expectedIntentDigest` and `reason`.
`action` is `finalize-committed` or `abandon-prepared`; the reason is
preserved verbatim. Options example (`expectedIntentDigest` is a
placeholder: replace it with the real digest reported by
`journal show`):

```json
{
  "action": "abandon-prepared",
  "expectedIntentDigest": "<intent-digest-returned-by-journal-show>",
  "reason": "operator decision after local review"
}
```

Choose the action after reviewing local evidence:

```text
scopegrain journal recover OPERATION --project PATH [--config REL] --input FILE
scopegrain journal recover OPERATION --project PATH [--config REL] --input FILE --apply
```

Without `--apply` the operation is a read-only preview. With `--apply`
permissions, intent, snapshots, head and index are rechecked before
persisting the decision. The receipt keeps the first date and first
reason; a change of decision or reason is a conflict.

`finalize-committed` requires a valid commit marker. Byte equality in
the source does not prove the operation finished and does not allow
creating a marker. `abandon-prepared` keeps an unconfirmed result:
absent, partial, matching or foreign files are not reverted, adopted,
deleted or modified. Review and resolve the sources separately.

## Update operations (CAS)

`update` operations follow the same `prepared`/`committed` cycle and are
recovered with the same actions, expected-attempt digest and immutable
receipt. An `update` event declares `previousHash` (hash of the expected
current bytes) and `sourceRevision` (expected current revision); the CAS
is checked before reserving sequences and again under the lock before
the temporary+rename atomic rename. A `previousHash` mismatch, an absent
source or a non-regular destination is a closed conflict
(`JOURNAL_SOURCE_CONFLICT`) with no reserved journal state; a failure in
the apply phase keeps the uncertain `unconfirmed`/`prepared` receipt just
like creations.

Recovery is identical: `finalize-committed` requires the commit marker;
`abandon-prepared` keeps an unconfirmed result and never restores the
prior image: updated, partial or foreign bytes remain as they are. The
verified prior image is persisted as `snapshots/<previousHash>.blob`
only as evidence for a reviewed manual restore; recovery never restores
it automatically. Each event's snapshot (`snapshotRef`) is always the
post-image.

The CAS is cooperative under the journal lock: writers not going through
the journal can interleave in the window between the check and the
rename, without operating-system isolation. The declared
`sourceRevision` is provenance metadata: the kernel keeps no per-record
index and does not verify the number against historic operations; chain
coherence (resulting revision = expected + 1, `previousHash` equal to
the prior `sourceHash`) is a read-model check, not a write gate.

Incomplete or corrupt histories and invalid snapshots fail closed;
they are not rebuilt automatically.

## Stale lock recovery

Lock files carry a JSON payload `{t, pid, at}` holding the token, the
writer's pid and a timestamp. The recovery guarantee is:

- **Dead pid**: the lock is reclaimed on the next acquire. A process
  that no longer exists can never finish its section, so keeping its
  lock would block the journal forever.
- **Live pid**: the lock is never broken, regardless of age. A
  suspended writer is still a real writer; breaking its lock would
  admit a second writer into the same section.
- **No metadata** (legacy bare tokens, zero-byte sentinels): the lock
  is reclaimed only after `mtime` ages past a one-hour TTL.
- **Replacement race**: reclaim re-verifies `dev`/`ino` identity
  between inspect and unlink; a concurrent delete+recreate preserves
  the successor's lock.

The lock remains cooperative: it compares `dev`/`ino` and token before
releasing, but those checks are not an atomic OS unlink; external
coordination (never running two writers on the same state) remains the
operator's responsibility.

## Compaction with full archival

Terminal operations — `committed` with every event acknowledged, or
`abandoned` after recovery — are archived intact, never deleted:

```text
scopegrain journal compact --project PATH [--config REL]
```

The command moves `operations/<id>` to `archive/operations/<id>` under
the journal lock. Pending, active, `prepared` and unacknowledged
operations are kept. Snapshots are content-addressed and shared, so
they stay in place; provenance is preserved byte for byte and readers
(`journal show`, acked listings) resolve both locations. `head.json`
maintains `pendingOperations`, the counter session start reads instead
of scanning the journal.

An active reservation without an index is detected when listing
pending operations. If the active pointer is null, the bounded listing
cannot detect a missing historic index: an empty page does not prove
global synchronization. Explicit recovery of the known operation can
rebuild its index; a separate full audit is needed to detect unknown
absences.

## Signed checkpoints (Ed25519)

The journal can seal its state with Ed25519-signed checkpoints in
`checkpoints.jsonl` (append-only, inside the journal directory; keys
live under `<paths.state>/integrity/`, outside the journal tree). Each
checkpoint records `headSequence`, `headSha256`, the accumulated event
`chainHead` and the previous checkpoint digest, signed with the local
private key. `head.json` folds `chainHead` per event, so truncations,
rollbacks and fabricated events are detectable.

```text
scopegrain journal checkpoint --project PATH [--config REL]
scopegrain journal verify --project PATH [--config REL] [--expect-digest HEX] [--skip-chain-scan] [--fail-on-error]
```

`journal checkpoint` generates the keypair on first use and requires a
quiescent journal (no active operation). From then on, every
`finalizeOperation` auto-seals a checkpoint. `journal verify` recomputes
the checkpoint chain, signatures, head sequence and — unless
`--skip-chain-scan` — the full `chainHead`; `--expect-digest` requires a
concrete digest of the last checkpoint (external anchoring) and
`--fail-on-error` propagates exit 1 when verification is not `ok`.
Verification is recomputable by third parties: the full design is in
[records-integrity-design](../records-integrity-design.md).

