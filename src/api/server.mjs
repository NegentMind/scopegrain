// Localhost-only read-only JSON API over Scopegrain stores.
//
// Contract:
// - node:http only, no dependencies, no write endpoints, no auth beyond the
//   loopback bind. It is a local convenience for the viewer, never a
//   production host: do not expose the port.
// - createApiServer({ project, config, host, port }) resolves the context
//   eagerly (fail fast on a bad project/config) and binds only to a
//   literal loopback address. '0.0.0.0', '::', 'localhost' and any other
//   name are rejected: names resolve through DNS and may not be loopback.
// - Strict route/method whitelist; unknown paths are 404, non-GET methods
//   405, malformed query params 400. Errors are {error:{code,message}}.
import http from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { err, toErrorPayload } from '../core/errors.mjs';
import { resolveContext } from '../core/context.mjs';
import { createApiQueries, parseListOptions } from './queries.mjs';

// Literal addresses only: 'localhost' is deliberately absent because
// listen() would resolve it through DNS, which can map off-loopback.
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1']);
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 7731;
const MAX_URL_BYTES = 4096;

// The viewer build is mounted same-origin when it ships with the package
// (viewer/dist inside the tarball). Absent the build, non-/api paths stay
// 404 — the JSON API alone is still fully usable.
const VIEWER_DIST = fileURLToPath(
  new URL('../../viewer/dist/', import.meta.url));
const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function sendStatic(res, segments) {
  if (segments.some((s) => s === '.' || s === '..')) {
    sendError(res, 400, 'INVALID_PATH', 'path contains traversal segments');
    return;
  }
  const rel = segments.join('/');
  const root = path.resolve(VIEWER_DIST);
  const candidate = path.resolve(root, rel === '' ? 'index.html' : rel);
  if (candidate !== root && !candidate.startsWith(root + path.sep)) {
    sendError(res, 400, 'INVALID_PATH', 'path escapes the viewer root');
    return;
  }
  let file = null;
  if (existsSync(candidate) && statSync(candidate).isFile()) {
    file = candidate;
  } else if (path.extname(candidate) === '') {
    const index = path.join(root, 'index.html');
    if (existsSync(index)) file = index;
  }
  if (file === null) {
    sendError(res, 404, 'NOT_FOUND',
      rel === '' ? 'viewer build is not installed' : `not found: /${rel}`);
    return;
  }
  const body = readFileSync(file);
  const type = STATIC_TYPES[path.extname(file).toLowerCase()]
    ?? 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': body.length,
    // Hashed assets are content-addressed; index.html is not.
    'Cache-Control': path.basename(file) === 'index.html'
      ? 'no-store' : 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data:; "
      + "style-src 'self' 'unsafe-inline'; script-src 'self'; "
      + "frame-ancestors 'none'; base-uri 'none'",
  });
  res.end(body);
}

