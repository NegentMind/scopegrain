# Scopegrain: implementation contract

> English translation of the canonical Spanish document
> (`../implementation.md`). The Spanish version prevails.

Status: approved as the working baseline by the request that created the
project. Scopegrain is the product name and the entire technical surface;
the former technical identity is fully retired. This does not grant a
redistribution license.

This contract documents the initial core and its invariants. The current
extensions are specified in [workflows](workflows.md),
[native integrations](native-hosts.md) and
[migration map](component-migration.md), with
[Organic and SDD](methodology.md) for the current gates. Additional
requirements include the canonical catalog, DAG plans, artifacts,
sessions with recorded budget, `.scopegrain/` workspace and
per-category prompted versioning.

## Limits of this delivery

The restrictions and authorizations narrated in this section are
historical to the initial contract; they do not summarize the current
authorizations.

Create a new, executable, generic base in this folder. Preserve the
inherited copy, but do not execute or mass-substitute-convert its
instructions. Do not touch any VantaDB path or its .opencode. In the
initial construction, tests, builds, linters, scripts, services and
installations were not authorized.
The owner later authorized the local tests and checks;
their results are in [verification](verification.md). At that stage,
those tests did not authorize installations, publication, push or
remote creation. Separately, consulting official documentation in
read-only mode was authorized to validate the native formats; not to
activate external integrations.
Later tests and startups required a proposed command and
manual execution by the owner or explicit scoped authorization.

## Decided architecture

A private Node.js ESM package, Node >=22. CLI with no external
dependencies. Optional MCP: use the already-copied dependencies
@modelcontextprotocol/sdk 1.27.1 and zod 4.5.4; do not install.
Do not implement JSON-RPC by hand.
Small synchronous core with {code,message} errors; CLI errors to stderr
and exitCode=1, result JSON to stdout. Do not call child_process.

Separate src/core, src/discovery, src/hosts, src/mcp and bin; src/adapters
keeps compatibility entry points. Every project path
comes from --project and/or an explicitly loaded configuration,
never from ascending from the installation. Do not depend on the
.opencode directory.
Instructions live in resources/{commands,agents,skills,rules,references,
prompts}/ and templates/, indexed in resources/manifest.json; do not
duplicate them as executable literals.
The canonical policy is policy/workflow.json; do not duplicate values in
code.

## Preservation

Move the copied directories agents, commands, configs, locks, mcp,
mcp-profiles, opencode-loop, plugins, references, rules, skills and
task-system to legacy/opencode/ without changing their content. Also
keep there AGENTS.md, SKILLS-MANIFEST.md, VANTADB-OPERATING-MANUAL.md,
opencode.jsonc, .vanta_profile, _typos.toml, .gitignore, package.json,
package-lock.json and bun.lock.
Do not move node_modules: it is ignored local cache, not part of the
product.
The lead keeps the invalid .git pointer in legacy/provenance/ and
creates the independent Git. Do not follow the pointer or modify
external metadata.
The inherited archive stays Git-ignored for licensing, historical data
and possible secrets. The new README explains this distribution
limitation.

## Discovery

