---
title: Proyecciones de hosts nativos y limites
kind: guide
---
# Proyecciones de hosts nativos

Scopegrain comparte procedimientos canonicos y snapshots de proyecto entre
doce hosts documentados, mas un host provisional admitido (Hermes) y un
adaptador de reserva `generic` no certificado (scaffold para hosts MCP
stdio sin adaptador dedicado). Los
archivos nativos son puentes delgados, no implementaciones mantenidas de
forma independiente. El namespace `scopegrain-` evita reemplazar built-ins.

## Estado

Los formatos documentados y las pruebas locales con fixtures no son
validacion nativa. Las comprobaciones estructurales de parseo sobre
fixtures aplicados verifican solo que los archivos generados son
sintacticamente bien formados, nunca que un binario de host real los
acepta, descubre o hace cumplir. Tres pilotos nativos fueron validados en
sesiones reales (self-run): una sesion fresca real de Devin Local el
2026-11-17 auto-cargo las 42 skills `scopegrain-*` y 15 subagentes, activo
el MCP `scopegrain` desde `.devin/mcp_config.json` e invoco
`scopegrain_status` (solo lectura, 16 checks de doctor, catalogo de 130
entradas verificado por hash); una sesion fresca real de Antigravity
App/CLI el 2026-11-19 auto-descubrio las 72 skills `scopegrain-*` y 15
subagentes bajo `.agents/`, activo el MCP `scopegrain` desde
`.agents/mcp_config.json` (22 herramientas de solo lectura) e invoco
`scopegrain_status` y `scopegrain_catalog_list` en vivo; y OpenCode V2
completo su piloto el 2026-11-23 contra `opencode v2.3.2` como se detalla
abajo. Los demas hosts y superficies — Claude, Codex, la superficie IDE de
Antigravity, el provisional Hermes, GitHub Copilot, Cursor y la tier 2b
(Cline, Roo Code, Kilo Code, Gemini CLI, Windsurf) — aun carecen de piloto
nativo. `self-run` significa ejecutado por el equipo del proyecto, no una
validacion independiente ni un aval del proveedor del anfitrion. La suite de
fundacion completo localmente con un archivo de test a la vez; ver
[verificacion](verification.md) para su alcance y ejecuciones anteriores
separadas.