// Route table: method whitelist is GET only. `query` lists the permitted
// query-string keys per endpoint (strict schemas, nothing else passes).
const ROUTES = [
  { pattern: ['api', 'health'], query: [],
    handler: (q) => q.health() },
  { pattern: ['api', 'workspace'], query: [],
    handler: (q) => q.workspace() },
  { pattern: ['api', 'tasks'], query: ['limit', 'offset'],
    handler: (q, url) => q.tasks(parseListOptions(url)) },
  { pattern: ['api', 'tasks', ':id'], query: [],
    handler: (q, _url, p) => q.task(p.id) },
  { pattern: ['api', 'tasks', ':id', 'doc'], query: [],
    handler: (q, _url, p) => q.taskDoc(p.id) },
  { pattern: ['api', 'plans'], query: [],
    handler: (q) => q.plans() },
  { pattern: ['api', 'plan-docs'], query: [],
    handler: (q) => q.planDocs() },
  { pattern: ['api', 'plan-docs', ':name'], query: [],
    handler: (q, _url, p) => q.planDoc(p.name) },
  { pattern: ['api', 'plans', ':key'], query: [],
    handler: (q, _url, p) => q.plan(p.key) },
  { pattern: ['api', 'artifact-docs'], query: ['kind'],
    handler: (q, url) => q.artifactDocs(url.searchParams.get('kind')) },
  { pattern: ['api', 'artifact-docs', ':kind', ':name'], query: [],
    handler: (q, _url, p) => q.artifactDoc(p.kind, p.name) },
  { pattern: ['api', 'artifacts'], query: ['kind', 'limit', 'offset'],
    handler: (q, url) => q.artifacts(url, parseListOptions(url)) },
  { pattern: ['api', 'artifacts', ':kind', ':id'], query: [],
    handler: (q, _url, p) => q.artifact(p.kind, p.id) },
  { pattern: ['api', 'journal', 'operations'], query: ['limit', 'offset'],
    handler: (q, url) => q.journalOperations(parseListOptions(url)) },
  { pattern: ['api', 'journal', 'operations', ':id'], query: [],
    handler: (q, _url, p) => q.journalOperation(p.id) },
  { pattern: ['api', 'captures'], query: ['limit', 'offset'],
    handler: (q, url) => q.captures(parseListOptions(url)) },
  { pattern: ['api', 'memory'], query: ['log', 'tail'],
    handler: (q, url) => q.memory(url) },
  { pattern: ['api', 'goals'], query: [],
    handler: (q) => q.goals() },
  { pattern: ['api', 'metrics'], query: [],
    handler: (q) => q.metrics() },
  { pattern: ['api', 'reports'], query: ['limit', 'offset'],
    handler: (q, url) => q.reports(parseListOptions(url)) },
  { pattern: ['api', 'reports', ':name'], query: [],
    handler: (q, _url, p) => q.report(p.name) },
  { pattern: ['api', 'sessions'], query: ['limit', 'offset'],
    handler: (q, url) => q.sessions(parseListOptions(url)) },
  { pattern: ['api', 'sessions', ':id'], query: [],
    handler: (q, _url, p) => q.session(p.id) },
  { pattern: ['api', 'approvals'], query: ['limit', 'offset'],
    handler: (q, url) => q.approvals(parseListOptions(url)) },
  { pattern: ['api', 'approvals', ':id'], query: [],
    handler: (q, _url, p) => q.approval(p.id) },
  { pattern: ['api', 'catalog'], query: [],
    handler: (q) => q.catalog() },
  { pattern: ['api', 'verify'], query: [],
    handler: (q) => q.verifyCommands() },
  { pattern: ['api', 'vantadb'], query: [],
    handler: (q) => q.vantadb() },
  { pattern: ['api', 'workflow'], query: [],
    handler: (q) => q.workflow() },
];

function matchRoute(segments) {
  for (const route of ROUTES) {
    if (route.pattern.length !== segments.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < segments.length; i += 1) {
      const part = route.pattern[i];
      if (part.startsWith(':')) {
        params[part.slice(1)] = segments[i];
      } else if (part !== segments[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { route, params };
  }
  return null;
}

// Conservative TaskError -> HTTP status mapping for a read API.
function statusFor(code) {
  if (typeof code !== 'string') return 500;
  if (code === 'NOT_FOUND' || code.endsWith('_NOT_FOUND')) return 404;
  if (code === 'SCOPE_DENIED') return 403;
  if (code === 'WORKSPACE_STALE' || code.endsWith('_CONFLICT')) return 409;
  if (code.startsWith('INVALID') || code.startsWith('UNKNOWN_')
      || code === 'CONFIG_AMBIGUOUS') {
    return 400;
  }
  if (code.includes('MALFORMED') || code === 'MALFORMED_JSON'
      || code.endsWith('_DRIFT') || code === 'DOCUMENT_TOO_LARGE'
      || code === 'SYMLINK_REJECTED' || code.startsWith('JOURNAL_SNAPSHOT')) {
    return 422;
  }
  return 500;
}

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload, null, 2) + '\n', 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    // Loopback-only service; no ambient CORS grant. The viewer reaches this
    // API through the dev-server proxy or a same-origin static mount.
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    // Blocks cross-origin no-cors reads (images, embeds, opaque fetches)
    // in browsers that do not enforce the private-network-access rules.
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  });
  res.end(body);
}

// DNS-rebinding guard. Binding to loopback only stops off-host traffic;
// it does NOT stop a hostile web page whose domain resolves to
// 127.0.0.1 from issuing same-origin requests in browsers without
// private-network-access enforcement (Firefox, Safari). Every request
// must therefore be addressed to the loopback socket itself: the Host
// hostname must be a loopback literal (or 'localhost'), and when a
// browser Origin header rides along it must be loopback as well.
// 'localhost' in Host is safe here because the connection already
// arrived at this bound socket — DNS is not re-consulted.
const TRUSTED_HOSTNAMES = new Set([...LOOPBACK_HOSTS, 'localhost']);

