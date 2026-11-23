---
name: unified-review
description: Usar para elegir verificación rápida, certificación, revisión enfocada o inspección amplia proporcional al riesgo evidenciado, sin duplicar procedimientos de auditoría
---
# Orquestación unificada de revisión y auditoría

Orquestador neutro respecto al proyecto para revisión, auditoría y
certificación pre-entrega. Construido alrededor del **fan-out de contexto
nuevo**: el orquestador detecta el proyecto, lanza una sub-revisión
independiente por fase mediante el mecanismo de subagentes que el host
provea, recoge informes estructurados, consolida hallazgos y escribe un
informe priorizado, manteniendo su propio contexto bajo ~10% del presupuesto.

Modos: `quick`, `certify`, `review`, `full`. En términos de scopegrain estos
mapean a los comandos existentes en lugar de una superficie nueva:
`quick`/`certify` extienden `verify-work`, `review` extiende `review-change`,
y `full` extiende `audit-project`. No inventes una superficie de comandos
paralela; el modo selecciona *profundidad*, no *autoridad*.

---

## Qué hace el orquestador

1. **Fase 0 — Detectar.** Inspecciona el árbol de trabajo, identifica
   lenguajes, bindings, framework web, CI/CD, docs y tooling opcional, y
   luego carga el perfil correspondiente. Se ejecuta síncronamente; debe
   completar en segundos.
2. **Fases L1..L9 — Fan-out.** Lanza un contexto independiente por fase.
   Cada una ejecuta comprobaciones mecánicas (compile, lint, test), aplica
   skills de revisión cognitiva, y devuelve un informe JSON estructurado:
   solo el JSON.
3. **Fase L10 — Fan-in.** Agrega, deduplica, detecta patrones transversales,
   calcula puntuaciones, evalúa la puerta de calidad.
4. **Fase L11 — Informe.** Escribe el informe final en el directorio de
   revisiones del proyecto (por defecto `.scopegrain/reviews/` o la ruta de
   estado declarada del proyecto) y lo registra en el índice de informes.

## Cuándo usar

| Disparador | Modo |
|---------|------|
| "¿Rompo algo?" antes de guardar | `quick` |
| A punto de pushear / entregar una unidad de trabajo | `certify` |
| Revisar un PR / diff / solicitud de cambio | `review` |
| Revisión profunda periódica / preparación de release | `full` |

## División del trabajo

Esta skill es dueña **solo del contrato de orquestación**: detección,
perfiles, selección de modo, fan-out/fan-in, la taxonomía de hallazgos, la
puntuación y el informe. Deliberadamente no posee la metodología del revisor:

- `code-review-and-quality`: la checklist del revisor, los prefijos de
  severidad y la disciplina de feedback (se carga dentro de L9, nunca en el
  orquestador).
- `review-deep`: el bucle profundo por módulo; L6 puede delegarle un
  deep-dive de módulo, y puede invocarse de forma independiente entre
  auditorías.
- `independent-review`: el contrato de veredicto con contexto nuevo para
  unidades con riesgo nombrado (véase Proporcionalidad); una fase de
  sub-revisión no lo sustituye.
- `review-feedback`: actuar sobre feedback de revisión recibido; fuera de
  alcance aquí: esta skill produce hallazgos, aquella los resuelve.

Una fase que necesita juicio de revisor carga la skill hermana **dentro del
contexto de sub-revisión**; los hallazgos siguen volviendo en la taxonomía
canónica para que L10 pueda deduplicarlos y puntuarlos.

---

## Proporcionalidad por riesgo evidenciado

Clasifica la profundidad de revisión a partir de la evidencia (rutas,
contenido del diff y categorías de riesgo declaradas), nunca solo del
tamaño del cambio o la confianza del autor:

- **Contenido/pasivo** (docs, comentarios, tests de comportamiento
  existente): readback estructural: confirma los límites de alcance y que
  nada ejecutable cambió; no hace falta inspección profunda.
- **Ordinario/medio**: autoverificación más la revisión de diff estándar.
- **Riesgo nombrado** (security, data-integrity, public-contract,
  concurrency, delivery, external-effects, verification-gap): la revisión
  independiente con contexto nuevo es obligatoria para esa unidad; un cambio
  de etiqueta en el mismo contexto no es independencia. La exención del
  dueño debe cubrir explícitamente el riesgo nombrado y llevar los campos
  que el contrato de workflow requiere (owner, reference, reason).

El límite de revisión es el commit de unidad de trabajo terminado o la
porción de PR, no la funcionalidad acumulada. Una unidad de alto riesgo
revisada dentro de un diff abultado se trata como no revisada: aíslala y
revisa solo ese límite.

Los hallazgos y niveles de revisión son atestaciones de evidencia vista:
nunca una autorización para mergear, publicar o entregar.

---

## Fase 0 — Motor de detección

Se ejecuta **síncronamente en el orquestador**: sin subagente. Produce un
objeto `DetectionResult` que cada fase descendente recibe para no
re-detectar nunca. Pasos, en orden:

