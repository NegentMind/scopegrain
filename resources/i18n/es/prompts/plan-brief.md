---
name: plan-brief
description: Construir un plan de ejecución verificado desde un backlog — comprobación de realidad, puerta de triage, riesgos y condiciones de parada por tarea.
---
# Plan Brief

Construir un plan de ejecución desde un backlog. Cargado por `plan-work`
una vez que existe una entrada autorizada (un backlog registrado, una
especificación zanjada o una solicitud explícita del propietario). Aplicar
la puerta de triage (`do | defer | skip | blocked`) a TODA tarea
candidata. Persistir el registro de plan bajo la ruta de planes
configurada (`.scopegrain/plans`) conteniendo solo tareas `do`. Terminar
confirmando el conjunto defer/skip con el propietario y mostrando el
siguiente comando recomendado. La salida es el registro de plan persistido
más el resumen de triage confirmado por el propietario.

Cargar primero las capacidades relevantes (`planning-and-task-breakdown`,
`writing-plans`, `brainstorming`/`clarify-intent`, `session-handoff`; añadir
`spec-driven-development` cuando trabajo sustancial carece de
especificación zanjada).

## Paso 0 — Comprobación de realidad (obligatoria, por tarea)

Verificar que la tarea es **real y aplicable contra el código actual**
antes de cualquier decisión de puerta: los archivos/símbolos que nombra
existen, el comportamiento o laguna descrito persiste (no ya implementado)
y el trabajo propuesto no está obsoleto. Esto evita que el pipeline
consuma una tarea obsoleta y lo descubra en VERIFY.

**Skills por situación (cargar solo las que aplican):**

| Situación de la tarea | Skill | Por qué |
|---|---|---|
| Bug reportado (caída, comportamiento roto) | `systematic-debugging` | Confirmar que el bug existe con una repro, no solo la descripción |
| Toca API pública / bindings / cambio rompedor | `source-driven-development` | Verificar que los símbolos existen y el comportamiento documentado es real |
| Ambigua o de alto riesgo | `doubt-driven-development` | Adversarial: no confiar en la premisa del backlog |
| Cualquier tarea de código | convención de escalera de reutilización (`code-simplification`) | Comprobación YAGNI antes de incluir la tarea en el plan |
| Migrar/completar trabajo previo | `session-handoff` | Evitar duplicar progreso ya registrado |

Ejecutar también el pase de descubrimiento de skills
(`select-capabilities`): archivos de la tarea + fase `PLAN` del ciclo de
vida + palabras clave del contrato contra el catálogo; registrar
`SKILLS_LOADED` en el plan.

**Por tarea (más profundo a mayor esfuerzo/ambigüedad):**

1. **Extraer referencias** del texto de la tarea: rutas de archivo,
   símbolos (funciones, tipos, tests, endpoints), feature flags, API
   pública.
2. **Verificar en código real** con la capacidad estructural disponible
   (referencia `graph-investigation`; fallback grep/read):
   - ¿Existe el archivo/símbolo? (falta → ruta obsoleta o renombrada)
   - ¿El comportamiento ya está implementado? (un "fix X" con X corregido
     → STALE)
   - ¿Qué lo llama / qué afecta? (radio de impacto — reutilizado después
     en el registro de tarea)
   - ¿Los docs/API referenciados coinciden con el código actual?
3. **Clasificar la puerta** desde la evidencia:

| Evidencia real | Puerta |
|---|---|
| Referencias existen + laguna de comportamiento real + cambio acotado | `do` |
| Referencias existen pero laguna ambigua / esfuerzo ≫ impacto | `defer` |
| Referencias faltantes, ya implementado, o hecho en otro plan | `skip` |
| Depende de una tarea no lista o bloqueada | `blocked` |
| Inverificable sin investigación (bug sin repro, API externa) | anotarlo; aplicar `do` solo si el impacto lo justifica |

4. **Escribir la evidencia en el plan** — la verificación forma parte del
   contrato: `Verified: symbol X exists at file:line, real gap, callers: A, B`
   más la justificación de la puerta. Si el símbolo falta, registrar eso
   como la evidencia del `skip`.

## Pre-mortem (obligatorio para todo candidato `do`)

