# Referencia de la superficie CLI

Referencia de los verbos del binario `scopegrain` (alias compatible:
`tasksystem`) que el check `docs-cli-drift` de `doctor` reportaba como
no documentados. La tabla completa de comandos sale de
`scopegrain --help`; este documento cubre ciclo de vida, registros
owned, recuperacion de recursos del catalogo y los alias de catalogo
resueltos en dispatch.

Convenciones comunes (fuente: `src/cli.mjs`):

- Toda salida es JSON en stdout; los errores son JSON en stderr con
  codigo de salida 1.
- Los verbos que mutan muestran una vista previa de solo lectura
  (`mode: 'dry-run'`) salvo que se pase `--apply`; `--apply` es
  create-only y nunca sobrescribe, fusiona ni reinicializa.
- `--yes` y `--force` no existen: la confirmacion siempre es explicita.
- `--project PATH` es obligatorio salvo que se indique lo contrario;
  `--config REL` selecciona una config alternativa.

## Ciclo de vida

Detalle interno de cada `prepare`/`apply`: `docs/lifecycle.md`
(`src/core/lifecycle.mjs`).

### adopt

`adopt --project PATH [--config REL] [--apply]`

Detecta un proyecto ya inicializado y reporta lo que adoptarlo
vincularia: config resuelta, enrolamiento de workspace existente,
estado del journal e `issues`; el reporte termina en
`status: 'adoptable' | 'attention'`. Con `--apply` ejecuta **solo** el
enrolamiento de workspace cuando el reporte es `adoptable`, falta el
workspace y la config resolvio; nunca reinicializa ni sobrescribe.

### backup

`backup --project PATH --to REL [--config REL] [--apply]`

Exporta la config, el `discovery.json` adyacente y cada archivo regular
bajo las rutas declaradas en `config.paths` hacia
`<dest>/manifest.json` + `<dest>/files/<rel>`. `--to` debe ser una ruta
dentro del proyecto que no solape ninguna fuente. En `--apply` cada
fuente se relee y se re-hashea; lo que cambio desde la vista previa se
omite (`skipped`) en vez de exportarse con hash obsoleto.

### restore

`restore --project PATH --from REL [--apply]`

Restaura un bundle creado por `backup`: valida `manifest.json`,
verifica el sha256 de cada payload y clasifica cada entrada como
`create`/`skip`/`conflict`. `--apply` crea solo los destinos ausentes;
los identicos se omiten y los divergentes se reportan como conflicto,
nunca se fusionan. No requiere `--config`: opera sobre la raiz del
proyecto.

### uninstall

`uninstall --project PATH [--config REL] [--apply]`

Enumera y borra **solo** archivos demostrablemente del harness: la
config, los generados byte-identicos (o fijados por el snapshot del
catalogo) y los archivos bajo `paths.state`. En `--apply` cada
candidato se re-verifica por hash antes de borrarse; lo divergente o
cambiado queda en `leftBehind`, nunca se elimina. Los directorios del
harness que quedan vacios se eliminan de abajo hacia arriba; la raiz
del proyecto nunca se toca.

## Registros owned

### approval show

`approval show --project PATH DIGEST`

Devuelve el registro de aprobacion almacenado cuyo id es el digest
sha256 `DIGEST`. Solo lectura: valida esquema, rechaza enlaces
simbolicos y exige que el id del contenido coincida con el nombre del
archivo.

### approval answer

`approval answer --project PATH --input FILE [--apply]`

Responde una aprobacion existente. El input JSON es un objeto cerrado
`{id, answer, expectedRevision, expectedTargetDigest, actor, comment?}`
con `answer` en `approve|reject|decline|custom|revoke`. El dry-run
devuelve el registro prospectivo (`previousRevision`, `next`); `--apply`
revalida el CAS (revision y digest del target) bajo lock antes de
reescribir el archivo. `revoke` solo es valido desde `approved`, y las
respuestas sobre un registro no `pending` (o `custom`) exigen
`comment` no vacio.

### session show

`session show UUID` (con `--project PATH` y `--config REL` opcionales)

