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

### session create / session record

`session create --task UUID --limit N [--token-limit N] [--apply]`
`session record UUID --revision N --input FILE [--apply]`

`create` abre una sesion acotada (`schemaVersion` 2; los documentos v1
almacenados siguen siendo legibles y se promueven al registrar). La flag
opcional `--token-limit N` declara un presupuesto de tokens
auto-reportados (entero >= 1; `null` cuando se omite). `record` anexa un
evento `{action, evidence, context?, tokens?}` donde `tokens` es un
objeto cerrado `{prompt, completion, total}` de enteros >= 0 con
`total === prompt + completion`. Los tokens son declarados por el
llamador, nunca observados: `tokenUsage.measures` vale
`self-reported-unverified`. El evento que alcanza el presupuesto se
acepta (el consumo declarado ya ocurrio); un evento que empujaria la
suma por encima y todo registro posterior a un presupuesto ya alcanzado
fallan con `SESSION_TOKEN_BUDGET_EXHAUSTED`, de modo que un documento
almacenado nunca supera su propio `tokenLimit`. `resume` y el dry-run
de `record` exponen `usage.tokenUsage` / `tokenUsage` con `reported`,
`limit`, `remaining`, `percent` (`null` sin presupuesto) y `measures`.

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
contenido con el sha256 fijado por el snapshot. Los estados no-healthy
incluyen `hint` (accion recomendada) y `suggestions`: ranking
determinista de hasta 5 recursos probables puntuado sobre metadatos del
catalogo (tokens de id, descripcion, mismo kind, modo, bindings) con
`reasons` declaradas por candidato. Un id desconocido sigue siendo
`CATALOG_UNKNOWN_ID`, ahora con los candidatos cercanos en el mensaje.

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
`--project PATH [--config REL] [--mode M] [--task UUID] [--host H] [--profile ID] [--interaction direct|guided] [--lazy]`.

Con `--lazy` el packet no inlinea los cuerpos de los recursos: cada entrada
de `resources`/`contributedResources` lleva `{kind,id,description,path,
sha256}` (sin `content`, sin capas de preset compuestas — los hits se
declaran en `presets.deferred`) y el packet expone `hydrate` con los
canales de hidratacion (`catalog show KIND ID` / `scopegrain_catalog_get`).
El comando y el perfil siguen completos.

`packet.posture` declara `{current: 'lazy'|'full', recommended: 'lazy'}` —
lazy es la postura recomendada para hosts que pueden hidratar via
`catalog_get`. Cuando el cuerpo renderizado del comando coincide con
`content` (sin placeholders), el packet emite `command.sameAsContent:true`
en vez de una segunda copia; `command.rendered` solo aparece cuando difiere
(consumidores: `command.rendered ?? command.content`).

Con `--task`, las skills declaradas en `task.skills` se auto-incluyen en
`resources.skills` (routing por tarea, declarado en `packet.taskRouting`:
`included` resueltos, `skipped` ids sin catalogo). Las dependencias del
comando siguen fallando cerrado; las ids de tarea que no resuelven se
reportan, nunca abortan.

`packet.deep` declara la capa opt-in de bundles montados:
`{available, mounted, bundles[], path:'bundles/'}` — entradas con
`bundle` son recursos profundos cuyo cuerpo vive bajo
`<configDir>/bundles/<bundle>/` e hidrata por los mismos canales.

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

### assess

`assess --input DIFF_FILE [--assessment FILE]`

Clasificacion de riesgo solo-por-evidencia sobre un unified diff. El core
no ejecuta git: el operador produce el diff con su propia herramienta
(p.ej. `git diff > out.patch`) y `assess` deriva senales de rutas, modos
de archivo y contenido anadido. Salida JSON determinista: `risk`
(`passive|medium|high`), `reasons[]` con senal+path+detalle,
`changed_paths`, `changed_lines` y `review_due` (`high_risk` |
`under_budget` | `passive`). Falla cerrada: contenido binario, diff
malformado o limites excedidos nunca bajan el tier. Con `--assessment`
(un assessment de methodology JSON) compara el riesgo declarado contra el
derivado y reporta `discrepancy` cuando el declarado subestima o
sobreestima. Es una senal de entrada al assessment — no lo decide ni lo
reemplaza.

### structure scan / status / show

