# Verification

> English translation of the canonical Spanish document
> (`../verification.md`). The Spanish version prevails.

## Current Status

The latest full run (`npm test`, serial per file, commit `ca27e26`,
2026-11-22) finished with **1411 passing tests, 0 failed, 0 skipped and
0 cancelled** (831.6 s) on Windows, Node.js v26.8.1 and npm 11.6.0. The
viewer lane (`viewer/`: `eslint`, `tsc --noEmit`, `vitest run`,
`vite build`) passed with **17/17 tests across 5 files**, 0 errors and an
816 ms build; the headless Chromium visual audit (Playwright, 1440×900
and 390×844) verified all 15 views in English and Spanish (30 screens)
with 0 console/network errors and 0 horizontal overflow. Earlier full
runs (`1152`, `813`, `770`, `699`, `673`, `536`) are kept as past
references. Do not sum scoped runs or historic results.

| Block | Reference | Observed evidence |
| --- | --- | --- |
| Evidence, formal relations and outcomes | `4a2f3e9` | 73 pass, 0 fail, 0 skipped |
| Gates, transitions, actions and sessions | `9109755` | 111 pass, 0 fail, 0 skipped |
| New CLI/MCP interface | Focused run | Exit 0: 31 pass, 0 fail, 0 skipped, 0 cancelled |
| Initial full suite | `npm test` | Exit 1: 520 pass, 1 fail, 0 skipped, 0 cancelled |
| Focused repair | `tests/review-corrections.test.mjs` | Exit 0: 12 pass, 0 fail, 0 skipped, 0 cancelled |
| Later full suite | `npm test` | Exit 0: 522 pass, 0 fail, 0 skipped, 0 cancelled |
| Manual focused foundation | 18 files | Exit 0: 163 pass, 0 fail, 0 skipped, 0 cancelled |
| Initial full foundation | `npm test` | Exit 1: 505 tests reported, 501 pass, 4 fail, 0 skipped, 0 cancelled |
| Foundation diagnosis | 4 files from the failed attempt | Exit 0: 126 pass, 0 fail, 0 skipped, 0 cancelled |
| Serial full foundation | `npm test`, one file at a time | Exit 0: 536 pass, 0 fail, 0 skipped, 0 cancelled |
| Initial workspace compatibility | 4 files, before final hardening | Exit 0: 47 pass, 0 fail, 0 skipped, 0 cancelled |
| Final focused workspace | `tests/workspaces.test.mjs` | Exit 0: 25 pass, 0 fail, 0 skipped, 0 cancelled |
| Initial journal compatibility | Journal, workspace and bootstrap | Exit 0: 66 pass, 0 fail, 0 skipped, 0 cancelled |
| Final focused journal | `tests/journal.test.mjs`, after review | Exit 0: 29 pass, 0 fail, 0 skipped, 0 cancelled |
| Internal MCP projection | Projection and in-memory MCP, 2026-11-16 | Exit 0: 28 pass, 0 fail, 0 skipped, 0 cancelled |
| Explicit journal recovery | 5 plan files, 2026-11-16 | Exit 0: 83 pass, 0 fail, 0 skipped, 0 cancelled |
| Strict journal seam (Task 1) | 3 plan files, 2026-11-16 | Exit 0: 74 pass, 0 fail, 0 skipped, 0 cancelled |
| Capture data contracts (Task 2) | 1 plan file, 2026-11-16 | Exit 0: 9 pass, 0 fail, 0 skipped, 0 cancelled |
| Typed capture store (Task 3) | 3 plan files, 2026-11-16 | Exit 0: 60 pass, 0 fail, 0 skipped, 0 cancelled |
| CLI capture create/show (Task 4) | Focused 8-file gate, 2026-11-16 | Exit 0: 121 pass, 0 fail, 0 skipped, 0 cancelled |
| Full CLI captures run | `npm test` serial, 2026-11-16 | Exit 0: 673 pass, 0 fail, 0 skipped, 0 cancelled |
| Post-review spec V2 ownership | Focused 3-file gate, 2026-11-16 | Exit 0: 35 pass, 0 fail, 0 skipped, 0 cancelled |
| Full ownership spec core | `npm test` serial, 2026-11-16 | Exit 0: 699 pass, 0 fail, 0 skipped, 0 cancelled |
| Owned spec CLI and UTF8 | Focused 4-file gate, 2026-11-16 | Exit 0: 97 pass, 0 fail, 0 skipped, 0 cancelled |
| Full CLI spec/UTF8 | `npm test` serial, 2026-11-16 | Exit 0: 770 pass, 0 fail, 0 skipped, 0 cancelled |
| Design/outcome ownership, initial gate | 10 files, 2026-11-17 | Exit 1: 195 tests, 191 pass, 4 fail, 0 skipped, 0 cancelled |
| Design/outcome ownership, fixed fixtures | 2 new files, 2026-11-17 | Exit 0: 43 pass, 0 fail, 0 skipped, 0 cancelled |
| Design/outcome ownership, snapshots after rollback | 1 file, after review | Exit 0: 20 pass, 0 fail, 0 skipped, 0 cancelled |
| Design/outcome ownership full run | `npm test` serial, 2026-11-18 | Exit 0: 813 pass, 0 fail, 0 skipped, 0 cancelled |
| Scopegrain expansion wave | Per-block focused gates, 2026-11-17 | Lifecycle 22; semantic 24; hosts 28+42; journal-update 131; producers 15; hardening 229+4todo (wave-3: 501); viewer API 9; owned plans/workspaces/tasks/sessions/approvals 19/53/60/19/32+135; CLI wave-2 152; minors-a 22; journal-wedge 178; utf8-wave3 501 |
| FMEA remediation F-01..F-07 | Antigravity wave + focused gates, 2026-11-18 | locks 6/6; plans 7/7; paths+digests 16/16; verify+methodology 152/152; journal 38/38; workspaces 27/27 |
| Prior full run | `npm test` serial, 2026-11-18 | Exit 0: 1152 pass, 0 fail, 0 skipped, 0 cancelled |
| Current full run (v0.1.0 prep) | `npm test` serial (`ca27e26`), 2026-11-22 | Exit 0: 1411 pass, 0 fail, 0 skipped, 0 cancelled (831.6 s); `npm run test:smoke` 215/215 pass (43.2 s) |
| Viewer (lint + typecheck + vitest + build + Chromium EN/ES) | `viewer/` + Playwright, 2026-11-22 | Exit 0: eslint 0, tsc 0, vitest 17/17 (5 files), build 816 ms; 30 EN/ES views with 0 errors and 0 overflow |
| Clean-project E2E + `npm pack --dry-run` | Global CLI `scopegrain@0.1.0`, 2026-11-22 | Exit 0: inspect/investigate/init/workspace/doctor/structure/context/dist selftest/light CLOSE/formal SDD plan+waves/backup; tarball 978.9 kB (341 files) |
| Isolated native MCP pilot | Windows, advertised server 0.9.0, 2026-11-16 | Exit 0: `passed-storage-only`; embeddings and hosts not certified |
| Native embedding control | Existing local model/runtime, 2026-11-16 | Exit 1: `blocked-native-embedding-safety`; positive phase passed, negative controls failed |
| Devin Local pilot (this repo) | Fresh Devin session, 2026-11-17 | 42 `scopegrain-*` skills + 15 subagents auto-loaded; `scopegrain` MCP active from `.devin/mcp_config.json`; `scopegrain_status` invoked: doctor with 16 checks and a 130-entry catalog verified by hash |
| Antigravity pilot (this repo) | Antigravity session, 2026-11-18 | `host activate --surface app-cli --apply` generated 86 `.agents/` files; the session consumed the projections and ran a multi-agent FMEA reporting 7 findings (F-01..F-07), all fixed |
| Native Antigravity App/CLI pilot (this repo) | Fresh Antigravity session, 2026-11-19 | 72 `scopegrain-*` skills and 15 subagents auto-discovered from `.agents/`; `scopegrain` MCP active from `.agents/mcp_config.json` with 18 read-only tools; `scopegrain_status` and `scopegrain_catalog_list` invoked live (doctor `needs-attention` only for the deliberately divergent `AGENTS.md`/`CLAUDE.md` plus `changedDiscovery`/`SCAN_PARTIAL_DEPTH` warnings; 130-entry catalog hash-verified); the `scopegrain-reviewer` subagent had no native write/shell tools yet kept `call_mcp_tool` reaching other global MCP servers |
| First CI run | GitHub Actions `verify.yml` manual, run 44391417084, 2026-11-18 | Exit 0: ~3.6 minutes per job |
| Remaining host pilots | Pending | Claude, Codex, OpenCode, the Antigravity IDE surface and Hermes not certified |

