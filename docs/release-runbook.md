# Runbook de release a npm

> Proceso operativo para publicar el paquete `scopegrain` en npm (y
> opcionalmente en el MCP Registry). Basado en el estado real del repo
> a 2026-11-24 (`package.json` 0.1.1, HEAD posterior a `75b55e0`).
> Es distinto del subsistema de distribución de catálogos `dist`
> documentado en [distribution.md](distribution.md): aquello mueve
> recursos entre proyectos; esto publica el harness mismo.

## 0. Estado verificado que condiciona el proceso

| Hecho | Valor verificado | Referencia |
|---|---|---|
| Nombre npm | `scopegrain` (sin scope). `npm view scopegrain` devuelve **404 a fecha 2026-11-24** — el nombre está libre hoy; re-verificar en cada release | `package.json:name` |
| Versión | `0.1.1` (`package.json`, `server.json`, `viewer/package.json`) | — |
| Versión de catálogo | `resources/manifest.json` lleva `version: 0.1.2` — **versionado independiente del paquete**: `scripts/check-manifest-version.mjs` exige bump del manifest cuando un PR toca `resources/`, no lockstep con `package.json` | `resources/manifest.json`, `scripts/check-manifest-version.mjs` |
| `prepack` | `npm run build:viewer && npm test` — **se ejecuta solo** en `npm pack` y `npm publish` | `package.json:scripts` |
| `files[]` | `bin src resources policy templates schemas docs/*.md docs/en/*.md viewer/dist examples CHANGELOG.md AUTHORS NOTICE`. **`provenance/` queda EXCLUIDO** — la auditoría ya marcó que `catalog legacy` queda inoperante en el paquete publicado; mantener la exclusión hasta revisar licencias (`AGENTS.md`: «initial archive is local-only pending provenance and license review») | `package.json:files` |
| Lockfile | `package-lock.json` existe en raíz (commit `75b55e0`) | raíz |
| Engines | `node >=22`, `packageManager: npm@11.6.0` | `package.json` |
| CI | `.github/workflows/verify.yml`: matriz Node 22/24 × ubuntu/windows + lane de viewer (lint, typecheck, test, build). **No existe workflow de publish** | `.github/workflows/` |
| MCP Registry | `server.json` en raíz + `"mcpName": "io.github.negentmind/scopegrain"` en `package.json` (validación del registry) | `server.json` |

## 1. Preparación única (una vez)

1. Cuenta npm con 2FA (modo *auth-and-writes*). Para publish desde CI:
   configurar **Trusted Publishing** (OIDC) en npmjs.com → GitHub
   `NegentMind/scopegrain`, workflow `release.yml`, job `publish`. Esto
   elimina tokens de larga duración y habilita provenance real.
   Alternativa: granular access token con scope al paquete (rotación
   manual; sin provenance fuera de CI).
2. `npm login` en la máquina del mantenedor si se publica a mano.
3. Verificar que el nombre sigue libre o que la cuenta tiene permisos:
   `npm view scopegrain` (404 = libre; 200 = comprobar `maintainers`).

## 2. Checklist de release

### 2.1 Bump de versiones

- [ ] `package.json` → nueva versión semver.
- [ ] `server.json` → `version` y `packages[].version` (registry MCP
      publica lo que declare este fichero).
- [ ] `viewer/package.json` → mantener al día por higiene (es
      `private:true`; no se publica pero `viewer/dist` viaja en el tarball).
- [ ] `resources/manifest.json` → **sólo** si el release toca
      `resources/` (versionado independiente, ver §0).
- [ ] `CHANGELOG.md` → mover `Unreleased` a la nueva versión con fecha.
- [ ] `docs/verification.md` → registrar la ejecución real de la suite
      (fecha, comando, conteo). El conteo declarado a 2026-11-24 era
      1540; el contexto de auditoría indica ~1646 — **registrar la cifra
      real de la salida, nunca copiar números**.
- [ ] Commit de release: `chore(release): vX.Y.Z`.

### 2.2 Gates locales (ejecutar en la máquina del mantenedor)

```bash
npm test                       # suite completa serial (node --test)
npm run build:viewer           # tsc --noEmit + vite build -> viewer/dist
npm pack --dry-run             # inspección del tarball
```

Notas:

- `npm pack --dry-run` **dispara `prepack`** automáticamente (build +
  test otra vez). Es redundante pero correcto: lo que se inspecciona es
  exactamente lo que se publicaría.
