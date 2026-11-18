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