OpenCode V2 completo su piloto el 2026-11-23 sobre una instalacion real de
`opencode v2.3.2`, incluidos los pasos 5 (interrupcion y reanudacion) y 6
(limpieza) en un fixture temporal aislado: ver
[Limites de superficie de OpenCode V2](#limites-de-superficie-de-opencode-v2)
y [verificacion](verification.md). Los siete pasos del procedimiento
quedaron ejecutados con evidencia, asi que OpenCode V2 es la tercera
superficie validada en una sesion real (self-run). El autocompletado de `/`
quedo topado por la TUI, de modo que
el conteo de los 30 comandos no se enumero en pantalla; lo verificado es el
despacho real de `/scopegrain-status` desde el composer.
Ningun host fue activado por estos cambios. La inicializacion crea
propuestas bajo el directorio de configuracion seleccionado, normalmente
`.scopegrain/integrations/`; las rutas activas previstas abajo NO se
escriben automaticamente.

| Host | Propuesta de invocacion | Ruta de skill prevista | Ruta de rol prevista |
| --- | --- | --- | --- |
| Claude Code | `/scopegrain-NAME` | `.claude/skills/<name>/SKILL.md` | `.claude/agents/<name>.md` |
| Codex | `$scopegrain-NAME` | `.agents/skills/<name>/SKILL.md` | `.codex/agents/*.toml` mas declaraciones |
| OpenCode V2 | `/scopegrain-NAME` | `.opencode/skills/<name>/SKILL.md` | `.opencode/agents/<name>.md` |
| Devin CLI/Local | `/scopegrain-NAME` | `.devin/skills/<name>/SKILL.md` | `.devin/agents/<name>.md` |
| Antigravity App/CLI | `/scopegrain-NAME` | `.agents/skills/<name>/SKILL.md` | `.agents/agents/<name>.md` |
| Antigravity IDE | `/scopegrain-NAME` | `.agents/skills/<name>/SKILL.md` | Ninguna asumida; propuesta solo de skills |
| GitHub Copilot | `/scopegrain-NAME` | `.agents/skills/<name>/SKILL.md` | `.github/agents/<name>.md` |
| Cursor | `/scopegrain-NAME` | `.cursor/skills/<name>/SKILL.md` | `.cursor/agents/<name>.md` |
| Cline | `/scopegrain-NAME` | `.cline/skills/<name>/SKILL.md` | Ninguna: los subagentes son `.yaml` bajo `.cline/agents` (solo CLI/Desktop) y no se proyectan |
| Roo Code | `/scopegrain-NAME` | `.roo/skills/<name>/SKILL.md` | Ninguna: los modes son YAML, no archivos de agente markdown |
| Kilo Code | `/scopegrain-NAME` | `.kilo/skills/<name>/SKILL.md` | `.kilo/agents/<name>.md` |
| Gemini CLI | `/scopegrain-NAME` | `.gemini/skills/<name>/SKILL.md` | Ninguna documentada a nivel proyecto |
| Windsurf (legacy Cascade) | `/scopegrain-NAME` | `.windsurf/skills/<name>/SKILL.md` | Ninguna documentada bajo `.windsurf/` |
| Hermes Agent (provisional) | Ninguna verificada | `~/.hermes/skills/` (global; nunca escrita) | Ninguna asumida |

Los puentes de comandos nativos de OpenCode apuntan adicionalmente a
`.opencode/commands/`, que el host despacha solo desde su composer
interactivo; un `opencode run` no interactivo no los expande. Comandos,
skills y roles siguen refiriendose a los mismos recursos canonicos
configurados y al mismo runtime. Copiar un puente sin su configuracion de
proyecto y snapshot es insuficiente.

## Superficies de la tier 2b

Los cinco adaptadores siguen el patron declarativo de tier 2 con estas
diferencias verificadas contra documentacion oficial vigente:

- **Cline**: comandos proyectados como skills (los workflows estan en ruta
  de deprecacion hacia skills). Puente de reglas `.cline/rules/scopegrain.md`
  y `AGENTS.md` auto-detectado. Los subagentes de Cline son archivos `.yaml`
  bajo `.cline/agents` y solo aplican a CLI/Desktop — no se emiten puentes
  de agente markdown. No existe config MCP de proyecto: el fragmento
  `cline-mcp.json` declara como destino global
  `~/.cline/data/settings/cline_mcp_settings.json` (la extension VS Code
  usa su propio archivo bajo globalStorage) — nunca se escribe.
- **Roo Code**: comandos markdown en `.roo/commands/` (slash commands),
  skills en `.roo/skills/` (v3.38+), reglas `.roo/rules/scopegrain.md`,
  `AGENTS.md` (`roo-cline.useAgentRules`, activado por defecto). Sin
  puentes de agente: los modes son definiciones YAML, no `.md`. MCP: merge
  manual de `mcpServers.scopegrain` en `.roo/mcp.json`.
- **Kilo Code**: raices `.kilo/` del producto actual (la extension legacy
  `.kilocode/` sigue leyendo reglas por compatibilidad, por eso el puente
  de reglas va a `.kilocode/rules/scopegrain.md`, que se auto-incluye).
  Comandos `.kilo/commands/<n>.md`, agentes `.kilo/agents/<n>.md`
  (frontmatter `mode`/`permission` documentado pero sin propuesta de
  restriccion emitida), `AGENTS.md` siempre cargado. MCP: merge manual de
  `mcp.scopegrain` (`type: "local"`, `enabled: false`) en `kilo.jsonc`
  (o `.kilo/kilo.jsonc`, que tiene precedencia).
- **Gemini CLI**: skills `.gemini/skills/` (requiere carpeta trusted),
  comandos TOML `.gemini/commands/<n>.toml` (`prompt` + `description`) —
  nuevo dialecto `commandFormat: 'toml'` del modelo declarativo. El
  contexto por defecto es `GEMINI.md` (puente gestionado en la raiz);
  `AGENTS.md` solo carga via opt-in `context.fileName` que el harness
  nunca escribe. Sin puentes de agente. MCP: merge manual de
  `mcpServers.scopegrain` en `.gemini/settings.json`; `trust` nunca se
  emite.
- **Windsurf**: superficie legacy Cascade (`.windsurf/`). Devin Desktop/
  Devin Local lee las raices `.devin/` ya cubiertas por el adaptador
  `devin`; el adaptador windsurf cubre las raices legacy documentadas:
  `.windsurf/skills/`, workflows `.windsurf/workflows/`, reglas
  `.windsurf/rules/scopegrain.md`, `AGENTS.md`. MCP solo existe global en
  `~/.codeium/windsurf/mcp_config.json` — nunca se escribe.

Los hosts sin superficie de agente markdown documentada omiten `agentRoot`
en la policy: la ausencia de puentes `agent/*` es estructural (limitacion
documentada del host), nunca una raiz fabricada.

## Variantes explicitas

Solo se generan propuestas OpenCode V2, usando `permissions`,
`mcp.servers` y `disabled`. Los archivos V1 existentes no se eliminan.
Inspeccionar el plan de activacion y no asumir que una propuesta V2
funciona en V1.

Antigravity App/CLI e IDE son superficies separadas. La propuesta de
App/CLI incluye agentes personalizados documentados; la propuesta de IDE
no infiere esa capacidad. El fragmento `integrations/antigravity-mcp.json`
permanece deshabilitado (`disabled: true`), mientras que el archivo
dedicado `.agents/mcp_config.json` queda listo para activarse con
`host activate --host antigravity --surface <app-cli|ide> --apply`. No
ocurre ninguna instalacion automatica de agentes, workflows o MCP.

Las declaraciones de roles de Codex se recopilan fuera de los archivos
de rol descubribles en `agents-fragment.toml`; el destino propuesto
`.codex/config.toml` necesita una fusion manual. La carga y el
descubrimiento de roles dependen de la version instalada.

La convencion `.agents/` es compartida por productos. Un archivo con
namespace alli aun puede ser descubierto por mas de un host; no es
aislamiento de producto.

## Hosts provisionales

Hermes Agent es un host admitido cuyo formato nativo NO ha sido
verificado contra una especificacion en el repo; no tiene bloque en
`policy/native-adapters.json` por diseno. En lugar de puentes fabricados
por recurso, seleccionar `hermes` emite exactamente dos artefactos de
revision bajo `<configDir>/integrations/native/hermes/`:

- `hermes-proposal.json` — un descriptor marcado `format: "provisional"`,
  `verified: false`, que apunta al fragmento MCP machine-local y nombra
  su destino documentado de fusion manual
  (`~/.hermes/config.yaml`, clave `mcp_servers.scopegrain`).
- `instructions.md` — pasos de activacion manual y las fuentes
  consultadas.

El fragmento companero `integrations/hermes-mcp.json` envuelve un
subarbol `fragment.mcp_servers` en JSON estricto (un subconjunto valido
de YAML 1.2, de modo que puede revisarse contra la forma YAML
documentada) con `enabled: false`. Todas las raices de Hermes son rutas
globales bajo `~/.hermes/`; el harness nunca las escribe — ver el
contrato de activacion abajo.

## Adaptador `generic` (scaffold no certificado)

`generic` es el adaptador de reserva para hosts capaces de MCP por stdio
que no tienen adaptador dedicado. NO esta certificado contra ningun
producto: ningun host real reclama las raices `.agent/` — son una
convencion local de proyecto que el propietario debe apuntar
manualmente. Su contrato de salida:

- Puentes de skills y comandos en `.agent/skills/<nombre>/SKILL.md`
  (`commandFormat: 'skill'` — los comandos se proyectan como skills).
- Puentes de agentes en `.agent/agents/<nombre>.md` — markdown plano
  sin frontmatter.
- Fragmento MCP `integrations/generic-mcp.json` con la forma JSON stdio
  comun: `{note, mcpServers.scopegrain:{type:'stdio', command:'node',
  args, disabled:true}}`. El `disabled:true` fuerza el opt-in: el
  fragmento se fusiona a mano tras revision; el harness nunca escribe
  config de host.
- La etiqueta `invocation: 'workflow NAME'` es una convencion
  documental dentro del texto de los puentes; nada la hace cumplir.

`host activate --host generic --apply` materializa las raices `.agent/`
bajo el proyecto, create-only y sin escrituras globales — igual que
cualquier otro host. Sin piloto: no existe certificacion de que ningun
binario descubra o haga cumplir estas raices.

## Permisos y modelos

Los roles de solo lectura seleccionados reciben restricciones
especificas del host:

- Claude: lista de herramientas de lectura solicitada.
- Codex: sandbox de filesystem de solo lectura solicitado.
- OpenCode V2: denegacion solicitada de edit/shell/subagent — ver
  [Limites de superficie de OpenCode V2](#limites-de-superficie-de-opencode-v2)
  para el alcance realmente medido en una instalacion real.
- Devin: allowlist de herramientas de subagentes personalizados.
- Antigravity App/CLI: lista documentada de herramientas de lectura
  solicitada; IDE no tiene propuesta de restriccion de agentes
  personalizados porque no se asumen agentes alli.

Estos alcances no son garantias equivalentes. Validar los nombres reales
de herramientas, la denegacion efectiva, los efectos secundarios de MCP
y la politica de la organizacion dentro del host. El piloto App/CLI del
2026-11-19 confirmo la denegacion efectiva de las herramientas nativas de
escritura y shell para el rol de solo lectura, pero `call_mcp_tool`
siguio expuesto y alcanza otros servidores MCP globales con operaciones
de escritura externas: la lista de herramientas de lectura no aisla
efectos MCP de terceros. Otros roles heredan la politica nativa del
propietario; los prompts de modelo no son un sandbox ni un sustituto de
la aplicacion nativa de permisos.

El `allowed-tools` inline de skills de Devin otorga autoaprobacion en
lugar de restringir disponibilidad. Las skills inline generadas lo omiten
deliberadamente. Solo el campo documentado de subagente personalizado se
trata como allowlist de disponibilidad, y esa interfaz de agente
personalizado es experimental. Un hijo que no puede preguntar al usuario
debe devolver un bloqueo al lead, no fabricar consentimiento.
El comportamiento de Devin Cloud no esta certificado por el piloto de
CLI/Local ni por los fixtures.

Los modelos permanecen bajo la politica del host o una eleccion
explicita del propietario. Scopegrain no selecciona ningun proveedor,
identificador de modelo, estimacion de costo ni llamada de pago
universal. La disponibilidad, el comportamiento del router y la
facturacion dependen del host.

## Limites de superficie de OpenCode V2

Medido contra una instalacion real de `opencode v2.3.2` (node v26.8.1,
Windows 10.0.26200) el 2026-11-23, con los puentes aplicados en un
proyecto fixture aislado. Son observaciones de adaptador complementarias al
piloto interactivo registrado arriba: por si solas no validan descubrimiento,
invocacion y denegaciones de extremo a extremo en otras versiones o
superficies. Se uso OpenCode V2 segun
su documentacion en [opencode.ai/docs](https://opencode.ai/docs/): skills,
agents, commands y servidores MCP.

Lo que el binario real acepto:

- `.opencode/skills/<id>/SKILL.md` y `.opencode/agents/<id>.md` se
  descubren sin configuracion adicional — 44 skills y 15 subagentes se
  resolvieron desde el fixture aplicado. Los escalares de frontmatter,
  `mode: subagent` y el bloque de provenance `metadata.*` fueron
  tolerados.
- La lista ordenada `permissions` (`action`/`resource`/`effect`) es el
  esquema V2 y se aplica, ganando la ultima regla coincidente. El mapa V1
  legacy `permission` (singular) es la forma que la guia de migracion
  depreca; los puentes V2 generados no lo usan.
- `mcp.servers.<nombre>` con `type: "local"`, un arreglo `command` y
  `disabled` es la forma MCP canonica V2 y conecta tal cual una vez se
  limpia `disabled`. La documentacion V2 declara que los nombres de
  servidor ya no viven directamente bajo `mcp`; una instalacion real
  puede seguir honrando esa forma plana legacy en paralelo, de modo que un
  archivo de proyecto fusionado puede contener legitimamente ambas.
- `.opencode/commands/<nombre>.md` es la ruta documentada de comandos,
  pero el host despacha comandos solo desde el composer interactivo:
  `opencode run "/<nombre>"` no expande ninguno. Una ejecucion no
  interactiva no puede probar ni refutar el descubrimiento de comandos —
  los conteos de comandos deben leerse de una sesion interactiva fresca.

### Alcance del rol de solo lectura en OpenCode V2

`opencode debug agents` resuelve los permisos generados de
`scopegrain-reviewer` exactamente como se emiten:

```text
action   resource        effect
*        *               allow    <- politica base del host, heredada
read     *.env           ask
edit     *               deny     <- propuesta
shell    *               deny     <- propuesta
subagent *               deny     <- propuesta
```

`edit`, `shell` y `subagent` quedan efectivamente denegados porque gana la
ultima regla coincidente. Toda accion no nombrada alli sigue heredando
`* -> allow`: `webfetch`, `websearch`, `skill`, `todowrite`, las
herramientas de recurso MCP y toda herramienta MCP externa
(`<servidor>_<herramienta>`). El rol de solo lectura puede por tanto
producir todavia efectos de escritura externos a traves de un servidor MCP
de terceros. Es la misma clase de hallazgo que el piloto Antigravity del
2026-11-19 registro para `call_mcp_tool`: una propuesta de solo lectura no
aisla efectos MCP de terceros ni de red.

La denegacion por herramienta individual es tecnicamente expresable — el
binario real acepta un `action` exacto (`scopegrain_memory_add`) y un
comodin de prefijo (`servidor_*`) — de modo que estrechar el perfil para
denegar solo las herramientas mutantes de Scopegrain sin bloquear las de
solo lectura es posible. Es una decision de semantica de rol, asi que no
se aplica aqui.

En una sesion hija real lanzada como `scopegrain-reviewer` el 2026-11-23 se
midio el efecto concreto: los tools `edit` y `shell` **no existen** en el
contexto del hijo (no piden aprobacion, no estan disponibles) y el loader
deniega `fs`, `node:fs`, `node:child_process`, `path` y `os`. Tampoco
aparecio `todowrite` ni el tool de subagentes. En cambio siguen disponibles
`read`, `glob`, `grep`, `webfetch`, `websearch`, `skill`, `question` y todo
el catalogo MCP: las seis tools de escritura local de Scopegrain mas los
escritores de notion, todoist, tui, chrome-devtools, playwright, argus y
opencode. La postura de solo lectura es efectiva para disco y shell, y no
es un sandbox de solo lectura sobre MCP ni sobre red.

### Descubrimiento de skills entre hosts

OpenCode tambien indexa `.claude/skills` y `.agents/skills` por
compatibilidad. La precedencia documentada es `.opencode/skills` del
proyecto primero, luego `.agents/skills`, luego `.claude/skills`, y las
skills se seleccionan por ID. Activar varios hosts en un mismo proyecto
expone por tanto los mismos IDs `scopegrain-*` a traves de mas de una
raiz: se carga la copia de mayor precedencia, pero las raices solapadas no
son aislamiento y la superficie duplicada es especifica de cada proyecto.

Medido en este workspace el 2026-11-23, con `.agents/skills/` ya poblado
por el piloto Antigravity (74 IDs) y `.opencode/skills/` recien activado
(44 IDs, todos ya presentes en `.agents`): el conteo visible fue **74**, no
118, de modo que la deduplicacion por ID ocurre; y la skill
`scopegrain-unified-review` cargo desde
`.opencode/skills/scopegrain-unified-review`, confirmando que gana la raiz
de mayor precedencia. El efecto practico es que activar OpenCode no agrega
IDs nuevos cuando Antigravity ya proyecto las mismas skills, pero si
reemplaza la copia cargada.

## Contrato de activacion

`src/hosts/activation.mjs` proporciona la maquinaria opt-in que
materializa las propuestas nativas generadas en destinos de host locales
del proyecto:

- `prepareActivation(ctx, {host, surface?})` devuelve
  `{mode: 'dry-run', files: [{rel, action}], skipped, warnings, format}`
  donde `action` es `create`, `conflict` o `noop` bajo las mismas
  comprobaciones que `preflightPlan` (colisiones planeadas, contencion,
  links/no-archivos, comparacion acotada de bytes identicos). No escribe
  nada.
- Cada propuesta del manifiesto declara `activationMode`:
  `apply` (archivo completo que `host activate --apply` puede crear),
  `merge` (fragmento que se fusiona a mano en configuracion compartida —
  `.mcp.json` de Claude, `.codex/config.toml` de Codex, `opencode.jsonc`
  de OpenCode, `.vscode/mcp.json` de Copilot, `.cursor/mcp.json` de
  Cursor, `.roo/mcp.json` de Roo, `kilo.jsonc` de Kilo y
  `.gemini/settings.json` de Gemini CLI — y que la activacion lista en
  `skipped`) o `manual`
  (divulgacion/revision solamente). La clave legacy `manualMerge` se
  conserva solo para consumidores del esquema anterior y esta
  deprecada en favor de `activationMode`.
- `applyActivation(ctx, {host, surface?})` reejecuta el preflight que
  lanza errores inmediatamente antes de escribir (`PLAN_CONFLICT` aborta
  todo), luego crea archivos con descriptores exclusivos `wx` y hace
  rollback solo de los archivos que creo. Los archivos existentes
  identicos son `noop`; los destinos divergentes o enlazados son
  conflictos — nunca sobrescrituras.
- Solo son aplicables archivos completos nuevos locales del proyecto.
  Las entradas que se fusionan en configuracion compartida del host
  (fragmentos `agent-declaration`, descriptores `mcp`) y cualquier
  destino que no sea una ruta canonica relativa al proyecto — incluidas
  todas las rutas globales `~` — se reportan en `skipped` con warnings y
  nunca se escriben. Los fragmentos MCP machine-local bajo
  `integrations/<host>-mcp.*` siguen siendo propuestas de fusion manual.
- Devin y Antigravity son excepciones a la regla de MCP solo-fusion:
  desde Devin v3000.3 los servidores MCP del proyecto viven en el archivo
  dedicado completo `.devin/mcp_config.json`, y en Antigravity viven en
  `.agents/mcp_config.json`, de modo que la activacion los aplica como
  cualquier otro archivo proyectado (create-only; un archivo existente
  divergente es un conflicto, nunca una sobrescritura). El destino
  compartido legacy `.devin/config.json` sigue siendo una entrada `mcp`
  de fusion omitida para hosts anteriores a v3000.3, y el fragmento
  `integrations/antigravity-mcp.json` se mantiene con `disabled: true`.
  Los archivos generados embeben rutas absolutas machine-local — regenerar
  por maquina con `host activate --host devin --apply` o
  `host activate --host antigravity --surface <app-cli|ide> --apply`
  tras reubicar el proyecto o la instalacion (Devin no expande variables
  de entorno, de modo que no es posible usar templates). La misma
  advertencia machine-local aplica al fragmento MCP de cada host:
  `.mcp.json` (Claude), `.codex/config.toml` (Codex) y la propuesta de
  OpenCode V2 embeben valores absolutos de `serverPath`/`--project` y
  deben re-fusionarse o regenerarse tras un traslado.
- OpenCode V2 no tiene destino MCP de archivo completo, asi que su
  fragmento `integrations/opencode-mcp.json` declara ademas su destino de
  fusion manual — el `opencode.jsonc` del proyecto (o `opencode.json`
  cuando el proyecto usa ese nombre) — como entrada `mcp` omitida. Esa
  declaracion es solo divulgacion: `host manifest` etiqueta el destino
  como `shared`, la activacion lo lista en `skipped`, `doctor` nunca lo
  re-renderiza como fragmento, y las rutas absolutas que el fragmento
  embebe llegan a la propuesta de gitignore para que el archivo de
  proyecto fusionado quede sin versionar. Nunca se escribe nada en el.
  Los fragmentos de Claude y Codex conservan el arreglo silencioso
  anterior.
- `surface` selecciona un id de variante (p. ej. `app-cli`, `ide`) o una
  de sus superficies declaradas. Como las variantes de Antigravity emiten
  los mismos destinos con permisos distintos, omitir una superficie alli
  hace que los destinos duplicados colisionen en `conflict` — la
  seleccion es obligatoria en la practica. Para el host provisional,
  `format` es `'provisional'` y nada se auto-aplica.
- Los bytes de la propuesta se re-derivan del catalogo y la politica en
  el momento de la llamada; un archivo de propuesta editado a mano nunca
  se propaga a un destino.
- Todo artefacto generado lleva sello de provenance: frontmatter
  `metadata.generated-by`/`scopegrain-version`/`source` en Markdown,
  comentario `# generated-by` en TOML y la clave `x-scopegrain-version`
  en los `mcp_config.json` de archivo completo. Determinista (sin
  timestamps) — un archivo stale o copiado a mano se diagnostica sin
  re-renderizar.

Aplicar la activacion crea raices de host dentro del proyecto solamente
(`.claude/`, `.codex/`, `.opencode/`, `.devin/`, `.agents/`, `.cursor/`,
`.github/`, `.cline/`, `.roo/`, `.kilo/`, `.kilocode/`, `.gemini/` y
`.windsurf/`, mas el `GEMINI.md` de raiz para Gemini CLI). Nunca
escribe configuracion global de host, nunca instala hooks o plugins, y
no otorga autoaprobacion.

## Activacion y recuperacion

Inspeccionar el plan de activacion generado completo, fuente, destino,
version/superficie y ajustes existentes. La activacion requiere
aprobacion especifica para ese fixture/proyecto y cualquier herramienta,
modelo, red o costo asociado. La inicializacion no instala
hooks/plugins, no altera raices de host activas, no otorga
autoaprobacion, no registra servidores externos ni inicia MCP.

`host manifest --project PATH --host NAME [--surface X]` produce el
manifiesto de instalacion por host (paridad spec-kit): cada archivo que
la activacion generaria, con sha256 y etiqueta de propiedad —
`whole` (archivo propio del harness), `partial` (archivo del usuario con
seccion gestionada `SCOPEGRAIN`) o `shared` (propuesta manual-merge en
configuracion del host). Es un artefacto de previsualizacion de solo
lectura; escribir o aplicar sigue siendo un paso explicito aparte.

La configuracion MCP es machine-local. Una reubicacion puede dejar rutas
absolutas apuntando al proyecto o instalacion anterior; `doctor` reporta
esa condicion. El check `host-merge-targets` inspecciona ademas cada
destino `merge`/`manual` declarado (`.mcp.json`,
`.codex/config.toml`, `.devin/config.json`, `opencode.jsonc`,
`.vscode/mcp.json`, `.cursor/mcp.json`, `.roo/mcp.json`, `kilo.jsonc`,
`.gemini/settings.json`, ...) y
verifica que el bloque `scopegrain` fusionado siga presente e integro —
un destino ausente o con la fusion perdida falla el check. El rebinding
requiere revision del nuevo destino, no un reemplazo silencioso. La
restauracion de recursos solo recupera bytes canonicos ausentes
compatibles; no sobrescribe archivos divergentes ni reconecta un
servicio MCP remoto.

`uninstall` deriva su conjunto de borrado de la configuracion actual, no del
journal de lo generado. Si el conjunto de `hosts` se reduce despues de
`init`, las propuestas nativas de los hosts retirados, sus puntos de entrada
en la raiz y los artefactos que divergieron sobreviven a `uninstall
--apply` y requieren una segunda pasada manual; los registros de tarea se
preservan por diseno. Medido en el fixture del piloto OpenCode del
2026-11-23: 235 archivos borrados, 103 directorios retirados, 2 divergentes
reportados como `leftBehind` y 532 propuestas obsoletas que hubo que
retirar a mano.

El CLI portable funciona sin registro nativo. Su servidor MCP vinculado
al proyecto es una superficie de consulta stdio opcional, no un ejecutor
remoto mutante.
Ver [onboarding](onboarding.md), [seguridad](security.md) y
[verificacion](verification.md).

## Pilotos nativos

Devin Local completo su piloto en una sesion fresca real el 2026-11-17 y
Antigravity App/CLI completo el suyo el 2026-11-19 (ver Estado arriba);
OpenCode V2 completo el suyo el 2026-11-23. Devin Cloud permanece fuera
del alcance del piloto de Devin. Para cada otra version/superficie
seleccionada — Claude, Codex, la superficie IDE de Antigravity, el
provisional Hermes y los cinco de la tier 2b — aprobar separadamente un piloto
aislado: verificar descubrimiento e invocacion, herramientas reales de
roles y denegaciones de escritura, efectos MCP/red no aprobados,
delegacion, interrupcion/reanudacion, recuperacion sin repetir efectos y
limpieza solo de la configuracion propia aprobada. Conservar transcripts,
versiones reales, logs y diffs completos. El exito en un host o superficie
no valida a otro.

### Procedimiento de validacion de piloto

Procedimiento manual por host/superficie. Es una accion del owner: la
ejecucion requiere un host real instalado y aprobacion explicita de
cualquier herramienta, modelo, red o costo asociado.

1. **Preparacion aislada.** Proyecto fixture nuevo (no el repo de
   desarrollo): `scopegrain init`, catalogo proyectado, `host activate
   --host <H> [--surface S] --apply`. Registrar versiones reales del
   host, del runtime `node` y del OS en la evidencia.
2. **Descubrimiento.** Sesion fresca del host real: verificar que las
   skills/puentes aparecen sin pasos manuales no documentados, que el
   namespace `scopegrain-` no colisiona con built-ins y que el fragmento
   MCP carga el servidor (o permanece deshabilitado si el fragmento lo
   declara).
3. **Invocacion.** Ejecutar al menos una skill `scopegrain-*` y una
   herramienta MCP de solo lectura (p. ej. `scopegrain_status`);
   verificar salida correcta contra el estado del fixture.
4. **Denegaciones.** En rol de solo lectura intentar una operacion de
   escritura nativa y una via MCP de terceros: ambas deben fallar o
   pedir aprobacion — documentar el alcance real (la denegacion nativa
   no aísla efectos MCP externos, ver el piloto Antigravity).
5. **Interrupcion y reanudacion.** Cortar una operacion a mitad y
   reanudar: sin repeticion de efectos, sin estado corrupto.
6. **Limpieza.** Desactivar y borrar solo la configuracion aprobada del
   fixture; verificar que no quedan rastros en config global del host.
7. **Evidencia.** Conservar transcript completo, diffs de archivos
   escritos, versiones y logs. Registrar el resultado en este documento
   (Estado) con fecha — un host/superficie validado en una sesion real
   (self-run) no implica ningun otro.

Criterio de validacion: los 7 pasos ejecutados con evidencia archivada.
Criterio de fallo: cualquier paso sin verificar deja el host/superficie
como "sin piloto" — nunca "validado parcial".

## Fuentes

Los contratos de implementacion son
[native adapters](../policy/native-adapters.json) y
[native variants](../policy/native-variants.json).
Fuentes oficiales consultadas durante la migracion:

- Claude [skills](https://code.claude.com/docs/en/skills) y
  [subagents](https://code.claude.com/docs/en/sub-agents).
- Codex [descubrimiento de skills](https://github.com/openai/codex/blob/main/codex-rs/ext/skills/src/host_roots.rs)
  oficial y [cargador de roles](https://github.com/openai/codex/blob/main/codex-rs/agent-roles/src/loader.rs).
- OpenCode [commands](https://opencode.ai/docs/commands/),
  [agents](https://opencode.ai/docs/agents/),
  [MCP](https://opencode.ai/docs/mcp-servers/) y
  [fuente de migracion versionada](https://github.com/anomalyco/opencode/blob/v2.1.2/services/www/src/docs/content/migrate-v1.mdx).
- Devin [skills](https://docs.devin.ai/cli/extensibility/skills/creating-skills.md),
  [subagents](https://docs.devin.ai/cli/subagents.md) y
  [MCP](https://docs.devin.ai/cli/extensibility/mcp/configuration.md).
- Antigravity [skills](https://antigravity.google/docs/skills),
  [subagents](https://antigravity.google/docs/subagents),
  [MCP](https://antigravity.google/docs/mcp) y
  [workflows de IDE](https://antigravity.google/docs/ide/workflows).
- Cline [skills](https://docs.cline.bot/customization/skills),
  [layout de configuracion](https://docs.cline.bot/getting-started/config),
  [reglas](https://github.com/cline/cline/blob/main/docs/customization/cline-rules.mdx)
  y [MCP](https://github.com/cline/cline/blob/main/docs/mcp/mcp-overview.mdx).
- Roo Code [skills](https://github.com/RooCodeInc/Roo-Code/blob/main/apps/docs/docs/features/skills.mdx),
  [instrucciones/AGENTS.md y reglas](https://github.com/RooCodeInc/Roo-Code/blob/main/apps/docs/docs/features/custom-instructions.md),
  [slash commands](https://github.com/RooCodeInc/Roo-Code/pull/6263) y
  [MCP de proyecto](https://roocodeinc.github.io/Roo-Code/features/mcp/using-mcp-in-roo/).
- Kilo Code [skills](https://kilo.ai/docs/customize/skills),
  [workflows/slash commands](https://kilo.ai/docs/customize/workflows),
  [custom modes/agentes](https://kilo.ai/docs/customize/custom-modes),
  [subagentes](https://kilo.ai/docs/customize/custom-subagents),
  [reglas](https://kilo.ai/docs/customize/custom-rules),
  [AGENTS.md](https://kilo.ai/docs/customize/agents-md) y
  [MCP](https://kilo.ai/docs/automate/mcp/using-in-kilo-code).
- Gemini CLI [skills](https://geminicli.com/docs/cli/using-agent-skills/),
  [comandos TOML](https://geminicli.com/docs/cli/custom-commands/),
  [GEMINI.md/contexto](https://geminicli.com/docs/cli/gemini-md/) y
  [MCP](https://geminicli.com/docs/tools/mcp-server/).
- Windsurf [skills y superficie de customizacion](https://docs.windsurf.com/windsurf/cascade/skills.md)
  y [importacion de configuracion en Devin CLI](https://docs.devin.ai/cli/reference/configuration/read-config-from).
- Hermes Agent [configuracion](https://hermes-agent.nousresearch.com/docs/user-guide/configuration),
  [MCP](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp),
  [skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills)
  y [referencia de config MCP](https://hermes-agent.nousresearch.com/docs/reference/mcp-config-reference)
  — consultadas para la propuesta provisional; no verificadas contra una
  instalacion real.
