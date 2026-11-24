<!-- translated-from: docs/release-runbook.md @ 2026-11-24 -->
# npm release runbook

> English translation of the canonical Spanish document
> (`../release-runbook.md`). The Spanish version prevails.

> Operational process for publishing the `scopegrain` package to npm
> (and optionally to the MCP Registry). Based on the real repo state at
> 2026-11-24 (`package.json` 0.1.1, HEAD past `75b55e0`).
> It is distinct from the `dist` catalog-distribution subsystem
> documented in [distribution.md](../distribution.md): that moves
> resources between projects; this publishes the harness itself.

## 0. Verified state that shapes the process

| Fact | Verified value | Reference |
|---|---|---|
| npm name | `scopegrain` (unscoped). `npm view scopegrain` returns **404 as of 2026-11-24** — the name is free today; re-verify at every release | `package.json:name` |
| Version | `0.1.1` (`package.json`, `server.json`, `viewer/package.json`) | — |
| Catalog version | `resources/manifest.json` carries `version: 0.1.2` — **versioned independently of the package**: `scripts/check-manifest-version.mjs` requires a manifest bump when a PR touches `resources/`, not lockstep with `package.json` | `resources/manifest.json`, `scripts/check-manifest-version.mjs` |
| `prepack` | `npm run build:viewer && npm test` — **runs automatically** on `npm pack` and `npm publish` | `package.json:scripts` |
| `files[]` | `bin src resources policy templates schemas docs/*.md docs/en/*.md viewer/dist examples CHANGELOG.md AUTHORS NOTICE`. **`provenance/` is EXCLUDED** — the audit already flagged that `catalog legacy` is inoperable in the published package; keep the exclusion until the license review resolves (`AGENTS.md`: "initial archive is local-only pending provenance and license review") | `package.json:files` |
| Lockfile | `package-lock.json` exists at root (commit `75b55e0`) | root |
| Engines | `node >=22`, `packageManager: npm@11.6.0` | `package.json` |
| CI | `.github/workflows/verify.yml`: Node 22/24 × ubuntu/windows matrix + viewer lane (lint, typecheck, test, build). **No publish workflow exists** | `.github/workflows/` |
| MCP Registry | `server.json` at root + `"mcpName": "io.github.negentmind/scopegrain"` in `package.json` (registry validation) | `server.json` |

## 1. One-time setup

1. npm account with 2FA (*auth-and-writes* mode). For CI publishing:
   configure **Trusted Publishing** (OIDC) on npmjs.com → GitHub
   `NegentMind/scopegrain`, workflow `release.yml`, job `publish`. This
   removes long-lived tokens and enables real provenance.
   Alternative: granular access token scoped to the package (manual
   rotation; no provenance outside CI).
2. `npm login` on the maintainer machine if publishing by hand.
3. Verify the name is still free or the account has permissions:
   `npm view scopegrain` (404 = free; 200 = check `maintainers`).

## 2. Release checklist

### 2.1 Version bumps

- [ ] `package.json` → new semver version.
- [ ] `server.json` → `version` and `packages[].version` (the MCP
      registry publishes whatever this file declares).
- [ ] `viewer/package.json` → keep in sync for hygiene (it is
      `private:true`; not published but `viewer/dist` ships in the tarball).
- [ ] `resources/manifest.json` → **only** if the release touches
      `resources/` (independent versioning, see §0).
- [ ] `CHANGELOG.md` → move `Unreleased` to the new version with date.
- [ ] `docs/verification.md` → record the real suite run (date,
      command, count). The declared count at 2026-11-24 was 1540; the
      audit context indicates ~1646 — **record the real figure from the
      output, never copy numbers**.
- [ ] Release commit: `chore(release): vX.Y.Z`.

### 2.2 Local gates (run on the maintainer machine)

```bash
npm test                       # full serial suite (node --test)
npm run build:viewer           # tsc --noEmit + vite build -> viewer/dist
npm pack --dry-run             # tarball inspection
```

Notes:

- `npm pack --dry-run` **triggers `prepack`** automatically (build +
  test again). Redundant but correct: what gets inspected is exactly
  what would be published.
