# Visor (bloque G)

> Traduccion al espanol del documento canonico en ingles
> (`en/viewer.md`). La version en ingles prevalece.

Visor local de solo lectura para los stores de Scopegrain. Dos piezas:

- `src/api/` - una API JSON solo-localhost sobre los stores configurados
  (`node:http`, cero dependencias, solo GET).
- `viewer/` - un paquete autocontenido Vite + React + TypeScript +
  Tailwind + shadcn/ui que renderiza los datos de la API.

La API expone lo que ya existe en disco a traves de los getters del core
y las ubicaciones de los stores. No escribe, no muta, no adopta
archivos, no ejecuta comandos ni activa hosts. Es una superficie de
conveniencia local, no un host de produccion: no hay autenticacion mas
alla del bind a loopback, no hay modelo multi-usuario ni TLS. No exponer
el puerto.

## Ejecucion

```powershell
scopegrain view --project PATH [--host 127.0.0.1|::1] [--port N]
```

`view` inicia la API de loopback y, cuando el build del visor se
distribuye con el paquete (`viewer/dist`), lo monta en el mismo origen:
`/` sirve la SPA con fallback a `index.html` para rutas de cliente, los
assets con hash bajo `/assets/` son inmutables en cache y los escapes
por traversal se rechazan. Sin un build presente, la API sola sigue
respondiendo bajo `/api`.

Iniciada desde el modulo:

```js
import { createApiServer } from './src/api/server.mjs';

const api = createApiServer({
  project: 'C:/path/to/project',   // explicit project root (required)
  config: '.scopegrain/config.json', // optional project-relative override
  host: '127.0.0.1',               // default; loopback only
  port: 7731,                      // default; 0 = ephemeral
});
const { host, port } = await api.listen();
// ... await api.close();
```

`createApiServer` resuelve el contexto de forma anticipada, de modo que
un proyecto o config invalido falla antes de que el socket se abra. El
host debe ser el literal `127.0.0.1` o `::1`; `localhost`, `0.0.0.0`,
`::` y cualquier otro nombre lanzan `INVALID_HOST` antes del binding. El
binding de workspace usado por los endpoints de journal y captures es el
mismo grant de todas las areas que usa el CLI local.

Visor (desarrollo):

```powershell
cd viewer
npm install
npm run dev          # http://127.0.0.1:5173, /api proxied to the API
```

El dev server de Vite proxea `/api` a `VITE_API_TARGET` (por defecto
`http://127.0.0.1:7731`), de modo que no se necesita ni se concede CORS.
`npm run build` hace typecheck (`tsc --noEmit`) y emite `dist/`; `npm
run typecheck` ejecuta solo el gate de tipos.

## Endpoints

Todas las respuestas son JSON. Los errores usan `{error:{code,message}}`
con el status HTTP correspondiente: `*_NOT_FOUND` 404,
`INVALID_*`/`UNKNOWN_*` 400, `*_MALFORMED`/`*_DRIFT`/
`DOCUMENT_TOO_LARGE` 422, `SCOPE_DENIED` 403,
`*_CONFLICT`/`WORKSPACE_STALE` 409, cualquier otra cosa 500. Metodos
no-GET sobre cualquier ruta devuelven 405; rutas desconocidas 404;
parametros de query desconocidos 400.

| Endpoint | Payload |
| --- | --- |
| `GET /api/health` | `{status, api, schemaVersion, serverTime}` |
| `GET /api/workspace` | resumen del proyecto, descriptor de workspace (o `null` cuando no esta enrolado), conteos de stores, areas |
| `GET /api/tasks?limit=&offset=` | resumenes de tareas + `malformed[]` + `truncated` |
| `GET /api/tasks/:id` | registro de tarea completo (`contract`/`authorContext` truncados) |
| `GET /api/tasks/:id/doc` | documento de tarea renderizado (`<paths.tasks>/<uuid>.md` via `task doc`) o `doc: null` |
| `GET /api/plans` | planes + readiness por tarea (o `readinessError`) + `malformed[]` |
| `GET /api/plan-docs` | listado de archivos de plan (`<paths.plans>/*.md`: nombre, bytes, updatedAt) |
| `GET /api/plan-docs/:name` | contenido de un archivo de plan (slug `*.md` acotado al dir de planes) |
| `GET /api/plans/:key` | documento de plan + readiness |
| `GET /api/artifacts?kind=&limit=&offset=` | `kind` requerido, uno de `spec design report research decision lesson handoff review` |
| `GET /api/artifacts/:kind/:id` | documento de artefacto (`body` truncado) |
| `GET /api/journal/operations?limit=&offset=` | resumenes de operaciones: `state`, `eventCount`, `sourceKinds`, `recordIds` |
| `GET /api/journal/operations/:id` | intent completo con eventos + recibo de recuperacion |
| `GET /api/captures?limit=&offset=` | `status` por captura + `ownershipConfirmed` + registro acotado o error |

