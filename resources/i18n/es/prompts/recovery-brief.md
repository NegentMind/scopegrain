---
name: recovery-brief
description: Reanudar desde evidencia preservada sin repetir efectos inciertos, y recuperar resultados de delegados a través de una escalera fija.
---
# Recovery Brief

Dos usos: (a) reanudar una tarea/sesión desde evidencia preservada;
(b) recuperar un delegado (subagente, contexto worker, proceso lanzado) que
devolvió un resultado incompleto, fallido, detenido, vacío o inesperado.
Cargado por el orquestador ante cualquier resultado de delegado no-DONE
(`coordinate-plan`, `plan-execution`) y al reanudar trabajo interrumpido
(`plan-recovery`). Objetivo en ambos: **no perder trabajo ya hecho**.
Reutilizar la misma sesión de delegado cuando sea posible; subir la
escalera de recuperación antes de declarar fallo.

## Slots requeridos

Slots requeridos: identidad del proyecto/workspace; últimas revisiones
válidas; contrato aprobado y digests de recursos; acciones
completadas/en-vuelo/incierta; recibos/logs; locks/procesos actuales;
presupuesto restante; siguiente comprobación segura.

Distinguir reconstrucción de contexto, restauración de recursos y
reconexión MCP. Validar el estado actual antes de continuar. Reutilizar
trabajo válido y procesos vivos; no reiniciar ni recomputar solo porque la
conversación se interrumpió. Nunca inferir que un lock viejo está
abandonado o que un efecto externo no ocurrió. Preservar archivos en
conflicto y preguntar antes de reemplazar o activar. Evidencia faltante
significa bloqueado/desconocido, no un estado exitoso vacío.

## 1 — Clasificar el resultado del delegado

Todo delegado debe devolver el bloque RESULT estructurado (canónico en
`session-recitation`; consumido según §4). Si está ausente, clasificar por
evidencia observable (salida, log de commits, registro de tarea,
worktree):

| Evidencia observable | Clase | Significado |
|---|---|---|
| `RESULT: COMPLETE` + commit + verify del contrato pasa | DONE | Persistir estado, reportar, seguir |
| `INCOMPLETE` (pasos hechos < total, sin commit) | INCOMPLETE | Existe trabajo parcial; reanudar en el siguiente paso pendiente |
| Salida vacía / autodetenido / "necesito X" / no-respuesta | UNEXPECTED | Reinvocar pidiendo el bloque estructurado + feedback |
| `FAILED` (verify falla tras su escalera interna de reintentos) | FAILED | Cambiar estrategia o escalar |
| `MALFORMED` (sin bloque RESULT parseable, o línea de puertas faltante/sin razones) | UNEXPECTED | Igual que UNEXPECTED |

**Regla de oro:** nunca tratar INCOMPLETE/UNEXPECTED como FAILED. Casi
siempre se recupera reanudando la MISMA sesión — el worktree y el registro
de tarea ya contienen el trabajo. FAILED real es solo cuando el propio
delegado reporta su escalera de reintentos agotada.

## 2 — Escalera de recuperación (una vez por resultado no-DONE)

```
Rung 1  RESUME — same delegate session
        Re-invoke the same context with processed feedback: what was done
        (from the context save point / commit log), the next PENDING step
        from the task record, and a reminder to return the RESULT block.
        Never re-execute steps already done — continue from the first
        pending step.

Rung 2  RETRY — fresh context, same role
        New delegate of the same role with a ~200-token digest of what was
        learned + the task record location + processed feedback. Starts
        from durable state (task record + worktree), not from zero.

Rung 3  STRATEGY — materially different approach
        Another solution angle (may escalate model/strategy tier per the
        harness's declared capability). If the task is ambiguous, fork a
        read-only research delegate first (`research-brief`).

Rung 4  ESCALATE — to the owner
        Document all four rungs attempted, commit WIP if changes exist,
        record the task as failed through the harness task runtime, apply
        the declared failure policy (stop/skip), move the record to its
        closed disposition. stop-policy halts the pipeline.
```

## 3 — Reglas del protocolo

1. **INCOMPLETE/UNEXPECTED → 1 RESUME; si aún no DONE → RETRY.** Rara vez
   llega a ESCALATE.
2. **FAILED → Gate V (`decision-request`) → RETRY(1) → STRATEGY →
   ESCALATE.** Dos fallos de verify con el MISMO error
   (archivo+línea+mensaje) son FAILED real; preguntar al propietario antes
   de marcarlo — no gastar un RESUME en eso.