Local logs preserved under `.tasksystem/verification/organic-sdd/`:
`c2d1-green-final.log`, `c2d2-green-final.log`, their causal REDs and
complete diffs. They are Git-ignored; they do not automatically
accompany a clone. The full CLI/MCP run output is in
`.tasksystem/verification/publication-cli-mcp-1794188607.log`, also
ignored and not automatically included in a public clone.
The initial full run, the focused repair and the later full run are,
respectively, in `.tasksystem/verification/publication-full-suite-1794189732.log`,
`.tasksystem/verification/publication-review-corrections-1794190234.log` and
`.tasksystem/verification/publication-full-suite-recheck-1794190295.log`.
These logs also remain ignored and do not accompany a public clone.

The focused foundation run was executed manually by the owner; its
summary is in `.tasksystem/verification/scopegrain-foundation-owner-results.md`
and does not record Node/npm versions. The initial full run and the
four-file reproduction are in
`.tasksystem/verification/scopegrain-foundation-full-suite-1794250002.log` and
`.tasksystem/verification/scopegrain-foundation-four-file-repro-1794250596.log`.
The authorized serial full run is in
`.tasksystem/verification/scopegrain-foundation-serial-full-suite-1794255293.log`.
These files are local, ignored and do not accompany a public clone.

Workspace identity was verified separately from foundation. The initial
run covered workspace, CLI, foundation and config. The later review
added permanent invalidation of stale bindings and `dev`/`ino`
comparisons with BigInt. Its four regressions failed before the change;
the final focused run passed 25 tests. A C2-E help filter passed one
test in a separate run; it is not summed with the other runs.
The logs are `.tasksystem/verification/scopegrain-workspaces-green-final-1794257535.log`,
`scopegrain-workspaces-rework-red-1794258058.log`,
`scopegrain-workspaces-rework-green-final-1794258101.log` and
`scopegrain-workspaces-help-1794257497.log` under the same folder.
The foundation full run was not repeated and VantaDB was not validated
with this block.