Valores de `state` de las operaciones del journal: `committed`,
`prepared` (sin confirmar), `abandoned`. Valores de `status` de
capturas:

| status | significado |
| --- | --- |
| `proved` | sidecar canonico + operacion committed de dos eventos + bytes actuales iguales al snapshot |
| `drifted` | los bytes fuente actuales difieren del snapshot probado (`CAPTURE_SOURCE_CHANGED`) |
| `unconfirmed` | la operacion propietaria no esta committed (`CAPTURE_NOT_COMMITTED`) |
| `unproved` | no se encontro prueba de ownership (`CAPTURE_NOT_FOUND`) |
| `malformed` | la prueba o el registro fallo la validacion (`CAPTURE_MALFORMED`) |
| `error` | cualquier otro fallo de lectura |

## Limites

- `limit` por defecto es 200, maximo 500; `offset` es un entero no
  negativo.
- Los escaneos de directorio se limitan a 501 entradas; mas alla de eso
  la respuesta lleva `truncated: true`.
- El `body` de artefactos se trunca en 16384 caracteres con
  `[truncated by api]` y un flag `bodyTruncated`; el `summary` de
  capturas en 4096; `contract`/`authorContext`/`title` de tareas en
  2048.
- Las entradas malformed se exponen en `malformed[]` (`file` + `{code,
  message}`), nunca se descartan silenciosamente - mismo contrato que
  `listTasks`.
- URIs de request de mas de 4096 bytes devuelven 414. Nunca se lee un
  body de request.

La API solo lee dentro de las rutas de store configuradas
(`paths.tasks/plans/reports/research/decisions/memory/state`); ningun
acceso dinamico al filesystem se deriva del input del request mas alla
de la validacion UUID/slug.

## No objetivos

- Sin escrituras, mutaciones, acciones de recuperacion, envio de acks ni
  previews.
- Sin autenticacion, autorizacion ni aislamiento multi-usuario. El bind
  a loopback es todo el limite de acceso; la API no es un host de
  produccion.
- Sin websockets ni push - el visor hace polling/refresco.
- Sin adopcion de archivos plausibles: las lecturas pasan por los mismos
  getters estrictos y pruebas de ownership que el CLI; los datos
  almacenados malformed emergen como errores, no como conjeturas.
- Los endpoints con scope de workspace (`journal`, `captures`) devuelven
  `WORKSPACE_NOT_FOUND` (404) en proyectos no enrolados;
  `/api/workspace` sigue respondiendo con `workspace: null`.

## Estructura del visor

```
viewer/
  src/lib/api.ts       typed client mirroring the endpoint schemas
  src/lib/useApi.ts    loading/error/reload fetch hook
  src/components/ui/   shadcn/ui vendored components (radix-nova style)
  src/components/      StatusBits (badges, error/empty/skeleton), PlansCard
  src/views/           WorkspaceView, TasksView, JournalView,
                       ArtifactsView, CapturesView
```

Vistas: resumen del workspace (proyecto, conteos, areas enroladas,
readiness de planes); items de trabajo (lista de tareas + detalle,
badges de estado); journal (operaciones, listado por evento);
artefactos (tabs por kind; cadena spec/design/report, superficie de
binding de specs); capturas (badges de prueba de ownership, scopes de
areas). Solo lectura: no hay affordances de mutacion en la UI.
