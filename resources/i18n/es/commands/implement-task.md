---
name: implement-task
description: Implementa una tarea autorizada con dependencias listas usando su ruta light o SDD seleccionada.
---
# Implementar una tarea

Condición de entrada: un identificador de tarea o una unidad de trabajo
explícita aprobada por el propietario.

Skills a cargar: `select-capabilities`, `contract-execution`,
`incremental-implementation`, `test-driven-development`,
`systematic-debugging` en caso de fallo, `session-handoff` al cierre.
Reglas rectoras: `rules/workflow`, `rules/evidence`, `rules/review`.
Roles: `implementer` ejecuta; `reviewer` posee la puerta del Paso 4.

El procedimiento de registro de tareas vive en `prompts/task-brief`
(clasificar, descubrimiento, pasos atómicos, plantilla de registro,
puerta de revisión); los briefs de trabajadores siguen sus slots
requeridos. Las puertas del propietario usan `prompts/decision-request`
(P/D/V/C); los feature-adds usan `prompts/spec-brief`; los hallazgos
colaterales usan `prompts/finding-record`; el registro de continuación
y el bloque RESULT siguen `prompts/session-recitation`; los briefs de
revisión siguen `prompts/review-request`. Una iteración del ciclo de
vida a la vez — depuración paso a paso — ejecuta
`prompts/iteration-loop`.

## Modos

| Invocación | Comportamiento |
|---|---|
| `implement-task <ID>` | Profundidad completa: localizar, definir, implementar, verificar, revisar, cerrar |
| `implement-task <ID>` + "step through" | Una iteración del ciclo de vida por invocación vía `iteration-loop` |

## Paso 0 — Localizar y clasificar (no omitible)

1. Resuelve la tarea en orden: el plan más reciente bajo la ruta de
   planes configurada, la fuente de backlog registrada, luego los
   registros de tareas bajo la ruta de tareas configurada — ubicaciones
   activas, completadas y cerradas, no solo la lista activa. Si no se
   puede encontrar, pregunta al propietario; nunca inventes la tarea.
2. Lee el registro real de la tarea, la solicitud original, la
   revisión, el ámbito y el código actual. Confirma la autoridad, los
   criterios de aceptación, la disponibilidad de dependencias y las
   comprobaciones autorizadas reales. Una tarea desconocida, una
   decisión de producto sin resolver, un consentimiento ausente o una
   puerta de metodología bloqueada impide la implementación —
   repórtalo, no lo rodees.
3. Resuelve su ruta (`rules/methodology`):
   - **Light (ODD):** conserva su registro acotado y la autorización
     registrada; no fabriques aprobaciones de especificación/diseño.
   - **SDD:** lee la especificación, el diseño, el plan o el contrato
     de tarea única aprobados y los escenarios asignados.
4. Aplica la detección de feature-add (`task-brief` Fase 1): una tarea
   que añade nuevos símbolos o contratos públicos es un feature-add
   independientemente de su etiqueta de tipo — necesita una mini-spec
   `spec-brief` válida antes de ACT.
5. Si una capacidad requerida (verbo de runtime, herramienta, canal de
   delegación) no está disponible, reporta el hueco en lugar de afirmar
   que un prompt o una etiqueta de contexto distinta impuso la puerta.

## Paso 1 — Preparar el registro de la tarea

Si no existe un registro de tarea acotado, crea uno bajo la ruta de
tareas configurada según la plantilla `task-brief` conteniendo como
mínimo:

- Identidad, solicitud original, ruta seleccionada y autoridad
  registrada.
- Análisis de impacto: radio de explosión, llamadores y dependientes,
  invariantes del dominio que deben seguir cumpliéndose (campos
  `analysis` en `references/backlog-format`).
- scenarioRefs asignados (SDD) o hechos de clasificación (light).
- Notas de seguridad/rendimiento e incógnitas conocidas.
- Pasos atómicos, cada uno con una comprobación verificable
  (`references/testing-patterns`).
- Definición de terminado (`references/definition-of-done`):
  comportamiento, cobertura de regresión, sincronización de
  docs/contrato y la evidencia que prueba cada uno.

## Paso 2 — Descubrimiento

- Inspecciona la superficie afectada: definiciones, llamadores, radio
  de explosión y decisiones previas. Usa herramientas de grafo cuando
  esté indexado y fresco; en caso contrario, busca en el código fuente
  y declara la garantía más débil (`references/graph-investigation`).
- El descubrimiento pesado — investigación externa multidocumento o un
  radio de explosión amplio — se delega en solo lectura a `researcher`
  (contrato de digest: `prompts/research-brief` §A); incorpora el
  digest acotado devuelto con fuentes al registro de la tarea. Mantén
  el descubrimiento ligero en línea. No fragmentes la delegación por
  paso.