Listar los 2–3 modos de fallo más probables ANTES de comprometer esfuerzo —
la forma más barata de exponer madrigueras antes de que el enfoque elegido
se convierta en un compromiso costoso. Registrar cada uno como `Likely
failure N: ...`. Un modo de fallo de alta probabilidad y alto impacto baja
la puerta a `defer` o entra en el registro de riesgos.

## Condiciones de parada / apetito (disyuntor)

Definir disparadores de CANCELACIÓN explícitos ANTES de que la tarea
empiece:

| Condición de parada | Disparador | Acción |
|---|---|---|
| Apetito excedido | tiempo invertido > apetito declarado | abortar → re-triar como `defer` |
| Madriguera | N iteraciones sin progreso verificable | abortar → replanificar el enfoque |
| Presupuesto agotado | presupuesto de operación declarado gastado | abortar → registrar en notas |
| Premisa invalidada | nueva evidencia contradice el Paso 0 | abortar → reevaluar la puerta |

Una condición de parada disparada marca la tarea `cancelled` (no `skip`)
con la razón registrada. Las condiciones de parada viven en el registro de
plan junto a cada contrato (campos `stopConditions`, `appetite`).

## Reglas de puerta (aplicadas TRAS el Paso 0)

> **Puertas de decisión:** toda tarea crítica o contrato ambiguo se
> confirma con el propietario por `decision-request` (Gate P) ANTES de
> fijar la puerta; para feature-add/lógica nueva, una mini-spec por
> `spec-brief` resuelta con una ronda de preguntas antes de `do`.

1. Bug ya ausente o feature ya implementada (**verificado**) → `skip`
2. Cosmético sin queja de usuario → `defer`
3. Esfuerzo ≫ impacto → `defer` o `skip`
4. Dependencia no lista → `blocked`
5. La prioridad original es una sugerencia, no una ordenación
6. La verificación del Paso 0 fundamenta la puerta — no redecidir desde la
   prosa del backlog cuando el código la contradice

## Checklist "¿es AHORA" (obligatoria antes de cualquier `do`)

El triage clasifica; no decide que el trabajo es el correcto AHORA. Antes
de un `do`, responder tres preguntas — cualquier "no" degrada a `defer`
con la razón:

1. **¿Es el problema correcto?** — ¿encaja con el objetivo/estrategia
   actual, o es ruido lateral del backlog?
2. **¿El apetito/alcance es correcto?** — ¿el trabajo cabe en el apetito
   declarado? Un apetito conocido-insuficiente es un `defer`, no un `do`
   con fecha de fallo. Para tareas clasificadas complejas, validar el
   apetito primero.
3. **¿Es AHORA?** — ¿la urgencia justifica adelantarlo sobre las otras
   tareas?

## Cynefin + top-3 riesgos (obligatorio para cada tarea)

Clasificar la complejidad ANTES de fijar esfuerzo/prioridad:

| Dominio | Señal | Implicación de enfoque |
|---|---|---|
| Clear | causa-efecto conocida, buena práctica conocida | ejecutar directamente → esfuerzo pequeño |
| Complicated | causa-efecto analizable por experiencia | necesita análisis → esfuerzo medio; registrar la elección entre enfoques válidos |
| Complex | la causa-efecto emerge solo sondeando | NO planificar todo por adelantado: probe-sense-respond, pasos cortos, verify frecuente |
| Chaotic | sin relación causal visible (crisis) | actuar primero: estabilizar antes de planificar; uphill alto → `defer` salvo que arda |

Registrar en el plan por tarea: `Cynefin: <class> — why` más los **top-3
riesgos priorizados** (más probable / mayor impacto / el que rompería el
contrato). Estos sembrán el registro de riesgos de la tarea — un riesgo de
triage identificado no puede estar ausente de él.

## Registrar cada tarea `do`

- Clave/id única, descripción corta (≤80 caracteres)
- **Apetito:** el tiempo que SE invertirá, declarado antes del esfuerzo;
  dispara la condición de parada "apetito excedido"
- **Effort / priority / severity / type** según la capa semántica
- **Archivos clave**, **verificación real** (evidencia del Paso 0),
  **justificación de puerta**, **resultado de puerta**
- **Contrato:** condición verificable mecánicamente
- **Pre-mortem**, **condiciones de parada**, **registro de riesgos** (≤5-8
  riesgos vivos: probabilidad×impacto, mitigación, disparador)