The journal kernel was verified with snapshots, active reservation,
create-to-noop races, source/marker failures, idempotent ACK and all-of
scopes. Review found that an active reservation without an index could
look like an empty queue. Three read regressions failed before the fix;
the final focused run passed 29 tests. The earlier compatibility run
passed 66 tests and is not summed with the final one. Local logs are
`.tasksystem/verification/scopegrain-journal-green-complete-1794262437.log`,
`scopegrain-journal-listing-red-1794263030.log` and
`scopegrain-journal-listing-green-1794263051.log` under the same folder.
The initial RED for missing module is kept separately in
`scopegrain-journal-red-1794261393.log`; it does not prove behavior
failures. This kernel remains internal and create-only: it does not
activate public writers, automatic recovery, capture, CLI/MCP or
VantaDB. The incomplete reservation is kept until a future explicit
reconciliation. The full suite was not repeated and no native pilots
were run with this block.

The internal projection bridge of commit `d5a23a5` was reviewed and
verified separately via
`node --test --test-concurrency=1 tests/vantadb-projection.test.mjs tests/mcp.test.mjs`.
The run passed 28 tests with no failures, skips or cancellations, exit
0 and a duration of 19369.9938 ms. The local log is
`.tasksystem/verification/2026-11-16-vantadb-projection-green-1794801914.log`;
the initial RED for missing module remains in
`.tasksystem/verification/scopegrain-vantadb-projection-red-1794264898.log`.
These logs are ignored and do not automatically accompany a clone.
Verified: all-of scopes, snapshots and chunks, typed MCP responses,
conflicts, lost responses, readback, lease and recoverable local ACK.
The in-memory transport does not certify the VantaDB executable, its
embedding providers or a real database. No engine was started and the
full suite was not repeated. This block does not activate public
writers or capture.

Explicit journal recovery was verified separately on Node.js v26.8.1
via the plan's scoped gate:
`node --test --test-concurrency=1 tests/journal-recovery.test.mjs tests/cli-journal.test.mjs tests/journal.test.mjs tests/vantadb-projection.test.mjs tests/cli.test.mjs`.
The run passed 83 tests with no failures, skips or cancellations, exit
0 and a duration of 59222.3097 ms. The local log is
`.tasksystem/verification/2026-11-16-journal-recovery-rework-green-1794803352.log`.
The review RED reproduced four failures before the fix in
`.tasksystem/verification/2026-11-16-journal-recovery-rework-red-1794803301.log`
and the initial RED for missing exports is in
`2026-11-16-journal-recovery-red-1794802852.log`; the intermediate
79-test gate and these runs are not summed together or with other runs.
The review detected two defects fixed with regressions: a lock replaced
by another file with the same token (different `dev`/`ino` identity,
checked in addition to token before unlink) and an index restoration
that could exceed `maxPendingOperations` without a bounded count of
outbox names before any write.
The approved recovery preserves absent, partial, matching or foreign
sources without adopting or modifying them; it never creates a commit
marker from matching bytes. Limits: the lock remains cooperative and
the identity/token checks do not constitute an atomic OS unlink; with a
null active pointer the bounded listing does not detect missing
historic indexes, so an empty page does not prove global
synchronization. Neither the full suite nor any native process was run
with this block.

The strict internal seam `applyJournaledRecordCreation` (Task 1 of the
capture plan) was verified separately on Node.js v26.8.1 via
`node --test --test-concurrency=1 tests/journal.test.mjs tests/journal-recovery.test.mjs tests/vantadb-projection.test.mjs`.
The run passed 74 tests with no failures, skips or cancellations, exit
0 and a duration of 18901.9009 ms. The local log is
`.tasksystem/verification/2026-11-16-record-seam-green-1794804847.log`
and the RED for missing export is in
`2026-11-16-record-seam-red-1794804797.log`. The regressions cover the
shared frozen identity, invalid callbacks, initial noop and noop
injected before preflight under lock, with no sources or reservation.
It is not summed with the 83 gate or other runs; it remains an internal
seam with no activated capture.

