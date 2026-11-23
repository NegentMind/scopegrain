---
name: coordinate-plan
description: Coordina tareas listas dentro de un plan aprobado y límites explícitos.
---
# Coordinar un plan

Condición de entrada: un plan persistido. Sin argumento, selecciona el
plan más reciente bajo la ruta de planes configurada. Si no existe
ninguno, detente: «No se encontró ningún plan — crea uno primero con
`plan-work`.»

Skills a cargar: `plan-coordination`, `select-capabilities`,
`session-handoff`, `context-engineering` (presupuesto de contexto del
orquestador). Reglas rectoras: `rules/workflow`, `rules/memory-budget`.
Rol del orquestador: `lead`. Semántica de registros de tareas:
`references/task-domain`. Cada tarea despachada ejecuta la misma
profundidad que `implement-task` — descubrimiento, ejecución,
verificación, revisión, cierre.

El bucle del orquestador — sondeos de integridad, reclamaciones
atómicas de tareas, el brief de delegado de diez bloques, la
clasificación de resultados, las oleadas, los techos de presupuesto y
la retrospectiva de cierre — vive en `prompts/plan-execution` Part A;
el protocolo por tarea es su Part B. Los briefs de trabajadores siguen
`prompts/task-brief`; el trabajo interrumpido se reanuda vía
`prompts/recovery-brief`; la continuación y los bloques RESULT siguen
`prompts/session-recitation`; los hallazgos colaterales se enrutan
según `prompts/finding-record`. Las puertas del propietario dentro de
los delegados usan `prompts/decision-request`.

## Modos

El modo de fallo se registra en el plan o lo elige el propietario:

| Modo de fallo | Comportamiento |
|---|---|
| `stop` | Detiene el plan en el primer fallo. Por defecto ante la duda. |
| `skip` | Marca la tarea fallida, continúa las tareas independientes, reporta todos los fallos al final. |
| `parallel` | Ejecución por oleadas: agrupa las tareas listas por nivel de dependencia; ejecuta cada oleada a través de la capacidad de delegación disponible (límite de concurrencia por defecto 3); una tarea fallida deja a sus dependientes bloqueadas. Solo ámbitos disjuntos con entradas resueltas pueden compartir una oleada. |

El avance guiado paso a paso es una granularidad separada, no un modo de
fallo — ver abajo.

## Paso 1 — Cargar y reconciliar

- Carga el registro del plan, los estados y revisiones actuales de las
  tareas, las aprobaciones, las capacidades del host disponibles y el
  presupuesto autorizado restante. Reutiliza el trabajo completado y en
  curso — el planificador de dependencias no prueba que ningún agente
  ejecutara; confía en los registros de tareas actuales, no en un
  resumen obsoleto.
- Ejecuta los sondeos de integridad (`plan-execution` §A.3): el plan
  existe y tiene tareas, el bloque de continuación es legible, ninguna
  tarea se repite sin progreso, el árbol de trabajo es consistente con
  esta ejecución, la capacidad de índice/grafo declarada está lo
  bastante sana para los archivos clave de la tarea. Un sondeo fallido
  → pregunta al propietario antes de continuar.
- Si un checkpoint o registro de estado en la ruta de estado
  configurada nombra una tarea en curso, reanuda ahí en lugar de
  reiniciar el plan.

## Paso 2 — Seleccionar y preparar el brief

- Selecciona solo tareas con dependencias listas: entradas de triaje
  `do` cuyos prerrequisitos cerraron. Las entradas triadas como
  `defer`/`skip`/`blocked` se reportan como triadas, no como listas.
- Prepara un brief acotado por tarea lista (slots requeridos de
  `prompts/task-brief`; los diez bloques obligatorios de
  `plan-execution` §A.5.f): referencias exactas de la tarea (nunca
  requisitos parafraseados), superficies de escritura permitidas,
  aceptación, comprobaciones autorizadas exactas, contrato de retorno
  (diff completo + evidencia en bruto + preguntas abiertas) y el límite
  de rehacer antes de escalar. Resuelve los contratos ambiguos antes de
  despachar; una decisión de producto o permiso sin resolver lo
  bloquea.