inspectProject(projectRoot) returns {schemaVersion:1, stacks:[],
evidence:[], commands:[], fingerprint, warnings:[]}. No writes, shell or
network.
Folder traversal: maximum depth 4, maximum 1000 entries; exclude
.git, node_modules, vendor, .venv, venv, target, dist, build, coverage,
legacy, .scopegrain and names starting with a dot except
.github.
Never follow symlinks/junctions. Do not read .env, keys or credentials.
Read only allowlisted manifests with a 128 KiB limit:
package.json, Cargo.toml, pyproject.toml, go.mod, pom.xml,
composer.json, Gemfile and *.sln/*.csproj files; recognize AGENTS.md,
CLAUDE.md and README.md by existence, without copying their text into
the results. Limit depth, size and file count even in monorepos.
Keep relative references as evidence. Detect Node.js, Rust, Python, Go,
Java, PHP, Ruby and .NET by manifests, not by src/.
For package.json propose only test, lint, check, typecheck and build
scripts actually present; command/cwd/source/approved:false. Do not copy
its expansion.
Use npm/pnpm/yarn/bun per packageManager or lockfile; contradictory
signals produce a warning. A declared known packageManager wins with a
warning on conflicts; without a valid declaration, a single lockfile
signal allows proposing that manager. An unknown declaration or
absent/ambiguous signals produce command:null and a warning, with no
silent fallback to npm.
Other stacks: recognize, without inventing commands. Malformed JSON
produces a warning.
The fingerprint uses sha256 of paths and content of admitted manifests
and presence of recognized lockfiles, sorted; not date or absolute path.
Changing a manifest or adding/removing a lockfile signal changes it.
Later semantic investigation belongs to the agent, not to this scanner.

## Configuration and paths

createConfig(projectRoot, answers, discovery) produces:

```json
{
  "schemaVersion": 1,
  "project": {"name": "example", "root": "."},
  "locale": "es",
  "hosts": ["claude", "codex", "opencode", "devin"],
  "paths": {
    "plans": ".scopegrain/plans",
    "tasks": ".scopegrain/tasks",
    "reports": ".scopegrain/reports",
    "research": ".scopegrain/research",
    "decisions": ".scopegrain/decisions",
    "memory": ".scopegrain/memory",
    "state": ".scopegrain/state"
  },
  "verification": {"mode": "manual", "commands": []},
  "discovery": {"fingerprint": "", "stacks": [], "evidence": []}
}
```

The example is proposals, NOT implicitly accepted paths. The interactive
prompts must ask for ALL categories and the config path.
answers admits name, locale, hosts, paths and optional versioning.
When versioning is present it requires eight booleans: plans, tasks,
reports, reviews, research, decisions, memory and state. Absent equals
false in all categories for compatibility.
locale is only es or en; known hosts, no duplicates, at least one.
Validate types, version and keys; reject unknown ones in the answers and
in the configuration so typos are not ignored.
Default config .scopegrain/config.json; an alternative location requires
explicit --config and an explicit path does not fall back.
--config is relative to the project root. Do not store absolute project
paths in shared config.
loadConfig(projectRoot,configPath) validates without mutating.
The configuration and all destinations must be relative, without ..,
NUL, colon, Windows drives, UNC or empty segments; reject absolute paths
with POSIX AND win32 even when running on another system.
Do not allow .git, node_modules, legacy or .opencode as destinations.
Check lstat/realpath of all existing ancestors and reject
symlinks/junctions, even if they point inside. Verify real containment.
The seven paths cannot be equal or ancestors/descendants of each other.
They cannot collide with config, bootstrap or adapter files.
The explicitly chosen project root must exist and be a real directory.
Portable comparison is case-insensitive even on POSIX. Reject segments
with trailing dot/space, Windows device names even with extension,
ASCII controls and non-portable characters < > : " | ? *. Unicode is not
forbidden. Real containment still uses real paths, not just this key.

## Initialization and file plan

CLI inspect --project PATH: JSON to stdout only.
CLI init --project PATH [--config REL] [--answers FILE | --defaults]
[--apply].
Interactive: ask name, language, hosts, config, seven paths and eight
versioning preferences; show
discovery and all destinations, then confirm. Do not ask for secrets.
With --answers: default dry-run; --apply authorizes creating, not
replacing.
With --defaults: non-interactive answers from the existing config
(re-init no-op) or from suggestAnswers of the investigation plus the
wizard defaults; mutually exclusive with --answers.
No --yes, --force or implicit writes in non-TTY sessions.
Generate next to config: instructions.md, discovery.json,
task-contract.md, integrations/{host}-mcp.json or .toml. All template
placeholders are resolved; file names do not depend on untrusted text.
AGENTS.md is the common entry point of codex, opencode and devin;
CLAUDE.md for claude. If both are needed, do not duplicate files in the
plan.
MCP integrations are PROPOSED FRAGMENTS, not active host files.
Create files only after full preflight. An identical preexisting
destination is no-op; a different one, symlink or directory blocks
EVERYTHING before creating anything. Also validate collisions between
files of the plan itself and ancestors. Exclusive writes with wx flag;
if there is a race, do not replace. Keep a list of created files and
remove ONLY those on rollback if an error occurs; do not delete foreign
files or foreign directories.
Re-running with a valid existing config is no-op; if the answers
differ, explicit error: manual reconciliation, not silent overwrite.
With an unchanged fingerprint the complete bytes of config and
discovery are preserved, including manual preferences and user
formatting. The current discovery only serves the preview. Interactive
defaults come from the existing config, not from generic proposals that
would replace preferences.
Before applying, repeat preflight/ancestor validation; also detect
planned files that are ancestors of other files. Ownership tracking
starts at exclusive open, before writing, to remove partial own files
if a write fails.
Do not execute commands or modify the root .gitignore or existing host
files. A nested ignore and an external proposal are generated from the
preferences, with no Git commands and no auto-untracking.

## Adapters

renderAdapters(config,{projectRoot,configPath,instructionsPath,
serverPath}) returns proposed files and metadata. Absolute serverPath
points to the LOCAL installation, not to the project. Label fragments as
machine-local: do not commit them without review; regenerate when moving
the installation.
Serialize JSON with JSON.stringify; TOML strings with compatible
escaping, no shell interpolation. Do not build concatenated shell
commands.
Always pass --project and --config as separate args to the server.
--project is absolute; --config is relative to the chosen root. Although
the render API receives absolute configPath, check containment and
convert it before serializing, to honor the loadConfig contract.
Claude: .mcp.json proposal {"mcpServers":{"scopegrain":{"type":"stdio",
"command":"node","args":[SERVER,"--project",ROOT,"--config",CONFIG]}}}.
Devin Local/CLI: same mcpServers wrapper and command/args, without type.
Codex: fragment for .codex/config.toml [mcp_servers.scopegrain] with
command and args. OpenCode V2: format {"mcp":{"servers":{"scopegrain":
{"type":"local","command":["node",SERVER,"--project",ROOT,"--config",
CONFIG],"disabled":true}}}}.
Do not promise a permission profile or equivalent subagents; do not
automatically register third-party servers or services.

## Tasks and policy

Tasks are JSON in paths.tasks/{UUID}.json. Validate IDs as UUID before
composing paths; never use an ID as a free path.
createTask(config,{title,contract,authorContext,scope:[]}) requires
non-empty strings and scope as a list of contained relative paths. It
generates UUID, state=PLAN, revision=0 and initial history; it does not
allow arbitrary attributes.
transitionTask(config,{id,to,expectedRevision,verification?,review?}):
read real state, check transition against workflow.json, CAS revision,
per-task lock via open wx, exclusive temporary write and rename.
Existing lock: conflict error, do not recover automatically. Clean only
own locks/temporaries with finally. Validate read tasks.
Revision must be a non-negative integer and must match the stored one.
The change to ACCEPT ALWAYS revalidates the stored or supplied
evidence, not just its presence. It requires non-empty verification:
{checks:[{command,cwd,status:"pass",evidence:"referencia"}]} and review:
{mode:"fresh",reviewer,authorContext,reviewerContext,
verdict:"approve"}, authorContext must match the stored author and
reviewerContext must be non-empty and different; or
{mode:"waived",owner,reference,reason,verdict:"approve"}. They are
attestations: document it.
ACT invalidates previous verification and review; changing verification
invalidates review. Do not carry over approvals from a previous
implementation.
checkAction(config,taskId,action) takes stored real state and applies
workflow.actions, rejecting unknown ones. It does not count native calls
or allege a sandbox. Do not introduce budgets that are not measured.
listTasks/getTask are read-only; a malformed task is not silently
discarded.
The internal id must match the file name; timestamps, history and scope
have valid types and paths. A .json file without a UUID is malformed.
CLI task create --input FILE [--apply] (the
--title/--contract/--author flags form only applies to projects in
manual mode);
task list;
task show ID; task transition ID STATE --revision N [--evidence
JSONFILE].
Evidence only admits verification and review. The CLI does not run
verifications.

## Doctor

Read-only: validates config, paths, installed templates, bootstrap
existence, current fingerprint and MCP proposals. Reports
changedDiscovery, warnings and ready/needs-attention, without executing
anything or claiming the host or services are installed. Malformed
config causes an error.

## MCP

Optional stdio server with SDK, main guard so it does not start when
imported.
Config and project root bound at startup; do not accept paths from each
tool.
createMCPServer({project,config}) builds without connecting;
startMCPServer connects over stdio. createMCPTools(ctx,z) returns
{name,config,handler} descriptors shared by real registration and
handler tests.
READ-ONLY tools with readOnlyHint:true:
scopegrain_inspect {}, scopegrain_status {}, scopegrain_list_tasks {},
scopegrain_get_task {id}, scopegrain_check_action {taskId,action}.
Share implementations with the CLI. JSON in text content; isError errors
without leaking secrets or stack. stdout exclusive for protocol, stderr
for logs.
No shell, network, writes or acceptance tools over MCP in this base.

## Initial review adjustments

- Read manifests with a descriptor and a real byte limit, not unlimited
  readFile after stat. Also limit directory enumeration.
- Report depth/entry limits and read failures as warnings.
- doctor propagates warnings and validates proposals, not just their
  existence.
- CLI --help works; unknown, extra or valueless arguments fail before
  writing.
- Add regressions for byte-stable restart, Windows aliases, collisions
  between planned files, own rollback, corrupt persisted evidence,
  real adapter arguments and effectively registered MCP handlers.
- Do not confuse synthetic fixtures with real verification results.

## Tests to write, NOT to run

Use node:test and assert; TEMPORARY fixtures under tests/.tmp (not
outside Scopegrain). Clean only what the test created. Cases:
1. Node and monorepo discovery with spaced paths and a real script.
2. src/ without Cargo.toml does not imply Rust; an empty project stays
   unknown.
3. Malformed JSON and a large manifest reported, never executed.
4. Secrets, node_modules, legacy and symlinks not inspected.
5. Deterministic fingerprint sensitive to manifest changes.
6. ../, absolute, Windows drive/UNC, colon, symlinks and overlapping
   paths rejected; symlink tests skipped with reason if Windows does not
   allow them.
7. Config version/types/host/locale/invalid keys rejected.
8. Init dry-run does not write; apply creates; re-run no-op preserves
   bytes.
9. AGENTS/CLAUDE/config conflict blocks without partial writes.
10. Parseable adapter JSON and well-escaped TOML, separate args, no
    credentials or VantaDB paths, without activating host
    configuration.
11. Task valid/invalid transition, UUID traversal, stale revision,
    busy lock, corrupt JSON and unknowns rejected.
12. ACCEPT without evidence, failing evidence, same-context and false
    author fail; valid fresh or complete waiver passes; ACT invalidates
    previous evidence.
13. MCP read-only tools use the same functions; import does not start.
14. No test uses the legacy archive or calls host tools.

Create architecture, onboarding, compatibility, security, migration
and verification docs consistent with the real code. Do not claim
passing tests.
Do not generate other prompts/policies; any contract doubt is reported.