```
scopegrain structure scan --project PATH [--config REL] [--apply]
scopegrain structure status --project PATH [--config REL]
scopegrain structure show --project PATH [--config REL]
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
- El packet tambien expone `methodology` e `intake` (`intake.mode` del
  proyecto, `off` por defecto). El mismo packet se sirve por MCP con la
  tool read-only `scopegrain_context`.

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

Registra retroactivamente trabajo hecho fuera del ciclo de tareas como
**evidencia de bookkeeping**, nunca como trabajo accionable: escribe una
entrada en el log `activity` (`<state>/memory/activity.jsonl`), visible en
`context`, la API, MCP y el runtime VantaDB. Un registro retroactivo no
puede producir honestamente la evidencia que `ACCEPT`/`CLOSE` exigen, así
que el comportamiento por defecto **no crea tareas** — la política de
workflow no tiene transición legal para ellas.

Resolución de enlace, en orden: (1) `taskId` explícito enlaza a esa
tarea; (2) sin `taskId`, el puntero de tarea activa (`SCOPEGRAIN_TASK` o
`<state>/active-task`) enlaza automáticamente — la evidencia aterriza en
el trabajo real; (3) sin puntero, la entrada queda `taskId: null` —
"evidence beats linkage": un puntero corrupto degrada a `linkWarning`
sin perder el registro. Opt-in `record: "task"` conserva el comportamiento
legado (tarea `type: ops` en PLAN) para llamadas manuales que sí quieren
un ítem accionable.

Input: `{kind: action|commit|note, title, summary?, ref?, files?,
taskId?, author?, methodology?, record?}`. Solo con `record: "task"` y
bajo modos metodológicos exigentes sintetiza una evaluación **declarada**
(authorized por el actor, no una aprobación fabricada).

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
scopegrain task checklist --project PATH [ID] (--input FILE [--apply] |
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
scopegrain specification clarify --project PATH --input FILE [--apply]
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
scopegrain dist pack --project PATH --source DIR --out FILE
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
es `'*'`, `'<kind>/*'` o `'<kind>/<id>'` y `op` es `replace`, `prepend`,
`append`, `wrap` (con `{{BODY}}`) o `replace-section` (con `selector`,
anchor de heading en minusculas: sustituye el cuerpo de la seccion, no el
heading ni las secciones de igual o mayor nivel; contenido vacio borra el
cuerpo; heading ausente = sin efecto). Se aplican a los recursos
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
verificado. Los recursos montados son consumidores de primera clase:
`host activate` los proyecta como puentes nativos por el mismo pipeline
que los recursos del snapshot — su `resourcePath` apunta dentro de
`<configDir>/bundles/<id>/`, y `doctor` trata la capa mounted como
overlay (nunca como señal de `upgradeAvailable`).

`host parity --project . [--hosts CSV]` compara los conjuntos de
recursos canonicos que cada host seleccionado proyectaria (plan de
activacion, solo lectura) a traves del frontmatter `source:` de cada
puente. Reporta `coverage` por host, `drift` (recursos ausentes en un
host que si emite ese kind — senal de bug de proyeccion) y `structural`
(ausencias donde el host no emite ningun recurso de ese kind, p.ej.
codex sin `agent/*`). Hosts con surfaces (antigravity) se comparan por
la union de sus variantes declaradas.

`dist selftest --project PATH` ejercita el ciclo de distribucion
completo (discovery → validate → dry-run → install → mount → unmount →
uninstall) sobre un fixture generado dentro del proyecto y siempre
eliminado al final. Devuelve `{ok, steps[]}` con cada paso
pass/fail — diagnostico local, sin telemetria. Las mutaciones dejan
rastro en `dist-journal.jsonl` (CAS por `previousSha256`/`newSha256`);
con workspace enrolado la escritura del registro pasa ademas por el
kernel del journal (`journaled: true`).

`dist journal --project PATH [--tail N] [--registry R] [--op O] [--id I]`
lee esa traza de forma acotada: devuelve `{entries, corrupt, chain}`
donde `chain` verifica la propiedad CAS por archivo
(`previousSha256[n] == newSha256[n-1]` del mismo `rel`) — `valid`,
`broken@<revision>` o `empty`. Lineas corruptas se reportan en
`corrupt`, nunca abortan la lectura.

`dist pack` empaqueta un directorio fuente en un tarball POSIX ustar
determinista: bytes identicos de entrada producen bytes identicos de
salida (mtime 0, uid/gid 0, modos normalizados, entradas ordenadas por
nombre, sin campos machine-local). Es la ruta del artefacto publicable;
la distribucion sigue siendo local-only — no hay feed remoto.

### policy/hooks.json — ejemplo declarativo

```json
{"schemaVersion": 1,
 "hooks": {"before": {"*": [{"id": "log", "description": "aviso"}]},
           "after": {"implement-task": [{"id": "check",
             "description": "verificar"}]}}}
```

La forma real es `{hooks: {before|after: {<commandId>|'*': [{id, description,
command?}]}}}`: fase primero, comando despues — la inversa produce
`POLICY_MALFORMED`. Cada entrada requiere `id` + `description`; `command`
es opcional.

Los hooks `before`/`after` se proyectan en `packet.hooks` como datos
consultivos para el host; el harness nunca los ejecuta.

La clave opcional `preAction` es la capa ejecutable acotada: condiciones
`when` cerradas sobre metadatos de la tarea, evaluadas por el runtime
dentro de `evaluateTaskActions`, con efectos declarados — `block` poda la
accion del conjunto permitido (denegacion real), `require-gate` la mantiene
pero la marca en `gated` (el host debe obtener aprobacion), `record` solo
anota. Nunca argv ni scripts: condiciones y efectos son datos.

```json
{"schemaVersion": 1, "hooks": {},
 "preAction": [{"id": "gate-large-scope",
   "when": {"action": "edit", "scopeOver": 9},
   "then": "require-gate",
   "reason": "scope above 9 needs approval"}]}
```

`when.action` es una accion o `*`; `when.stateIn` lista de estados;
`when.scopeOver` entero (estricto `>` sobre `task.scope.length`);
`when.skillsMissing` lista de skills — coincide si la tarea carece de
alguna. Las entradas que coinciden quedan trazadas en
`packet.actionHooks.applied` y `task check-action`/`scopegrain_check_action`
exponen `actionHooks` + `gate`.

## Configuracion global, version, progreso de olas y VantaDB L3

### `--version` / `-v` / `-V` / `-h`

```text
scopegrain --version
scopegrain -h
```

Imprime `{name, version, node}` desde el `package.json` instalado (sin
conflicto con `vantadb setup --version X`). `-h` es alias de `--help`.

### config path / config show / config set

```text
scopegrain config path
scopegrain config show
scopegrain config set --input FILE [--apply]
```

Gestiona defaults globales opcionales de onboarding del usuario en
`~/.config/scopegrain/config.json` (o `$XDG_CONFIG_HOME/scopegrain/config.json`
o `$SCOPEGRAIN_USER_CONFIG`; `"none"` o vacio lo desactiva). Solo admite
`locale`, `hosts`, `methodology` y `versioning`. Rechaza permisos, comandos
de verificacion y rutas de proyecto. Precedencia estricta:
`workspace > --answers > repo-signals > user-global > policy-defaults`.
Un workspace ya inicializado nunca hereda ni mezcla cambios globales en runtime.

### plan run (persistencia de olas)

```text
scopegrain plan run --project PATH KEY [--apply]
```

Sin `--apply` devuelve la agenda determinista de olas más la vista previa de
checkpoint y estado de reanudacion (`resume`). Con `--apply` persiste
atomicamente un checkpoint acotado (max 50) en
`<paths.state>/plan-runs/<KEY>.json` bajo lock verificado para reanudar
corridas multi-tarea interrumpidas.

### structure refresh

```text
scopegrain structure refresh --project PATH [--config REL] [--apply]
```

Refresco explicito y acotado del indice estructural: realiza primero un
chequeo barato stat-only y devuelve `mode: "noop"` sin releer archivos cuando
el indice ya esta fresco. Si esta obsoleto o ausente, previsualiza sin `--apply`
y reconstruye/persiste atomicamente con `--apply`. `context` permanece
estrictamente read-only y reporta `refreshPolicy: "explicit"`.

### vantadb sync-persona

```text
scopegrain vantadb sync-persona --project PATH [--limit N] [--timeout MS] [--apply]
```

Proyeccion opt-in L3 hacia `l3/sg-persona-<scopeHash>`: lee unicamente capturas
con ownership probado de categoria `preference` o `decision` desde `.scopegrain`
(autoridad unica), las proyecta idempotentemente con readback y nunca adopta
archivos no probados (`skippedUnproved`). Vista previa sin `--apply`.
