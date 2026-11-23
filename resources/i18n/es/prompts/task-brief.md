---
name: task-brief
description: Estructurar un brief de implementación acotado desde entradas zanjadas y la ruta de metodología seleccionada.
---
# Task Brief

Usar esto para definir o despachar UNA tarea a profundidad completa:
investigar, clasificar, escribir el registro de tarea completo, luego
implementar o hacer handoff. Cargado cuando un host define un registro de
tarea (`plan-work`, `implement-task`) o briefea a un delegado worker
(`coordinate-plan`, `audit-harness`). Mantener la solicitud original, el
alcance y las exclusiones intactos. Ejecutar las fases secuencialmente; no
saltarse puertas. Un brief no puede expandir el alcance autorizado del
propietario. La salida es el registro de tarea persistido — más, al
despachar, un delegado vinculado al contrato de retorno siguiente.

## Slots requeridos

Slots requeridos comunes: identidad y revisión reales de la tarea;
solicitud original; alcance y exclusiones; ruta seleccionada y autoridad
registrada; hallazgos zanjados; interfaces exactas y casos de aceptación;
comprobaciones autorizadas disponibles; artefactos requeridos; límites de
permiso/presupuesto; dependencias y estado actual del runtime.

Para SDD incluir referencias vigentes de especificación/diseño/plan, digests
revisados, aprobaciones y scenarioRefs asignados. Para trabajo ligero
incluir hechos de clasificación y autorización acotada registrada, no
aprobaciones formales ficticias.

Incluir procesos vivos y si reutilizarlos o dejarlos corriendo. Pasar
entradas derivadas congeladas en lugar de pedir a un worker que recomput
resultados conocidos. Las decisiones de producto o permiso sin resolver
bloquean el despacho. No ofrecer interfaces alternativas y pedir al
implementador que elija una silenciosamente.

Exigir el diff completo, evidencia cruda y limitaciones explícitas en lugar
de solo un resumen de éxito. Un brief de despacho también fija el contrato
de retorno: el bloque RESULT por `session-recitation` (más las preguntas
abiertas como entradas `BLOCKER:`) — un delegado despachado sin contrato de
retorno es inverificable.

## Fase 1 — Clasificar la tarea y seleccionar capacidades

Clasificar por los archivos realmente tocados, no por palabras clave del
título. Mapeo típico: fuente de producto → comprobaciones de implementación
que el proyecto declara; superficie de bindings/SDK → tests de binding más
revisión de contrato público; docs/planes → sin comprobación mecánica más
allá de validación de enlaces/formato; mixto → todas las capacidades y
comprobaciones aplicables.

Ejecutar el pase de descubrimiento de skills (skill `select-capabilities`):
hacer match del tipo de tarea, la fase actual del ciclo de vida y las
palabras clave del contrato contra el catálogo de skills; cargar como
máximo 8 candidatas con una justificación de una línea cada una y
registrarlas como `SKILLS_LOADED`. Si ninguna aplica más allá del conjunto
base, registrar `SKILLS_LOADED: base-only, no additional candidates`.

