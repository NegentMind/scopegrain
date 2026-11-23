# Disciplina de catálogo

Un solo manifest indexa los recursos canónicos activos. Los cuerpos se
cargan solo para la tarea seleccionada y las referencias requeridas. Una
fuente legacy indexada no es una skill aprobada. La procedencia, las
dependencias y el estado de activación importan. No fusiones procedimientos
con nombres similares sin comparar su comportamiento. No afirmes que el
registro por sí solo verifica la efectividad de un procedimiento.

## Protocolo de descubrimiento de skills (dinámico)

> **Obligatorio en cada tarea** (agente principal y sub-agentes), ejecutado
> en cada fase: PLAN, TASK, RUN, VERIFY, REVIEW, SHIP. Si el runtime ofrece
> una herramienta de descubrimiento, úsala; si no, ejecuta el algoritmo
> manualmente contra el catálogo.

### Algoritmo de descubrimiento (corre automáticamente en cada fase)

```
INPUT:  current_phase, task_id, key_files, contract_keywords, task_type
OUTPUT: ordered skill list to load (bounded, justified)

1. BASE      = base skills for task_type (canonical per-type table)
2. KEYWORDS  = extract(key_files, task_id, contract) — normalize aliases
               and plurals (e.g. "tests"→"test", "seguridad"→"security")
3. CANDIDATES= search catalog(KEYWORDS, phase) scored by relevance
4. FILTERED  = deduplicate(BASE + CANDIDATES)
               priority: phase match > type match > rating
5. SELECTED  = top_n(FILTERED, max_skills) — pins/base may exceed the cap
6. JUSTIFY   = per skill: "phase=X, keyword=Y, score=Z" — logged in the
               task record and result block
7. LOAD      = each selected skill in order
```

### Parámetros de configuración

```yaml
sdp_config:
  max_skills_per_phase: 5        # cap on score-selected fills (pins+base exempt)
  min_relevance_score: 0.6       # threshold 0–1
  boost_phase_match: 0.3         # skill in the phase's lifecycle mapping
  boost_type_match: 0.2          # skill matches task_type
  boost_rating: 0.1              # catalog rating bonus (1–10)
  exclude_deprecated: true       # never load DEPRECATED skills
  prefer_local: true             # project skills > global
  exclude_families_unless_exact: # heavy families only on exact keyword
    - "<family-a>"               #   (no fuzzy scoring into ~100 micro-skills)
    - "<family-b>"
```

### Flujo por fase

| Fase | Disparador | Busca | Base (siempre) | Ejemplos dinámicos |
|---|---|---|---|---|
| PLAN | comando plan | Ítems de backlog, specs, arquitectura | `planning-and-task-breakdown`, `spec-driven-development` | `idea-refine`, `constraint-driven-development`, `architecture-decision-record` |
| TASK | comando task | Archivo de tarea, archivos clave, tipo de tarea | base de campaña/ejecutor + por tipo | `systematic-debugging`, `test-driven-development`, skills de dominio |
| RUN | comando run | Archivo de plan, dependencias, oleadas | ejecutor + skill de progreso | Conjunto dinámico por tarea de la oleada |
| BUILD | Implementación | Archivos tocados, lenguaje, dominio | `incremental-implementation`, `test-driven-development` | `source-driven-development`, `security-and-hardening`, `api-and-interface-design`, `frontend-ui-engineering` |
| VERIFY | Post-implementación | Resultados de pruebas, builds, errores | `systematic-debugging` | `browser-testing-with-devtools`, `code-review-and-quality`, `performance-optimization` |
| REVIEW | Pre-merge | Diff, blast radius, seguridad | `code-review-and-quality` | `code-simplification`, `security-and-hardening`, `deprecation-and-migration`, `observability-and-instrumentation` |
| SHIP | comando ship | Preparación para release, changelog | `git-workflow-and-versioning`, `shipping-and-launch` | `ci-cd-and-automation`, `documentation-and-adrs`, `deprecation-and-migration` |

### Pines de política (guardarraíles — no negociables)

Las señales de ruta/contrato añaden skills obligatorias con score 1.0,
`pinned: true`:

```
.harness/|config|policy → doubt-driven-development
.github/|release|semver|workflow → ci-cd-and-automation + git-workflow-and-versioning
unsafe|ffi|wasm|auth|secret → security-and-hardening
docs/api → documentation-and-adrs + api-and-interface-design
tests/|fix|bug → test-driven-development + systematic-debugging
storage|wal|schema|migration → deprecation-and-migration
performance|bench|hot path → performance-optimization
```

Guardarraíles adicionales:

- **Cuota de diversidad**: cuando aparecen señales de riesgo (seguridad,
  breaking, release, migración, deuda), debe seleccionarse ≥1 skill de
  calidad (`code-review-and-quality` / `doubt-driven-development` /
  `security-and-hardening` / `test-driven-development`).
- **Bucle de feedback**: registra resultados de tarea por skill
  (`<taskId> ok|fail <skills>`); las skills con éxito ≥0.7 en ≥3 usos
  reciben +0.1; 0.4–0.7 → +0.05; <0.4 → −0.1.
- **Pines manuales**: el archivo de tarea ("tools needed") puede fijar
  skills extra — estándar para tareas críticas.
- **Regla de exceso**: `max_skills` limita el relleno por score; pines+base
  son obligatorios y pueden excederlo (exceso típico ≤2–3).
- **Re-rank por descripción**: tras el scoring, potencia candidatos cuyos
  tokens de descripción se solapen con tokens del contrato/tarea (+0.05 por
  token solapado, tope +0.15) — captura skills cuyas keywords no coinciden
  literalmente pero cuyo propósito declarado sí.
- **Frescura del índice**: el pool de candidatos puntuados debería venir de
  un índice de skills generado (descripción + tokens + rating + flag de
  deprecated por entrada); regenéralo siempre que una skill se añada,
  renombre o quede deprecated — un índice obsoleto degrada silenciosamente
  cada fase.

### Mapeo keyword → skill (forma de la tabla de scoring)

```yaml
keyword_to_skills:
  # Core / engine
  "rust":       ["source-driven-development", "test-driven-development", "systematic-debugging"]
  "engine":     ["api-and-interface-design", "performance-optimization"]
  "storage":    ["deprecation-and-migration", "observability-and-instrumentation"]
  "wal":        ["security-and-hardening", "deprecation-and-migration"]
  "index":      ["performance-optimization", "systematic-debugging"]
  "concurrency":["security-and-hardening", "doubt-driven-development"]
  "ffi":        ["security-and-hardening", "systematic-debugging"]
  # Bindings / SDK
  "python":     ["source-driven-development", "api-and-interface-design"]
  "sdk":        ["api-and-interface-design", "documentation-and-adrs"]
  "bindings":   ["security-and-hardening", "test-driven-development"]
  # Web / frontend
  "web":        ["frontend-ui-engineering", "browser-testing-with-devtools"]
  "ui":         ["frontend-ui-engineering", "design-taste-frontend"]
  "accessibility": ["<project a11y audit skill>"]
  # Testing / quality
  "test":       ["test-driven-development", "systematic-debugging"]
  "debug":      ["systematic-debugging", "browser-testing-with-devtools"]
  "flaky":      ["systematic-debugging", "code-review-and-quality"]
  "coverage":   ["test-driven-development", "constraint-driven-development"]
  "benchmark":  ["performance-optimization", "observability-and-instrumentation"]
  # Security
  "security":   ["security-and-hardening", "doubt-driven-development"]
  "unsafe":     ["security-and-hardening", "systematic-debugging"]
  "supply-chain":["security-and-hardening", "deprecation-and-migration"]
  # CI/CD / release
  "ci":         ["ci-cd-and-automation", "shipping-and-launch"]
  "release":    ["shipping-and-launch", "git-workflow-and-versioning"]
  "version":    ["git-workflow-and-versioning", "release-notes-one-pager"]
  "changelog":  ["documentation-and-adrs", "release-notes-one-pager"]
  "deploy":     ["shipping-and-launch", "observability-and-instrumentation"]
  # Architecture
  "architecture": ["api-and-interface-design", "deprecation-and-migration"]
  "api":        ["api-and-interface-design", "spec-driven-development"]
  "interface":  ["api-and-interface-design", "frontend-ui-engineering"]
  "refactor":   ["code-simplification", "incremental-implementation"]
  "simplify":   ["code-simplification", "incremental-implementation"]
  # Workflow
  "pipeline":   ["<executor skill>", "<progress skill>"]
  "task":       ["<executor skill>", "planning-and-task-breakdown"]
  "plan":       ["planning-and-task-breakdown", "spec-driven-development"]
  "backlog":    ["<progress skill>", "<executor skill>"]
  # Docs
  "docs":       ["documentation-and-adrs", "writing-guidelines"]
  "adr":        ["documentation-and-adrs", "deprecation-and-migration"]
  "spec":       ["spec-driven-development", "interview-me"]
```