### 0.1 Estado del árbol de trabajo

```
git status --short
git diff --name-only HEAD
git log --oneline -10
```

Si nada cambió y el modo solicitado es `quick`/`certify`, sugiere `full` y
para: una puerta sobre un diff vacío es teatro.

### 0.2 Detección de lenguaje

Comprueba archivos marcador en la raíz del repo y dentro de los directorios
del workspace:

| Marcador | Lenguaje | Notas |
|--------|----------|-------|
| `Cargo.toml` (con `[workspace]`) | Rust multi-crate | Inspecciona `members` |
| `Cargo.toml` (único) | Rust | |
| `pyproject.toml` / `setup.py` / `setup.cfg` | Python | Comprueba `[build-system]` (maturin ⇒ bindings Rust) |
| `package.json` | TypeScript / JavaScript | Inspecciona `workspaces` |
| `go.mod` | Go | |
| `pom.xml` / `build.gradle` | Java / Kotlin | |
| `CMakeLists.txt` | C / C++ | |
| `mix.exs` | Elixir | |
| `Gemfile` | Ruby | |

### 0.3 Detección de bindings / SDK

- `pyproject.toml` con build-backend `maturin` → bindings Python vía PyO3
- `crate-type = ["cdylib"]` + tooling wasm → bindings WASM
- `package.json` + `tsconfig.json` + entrada `index.ts` → SDK TypeScript
- directorio `bindings/` o `sdk/` → inspecciona contenido

### 0.4 Detección de framework web

`next.config.*` → Next.js · `vite.config.*` → Vite · `astro.config.*` →
Astro · `nuxt.config.*` → Nuxt · `remix.config.*` → Remix ·
`svelte.config.js` → SvelteKit · `angular.json` → Angular · `index.html`
plano sin framework → estático.

### 0.5 Detección de CI/CD

`.github/workflows/*.yml` → GitHub Actions · `.gitlab-ci.yml` → GitLab CI ·
`.circleci/config.yml` → CircleCI · `azure-pipelines.yml` → Azure ·
`Jenkinsfile` → Jenkins · `.drone.yml` → Drone.

### 0.6 Detección de documentación

Directorio `docs/` (mdbook, docusaurus, mkdocs, sphinx …), `README.md`,
`CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, y los directorios de
plan/tarea del proyecto si el workflow los declara.

### 0.7 Detección de tooling opcional

- Un grafo de conocimiento del código o índice estructural (p. ej. un
  directorio `.codegraph/` o una herramienta de host equivalente) → habilita
  análisis de impacto en L0 y consultas estructurales en L6. Si está
  ausente, las fases recaen a inspección estática: anota el modo degradado
  en el informe.
- Tipos de subagente especializados / roles de revisor declarados por el
  proyecto.
- Un modo de simplicidad/tolerancia declarado (véase Integraciones).
- Un sistema de seguimiento de tareas o campañas que el host exponga.

### 0.8 Carga y merge de perfiles

- Carga siempre primero el baseline genérico.
- Si el llamante pasó un nombre de perfil, cárgalo y haz deep-merge encima.
- Si no, si existe un perfil para el proyecto autodetectado, cárgalo.
- Si no, quédate con el baseline.
- Semántica de merge: los escalares sobrescriben, los objetos hacen
  deep-merge, los arrays reemplazan: excepto `phases`, que se mergea por `id`.

### Contrato DetectionResult

Cada sub-revisión recibe esto en su prompt:

```json
{
  "profile": "default",
  "mode": "certify",
  "working_tree": {
    "dirty": true,
    "changed_files": ["src/routes.rs", "manifest.json"],
    "staged_files": [],
    "recent_commits": ["abc1234 feat: ..."]
  },
  "languages": ["rust", "typescript"],
  "bindings": {"python": "maturin", "wasm": "wasm-pack"},
  "web_framework": "next",
  "ci_system": "github-actions",
  "docs_system": "mdbook",
  "structural_index_available": false,
  "simplicity_mode": "standard",
  "scopegrain_available": true,
  "phases_to_run": ["L0","L1","L2","L3","L4","L5","L6"]
}
```

---

## Sistema de perfiles

Un perfil es un archivo declarativo (YAML o equivalente) que dice *cómo se
ejecuta cada fase* para un proyecto: comandos por lenguaje, tipo de
subagente, timeouts, condiciones de puerta de calidad, pesos de puntuación,
integraciones. El modo dice *qué fases se ejecutan*. Componen libremente.

### Esquema de perfil (validado al cargar)

```yaml
profile:
  name: string                    # must match filename
  description: string
  inherits: [string]              # optional base profile

project:
  type: string                    # library | service | monorepo | embedded
  languages: [string]
  bindings: [string]
  web_framework: string
  ci_system: string

