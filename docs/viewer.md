# Viewer (block G)

Read-only local viewer for Scopegrain stores. Two pieces:

- `src/api/` - a localhost-only JSON API over the configured stores
  (`node:http`, zero dependencies, GET-only).
- `viewer/` - a self-contained Vite + React + TypeScript + Tailwind +
  shadcn/ui package that renders the API data.

The API exposes what already exists on disk through the core getters and
store locations. It does not write, mutate, adopt files, execute commands
or activate hosts. It is a local convenience surface, not a production
host: there is no authentication beyond the loopback bind, no multi-user
model and no TLS. Do not expose the port.

## Running

The CLI wiring lands in a later wave; today the server is started from the
module:

```js
import { createApiServer } from './src/api/server.mjs';

const api = createApiServer({
  project: 'C:/path/to/project',   // explicit project root (required)
  config: '.tasksystem/config.json', // optional project-relative override
  host: '127.0.0.1',               // default; loopback only
  port: 7731,                      // default; 0 = ephemeral
});
const { host, port } = await api.listen();
// ... await api.close();
```

`createApiServer` resolves the context eagerly, so a bad project or config
fails before the socket opens. The host must be the literal `127.0.0.1`
or `::1`; `localhost`, `0.0.0.0`, `::` and any other name throw
`INVALID_HOST` before
binding. The workspace binding used by journal and capture endpoints is
the same all-areas grant the local CLI uses.

Viewer (development):

```powershell
cd viewer
npm install
npm run dev          # http://127.0.0.1:5173, /api proxied to the API
```

The Vite dev server proxies `/api` to `VITE_API_TARGET`
(default `http://127.0.0.1:7731`), so no CORS is needed or granted.
`npm run build` typechecks (`tsc --noEmit`) and emits `dist/`; `npm run
typecheck` runs the type gate alone.

## Endpoints

All responses are JSON. Errors use `{error:{code,message}}` with matching
HTTP status: `*_NOT_FOUND` 404, `INVALID_*`/`UNKNOWN_*` 400,
`*_MALFORMED`/`*_DRIFT`/`DOCUMENT_TOO_LARGE` 422, `SCOPE_DENIED` 403,
`*_CONFLICT`/`WORKSPACE_STALE` 409, anything else 500. Non-GET methods on
any path return 405; unknown paths 404; unknown query parameters 400.

| Endpoint | Payload |
| --- | --- |
| `GET /api/health` | `{status, api, schemaVersion, serverTime}` |
| `GET /api/workspace` | project summary, workspace descriptor (or `null` when not enrolled), store counts, areas |
| `GET /api/tasks?limit=&offset=` | task summaries + `malformed[]` + `truncated` |
| `GET /api/tasks/:id` | full task record (`contract`/`authorContext` capped) |
| `GET /api/plans` | plans + per-task readiness (or `readinessError`) + `malformed[]` |
| `GET /api/plans/:key` | plan document + readiness |
| `GET /api/artifacts?kind=&limit=&offset=` | `kind` required, one of `spec design report research decision lesson handoff review` |
| `GET /api/artifacts/:kind/:id` | artifact document (`body` capped) |
| `GET /api/journal/operations?limit=&offset=` | operation summaries: `state`, `eventCount`, `sourceKinds`, `recordIds` |
| `GET /api/journal/operations/:id` | full intent with events + recovery receipt |
| `GET /api/captures?limit=&offset=` | per-capture `status` + `ownershipConfirmed` + scoped record or error |

Journal operation `state` values: `committed`, `prepared` (unconfirmed),
`abandoned`. Capture `status` values:

| status | meaning |
| --- | --- |
| `proved` | sidecar canonical + committed two-event operation + current bytes equal the snapshot |
| `drifted` | current source bytes differ from the proved snapshot (`CAPTURE_SOURCE_CHANGED`) |
| `unconfirmed` | owning operation is not committed (`CAPTURE_NOT_COMMITTED`) |
| `unproved` | no ownership proof found (`CAPTURE_NOT_FOUND`) |
| `malformed` | proof or record failed validation (`CAPTURE_MALFORMED`) |
| `error` | any other read failure |

## Bounds

- `limit` defaults to 200, max 500; `offset` is a non-negative integer.
- Directory scans cap at 501 entries; beyond that the response carries
  `truncated: true`.
- Artifact `body` truncates at 16384 chars with `[truncated by api]` and a
  `bodyTruncated` flag; capture `summary` at 4096; task `contract`/
  `authorContext`/`title` at 2048.
- Malformed entries are surfaced in `malformed[]` (`file` + `{code,
  message}`), never silently dropped - same contract as `listTasks`.
- Request URIs over 4096 bytes return 414. No request body is ever read.

The API reads only inside the configured store paths
(`paths.tasks/plans/reports/research/decisions/memory/state`); no dynamic
filesystem access derives from request input beyond UUID/slug validation.

## Non-goals

- No writes, mutations, recovery actions, ack submission or previews.
- No authentication, authorization or multi-user isolation. The loopback
  bind is the entire access boundary; the API is not a production host.
- No websockets or push - the viewer polls/refreshes.
- No adoption of plausible files: reads go through the same strict
  getters/ownership proofs as the CLI; malformed stored data surfaces as
  errors, not guesses.
- Workspace-scoped endpoints (`journal`, `captures`) return
  `WORKSPACE_NOT_FOUND` (404) on unenrolled projects; `/api/workspace`
  still answers with `workspace: null`.

## Viewer structure

```
viewer/
  src/lib/api.ts       typed client mirroring the endpoint schemas
  src/lib/useApi.ts    loading/error/reload fetch hook
  src/components/ui/   shadcn/ui vendored components (radix-nova style)
  src/components/      StatusBits (badges, error/empty/skeleton), PlansCard
  src/views/           WorkspaceView, TasksView, JournalView,
                       ArtifactsView, CapturesView
```

Views: workspace summary (project, counts, enrolled areas, plan
readiness); work items (task list + detail, state badges); journal
(operations, per-event listing); artifacts (kind tabs; spec/design/report
chain, spec binding surface); captures (ownership proof badges, area
scopes). Read-only: there are no mutation affordances in the UI.
