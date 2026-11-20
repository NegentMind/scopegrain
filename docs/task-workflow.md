# Flujo de tareas y evidencias

Descripcion factual de los comandos de tarea, la progresion de revision y el
formato de evidencias segun `policy/workflow.json` y
`docs/implementation.md`. Los ejemplos son sinteticos: no son resultados de
ejecucion.

## Compatibilidad y metodologia

Los ejemplos historicos de esta pagina usan tareas V1 en modo `manual`.
En `organic-sdd` o `sdd`, una creacion sin los metadatos requeridos no
representa una tarea autorizada. La guia [Organic y SDD](methodology.md)
describe registros ligeros, especificaciones/design V2, aprobaciones,
escenarios e informes vinculados.

ACT y ACCEPT conservan las aristas del workflow y agregan los gates del
modo/registro. Una consulta metodologica permitida no autoriza por si sola
una transicion ni herramientas nativas. Revocar consentimiento puede quitar
`edit` de una tarea que ya estaba en ACT.

## Estados y transiciones

La maquina de estados canonica esta en `policy/workflow.json`:

```text
PLAN -> ACT | RESEARCH | STALL
ACT -> VERIFY | STALL
VERIFY -> COLLATERAL | EVALUATE | ACT | STALL
COLLATERAL -> RESEARCH | ACT | EVALUATE | STALL
RESEARCH -> PLAN | ACT | STALL
EVALUATE -> REVIEW | ACT | STALL
REVIEW -> ACCEPT | ACT | STALL
ACCEPT -> CLOSE | ACT | STALL
STALL -> PLAN
CLOSE -> (terminal)
```

Existe una excepcion que no es arista de la politica: `REVIEW -> REVIEW`
se admite en codigo exclusivamente como adjunto de evidencia. Permite
acumular `verification` y/o `review` mientras la tarea esta aparcada en
REVIEW, sin el rodeo via ACT que vaciaria la evidencia almacenada. El
estado queda en REVIEW y la revision avanza como en toda transicion CAS.
Un `REVIEW -> REVIEW` sin evidencia se rechaza (`INVALID_TRANSITION`):
una auto-transicion vacia solo agregaria ruido al historial. Los
auto-bucles de cualquier otro estado siguen siendo invalidos.

Acciones permitidas por estado (tambien en la politica): `read` en todos;
`research` en PLAN/COLLATERAL/RESEARCH; `propose` en PLAN/ACT/VERIFY/
COLLATERAL/RESEARCH; `edit` solo en ACT; `verify` en VERIFY; `evaluate` en
EVALUATE; `review` en REVIEW.

## Comandos CLI

```powershell
# Crear (estado PLAN, revision 0, UUID propio): via --input JSON con
# vista previa por defecto; --apply persiste
node .\bin\tasksystem.mjs task create --project P --input task.json [--apply]
```

`task.json` lleva `{title, contract, authorContext, scope}` mas los
metadatos del modo: una evaluacion `methodology` en `organic-sdd`
(`schemas/organic-assessment.schema.json`) o el par `specId`+`designId`.
La forma de flags `--title/--contract/--author [--scope] [--spec --design
--plan]` solo sigue disponible en proyectos con `methodology: "manual"`,
donde crea la tarea V1 directamente; bajo `organic-sdd` o `sdd` sin el
par formal falla con `METHODOLOGY_REQUIRED` apuntando a `--input`.

```powershell
# Listar / mostrar
node .\bin\tasksystem.mjs task list --project P
node .\bin\tasksystem.mjs task show --project P <UUID>

# Transicionar (CAS obligatorio con --revision N)
node .\bin\tasksystem.mjs task transition --project P <UUID> ACT --revision 0
node .\bin\tasksystem.mjs task transition --project P <UUID> VERIFY --revision 1 [--evidence evidence.json]

# Comprobar una accion en el estado actual
node .\bin\tasksystem.mjs task check-action --project P <UUID> edit
```

`--config` apunta a una config alternativa en cualquiera de ellos.
`--evidence` solo acepta las claves `verification` y/o `review`.

## Capa semantica (schemaVersion 3)

El registro de tarea admite una capa semantica opcional — backlog nombrado,
disposicion, prioridad, severidad, tipo, esfuerzo, estimacion, origen,
dependencias (`dependsOn`), relaciones tipadas, enlaces a metas
(`goalIds`), analisis profundo (`analysis`), pasos (`steps`), notas
(`notes`), skills ejercidas e `uncertainty` (uphill/downhill). Es ortogonal
al ciclo de vida: nunca cambia `state` ni toca evidencia. Cualquier campo
semantico en la creacion, o cualquier escritura `meta`, sube el registro a
`schemaVersion: 3` (los V2 conservan su bundle de metodologia; los V1 lo
nulan). Tabla completa de campos: `resources/references/backlog-format.md`.

```powershell
# Parche de metadata (CAS con --revision N): {set:{...}, disposition?,
# addNote?, stepStatus?} en el fichero --input
node .\bin\tasksystem.mjs task meta --project P <UUID> --revision 2 --input meta.json

# Disposicion (atalajo): deferred|icebox|future|discarded|cancelled;
# 'active' limpia la disposicion
node .\bin\tasksystem.mjs task disposition --project P <UUID> deferred --revision 2 --reason "waiting on owner" --by agent

# Nota y estado de paso
node .\bin\tasksystem.mjs task note --project P <UUID> --revision 3 --text "root cause confirmed"
node .\bin\tasksystem.mjs task step --project P <UUID> --revision 4 --index 0 --status done

# Listar por backlog nombrado (sin filtro = todos)
node .\bin\tasksystem.mjs task list --project P --backlog futuro

# Documento legible de la tarea (Markdown renderizado desde el registro)
node .\bin\tasksystem.mjs task doc --project P <UUID>
```

