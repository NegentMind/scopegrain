# Security and trust model

> English translation of the canonical Spanish document
> (`../security.md`). The Spanish version prevails.

## Controls and verification evidence

The following controls are implemented in the code; their proven scope
and limitations are recorded in [verification](verification.md). They do
not amount to a security certification.

- **No execution:** the core does not use `child_process`; the scanner
  neither executes nor expands discovered commands. Proposals arrive
  with `approved:false`.
- **No network:** no module opens sockets; the MCP server uses stdio.
- **Contained paths:** artifact paths are relative to the project, with
  no `..`, NUL, colons (drives/ADS), POSIX or win32 absolute paths, UNC
  or empty/`.` segments. The prefixes `.git`, `node_modules`, `legacy`
  and `.opencode` are vetoed as destinations. Machine-local MCP
  fragments do contain reviewable absolute installation/project paths.
- **Anti-link:** `lstat` on every existing ancestor; symlinks/junctions
  are rejected even when pointing inside. The chosen root must exist
  and be a real directory (not a link).
- **Bounded read:** only allowlisted manifests, <=128 KiB, depth <=4,
  <=1000 entries. `.env`, keys or credentials are never read, nor is
  the text of AGENTS/CLAUDE/README into the results.
- **Create-only:** complete preflight before writing; conflicts
  (different, link, directory) block the whole plan. Writes use the
  exclusive `wx` flag; rollback removes only what that operation
  created.
- **Consistent state:** verified exclusive lock (token + `dev`/`ino`
  identity re-proven before release, like the journal) + revision CAS +
  exclusive temp and rename. A foreign lock is a conflict: it is neither
  recovered nor deleted by a foreign `finally`.
- **Continuity:** plans with validated dependencies, immutable
  artifacts and sessions with CAS and a registered-operations limit.
  These mechanisms do not count calls the host omits to register.
- **Bounded persistence:** tasks, plans, artifacts and sessions
  validate serialized size before persisting and on read, per the
  limits policy. Temps are only cleaned after acquiring ownership via
  exclusive open; an EEXIST failure does not authorize deleting the
  existing one.
- **No generated credentials:** MCP fragments contain paths and names;
  init never asks for secrets. Free-text bodies have no universal
  secret detector: they require review and approved redaction before
  persisting sensitive requests.
- **No bypass flags:** `--yes` and `--force` are rejected; there is no
  implicit writing in non-TTY sessions.

## What the code does NOT guarantee

- **Markdown is not enforcement.** Generated instructions are
  conventions the agent can ignore; there is no sandbox over the host's
  native tools.
- **Attestations, not identity.** `authorContext`/`reviewerContext` and
  the evidence are registered declarations; there is no cryptographic
  authentication nor observation of what the host did outside the
  flow.
- **Containment vs. in-situ writing.** Validation is repeated just
  before writing, but a residual window still exists: any local process
  with write capability (not necessarily privileged or malicious)
  could create links or files between the check and the write.
- **No distributed coordination.** The lock covers processes using
  Scopegrain; other tools can edit task files. The policy check and a
  session append do not constitute a distributed transaction with the
  host's native tools.
- **Declared scope and evidence.** A check listed as `pass` does not
  prove it ran; trust comes from the human process.
- **Hashes, not product observation.** Bindings and approvals detect
  drift of validated records/payloads, not changes to every cited file
  or the worktree. They do not authenticate actor/reviewer, do not lock
  editors and do not form a serializable transaction across files.
  The gates and their limits are described in
  [Organic and SDD](methodology.md).
- **The legacy archive is not safe by omission.** `legacy/opencode/`
  may contain historic secrets; it is outside the active circuit and
  Git, pending audit before any distribution.

## Deployment recommendations

- Review `integrations/*.json|toml` before merging them into the host.
- Do not commit machine-local fragments without reviewing the absolute
  paths.
- Keep fixtures, sessions, traces and the private archive out of Git.
  In onboarded projects, ask which categories to share and review the
  parent's ignores before assuming the selection is applied. This
  repository keeps `.tasksystem/` ignored for its local work.
- Treat any discovery output as evidence, not as authorization to
  execute commands.