phases:
  - id: string                    # L0..L11
    name: string
    description: string
    critical: bool                # abort pipeline on fail
    parallel: bool                # launch as independent sub-review
    subagent_type: string         # built-in generic | project-declared role
    detect: [string]              # all must match or phase is skipped
    commands:
      <language>: [string]
    skills_to_load: [string]      # skills loaded INSIDE the sub-review
    timeout_ms: int               # default 300000
    score_max: int                # default 10
    quality_gates: [string]

modes:
  quick:    [phase_id, ...]
  certify:  [phase_id, ...]
  review:   [phase_id, ...]
  full:     [phase_id, ...]

scoring:
  enabled: bool                   # default false
  weights: { <model>: int }       # declared models; must sum to 100
  thresholds:
    pass_score: int               # default 7
    rating_bands: { A: 9, B: 7, C: 5, D: 3, E: 0 }

orchestration:
  max_parallel: int               # default 4
  timeout_ms: int                 # default 300000
  abort_on_critical_fail: bool    # default true
  retry_mechanical: bool          # default true (one retry on L1 fail)
  keep_raw_logs: bool             # write per-phase logs under the review dir

report:
  format: markdown                # markdown | html | both
  output_dir: ".scopegrain/reviews"   # or the project's declared state path
  filename_pattern: "review-<mode>-<YYYYMMDD>-<HHMMSS>"

pre_push_hook:
  enabled: bool
  platform: string                # powershell | bash

integrations:
  simplicity_mode:
    respect_mode: bool
    skip_phases_in_tolerant: [phase_id]
    escalate_in_strict: [phase_id]
  scopegrain:
    enabled: string               # auto | always | never
  structural_index:
    use_if_available: bool
    phase: string                 # default L0
