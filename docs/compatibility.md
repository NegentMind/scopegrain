# Compatibilidad y fuentes oficiales

Alcance: puntos de entrada, catalogo portable, CLI/MCP de consulta y
propuestas de puentes nativos para cinco anfitriones documentados mas uno
provisional (Hermes). La compatibilidad documental no
certifica comportamiento equivalente entre productos.

## Matriz por anfitrion

| Anfitrion | Punto de entrada | Propuesta MCP generada | Estado |
| --- | --- | --- | --- |
| Claude Code | `CLAUDE.md` (raiz) | `integrations/claude-mcp.json` con `mcpServers.scopegrain` (`type: stdio`) | Documental; requiere aprobacion del usuario en el anfitrion |
| Codex | `AGENTS.md` (raiz) | `integrations/codex-mcp.toml` (`[mcp_servers.scopegrain]`) | Documental; el proyecto requiere trust en Codex |
| OpenCode V2 | `AGENTS.md` (raiz) | `integrations/opencode-mcp.json` (`mcp.servers.scopegrain`, `disabled:true`) | Documental; sin certificacion nativa |
| Devin Local/CLI | `AGENTS.md` (raiz) | `integrations/devin-mcp.json` (`mcpServers.scopegrain` sin `type`) y `.devin/mcp_config.json` generado por `host activate` (v3000.3+) | Piloto certificado en sesion real de Local (2026-11-17); Devin Cloud no se considera equivalente |
| Google Antigravity | Propuestas App/CLI e IDE diferenciadas; `host activate` requiere `--surface app-cli|ide` (variantes `selectionRequired`) | `integrations/antigravity-mcp.json` (propuesta deshabilitada de fusion manual) y `.agents/mcp_config.json` con rutas absolutas machine-local generado por `host activate --surface ... --apply` | Piloto App/CLI certificado en sesion real (2026-11-19); IDE sin piloto ni agentes asumidos |

## Notas por fuente

- **Claude Code:** la memoria de proyecto es `./CLAUDE.md`. El soporte de
  AGENTS.md varia por precedencia de nombre entre productos, por eso se
  conserva un entrypoint explicito por anfitrion. El fragmento usa el
  formato `.mcp.json` documentado (`mcpServers.<name>.type=stdio`,
  `command`, `args`); el primer arranque pide aprobacion en el anfitrion.
- **Codex:** `AGENTS.md` se carga desde la raiz del proyecto. El fragmento
  TOML replica la forma `[mcp_servers.<name>]` con `command` y `args`; se
  usan rutas absolutas porque el contexto de cwd no esta garantizado.
- **OpenCode:** `AGENTS.md` es el punto de entrada documentado. Las
  referencias externas en texto plano no se expanden automaticamente, por
  eso el entrypoint instruye leer el archivo de instrucciones. El fragmento
  usa el formato V2 `mcp.servers.<name>` con `type:"local"`,
  `command:[...]`, `disabled:true`. Ya no se genera una propuesta V1; los
  archivos V1 existentes no se eliminan. Su antigua ruta se conserva
  reservada para evitar colisiones.
- **Devin Local/CLI:** `AGENTS.md` en la raiz es la recomendacion oficial;
  Local comparte las customizaciones del CLI. Desde Devin v3000.3 el MCP
  de proyecto vive en el archivo dedicado `.devin/mcp_config.json` (scope
  de proyecto, compartido via VCS); `host activate --host devin` lo
  genera como archivo completo create-only (conflicto si existe uno
  divergente; nunca se sobrescribe). En versiones anteriores el
  equivalente era la clave `mcpServers` dentro de `.devin/config.json`
  (las entradas antiguas se migran automaticamente al archivo dedicado):
  la propuesta nativa `.devin/config.json` y el fragmento
  `integrations/devin-mcp.json` siguen generandose para ese merge manual
  y para el scope de usuario. El scope de usuario es
  `~/.config/devin/mcp_config.json` (`%APPDATA%\devin\mcp_config.json` en
  Windows) y el override local gitignored `.devin/mcp_config.local.json`.
  `.devin/mcp_config.json` contiene rutas absolutas de la maquina y no es
  portable entre equipos: regenerarlo por maquina con
  `host activate --host devin --apply` tras mover el proyecto o la
  instalacion (la regeneracion es create-only; si el archivo existente
  difiere, el plan informa conflicto y el owner reconcilia — tipicamente
  borrando el archivo obsoleto y re-aplicando). Devin no expande
  variables de entorno en este archivo, asi que no existe templating.
  No se afirma paridad con Devin Cloud.
- **Antigravity:** App/CLI e IDE no se equiparan. La propuesta App/CLI
  incluye roles; la de IDE solo skills. La convencion `.agents/` compartida
  con otros productos no da aislamiento. Ver
  [variantes, permisos y fuentes](native-hosts.md).

## Lo que NO se hace

- Los puentes nativos se generan como propuestas bajo el espacio propio;
  no se instalan hooks ni se activan permisos, subagentes o perfiles.
- Las diferencias de schemas y alcance de permisos estan documentadas
  en [integraciones nativas](native-hosts.md); no se presupone equivalencia.
- No se mezclan fragmentos con configuraciones existentes del anfitrion.
- No se registra ningun servidor ni servicio; el usuario revisa y aplica
  cada propuesta manualmente.
- `serverPath` y la ruta del proyecto (`--project`) son absolutas y
  machine-local; `--config` va como token relativo POSIX contenido en el
  proyecto (es lo que `loadConfig` acepta). Esto aplica a TODOS los
  artefactos MCP generados: los fragmentos `integrations/<host>-mcp.*`
  (Claude `.mcp.json`, Codex `[mcp_servers]` TOML, OpenCode V2, Devin,
  Antigravity, Hermes) y tambien el archivo de anfitrion
  `.devin/mcp_config.json` que la activacion de Devin escribe en raiz —
  ninguno es portable entre maquinas. Revisar y reconciliar las
  propuestas tras mover la instalacion o el proyecto; en el caso de
  `.devin/mcp_config.json` la regeneracion por maquina es
  `host activate --host devin --apply` (create-only: un destino
  divergente es conflicto, nunca sobrescritura). `doctor` informa las
  referencias obsoletas; no las corrige silenciosamente ni activa el
  destino nuevo.

## Fuentes oficiales consultadas

- [Claude Code — memory](https://code.claude.com/docs/en/memory) — memoria de proyecto `./CLAUDE.md`
- [Claude Code — MCP quickstart](https://code.claude.com/docs/en/mcp-quickstart) — `.mcp.json` `mcpServers` stdio
- [openai/codex — agents_md.rs](https://github.com/openai/codex/blob/main/codex-rs/core/src/agents_md.rs) — `AGENTS.md` raiz->cwd
- [openai/codex — mcp_types.rs](https://github.com/openai/codex/blob/main/codex-rs/config/src/mcp_types.rs) — `[mcp_servers.*]` command/args
- [OpenCode — rules](https://opencode.ai/docs/rules) — `AGENTS.md` (redirect a [docs.opencode.ai](https://docs.opencode.ai/docs/rules/))
- [OpenCode — MCP servers](https://opencode.ai/docs/mcp-servers/) — V2 `mcp.servers.<name>`, `disabled`; no confundir con V1
- [Devin — rules](https://docs.devin.ai/cli/extensibility/rules) — `AGENTS.md` en raiz
- [Devin — MCP configuration](https://docs.devin.ai/cli/extensibility/mcp/configuration) — `mcp_config.json` `mcpServers`
- [Devin — local customizations](https://docs.devin.ai/desktop/devin-local/customizations.md) — Local comparte CLI