The pure capture data contracts (`src/core/capture-data.mjs` and the
`capture`/`record-ownership` schemas, Task 2 of the plan) were verified
separately on Node.js v26.8.1 via
`node --test --test-concurrency=1 tests/capture-data.test.mjs`.
The run passed 9 tests with no failures, skips or cancellations, exit
0 and a duration of 140.4566 ms. The local log is
`.tasksystem/verification/2026-11-16-capture-data-green-1794805218.log`
and the RED for missing module is in
`2026-11-16-capture-data-red-1794805181.log`. They are pure validators:
they do not assert persistence, activated capture or proven ownership.
Not summed with the 74 gate or other runs.

The typed capture store (`src/core/captures.mjs`, Task 3 of the plan)
was verified separately on Node.js v26.8.1 via
`node --test --test-concurrency=1 tests/captures.test.mjs tests/capture-data.test.mjs tests/journal.test.mjs`.
The run passed 60 tests with no failures, skips or cancellations, exit
0 and a duration of 6693.1538 ms. The local log is
`.tasksystem/verification/2026-11-16-captures-rework-green-1794806444.log`
and the rework RED with 16 passing and exactly 2 regressions is in
`2026-11-16-captures-rework-red-1794806425.log`. Those regressions
reproduced two defects before the fix: `prepare` returned previews
without validating unsafe destinations (file ancestor or junction) and
`get` could read the current source with a binding already revoked
after the last snapshot read. The intermediate 55-test run is not
summed. The store creates the note and its sidecar in one recoverable
journal operation and `get` requires a committed two-event proof; at
that date there was no CLI, automatic capture, host collection or
resolution of active preference or current truth.

The `capture create|show` CLI surface (Task 4 of the plan) was verified
on Node.js v26.8.1 with the final 8-file focused gate:
`node --test --test-concurrency=1 tests/capture-data.test.mjs tests/captures.test.mjs tests/cli-captures.test.mjs tests/journal.test.mjs tests/journal-recovery.test.mjs tests/vantadb-projection.test.mjs tests/cli-journal.test.mjs tests/cli.test.mjs`.
The run passed 121 tests with no failures, skips or cancellations, exit
0 and a duration of 22355.7746 ms. The local log is
`.tasksystem/verification/2026-11-16-final8-green-1794807260.log` and
the previous RED (0 passing, 7 failures for unknown command) is in
`2026-11-16-cli-captures-red-1794807224.log`. The gate includes the
existing in-memory projection MCP tests; it does not certify native or
global conformance. `capture` is typed manual writing (preview by
default, explicit `--apply`, all-of workspace grants); automatic
producers, host collection and the native backend remain unconnected.
Counts of earlier runs (9, 60, 74, 83) are not summed with this gate or
each other.

After the focused gate, the authorized full suite was run once via
`npm test`, which invokes
`node --test --test-concurrency=1 tests/*.test.mjs` on Node.js v26.8.1
and npm 11.6.0. It passed 673 tests with no failures, skips or
cancellations, exit 0 and a duration of 322695.5689 ms; the full log is
in `.tasksystem/verification/2026-11-16-integral-npmtest-1794807643.log`.
It is the full-run reference of the CLI captures block, not a rerun of
the 121 gate or a certification of CI, native execution or host
conformance; earlier counts are not summed with it.

The V2 specification ownership block shares pure validators and the
creation proof with captures, without altering the legacy writers.
Review detected the loss of the `sourceHash` string-type guard: the RED
reproduced the undue acceptance of an array before restoring it. The
causal control is in
`.tasksystem/verification/2026-11-16-ownedspec-hashguard-red-1794812682.log`
(8 pass, 1 fail); the post-review run passed 35 tests with no failures,
skips or cancellations, exit 0 and 4441.2723 ms, via
`node --test --test-concurrency=1 tests/record-ownership-data.test.mjs tests/capture-data.test.mjs tests/owned-specifications.test.mjs`.
Its log is
`.tasksystem/verification/2026-11-16-ownedspec-rework-green-1794812910.log`.
The initial 79-test gate predates that fix; the sets are different and
their counts are not summed.

After the complete review, a single full run was executed with serial
`npm test`, Node.js v26.8.1 and npm 11.6.0: 699 pass, 0 fail, 0
skipped, 0 cancelled, exit 0 and 1354533.5285 ms. It is that core
block's reference. The full log, including versions and real output, is
in `.tasksystem/verification/2026-11-16-integral-npmtest-1794813511.log`.
Those are 26 new cases in the two ownership files, included in the 699
tests, not additional to them. The full run had no retries.
In that block the store was opt-in and core-only; there was no
ownership spec CLI, mutable protocol, automatic producer or native
activation. This full run does not replace the blocked native
embeddings gate.