Devuelve el registro de sesion acotada almacenado con id `UUID`. Solo
lectura: valida el esquema del archivo y que el id interno coincida.

## Recuperacion de recursos del catalogo

Los cuatro subcomandos leen el snapshot del workspace y nunca descargan
ni usan fallbacks externos: la fuente de bytes es siempre esta
instalacion al SHA fijado por el snapshot (`src/core/resource-recovery.mjs`).

### resource search

`resource search [KIND] --project PATH [--query Q]`

Lista entradas del catalogo del workspace filtradas por `KIND`
(`command|agent|skill|rule|reference|profile|prompt|mcp`) y por una
consulta de subcadena sobre id/descripcion. Solo metadatos: funciona
aunque el cuerpo del recurso falte en disco.

### resource diagnose

`resource diagnose KIND ID --project PATH`

Informe de salud de solo lectura de un recurso instalado:
`missing`, `invalid-form`, `legacy-unpinned`, `unreadable`,
`oversized`, `drift` (con `actualSha256`) o `healthy` comparando el
contenido con el sha256 fijado por el snapshot.

### resource restore-plan

`resource restore-plan --project PATH --input FILE`

Dry-run exclusivamente: calcula el plan de restauracion para el input
`{kind, id, expectedCurrentHash}`. Produce `action: 'create'` solo si
el destino esta ausente y la copia de esta instalacion hashea al SHA
fijado; `expectedCurrentHash` actua como CAS sobre un destino
existente y cualquier divergencia es `RESOURCE_RESTORE_CONFLICT`.

### resource restore

`resource restore --project PATH --input FILE [--apply]`

Mismo plan que `restore-plan`; sin `--apply` devuelve `mode: 'dry-run'`
y con `--apply` crea el archivo solo cuando el plan revalidado es
`create` (`action: 'noop'` si el destino ya coincide con el pin).

## Alias de catalogo

Los alias son verbos de un token resueltos en dispatch contra el
catalogo (entradas `command/*` y `aliases` de
`resources/manifest.json`, replicados en el snapshot del workspace).
Cada alias despacha por la misma via que `workflow COMMAND`: construye
un paquete de solo lectura (comando canonico + recursos resueltos +
perfil) que un host interpreta; el harness nunca ejecuta el contenido.
Flags comunes de todo alias:
`--project PATH [--config REL] [--mode M] [--task UUID] [--host H] [--profile ID] [--interaction direct|guided]`.

| Alias | Comando canonico | Modos |
|---|---|---|
| `backlog` | `triage-work` | `default` (default) |
| `ship` | `assess-release` | `default` (default) |
| `rollback` | `plan-recovery` | `default` (default) |
| `harness` | `audit-harness` | `default` (default) |
| `code-simplify` | `simplify-code` | `default` (default) |
| `codeGraph` | `analyze-structure` | `default` (default) |
| `cleanCA` | `review-change` | `default` (default), con parametro `focus: architecture` |
| `webperf` | `audit-web-performance` | `quick` (default), `deep` |
| `pipeline` | `plan-work` / `implement-task` / `coordinate-plan` / `report-status` | `plan` (default), `task`, `run`, `interactive` (guiado) |

Ejemplos:

```text
scopegrain backlog --project .
scopegrain ship --project . --task <uuid>
scopegrain pipeline --project . --mode run
```

Otros alias declarados en el catalogo (`spec` -> `specify-change`,
`status` -> `report-status`, `audit` -> `verify-work`/`review-change`/
`audit-project` segun modo, `research` -> `investigate`/
`compare-options`) siguen exactamente el mismo mecanismo.

## Descubrimiento estructural

### investigate --diff

`investigate --project PATH [--config REL] [--save] [--diff]`