```

### Añadir un perfil de proyecto

1. Crea un archivo de perfil junto al baseline, heredándolo.
2. Sobrescribe solo lo que difiere: comandos, rutas, umbrales, tipos de
   subagente, puntuación.
3. Mantén las subcategorías de taxonomía específicas del proyecto en el
   perfil del proyecto, no en el baseline.

---

## Matriz de modos

| Modo | Fases | Puerta crítica | Revisión cognitiva | Puntuación | Duración típica |
|------|--------|---------------|------------------|---------|------------------|
| `quick` | L0 + L1 | L1 debe pasar | no | no | < 1 min |
| `certify` | L0 + L1–L6 | L1 debe pasar; L2–L5 deben pasar | L6 solo advierte | no | 5–15 min |
| `review` | L0 + L1 + L6 + L9 | L1 debe pasar | L9 puede vetar (registra objeción, continúa) | no | 5–10 min |
| `full` | L0–L9 | L1 debe pasar | L9 puede vetar | sí, si el proyecto declara un modelo de puntuación | 15–45 min |

---

## Catálogo de fases

L0, L10 y L11 siempre se ejecutan dentro del orquestador. L1–L9 son
candidatas a fan-out: cada una se ejecuta en su propio contexto nuevo cuando
`parallel: true`. Una fase cuyas condiciones `detect` no coinciden se
**omite silenciosamente**.

| ID | Nombre | Crítica | Paralela | Qué hace |
|----|------|----------|----------|--------------|
| L0 | Análisis de impacto del diff | no | no | Análisis de `git diff`; consulta el índice estructural por módulos afectados si está disponible. Aplica las reglas de escalado declaradas (p. ej. diff que toca manifiestos de CI ⇒ reforzar la fase de paridad CI). |
| L1 | Comprobación de lenguaje core | **yes** | yes | Compila, linta y unit-testea el/los lenguaje(s) principal(es). La única fase que aborta el pipeline sola. |
| L2 | Bindings / SDKs | no | yes | Build + test de bindings en lenguajes externos (maturin/PyO3, wasm-pack, SDKs independientes, JNI) cuando se detectan. |
| L3 | Frontend web | no | yes | Lint, typecheck, build de producción de la app web cuando se detecta. |
| L4 | CI/CD + dependencias | no | yes | Lint de YAML de workflows, paridad CI (toda nueva dependencia de manifiesto tiene un paso de instalación en CI), auditoría de dependencias. |
| L5 | Documentación | no | yes | Cobertura de docs en API pública, enlaces rotos, referencias obsoletas. |
| L6 | Revisión de arquitectura | no | yes | Dependencias circulares, violaciones de capas, módulos dios, fuga de features: vía el índice estructural o análisis estático de imports. Los deep-dives por módulo pueden delegarse a `review-deep`. |
| L7 | Auditoría de seguridad | no | yes (solo full) | Escáneres de vulnerabilidades de dependencias, escaneo de unsafe/eval/inyección en el diff, comprobaciones de validación de entrada, checklist de seguridad declarada. |
| L8 | Auditoría de rendimiento | no | yes (solo full) | Benchmarks vs línea base, regresión de tamaño de binario/bundle, revisión de asignaciones en rutas calientes. |
| L9 | Revisión de código (cognitiva) | no | yes (review/full) | Revisión multieje vía `code-review-and-quality` y skills compañeras declaradas. Puede vetar. |
| L10 | Consolidación de hallazgos | no | no | Agregar, deduplicar, detección transversal, puntuación, veredicto de puerta. |
| L11 | Informe final | no | no | Escribir + registrar el informe. |
| L11b | Sincronización registro/backlog | no | no | Registrar el informe en el índice del proyecto; derivar hallazgos medium+ al backlog declarado del proyecto, deduplicados. |

### Comandos de referencia por lenguaje (baseline)

Adapta a las puertas propias del proyecto: usa wrappers versionados
(`./gradlew`, `make`, scripts del repo) sobre herramientas globales, y los
comandos que el CI del proyecto realmente aplica.

- **Rust:** `cargo fmt --all -- --check` · `cargo check --workspace
  --all-targets` · `cargo clippy --workspace --all-targets --
  -D warnings` · `cargo test --workspace`
- **Python:** `python -m pytest -x --tb=short` · `python -m mypy src/` (si
  está configurado)
- **TypeScript:** `npx tsc --noEmit` · `npx vitest run` (o `test` del repo)
- **JavaScript:** script `test` del repo
- **Go:** `go vet ./...` · `go test ./...`
- **Java/Kotlin:** `./mvnw verify` o `./gradlew build`
- **C/C++:** `cmake --build build && ctest --test-dir build`
- **Elixir:** `mix test` · **Ruby:** `bundle exec rake test`

Bindings (L2): `maturin develop && python -m pytest tests/` ·
`wasm-pack build --release` · `npm ci --ignore-scripts && npx tsc
--noEmit && npm test`. Web (L3): `npm ci --ignore-scripts` → `lint` del
repo → `tsc --noEmit` → `build`. CI (L4): linter de workflows si está
instalado + auditoría de dependencias (`cargo deny check`,
`npm audit --audit-level=moderate`, `pip-audit`). Docs (L5): warnings de
doc-build + doc tests + comprobación de enlaces. Seguridad (L7):
`cargo audit`, `pip-audit`, `npm audit --audit-level=high`, más un escaneo
del diff por nuevo `unsafe`/`eval`/`innerHTML`/concatenación SQL.
Rendimiento (L8): benchmarks, comparación de tamaño vs la rama baseline,
revisión de asignaciones en rutas calientes.

### Puertas de calidad baseline por fase

- **L1:** todos los comandos compile/lint salen 0; todos los tests
  unitarios pasan; sin warnings nuevos vs la rama baseline.
- **L2:** todos los bindings detectados compilan y pasan sus tests.
- **L3:** lint 0 errores; typecheck pasa; build de producción tiene éxito.
- **L4:** el YAML de workflows parsea y linta; ninguna dependencia nueva
  sin paso de instalación en CI; ninguna dependencia vulnerable o sin
  mantenimiento introducida.
- **L5:** sin warnings de doc-build; sin enlaces rotos; las referencias del
  README coinciden con la API actual.
- **L6:** sin dependencias circulares nuevas; sin violaciones de capas
  nuevas; sin módulos dios nuevos (p. ej. >1000 líneas o >30 exports
  públicos: ajustable por proyecto).
- **L7:** sin vulnerabilidades nuevas; sin código unsafe nuevo sin
  justificación de seguridad; sin nuevas brechas de validación de entrada.
- **L8:** sin regresión de benchmark >10%; sin regresión de tamaño >5%; sin
  nuevas asignaciones en rutas calientes declaradas.
- **L9:** ningún hallazgo crítico sin atender; conteo de vetos bajo el
  umbral de escalado declarado (default 3).

---

## Orquestación de fan-out

```
ORCHESTRATOR (Phase 0 + L10 + L11 — context budget < 10%)
│
│  Phase 0: detect (sync, fast)
│
│  Launch L1 ALONE (critical — must pass before fan-out)
│    └── subagent("L1-core-language", prompt) → { phase, status, score, findings }
│
│  if L1 failed AND abort_on_critical_fail → write failure report, exit
│
│  Launch L2..L6 in PARALLEL (cap = orchestration.max_parallel, default 4)
│  (only phases whose detect matched)
│  Await all (per-phase timeout)
│
│  if mode == "full": launch L7, L8, L9 in PARALLEL (second wave)
│
│  L10 consolidate (sync) → L11 report (sync)
```

### Contrato de invocación de sub-revisión

Lanza cada fase como una sub-revisión independiente con contexto nuevo
mediante el mecanismo que el host provea (herramienta de subagente, sesión
delegada, invocación de revisor separada). El contexto nuevo es el punto:
una autocomprobación en el mismo contexto no satisface el requisito de
independencia para riesgos nombrados.

Cada prompt de sub-revisión contiene:

1. El id/nombre de la fase y el JSON `DetectionResult` (para que nunca
   re-detecte).
2. La configuración de la fase del perfil (comandos, puertas, skills).
3. La lista de archivos cambiados / contexto del diff.
4. Instrucciones: ejecutar los comandos en orden; para cada uno registrar
   `command, exit_code, duration, summary (≤200 chars)`; evaluar cada
   puerta de calidad; escanear el diff por hallazgos; cargar cada skill
   declarada **dentro del contexto de sub-revisión** (nunca en el
   orquestador); calcular la puntuación de la fase.
5. Contrato de retorno: **solo un único objeto JSON: sin prosa, sin fences.**

```json
{
  "phase": "L1",
  "phase_name": "Core Language Check",
  "status": "pass|fail|warn|skip|timeout|error",
  "score": 8, "score_max": 10,
  "duration_ms": 23456,
  "subagent_type_used": "generic",
  "commands_run": [
    {"cmd": "...", "exit": 0, "duration_ms": 1234, "summary": "≤200 chars"}
  ],
  "quality_gates": [
    {"condition": "All compile/lint commands exit 0", "passed": false}
  ],
  "findings": [
    {
      "id": "H01-CODE-001",
      "severity": "critical|high|medium|low|info",
      "category": "CODE",
      "subcategory": "Panic in library code",
      "file": "src/engine.rs", "line": 142,
      "description": "unwrap() on user-provided index",
      "recommendation": "Return a typed error instead",
      "skills_loaded": ["code-review-and-quality"],
      "cross_cutting": false
    }
  ],
  "vetoes": [
    {"skill": "doubt-driven-development", "reason": "...", "severity": "high"}
  ],
  "scoring_breakdown": { "<declared model>": { } },
  "raw_log_path": "…/logs/L1-<ts>.log"
}
```

Ante cualquier fallo al producir JSON, la sub-revisión devuelve
`{"phase": "<id>", "status": "error", "error": "<one-line reason>"}`.

**Fórmula de puntuación de fase sugerida:** parte de `score_max`; −2 por
puerta de calidad fallida; −1 por hallazgo crítico, −0.5 por high, −0.2 por
medium; piso en 0.

### Resolución de tipo de subagente

El perfil nombra un tipo por fase. Verifica que el tipo existe (built-in o
declarado por el proyecto) antes de lanzar; si falta, recae al tipo de
revisor genérico y emite un warning en el informe, registrando
`subagent_type_used` honestamente. Mapeo típico: trabajador genérico para
fases mecánicas (L1–L5), explorador de solo lectura para L6, revisor con
capacidad de investigación para el trabajo de cadena de suministro de L4,
revisor de seguridad declarado para L7/L9, revisor de rendimiento declarado
para L8: cuando el proyecto los define.

### Control de concurrencia

- `max_parallel` (default 4) limita las sub-revisiones simultáneas.
- L1 siempre se ejecuta sola primero.
- L7–L9 se lanzan como segunda ola tras completar L1–L6 (solo modo `full`).
- El orquestador **nunca** vuelca logs de sub-revisión a su propio contexto:
  lee solo el JSON final. La salida cruda va al directorio `logs/` de la
  revisión cuando `keep_raw_logs` está habilitado, y se enlaza, nunca se
  incrusta.

### Matriz de manejo de fallos

| Fase | Tipo de fallo | Acción |
|-------|-------------|--------|
| L1 (crítica) | cualquiera | Abortar. Escribir informe de fallo listando las fases restantes `skipped`. Puerta FAIL. Salir. |
| L2–L5 | fallo de comando | Marcar `fail`, continuar otras fases. Un reintento automático si `retry_mechanical`. |
| L6, L9 | veto de skill | Marcar `warn`, registrar objeción, continuar. Si una sola fase alcanza el umbral de veto declarado (default 3), la puerta global es FAIL. |
| L7, L8 | fallo | Marcar `warn`, continuar. |
| cualquiera | timeout de sub-revisión | Marcar `timeout`, continuar, advertir en el informe. |
| cualquiera | crash / no-JSON | Marcar `error`, continuar; almacenar salida cruda truncada a 500 caracteres. |
| cualquiera | tipo de subagente ausente | Recaer a genérico; registrar el tipo real; advertir. |

Las fases mecánicas tienen un reintento; las cognitivas y opcionales nunca
reintentan (salida subjetiva: reintentar desperdicia contexto).

### Cuando el host no puede hacer fan-out

Si el host no provee mecanismo de subagentes, ejecuta las fases
**secuencialmente en la sesión**, mantén el mismo orden de fases, disciplina
JSON y puertas, y registra `orchestration_degraded: "sequential"` en el
informe. El procedimiento sobrevive; la garantía de presupuesto de contexto
no. Para unidades con riesgo nombrado, la fase REVIEW sigue requiriendo un
contexto separado: esa parte no es opcional y no puede degradarse por
conveniencia; consíguelo o solicita una exención explícita del dueño
(owner, reference, reason).

---

## Consolidación fan-in (L10)

Síncrona en el orquestador. Sin subagente.

1. **Agregar** todos los hallazgos en una lista, etiquetados con la fase de
   origen.
2. **Deduplicar** hallazgos que comparten `file:line` + `category`: conserva
   la severidad más alta, mergea recomendaciones.
3. **Detección transversal**: el mismo hallazgo apareciendo en 2+ fases
   recibe `cross_cutting: true` y escala un nivel de severidad.
4. **Puntuación**: por fase y global: ponderada por el modelo de puntuación
   declarado si está habilitado, si no la media sin ponderar de las
   puntuaciones de fase.
5. **Puerta de calidad**: pasa si y solo si toda fase crítica pasó y ningún
   hallazgo tiene severidad `critical`.
6. **Aplicar el modo de simplicidad/tolerancia declarado** (abajo).
7. **Sincronizar Scopegrain** si el proyecto lo declara y está disponible
   (registrar hallazgos, actualizar estado según el contrato de workflow).

---

## Taxonomía de hallazgos (12 categorías)

Cada hallazgo se clasifica en exactamente **una categoría primaria** y puede
llevar categorías secundarias. Las subcategorías baseline viven en el
perfil; los proyectos las extienden en su propio perfil.

| # | ID | Cubre |
|---|----|--------|
| 1 | `LOGIC` | Off-by-one, condiciones de carrera, ramificación incorrecta, gestión de estado, casos límite, validación de entrada, manejo de errores, confusión de tipos, serialización, desajuste async/sync |
| 2 | `PATTERN` | Violaciones de patrones de diseño, antipatrones de lenguaje/framework, diseño de API, antipatrones de base de datos |
| 3 | `ARCH` | Dependencias circulares, violaciones de capas, objetos dios, fuga de features, acoplamiento fuerte, abstracciones faltantes/filtradas/prematuras, límites de módulo incorrectos |
| 4 | `DIRECTION` | Scope creep, esfuerzo abandonado, deuda técnica sin priorizar, desalineamiento estratégico, sobre/infra-ingeniería, roadmap ausente |
| 5 | `CLARITY` | Nomenclatura confusa, números mágicos, anidamiento profundo, comentarios ausentes, código muerto, tests incomprensibles, docs obsoletas, errores confusos, config oculta |
| 6 | `CODE` | Warnings de compilador, lints sin arreglar, supresiones injustificadas, unsafe sin justificación, clones/allocs innecesarios, casts malos, TOCTOU, tragado de errores, panics en código de biblioteca |
| 7 | `DESIGN` | Inconsistencia visual, accesibilidad, responsive roto, movimiento excesivo, touch targets, estados de carga/vacío/error |
| 8 | `ERROR` | Errores de compilación, fallos de tests, tests flaky, panics de runtime, deadlocks, fugas de memoria, fallos de CI, vulnerabilidades, conflictos de dependencias |
| 9 | `MISSING` | Tests, validación, manejo de errores, docs, puertas de CI, monitoreo, recuperación, migraciones, config de entorno ausentes |
| 10 | `FEATURE` | Brechas de funcionalidad vs alternativas, integraciones ausentes, soporte de plataforma ausente, observabilidad ausente |
| 11 | `ALGO` | Complejidad errónea, estructura de datos errónea, inestabilidad numérica, off-by-one algorítmico |
| 12 | `ANY` | Comodín: siempre revisado manualmente antes de publicar el informe |

### Formato de ID de hallazgo

`H<phase-number><CATEGORY>-<NNN>`: p. ej. `H01-CODE-001` (L1, CODE, #1),
`H09-ARCH-002` (L9, ARCH, #2).

### Niveles de severidad

| Severidad | Significado | Manejo |
|----------|---------|----------|
| `critical` | Bloquea el release / pérdida de datos / agujero de seguridad | Arreglar antes de la entrega |
| `high` | Se romperá en producción pronto | Arreglar esta iteración |
| `medium` | Problema real, manejable | Backlog |
| `low` | Menor, pulido | Cuando convenga |
| `info` | Observación, sin acción requerida | Ninguna |

---

## Puntuación

**Baseline:** cada fase devuelve 0–10; global = media sin ponderar de las
fases que se ejecutaron. La puerta pasa si y solo si toda fase crítica pasó
y global ≥ `pass_score` (default 7). No fabriques puntuaciones ni
conformidad: reporta lo que se midió, y nombra lo que no se ejercitó.

**Extendida (solo cuando el proyecto declara un modelo):** un modelo de
puntuación declarado como ISO/IEC 25010, una puerta de calidad estilo
SonarQube, buenas prácticas OpenSSF CII, OWASP ASVS, o una calificación de
mantenibilidad: configurado por perfil con pesos que suman 100. Puntuación
final = Σ(sistema × peso). Cada fase contribuye un `scoring_breakdown`
clavado por los modelos declarados. Bandas de calificación: A ≥9, B ≥7,
C ≥5, D ≥3, E <3.

| Sistema declarado | Peso de ejemplo | Qué mide |
|-----------------|----------------|------------------|
| ISO/IEC 25010 | 20% | 9 características de producto puntuadas 0–10 (edición 2023; el modelo 2011 retirado tenía 8: un perfil debe declarar qué edición mide) |
| Puerta estilo SonarQube | 25% | condiciones pass/fail sobre código nuevo |
| Buenas prácticas CII | 20% | None / Passing / Silver / Gold |
| OWASP ASVS | 15% | L1 / L2 / L3 |
| Calificación de mantenibilidad | 20% | A–E |

Un sistema se reporta solo si fue realmente evaluado: un peso sin evidencia
se elimina del informe, no se adivina.

---

## Formato de informe (L11)

Se escribe en el directorio de revisiones del proyecto
(`<output_dir>/review-<mode>-<YYYYMMDD>-<HHMMSS>.md`; timestamp local con
ceros: ordenable cronológicamente). Formato `markdown` por defecto; `html` o
`both` solo cuando el proyecto declara e incluye una plantilla.

```markdown
# Unified Review — <mode> — <YYYY-MM-DD>