The later CLI expansion adds `specification create|show --owned`
without changing the default legacy mode. A prior isolated repro
confirmed that `readInputFile` accepted a `0xff` byte inside
`originalRequest` and persisted U+FFFD in a legacy artifact. The common
reader was fixed: byte limit, exact UTF8 roundtrip and then parsing,
without banning valid U+FFFD or normalizing the text. The repro is in
`.tasksystem/verification/2026-11-16-cli-utf8-repro-1794815485.log`.
The initial RED is kept in
`.tasksystem/verification/2026-11-16-cli-owned-task1-red.log`: it
included a fixture failure for a reserved path, fixed before GREEN, in
addition to the then-missing mode failures and UTF8 loss. The error
expectation for an unknown UUID was reconciled with the core's
`OWNED_SPEC_NOT_FOUND`; the core was not changed to satisfy the plan's
erroneous shorthand.

The focused gate passed 97 tests, 0 failures, skips or cancellations,
exit 0 and 60057.2735 ms:
`node --test --test-concurrency=1 tests/cli-utf8.test.mjs tests/cli-owned-specifications.test.mjs tests/cli-captures.test.mjs tests/cli-methodology.test.mjs`.
Its full log is in
`.tasksystem/verification/2026-11-16-owned-spec-cli-green-1794816091.log`.

After reviewing all tests, source and documentation, and a second
review in a separate context with no findings requiring changes, the
code was frozen and a single serial `npm test` full run was executed:
770 pass, 0 fail, 0 skipped, 0 cancelled, exit 0 and 510701.96 ms,
Node.js v26.8.1 and npm 11.6.0. The raw log with versions, command,
outputs and real code is
`.tasksystem/verification/2026-11-16-owned-spec-cli-integral-1794816546.log`.
The whitespace check with `cr-at-eol` scoped to the process also ended
with exit 0, without writing Git config. There were no retries, filters
or suite omissions; the focused run is not summed with the total.
These logs are local and ignored, they do not automatically accompany a
clone. This block does not activate automatic producers, hooks, mutable
protocol or native VantaDB; it also does not repeat or replace the
embeddings control.

The ownership expansion to V2 designs and outcome reports adds two
typed stores and an opt-in CLI, without converting the legacy writers.
The design getter validates the spec binding from the proven bytes;
the outcome getter proves the present report, not its currency relative
to the mutable task or its eligibility for ACCEPT. The gates keep that
responsibility. The complete review was also performed in a separate
context, including the literal diff and the four new files.

The behavioral CLI RED finished with 23 tests, 4 pass and 19 fail, exit
1: `.tasksystem/verification/owned-formal-task1-cli-red-20261117-041450-4162.log`.
The core RED of
`.tasksystem/verification/owned-formal-task1-core-red-20261117-041534-2777.log`
includes rejection of the new kinds and load failure for missing
modules; that load failure does not demonstrate behavior of a store
that did not exist yet.

The first targeted ten-file run finished with 195 tests, 191 pass and
4 fail, no skips or cancellations, exit 1:
`.tasksystem/verification/2026-11-17-owned-formal-green-1794903811.log`.
The four fixture expectations assumed a present source after a
companion failure, but the existing rollback removed the files created
in that scenario. Correcting the presence expectation did not change
the kernel or weaken the ownership proof. A first rerun of the two new
files still had 41 pass and 2 fail from remaining structural
expectations:
`.tasksystem/verification/2026-11-17-owned-formal-rerun-1794904101.log`.
After fixing them, those two files passed 43 tests with no failures,
skips or cancellations, exit 0:
`.tasksystem/verification/2026-11-17-owned-formal-rerun2-1794904138.log`.
The other eight files did not change and were not repeated; the
combination of those runs is not presented as a single green 195-test
run.

The later review clarified that rollback is best-effort and that the
test does not depend on its success. The check of both snapshots and
their hashes was added after the fixture rollback. The only file with
new assertions was repeated: 20 pass, 0 fail, 0 skipped, 0 cancelled
and exit 0:
`.tasksystem/verification/2026-11-17-owned-formal-rework-1794904550.log`.

With source and tests frozen, the single final `npm test` full run
finished with 813 pass, 0 fail, 0 skipped and 0 cancelled, exit 0,
620603.4447 ms, Node.js v26.8.1 and npm 11.6.0:
`.tasksystem/verification/2026-11-17-owned-formal-integral-1794904701.log`.
The log preserves versions, command, stdout/stderr and
`NPM_TEST_EXIT=0`. The full run had no retries, filters or omissions;
earlier runs are not summed with its total. These logs and the private
diffs are Git-ignored and do not automatically accompany a clone. No
producers, hooks, hosts or native VantaDB were activated. The evidence
does not certify other operating systems or the declared minimum
Node.js 22.