Con `--diff`, la investigacion semantica se compara contra la evidencia
de descubrimiento registrada (`discovery.json` y la configuracion) y
reporta: fingerprint igual/cambiado, manifiestos y lockfiles
anadidos/eliminados/retenidos, contenido modificado con el mismo conjunto
de rutas, stacks y comandos nuevos o desaparecidos, nuevas senales de
host, decisiones obsoletas y notas explicativas. `doctor` incluye este
diff en su advertencia de fingerprint cuando la evidencia cambio, y
`update --diff` lo adjunta como `discoveryDiff` en el resultado antes de
re-proyectar archivos generados.

### structure scan / status / show

```
structure scan --project PATH [--config REL] [--apply]
structure status --project PATH [--config REL]
structure show --project PATH [--config REL]
```

Analisis estructural acotado del arbol del proyecto: inventario de
archivos, LOC/bytes por lenguaje, imports, aristas de dependencia
internas y externas, fan-in/fan-out y complejidad heuristica. Produce un
fingerprint determinista usado para detectar cambios sin re-escanear.

- `scan` es vista previa; `--apply` persiste el indice en
  `<paths.state>/cache/structure-index.json`. `init --apply` lo siembra.
- `status` reporta si existe indice y si el fingerprint sigue fresco.
- `show` devuelve el documento persistido (o `NOT_FOUND` si no hay).
- `context` incluye el resumen de frescura para que el agente sepa cuando
  refrescar antes de confiar en el indice.

Nunca lee secretos ni contenido de binarios, no ejecuta comandos del
proyecto, respeta los limites de profundidad/entradas con warnings, y
rechaza symlinks/junctions segun las fronteras de seguridad existentes.

## Rehidratacion automatica de contexto (VantaDB)

Cuando un backend VantaDB esta enrolado, la historia proyectada del
proyecto se inyecta sola en los dos puntos de reanudacion — sin
consultas manuales al CLI:

```
context --project PATH [--tail N] [--no-vantadb] [--timeout MS]
session resume UUID [--no-vantadb] [--timeout MS]
```

- `context` anade `vantadb`: `memory_recall` acotado (top_k 5, scope
  agent) sobre las memorias L1 destiladas, para que el packet de inicio
  de sesion traiga contexto episodico verificado.
- `session resume` anade `vantadb`: `memory_context` por `recordId`
  sobre los namespaces `sg-formal-v1-*` — todos los eventos de journal
  proyectados remotamente para esa tarea.
- Ambos fallan cerrados: sin enrolamiento el campo es
  `{ enrolled: false }`; un backend caido degrada a
  `{ enrolled: true, error: {...} }` sin abortar el packet.
- `--no-vantadb` omite por completo el spawn del backend;
  `--timeout MS` acota la espera (15 s por defecto).
- La herramienta MCP `scopegrain_session_resume` aplica la misma
  rehidratacion por record. La superficie MCP sigue siendo solo lectura.

## Memoria operativa, metas y metricas

Logs JSONL acotados y append-only bajo `paths.memory`; contrato de campos
en `resources/references/backlog-format.md` y verbos de tarea en
`docs/task-workflow.md` (`task meta|disposition|note|step`,
`task list --backlog`).

### memory add / memory list

```text
memory add --project PATH --log lessons|outcomes|progress --input FILE
memory list --project PATH --log lessons|outcomes|progress|goals [--tail N]
```

`add` valida la entrada contra el esquema del log (cerrada por tipo:
lecciones `{topic?,text,ref?,taskId?}`, outcomes `{taskId,outcome,skills[]}`,
progreso `{taskId,title,result,...}`) y la anexa; `list` devuelve las
ultimas `tail` entradas (default 50, max 1000) mas las lineas malformadas.
El log `goals` es de solo lectura aqui: las metas entran por `goal *`.

Un log que supera el limite de documento configurado se lee como ventana
de cola acotada, de modo que un log grande nunca rompe el arranque de
sesion; el resultado marca `truncated: true`. Al anexar, un segmento
activo que ya excede el limite rota completo a `paths.memory/archive/` —
inmutable y nunca borrado — para que un fichero de log no crezca sin
limite. La rotacion es best-effort: un fichero ocupado la difiere y el
append se completa igualmente.

### goal create / goal list / goal transition

```text
goal create --project PATH --input FILE
goal list --project PATH
goal transition --project PATH ID --to open|achieved|dropped
```

