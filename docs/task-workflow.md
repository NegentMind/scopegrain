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
PLAN -> ACT | RESEARCH | STALL | ABANDON
ACT -> VERIFY | STALL | ABANDON
VERIFY -> COLLATERAL | EVALUATE | ACT | STALL | ABANDON
COLLATERAL -> RESEARCH | ACT | EVALUATE | STALL | ABANDON
RESEARCH -> PLAN | ACT | STALL | ABANDON
EVALUATE -> REVIEW | ACT | STALL | ABANDON
REVIEW -> ACCEPT | ACT | STALL | ABANDON
ACCEPT -> CLOSE | ACT | STALL | ABANDON
STALL -> PLAN | ABANDON
CLOSE -> (terminal)
ABANDON -> (terminal)

`ABANDON` es el estado terminal de abandono: no exige evidencia ni gate
metodologico. Una tarea con `disposition` `discarded`/`cancelled` solo
puede transitar a `ABANDON` (la disposicion es efectiva, no decorativa);
reanudarla exige limpiar primero la disposicion. Las comprobaciones de
verificacion admiten `status` `pass`/`fail`/`error` como registro
honesto; la aceptacion sigue exigiendo `pass`. Los veredictos de
revision admiten `approve`/`reject`/`changes-requested`; la aceptacion
sigue exigiendo `approve`.

El bloque `constraints` de la politica fija las guardas de contenido que
las aristas no pueden expresar; el runtime las lee y fija
(`transition.mjs`, divergencia = `POLICY_INVALID`):
`terminalDispositions` = `discarded`/`cancelled` con
`terminalDispositionTarget` = `ABANDON`, y
`methodologyRevalidatedTargets` = `ACT`/`ACCEPT`/`CLOSE` (los destinos
que requieren gate metodologico revalidado).
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
node .\bin\scopegrain.mjs task create --project P --input task.json [--apply]
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
node .\bin\scopegrain.mjs task list --project P
node .\bin\scopegrain.mjs task show --project P <UUID>

# Transicionar (CAS obligatorio con --revision N)
node .\bin\scopegrain.mjs task transition --project P <UUID> ACT --revision 0
node .\bin\scopegrain.mjs task transition --project P <UUID> VERIFY --revision 1 [--evidence evidence.json]

# Comprobar una accion en el estado actual
node .\bin\scopegrain.mjs task check-action --project P <UUID> edit
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

Dos capas de dependencias, deliberadamente distintas: el DAG de un plan
(`tasks[].dependsOn` por claves) es la restriccion fuerte — el gate ACT la
exige de forma transitiva y `plan next` la convierte en readiness
(ready/blocked). Al materializar, ese DAG tambien se propaga al registro
de cada tarea V3 como `dependsOn` de UUIDs, de modo que consumidores a
nivel tarea (ordenacion MCP, el visor) ven la misma estructura. El
`dependsOn`/`relations` de registro en tareas fuera de plan es declarativo
e informativo — ordena sugerencias y documenta el grafo, pero no gatea.
Declaralos al encadenar trabajo (`see`, `supersedes`, `duplicateOf`,
`blocks` en `relations`).

```powershell
# Parche de metadata (CAS con --revision N): {set:{...}, disposition?,
# addNote?, stepStatus?} en el fichero --input
node .\bin\scopegrain.mjs task meta --project P <UUID> --revision 2 --input meta.json

# Disposicion (atalajo): deferred|icebox|future|discarded|cancelled;
# 'active' limpia la disposicion
node .\bin\scopegrain.mjs task disposition --project P <UUID> deferred --revision 2 --reason "waiting on owner" --by agent

# Nota y estado de paso
node .\bin\scopegrain.mjs task note --project P <UUID> --revision 3 --text "root cause confirmed"
node .\bin\scopegrain.mjs task step --project P <UUID> --revision 4 --index 0 --status done

# Enlaces entre tareas (atalajo sobre meta): union/diff de dependsOn y
# relaciones tipadas sin fichero JSON. Sin --kind edita dependsOn (el
# destino debe ser una tarea real); con --kind edita relations[REL]
# (admite refs externas). CAS con --revision N
node .\bin\scopegrain.mjs task link --project P <UUID> <TARGET> --revision 1 --apply
node .\bin\scopegrain.mjs task link --project P <UUID> ext:doc-42 --kind see --revision 2 --apply
node .\bin\scopegrain.mjs task unlink --project P <UUID> <TARGET> --revision 3 --apply

# Sugerir enlaces candidatos (solo lectura; nunca escribe). Detecta
# aristas del DAG del plan ausentes del registro y titulos similares
# entre una tarea abierta y una ABANDON (supersedes) o entre dos
# abiertas (see). Aplicar cada una con task link --apply
node .\bin\scopegrain.mjs task link-suggest --project P

# Autorizacion post-creacion (unica via legal para methodology
# authorization 'missing'; CAS con --revision N)
node .\bin\scopegrain.mjs task authorize --project P <UUID> --revision 1 --actor owner --reference "decision D-7" --apply

# Re-evaluacion de la metodologia almacenada (registros light; los
# bindings formales spec/design son inmutables). --input lleva el
# objeto assessment; CAS con --revision N
node .\bin\scopegrain.mjs task reassess --project P <UUID> --revision 1 --input assessment.json --apply

# Listar por backlog nombrado (sin filtro = todos)
node .\bin\scopegrain.mjs task list --project P --backlog futuro

# Documento legible de la tarea (Markdown renderizado desde el registro)
node .\bin\scopegrain.mjs task doc --project P <UUID>
```

