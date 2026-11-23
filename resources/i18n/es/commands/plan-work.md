---
name: plan-work
description: Prepara un grafo de dependencias para trabajo formal resuelto sin ejecutarlo.
---
# Planificar el trabajo

Condición de entrada: una entrada autorizada — la fuente de backlog
registrada, una especificación resuelta o una solicitud explícita del
propietario de un plan formal. Sin argumento, usa el backlog registrado
del proyecto.

Skills a cargar: `select-capabilities`, `planning-and-task-breakdown`,
`writing-plans`, `brainstorming`, `plan-design-review`. Cuando los
elementos del backlog describen trabajo sustancial o sensible sin una
especificación resuelta, carga también `spec-driven-development`.
Semántica del backlog: `references/backlog-format`. Reglas rectoras:
`rules/workflow`, `rules/api-contract`. Roles: `lead` coordinando,
`architect` para decisiones de límites.

El procedimiento de planificación profunda vive en `prompts/plan-brief`
— comprobación de realidad por tarea, pre-mortem, condiciones de
parada, checklist "is it NOW", clasificación Cynefin, campos de
registro por tarea y el formato del registro del plan. Este comando
posee el enrutamiento, el resumen de puertas y el contrato de salida;
las confirmaciones del propietario usan `prompts/decision-request`
(Gate P) y los candidatos feature-add usan `prompts/spec-brief`.

## Modos

| Invocación | Comportamiento |
|---|---|
| `plan-work` | Construye un plan a partir del backlog registrado del proyecto |
| `plan-work <input>` | Construye un plan a partir de la entrada de backlog/spec nombrada |

## Paso 0 — Puerta de especificación

Busca una especificación resuelta en el espacio de trabajo del harness
o un artefacto spec aprobado. Si existe una, úsala como contexto. Si no
existe ninguna y el backlog contiene trabajo de feature sustancial,
ejecuta `specify-change` primero — derivación de contexto, tabla de
decisiones abiertas, una ronda de decisión, spec escrita. No hagas
triaje por encima de decisiones de producto sin resolver.

## Paso 1 — Inspeccionar antes de planificar

Solo lectura. Inspecciona los planes existentes bajo la ruta de planes
configurada, los registros de tareas actuales, las especificaciones
previas y la propia implementación. Identifica el hueco real.
Reejecutar `plan-work` es idempotente: reconcilia contra lo que ya
existe y nunca produzcas un segundo plan para el mismo trabajo.

- No produzcas otro plan para trabajo completado, y no impongas un
  grafo formal sobre una tarea genuinamente light — el trabajo light
  conserva su registro de tarea acotado (`rules/methodology`).
- Un plan formal explícitamente solicitado usa la ruta SDD incluso
  cuando una ruta más ligera hubiera sido posible.
- Lee la especificación estructurada resuelta, el diseño aprobado y la
  evidencia PLAN. La evidencia del resultado final no puede requerirse
  antes de que el trabajo exista.
- Preserva la solicitud original, las restricciones y los ejemplos de
  comportamiento exactos.

## Paso 2 — Puerta de triaje

Clasifica cada elemento del backlog `do` / `defer` / `skip` /
`blocked` con una razón de una línea (el registro `triage` del plan;
`references/backlog-format`). Aplica la verificación completa por tarea
de `prompts/plan-brief` — comprobación de realidad contra el código
actual, modos de fallo pre-mortem, checklist "is it NOW", clase Cynefin
y top-3 riesgos, appetite y condiciones de parada.

Reglas de puerta:

1. Bug ya corregido o feature ya implementada (verificado contra el
   código, no confiado desde la prosa del backlog) → `skip`.
2. Cambio cosmético sin queja de usuarios → `defer`.
3. El esfuerzo excede con mucho el impacto → `defer` o `skip`.
4. Dependencia no lista → `blocked`, nombrando el bloqueante.
5. La prioridad registrada es una sugerencia, no un orden — el orden
   real de dependencias gana.
6. Prioridad crítica, un contrato ambiguo o un candidato que añade
   nuevos símbolos públicos → una ronda del propietario según
   `decision-request` (Gate P); los feature-adds resuelven sus
   decisiones abiertas de `spec-brief` antes de `do`.
