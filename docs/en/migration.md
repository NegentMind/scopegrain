<!-- translated-from: docs/migration.md @ 2026-11-23 -->
# Migration and known limitations

> English translation of the canonical Spanish document
> (`../migration.md`). The Spanish version prevails.

## Provenance

This repository comes from a local copy of the original harness. The
copy is kept intact in `legacy/opencode/` (see `legacy/README.md`):
it is not active, no component loads it and it is excluded from
discovery, from allowed destinations and from version control until
the review of licenses, historical data and possible secrets is
complete.

The original `.git` pointer pointed to an external gitdir
(`../.git/modules/.opencode`); it is archived in
`legacy/provenance/copied-git-pointer.txt`. The current Git is
independent (`develop` branch) and rooted in this folder.

## What was migrated and what was not

- **The original file is not imported:** no original resource is
  activated by copying or by mass name substitution.
- **New sources:** separate procedures, neutral roles, skills, rules,
  references, prompts and profiles in `resources/manifest.json`.
  Aliases preserve compatibility without duplicating the editable
  source. They do not certify equivalence with each original
  resource.
- **New core:** CLI, discovery, config, bootstrap, adapters, tasks,
  catalog, workflows, plans, artifacts, sessions, versioning, doctor
  and MCP are new implementations; they are not a direct translation
  of the previous code. See [workflows](workflows.md).
- **Provenance:** the inventory individually captures 268 entries of
  eight types, hashes, indicators and activation blocks, plus the
  resource directory without SKILL.md. The classification of the 197
  skills is triage by identifier, not a semantic or license audit.
- **Dependencies:** only `@modelcontextprotocol/sdk` and `zod`
  declared, for the optional MCP server. The CLI does not use them.

## Known limitations

- The first base passed 73 local tests; do not use that number as the
  expansion's total. Current results and environment in
  [verification](verification.md), without multiplatform
  certification.
- Discovery covers seven stacks per manifest (`MANIFEST_STACK`:
  node, rust, python, go, java, php, ruby — dotnet by extension); tools
  without a recognized manifest remain unknown.
- Only `package.json` generates proposed commands (test/lint/check/
  typecheck/build); other stacks are recognized without proposing
  commands.
- The config's `verification.commands` is empty at initialization:
  no verification is considered approved without an explicit
  decision.
- MCP fragments are proposals; there is no writing to `.mcp.json`,
  `.codex/config.toml`, `opencode.json` or the project's
  `.devin/mcp_config.json`, and no automatic registration.
- There is no automatic migration from legacy material
  configurations.
- `doctor` reports state, it does not repair; `legacy` is never
  auto-loaded.
- An `--input` whose file does not exist may return `INTERNAL` for
  the `ENOENT` error. This is an error-taxonomy limitation pending
  follow-up, not an authorization or a permissions exception.
- There is a budget of recorded operations per session and a policy
  check before adding them. It does not account for all native
  calls, tokens or spend, and it does not block tools used outside
  Scopegrain.
- Harness-generated file names use ASCII. Project paths with Unicode
  are preserved and accepted, but their full compatibility with
  every host is not certified.

## Inherited debt preserved, not corrected in the archive

| Prior finding | Treatment in this codebase |
| --- | --- |
| Skill catalogs with differing counts (197 files, manifest 196, index 195) | Frozen individual inventory; active sources recorded in manifest.json, not in divergent manual indexes |
| C0 documented with 15 calls and code with 40 | Explicit and bounded session limit; not equivalent to counting native calls |
| Old `metasearchmcp_*` names mixed with `metasearch_*` | Inherited lists are not imported; own consultative MCP, no mutations |
| PowerShell sandbox without real isolation | Not integrated nor presented as a security guarantee |
| VantaDB-specific rules, commands and paths | Neutral core and new opt-in profiles; originals blocked outside the runtime |

These defects remain present in the preserved original archive. A
complete migration of its capabilities, agents or skills is not
declared.

## Planned future changes (outside this codebase)

- Semantic, license and dependency review of the original
  specialties not incorporated; classifying them is not porting
  them.
- Authenticated organizational policies and audited domain profiles.
- Supervised installation of native hooks and authorized execution
  of verifications.
- Assisted migration of previous configurations.
- Packaging and redistribution license after auditing provenance.
