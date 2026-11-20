# Harness Tool Boundary

MCP queries are bound to the selected project. Most tools are read-only
(`readOnlyHint`); a bounded set performs local journaled mutations
(`scopegrain_memory_add`, `scopegrain_goal_create`,
`scopegrain_goal_transition`, `scopegrain_task_disposition`, and
`scopegrain_next_task` when `claimBy` is set — all annotated as
destructive/non-read-only). Larger mutations stay explicit through CLI
apply/transition operations.
Tool annotations do not create access control or authorize native actions.
Stdout belongs to protocol messages; diagnostic logging uses stderr.
Installed-SDK tests and live-host interoperability are separate evidence.
