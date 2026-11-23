---
name: plan-coordination
description: Usar al ejecutar una o más tareas dependientes y preservar la continuación a través de interrupciones
---
# Coordinación de planes

Coordina la ejecución de un plan registrado: selecciona trabajo con
dependencias resueltas, lleva cada tarea por el ciclo de vida en porciones
estrechas, preserva estado duradero para que cualquier interrupción pueda
reanudarse, y para en el límite acordado.

La arquitectura es un bucle (scheduler o invocaciones repetidas) que impulsa
un ejecutor que realiza exactamente una acción significativa por turno y
registra el estado en archivos:

```
SCHEDULER                              EXECUTOR (per turn)
┌────────────────────────┐          ┌──────────────────────────┐
│ for each pending task  │─────────▶│ 1. Read plan record      │
│  1. pick next ready    │          │ 2. Read task record      │
│  2. invoke executor    │          │ 3. One action:           │
│  3. wait + validate    │          │    a. discovery          │
│  4. detect stall       │◀─────────│    b. implement a step   │
│  5. repeat             │          │    c. verify + record    │
└────────────────────────┘          │ 4. Update plan + task    │
                                    │ 5. Write continuation    │
                                    │ 6. STOP                  │
                                    └──────────────────────────┘
```

Lee el plan y las tareas reales. Selecciona solo trabajo con dependencias
resueltas. Para cada tarea lee estado/revisión, confirma el alcance, ejecuta
una porción estrecha, registra la verificación autorizada y obtén revisión
antes de la aceptación. Paraleliza solo alcances disjuntos cuyas entradas
estén resueltas. En completado parcial conserva el trabajo útil e identifica
la evidencia faltante. Usa el contexto de reanudación en lugar de reejecutar
operaciones completadas a ciegas. Reporta bloqueos y para en el límite acordado.

## Cuándo usar

- Un plan aprobado contiene múltiples tareas dependientes por ejecutar, a lo
  largo de turnos, sesiones o unidades paralelas.
- El trabajo debe sobrevivir interrupciones y reanudarse desde estado duradero.

No la uses para una única tarea aislada (`contract-execution` cubre el ciclo
de vida por tarea de extremo a extremo) ni para redactar el propio plan
(`planning-and-task-breakdown`, `writing-plans`). Esta skill es dueña de la
**capa de orquestación**: scheduling, estado duradero, handoff y política de
fallos. El prompt `plan-execution` operacionaliza este bucle; las plantillas
de registro viven en `task-brief` y `session-recitation`.

## Estados de tarea

```
⬜ PENDING → ⏳ IN PROGRESS → ✅ COMPLETED
                              ❌ FAILED
                              ⬛ CANCELLED (stop condition fired)
```

El estado vive en archivos, no en el contexto. Los registros de plan y tarea
son la única fuente de verdad: lee antes de actuar, escribe después de actuar.

## Formato del registro de plan

```markdown
# Execution Plan: [name]

> **Started:** YYYY-MM-DD
> **Status:** ⏳ IN PROGRESS
> **Source:** [backlog/spec/design record]

## Summary
| DO | DEFER | SKIP | BLOCKED |
|----|-------|------|---------|
| N  | N     | N    | N       |

### Task 1: KEY — description
- **Key files:** `path`
- **Gate rationale:** why this passed triage
- **Contract:** "<verifiable command + condition>"
- **Task record:** `.scopegrain/tasks/<KEY>.md`
- **Status:** ⬜ PENDING | ⏳ IN PROGRESS | ✅ COMPLETED | ❌ FAILED
- **last-synced:** YYYY-MM-DDTHH:MM
```

Los registros de plan y tarea se referencian mutuamente y ambos llevan
`last-synced`; actualiza ambos tras cada acción. Elige la siguiente tarea a
partir de los registros actuales, no de un resumen escrito antes.

## Contratos: verificable o no programado

La semántica de contratos (vago vs verificable) es canónica en
`outcome-driven-development`. Las reglas de orquestación que se derivan: una
tarea sin contrato verificable no puede marcarse completa, y un contrato en
verde afirmado sin una ejecución registrada no es evidencia.

## Sondas de integridad (antes de cada tarea)

Antes de iniciar cualquier tarea, verifica:

- El registro de plan existe y contiene al menos una tarea abierta.
- El bloque de handoff (si está presente) se puede parsear.
- La última tarea procesada no se está repitiendo sin progreso.
- El árbol de trabajo está limpio, o los cambios pertenecen a este pipeline.
- Ninguna tarea previamente estancada queda sin resolver.

Una sonda fallida → pausa y pregunta al dueño; no fuerces el paso.

## Ciclo de ejecución (por tarea)

1. **Descubrimiento (una vez por tarea):** si no existe registro de tarea,
   crea uno: lee el código afectado, mapea llamantes/llamados/implicaciones,
   resuelve ambigüedad, descompón en pasos atómicos, escribe el contrato
   verificable. Marca estado ⏳ IN PROGRESS. Haz handoff y para.
2. **Ejecución (un paso por iteración):** lee el siguiente paso pendiente;
   ejecuta el ciclo de vida según `contract-execution` (PLAN → ACT → VERIFY,
   con rutas de diagnóstico para fallos); al pasar, actualiza registros,
   escribe el handoff, para.
3. **Cierre:** todos los pasos hechos → verificación completa del contrato →
   revisión independiente → registrar resultado → estado ✅ COMPLETED. Con
   reintentos agotados → ❌ FAILED con las reglas de tareas fallidas siguientes.

## El bloque de handoff (continuación)

Tras cada acción, escribe el bloque de continuación al final del registro de
plan: es lo único que persiste entre turnos. Quien continúe debe poder
seguir **sin preguntar al predecesor**. El bloque canónico (representación
legible, mapeo de campos en ejecución y el contrato de retorno RESULT) está
definido en `session-recitation`; no redefinas sus campos aquí.

Los invariantes, los comandos de verificación y la deuda pendiente son
obligatorios en cada handoff: son lo que lo hace transferible.

## Memoria acotada

Solo lo que el siguiente paso necesita sobrevive entre iteraciones:

| Conservar | Descartar |
|------|---------|
| Objetivos activos | Salidas de herramientas cerradas |
| Progreso del paso actual | Logs de build pasados |
| Archivos críticos modificados | Diffs completos (el control de versiones los tiene) |
| Comprobaciones que fallan ahora | Mensajes de éxito |
| El bloque de handoff | Conversación anterior |

Cuando la presión de contexto crece, aísla la investigación en un contexto
delegado según el contrato de delegación. Si una tarea produce ruido sin
progreso más allá de ~3 iteraciones, aborta: no la dejes moler.

## Ejecución paralela (olas)

Cuando existen tareas independientes (sin interdependencias, sin archivos
compartidos):

```
Wave 0: tasks with no dependencies → N parallel units
Wave 1: tasks depending on Wave 0
Wave 2: tasks depending on Wave 1
```

Limita la concurrencia baja (≤3 por ola); cada unidad ejecuta su propia
invocación aislada con su propio alcance acotado.

## Fallos y escalado

La escalera de recuperación — RESUME → RETRY fresh → STRATEGY → gate to
owner → ESCALATE — es canónica en `recovery-brief`, incluyendo el umbral
compartido (**2 fallos de verificación con el mismo error — archivo+línea+
mensaje — dispara la puerta del dueño según `decision-request` Gate V; sin
respuesta → para**), la regla de nunca rehacer pasos hechos y la contabilidad
de presupuesto por peldaño.

Reglas del contenedor de tareas fallidas específicas de esta capa:

- En ESCALATE, mueve el registro de tarea a un contenedor cerrado/fallido:
  nunca lo borres; el plan conserva la fila ❌ FAILED y el bloque de continuación.
- Reabrir una tarea fallida requiere revisión humana; se reanuda desde el
  primer paso pendiente, no desde cero.
- INCOMPLETE no es FAILED: una ejecución interrumpida casi siempre se
  resuelve con RESUME.
- Entre intentos, re-ejecuta la verificación del contrato: un estado no
  verificado no cuenta.

## Presupuestos (por defecto; la política del proyecto puede endurecerlos)

| Control | Por defecto | Comportamiento |
|---------|---------|----------|
| Iteraciones por tarea | 10 | alcanzado → FAILED |
| Subunidades | 40 | parada dura + informe parcial |
| Fallos consecutivos | 5 | modo parada |
| Llamadas de verificación por tarea | 15 | rechazar las demás |
| Duración | 120 min | expirado → FAILED |
| Fallos de verificación con el mismo error | 2 | puerta del dueño; sin respuesta → parar |

