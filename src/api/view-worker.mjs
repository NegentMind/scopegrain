// SPDX-License-Identifier: Apache-2.0
// `view` worker: runs inside a Worker thread so the supervisor can swap
// the entire module graph on source changes (a fresh Worker gets a fresh
// module registry — the only honest in-process reload Node offers).
// Contract with view-reload.mjs:
//   workerData: { options } — the createApiServer options plus
//     `reloadMode:'supervised'`, surfaced on /api/health.
//   -> posts {type:'bound', host, port} once listening, or
//      {type:'error', code, message} on failure. Setup errors are
//      REPORTED, never thrown: an error crossing the worker boundary
//      loses `.code` (structured clone keeps name/message/stack only),
//      so `INVALID_HOST` would degrade to INTERNAL for the caller.
//   <- on {type:'close'} it closes the server and exits cleanly.
import { parentPort, workerData } from 'node:worker_threads';
import { createApiServer } from './server.mjs';

const errorPayload = (e) => ({
  type: 'error',
  code: e !== null && typeof e === 'object' && typeof e.code === 'string'
    ? e.code : 'ERROR',
  message: e instanceof Error ? e.message : String(e),
});

let api = null;
try {
  api = createApiServer(workerData.options);
} catch (e) {
  // Report and drain: no explicit process.exit inside a worker —
  // process.exit from a worker thread races the parent's isolate
  // teardown on Windows and crashes the host (V8 check !is_null).
  // With no handles left the thread exits on its own.
  parentPort.postMessage(errorPayload(e));
}
if (api !== null) {
  parentPort.on('message', (m) => {
    if (m !== null && typeof m === 'object' && m.type === 'close') {
      api.close().catch(() => {});
    }
  });
}
if (api !== null) {
  api.listen()
    .then((bound) => parentPort.postMessage(
      { type: 'bound', host: bound.host, port: bound.port }))
    .catch((e) => parentPort.postMessage(errorPayload(e)));
}