`task doc` escribe `.scopegrain/tasks/<uuid>.md` (o el destino configurado
en `paths.tasks`): front matter con id, estado, revision y timestamps, y
secciones para contrato, scope, metodologia, dependencias, pasos,
verificacion, revision, notas e historia. Es idempotente — una segunda
ejecucion sin cambios reporta `changed: false` y no reescribe el archivo.

## Contexto de sesion

```powershell
# Paquete de arranque de sesion (solo lectura)
node .\bin\tasksystem.mjs context --project P [--tail N]
```

`context` devuelve un paquete JSON acotado (`schemaVersion: 1`) con las
rutas de instrucciones y config, el archivo de conocimiento del usuario
`.scopegrain/context.md` (si existe; leido, nunca escrito — contenido
limitado a 32 KiB), resumen de tareas (totales, abiertas por estado y la
lista `ready`: tareas en PLAN sin disposicion), metas abiertas, ultimas
entradas de `progress`, hasta 3 sesiones reanudables y el conteo de
eventos pendientes del journal. Los hosts lo invocan al inicio de sesion
segun la instruccion generada en AGENTS.md/CLAUDE.md y
`.scopegrain/instructions.md`; nunca ejecuta comandos ni modifica estado.

## Memoria operativa, metas y metricas

Logs JSONL acotados y append-only bajo `paths.memory`
(`.tasksystem/memory/`): `lessons` (aprendizajes), `outcomes` (resultado
ok/fail por skills usadas), `progress` (archivo de avance — se escribe
solo al alcanzar CLOSE), `goals` (metas/objetivos generales; tasks enlazan
via `goalIds`, el ultimo registro por `id` gana).

```powershell
node .\bin\tasksystem.mjs memory add --project P --log lessons --input lesson.json
node .\bin\tasksystem.mjs memory list --project P --log outcomes [--tail 20]
node .\bin\tasksystem.mjs goal create --project P --input goal.json
node .\bin\tasksystem.mjs goal list --project P
node .\bin\tasksystem.mjs goal transition --project P <UUID> --to achieved
node .\bin\tasksystem.mjs metrics --project P
```

`metrics` agrega el store al leer: conteos por estado/backlog/tipo/
prioridad/disposicion, tasas de verificacion y first-try, duraciones
p50/p95/p99 de cierre y tasas de exito por skill.

## Progresion tipica

1. `create` -> PLAN, revision 0.
2. `transition ... ACT --revision 0` -> ACT, revision 1.
3. `VERIFY --revision 1` -> revision 2.
4. `EVALUATE --revision 2` -> revision 3.
5. `REVIEW --revision 3` -> revision 4.
6. `ACCEPT --revision 4 --evidence e.json` -> revision 5, exige evidencia.
7. `CLOSE --revision 5` -> revision 6, terminal.

Si la revision esperada no coincide con la almacenada: `REVISION_MISMATCH`.
Una transicion prohibida por la politica: `INVALID_TRANSITION`. Un lock
existente (`<id>.json.lock`): `TASK_LOCKED`, nunca recuperado
automaticamente.

## Formato de evidencia (attestations declaradas)

`verification` exige checks no vacios; cada check requiere `command`, `cwd`,
`status:"pass"` (unico aceptado por la politica) y `evidence` no vacio.
`review` admite dos modos, ambos con `verdict:"approve"`:

```json
{
  "verification": {
    "checks": [
      {"command": "npm test", "cwd": ".", "status": "pass", "evidence": "salida.log"}
    ]
  },
  "review": {
    "mode": "fresh", "reviewer": "agente-b",
    "authorContext": "ctx-a", "reviewerContext": "ctx-b",
    "verdict": "approve"
  }
}
```

Alternativa `waived`: `{"mode":"waived","owner":"...","reference":"...",
"reason":"...","verdict":"approve"}`. En modo `fresh`, `authorContext` debe
coincidir con el autor almacenado y `reviewerContext` debe ser no vacio y
distinto. Son
declaraciones registradas, no identidad autenticada.

## Invalidacion

- Volver a `ACT` borra `verification` y `review` almacenados; no se puede
  arrastrar aprobacion de una implementacion anterior.
- Adjuntar una nueva `verification` sin `review` en la misma llamada
  invalida la review previa. Esto tambien aplica al adjunto
  `REVIEW -> REVIEW`: para conservar la review hay que reenviarla o
  adjuntarla en otra auto-transicion posterior.
- Una transicion rechazada por validacion o por la politica deja el
  archivo, el estado y la revision intactos. Esto no promete recuperacion
  ante fallos de hardware o corte de energia a mitad de escritura.

## Alcance y lecturas

`scope` es una lista de rutas relativas normalizadas. La creacion valida
destinos y los gates V2 revalidan su contencion actual; un lector historico
no es una comprobacion continua de permisos o referencias ajenas.
No se aceptan `..` ni prefijos reservados. `list` devuelve
`{tasks, malformed}`; los archivos corruptos o con nombre no-UUID se
reportan, nunca se descartan en silencio.