Before this ownership block, the private native MCP pilot recipe was
run once, with a fresh database and synthetic data. The installed
executable advertised `vantadb 0.9.0`; the result was
`passed-storage-only`, exit 0. Four immutable events and their
UTF8/BOM, binary and empty snapshots kept their bytes after restarting
the process. The proxy rejected credentialless requests with 401 in
both sessions. The observed records contain no vectors. The
missing-model path was deliberate: `StrictUnavailable` does not prove
models are absent on the machine nor certify semantic recovery.
The log is `.tasksystem/verification/2026-11-16-native-probe-1794808334.log`;
the raw responses are in
`.tasksystem/verification/2026-11-16-native-mcp-5a2e5113-1b51-41f7-a7b9-86a19526e666.json`.
The recipe, database and evidence are private and ignored; they do not
accompany a clone. No public integration was activated and VantaDB was
not modified; no real content was used either. This pilot is not summed
with the suite's 673 tests.

The later functional test used already-existing ONNX weights and
runtime, own copies and synthetic texts. With a valid DLL, generation
and persistence passed; the full gate failed with exit 1 because, with
the DLL deliberately absent and models present, `capabilities`
advertised `StrictUnavailable` but `embed_texts` by default and the
auto-embed of `memory_put` returned `fallback:false`, and a vector384
was persisted. The explicit-model call correctly rejected that absent
runtime. Automatic native activation remains blocked; no workaround was
applied and VantaDB was not modified. Private log:
`.tasksystem/verification/2026-11-16-embedding-probe-1794810035.log`;
responses:
`.tasksystem/verification/2026-11-16-native-embedding-46c95621-1f91-4eab-99bb-31839b70a884.json`.
This test is not a recovery benchmark and is not summed with the full
run.

