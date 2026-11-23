# Harness Tool Boundary

MCP queries are bound to the selected project. The server registers 34
`scopegrain_*` tools in four annotation classes:

- **Read-only local (22)** — `readOnlyHint:true, openWorldHint:false`:
  `approval_get`, `artifact_get`, `catalog_get`, `catalog_list`,
  `check_action`, `get_task`, `goal_list`, `inspect`, `list_tasks`,
  `mcp_inventory`, `memory_read`, `memory_status`, `methodology_check`,
  `metrics`, `plan_get`, `plan_next`, `resource_diagnose`,
  `resource_search`, `session_get`, `specification_get`, `status`,
  `workflow_packet`.
- **Read-only with backend (6)** — `readOnlyHint:true` BUT
  `openWorldHint:true`: `context`, `session_resume`, `memory_get`,
  `memory_search`, `memory_recall`, `memory_context`. Read semantics, yet
  the handler spawns the enrolled `vantadb-server` binary and sends data
  (queries, keys, record IDs) to the configured memory backend — the
  annotation honestly advertises the external world they reach.
- **Local write (4)** — `WRITE_LOCAL`: `next_task` (writes only when
  `claimBy` is set — otherwise it is a read), `task_meta` (CAS metadata
  patch), `memory_add`, `goal_create`. All bounded journaled mutations.
- **Discard write (2)** — `WRITE_DISCARD`, `destructiveHint:true`:
  `task_disposition`, `goal_transition`. Discard semantics — a
  `discarded`/`cancelled` disposition or a `dropped` goal shelves work —
  even though the write itself is a bounded CAS patch.

Larger mutations stay explicit through CLI apply/transition operations.
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

<!-- Cross-references: → see graph-investigation.md, task-system.md, skills-engineering.md -->
