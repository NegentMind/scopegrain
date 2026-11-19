# Investigacion semantica acotada

`src/discovery/semantic.mjs` amplia el descubrimiento de manifiestos con
una capa semantica de solo lectura. No escribe, no ejecuta, no usa la red
y no modifica el proyecto. Toda deteccion proviene de evidencia
permitida; lo no determinado se reporta como desconocido explicito y
nunca se inventan stacks, frameworks ni comandos.

## API

```text
investigateProject(projectRoot, {config?})   -> investigacion tipada
suggestAnswers(investigation)                -> propuestas de init
diffInvestigation(config, investigation)     -> decisiones obsoletas
buildResearchRecord(investigation, {timestamp?})
                                             -> {record, suggestedPath}
validateResearchRecord(record)               -> record o RESEARCH_INVALID_RECORD
```

Distincion de comandos: `inspect` es la instantanea acotada de
manifiestos que `init` persiste como `discovery.json` (stacks, comandos
propuestos, fingerprint, warnings — nada mas). `investigate` ejecuta
esta capa semantica completa — topologia, plataformas, pruebas,
anfitriones, i18n — y ademas imprime las propuestas de
`suggestAnswers`; con `--save` persiste el registro de investigacion.
`init --defaults` consume `suggestAnswers` como fuente de respuestas no
interactivas.

### investigateProject

Compone `inspectProject` (no lo reimplementa) y agrega senales:

- **Topologia:** `monorepo` (campos `workspaces`, turbo/nx/lerna/
  pnpm-workspace/rush, `[workspace]` de Cargo, `settings.gradle`, o
  manifiestos en dos o mas directorios), `single-package`,
  `unstructured` (layout sin manifiesto) o `empty`.
- **Stacks extra** (`detectedBy:'semantic'`): `dart`/`flutter`
  (pubspec.yaml), `gradle`, `swift`, `python` por requirements.txt/
  setup.py. Los de `inspectProject` conservan `detectedBy:'manifest'`.
- **Plataformas:** `mobile` (android/, ios/), `desktop` (src-tauri/,
  tauri.conf.json, electron-builder, dependencias electron/tauri),
  `web` (configs y dependencias web), `cli` (bin de package.json,
  `[[bin]]` de Cargo, src/main.rs con stack rust).
- **Pruebas:** frameworks por configuracion permitida (vitest, jest,
  playwright, cypress, karma, mocha, pytest, phpunit, cargo-nextest) o
  por dependencias declaradas; `cargo-test`, `go-test`, `dotnet-test`,
  `xunit`, `nunit`, `mstest`, `flutter_test` segun manifiesto.
- **Docs:** archivos de instrucciones (AGENTS.md, CLAUDE.md, README
  variantes) por existencia y directorios docs/ o doc/.
- **CI:** `.github/workflows` listado solo por nombres `*.yml`/`*.yaml`
  (<=64 entradas, sin contenido); otros proveedores por existencia
  (GitLab, Azure, Jenkins, Travis, CircleCI, Bitbucket, Woodpecker).
- **Anfitriones:** senales de existencia (.claude/, .codex/, .opencode/,
  .devin/, .antigravity/, .agents/, .agent/, opencode.json, CLAUDE.md,
  AGENTS.md, GEMINI.md). Una
  senal de directorio nunca lista su contenido.
- **i18n:** directorios locales/i18n/l10n, i18next.config.* y
  dependencias de internacionalizacion.

Con `{config}` se sondea ademas la existencia de las siete rutas de
artefactos configuradas (`harness.artifactDirs`); la config nunca se
muta ni debilita los limites. Las opciones son objetos cerrados:
claves desconocidas producen `INVESTIGATION_INVALID_OPTIONS` y una
config no objeto `INVESTIGATION_INVALID_CONFIG`.

### suggestAnswers

Cada propuesta es `{value, confidence:'detected'|'default', evidence:[]}`:

| Campo | Base detectada | Respaldo |
| --- | --- | --- |
| `name` | `name` de manifiesto raiz | basename del directorio (`default`) |
| `hosts` | senales de anfitrion existentes | `[]` + `unanswered` |
| `paths` (7) | — | propuestas de `policy/onboarding-defaults.json` (`default`) |
| `verification` | comandos ya propuestos por inspectProject, `approved:false` | `manual` + `[]` |
| `versioning` | — | las ocho categorias en `false` |

Solo se sugieren anfitriones con senal detectada y solo comandos que
`inspectProject` ya extrajo de scripts declarados en manifiestos.
`unanswered` lista campos sin base detectada (hoy solo `hosts`).

### diffInvestigation

Comparacion pura y de solo lectura entre una config persistida y una
investigacion nueva. La config se clona antes de validarla (entradas
congeladas no se mutan). Reporta:

- `fingerprint` esperado vs actual; `manifests.added/removed/retained`
  y `lockfiles.added/removed` por evidencia almacenada.
- `contentIndeterminate:true` cuando el conjunto de manifiestos es
  identico pero el fingerprint difiere: la evidencia guardada no puede
  nombrar el archivo que cambio (honesto, no adivina).
- `stacks`, `commands` (persistidos vs propuestos) y `hosts.newSignals`
  (senales de anfitrion no configuradas).
- `staleDecisions`: decisiones persistidas potencialmente obsoletas.

### Registro de investigacion

`buildResearchRecord` devuelve `{record, suggestedPath}` donde
`suggestedPath` es el segmento `semantic-<fingerprint16>.json` para
guardar bajo `paths.research`. El registro es JSON plano:

```json
{
  "schemaVersion": 1,
  "fingerprint": "<sha256>",
  "stacks": [],
  "topology": {},
  "evidence": [],
  "suggestions": {},
  "unknowns": [],
  "timestamp": "<opcional, solo si el llamador lo entrega>"
}
```

Sin `timestamp` la salida es determinista. La escritura del archivo no
pertenece a esta capa. `validateResearchRecord` impone la forma cerrada
(claves exactas, fingerprint sha256, enums de topologia/evidencia,
propuestas bien formadas) y lanza `RESEARCH_INVALID_RECORD`.

## Limites ampliados respecto a inspectProject

No hay un segundo recorrido del arbol. El trabajo nuevo es:

- ~90 sondas `lstat` fijas (existencia; un enlace cuenta como ausente),
- como maximo un listado acotado de `.github/workflows` (64 nombres),
- relecturas acotadas (<=128 KiB) de nombres de manifiesto permitidos ya
  descubiertos por el scanner o por la lista de sondas.

Los contenidos leidos se limitan a package.json, Cargo.toml,
pyproject.toml, pubspec.yaml y *.csproj. Como las lecturas son por
lista permitida y no por lista denegada, `.env*`, `*.pem`, `*.key`,
`credentials*`, `.npmrc`, `.ssh/*` y afines son inalcanzables.
Los directorios de anfitriones se detectan por existencia; su contenido
nunca se lista.

## Errores

`INVESTIGATION_INVALID_OPTIONS`, `INVESTIGATION_INVALID_CONFIG`,
`INVESTIGATION_INVALID_INPUT` (argumentos malformados en funciones
puras), `RESEARCH_INVALID_RECORD`. Los errores de raiz/proyecto
(`INVALID_PROJECT`, `PROJECT_NOT_FOUND`, `SYMLINK_REJECTED`, ...) se
propagan sin envolver desde `resolveProjectRoot`/`inspectProject`.

## Que no hace

No afirma comprender el proyecto: sigue siendo deteccion por senales.
No escribe el registro, no rellena `answers.json` ni ejecuta `init`,
no aprueba comandos (todos `approved:false`), no elige metodologia ni
idoma, y no sustituye la confirmacion del propietario. Las propuestas
son puntos de partida para que el propietario solo confirme.