- Para elecciones de API externa, biblioteca o plataforma, valida
  contra documentación primaria tras el permiso de red (`web-research`);
  un tradeoff citado supera a un adjetivo.

## Paso 3 — Ejecutar

1. Reproduce un defecto con una comprobación causal fallida antes de
   cambiar el comportamiento siempre que exista una comprobación
   determinista ejecutable; explica cualquier excepción.
2. Aplica la corrección más pequeña aguas arriba; preserva el trabajo
   no relacionado; mantén las ediciones dentro del ámbito autorizado
   (ACT).
3. La verificación es manual por defecto: propón los comandos de
   verificación registrados del proyecto y el directorio de trabajo,
   luego registra la salida real del propietario. Ejecuta solo
   comprobaciones autorizadas — un comando propuesto no es una
   comprobación superada, y una comprobación no ejecutada nunca se
   declara en verde.
4. Disciplina de reintento: dos fallos de verificación con el mismo
   error (archivo+línea+mensaje) disparan Gate V (`decision-request`) —
   pregunta al propietario antes de más intentos. Ante fallos repetidos
   sigue `rules/research-escalation`; no reintentes a ciegas.
   Diagnostica vía COLLATERAL/RESEARCH; STALL cuando esté bloqueado en
   una decisión.
5. Enruta los defectos descubiertos que no son el objetivo de esta
   tarea según `prompts/finding-record` — registro en el backlog en el
   momento del descubrimiento, nunca solo en notas.

## Paso 4 — Puerta de revisión (no omitible)

La tarea no se cierra sin una revisión registrada en el registro de la
tarea:

- Preferido: un contexto de revisor separado (`independent-review`) con
  brief vía `prompts/review-request` — contrato, diff completo,
  evidencia en bruto.
- Sin una capacidad de delegación: autorrevisión
  `doubt-driven-development` marcada explícitamente como **degraded**,
  más una exención explícita acotada del propietario registrada con
  propietario, referencia y razón.
- Un rol renombrado para el autor no es independencia. Los riesgos
  nombrados (security, data-integrity, public-contract, concurrency,
  delivery, external-effects, verification-gap) requieren una revisión
  real con contexto fresco.
- Aceptación mecanizada (Gate C): registrar la finalización requiere la
  carga de revisión — `fresh` con contexto de revisor ≠ contexto de
  autor + veredicto `approve`, o `degraded` + exención del propietario
  — según `session-recitation`. Sin carga, no hay CLOSE.

## Paso 5 — Cerrar

1. Inspecciona el diff completo y la evidencia en bruto; registra la
   verificación real y la continuación en las rutas de harness
   configuradas (formato `prompts/session-recitation`).
2. Si la tarea autoriza commits, crea un Conventional Commit local que
   porte la identidad de la tarea solo tras la verificación — nunca
   hagas push; la publicación es una decisión separada del propietario
   (`work-unit-commits`).
3. Actualiza el elemento del backlog y el estado del plan; ejecuta
   `session-handoff` para el registro de progreso y los aprendizajes
   durables.
4. Para SDD, cierra solo la cobertura de escenarios asignada — una
   tarea no certifica la feature completa.
5. Detente tras esta tarea: ni la publicación, ni los efectos
   destructivos ni la siguiente tarea están implícitamente autorizados.

## Autoridad y verificación

La ejecución edita solo dentro del ámbito autorizado (estado ACT). Cada
comprobación es o un resultado ejecutado registrado o un comando
explícitamente propuesto a la espera de la salida del propietario —
verificación manual por defecto. La revisión y la aceptación siguen la
carga mecanizada de arriba; las exenciones son decisiones registradas
del propietario, nunca autoconcedidas.

## Contrato de salida

- Registro de la tarea bajo la ruta de tareas configurada, actualizado
  a lo largo del ciclo de vida, con bloque de continuación según
  `session-recitation`.
- Bloque RESULT por invocación (`session-recitation` §RESULT) siempre
  que el trabajo se ejecutara como delegado o en modo paso a paso.
- Registro de revisión con identidad/modo del revisor, veredicto y
  evidencia.
- Commit local donde esté autorizado; backlog y estado del plan
  actualizados.

## Señales de alarma

- Rodear una tarea desconocida, un consentimiento ausente o una puerta
  de metodología bloqueada.
- Una sección `N/A` de spec en un feature-add — hallazgo de revisión
  bloqueante.
- Un rol renombrado ofrecido como revisión independiente; una
  comprobación en verde autoreportada ofrecida como evidencia.
- Hallazgos guardados en notas o mensajes de commit en lugar de
  `finding-record`.
- Commits preparados con `add -A` o empujados sin autorización
  explícita.

## Entrega

Reporta: ruta del registro de la tarea, rol delegado si lo hay,
comprobaciones ejecutadas con evidencia, registro de revisión.
Siguientes opciones para el propietario: `implement-task` para la
siguiente tarea, o `coordinate-plan` para el plan restante.
