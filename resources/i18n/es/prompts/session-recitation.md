---
name: session-recitation
description: Bloque canónico de continuación/handoff — render legible, mapeo de campos del runtime y el bloque RESULT parseable.
---
# Session Recitation

Formato canónico único para el registro de continuación que permite al
SIGUIENTE contexto reanudar sin preguntar al anterior. Los prompts del
pipeline referencian este archivo; nunca lo redefinen. Cargado tras cada
acción, fin de invocación y cierre de tarea — el bloque RESULT siguiente es
el contrato de retorno parseable que todo delegado debe emitir. Dos renders
del mismo contenido: un bloque legible por humanos persistido en registros
de plan/tarea, y el mapeo de campos para la operación de actualización de
estado del runtime de tareas del harness.

## Render legible (registro de plan / registro de tarea)

```
=== CONTINUATION ===
Active goal: TASK-N — <id>
State: PLAN | ACT | VERIFY | COLLATERAL | RESEARCH | EVALUATE | REVIEW | ACCEPT | CLOSE | STALL | ABANDON
Last action: what was just done
Result: pass | fail
Previous state: <state it came from>
Next action: concrete step (file + command)
Contract: exact verification command + result
Invariants: what must NOT be broken when continuing (or "none")
Verification commands: exact command + expected/obtained result
Debt: what remains incomplete at this iteration's close (or "none")
Next task if this completes: TASK-N+1 — <id>
Last-synced: YYYY-MM-DDTHH:MM
=== END CONTINUATION ===
```

## Mapeo de campos del runtime

| Campo del runtime | ← fuente del bloque legible |
|---|---|
| `activeGoal` | Active goal |
| `lastAction` | Last action (≈ resumen, máx. ~200 tokens) |
| `result` | `OK` ↔ completada · `PARTIAL` ↔ en curso con pasos pendientes · `FAILED` ↔ fallida |
| `nextAction` | Next action (archivo + comando) |
| `contract` | Contract + verification + evidencia por afirmación (`claim / evidence / confidence`) + rutas de artefactos persistidos + invariants + debt + pending-for-orchestrator |
| `nextTask` | Next task if this completes |

Las salidas grandes se persisten como rutas de artefacto, no se incrustan
en el mensaje.

## Bloque RESULT (parseable por el orquestador)

El contrato de retorno por invocación (obligatorio al final de cada
delegado o iteración):

```
RESULT: COMPLETE | INCOMPLETE | FAILED | MALFORMED
STEPS_OK: <n>/<M> total steps
NEXT_STEP: <next pending step, or "none">
COMMIT_HASH: <hash or "none">
FILES: <paths touched>
CONTRACT_VERIFY: pass | not-run | fail
BLOCKER: none | <what prevented finishing>
GATES_EVALUATED: P:<no|fired> D:<no|fired> V:<no|fired> C:<no|fired> | <reason ≤6 words per gate>
SKILLS_LOADED: <loaded skills, or "base-only, no additional candidates">
```

`MALFORMED` = bloque ausente, o una línea `GATES_EVALUATED` faltante / sin
razón por puerta. Mapeo al campo `result` del runtime: COMPLETE↔OK,
INCOMPLETE↔PARTIAL, FAILED↔FAILED, MALFORMED↔sin estado válido.

Al cerrar una tarea (`result: OK`), la puerta de aceptación del runtime
requiere además el payload `review`: `fresh` — contexto revisor ≠ contexto
autor + veredicto `approve`; o `degraded` + renuncia del propietario
`{owner, reference, reason}` registrada en decisions/trace. Sin ello la
escritura de finalización se rechaza; el payload en sí se valida, no se
persiste en el bloque del plan — solo la referencia de renuncia registrada
queda en trace/decisions.
