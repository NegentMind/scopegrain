---
title: Proyecciones de hosts nativos y limites
kind: guide
---
# Proyecciones de hosts nativos

> Traduccion al espanol del documento canonico en ingles
> (`en/native-hosts.md`). La version en ingles prevalece.

Scopegrain comparte procedimientos canonicos y snapshots de proyecto entre
cinco hosts documentados, mas un host provisional admitido (Hermes). Los
archivos nativos son puentes delgados, no implementaciones mantenidas de
forma independiente. El namespace `scopegrain-` evita reemplazar built-ins.

## Estado

Los formatos documentados y las pruebas locales con fixtures no son
certificacion nativa. Las comprobaciones estructurales de parseo sobre
fixtures aplicados verifican solo que los archivos generados son
sintacticamente bien formados, nunca que un binario de host real los
acepta, descubre o hace cumplir. Un piloto nativo esta certificado: una
sesion fresca real de Devin Local el 2026-11-17 auto-cargo las 42 skills
`scopegrain-*` y 15 subagentes, activo el MCP `scopegrain` desde
`.devin/mcp_config.json` e invoco `scopegrain_status` (solo lectura, 16
checks de doctor, catalogo de 130 entradas verificado por hash). Los
demas hosts — Claude, Codex, OpenCode, Antigravity y el provisional
Hermes — aun carecen de piloto nativo. La suite de fundacion completo
localmente con un archivo de test a la vez; ver
[verificacion](verification.md) para su alcance y ejecuciones anteriores
separadas.
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
| Hermes Agent (provisional) | Ninguna verificada | `~/.hermes/skills/` (global; nunca escrita) | Ninguna asumida |

Los puentes de comandos nativos de OpenCode apuntan adicionalmente a
`.opencode/commands/`. Comandos, skills y roles siguen refiriendose a los
mismos recursos canonicos configurados y al mismo runtime. Copiar un
puente sin su configuracion de proyecto y snapshot es insuficiente.

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

## Permisos y modelos

Los roles de solo lectura seleccionados reciben restricciones
especificas del host:

- Claude: lista de herramientas de lectura solicitada.
- Codex: sandbox de filesystem de solo lectura solicitado.
- OpenCode V2: denegacion solicitada de edit/shell/subagent.
- Devin: allowlist de herramientas de subagentes personalizados.
- Antigravity App/CLI: lista documentada de herramientas de lectura
  solicitada; IDE no tiene propuesta de restriccion de agentes
  personalizados porque no se asumen agentes alli.

Estos alcances no son garantias equivalentes. Validar los nombres reales
de herramientas, la denegacion efectiva, los efectos secundarios de MCP
y la politica de la organizacion dentro del host. Otros roles heredan la
politica nativa del propietario; los prompts de modelo no son un sandbox
ni un sustituto de la aplicacion nativa de permisos.

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
- `surface` selecciona un id de variante (p. ej. `app-cli`, `ide`) o una
  de sus superficies declaradas. Como las variantes de Antigravity emiten
  los mismos destinos con permisos distintos, omitir una superficie alli
  hace que los destinos duplicados colisionen en `conflict` — la
  seleccion es obligatoria en la practica. Para el host provisional,
  `format` es `'provisional'` y nada se auto-aplica.
- Los bytes de la propuesta se re-derivan del catalogo y la politica en
  el momento de la llamada; un archivo de propuesta editado a mano nunca
  se propaga a un destino.

Aplicar la activacion crea raices de host dentro del proyecto solamente
(`.claude/`, `.codex/`, `.opencode/`, `.devin/`, `.agents/`). Nunca
escribe configuracion global de host, nunca instala hooks o plugins, y
no otorga autoaprobacion.

## Activacion y recuperacion

Inspeccionar el plan de activacion generado completo, fuente, destino,
version/superficie y ajustes existentes. La activacion requiere
aprobacion especifica para ese fixture/proyecto y cualquier herramienta,
modelo, red o costo asociado. La inicializacion no instala
hooks/plugins, no altera raices de host activas, no otorga
autoaprobacion, no registra servidores externos ni inicia MCP.

La configuracion MCP es machine-local. Una reubicacion puede dejar rutas
absolutas apuntando al proyecto o instalacion anterior; `doctor` reporta
esa condicion. El rebinding requiere revision del nuevo destino, no un
reemplazo silencioso. La restauracion de recursos solo recupera bytes
canonicos ausentes compatibles; no sobrescribe archivos divergentes ni
reconecta un servicio MCP remoto.

El CLI portable funciona sin registro nativo. Su servidor MCP vinculado
al proyecto es una superficie de consulta stdio opcional, no un ejecutor
remoto mutante.
Ver [onboarding](onboarding.md), [seguridad](security.md) y
[verificacion](verification.md).

## Pilotos nativos

Devin Local completo su piloto en una sesion fresca real el 2026-11-17
(ver Estado arriba); Devin Cloud permanece fuera de su alcance. Para
cada otra version/superficie seleccionada — Claude, Codex, OpenCode,
Antigravity y el provisional Hermes — aprobar separadamente un piloto
aislado:
verificar descubrimiento e invocacion, herramientas reales de roles y
denegaciones de escritura, efectos MCP/red no aprobados, delegacion,
interrupcion/reanudacion, recuperacion sin repetir efectos y limpieza
solo de la configuracion propia aprobada. Conservar transcripts,
versiones reales, logs y diffs completos. El exito en un host o
superficie no certifica a otro.

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
- Hermes Agent [configuracion](https://hermes-agent.nousresearch.com/docs/user-guide/configuration),
  [MCP](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp),
  [skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills)
  y [referencia de config MCP](https://hermes-agent.nousresearch.com/docs/reference/mcp-config-reference)
  — consultadas para la propuesta provisional; no verificadas contra una
  instalacion real.