7. Un defecto no relacionado aflorado por la comprobación de realidad
   se registra según `prompts/finding-record` — no se añade
   silenciosamente al plan.

Excluye elementos cuya disposición registrada sea
deferred/icebox/future/discarded/cancelled. Si el backlog no coincide
con un esquema conocido, interprétalo directamente y declara la
suposición en lugar de forzar un parseo.

## Paso 3 — Construir el plan

1. Identifica el grafo de dependencias entre componentes; mantén el
   DAG acíclico.
2. Corta verticalmente: una ruta funcional completa por tarea, no
   capas horizontales. El comportamiento coherente mantiene sus tests y
   docs en la misma unidad.
3. Cada tarea recibe: una clave estable, ámbito acotado y exclusiones,
   scenarioRefs asignados de la especificación, comprobaciones
   propuestas exactas descubiertas en este proyecto, dependencias
   expresadas como claves de plan y las capacidades requeridas — más
   los campos de `plan-brief` (justificación de puerta, contrato
   mecánicamente verificable, pre-mortem, condiciones de parada,
   registro de riesgos, uphill/downhill). El registro de tarea creado
   después bajo demanda sigue `prompts/task-brief`; los límites de
   módulo se ajustan a `references/architecture`.
4. Cubre todos los escenarios de la especificación a lo largo del plan,
   no dentro de cada tarea. Cada tarea formal posee al menos un
   escenario verificable; si una tarea candidata no tiene ninguno,
   acuerda un escenario técnico o reagrúpala — nunca inventes
   requisitos.
5. Mantén las escrituras paralelas independientes y disjuntas; marca
   las incógnitas `blocked` en lugar de adivinar parámetros.
6. Añade checkpoints entre fases donde una decisión del propietario o
   un efecto externo condiciona la siguiente fase.
7. No selecciones modelos de pago, presupuestos o efectos externos sin
   aprobación.

## Paso 4 — Presentar y persistir

Presenta el plan completo — tabla resumen (conteos
do/defer/skip/blocked), tabla de tareas, destinos operacionales — para
confirmación del propietario, incluido el conjunto completo de
defer/skip (Gate P). Persiste solo las tareas `do`, solo a través de
operaciones de harness aprobadas disponibles, en la ruta de planes
configurada (formato de registro de plan de `plan-brief`). Registra la
fuente de backlog de cada tarea. La creación deja las tareas en PLAN;
un plan persistido no es autorización para implementarlo.

## Autoridad y verificación

Solo lectura hasta que el propietario confirme el plan; la persistencia
va solo a través de operaciones de harness aprobadas hacia la ruta de
planes configurada — nunca hacia documentación del producto. El
comportamiento exacto solicitado y las restricciones se preservan
verbatim en los registros de tareas.

## Contrato de salida

- Registro del plan en formato `plan-brief` bajo la ruta de planes
  configurada: conteos resumen, evidencia verificada por tarea,
  justificaciones de puerta, contratos, registros de riesgos,
  dependencias del DAG.
- Decisión del propietario registrada para el conjunto defer/skip.
- Las tareas permanecen en estado PLAN; los comandos posteriores crean
  registros de tarea bajo demanda.

## Señales de alarma

- Planificar trabajo ya construido porque se confió en la prosa del
  backlog más que en el código.
- Un segundo plan sobre uno en curso en lugar de reconciliarlo.
- Un grafo formal impuesto sobre una tarea light, o un atajo light
  sobre trabajo sensible de riesgo nombrado.
- `do` fijado antes de que la comprobación de realidad del Paso 0 se
  ejecutara.
- Ejecución iniciada dentro de este comando — `plan-work` nunca
  implementa.

## Entrega

Reporta la identidad del plan y la siguiente puerta:

- `coordinate-plan` — ejecuta las tareas listas de este plan.
- `implement-task` — define y ejecuta una tarea específica.
- `specify-change` — resuelve primero las decisiones de producto sin
  resolver.

Detente tras la entrega; no comiences la ejecución sin la elección del
propietario.
