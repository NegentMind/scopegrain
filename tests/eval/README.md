<!-- SPDX-License-Identifier: Apache-2.0 -->
# tests/eval — subprocess & golden-session evaluation

The main suite (`tests/*.test.mjs`) exercises `run()` in-process only.
This directory adds the layer the audit flagged as missing: scenarios
executed against the **real `bin/scopegrain.mjs` binary as a child
process**, plus recorded golden sessions replayed in CI.

Opt-in by design — `npm test` globs `tests/*.test.mjs` (flat) and never
reaches this directory.

## Running

```bash
node tests/eval/run-scenarios.mjs                 # all scenarios, subprocess mode
node tests/eval/run-scenarios.mjs --mode inproc   # same steps through run()
node tests/eval/run-scenarios.mjs --mode both     # both + parity diff
node tests/eval/run-scenarios.mjs --record        # write fixtures/*.golden.json
node tests/eval/run-scenarios.mjs --replay        # replay goldens
node tests/eval/run-scenarios.mjs --scenario smoke --keep

node --test tests/eval/scenarios.test.mjs         # node:test: all scenarios + parity
node --test tests/eval/golden.test.mjs            # node:test: replay all goldens
```

Exit code 0 means every expectation held; 1 lists the failures.

## Scenario format (`scenarios/*.json`)

```jsonc
{
  "name": "smoke",
  "description": "...",
  "setup": {
    "files": { "answers.json": { /* object -> JSON file */ } }
  },
  "steps": [
    {
      "cmd": ["init", "--project", "@root", "--answers",
              "@root/answers.json", "--apply"],
      "expectExit": 0,
      "expectEnvelope": { "mode": "applied", "applied": true },
      "expectError":  { "error": { "code": "INVALID_TRANSITION" } },
      "expectState": {
        "exists":    [".scopegrain/config.json"],
        "notExists": ["docs/agent/tasks"],
        "json": [{ "path": "docs/agent/tasks/${taskId}.json",
                   "subset": { "state": "PLAN" } }]
      },
      "save": { "taskId": "task.id" }
    }
  ]
}
```

- `cmd` is an **argv array** — never a shell string. The driver uses
  `execFile(process.execPath, [BIN, ...argv])`, so spaces in the repo
  path (`VantaDB Proyect`) and in arguments are safe on Windows.
- `@root` expands to the fresh temporary project root
  (`tests/eval/.tmp/<scenario>-XXXXXX/project`).
- `${name}` expands to values saved by earlier (or the same) steps'
  `save` map — a `"task.id"` style dot path into the step's stdout JSON.
- `expectExit` defaults to `0`.
- `expectEnvelope` is a **deep subset** of the parsed stdout JSON:
  objects match key-wise, arrays must have equal length and match
  element-wise, scalars are strict-equal. `{ "%regex": "^001-" }`
  matches an actual string against the pattern.
- `expectError` is a deep subset of the parsed stderr JSON — the CLI's
  error contract is `{ "error": { "code", "message", "retryable" } }`.
- `expectState` asserts on the **persisted** tree: file/dir existence,
  and subset matches on JSON files (task records, journal state…).

## Golden sessions (`fixtures/*.golden.json`)

`--record` runs a scenario (expectations must pass) and writes:

```jsonc
{
  "name": "smoke",
  "setup": { /* copied from the scenario */ },
  "recorded": { "node": "v26.8.1", "platform": "win32",
                "scopegrain": "0.1.1" },
  "steps": [ /* verbatim scenario steps */ ],
  "envelopes": [ /* normalized {cmd, exit, stdout, stderr} per step */ ],
  "storeHash": "<sha256 over the normalized state tree>"
}
```

`--replay` (and `golden.test.mjs`) re-executes `steps` in a fresh
project, applies the same normalization, and requires identical
envelopes plus an identical `storeHash`. Any drift fails the replay.

### Normalization rules (`lib/normalize.mjs`)

| Pattern | Placeholder | Why volatile |
|---|---|---|
| project root (native, `/`, JSON-escaped) | `<ROOT>` | temp path |
| RFC-4122 UUID | `<UUID>` | `crypto.randomUUID` |
| ISO-8601 UTC timestamp | `<TS>` | wall clock |
| 64-hex sha256 value | `<SHA256>` | structure/catalog fingerprints are mtime-salted; content-derived digests still compare equal since inputs are pinned elsewhere |
| `<size>:<mtimeNs>` pair | `<size>:<MTIME>` | stat mtimes (size kept) |
| `~N estTok` | `~<N> estTok` | token-estimate text |
| `tokenEstimate` object | `<VOLATILE>` | heuristic figure embedding absolute path length |

## Layout

```
tests/eval/
  lib/driver.mjs       spawn/inproc runner, subset matcher, state checks
  lib/normalize.mjs    normalization + canonical store hash
  scenarios/*.json     declarative scenario definitions
  fixtures/*.golden.json  recorded sessions (committed)
  run-scenarios.mjs    CLI: run | --record | --replay | --keep
  scenarios.test.mjs   node:test: every scenario, process+inproc parity
  golden.test.mjs      node:test: replay every golden fixture
  .tmp/                per-run project roots (gitignored, auto-cleaned)
```

## Notes & limits

- Children inherit a scrubbed environment (`SCOPEGRAIN_*` / `VANTADB_*`
  removed) so developer exports cannot make an eval nondeterministic.
- `doctor` is the slowest step (~25 s: full catalog validation); the
  per-step spawn timeout is 120 s.
- The project root basename is always `project` — the persisted
  structure index records the basename, so this keeps goldens stable.
