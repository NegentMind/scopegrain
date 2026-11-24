# Primeros pasos: tutorial de punta a punta

Recorrido real por el ciclo de vida de una tarea: inspeccion, init,
contexto, creacion, transiciones, verificacion acotada, cierre y visor.
Todos los comandos se ejecutan manualmente; los verbos mutantes
previsualizan en seco y solo escriben con `--apply`.

Los ejemplos usan PowerShell desde la raiz del clon. En bash son los
mismos comandos con `node ./bin/scopegrain.mjs` (barras directas) y la
misma sintaxis de flags.

## 0. Requisitos e instalacion

Node.js 22 o posterior. El CLI no necesita dependencias instaladas;
`npm install` solo se requiere para el servidor MCP y las pruebas
(`@modelcontextprotocol/sdk`, `zod`).

```powershell
# Opcional: solo para el servidor MCP
npm install

# Sin instalacion global, desde la raiz del clon:
node .\bin\scopegrain.mjs --version
```

Para hacer `scopegrain` disponible en PATH: `npm link` (ver
[onboarding](onboarding.md)).

## 1. Inspeccionar el proyecto (solo lectura)

```powershell
node .\bin\scopegrain.mjs inspect --project .
```

Devuelve un JSON con stacks detectados por manifiestos, evidencia y
comandos propuestos con `approved:false`. No escribe ni ejecuta nada.

## 2. Inicializar

```powershell
# Interactivo (asistente bilingue, la primera pregunta es el idioma):
node .\bin\scopegrain.mjs init --project .

# O no interactivo con los defaults y las sugerencias de investigate:
node .\bin\scopegrain.mjs init --project . --defaults --apply
```

- Interactivo, `init` muestra el plan de archivos completo y pide
  confirmacion (defecto `no`); responder `no` aborta sin escrituras.
- `--defaults` es la via no interactiva: el flag ES el consentimiento de
  las respuestas, y `--apply` sigue siendo el gate de escritura.
- Sin `--apply`, `init` solo presenta la vista previa (dry-run).
- La configuracion queda en `.scopegrain/config.json` (metodologia
  propuesta: `organic-sdd`).

Comprobar el estado:

```powershell
node .\bin\scopegrain.mjs doctor --project .
```

## 3. Paquete de contexto de sesion

```powershell
node .\bin\scopegrain.mjs context --project .
```

Solo lectura: devuelve instrucciones, config, `locale`, el archivo de
conocimiento del propietario `.scopegrain/context.md`, resumen de
tareas, metas abiertas, sesiones reanudables y eventos pendientes del
journal. Es el punto de entrada de cada sesion de agente.

## 4. Crear la primera tarea

Crear `task.json` (en `organic-sdd`, la evaluacion `methodology` es
obligatoria salvo que se aporte el par formal `specId`+`designId`):

```json
{
  "title": "Documentar el flujo de verificacion",
  "contract": "La guia describe el ciclo PLAN a CLOSE con comandos reales",
  "authorContext": "getting-started",
  "scope": ["docs/getting-started.md"],
  "methodology": {
    "schemaVersion": 1,
    "request": "Documentar el flujo de verificacion",
    "intent": "change",
    "authorization": {
      "status": "authorized",
      "actor": "owner",
      "reference": "getting-started"
    },
    "understanding": "sufficient",
    "uncertainty": "resolved",
    "risk": "contained",
    "riskCategories": [],
    "continuity": "diff-sufficient",
    "evidence": ["docs/getting-started.md"],
    "preferredRoute": "auto"
  }
}
```

```powershell
# Vista previa (dry-run), luego persistir:
node .\bin\scopegrain.mjs task create --project . --input task.json
node .\bin\scopegrain.mjs task create --project . --input task.json --apply
```

El resultado `--apply` devuelve el `id` (UUID) de la tarea en estado
`PLAN`, revision 0. Consultarla:

```powershell
node .\bin\scopegrain.mjs task list --project .
node .\bin\scopegrain.mjs task show --project . <UUID>
```

En modo `manual` tambien existe la forma de flags
`--title/--contract/--author [--scope]`; bajo `organic-sdd` o `sdd`
sin el par formal, esas flags solas fallan con `METHODOLOGY_REQUIRED`.

