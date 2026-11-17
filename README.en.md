# Scopegrain

Portable proportional engineering harness for AI agents.

> English translation of the canonical Spanish README (`README.md`). The
> Spanish version prevails.

Scopegrain helps teams and operators who use coding agents to organize
work across projects and sessions without depending on a single host. It
separates work context and contracts from each tool's conventions, and
offers a lightweight or formal route according to the declared facts and
risks.

The product is called Scopegrain. `scopegrain` is the CLI entry point
and the MCP server name (`scopegrain_*` tools). The `tasksystem` binary
alias and legacy `.tasksystem` paths are kept for compatibility. This
does not imply publishing a package.

## Workflow

1. **Read-only discovery.** Inspect manifests and instructions with read
   limits; discovered commands are presented as proposals and are not
   executed automatically.
2. **Onboarding and approval.** Choose hosts, methodology, paths and
   versioning preferences. Review the preview and confirm before files
   are created. Approving files does not authorize other operations.
3. **Context and snapshots.** Query the catalog of procedures, roles,
   skills, rules and profiles. The project keeps a snapshot of resources
   to build context packages without activating agents.
4. **Proportional tasks and plans.** Record contracts, scope and state;
   organize dependencies in a DAG. Organic Driven Development (ODD) uses
   a lightweight route or formal SDD according to the declared facts.
5. **Evidence, review and acceptance.** Record verifications and review
   or waiver. The formal route links specification, design, assignments,
   approvals and a current report before accepting a task.
6. **Continuity and recovery.** Query state, resume registered sessions
   and diagnose snapshot resources without repeating commands or
   activating work automatically.

Discovery does not demonstrate semantic understanding of the code. The
person or agent must investigate and decide which verifications are
appropriate. The project rules and the owner's permissions prevail over
the harness's suggestions.

## Getting started

Node.js 22 or later is required. The CLI uses native modules; the
optional MCP server requires the dependencies declared in
`package.json`.

From the repository root:

```powershell
node ./bin/scopegrain.mjs inspect --project "C:\path\my-project"
node ./bin/scopegrain.mjs init --project "C:\path\my-project"
node ./bin/scopegrain.mjs doctor --project "C:\path\my-project"
```

`inspect` neither writes nor executes the commands it discovers.
Interactive `init` asks for the configuration, shows the proposed files
and requests explicit confirmation; the default answer is no. `doctor`
checks the state of the configuration and the generated files.

An answers file can also be used:

```powershell
node ./bin/tasksystem.mjs init --project "C:\path\my-project" --answers "C:\path\answers.json"
```

With `--answers` and without `--apply`, `init` only presents the plan.
Adding `--apply` authorizes the creation of the proposed files, not the
execution of commands nor the replacement of existing content. `--yes`
and `--force` are not bypass options. Artifact paths must remain inside
the project; an alternative configuration is indicated with `--config`.
The default config is `.scopegrain/config.json`; if only
`.tasksystem/config.json` exists, it is used without migrating it. If
both entries exist, an explicit `--config` is required; an explicit path
has no fallback.
See the [answers example](examples/answers.json) and its
[schema](schemas/answers.schema.json).

For journal operations, see the
[explicit recovery guide](docs/en/journal-recovery.md). For typed capture
notes with proven ownership, see
[selective captures](docs/en/captures.md). For the shared ownership proof
of creations (`capture`, `spec`, `design` and `report`, all revision 0),
see
[creation with proven ownership](docs/en/record-ownership.md).
The `specification create|show --owned` CLI is explicit opt-in and keeps
the legacy mode by default. `design create` and `outcome create` also
accept optional `--owned`; `design show` and `outcome show` require it.
Without that flag, creations keep their legacy inputs and results, with
no auto-detection or implicit enrollment. The generic reads
`artifact show design UUID` and `artifact show report UUID` remain
structural, not ownership proofs.

The typed stores `createOwnedDesignStore(ctx, { areaIds })` and
`createOwnedOutcomeStore(ctx, { areaIds })` respectively receive
`{ areaIds, design }` and `{ areaIds, outcome }` and expose `prepare`,
`create` and `get`. They require an enrolled workspace and explicitly
requested areas; local grants for all areas do not substitute the
all-of authorization. The design requires a structured V2 spec with a
valid hash binding, not parent ownership. Creating an outcome requires
a real formal task in REVIEW, a verification and healthy bindings;
reading its proven report does not revalidate current eligibility for
ACCEPT. The gates keep evaluating validity. No producers, hooks or
native integrations are activated.

## Organic and SDD

The methodology is selected when onboarding the project:

