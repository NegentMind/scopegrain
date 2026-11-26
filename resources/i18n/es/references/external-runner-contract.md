# Contrato de runner externo

El plugin legacy `opencode-loop` incrustaba el driver del plan: reinyectaba
el prompt de iteración por tarea hasta que la campaña terminaba. Scopegrain
no tiene un bucle embebido — la continuidad de ejecución es una
**responsabilidad del host**. Este documento es el protocolo canónico que un
scheduler externo debe honrar para ejecutar un plan de forma reanudable sin
ningún bucle dentro del harness.

Cualquier scheduler que satisfaga este contrato funciona: una sesión
programada de Devin, un job cron, un trigger de CI, un turno de chat — el
mecanismo es elección del host. El contrato es deliberadamente agnóstico al
scheduler.

## El bucle del runner

Una iteración = un turno del scheduler del host. Repetir hasta una condición
terminal (§Estados terminales).

```
plan next KEY                → miembros listos (consciente del triage)
      ↓ elegir una tarea lista
claim                        → transición atómica de tarea PLAN→ACT (CAS
                               sobre --revision); una tarea reclamada no
                               puede ser iniciada dos veces por un segundo
                               runner
      ↓
brief                        → ensamblar el paquete del miembro según
                               prompts/plan-execution.md Parte B
                               (los diez bloques obligatorios)
      ↓ ejecutar la tarea
bloque RESULT                → evidencia de verificación/revisión y el
                               resultado, registrados mediante la
                               transición de tarea --evidence
      ↓
plan run KEY --apply         → checkpoint añadido en
                               <state>/plan-runs/<KEY>.json
      ↓ repetir
```

`plan next` es consciente del triage: los miembros triados
`defer|skip|blocked` reportan `triaged`, no `ready` — un runner nunca los
despacha.

## Checkpoints y reanudación

`plan run KEY` (dry-run) y `planRunState` exponen la misma vista de
reanudación: miembros cerrados, miembros restantes, siguiente ola, porcentaje
de finalización y `completedSinceLastCheckpoint` respecto al último checkpoint
persistido. `plan run KEY --apply` persiste un registro de checkpoint
acotado (`schemaVersion:1`, las últimas `MAX_PLAN_RUN_CHECKPOINTS` entradas)
bajo un bloqueo verificado — ese archivo ES el estado reanudable. Un
scheduler nuevo lo lee en lugar de reconstruir el progreso.

## Estados terminales

Detener el bucle cuando se cumpla cualquiera de estas condiciones:

- `resume.complete` — no quedan miembros listos, restantes ni no
  programados.
- `plan status KEY` deriva un estado terminal/completo; `plan conclude
  KEY` registra el cierre terminal.
- El interruptor de corte: `hooks halt` — un runner debe comprobar el
  estado de halt en cada iteración y detenerse independientemente del
  trabajo restante.
- Stall: las iteraciones fallidas consecutivas sobre el mismo miembro
  alcanzan el umbral de stall → el runner se detiene y pregunta al
  propietario (Gate V según `prompts/decision-request`); nunca mantiene en
  bucle a un miembro atascado silenciosamente.

## Política de fallos

`FAIL_MODE` (stop | skip | parallel) se declara por ejecución, no por el
harness. `stop`: detenerse en el primer fallo. `skip`: registrar el fallo y
continuar con los miembros independientes. `parallel`: ejecución por olas de
miembros mutuamente independientes (`waves[].parallel` en el registro de
ejecución). Un fallo de miembro se registra como evidencia en la tarea,
nunca como un reintento silencioso.

## Matiz de enforcement (explícito, no un bug)

Las puertas son **advisory**: `actionHooks.applied`/`require-gate` y los
valores por defecto de presupuesto solo se activan cuando el host invoca
`check_action` antes de actuar. Un scheduler que nunca llama a
`check_action` no encuentra resistencia mecánica — la garantía honesta del
contrato es la auditabilidad de lo que se registró, no el bloqueo de lo que
se intentó. Los runners DEBERÍAN invocar `check_action` en cada paso que
produzca una mutación y honrar `hooks halt`.

## Fronteras de honestidad

- El harness nunca ejecuta comandos del proyecto
  (`executesProjectCommands:false`): los runners proponen comandos de
  verificación; el propietario o el host los ejecuta y el resultado queda
  como evidencia registrada (`verification.checks[]`), declarada no
  autenticada (`authenticatesEvidence:false`).
- Los reclamos son escrituras CAS bajo el bloqueo verificado — dos
  schedulers sobre el mismo plan colisionan explícitamente, nunca
  silenciosamente.
- Los campos `budget` (registro `budget`, `budgetDefaults`) solo contabilizan
  operaciones registradas; un runner no puede presupuestar llamadas a
  herramientas nativas que no ve.

## Mapeo sugerido de schedulers

| Mecanismo del host | Driver del bucle |
|---|---|
| Sesión de chat | Cada turno de usuario/agente = una iteración; leer primero el checkpoint |
| Sesión programada / recordatorio | El tick de cron lee `plan run` y despacha una iteración |
| Trigger de CI | El job ejecuta una iteración o agota el trabajo hasta un estado terminal |

El host es responsable de la programación, el fan-out y el enrutado de
modelos; el harness es responsable de los registros, los reclamos CAS, los
checkpoints y la evaluación de puertas.