The full foundation attempt reported `UNKNOWN` errors in I/O operations
and aborted test files. Diagnostics recorded a System 2004 low virtual
memory event during that attempt; it does not prove the concrete cause
of each error or a memory leak. The runner was bounded to one test file
at a time, without skipping cases or relaxing controls. The
[Node documentation](https://raw.githubusercontent.com/nodejs/node/v26.8.1/doc/api/cli.md)
describes `--test-concurrency`, and the
[Microsoft documentation](https://learn.microsoft.com/en-us/troubleshoot/windows-server/performance/troubleshoot-application-service-memory-leaks)
describes event 2004 and its diagnostic limits.

The script's filtered regression failed before changing it, as recorded
in `.tasksystem/verification/scopegrain-foundation-concurrency-red-1794255277.log`;
that filter is not a complete suite. The current script is
`node --test --test-concurrency=1 tests/*.test.mjs`.

The serial full foundation run took approximately 19 minutes and 13
seconds. The manual workflow reserves 180 minutes per job after observing ~112
minutes for the serial local suite; its first remote run (2026-11-18)
completed successfully in ~3.6 minutes per job.

The previous block's initial full run failed because an obsolete test
expected `INVALID_ARGS` for `catalog list --project`, an option now
admitted; the config-less context returned `CONFIG_NOT_FOUND`. The test
was fixed and a project snapshot regression was added, without changing
the runtime. The focused run and the later full run are separate
executions.

Synthetic fixture checks and reviews test the mechanism, not a native
execution, authenticated identity or a real product result.

The following test/startup runs are proposed to the owner for manual
execution or explicit authorization. The documented executions above do
not automatically authorize repeating them.

## Historic Gates Environment

Verifications were executed with the owner's express authorization,
without installations, network, push or changes to the source project.
Observed environment: Windows, Node.js v26.8.1 and npm 11.6.0. The
declared minimum version (Node.js 22) and other operating systems have
not been tested yet.

## Historic Gate Of The Portable Expansion

Execution recorded on 2026-11-07 (UTC). Local evidence:
`.tasksystem/verification/final-gate/`.

| Check | Observed result |
| --- | --- |
| `npm test`, complete suite | Exit 0: 145 pass, 0 fail, 0 skipped, 0 cancelled |
| End-to-end CLI and MCP smoke | Exit 0: 41 checks correct, 0 failed |
| Dry initialization | 385-file plan; the workspace is not created |
| Applied initialization, four hosts | 385 files projected; no native roots activated |
| Doctor and re-initialization | `ready`; then created 0, config/discovery bytes preserved |
| DAG with two tasks | Successor blocked until its dependency reaches CLOSE |
| Fixture implementation and verification | `node --test sum.test.mjs` actually executed, exit 0 |
| Evidence and review | Verification with real log; synthetic declared review, only to test the schema |
| CAS and budget | Obsolete revision and exceeded operation rejected; resume with real state and usage |
| Seven artifact types | Under `.tasksystem/`, reviews in reports/reviews; no docs/ created |
| Catalog and projections | 111 resources and proposal sources existing on disk |
| Fixture Git preferences | Nested ignore per selection; root `.gitignore` intact |
| MCP with real stdio transport | 13 read-only tools; catalog, workflow, plan, artifact and session queries |

Evidence files:

- `npm-test-final-gate.log`: complete suite output.
- `smoke-report.json` and `smoke.log`: fixture checks.
- `smoke.mjs`: one-off verification script, not part of the runtime.
- `node-version.txt` and `npm-version.txt`: observed versions.
- `project/.tasksystem/reports/sum-test-runner.log`: output of the
  fixture's real test; the execution was explicitly authorized, not
  started by discovering the script in the manifest.

The smoke registers a review with synthetic identifiers. It validates
transitions and dependencies, it does **not** demonstrate automatic
independent review, authenticated identity or real delegation inside a
host. The in-memory transport is also checked in the suite; stdio is
additionally checked in the fixture.

The whitespace gate detected line-ending/trailing-space issues in
edited files. They were normalized with no behavior changes and are
checked separately; that adjustment is not presented as another suite
run.

The Devin Local and Antigravity App/CLI pilots were certified in real
sessions (skills + MCP + read-only invocation); no real Claude Code,
Codex, OpenCode, Antigravity IDE or Hermes sessions were run. The
197 archived original skills, external plugins, native isolation,
Node.js 22 and other operating systems are not certified. Logs,
fixtures and operational reviews remain private and ignored; they do
not automatically accompany a clone.

## First base history

The following table corresponds to the initial commits, not the current
count.

| Check | Observed result |
| --- | --- |
| First `npm test` run | Exit 1: 72 pass, 1 fail, 0 skipped |
| Failure cause | The flag-rejection test omitted passing `io` to `run`; the CLI controls were not changed |
| `node --test tests/cli.test.mjs` after fixing the call | Exit 0: 9 pass, 0 fail |
| Final gate `npm test` | Exit 0: 73 pass, 0 fail, 0 skipped |
| `--help` and `inspect --project .` | Exit 0; inspect reports unconfirmed manager without assuming npm |
| `init --answers` on empty fixture | Dry-run, no initializer writes |
| `init --answers --apply` | Exit 0; 13 new files |
| Fixture `doctor` | Exit 0, status ready, no warnings |
| Repeating init with the same answers | Exit 0; created 0 |
| Create, list, query and transition task | Exit 0; PLAN revision 0 moves to ACT revision 1 |
| Transitioning with old revision | Expected exit 1: REVISION_MISMATCH |

Local evidence preserved in `tests/.tmp/verification/`: baseline
`npm-test.tap.log`, fix `cli-tests-fixed.log`, gate `npm-test-final.log`
and `smoke-*.log` logs. The fixture is kept in
`tests/.tmp/smoke-proyecto/`. Both destinations are Git-ignored: local
evidence does not automatically accompany a clone.

In that first base the MCP tests did not connect a transport. The
expansion adds the in-memory and stdio checks indicated in the
described historic gate.

## Reproduction

The following commands allow repeating the checks manually or
authorizing their execution by an agent; authorization is not inferred
from the mere presence of this guide.

## Requirement

```powershell
node --version   # expected >= 22
```

The CLI requires no dependencies. The complete suite needs the declared
MCP dependencies: `@modelcontextprotocol/sdk` 1.27.1 and `zod` 4.5.4.
Without them, `mcp.test.mjs` may skip its optional cases with a
documented reason, but `mcp-methodology.test.mjs` requires those
dependencies; a complete `npm test` run without them is not promised.

## Complete suite

From the Scopegrain root:

```powershell
npm test
# equivalent:
node --test --test-concurrency=1 tests/*.test.mjs
```

## Per-area verification (more scoped)

Reproducible Organic/SDD runs. The third corresponds to the focused
CLI/MCP execution indicated above; the others are per-block results,
not a new full suite:

```powershell
node --test tests/evidence.test.mjs tests/formal-bindings.test.mjs tests/outcomes.test.mjs tests/structured-boundaries.test.mjs
node --test tests/methodology-gates.test.mjs tests/transition-methodology.test.mjs tests/workflows.test.mjs tests/sessions.test.mjs
node --test tests/cli-methodology.test.mjs tests/mcp-methodology.test.mjs tests/mcp.test.mjs
```

```powershell
node --test tests/paths.test.mjs      # containment, traversal, symlinks
node --test tests/discovery.test.mjs  # stacks, limits, fingerprint
node --test tests/config.test.mjs     # config and answers contract
node --test tests/bootstrap.test.mjs  # plan, preflight, create-only
node --test tests/adapters.test.mjs   # per-host fragments
node --test tests/tasks.test.mjs      # transitions, CAS, evidence
node --test tests/cli.test.mjs        # CLI surface, JSON, exit codes
node --test tests/doctor.test.mjs     # doctor: content, templates, warnings
node --test tests/mcp.test.mjs        # optional; requires dependencies
node --test tests/catalog.test.mjs    # manifest, resources and dependencies
node --test tests/workflows.test.mjs  # packages, profiles and context
node --test tests/plans.test.mjs      # DAG and readiness
node --test tests/artifacts.test.mjs  # destinations and typed records
node --test tests/sessions.test.mjs   # CAS, policy and continuity
node --test tests/versioning.test.mjs # defaults and per-category ignores
node --test tests/native-adapters.test.mjs # proposed native bridges
node --test tests/cli-workflows.test.mjs # groups and thirteen aliases
node --test tests/review-corrections.test.mjs # records and limits
node --test tests/final-review.test.mjs # temps, clock and catalog
```

Symlink tests are skipped with a message if Windows cannot create links
without privilege.

## Read-only smoke (writes nothing)

From the Scopegrain root:

```powershell
node .\bin\tasksystem.mjs --help
node .\bin\tasksystem.mjs inspect --project .
```

For the `init` dry-run plan use a pre-created empty fixture (on this
repo `init` would end in `PLAN_CONFLICT`, because the existing
`AGENTS.md`/`CLAUDE.md` deliberately differ from the generated
content):

```powershell
mkdir .\tests\.tmp\humo-vacio
node .\bin\tasksystem.mjs init --project .\tests\.tmp\humo-vacio --answers .\examples\answers.json
```

It prints the plan without writing anything.

## Writing smoke (mutating, disposable fixture only)

Create an empty project inside `tests/.tmp` and apply there, never on a
real project or on this repo:

```powershell
mkdir .\tests\.tmp\humo-proyecto
node .\bin\tasksystem.mjs init --project .\tests\.tmp\humo-proyecto --answers .\examples\answers.json --apply
node .\bin\tasksystem.mjs doctor --project .\tests\.tmp\humo-proyecto
node .\bin\tasksystem.mjs task list --project .\tests\.tmp\humo-proyecto
```

`examples/answers.json` selects `organic-sdd`. Do not use metadata-less
V1 creations as if they were valid in that mode. Create tasks with the
appropriate contract or explicitly choose `manual` in a new fixture's
answers; do not silently modify an existing configuration.

Interactive `init` can also be run on the fixture (in a real terminal):
it asks for name, language, hosts, config path and the seven paths and
eight versioning preferences; it shows the plan and only writes after
an explicit `yes`.

## MCP smoke (optional, with dependencies installed)

```powershell
node .\src\mcp\server.mjs --project .\tests\.tmp\humo-proyecto --config ".scopegrain/config.json"
```

It should remain waiting on stdio (MCP protocol); close with Ctrl+C.
The startup log goes to stderr.

## What to report

- Complete `npm test` output (or each scoped file's output).
- Any `FAIL`, `ERR` or unexpected skip.
- For the smoke: the JSON emitted on stdout and any error on stderr.

## Supervised verification commands (debt B6)

The `verify` surface persists closed records under
`<paths.state>/verify-commands.json`:

- `verify list` — read-only; an absent store is an empty list.
- `verify add --command CMD [--apply]` — declares a command; previews
  by default, `--apply` persists it with `approved:false`.
- `verify discover [--apply]` — turns semantic-discovery candidates
  into `source:'inferred'` records, never auto-approved. Unresolvable
  candidates are reported as `skipped` with
  `reason:'unresolved-command'`, the cause code (`unresolved`:
  `PACKAGE_MANAGER_UNCONFIRMED`, `CONTRADICTORY_PM` or
  `UNKNOWN_PACKAGE_MANAGER`) and a `hint` with the exact remediation:
  declare `packageManager` in that cwd's package.json, commit a single
  lockfile or declare the command literally with `verify add`.
- `verify approve ID [--apply]` — explicit per-record approval; the
  CLI path that turns a command (declared or inferred) into
  `approved:true`. Bulk paths: `verify discover --approve` imports
  literal candidates and approves them in one locked write
  (unresolved ones stay `skipped`, never stored);
  `verify approve-discovered [--apply]` approves the stored
  `inferred` records. Both preview by default.
- `verify run ID [--timeout MS] [--fail-on-error]` — executes a single
  approved record. By default it prints the result JSON and exits 0;
  `--fail-on-error` propagates the command's exit code when it is not 0
  (or 1 on timeout/signal) for CI use.

Safety model: nothing is auto-approved or auto-executed; `verify run`
refuses unapproved records with `VERIFY_COMMAND_NOT_APPROVED`. Commands
are stored as literal argv (no quoting, no shell metacharacters, no
absolute paths or `..` segments); execution uses `spawn` with an args
array — never a shell string nor `shell:true` — with a timeout (120 s
default, 600 s cap), bounded captured output and a `cwd` contained in
the project. The declared `executesProjectCommands:false` capability
still holds: the harness never runs commands on its own initiative;
`verify run` is an explicit operator order. Verified with
`node --test tests/verify-commands.test.mjs` (21 pass, 0 fail).