| Mode | Use |
| --- | --- |
| `manual` | Compatibility with V1 tasks, no implicit migration. |
| `organic-sdd` | Lightweight or formal route according to the declared facts. |
| `sdd` | Formal references for change work. |

An old configuration without a methodology is interpreted as `manual`
without rewriting its bytes. A new interactive project is offered
`organic-sdd`, subject to confirmation. A V2 task's controls are not
disabled by switching the project mode to `manual`.

Classification considers declared intent, authorization, understanding,
uncertainty, risk and continuity; it is not based on the number of diff
lines. A read-only query does not authorize changes. Missing or rejected
authorization, insufficient understanding, pending uncertainty or
unknown risk block the change route. A lightweight task does not require
inventing formal artifacts.

In SDD, every formal task, including preparatory ones, needs at least
one assigned scenario. A plan must cover all the scenarios of its
specification; tasks check their own assignments and their dependencies.
ACT and ACCEPT revalidate the applicable conditions and approvals. A
methodology query does not substitute human permissions or host
permissions. See [Organic and SDD](docs/en/methodology.md).

## Commands and continuity

```powershell
node ./bin/tasksystem.mjs catalog list command
node ./bin/tasksystem.mjs pipeline --project "C:\path\my-project" --mode plan
node ./bin/tasksystem.mjs plan create --project "C:\path\my-project" --input plan.json
node ./bin/tasksystem.mjs plan next entrega --project "C:\path\my-project"
```

Workflow aliases, such as `pipeline`, `spec`, `audit` or `research`,
deliver procedures and context; they do not execute models, agents or
scripts. Plans store dependencies; artifacts keep specifications,
designs, reports and other records. Sessions register operations and an
explicit budget; resuming them recovers context, it does not repeat
actions. JSON creations use preview by default and require `--apply`;
historic task operations keep their previous behavior.

Old task and plan examples without formal references correspond to
`manual`; the included answers example selects `organic-sdd`. See
[workflows and continuity](docs/en/workflows.md) and
[task flow](docs/task-workflow.md) before applying operations.

## Hosts and trust boundaries

Proposals are generated for Claude Code, Codex, OpenCode V2, Devin
Local/CLI, Google Antigravity and Hermes Agent (provisional, unverified
format). Native bridges and MCP fragments are
proposals for review and manual activation, not certified integrations
or a guarantee of permission or behavior equivalence. Devin Cloud is not
considered equivalent to Local/CLI. See
[native formats](docs/en/native-hosts.md).

- There is no model executor and no automatic execution of agents or
  host SDKs. The instructions are not a sandbox and do not intercept
  every native tool.
- The optional MCP offers read-only queries; it does not execute shell
  or modify tasks. Budgets count registered operations, not every host
  call, tokens or spend.
- Hashes bind records and declared evidence; they do not prove actual
  execution, actor or reviewer identity, or the full content of the
  worktree. An independent review or waiver is a process declaration.
- Path checks and locks do not constitute a serializable transaction
  across all files or operating-system isolation. Free-text bodies may
  contain sensitive data and must be reviewed before being persisted or
  shared.
- Discovered commands, installations, publications or Git operations are
  not executed automatically. See the
  [security model](docs/en/security.md).

## Verification

The local full suite of the foundation block finished with 536 passing
tests, none failed and none skipped on Windows, Node.js v26.8.1 and npm
11.6.0; it used single-test-file concurrency. An earlier manual focused
run recorded 163 passing. These are separate runs; scope and historic
results are in [verification](docs/en/verification.md). The tests do not
certify the five hosts or a real execution of the declared work.
The [GitHub Actions workflow](.github/workflows/verify.yml) is triggered
manually only and has not run yet.

## Code and license

The repository may be available for source reading, but that
availability does not grant an open-source or redistribution license.
`package.json` keeps `private: true` and `UNLICENSED`; no npm package is
published. The inherited material remains outside the active circuit and
subject to provenance and rights review.

## Documentation

- [Architecture](docs/en/architecture.md)
- [Onboarding and customization](docs/en/onboarding.md)
- [Compatibility and official sources](docs/compatibility.md)
- [Security and trust model](docs/en/security.md)
- [Migration and known limitations](docs/migration.md)
- [Destination of commands, agents, skills, rules and references](docs/component-migration.md)
- [Task flow and evidence](docs/task-workflow.md)
- [Organic, SDD, approvals and evidence boundaries](docs/en/methodology.md)
- [Workflows and continuity](docs/en/workflows.md)
- [Verification and reproduction](docs/en/verification.md)
- [Typed selective captures](docs/en/captures.md)
- [Creation with proven ownership](docs/en/record-ownership.md)
- [Complete system report](docs/system-report.md)
- [Product contract](docs/en/product-contract.md)
- [Implementation contract](docs/implementation.md)