function isTrustedHostname(name) {
  return TRUSTED_HOSTNAMES.has(String(name).toLowerCase());
}

function requestOriginAllowed(req) {
  const host = req.headers.host;
  if (typeof host !== 'string' || host === '') return false;
  let parsed;
  try {
    parsed = new URL(`http://${host}`);
  } catch {
    return false;
  }
  if (!isTrustedHostname(parsed.hostname)) return false;
  // No port check: the Vite dev proxy forwards with its own Host port.
  // The request already arrived at this bound socket; the loopback
  // hostname is the invariant that defeats DNS rebinding.
  const origin = req.headers.origin;
  if (origin !== undefined) {
    let o;
    try {
      o = new URL(origin);
    } catch {
      return false;
    }
    if (!isTrustedHostname(o.hostname)) return false;
  }
  return true;
}

function sendError(res, status, code, message) {
  sendJson(res, status, { error: { code, message } });
}

export function createApiHandler(options) {
  const ctx = resolveContext({ project: options.project,
    config: options.config });
  const queries = createApiQueries(ctx);
  return function apiHandler(req, res) {
    // Never read request bodies: the surface is GET-only. Discard anything
    // a client pipelined so the connection state stays sane.
    req.resume();
    try {
      if (!requestOriginAllowed(req)) {
        sendError(res, 421, 'MISDIRECTED_REQUEST',
          'this API only answers requests addressed to its loopback socket');
        return;
      }
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        sendError(res, 405, 'METHOD_NOT_ALLOWED',
          'this API is read-only; only GET is supported');
        return;
      }
      const rawUrl = typeof req.url === 'string' ? req.url : '';
      if (Buffer.byteLength(rawUrl, 'utf8') > MAX_URL_BYTES) {
        sendError(res, 414, 'URI_TOO_LONG', 'request URI exceeds limit');
        return;
      }
      let url;
      try {
        url = new URL(rawUrl, 'http://127.0.0.1');
      } catch {
        sendError(res, 400, 'INVALID_PATH', 'request URI is not parseable');
        return;
      }
      let segments;
      try {
        segments = url.pathname.split('/')
          .filter((s) => s !== '')
          .map((s) => decodeURIComponent(s));
      } catch {
        sendError(res, 400, 'INVALID_PATH', 'path is not valid percent-encoding');
        return;
      }
      if (segments[0] !== 'api') {
        sendStatic(res, segments);
        return;
      }
      const matched = matchRoute(segments);
      if (!matched) {
        sendError(res, 404, 'NOT_FOUND', `unknown endpoint: ${url.pathname}`);
        return;
      }
      for (const key of url.searchParams.keys()) {
        if (!matched.route.query.includes(key)) {
          sendError(res, 400, 'INVALID_QUERY',
            `unsupported query parameter '${key}'`);
          return;
        }
      }
      const payload = matched.route.handler(queries, url, matched.params);
      sendJson(res, 200, payload);
    } catch (e) {
      const payload = toErrorPayload(e);
      sendError(res, statusFor(payload.code), payload.code, payload.message);
    }
  };
}

export function createApiServer(options = {}) {
  const host = options.host ?? DEFAULT_HOST;
  if (!LOOPBACK_HOSTS.has(host)) {
    throw err('INVALID_HOST',
      `api server binds loopback only; refused host '${String(host)}'`);
  }
  const port = options.port ?? DEFAULT_PORT;
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) {
    throw err('INVALID_VALUE', `port must be an integer 0..65535`);
  }
  const handler = createApiHandler(options);
  const server = http.createServer(handler);
  return {
    server,
    host,
    port,
    listen() {
      return new Promise((resolveListen, rejectListen) => {
        server.once('error', rejectListen);
        server.listen(port, host, () => {
          const address = server.address();
          resolveListen({ host: address.address, port: address.port });
        });
      });
    },
    close() {
      return new Promise((resolveClose, rejectClose) => {
        server.close((e) => (e ? rejectClose(e) : resolveClose()));
      });
    },
  };
}