**Profile:** <name>   **Mode:** <mode>   **Duration:** <N> min
**Quality Gate:** ✅ PASS / ❌ FAIL    **Overall score:** <N>/10 (rating A–E)
**Context:** orchestrator ≈ <n>% | sub-reviews: <n> | degraded: <none/sequential/…>

## Executive Summary
<2–3 paragraphs: what was checked, passed, failed, what next. Plain language.>

## Scoreboard
| Phase | Status | Score | Findings (C/H/M/L/I) | Duration |
| L0 … | ✅/⚠️/❌/⏭️/⏱️ | n/10 | … | … |

## Findings by Category
| Category | Critical | High | Medium | Low | Info | Total |

## Top Critical Findings
1. **[H05-MISSING-001]** `file:line` — description → recommendation (severity)

## Cross-Cutting Patterns
- <pattern> appears in phases <list> — recommend <systemic fix>

## Per-Phase Detail
### L1 — <name> (<score>, <status>)
**Commands:** `cmd` ✅/❌ summary
**Quality gates:** [x]/[ ] per condition
**Findings:** [id] (severity) `file:line` — description

## Recommendations (prioritized)
1. (critical, before push) …  2. (high, this iteration) …

## Declared scoring sections (only if scoring.enabled and evaluated)
<ISO 25010 heatmap | Sonar-style gate | CII level | OWASP level | rating>