- En `npm pack --dry-run`, verificar contra `files[]`:
  - `viewer/dist/` **presente** con `index.html` (sin el build el API
    sigue siendo usable pero el visor queda 404 — ver
    `src/api/server.mjs:36-39`).
  - `bin/scopegrain.mjs` presente con shebang.
  - `server.json` presente (el MCP Registry lo exige; al estar en raíz
    npm lo incluye siempre).
  - `provenance/`, `legacy/`, `tests/`, `viewer/src`, `.github`,
    `.scopegrain` **ausentes**.
  - Tamaño razonable (los `.map` de `viewer/dist` inflan el tarball;
    aceptable, pero revisar si crece mucho).
- Gate de CI: push a `develop`/`main` dispara `verify.yml` (matriz
  completa). Un release con CI rojo no se publica.

### 2.3 Publicación

**Opción A — CI con provenance (recomendada).** Añadir
`.github/workflows/release.yml` (aún no existe — propuesta):

```yaml
name: Release
on:
  push:
    tags: ['v*']
permissions:
  id-token: write    # OIDC para npm provenance / trusted publishing
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

- `--provenance` genera attestations Sigstore/Rekor **sólo** en CI con
  OIDC (`id-token: write`). Fuera de CI npm no puede firmar la
  attestation — la opción B publica sin provenance.
- Con Trusted Publishing configurado, no hace falta `NODE_AUTH_TOKEN`;
  si se usa token clásico, añadir `env: NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`.
- Disparo: `git tag -s vX.Y.Z -m "release vX.Y.Z" && git push origin vX.Y.Z`
  (tag firmado — además sirve de anclaje externo, ver
  `external-anchoring-eval.md`).

**Opción B — manual (fallback).**

```bash
npm publish --access public        # sin --provenance: fuera de CI no se genera attestation
```

`prepack` vuelve a correr build+test antes de subir el tarball — si
falla, no se publica nada. Documentar honestamente que esta vía no
lleva provenance.

### 2.4 MCP Registry (opcional, tras npm)

`server.json` + `mcpName` ya están en el repo. Tras publicar en npm:

```bash
# CLI oficial del registry (verificar instalación vigente en el momento)
mcp-publisher publish   # valida server.json contra package.json (mcpName) y el tarball publicado
```

Orden obligatorio: npm primero — el registry comprueba que el paquete
npm existe con la versión declarada.

## 3. Rollback

| Escenario | Acción |
|---|---|
| Defecto grave detectado < 72 h | `npm deprecate scopegrain@X.Y.Z "motivo"` (no `unpublish`: npm lo desaconseja y falla si hay dependientes; `unpublish -f` sólo como último recurso y dentro de 72 h) |
| Defecto > 72 h | `npm deprecate` + publicar `X.Y.(Z+1)` con el fix — nunca re-publicar la misma versión (npm no lo permite) |
| Release CI falló a mitad | El workflow publica al final; un fallo en `npm ci`/build aborta antes del publish — nada que revertir |
| Tag equivocado | Borrar tag remoto y recrear: `git push origin :refs/tags/vX.Y.Z` — sólo si el publish aún no corrió |

## 4. Verificación post-release

```bash
npm view scopegrain version              # debe mostrar la nueva
npm view scopegrain dist.attestations    # provenance (si opción A)
npm install -g scopegrain@X.Y.Z          # instalación global real
scopegrain context --project <fixture>   # smoke sobre un proyecto de prueba
```

- [ ] `npm view scopegrain` muestra versión nueva.
- [ ] Attestation visible en `npm view scopegrain dist` (opción A).
- [ ] Instalación global funciona con `--project` absoluto
      (global-safe verificado por la auditoría).
- [ ] Registrar la release en `docs/verification.md` o `CHANGELOG.md`.

## 5. Riesgos residuales declarados

- **`catalog legacy` roto en el paquete** (auditoría §1): `provenance/`
  excluido de `files[]`. No es bloqueo de release; es limitación
  conocida del paquete publicado hasta resolver la revisión de
  licencias.
- **Nombre squat**: si `npm view scopegrain` dejara de ser 404, el
  plan B es scope `@negentmind/scopegrain` — exige actualizar
  `mcpName`, `server.json`, bin y docs.
- **Tests Windows**: `verify run` con `.cmd` está roto en Windows
  (P1-6 de la auditoría); no bloquea el publish pero sí la promesa
  «npm test verde en Windows» para usuarios de `verify` — la matriz CI
  cubre windows-latest y debe estar verde antes del tag.