Metas/objetivos generales: registros `{id,title,description?,status,
horizon?,metrics?}` en `goals.jsonl`; el ultimo registro por `id` gana.
Las tareas enlazan via `task.goalIds`. `create` exige `title` y genera el
UUID; `transition` re-anexa la entrada actual con el nuevo estado.

### metrics

`metrics --project PATH`

Agregados derivados al leer (nada precomputado al escribir): conteos por
estado/backlog/tipo/prioridad/disposicion, tasas de verificacion y
first-try, duraciones de cierre p50/p95/p99 y tasas ok/fail por skill.

### report save / report list

```text
scopegrain report save --project PATH
scopegrain report list --project PATH [--tail N]
```

`save` ejecuta el doctor-report en vivo y lo persiste create-only en
`paths.reports` como `<ISO>-status.json`; `list` enumera los reportes
guardados, mas reciente primero (default 50).

### activity record

```text
scopegrain activity record --project PATH --input FILE [--apply]
```

Registra retroactivamente trabajo hecho fuera del ciclo de tareas: crea
una tarea `type: ops` con `source: activity:<kind>` y una entrada en el
log `progress`. Con `taskId` enlaza la acción a una tarea existente.
Input: `{kind: action|commit|note, title, summary?, ref?, files?,
taskId?, author?, methodology?}`. Bajo modos metodológicos exigentes
sintetiza una evaluación **declarada** (authorized por el actor, no una
aprobación fabricada).

### hooks install / hooks uninstall

```text
scopegrain hooks install --project PATH [--apply]
scopegrain hooks uninstall --project PATH [--apply]
```

Instala/retira un bloque administrado en `.git/hooks/post-commit` que
invoca `activity record` tras cada commit (auto-registro de commits
fuera de tarea). Idempotente, nunca sobreescribe hooks de usuario y
nunca rompe un commit (exit 0 siempre).

## Ciclo SDD (spec-kit extraction waves)

### task activate / task active / task deactivate

```text
scopegrain task activate --project PATH ID|SLUG
scopegrain task active --project PATH
scopegrain task deactivate --project PATH
```

Toda tarea lleva un slug `NNN-` monotonico derivado del titulo. El puntero
de tarea activa se resuelve `SCOPEGRAIN_TASK` (env) antes que el archivo
`<state>/active-task`; un puntero manipulado falla cerrado.

### task converge / task analyze / task checklist

```text
scopegrain task converge --project PATH ID|SLUG [--record]
scopegrain task analyze --project PATH ID|SLUG
scopegrain task checklist --project PATH [ID] (--input FILE |
  ID --key CHK### --status S --revision N [--text NOTE])
```

`converge` compara el estado real contra spec/design/plan/tasks y emite
findings tipados con veredicto; `--record` persiste un convergence record
create-only. `analyze` produce el reporte cross-artifact con severidades
y cobertura. `checklist` gestiona artefactos `CHK###` reviewer-owned
(create-only, CAS, gated en converge).

### plan stories / specification clarify / constitution

```text
scopegrain plan stories --project PATH KEY
scopegrain specification clarify --project PATH --input FILE
scopegrain constitution show|set --project PATH [--input FILE]
```

`stories` renderiza `tasks.md` por user-story (`T###`, `[P]`, fases).
`clarify` registra sesiones de clarificacion fechadas y create-only en la
spec. `constitution` gestiona la constitucion versionada (semver +
complexity tracking).

### helper install / helper list

```text
scopegrain helper install --project PATH --input FILE
scopegrain helper list --project PATH
```

Instala helper scripts project-local con manifiesto (contrato declarativo;
el harness nunca los ejecuta). `list` enumera y valida integridad.

## Distribucion (dist)

Maquinaria declarativa de distribucion: catalogos `file://` solamente —
una URI remota es `REMOTE_CATALOG_UNSUPPORTED`, nunca una descarga.