Los presupuestos de operación de sesión no miden llamadas nativas, tokens ni
dinero: acotan iteraciones y estancamientos.

## Compactación

Cada ~5 tareas completadas o ~50 iteraciones, compacta el registro de plan:
resume las iteraciones antiguas en una tabla consolidada, conserva solo el
handoff actual y los errores activos, archiva las decisiones pasadas en sus
registros de tarea, refresca `last-synced` en todas partes y anota la
compactación arriba.

## Contrato de delegación

Delega solo cuando aplica un disparador nombrado y el trabajo está resuelto:
nunca porque el contexto restante parezca grande o el número de archivos alto:

- **Mapeo/exploración**: varias búsquedas disjuntas que el padre no debería
  serializar (aproximadamente cinco o más trazas independientes).
- **Unidades disjuntas paralelas**: tareas resueltas con alcances no
  solapados y sin estado intermedio compartido.
- **Verificación independiente**: un revisor para una unidad con riesgo
  nombrado, cuyo contexto debe diferir del del autor.
- **Red de seguridad de contexto**: el padre se acerca a un presupuesto de
  contexto duro y el trabajo restante es mecánico.

Toda delegación declara: las referencias exactas de tarea/localizador (nunca
requisitos parafraseados), las superficies de edición permitidas (rutas que
el delegado puede escribir; cualquier otra está fuera de límites), el
contrato de retorno y el límite de retrabajo antes de escalar.

El delegado devuelve: trabajo completado, evidencia real producida,
desviaciones de las superficies asignadas y preguntas abiertas: no un resumen
narrativo.

El padre verifica el resultado delegado contra la *solicitud original y el
contrato de la tarea*, no contra el autoinforme del delegado. Verificar una
solicitud no es revisar al trabajador.

Un rol, nombre de agente o etiqueta de contexto nuevo no es autenticación y
no amplía la autoridad; el trabajo delegado mantiene el alcance autorizado
del padre.

## Racionalizaciones comunes

| Racionalización | Realidad |
|---|---|
| "Puedo mantener el estado del plan en contexto" | El contexto muere en la compactación y el handoff; los registros son lo único que persiste. |
| "Dos tareas en un turno ahorran tiempo" | El loteo difumina la pista de auditoría y rompe la reanudabilidad: una acción por turno es lo que sobrevive a una interrupción. |
| "Mismo reintento, una vez más" | Entradas idénticas producen fallos idénticos. Cambia la estrategia o pregunta: no mueles un bucle. |
| "Borra el registro fallido, es peso muerto" | El fallo es evidencia: qué se intentó, qué peldaños se gastaron, dónde paró. Conténlo, nunca lo borres. |
| "Un scheduler que eligió la tarea prueba la ejecución" | Programar no es ejecutar. La finalización necesita verificación registrada, no una fila seleccionada. |

## Señales de alerta

- Dos tareas ejecutadas en un turno ("una acción por turno" es la regla).
- Progreso reportado sin registro de plan y handoff actualizados.
- Una tarea marcada completa sobre una comprobación autoreportada o no registrada.
- Una tarea fallida borrada, o replanteada en silencio en lugar de contenida.
- Bucles de reintento que reejecutan acciones idénticas sin cambio de estrategia.
- Unidades paralelas compartiendo superficies de escritura o entradas no resueltas.
- Elegir la siguiente tarea desde un resumen obsoleto en lugar de los registros actuales.

## Verificación

- [ ] Los registros de plan y tarea están al día; `last-synced` refrescado
      tras cada acción
- [ ] Cada tarea seleccionada tenía dependencias resueltas según los
      registros actuales, no un orden recordado
- [ ] Se escribió un bloque de continuación tras cada acción, con
      invariantes, comandos de verificación y deuda pendiente
- [ ] Cada tarea completada lleva una ejecución de verificación registrada
- [ ] Las tareas elegibles para paralelismo tienen alcances de escritura
      disjuntos y entradas resueltas
- [ ] Los fallos siguieron la escalera de recuperación; los registros
      fallidos fueron contenidos, no borrados
- [ ] Las delegaciones llevaban localizadores exactos, superficies de
      escritura permitidas, un contrato de retorno y un límite de retrabajo