### Skills base por tipo de tarea

| Tipo de tarea | Skills base (siempre) |
|---|---|
| `feature-add` | `incremental-implementation`, `test-driven-development`, `spec-driven-development`, `planning-and-task-breakdown` |
| `bug-fix` | `systematic-debugging`, `test-driven-development`, `incremental-implementation` |
| `refactor` | `code-simplification`, `incremental-implementation`, `test-driven-development` |
| `security` | `security-and-hardening`, `doubt-driven-development`, `systematic-debugging` |
| `performance` | `performance-optimization`, `observability-and-instrumentation`, `source-driven-development` |
| `release` | `shipping-and-launch`, `git-workflow-and-versioning`, `ci-cd-and-automation` |
| `docs` | `documentation-and-adrs`, `writing-guidelines`, `spec-driven-development` |
| `research` | `web-research`, `coordinated-web-search`, `spec-driven-development` |

### Mapeo de ciclo de vida (objetivos del phase boost)

```
DEFINE   → spec-driven-development, interview-me, idea-refine, constraint-driven-development
PLAN     → planning-and-task-breakdown, spec-driven-development
BUILD    → incremental-implementation, test-driven-development, context-engineering,
           source-driven-development, doubt-driven-development, frontend-ui-engineering,
           api-and-interface-design
VERIFY   → systematic-debugging, browser-testing-with-devtools
REVIEW   → code-review-and-quality, code-simplification, security-and-hardening,
           performance-optimization, deprecation-and-migration,
           observability-and-instrumentation
SHIP     → git-workflow-and-versioning, ci-cd-and-automation, shipping-and-launch,
           documentation-and-adrs, deprecation-and-migration,
           observability-and-instrumentation
```

### Guía de carga rápida por categoría

- **Diseño UI/frontend**: design-orchestrator → skill de taste → dinámico: responsive, wireframing, UX-flow
- **Animación**: motion core → dinámico: variantes scroll/timeline
- **Corrección de bugs**: `systematic-debugging` → `writing-plans` → dinámico: browser-devtools, review
- **Features multi-paso**: `brainstorming` → `writing-plans` → dinámico: spec-driven, task-breakdown, incremental
- **SEO**: skills de auditoría → dinámico: programmatic-seo, schema-markup
- **Branding/arte**: brandkit, canvas, theme, color, platform-design

## Registro de skills cargadas (obligatorio)

En cada archivo de tarea y bloque de resultado:

```markdown
## Required tools → Skills

| Skill | Phase | Justification | Score |
|---|---|---|---|
| <executor> | TASK | base type=feature-add | 1.0 |
| spec-driven-development | PLAN | keyword=spec, phase boost | 0.9 |
| systematic-debugging | VERIFY | keyword=debug, phase boost | 0.9 |
| security-and-hardening | BUILD | keyword=ffi, type=security | 0.8 |

SKILLS_LOADED: <executor>, spec-driven-development, systematic-debugging, security-and-hardening
```

## Checklist de verificación

El protocolo de descubrimiento se aplicó correctamente cuando:

- [ ] Corrió en **cada fase** (PLAN, TASK, BUILD, VERIFY, REVIEW, SHIP)
- [ ] `max_skills_per_phase` no excedido (excepto exceso de pines+base)
- [ ] Cada skill cargada tiene una justificación en el archivo de tarea
- [ ] Bloque `SKILLS_LOADED:` presente en el resultado
- [ ] Ninguna skill DEPRECATED cargada
- [ ] Skills locales del proyecto priorizadas sobre las globales
- [ ] ≥1 skill dinámica (no base) cargada por fase

<!-- Cross-references: → see orchestration-patterns.md, task-domain.md, definition-of-done.md, reference-maintenance.md -->