```text
scopegrain dist run --project PATH --input FILE [--no-resume]
scopegrain dist stack --project PATH --input FILE
scopegrain dist compose --project PATH --input FILE
scopegrain dist validate --project PATH --input FILE
scopegrain dist bundle-validate --project PATH --input FILE
scopegrain dist bundle-install --project PATH --input FILE [--apply]
scopegrain dist bundle-mount --project PATH ID
scopegrain dist bundle-unmount --project PATH ID
scopegrain dist bundle-uninstall --project PATH ID [--keep-files]
scopegrain dist mounted-list --project PATH
scopegrain dist extension-register --project PATH --input FILE
scopegrain dist extension-list --project PATH
scopegrain dist extension-activate|deactivate --project PATH ID
scopegrain dist extension-remove --project PATH ID
scopegrain dist preset-register --project PATH --input FILE
scopegrain dist preset-list --project PATH
scopegrain dist preset-remove --project PATH ID
```

`run` ejecuta workflows declarativos cuyos pasos solo nombran primitivas
whitelisted del harness (`task.transition`, `converge.evaluate`,
`analyze.task`, `checklist.*`, `noop`, ...); nunca shell ni binarios de
terceros. Checkpoints atomicos bajo `<state>/workflow-runs/` permiten
reanudar sin re-ejecutar pasos completados. `stack` fusiona catalogos
locales por prioridad. `compose` aplica capas `replace|prepend|append|
wrap`. `validate`/`bundle-validate` verifican submissions (id slug,
semver, pinning sha256 obligatorio en fuentes remotas).

`bundle-install` (input `{bundle, sources:[{uri,priority}]}`) copia las
fuentes `file://` requeridas bajo `<configDir>/bundles/<id>/` — acotado
(256 archivos / 16 MiB / 32 niveles de profundidad), create-only,
re-install idempotente, provenance content-addressed en
`provenance.json`; sha256 pineado se verifica antes de copiar.

`bundle-mount` registra las entradas tipadas del bundle instalado en
`<configDir>/mounted-catalog.json`, capa que `loadWorkspaceCatalog`
fusiona tras la validacion del snapshot: cada entrada confinada a
`bundles/` y verificada por sha256 en cada carga. Re-mount del mismo
bundle refresca; colisiones con ids del snapshot o de otros bundles son
`CONFLICT`. Fuentes tipo directorio montan el archivo convencional del
kind (`SKILL.md`, `AGENT.md`, ...); entradas sin main file se reportan en
`unmounted`, nunca se adivinan. `bundle-unmount` quita solo las entradas
del bundle. `bundle-uninstall` desmonta y borra unicamente los archivos
que aun coinciden con la provenance — bytes divergentes quedan en
`leftBehind`; `--keep-files` no borra nada. La provenance alterada para
apuntar fuera del directorio del bundle falla `MALFORMED`.

Los presets declaran `overrides:[{target, op, content}]` donde `target`
es `'*'`, `'<kind>/*'` o `'<kind>/<id>'`; se aplican a los recursos
proyectados en el workflow packet (prioridad ascendente, el ultimo gana)
y la traza sale declarada en `packet.presets.applied`. `preset-remove`
elimina un preset registrado.

Las extensiones llevan lifecycle `registered -> active <-> disabled`:
`extension-activate` valida que los `contributes` (`<kind>/<id>`) existen
en el catalogo del workspace antes de activar; una extension `active`
aporta sus recursos declarados al workflow packet
(`packet.contributedResources` + traza en `packet.extensions.applied`).
`extension-remove` exige estado `disabled` — no hay teardown silencioso.
Todas las mutaciones de registros (`extensions.json`, `presets.json`,
`bundles/`, `mounted-catalog.json`) se serializan bajo `dist.lock`
verificado.

### policy/hooks.json — ejemplo declarativo

```json
{"schemaVersion": 1,
 "hooks": {"*": {"before_": [{"id": "log", "description": "aviso"}]},
           "implement-task": {"after_": [{"id": "check",
             "description": "verificar"}]}}}
```

Los hooks se proyectan en `packet.hooks` como datos consultivos para el
host; el harness nunca los ejecuta.