`task doc` escribe `.scopegrain/tasks/<uuid>.md` (o el destino configurado
en `paths.tasks`): front matter con id, estado, revision y timestamps, y
secciones para contrato, scope, metodologia, dependencias, pasos,
verificacion, revision, notas e historia. Los encabezados y etiquetas del
documento siguen `config.locale` (el documento ES un artefacto
operacional, no una instruccion canonica — ver politica de idioma en
[product-contract](product-contract.md)). Es idempotente — una segunda
ejecucion sin cambios reporta `changed: false` y no reescribe el archivo.

## Contexto de sesion

```powershell
# Paquete de arranque de sesion (solo lectura)
node .\bin\scopegrain.mjs context --project P [--tail N] [--no-vantadb] [--no-structure]
```

`context` devuelve un paquete JSON acotado (`schemaVersion: 1`) con las
rutas de instrucciones y config, `locale` (idioma preferido del usuario:
los artefactos operativos generados y las superficies interactivas lo
siguen), el archivo de conocimiento del usuario
`.scopegrain/context.md` (si existe; leido, nunca escrito — contenido
limitado a 32 KiB), resumen de tareas (totales, abiertas por estado y la
lista `ready`: tareas en PLAN sin disposicion), metas abiertas, ultimas
entradas de `progress`, hasta 3 sesiones reanudables y el conteo de
eventos pendientes del journal. Los hosts lo invocan al inicio de sesion
segun la instruccion generada en AGENTS.md/CLAUDE.md y
`.scopegrain/instructions.md`; nunca ejecuta comandos ni modifica estado.
`--no-structure` sirve el indice estructural persistido sin re-escanear
(la opcion `structureDebounceMs` existe a nivel API para una ventana de
cache temporal); el argumento MCP equivalente es `noStructure`.

El paquete incluye `tokenEstimate`: una estimacion local heuristica
`utf8-bytes/4` (bytes UTF-8 tras normalizar CRLF, divididos por cuatro y
redondeados al alza) — nunca el conteo del tokenizer del anfitrion, que
el harness no observa. `tokenEstimate.sections` reporta
`{estimatedTokens, estimator, bytes}` por cada seccion presente; en
`userContext` la medicion cubre solo el `content` devuelto (tras el cap
de 32 KiB) y `coversTruncatedContent` lo declara. `tokenEstimate.total`
estima el paquete completo sin la propia clave `tokenEstimate`
(`excludesSelf: true`); `tokenEstimate.wire` es la cifra honesta
auto-inclusiva — el paquete serializado incluyendo el bloque, iterada a
punto fijo. Cuando `wire` supera el presupuesto consultivo
`packetBudgetTokens` (16000, `policy/operation-limits.json`), el paquete
lo declara en `warnings[]`. Es metadato consultivo y degradable: si falla
sale `null` sin abortar el paquete.

## Memoria operativa, metas y metricas

Logs JSONL acotados y append-only bajo `paths.memory`
(`.scopegrain/memory/`):
`lessons` (aprendizajes), `outcomes` (resultado
ok/fail por skills usadas), `progress` (archivo de avance — se escribe
solo al alcanzar CLOSE), `goals` (metas/objetivos generales; tasks enlazan
via `goalIds`, el ultimo registro por `id` gana).

```powershell
node .\bin\scopegrain.mjs memory add --project P --log lessons --input lesson.json
node .\bin\scopegrain.mjs memory list --project P --log outcomes [--tail 20]
node .\bin\scopegrain.mjs goal create --project P --input goal.json
node .\bin\scopegrain.mjs goal list --project P
node .\bin\scopegrain.mjs goal transition --project P <UUID> --to achieved
node .\bin\scopegrain.mjs metrics --project P
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