- Mantén las decisiones, las políticas críticas y la aprobación final
  con el lead; los roles de solo lectura devuelven hallazgos para que
  el lead los persista (`references/orchestration-patterns`).

## Paso 3 — Despachar según el modo de fallo

Reclama cada tarea atómicamente antes de despacharla — una segunda
ejecución no debe iniciar el descubrimiento sobre la misma tarea
(`plan-execution` §A.4). Delega solo a través de una capacidad de host
autorizada realmente disponible. Sin una, ejecuta las tareas
secuencialmente en este contexto e indícalo — nunca afirmes un fan-out
que no ocurrió.

## Paso 4 — Cierre por tarea

Para cada resultado devuelto:

1. Inspecciona el diff completo y los artefactos contra el contrato
   original de la tarea — no contra el autoinforme del delegado.
2. Aplica la comprobación mecánica registrada en la tarea antes de
   aceptarla; un resumen no es verificación.
3. Ante un resultado incompleto, fallido, vacío o autodetenido, aplica
   la escalera de recuperación de `prompts/recovery-brief` (RESUME
   misma sesión → RETRY fresco → STRATEGY → ESCALATE). Nunca rehagas
   trabajo registrado, y nunca marques un resultado como fallido sin la
   escalera; valida el registro GATES_EVALUATED al recibirlo.
4. Registra el estado, la evidencia de verificación y un commit local
   donde la tarea lo autorice (`work-unit-commits`); actualiza el
   registro del plan y el checkpoint de estado de ejecución bajo la
   ruta de estado configurada.
5. Rastrea estancamiento y presupuestos según `plan-execution`
   (§A.5.k–n): 3 resultados consecutivos no-DONE en una tarea → pausa y
   pregunta al propietario; los presupuestos declarados son paradas
   duras y cada peldaño de recuperación cuenta.

## Paso 5 — Cierre del plan

Cuando toda tarea sea terminal: ejecuta `session-handoff`, reporta las
tareas completadas, fallidas y bloqueadas con su evidencia, y produce
la retrospectiva de cierre (`plan-execution` §A.8 — keep/stop/continue
más una acción medible de mejora de proceso). Detente. No publiques,
fusiones ni inicies nuevo trabajo; `assess-release` es una decisión
separada del propietario.

## Avance guiado paso a paso

Para depuración supervisada por el propietario, procesa exactamente una
tarea — o un paso — por invocación y preserva el estado de sesión entre
iteraciones:

- Una tarea completa por invocación → `prompts/plan-execution` Part B.
- Una iteración del ciclo de vida por invocación →
  `prompts/iteration-loop`.

Si hay varios planes activos, lístalos y pregunta cuál conducir.

## Autoridad y verificación

La delegación ocurre solo a través de capacidades autorizadas
disponibles; la verificación es la propia comprobación mecánica de la
tarea, registrada — nunca el resumen de un delegado. Los commits
permanecen locales; push, fusión y publicación son decisiones separadas
del propietario.

## Contrato de salida

- Checkpoint de estado de ejecución bajo la ruta de estado configurada
  tras cada tarea.
- Bloques RESULT por tarea, cargas de revisión y verificación
  registrada.
- Registro del plan actualizado más la retrospectiva de cierre;
  registros de progreso vía `session-handoff`.

## Señales de alarma

- Fan-out afirmado sin una capacidad de delegación real.
- Un resultado marcado como fallido sin la escalera de recuperación;
  trabajo registrado reejecutado en lugar de reanudado.
- Oleadas que mezclan ámbitos de escritura solapados o entradas no
  resueltas.
- Aceptación registrada sin una carga de revisión válida.
- Publicación, fusión o trabajo nuevo iniciado dentro del cierre.

## Entrega

Reporta el trabajo completado, activo, bloqueado y el siguiente listo
con la identidad del plan. Sugiere `verify-work` para la puerta
mecánica o `report-status` para el panel; no los ejecutes
implícitamente.