3. **Preservación total del trabajo:**
   - El estado durable vive en el registro de tarea (pasos
     hechos/pendientes, punto de guardado de contexto) más el registro de
     plan vía el runtime de tareas del harness.
   - Antes de cada intento, comprobar si el delegado escribió su punto de
     guardado de contexto; si no, RESUME para reconstruir la posición
     desde el diff/log de commits y el registro.
   - Nunca `checkout`/`reset --hard` sobre el trabajo de un delegado.
     Solo los commits atómicos de la propia tarea.
4. **Verify mecánico entre intentos:** antes de aceptar un RESUME/RETRY
   como DONE, ejecutar la comprobación de contrato de la tarea (operación
   de verificación registrada, o proponer el comando al propietario bajo
   verificación manual). Sin verify → no completado.
5. **Presupuestos:** cada recuperación consume el presupuesto de
   fallo/recuperación declarado. Agotado → ESCALATE sin más intentos.
   **Escape de presupuesto (no es un fallo de tarea):** si el runtime
   reporta `budget exceeded` en un verify, reiniciar el contador con la
   razón registrada en el registro de continuación y reintentar el verify
   — no contarlo como intento fallido ni como stall.
6. **Anti-stall:** 2 recuperaciones consecutivas en el mismo peldaño sin
   progreso → subir un peldaño. 3 resultados no-DONE consecutivos en la
   misma tarea → pausar y preguntar al propietario (límite de
   sin-progreso).
7. **Traza de recuperación (obligatoria):** registrar el peldaño alcanzado
   y el resultado (`DONE|INCOMPLETE|UNEXPECTED|FAILED` + razón) en el
   registro de sesión/tarea a través del runtime. Sin esta entrada el
   bucle de aprendizaje del protocolo queda incompleto.

## 4 — Contrato de retorno (qué debe devolver todo delegado)

El bloque RESULT parseable es canónico en `session-recitation` — los
delegados lo devuelven verbatim al final de cada invocación; esta sección
establece cómo lo consume el orquestador.

Con este bloque el orquestador elige el peldaño en un paso, sin adivinar.
Un delegado que se detiene silenciosamente sin el bloque es UNEXPECTED →
RESUME pidiendo el bloque + feedback.

**Validación de GATES_EVALUATED:** las reglas de validación son canónicas
en `decision-request` §registro obligatorio de evaluación de puertas.
Aplicadas aquí: ausente/incompleto → clasificar UNEXPECTED (no DONE) →
peldaño 1 RESUME pidiendo solo ese campo. Evaluar las puertas forma parte
del contrato, no es una cortesía.

## 5 — Checkpoint humano antes de empezar

La escalera de §2 recupera trabajo ya hecho; este checkpoint actúa ANTES
de ejecutar una tarea, para que los intentos no se gasten en direcciones
que el propietario nunca autorizó.

**Regla:** toda tarea de prioridad crítica, o con un contrato ambiguo (≥2
interpretaciones válidas que cambian el resultado esperado), requiere
confirmación humana ANTES del primer paso de ejecución.

**Excepción — familia de ejecución aprobada:** la confirmación individual
no se necesita cuando la tarea pertenece a una familia ya aprobada por el
propietario — el plan pasó su puerta de triage (`do`) o el propietario
lanzó la ejecución, dentro de esta sesión, para el mismo objetivo.

**Límite de la excepción:** canónico en `decision-request` §Anti-abuse —
una familia aprobada suprime la confirmación individual SOLO para tareas
de fix/test/docs/refactor sin nueva superficie pública; las tareas
feature-add o de nuevos símbolos públicos aún disparan UNA ronda de
decisión empaquetada con las decisiones abiertas de spec antes del primer
ACT.

**Activación:** (1) pre-flight — al recoger una tarea crítica/ambigua
pendiente antes de la primera llamada de ejecución; (2) a mitad de
ejecución — el delegado descubre una ambigüedad material que el contrato
no preveía → parar y escalar.

**Procedimiento — parar → preguntar → continuar:**
1. STOP — no lanzar pasos nuevos; preservar el trabajo hecho (registro de
   tarea / worktree).
2. ASK vía la interfaz de preguntas nativa (o reporte estructurado si no
   hay): id de tarea, prioridad/ambigüedad, opciones, solicitar GO /
   ajustar / NO-GO.
3. CONTINUE según la respuesta: GO → ejecutar, registrar la confirmación;
   ajustar → aplicar feedback (equivalente a RESUME con feedback
   procesado); NO-GO → registrar failed + política de fallo — no consumir
   la escalera de §2 (no hubo intento de ejecución real).
