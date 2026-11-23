# Task and Continuation Data

The installed runtime's canonical workflow and methodology policies govern
Scopegrain operations. Use metadata returned by the bound runtime; explanatory
copies in snapshots do not override it. Do not derive a policy path from this
reference's physical location.

Resources come from the selected project snapshot. Integrity, runtime-policy
compatibility and installation updates are distinct checks. Never substitute
installation/global instructions silently for missing or changed project data.

Organic light work keeps a task record with original request, scope,
classification and attributed evidence. Formal SDD additionally binds
specification, design, scenario ownership, approvals and result evidence.
Tasks close their assigned scenarios; plan closure covers the complete spec.
Manual V1 records remain historical records, not implicit strict approvals.

Mutations use expected revisions; new ACT invalidates prior acceptance
evidence. Recovery revalidates real files and bindings, not just a summary.
Plans use stable keys and UUID tasks. Artifacts/sessions preserve registered
progress, not authenticated execution, native-tool control or token expenditure.
Missing pinned resources may be restored from matching installation bytes.
Divergent existing files require reconciliation; descriptor restoration does
not activate a host or reconnect an MCP.

---

## Agent × task-system integration (documenting the contract)

When a project wires several agents/personas to a task system, keep a single
shared reference for the integration contract instead of duplicating it in
every agent file. Each agent's file holds a one-line pointer here. The
contract records:

| Piece | What to record |
|---|---|
| Active prompts/workflows | Where the canonical procedure files live (plan, task, iteration loop) |
| Tool surface | Which task-system tools exist (next-task, verify, discover, classify, enforce-state, session tracking) and which are read vs. mutation |
| State machine | The lifecycle states and the invalid transitions, with the file that defines them |
| Per-type workflows | The workflow definition per work type (bug-fix, feature, refactor, research, …) |
| Enforcement | Where per-state tool allow/deny and pre-call checks are actually enforced |
| Session tracking | How multi-iteration/multi-session continuity is recorded |

### Canonical tool-permission table

Keep one canonical "use / don't use" table for external capability servers,
then per-agent exceptions. Drift happens when each agent file marks the same
server differently — one table fixes that; the real enforcement lives in each
agent's permission block, aligned with this table.

| Server | Use? | Purpose |
|---|---|---|
| code-graph / semantic index | ✅ per role | Symbol resolution, call paths, blast radius |
| task system | ✅ | State, verify, skills, budgets |
| web research | per role | Multi-engine search, URL extraction |
| browser automation | per role | Visual verification (usually ❌ for orchestrator roles) |
| build/lint tool servers | per role | Often ❌ when the terminal covers it (context cost) |
| social/design/misc | ❌ default | Not relevant to engineering agents |

> Host note: some harnesses cannot filter tool servers per agent natively.
> The table then documents intent — agents simply don't invoke ❌ servers —
> while real restriction lives in permission blocks where supported.

| Agent role | build tools | code graph | web search | browser | design |
|---|---|---|---|---|---|
| orchestrator/lead | ❌ | ✅ | ✅ | ❌ | ❌ |
| implementer | ✅ | ✅ | ✅ | ❌ | ❌ |
| architect | ✅ | ✅ | ✅ | ✅ | ❌ |
| reviewer | ✅ | ✅ | ✅ | ✅ | ❌ |
| security auditor | ✅ | ✅ | ❌ | ❌ | ❌ |
| docs writer | ❌ | ❌ | ✅ | ✅ | ✅ if designing |
| perf/resilience | ✅ | ✅ | per need | ❌ | ❌ |

<!-- Cross-references: → see orchestration-patterns.md, skills-engineering.md, mcp-tools.md, backlog-format.md -->