## 5. Comprobar una accion antes de actuar

```powershell
node .\bin\scopegrain.mjs task check-action --project . <UUID> edit
node .\bin\scopegrain.mjs task gate --project . <UUID> edit
```

`check-action` reporta si la accion esta permitida en el estado actual;
`gate` es el endpoint de decision para hooks de host con contrato de
salida `0` permitir / `2` denegar / `3` requiere-gate / `1` error.

## 6. Ciclo de transiciones (CAS con `--revision`)

La progresion habitual es
`PLAN -> ACT -> VERIFY -> [COLLATERAL] -> EVALUATE -> REVIEW -> ACCEPT -> CLOSE`.
Cada transicion exige la revision esperada del registro; un desajuste
devuelve `REVISION_MISMATCH`. Como todo verbo mutante, cada transicion
previsualiza en seco y escribe con `--apply`.

```powershell
node .\bin\scopegrain.mjs task transition --project . <UUID> ACT --revision 0 --apply      # -> rev 1
node .\bin\scopegrain.mjs task transition --project . <UUID> VERIFY --revision 1 --apply   # -> rev 2
node .\bin\scopegrain.mjs task transition --project . <UUID> EVALUATE --revision 2 --apply # -> rev 3
node .\bin\scopegrain.mjs task transition --project . <UUID> REVIEW --revision 3 --apply   # -> rev 4
```

`ACCEPT` exige evidencia: un archivo JSON con `verification` (checks no
vacios con `command`, `cwd`, `status:"pass"` y `evidence`) y `review`
(veredicto `approve`, modo `fresh` o `waived`):

```json
{
  "verification": {
    "checks": [
      {"command": "node --check src/ejemplo.mjs", "cwd": ".",
       "status": "pass", "evidence": "salida capturada por el operador"}
    ]
  },
  "review": {
    "mode": "waived", "owner": "owner",
    "reference": "getting-started", "reason": "cambio de documentacion",
    "verdict": "approve"
  }
}
```

```powershell
node .\bin\scopegrain.mjs task transition --project . <UUID> ACCEPT --revision 4 --evidence evidence.json --apply  # -> rev 5
node .\bin\scopegrain.mjs task transition --project . <UUID> CLOSE --revision 5 --apply                            # -> rev 6, terminal
```

`STALL`, `RESEARCH` y `ABANDON` son desvios previstos; volver a `ACT`
invalida la verification y la review almacenadas. Las aristas exactas
estan en [flujo de tareas](task-workflow.md) y `policy/workflow.json`.
`task doc --project . <UUID>` renderiza el documento legible de la
tarea.

## 7. Verificacion acotada de comandos

`verify` ejecuta solo comandos aprobados como argv literal (nunca
shell):

```powershell
# Registrar un comando (vista previa, luego --apply):
node .\bin\scopegrain.mjs verify add --project . --command "node --version" --apply

# Ver el registro (cada comando tiene un ID):
node .\bin\scopegrain.mjs verify list --project .

# Aprobarlo y ejecutarlo:
node .\bin\scopegrain.mjs verify approve <ID> --project . --apply
node .\bin\scopegrain.mjs verify run <ID> --project .
```

`verify discover --project .` infiere candidatos desde los manifiestos
reales del proyecto (nunca los ejecuta sin aprobacion).

## 8. Visor de solo lectura

```powershell
node .\bin\scopegrain.mjs view --project .
```

Dashboard web local (15 vistas, ES/EN) sobre loopback: tareas, planes
DAG, sesiones, aprobaciones, journal y salud del sistema. No muta
estado; las mutaciones pasan por la CLI o las tools MCP.

## 9. Siguientes lecturas

- [Flujo de tareas y evidencias](task-workflow.md) — aristas, CAS,
  formato de evidencia y disposiciones.
- [Onboarding y personalizacion](onboarding.md) — respuestas,
  metodologias, rutas y versionado.
- [Distribucion declarativa](distribution.md) — bundles, extensiones y
  presets (`dist`).
- [Informe del sistema](system-report.md) — limites, seguridad y
  estado de verificacion.