_Generated by unified-review. Profile: <name>. Mode: <mode>._
```

### Informe HTML (opcional)

Solo cuando el perfil establece `report.format: html|both` y el proyecto
provee una plantilla: autocontenido (CSS inline, sin CDN, apto para
impresión, consciente del modo oscuro). Contrato de sustitución: escalares
`{{NAME}}`; bloques condicionales `{{#NAME}}…{{/NAME}}` renderizados cuando
son truthy; todo valor derivado de hallazgos se escapa en HTML antes de la
sustitución; las secciones de lista son ítems renderizados concatenados; la
salida sigue siendo legible para humanos para diffing.

---

## Sincronización de registro y backlog (L11b)

Se ejecuta tras L11. Los informes nunca deben ser artefactos huérfanos.

1. **Registrar** una fila en el índice de informes del proyecto
   (`.scopegrain/reports/INDEX.md` o el equivalente declarado):
   `timestamp | mode | file | gate | C/H/M/L/I | status | one-liner`.
   Cambia un informe del mismo modo superado a `superseded` en la misma edición.
2. **Derivar** cada hallazgo abierto ≥ medium al backlog declarado del
   proyecto: una fila por hallazgo usando el esquema canónico de IDs de
   hallazgo y formato de fila del proyecto; `Origin: <report file>`
   registrado en el campo de relaciones de la fila. Omite ítems ya
   rastreados (mismo `file:line` + descripción) y anota `already tracked as
   <ID>` en el informe.
3. **Puerta perezosa:** el modo `quick` o cero hallazgos ≥ medium omite la
   derivación; el registro en el índice siempre se ejecuta.
4. Cierra el informe con `Backlog sync: created <IDs>` o `skipped
   (<reason>)`.

---

## Integraciones de modo declarado

Son integraciones opt-in del perfil, aplicadas solo cuando el proyecto las
declara: la skill detecta y adapta; nunca las asume.

| Integración | Efecto |
|-------------|--------|
| **Modo simplicidad/tolerancia** (`off`, `tolerant`, `standard`, `strict`) | `tolerant`: elimina hallazgos `DIRECTION/Over-engineering`, omite las fases opinadas declaradas (default L6). `strict`: escala esos hallazgos una severidad (nunca más allá de critical) y añade la skill de auditoría declarada a L6/L9. Lee el modo del llamante, la config del host, o default `standard`. |
| **Scopegrain** | `auto` (default): usa las herramientas de tarea declaradas si están presentes, omite en silencio si no. `always`: usa o advierte. `never`: omite. Registra hallazgos/estado según el contrato de workflow. |
| **Índice estructural** | Si existe un grafo de conocimiento del código, L0 lo consulta por módulos afectados y L6 lo usa para análisis de dependencias/ciclos. Ausente ⇒ análisis estático; anota la degradación. |
| **Herramientas de investigación web** | L4/L7 pueden usar las herramientas de búsqueda/fetch que el host provea para avisos; ausentes ⇒ solo comprobaciones locales, anotado. |

---

## Presupuesto de contexto

El punto del fan-out es mantener el orquestador liviano:

| Componente | Objetivo |
|-----------|--------|
| Orquestador (P0 + L10 + L11) | < 10%: solo coordinación, nunca vuelca logs de sub-revisión |
| Cada sub-revisión | 15–20%: una fase, JSON de salida, contexto liberado al volver |
| Consolidación L10 | < 5%: solo agregación de JSON, sin releer fuentes |
| Informe L11 | < 5%: salida estructurada, sin logs crudos inline |

Huella aproximada del orquestador: `quick` ~8 KB · `certify` ~28 KB ·
`review` ~20 KB · `full` ~50 KB de informes + sobrecarga.

**Qué rompe el presupuesto:** volcar logs de sub-revisión (≈30 KB cada uno)
al orquestador; cargar skills de revisión en el orquestador en lugar de
dentro de la sub-revisión; releer fuentes grandes durante L10; incrustar
salida cruda de comandos en el informe. Si el orquestador supera ~50% de
contexto tras L10, advierte en el informe y recomienda un modo menor.

---

## Autovalidación al cargar

Rechaza ejecutar con un error claro si:

1. El perfil baseline falta o no se puede parsear; un `--profile` nombrado
   no existe.
2. Una entrada `modes.*` referencia un ID de fase ausente de `phases`.
3. `scoring.enabled` con pesos que no suman 100.
4. Un `subagent_type` referenciado no es ni built-in ni declarado: advierte
   y recae a genérico en lugar de bloquear.
5. `report.format` pide `html`/`both` sin una plantilla disponible.

---

## Racionalizaciones comunes

|| Racionalización | Realidad |
|||---|---|
|| "El orquestador puede revisar el diff él mismo" | La revisión por el orquestador destruye el presupuesto de contexto y, para unidades con riesgo nombrado, la garantía de independencia. Haz fan-out o ejecuta secuencialmente, pero conserva las fases. |
|| "Una fase en el mismo contexto cuenta como independiente" | Una nueva etiqueta de rol en el mismo contexto es un cambio de etiqueta, no independencia. Las unidades con riesgo nombrado necesitan un contexto genuinamente distinto o una exención explícita del dueño. |
|| "La puerta pasó, así que la entrega está aprobada" | Una puerta superada atestigua que se vio evidencia. No autoriza nada: merge, publicación y release siguen siendo decisiones del dueño. |
|| "Más modos significan más garantía" | Reejecutar `full` sobre un diff sin cambios añade costo, no evidencia. La profundidad sigue al riesgo evidenciado, no a la ansiedad. |
|| "Las puntuaciones son el punto" | Las puntuaciones resumen fases medidas. Una superficie no medida reportada como puntuación alta es fabricación: nombra lo que no se ejercitó. |

## Señales de alerta

- Una ejecución `quick`/`certify` sobre un árbol sucio que devuelve "todo
  pasa" sin un solo comando ejecutado: la puerta es teatro; reporta
  comandos, no confianza.
- Salida de sub-revisión en prosa en lugar del contrato JSON, o un
  `status: "pass"` con `commands_run` vacío.
- Hallazgos sin `file`/`line`, sin severidad, o con severidades infladas
  para justificar la existencia de la revisión.
- Un modelo de puntuación declarado reportado como evaluado cuando solo se
  midieron algunas de sus características: reporta el subconjunto medido y
  nombra el resto no ejercitado.
- Volcar logs crudos de sub-revisión al orquestador, o cargar skills de
  revisión en el orquestador en lugar de dentro de la sub-revisión.
- Una unidad con riesgo nombrado "revisada independientemente" por el
  contexto que la escribió, sin exención registrada.
- Informes escritos pero nunca registrados: artefactos huérfanos que las
  auditorías posteriores no pueden encontrar.
- Una ejecución `certify`/`full` usada para saltarse `review-feedback`
  sobre hallazgos que la misma ejecución produjo: las puertas detectan; el
  feedback resuelve.

---

## Límites

- Una puerta superada es una **atestación de evidencia**, no una
  autorización de merge/publicación/release. Los hallazgos, puntuaciones y
  niveles describen lo que se observó: nunca lo que está permitido.
- Usa los comandos y puertas declarados del proyecto; nunca un stack
  hardcodeado.
- Las comprobaciones mecánicas se ejecutan solo bajo el modelo de permisos
  del host: propón comandos exactos y espera cuando la ejecución esté
  reservada al dueño; nunca declares comprobaciones no ejecutadas.
- Las unidades con riesgo nombrado requieren un contexto de revisión
  genuinamente distinto o una exención explícita y acotada del dueño; los
  identificadores de revisor son atestaciones, no identidad autenticada.
- Escribe dentro del workspace del harness (`.scopegrain/` por defecto);
  nunca disperses informes en la documentación del producto.