El tipo `bug` además requiere `systematic-debugging`: sin corrección sin
una investigación de causa raíz registrada primero (ver "Evidencia de
depuración" abajo). La lógica nueva o compleja añade
`test-driven-development`; el trabajo sensible a seguridad añade
`doubt-driven-development` o `security-and-hardening`.

### Detección de feature-add (puerta de spec)

El tipo de tarea detectado NO decide si la tarea es feature-add. Comprobar
mecánicamente si la solución planeada añade nuevos símbolos o contratos
públicos: nueva función/tipo/endpoint/flag CLI/herramienta pública, un
método nuevo en una superficie de binding publicada, o una capacidad
visible al usuario que no existía. Cualquiera de esas señales la convierte
en feature-add a efectos de metodología aunque los archivos sugieran
fix/wrapper/refactor. Consecuencias:

1. El registro de tarea DEBE portar una sección spec válida por
   `spec-brief` (una tabla de decisiones o justificación por evidencia por
   ítem; `N/A` es inválido).
2. Las decisiones de diseño abiertas pasan por UNA ronda de la puerta de
   decisión (`decision-request`, Gate D) antes de la implementación.
3. Sin spec válida → no entrar en ACT. Es una puerta mecánica.

## Fase 2 — Discovery y radio de impacto

El discovery ligero (pocos archivos) corre inline; el discovery pesado
(muchos archivos, impacto transitivo amplio, investigación web multifuente)
puede delegarse a un contexto de investigación de solo lectura que devuelve
un digest — ver `research-brief`. No fragmentar la delegación por paso;
delegar la fase pesada completa.

Usar la capacidad estructural/de grafo del proyecto cuando esté disponible
(referencia `graph-investigation`); recurrir a grep/read para contenido no
indexado. Registrar en el registro de tarea (`analysis.blastRadius` /
`analysis.impact`):

- CALLERS: qué módulos llaman a estos archivos/símbolos.
- CALLEES: de qué dependen estos archivos.
- IMPLICATIONS: ¿rompe contratos existentes? ¿cambia comportamiento público
  (API, CLI, SDK)? ¿afecta rendimiento, memoria, serialización? ¿requiere
  migración de datos o reindexado? ¿afecta tests existentes?
- RISK: alto / medio / bajo.
- CONTRACT: "done = [condición mecánicamente comprobable]" — nunca un
  contrato vago (ver el apéndice).

## Fase 3 — Investigación externa cuando hay ambigüedad

Si la tarea involucra APIs/bibliotecas externas cuya documentación no está
en el código, patrones desconocidos, u opciones técnicamente divergentes:
usar herramientas de búsqueda aprobadas (skill `web-research`) con
autorización del propietario para acceso a red. Documentar hallazgos en las
notas de investigación de la tarea con URLs; marcar cualquier cita no
resuelta mecánicamente como `[UNVERIFIED citation]` y registrar la
comprobación pendiente como deuda.

## Fase 4 — Descomponer en pasos atómicos

Cada paso debe ser: una sola acción (editar un archivo, correr una
comprobación), aproximadamente ≤100 líneas de cambio, y mecánicamente
verificable. Registrar los pasos en el registro de tarea `steps[]` con
`name`, `files`, `action`, `verify`, `status`. Estimar el esfuerzo en el
bucket declarado (`effort`: hours/day/days/weeks) y `estimate.turns`.

## Fase 5 — Puerta de revisión independiente

La revisión de esta tarea la ejecuta un contexto DISTINTO del
implementador — nunca el mismo contexto. Usar el rol reviewer o las skills
`review-deep`/`independent-review`; briefear a ese revisor por
`review-request`. Alcance obligatorio de esa revisión:

1. Enfoque — ¿el enfoque elegido es correcto; se pasaron por alto
   alternativas mejores?
2. Cómo se verificó — ¿la evidencia es real y suficiente; un check en verde
   autoreportado no es evidencia.
3. Escalonado por riesgo — los diffs que tocan las superficies de alto
   riesgo declaradas del proyecto (contratos de API pública, formatos de
   almacenamiento/wire, parsers, límites de auth) requieren revisión
   adversarial; el resto recibe verificación mecánica más un veredicto
   registrado. Un diff mixto es adversarial.
4. Checklist de antipatrones (ver la sección Review de la plantilla de
   registro).

Sin un veredicto de revisión registrado de un contexto distinto — o una
renuncia explícita del propietario `{owner, reference, reason}` — la tarea
no está COMPLETED aunque el contrato pase. Fallback cuando no existe un
segundo contexto: una autorevisión adversarial en un contexto fresco,
marcada como degradada y escalada al propietario.

## Plantilla de registro de tarea

Persistir el registro bajo la ruta de tareas configurada
(`.scopegrain/tasks`) vía el runtime de tareas del harness. Contenido
requerido:

```markdown
# <TASK-ID>: <short description>

## Metadata
- Plan: <plan identity or "single-task">
- Source: <backlog key / request / finding id>
- Type: bug | feature | refactor | research | docs | ops | mixed
- Effort: hours | day | days | weeks   ·   Estimated turns: N
- Priority / Severity / Disposition: per semantic layer
- State: PLAN (lifecycle state, not a checkbox)
- Revision: <current revision>
- Uncertainty: uphill N (open unknowns) / downhill M (known steps left)
- Created / last-synced: ISO timestamps

## Blast radius
| Direction | Modules |
| Callers   | ...     |
| Callees   | ...     |
| Implications | contract X unchanged, performance Y affected |

## Mapped impact (pre-edit gate)
> GATE before ANY edit: every file to be modified/deleted is read completely
> and its impact mapped BEFORE the first edit step. Without this block filled,
> no step that edits files may run.
- Files read (completely): [paths]
- Incoming references (who references the edited files): [search result]
- Impact verdict: [low/medium/high — what breaks if changed/removed]

## Contract
"<exact check or observable condition> passes and <specific behavior> holds"

## Spec (mandatory when feature-add detection fired)
> Valid content per `spec-brief`: a decision table (≥1 row, ≥2 real
> alternatives + one-line tradeoff + recommended default + Resolved column)
> OR per-item `decided-by-evidence (ref: file:line | official doc)` notes.
> `N/A`/empty is invalid; `no technical decisions` + touched-file list only
> for a 100%-docs task.

## Domain invariants (handoff)
- Invariants to preserve: [domain/security condition the next context must not break]
- Verification commands: [exact command + expected result — proposed, owner-run under manual verification]
- Pending debt: [what stays incomplete, or "none"]

## Continuation (recitation mapping — canonical format in `session-recitation`)
| Field | ← source in this record |
| activeGoal | the `# <ID>: <description>` header |
| lastAction | last done step + context save point |
| result | OK ↔ CLOSE-ready · PARTIAL ↔ in-flight with pending steps · FAILED ↔ failed |
| nextAction | next pending step (file + command) |
| contract | Contract + verification + per-claim evidence + artifacts + invariants + debt + pending-for-orchestrator |
| nextTask | next task in the plan |

## Technical debt
Net debt balance: none | new debt recorded with id + paying reference
(new debt must be registered, not silently introduced).

## Definition of Done (per level — gate, not afterthought)
| Level | Gate |
| Task  | record contract verified + declared checks pass + tests for the change pass |
| Commit | atomic diff (~100 lines), declared commit convention, clean mechanical verification (never self-report) |
| Release | project's declared release gate, changelog/version policy, pre-push consent |

## Capabilities
- Tools/checks: [the project's real commands]
- SKILLS_LOADED: [list + one-line justification, or `base-only`]

## Investigation notes
- Web-research findings, verified citations, unresolved questions.

## Uncertainty report (uphill/downhill)
Report THREE counters separately, never a bare percentage:
- Uphill (open unknowns): approach to validate, dependency to investigate,
  open decision — must reach 0 before completion.
- Downhill (known pending steps): remaining execution work.
- % executed: progress over steps.
A resolved unknown moves to Notes with its answer.

## Debugging evidence (bug tasks only — gate before any fix step)
- Repro: deterministic reproduction (exact steps/command).
- Hypothesis: probable root cause, written BEFORE touching code.
- One controlled variable: exactly ONE variable changed per attempt.
- RED test: regression test that reproduces the bug, verified FAILING before
  the fix and GREEN only with the fix applied.
Fix steps and their verifies are defined only AFTER this block is filled.

## Mandatory domain phases (evaluate before coding; justify if N/A)
- [ ] SECURITY — if it touches trust boundaries, user input, auth, data, or
      adds/removes dependencies → `security-and-hardening`, findings in Notes.
- [ ] PERFORMANCE — if it touches a hot path → `performance-optimization`,
      record baseline/expected impact.

## Steps
### Step 1: <name>
- Files: `path/to/file`
- Action: what to do
- Verify: <exact mechanical check>
- Status: pending | done | skipped

## Dependencies
- <task id>: <why it must complete first>

## Review (gate — different context)
- Reviewer: [role/context, ≠ author]
- Approach: [is it correct; alternatives]
- Verification: [real evidence, not self-report]
- Anti-pattern checklist (reviewer confirms the implementer did NOT):
  - [ ] invent outputs of commands/tools that were not run
  - [ ] skip clarification "because I already knew"
  - [ ] declare done without checking acceptance criteria
  - [ ] ignore failures or report all-OK on partial failure
  - [ ] stop after one search attempt and call it saturated
  - [ ] copy without citing or present assumptions as evidence
  - [ ] retry in a loop without diagnosis
  - [ ] leave orphan steps disconnected from the goal
  - [ ] degrade error checking on money/security paths
  - [ ] spend unbounded budget; stops must be explicit
  - [ ] leave a capability gap: does SKILLS_LOADED cover the task domain?
- Verdict: approve | changes-requested (return to Steps)

## Notes
- Design decisions, learned context, known issues.
```

## Apéndice — contrato vago vs verificable

| Vago | Verificable |
|---|---|
| "Arreglar el bug de memoria" | "`tests/test_memory` pasa, el linter reporta 0 nuevos warnings" |
| "Mejorar la UI web" | "`tsc --noEmit` 0 errores, lint declarado pasa, build declarado tiene éxito" |
| "Refactorizar módulo" | "check declarado pasa, sin nuevos warnings, tests existentes pasan" |
| "Funciona bien" | "build + suite de tests declarada pasan, y <comportamiento específico> funciona" |
