// SPDX-License-Identifier: Apache-2.0
// `view` auto-reload supervisor.
//
// Why a Worker thread and not a module-cache invalidation: Node's ESM
// loader caches every statically imported module forever — a `tasks.mjs`
// edit NEVER reaches a running server, and this bit twice in practice
// (stale schema validators reporting TASK_MALFORMED on fresh records,
// missing routes after a pull). A Worker thread owns a separate module
// registry: terminating it and starting a new one IS a code reload,
// in-process, without a child process to supervise.
//
// Contract:
// - startReloadingView(options) binds a worker to the requested port
//   (walk on EADDRINUSE like cmdView's direct path — explicit --port
//   gets a single attempt).
// - A stamp poll (default 1500 ms, injectable for tests) over srcStamp
//   restarts the worker when the source tree changes; restarts are
//   debounced and serialized so a save-storm costs one respawn.
// - close() stops the poll and terminates the current worker; it is the
//   handle exposed as io.viewServer for embedders and tests.
import { Worker } from 'node:worker_threads';
import { err } from '../core/errors.mjs';
import { srcStamp } from './stamp.mjs';

const WORKER_URL = new URL('./view-worker.mjs', import.meta.url);
const DEFAULT_POLL_MS = 1500;
const RESTART_DELAY_MS = 120;

function spawnWorker(options) {
  return new Worker(WORKER_URL, { workerData: { options } });
}

function nextMessage(worker) {
  return new Promise((resolve, reject) => {
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', (code) => reject(err('VIEW_WORKER_EXIT',
      `view worker exited (code ${code}) before reporting bind`)));
  });
}

// options: the createApiServer options (project, config, host, port,
// allowWrite) plus:
//   watchRoot  — tree polled for changes (defaults to the install root;
//                tests point it at a temp dir)
//   pollMs     — stamp poll interval (default 1500)
//   portWalk   — allow port+1 retries on EADDRINUSE (cmdView decides:
//                true unless the user passed an explicit --port)
//   onRestart  — (bound) => void, called after every successful respawn
export async function startReloadingView(options) {
  const watchRoot = options.watchRoot;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const attempts = options.portWalk === false ? 1 : 16;
  const supervised = { ...options, reloadMode: 'supervised' };
  delete supervised.watchRoot;
  delete supervised.pollMs;
  delete supervised.portWalk;
  delete supervised.onRestart;

  let worker = null;
  let bound = null;
  let lastStamp = srcStamp(watchRoot).stamp;
  let stopped = false;
  let restarting = false;
  let pendingRestart = false;

  async function bind(port) {
    const w = spawnWorker({ ...supervised, port });
    // A worker that dies without our say-so (unhandled error, OOM)
    // leaves the port unserved — respawn it on the same port instead
    // of waiting for the next stamp change.
    w.once('exit', () => {
      if (!stopped && !restarting && worker === w) {
        worker = null;
        restarting = true;
        bind(bound.port)
          .then(() => { if (options.onRestart) options.onRestart(bound); })
          .catch((e) => {
            if (options.onRestartError) options.onRestartError(e);
          })
          .finally(() => { restarting = false; });
      }
    });
    const msg = await nextMessage(w);
    if (msg.type === 'bound') {
      worker = w;
      bound = msg;
      return true;
    }
    // Await the teardown: an unawaited terminate on an already-exited
    // worker leaves the isolate collected mid-flight and crashes the
    // process at teardown (V8 DisposeIsolate check).
    await w.terminate();
    if (msg.code === 'EADDRINUSE') return false;
    throw err(msg.code, msg.message);
  }

  async function restart() {
    if (restarting) {
      pendingRestart = true;
      return;
    }
    restarting = true;
    do {
      pendingRestart = false;
      const old = worker;
      if (old !== null) {
        old.postMessage({ type: 'close' });
        // Grace window for an orderly socket close; terminate() is the
        // hard stop — its own handles (the listener included) die with
        // the isolate either way.
        await Promise.race([
          new Promise((r) => old.once('exit', r)),
          new Promise((r) => setTimeout(r, 400)),
        ]);
        await old.terminate();
      }
      try {
        for (let i = 0; i < 4; i += 1) {
          try {
            await bind(bound.port);
            break;
          } catch (e) {
            // The just-freed socket may linger briefly — a bounded
            // retry beats surfacing a spurious bind failure.
            if (e.code === 'EADDRINUSE' && i < 3) {
              await new Promise((r) => setTimeout(r, RESTART_DELAY_MS));
              continue;
            }
            throw e;
          }
        }
        if (options.onRestart) options.onRestart(bound);
      } catch (e) {
        // A worker that can no longer bind leaves the supervisor with
        // nothing to serve: surface it on stderr-equivalent and wait
        // for the next stamp change instead of spinning.
        if (options.onRestartError) options.onRestartError(e);
      }
    } while (pendingRestart && !stopped);
    restarting = false;
  }

  // Initial bind with port walk. port:0 is OS-assigned — it never
  // conflicts and must not walk (0+i would probe privileged ports).
  let ok = false;
  let lastErr = null;
  const walkable = options.port !== 0;
  const basePort = options.port ?? 7731;
  for (let i = 0; i < attempts && !ok; i += 1) {
    try {
      ok = await bind(walkable ? basePort + i : 0);
    } catch (e) {
      lastErr = e;
      throw e;
    }
    if (!ok) lastErr = err('EADDRINUSE', 'port in use');
    if (!walkable) break;
  }
  if (!ok) throw lastErr;

  const timer = setInterval(() => {
    if (stopped || restarting) return;
    const now = srcStamp(watchRoot).stamp;
    if (now !== lastStamp) {
      lastStamp = now;
      restart();
    }
  }, pollMs);

  return {
    get port() { return bound.port; },
    get host() { return bound.host; },
    async close() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      if (worker !== null) {
        worker.postMessage({ type: 'close' });
        await Promise.race([
          new Promise((r) => worker.once('exit', r)),
          new Promise((r) => setTimeout(r, 400)),
        ]);
        await worker.terminate();
      }
    },
  };
}