- **Cynefin** + **top-3 riesgos**
- **Uphill/downhill**: incógnitas abiertas vs trabajo pendiente zanjado
- **DoD** por nivel (abajo)
- **Coherencia apetito-vs-esfuerzo:** apetito ≥ esfuerzo estimado; si
  apetito < esfuerzo → reestimar, ampliar el apetito, o reducir a `defer`
  ANTES de fijar `do`
- **Vinculaciones de metodología** (`rules/methodology`): las tareas SDD
  portan las referencias de spec/diseño zanjadas y los scenarioRefs
  asignados; el trabajo ligero porta hechos de clasificación y
  autorización acotada registrada en su lugar — nunca fabricar
  aprobaciones formales para una tarea ligera
- **Dependencias** (claves de tarea del plan — el DAG); estado inicial
  PLAN; registro de tarea bajo `.scopegrain/tasks` creado bajo demanda

## Definition of Done — por nivel (puerta, no ocurrencia tardía)

| Nivel | Mínimo |
|---|---|
| Task | contrato mecánico verificado (verificación registrada) · registro de tarea sincronizado · continuación actualizada |
| Commit | convención de commit declarada · comprobaciones declaradas pasan · sin nueva deuda neta · aprendizajes registrados |
| Release | política de changelog/versión · docs sincronizados · puerta de release declarada |

Los checkboxes se marcan solo con evidencia mecánica, nunca con intención.

## Reporte de incertidumbre (obligatorio)

Reportar el estado del plan en DOS ejes, no solo % hecho:

- ⬆ **uphill** — incógnitas abiertas: elecciones sin decidir, dependencias
  externas sin verificar, comportamiento ambiguo, Cynefin sin resolver.
- ⬇ **downhill** — pendiente de ejecución zanjado: pasos atómicos con un
  contrato claro, sin incógnitas.

Mover una tarea a in-progress sin un enfoque conocido es uphill hasta que
el contrato esté definido. Los contadores por tarea viven en el registro
de tarea; el plan reporta el agregado.

## Evento `plan-adjust` (replanificación)

La replanificación (pending→do, reestimación, cambio de contrato) no es
gratuita: cambia el reporte de incertidumbre. Registrar en las notas del
plan:

```
plan-adjust [YYYY-MM-DD]: <id> — what changed (gate / re-estimate / contract)
- uphill before: <resolved or new unknown>
- uphill after: <state after the adjust>
- downhill before/after: <pending steps>
```

Sin el evento, "progreso" y "incógnita resuelta" son indistinguibles.

## Ingesta de backlog

Leer el backlog del proyecto en su formato declarado (registros de backlog
nombrados o el archivo del propietario). Parsear determinísticamente donde
se declare un esquema; excluir las disposiciones terminales (`icebox`,
`future`, `discarded`, `cancelled`) del triage salvo decisión explícita en
contrario. Si el formato no se reconoce, interpretar conservadoramente y
marcar los ítems no parseables.

## Formato del registro de plan

```markdown
# Execution Plan: <name>
> Started: YYYY-MM-DD · State: in-progress · Source: <backlog ref>
> Autonomous: false   # true = only Gate V + Gate C safety cases apply

## Summary
| Result | Count |
| do | N |  defer | N |  skip | N |  blocked | N |
Status: ⬆ uphill = <open unknowns> · ⬇ downhill = <pending steps>

## Tasks
### Task 1: <key> — <description>
- Appetite / Effort / Priority / Type
- Key files: `path`
- Verified: ✅ real-code (symbol X at file:line, gap confirmed) |
  🟡 verify-in-discovery | ❌ stale
- Gate justification · Gate result: do
- Contract: "<mechanical check>"
- Task record: <tasks path>/<id> · State: PLAN
- Branch: · Commit:
- Risk register: | likelihood×impact | risk | mitigation | trigger |
- Iterations: | # | action | result | tool |
- Notes:
```

## Al terminar

Antes de persistir el plan: **confirmar el conjunto completo de
defer/skip con el propietario** (`decision-request`, Gate P — resumen de
triage final). Luego mostrar el siguiente comando exacto:
`coordinate-plan` — que carga `plan-execution` — para el nuevo registro de
plan, o `implement-task` para una tarea única.
