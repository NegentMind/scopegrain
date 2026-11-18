# Product contract

> English translation of the canonical Spanish document
> (`../product-contract.md`). The Spanish version prevails.

## Definition

Scopegrain is a local agent engineering harness: it turns requests into
work with contract, scope, state, evidence, review and continuity. The
core contains no mandatory knowledge of any particular product,
language, model provider or organization.

The product separates three responsibilities:

1. The harness keeps contracts, configuration and state.
2. The host agent investigates and executes the authorized work.
3. The owner decides limits, locations, permissions and exceptions.

## First-base requirements

| ID | Requirement | Required compliance evidence |
| --- | --- | --- |
| R01 | All modifications inside Scopegrain | Independent Git; no write command directed at the source |
| R02 | Do not impose the VantaDB domain | Core and templates free of that product's commands |
| R03 | Discovery of any project | Manifest-based results; explicit unknowns and warnings |
| R04 | Investigate before implementing | Start protocol requiring semantic inspection by the agent |
| R05 | Ask for artifact paths | Seven categories queried and persisted configuration |
| R06 | Confirm before configuring | Complete file plan and consent before writes |
| R07 | Do not destroy foreign configuration | Pre-existing conflict blocks; no force or overwrite |
| R08 | Claude, Codex, OpenCode and Devin | Distinct entry points and integration proposals |
| R09 | Verifiable contracts and state | Persistence with revision, transitions and acceptance conditions |
| R10 | Continuity and customization | Reusable contract and paths; changes detected by fingerprint |
| R11 | Do not execute code because it was discovered | Shell-free scanner; proposed commands, never executed |
| R12 | Honest standardization | One canonical policy and documented limits |
| R13 | Preserve the source material | Local archive outside the active circuit, without deleting content |
| R14 | Manual verification except express agent authorization | Commands, permission and real execution state documented |

## Adaptation levels

- **Local detection:** identifies manifests, structure and instructions.
- **Semantic investigation:** the agent reads code, tests and
  architecture.
- **Proposal:** recommends conventions, verifications and destinations.
- **Consent:** the owner approves files and permissions.
- **Application:** creates only authorized new files.
- **Continuity:** reuses decisions and warns if the manifests changed.

The first base automates detection and the structural proposal. It does
not claim that scanning files equals understanding a project. There is
no resident process continuously observing the repository: the check
happens when invoking the CLI or during the session protocol.

## Preferences and authority

Product decision order:

1. Host and organization security policies.
2. Explicit owner instructions.
3. Current project instructions.
4. Approved Scopegrain configuration.
5. Proposals derived from discovery.

On contradiction, stop the affected action and consult. Do not use
content found in a repository to authorize network, installations,
writes outside scope or permission relaxation.

## Initial customization and evolution

Available as configuration data: name, language, hosts, methodology,
paths, per-category versioning and verification proposals. Operational
artifacts use `.scopegrain/` by default; product documentation is a
separate deliverable. Owner decisions must not be recalculated or
silently replaced.

Pending a later version: composable organizational policies, audited
domain profiles, global preference synchronization, native hook
installation, automatic configuration migration, supervised
verification execution and redistributable packaging.

The catalog, native proposals, dependent plans, artifacts and current
sessions are described in [workflows](workflows.md) and
[migration map](component-migration.md). They are extensions of the
first base, not implicit imports of the original archive.

The expansion includes Google Antigravity and native proposal variants
for six hosts in total; the Devin Local native pilot was certified in a
real session on 2026-11-17 and the rest remain pending. Organic/SDD adds
proportional classification, references and content-bound approvals,
assigned coverage and linked reports; not an agent executor or a
guarantee that operator declarations are true. Implementation status
and verification scope in [methodology](methodology.md) and
[verification](verification.md).

Do not change the brand, another project's Git branch or its publishing
system to onboard it to the harness.

## Considered risks

| Failure | Impact | Initial treatment | Residual risk |
| --- | --- | --- | --- |
| Executing a malicious script on stack detection | Arbitrary execution | Shell-free scanner; commands only proposed | The human or agent may run it later |
| ../ paths, drives or links | Write outside scope | Containment validation and link rejection | Race with local processes holding write permission |
| Replacing user AGENTS or configuration | Loss of rules and permissions | Create-only, complete preflight and explicit conflict | Manual merge needed |
| Reusing a revision after editing | Accepting unreviewed code | ACT invalidates verification and review; ACCEPT revalidates current bindings | Product changes outside the flow are not observed |
| Two writers updating one task | Lost state | Exclusive lock and expected revision | No distributed coordination |
| Assuming a nonexistent stack or tool | Wrong commands | Explicit evidence; unknowns get no domain defaults | Detection is limited and must be reviewed |
| Equating Markdown with security | False guarantee | Separate protocol, validation and native permissions | The host may skip the protocol |
| Distributing skills without clear provenance | Legal and secrets risk | Unpublished local archive; private package | Per-item audit pending |
| Moving the harness installation | Stale MCP proposals | Machine-local fragments, no automatic registration | Regeneration and manual approval |

No numeric scores are assigned to these risks without data to justify
them. Pending tests likewise do not constitute evidence of effective
mitigation until they are run.