- In `npm pack --dry-run`, verify against `files[]`:
  - `viewer/dist/` **present** with `index.html` (without the build the
    API still works but the viewer stays 404 — see
    `src/api/server.mjs:36-39`).
  - `bin/scopegrain.mjs` present with shebang.
  - `server.json` present (the MCP Registry requires it; at root npm
    always includes it).
  - `provenance/`, `legacy/`, `tests/`, `viewer/src`, `.github`,
    `.scopegrain` **absent**.
  - Reasonable size (`viewer/dist` `.map` files inflate the tarball;
    acceptable, but review if it grows much).
- CI gate: pushing to `develop`/`main` triggers `verify.yml` (full
  matrix). A release with red CI is not published.

### 2.3 Publishing

**Option A — CI with provenance (recommended).** Add
`.github/workflows/release.yml` (does not exist yet — proposal):

```yaml
name: Release
on:
  push:
    tags: ['v*']
permissions:
  id-token: write    # OIDC for npm provenance / trusted publishing
  contents: read
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with: { persist-credentials: false }
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version: '24'
          registry-url: 'https://registry.npmjs.org'
      - run: npm ci --ignore-scripts --no-audit --no-fund
      - run: npm run build:viewer
      - run: npm publish --provenance --access public
```

- `--provenance` generates Sigstore/Rekor attestations **only** in CI
  with OIDC (`id-token: write`). Outside CI npm cannot sign the
  attestation — option B publishes without provenance.
- With Trusted Publishing configured no `NODE_AUTH_TOKEN` is needed;
  with a classic token add `env: NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`.
- Trigger: `git tag -s vX.Y.Z -m "release vX.Y.Z" && git push origin vX.Y.Z`
  (signed tag — doubles as external anchoring, see
  `external-anchoring-eval.md`).

**Option B — manual (fallback).**

```bash
npm publish --access public        # no --provenance: no attestation outside CI
```

`prepack` runs build+test again before uploading the tarball — if it
fails, nothing is published. Honestly document that this path carries
no provenance.

### 2.4 MCP Registry (optional, after npm)

`server.json` + `mcpName` are already in the repo. After npm:

```bash
# Official registry CLI (verify current install instructions at release time)
mcp-publisher publish   # validates server.json against package.json (mcpName) and the published tarball
```

Mandatory order: npm first — the registry checks that the npm package
exists at the declared version.

## 3. Rollback

| Scenario | Action |
|---|---|
| Severe defect detected < 72 h | `npm deprecate scopegrain@X.Y.Z "reason"` (not `unpublish`: npm discourages it and it fails with dependents; `unpublish -f` only as a last resort within 72 h) |
| Defect > 72 h | `npm deprecate` + publish `X.Y.(Z+1)` with the fix — never republish the same version (npm forbids it) |
| CI release failed mid-way | The workflow publishes last; an `npm ci`/build failure aborts before publish — nothing to revert |
| Wrong tag | Delete remote tag and recreate: `git push origin :refs/tags/vX.Y.Z` — only if publish has not run yet |

## 4. Post-release verification

```bash
npm view scopegrain version              # must show the new one
npm view scopegrain dist.attestations    # provenance (option A)
npm install -g scopegrain@X.Y.Z          # real global install
scopegrain context --project <fixture>   # smoke test on a trial project
```

- [ ] `npm view scopegrain` shows the new version.
- [ ] Attestation visible in `npm view scopegrain dist` (option A).
- [ ] Global install works with absolute `--project`
      (global-safe per the audit).
- [ ] Record the release in `docs/verification.md` or `CHANGELOG.md`.

## 5. Declared residual risks

- **`catalog legacy` broken in the package** (audit §1): `provenance/`
  excluded from `files[]`. Not a release blocker; a known limitation of
  the published package until the license review resolves.
- **Name squatting**: if `npm view scopegrain` stops returning 404, the
  fallback is the `@negentmind/scopegrain` scope — requires updating
  `mcpName`, `server.json`, bin and docs.
- **Windows tests**: `verify run` with `.cmd` is broken on Windows
  (audit P1-6); it does not block the publish but does affect the
  "green `npm test` on Windows" promise for `verify` users — the CI
  matrix covers windows-latest and must be green before tagging.
