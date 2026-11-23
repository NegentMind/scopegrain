---
name: intake
description: Clasifica cada solicitud del usuario en no-registro, captura, tarea o plan según el intake.mode del proyecto.
---
# Intake

Enrutamiento de prompt a registro. Este comando se activa solo cuando
el `intake.mode` del proyecto no es `off`. Lee el modo del campo
`intake.mode` del paquete de inicio de sesión (`scopegrain context` o
la herramienta MCP `scopegrain_context`); si el campo está ausente o es
`off`, detente — no registres solicitudes implícitamente.

Carga `clarify-intent`, `organic-driven-development` y
`planning-and-task-breakdown` para la clasificación; una solicitud
ambigua se pregunta, no se adivina (`prompts/decision-request`).
Semántica de registros de tareas: `references/task-domain`. Reglas
rectoras: `rules/workflow`, `rules/methodology`,
`rules/human-decisions`. Rol: `lead`.

## Paso 1 — Clasificar la solicitud

Para cada solicitud del usuario, clasifica una vez, antes de actuar:

| Solicitud | Registro |
|---------|--------|
| Pregunta pura, explicación, revisión, inspección de solo lectura | **None** — responde directamente. No registres preguntas. |
| Un cambio de implementación acotado (un solo asunto, ámbito identificable) | **Task** — una entrada `task create` |
| Solicitud multiparte o ambiciosa (varios entregables, fases o un DAG) | **Plan** — una entrada `plan create` con aristas `dependsOn` |
| Ámbito ambiguo o autorización poco clara | **Ask first** — nunca adivines una tarea dentro del backlog |

Ante la duda entre «task» y «plan»: prefiere una task. Un plan con una
sola tarea es ceremonia; una tarea que luego genera un plan es
evolución honesta.

## Paso 2 — Aplicar el modo configurado

| Modo | Comportamiento |
|---|---|
| `off` | Nada de este comando aplica. |
| `capture` | Además, persiste una nota `capture create` registrando la solicitud de ingeniería (categoría `event`). Las capturas son una bandeja de entrada, no un compromiso; el humano decide si promoverlas. |
| `suggest` | Redacta el JSON de entrada `task create` / `plan create` y muéstralo con el comando exacto. Aplica solo tras aprobación explícita. |
| `auto` | Ejecuta el comando `create` con `--apply` para persistir el registro. Esto registra solo contabilidad. |

## Límite de autoridad (invariante)

Una tarea o plan persistido en estado `PLAN` es un **registro de
intención, no una licencia para implementar**. Independientemente del
modo — incluido `auto` — las puertas normales siguen aplicando: las
transiciones siguen el ciclo de vida, `VERIFY`/`REVIEW`/`ACCEPT`
requieren su evidencia, y el acceso a red, las instalaciones, las
acciones destructivas y la publicación siguen necesitando autorización
explícita. `auto` automatiza la clasificación y la creación del
registro; nunca automatiza la implementación ni la aprobación.

## Paso 3 — Plantillas de entrada

Persiste los registros a través del CLI (las escrituras se mantienen
fuera del límite MCP). Todos los comandos create hacen dry-run por
defecto; `--apply` escribe.

### Task (metodología manual)

```json
{
  "title": "<imperative title>",
  "contract": "<what done means, one paragraph>",
  "authorContext": "<host>-session-<date>",
  "scope": ["<paths the change may touch>"],
  "backlog": "<domain>",
  "priority": "p2"
}
```

### Task (metodología organic-sdd)

Mismos campos más la evaluación light; `methodology` sustituye al par
formal spec/design. La evaluación debe ser honesta — `risk: "named"` o
la clasificación `sdd` enruta de vuelta al trabajo formal.

```json
{
  "title": "<imperative title>",
  "contract": "<what done means>",
  "authorContext": "<host>-session-<date>",
  "scope": ["<paths>"],
  "methodology": {
    "schemaVersion": 1,
    "request": "<the user's request verbatim or faithfully compressed>",
    "intent": "change",
    "authorization": { "status": "authorized",
      "actor": "owner", "reference": "<decision or session>" },
    "understanding": "sufficient",
    "uncertainty": "resolved",
    "risk": "contained",
    "riskCategories": [],
    "continuity": "diff-sufficient",
    "evidence": ["<what grounds the classification>"],
    "preferredRoute": "auto"
  }
}
```

### Plan (DAG multitarea)

Cada entrada de tarea porta su propia evaluación `methodology` (ruta
light por tarea en organic-sdd) más aristas `dependsOn` por clave de
tarea. Los planes formales, en cambio, portan `specId` + `designId` en
el nivel superior.

```json
{
  "key": "<plan-key>",
  "title": "<plan title>",
  "authorContext": "<host>-session-<date>",
  "triage": {}, "appetite": null, "cynefin": null,
  "riskRegister": null, "premortem": null,
  "stopConditions": null, "budget": null,
  "tasks": [
    { "key": "<task-key>", "title": "...", "contract": "...",
      "scope": ["<paths>"], "dependsOn": [],
      "methodology": { "...": "same assessment shape as a task" } }
  ]
}
```

### Capture (modo `capture`, o registro de bandeja de baja implicación)

```json
{
  "category": "event",
  "title": "Intake: <request title>",
  "summary": "<what the user asked and how it was classified>",
  "areaIds": ["<workspace-area-key>"],
  "basis": "declared"
}
```

## Paso 4 — Persistir

```sh
scopegrain task create   --project . --input <file>.json --apply
scopegrain plan create   --project . --input <file>.plan.json --apply
scopegrain capture create --project . --input <file>.json --apply
```

## Contrato de salida

- Una decisión de clasificación por solicitud — reclasifica solo cuando
  la propia respuesta del usuario cambia la forma de la solicitud.
- Borradores de intake bajo las rutas de estado del proyecto
  (`.scopegrain/drafts/`), nunca en documentación del producto.
- Registros persistidos solo en estado `PLAN`; el modo `suggest` no
  persiste nada sin aprobación.

## Señales de alarma

- Registrar una pregunta pura como trabajo.
- Una tarea adivinada escrita en el backlog sobre ámbito ambiguo.
- `auto` tratado como licencia para implementar — la clasificación es
  contabilidad, no autorización.
- Una evaluación `methodology` inflada usada para mantener trabajo de
  riesgo nombrado en la ruta light — `risk: "named"` o `sdd` enruta de
  vuelta al trabajo formal.

## Entrega

Las tareas y planes persistidos permanecen en `PLAN`; `implement-task`
o `coordinate-plan` los recogen bajo sus propias puertas.
