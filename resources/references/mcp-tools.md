# Harness Tool Boundary

MCP queries are bound to the selected project. The server registers 39
`scopegrain_*` tools in four annotation classes:

- **Read-only local (25)** — `readOnlyHint:true, openWorldHint:false`:
  `approval_get`, `artifact_get`, `catalog_get`, `catalog_list`,
  `check_action`, `get_task`, `goal_list`, `inspect`, `list_tasks`,
  `mcp_inventory`, `memory_proposals`, `memory_read`, `memory_status`,
  `methodology_check`,
  `metrics`, `plan_get`, `plan_next`, `plan_preview`, `resource_diagnose`,
  `resource_search`, `session_get`, `specification_get`, `status`,
  `task_suggest`, `workflow_packet`.
- **Read-only with backend (6)** — `readOnlyHint:true` BUT
  `openWorldHint:true`: `context`, `session_resume`, `memory_get`,
  `memory_search`, `memory_recall`, `memory_context`. Read semantics, yet
  the handler spawns the enrolled `vantadb-server` binary and sends data
  (queries, keys, record IDs) to the configured memory backend — the
  annotation honestly advertises the external world they reach.
  `memory_recall` defaults to a project-scoped `memory_search` over
  `l1/sg-<projectHash>` (this project's records only); passing an
  explicit `scope` (`session`/`agent`/`team`) deliberately opts into the
  engine's `memory_recall` pool, which is machine-global at `agent`/`team`
  and can surface other projects' memories — a documented opt-in, not a
  leak.
- **Local write (6)** — `WRITE_LOCAL`: `next_task` (writes only when
  `claimBy` is set — otherwise it is a read), `task_meta` (CAS metadata
  patch), `task_transition` (task FSM CAS transition), `task_create`
  (task record creation), `memory_add`, `goal_create`. All bounded
  journaled mutations.
- **Discard write (2)** — `WRITE_DISCARD`, `destructiveHint:true`:
  `task_disposition`, `goal_transition`. Discard semantics — a
  `discarded`/`cancelled` disposition or a `dropped` goal shelves work —
  even though the write itself is a bounded CAS patch.

Task creation and lifecycle transitions are now available over MCP —
earlier revisions deliberately kept them CLI-only so a shell-less agent
could not drive the FSM end-to-end; the decision was reversed for
MCP-only agents. Both keep the CLI discipline: `task_transition` and
`task_create` preview by default (`mode:"dry-run"`, the exact record the
write would store, methodology gates included) and only `apply:true`
commits; an applied `CLOSE` archives the outcome to the progress log
(best-effort), same as `task transition --apply`. `task_create` accepts
either the full `input` document (`task create --input` keys) or the
flat field form; the two are mutually exclusive. Other mutations stay
explicit through CLI apply operations.

Every tool result carries `structuredContent` beside the JSON text block
(non-object payloads are enveloped as `{result: ...}`), and every tool
advertises an `outputSchema`: a typed shallow object schema on the
high-traffic tools (`context`, `task_*`, `next_task`, `memory_*`,
`catalog_*`, `goal_*`, `metrics`, `check_action`, `plan_next`) and a
permissive `additionalProperties` object elsewhere.

Read-only catalog readers (`catalog_list`, `catalog_get`,
`workflow_packet`, `resource_search`, `resource_diagnose`) still perform
one deliberate write: `loadWorkspaceCatalog` persists a fingerprint-only
record under `<paths.state>/cache/` so a verified catalog is not
re-hashed on every call. The record stores no catalog content and the
write is best-effort — an unwritable state dir never fails the read.
`readOnlyHint` is honest about the domain semantics, not about this
derived-cache bookkeeping.

Tool annotations do not create access control or authorize native actions.
Stdout belongs to protocol messages; diagnostic logging uses stderr.
Installed-SDK tests and live-host interoperability are separate evidence.

## Keeping a tool inventory (any harness)

Where a host exposes MCP or plugin tools, keep a canonical inventory file
and treat it as a maintained artifact:

- **Source of truth:** the host's config files (project-level + global) and
  the live `list` command — not this document. Verify status with real
  calls, not config declarations alone.
- **Access modes:** record how each server is reached. Some hosts expose
  tools natively in the agent's toolset; others only through an indirect
  execute/sandbox call. Native exposure costs prompt context — spend it on
  the few high-value tools. Rule of thumb: if a tool appears in your
  toolset, call it directly; if not, it lives behind the indirect call.
- **Update in the same commit** that changes the server config. Regenerate
  the list from the live tool rather than editing by hand.
- **Disabled-by-default:** record which servers are deliberately off and
  why (context cost, missing key, degraded provider). A disabled server is
  a decision, not an accident.
- **Providers behind aggregators:** do not activate a provider as a loose
  server when an aggregator already wraps it with budget tracking and
  fusion; enable it in the aggregator's own config.

## Code-search order (when graph tools exist)

If the host offers a code-graph / semantic-index tool, use it before
text search:

| # | Capability | Use for |
|---|---|---|
| 1 | Explore (symbol → source + call paths + blast radius in one call) | First option; trust the result, don't re-verify with grep |
| 2 | Graph search (BM25/semantic over the whole repo) | Vocabulary bridge to find symbols |
| 3 | Trace path (transitive callers/callees, data flow) | Impact analysis |
| 4 | Get snippet (exact source of a symbol) | After search, precise read |
| 5 | Query graph (multi-hop, complexity, hot paths, cycles) | Structural questions |
| 6 | Architecture view (clusters, hotspots, boundaries) | Orientation |
| 7 | Detect changes (blast radius of a diff vs. a base) | Pre-commit / PR review |
| 8 | Augmented text search (grep ranked by structure) | Textual patterns |
| 9 | Index status / coverage | Before trusting the graph |
| 10 | `grep` / `read` | Fallback only: configs, docs, unindexed files, confirming a detail |

If the graph reports a pending-sync warning, read the file directly; if no
index exists, normal tools are the answer.

## When to use which group

| Need | First reach |
|---|---|
| Repository code structure/symbols | Code-graph tools above |
| Web research | The project's documented search cascade (keyless first, then multi-engine, then deep extraction) |
| Task/workflow state | The bound harness's task tools |
| Browser/visual verification | A real-browser tool (screenshots, audits, network) |
| Shared team docs | The project's docs integration |
| Session/model management | The host's own session tools |

A server marked "don't use" for a given role is a context-saving decision:
the tool exists but its cost exceeds its value for that role.

<!-- Cross-references: → see graph-investigation.md, task-domain.md, skills-engineering.md -->
