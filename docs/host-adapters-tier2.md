---
title: Evaluacion de adaptadores de host tier 2
kind: analysis
---
# Evaluacion de adaptadores de host tier 2

Analisis de candidatos restantes para `policy/native-adapters.json` tras la
incorporacion de `copilot` y `cursor`. Es un documento de evaluacion, no un
plan de implementacion: ningun formato aqui esta certificado; cada uno exigiria
el mismo ciclo de fuentes verificadas, policy declarativa y piloto nativo que
los adaptadores existentes. La existencia de scaffolding de adaptador no
declara soporte de producto: la matriz de README clasifica `copilot` y
`cursor` como `absent` mientras no se declare una integracion `supported` o
`experimental`.

## Estado de la tier actual

| Host | Superficies cubiertas |
| --- | --- |
| copilot | `.github/copilot-instructions.md` (entrypoint con seccion gestionada), `.agents/skills/<n>/SKILL.md`, `.github/agents/<n>.md`, merge `.vscode/mcp.json` (`servers`) |
| cursor | `AGENTS.md`, `.cursor/skills/<n>/SKILL.md`, `.cursor/agents/<n>.md` (`readonly` para roles de solo lectura), `.cursor/rules/scopegrain.mdc` (`alwaysApply`), merge `.cursor/mcp.json` (`mcpServers`) |

## Candidatos

### gemini-cli

- **Formato**: contexto via `GEMINI.md`/`AGENTS.md`; comandos personalizados en
  `.gemini/commands/<name>.toml` (TOML con `prompt` y `description`); MCP en
  `.gemini/settings.json` bajo `mcpServers`; la cobertura de skills
  (`.gemini/skills`) requiere verificacion de fuente antes de declararla.
- **Coste**: MEDIO. El modelo declarativo exige `commandFormat` cerrado
  (`skill|markdown`); los comandos TOML requieren extender el enum, el
  validador y una rama de render (comparable a la rama TOML de codex para
  agentes). El resto (entrypoint, fragmento MCP) es el patron ya existente.
- **Prioridad**: MEDIA. Cuota relevante pero el comando TOML es el unico
  candidato que exige tocar el contrato del renderer.

### cline / roo code / kilo code

- **Formato**: los tres leen `AGENTS.md` y directorios de reglas markdown
  (`.clinerules/`, `.roo/rules/`, `.kilocode/rules/`); skills tipo
  `SKILL.md` verificables por fuente; MCP: cline usa
  `cline_mcp_settings.json` (ruta global, merge manual), roo
  `.roo/mcp.json`, kilo `.kilocode/mcp.json` (shape `mcpServers`).
- **Coste**: BAJO. Todo markdown declarativo: un bloque de policy por host
  mas una regla `*.md` por directorio (mismo mecanismo que el `.mdc` de
  cursor) y una entrada de fragmento MCP en `render.mjs`. Tres hosts por
  el coste de uno.
- **Prioridad**: ALTA. Maxima cobertura por linea de codigo; el riesgo es
  documental (las tres familias divergen en detalles de frontmatter de
  reglas), no estructural.

### windsurf

- **Formato**: `AGENTS.md` + `.windsurf/rules/` markdown; MCP global en
  `~/.codeium/windsurf/mcp_config.json` (nunca escribible: destino global).
- **Coste**: BAJO como variante de devin (familia Cognition/Codeium): bloque
  de policy con raices `.windsurf/` y entrypoint AGENTS.md ya existente. El
  MCP global quedaria clasificado manual-only como en hermes.
- **Prioridad**: MEDIA-BAJA. Superficie solapada con devin; el valor real es
  la deteccion del host, no nuevos formatos.

## Recomendacion

1. **cline/roo/kilo** primero: coste bajo agrupable, sin cambios de contrato.
2. **gemini-cli** despues, solo si se acepta extender `commandFormat` con un
   dialecto TOML de comandos; es el unico cambio de schema del lote.
3. **windsurf** al final: barato pero redundante con devin; hacerlo si la
   deteccion por senales lo justifica.

Todo candidato entra como `compatibility: documented-only` y exige piloto
nativo antes de cualquier afirmacion de soporte.

## Estado de implementacion (2026-11-24)

Los cinco candidatos se implementaron tras verificar las convenciones
reales contra documentacion oficial vigente (fuentes en los bloques de
`policy/native-adapters.json`). Divergencias respecto a la evaluacion:

- **kilo**: el producto actual (kilo.ai, derivado de OpenCode) usa raices
  `.kilo/` y `kilo.jsonc` con clave `mcp` (`type: "local"`), no
  `.kilocode/mcp.json`. El adaptador apunta a `.kilo/`; el puente de reglas
  usa `.kilocode/rules/` porque es el directorio legacy que la doc declara
  auto-incluido (`.kilo/rules/` solo carga via globs `instructions`).
- **cline**: los subagentes son archivos `.yaml` bajo `.cline/agents`
  (solo CLI/Desktop, segun el cargador del repo) — no se emiten puentes
  de agente. Su MCP es solo global
  (`~/.cline/data/settings/cline_mcp_settings.json`; la extension VS Code
  usa globalStorage).
- **roo**: sin superficie de agentes markdown (los modes son YAML);
  skills `.roo/skills/` verificados desde v3.38.0; comandos
  `.roo/commands/`, AGENTS.md con `useAgentRules` activado por defecto.
- **gemini-cli**: implementado — la extension `commandFormat: 'toml'`
  resulto acotada (enum + validador + una rama de render). Skills
  `.gemini/skills/` verificadas en doc y fuente; entrypoint `GEMINI.md`
  (AGENTS.md es opt-in via `context.fileName`); sin agentes.
- **windsurf**: implementado como variante de la superficie legacy
  Cascade (`.windsurf/skills|workflows|rules`, `AGENTS.md`). Su producto
  renombrado Devin Desktop lee las raices `.devin/` del adaptador devin
  existente; el MCP es solo global
  (`~/.codeium/windsurf/mcp_config.json`).

Cambio de contrato asociado: `agentRoot`/`agentFormat` son ahora
opcionales en la policy — los hosts sin superficie de agente markdown
documentada simplemente no la declaran, y la ausencia de puentes
`agent/*` queda clasificada estructural en paridad. Los destinos MCP
globales usan `kind: 'mcp-global'` para que la clasificacion
GLOBAL_DEST los excluya de los merge targets de `doctor`.

Ninguno tiene piloto nativo: `compatibility: documented-only` para los
cinco.
