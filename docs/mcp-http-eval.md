# Evaluación: transporte HTTP Streamable para el servidor MCP

> Evaluación de la auditoría 2026-11-24. Estado: **el servidor MCP es
> hoy exclusivamente stdio** (`src/mcp/server.mjs:805-812`,
> `server.json` declara `"transport": {"type": "stdio"}`). No existe
> código HTTP-MCP. Esto es una evaluación de diseño, no un plan de
> implementación autorizado.

## 1. Estado real verificado

| Pieza | Estado | Referencia |
|---|---|---|
| Transporte | `StdioServerTransport` único; el módulo no arranca nada al importarse | `src/mcp/server.mjs:805-812` |
| Separación server/transporte | `createMCPServer({project,config})` devuelve `{server, ctx}` **sin conectar transporte** — seam de inyección ya existente | `src/mcp/server.mjs:787-803` |
| Herramientas | 37 tools con handlers que cierran sobre un único `ctx` (un proyecto, una config); input estricto vía `strictify` + zod `.strict()`; anotaciones honestas (`readOnlyHint`, `openWorldHint`) | `src/mcp/server.mjs:139-166, 169-779` |
| SDK | `@modelcontextprotocol/sdk@1.32.2` incluye `server/streamableHttp.js` (`StreamableHTTPServerTransport`) y middlewares de auth (`server/auth/`) | `node_modules/@modelcontextprotocol/sdk/dist/esm/server/` |
| Patrón reusable | `src/api/server.mjs`: bind sólo a literales loopback (`LOOPBACK_HOSTS`), guard anti-DNS-rebinding `requestOriginAllowed` (Host debe ser literal loopback/`localhost`; Origin, si viene, idem), rutas whitelisted, cuerpo acotado | `src/api/server.mjs:28-32, 222-262, 276-303` |

## 2. Qué exige el transporte Streamable HTTP (spec MCP)

- Endpoint único que acepta `POST` (JSON-RPC), `GET` (stream SSE para
  mensajes servidor→cliente) y `DELETE` (cierre de sesión).
- Cabecera `Mcp-Session-Id` en modo con estado; modo *stateless*
  disponible (un transporte por petición).
- **Seguridad obligatoria según la spec**: validación de `Origin`
  (mitigación DNS rebinding — exactamente el patrón de
  `requestOriginAllowed`), bind loopback recomendado para servidores
  locales, y autenticación (OAuth 2.1 como resource server; para un
  endpoint loopback un bearer token estático es la opción mínima
  honesta).

## 3. Coste real estimado

Componentes sobre el seam existente:

| Pieza | LOC est. | Notas |
|---|---|---|
| Servidor `node:http` + routing del endpoint | ~60-90 | Reusar la forma de `createApiServer` (bind literal, `MAX_URL_BYTES`, cuerpo acotado — `readBoundedBody` ya existe) |
| Guard Host/Origin | ~40 | Copiar `requestOriginAllowed`/`TRUSTED_HOSTNAMES` casi verbatim; la spec lo exige |
| Auth bearer | ~30-60 | Comparación de `Authorization: Bearer <token>` (timing-safe); token generado al arranque o en config, nunca en argv visible |
| Sesiones | ~50-120 | Dos opciones: **stateless** (transporte nuevo por request — viable porque los tools no guardan estado de sesión MCP) o **stateful** (mapa `sessionId → transport`, TTL, limpieza en DELETE) |
| Verbo CLI + wiring | ~30 | `mcp --transport http [--host 127.0.0.1 --port N]` (propuesta) |

**Total realista: ~200-350 LOC** en un nuevo `src/mcp/http.mjs` +
toques en `cli.mjs`. La estimación del encargo (150-300) es correcta en
magnitud, quizá optimista si se incluye gestión de sesiones stateful
con ciclo de vida completo.

Lo que NO cambia: los 37 tools, `strictify`, zod, `createMCPServer` —
todo eso es agnóstico al transporte por diseño del SDK.

## 4. Riesgos añadidos (FMEA)

| Riesgo | Mitigación | Residual |
|---|---|---|
| DNS rebinding desde navegador | `requestOriginAllowed` (Host+Origin loopback literal) — patrón ya probado en `api-server.test.mjs` | Bajo si se reusa verbatim |
| Endpoint sin auth en loopback | Token bearer + bind literal | Cualquier proceso local del usuario podría leer el token si vive en disco legible — mismo límite que todo el threat model |
| Fuga de stdout | n/a — HTTP no usa stdio; el log actual a stderr se mantiene | Ninguno |
| Sesiones zombie | TTL + límite de sesiones + `server.close()` en SIGTERM | Medio si es stateful; nulo en stateless |
| `Mcp-Session-Id` replay | UUID v4 + mapa en memoria | Bajo en loopback |
| Mayor superficie vs stdio | Inherente: stdio hereda el aislamiento del proceso padre (spawn por el host); HTTP expone un socket a TODO proceso local | Este es el coste principal, no las LOC |

## 5. Cuándo merece la pena

- **Sí**: hosts/consumidores que no pueden spawn-stdio — cliente MCP en
  contenedor, IDE web, un gateway que multiplexa varios proyectos,
  acceso desde otra máquina de la LAN (que exigiría además TLS + auth
  real — fuera del alcance local-first).
- **No ahora**: los cinco hosts soportados (`devin`, `claude`, `codex`,
  `antigravity`, `opencode`) consumen MCP por stdio; `server.json` ya
  declara stdio para el registry. Ningún consumidor real pide HTTP hoy.

## 6. Recomendación

**Diferir.** Stdio es estrictamente superior para el caso de uso actual:
cero superficie de socket, auth heredada del spawn, y es el transporte
que los hosts y el MCP Registry esperan. El coste no son las ~300 LOC —
es mantener una segunda superficie de seguridad (auth, sesiones,
rebinding) con su propio conjunto de tests y threat model.

Si aparece un consumidor concreto que lo necesite, la vía de menor
riesgo es:

1. Nuevo `src/mcp/http.mjs` reusando `createMCPServer` (el seam ya
   existe).
2. Copiar literalmente `LOOPBACK_HOSTS`/`TRUSTED_HOSTNAMES`/
   `requestOriginAllowed` de `src/api/server.mjs` (o extraerlos a un
   módulo compartido — mejor, evita divergencia).
3. Modo **stateless** por defecto (los tools no usan estado de sesión
   MCP); stateful sólo si un cliente lo exige.
4. Bearer token obligatorio incluso en loopback; puerto efímero por
   defecto (`port: 0`).
5. Actualizar `server.json` sólo si el registry admite declarar
   transportes alternativos (verificar en el momento; hoy declara
   stdio).
