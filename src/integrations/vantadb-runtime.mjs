// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';
import crypto from 'node:crypto';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { err } from '../core/errors.mjs';
import { readJsonFile, mkdirpSync, writeFileExclusive, removeIfExists, lstatOrNull, readDirBounded }
  from '../core/fsx.mjs';
import { configRel, resolveInside } from '../core/paths.mjs';
import { listJournalAcked, listJournalPending } from '../core/journal.mjs';
import { createCaptureStore } from '../core/captures.mjs';
import { loadJournalPolicy } from '../core/policy.mjs';
import { canonicalDigest } from '../core/digests.mjs';
import { readWorklog } from '../core/worklog.mjs';
import { estimateTokens } from '../core/tokens.mjs';
import { createVantaDBProjector, projectionScopeHash } from './vantadb.mjs';

export const DEFAULT_VANTADB_VERSION = '0.9.0';
export const VANTADB_REPO = 'ness-e/Vantadb';
export const VANTADB_BACKEND_ID = 'vantadb';

const CONFIG_REL = 'vantadb.json';
const CONFIG_KEYS = ['schemaVersion', 'backendId', 'version', 'binaryPath', 'storagePath'];
const CONFIG_KEYS_ALLOWED = [...CONFIG_KEYS, 'binarySha256'];
const BINARY_NAMES = new Set(['vantadb-server', 'vantadb-server.exe']);
const RELEASE_BASE = `https://github.com/${VANTADB_REPO}/releases/download`;
const ASSET_LIMIT = 128 * 1024 * 1024;
const STDOUT_BUF_LIMIT = 8 * 1024 * 1024;
const STDERR_TAIL_LIMIT = 8192;
const DEFAULT_TIMEOUT_MS = 60000;
const MAX_REDIRECTS = 3;

const ASSETS = {
  'win32:x64': { triple: 'x86_64-pc-windows-msvc', ext: 'zip' },
  'linux:x64': { triple: 'x86_64-unknown-linux-gnu', ext: 'tar.gz' },
  'linux:arm64': { triple: 'aarch64-unknown-linux-gnu', ext: 'tar.gz' },
  'darwin:x64': { triple: 'x86_64-apple-darwin', ext: 'tar.gz' },
  'darwin:arm64': { triple: 'aarch64-apple-darwin', ext: 'tar.gz' },
};

function closed(value, keys, required, code, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw err(code, `${label} must be a plain object`);
  }
  for (const name of Object.keys(value)) {
    if (!keys.includes(name)) throw err(code, `${label} contains unknown key '${name}'`);
  }
  for (const name of required) {
    if (!Object.hasOwn(value, name)) throw err(code, `${label} is missing '${name}'`);
  }
}

export function targetTriple(platform = process.platform, arch = process.arch) {
  const asset = ASSETS[`${platform}:${arch}`];
  if (!asset) {
    throw err('VANTADB_UNSUPPORTED_PLATFORM',
      `no VantaDB release asset for ${platform}/${arch}`);
  }
  return asset;
}

export function releaseAsset(version, platform = process.platform, arch = process.arch) {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw err('VANTADB_INVALID_VERSION', 'version must be a strict semver x.y.z');
  }
  const { triple, ext } = targetTriple(platform, arch);
  const name = `vantadb-${triple}.${ext}`;
  return {
    triple, name,
    url: `${RELEASE_BASE}/v${version}/${name}`,
    sha256Url: `${RELEASE_BASE}/v${version}/${name}.sha256`,
    binaryRel: platform === 'win32' ? 'vantadb-server.exe' : 'vantadb-server',
  };
}

export function defaultInstallRoot() {
  return path.join(os.homedir(), '.scopegrain', 'vantadb');
}

export function defaultStoragePath() {
  return path.join(os.homedir(), '.vantadb', 'data');
}

export function vantaDBConfigAbs(ctx) {
  return resolveInside(ctx.projectRoot, configRel(ctx, `${CONFIG_REL}`), 'vantadb config');
}

// vantadb.json lives inside the (possibly versioned) config dir, so a
// hostile repository could ship a config pointing at its own payload;
// memory verbs would then execute those bytes with the user's
// privileges. The enrolled binary must therefore (a) be named like the
// official server and (b) resolve outside the project root. A pinned
// binarySha256 — recorded at enrollment — is verified before spawn.
export function assertBinaryTrust(ctx, abs) {
  if (!BINARY_NAMES.has(path.basename(abs).toLowerCase())) {
    throw err('VANTADB_BINARY_UNTRUSTED',
      `binaryPath must name vantadb-server(.exe): ${abs}`);
  }
  const root = path.resolve(ctx.projectRoot);
  const real = path.resolve(abs);
  if (real === root || real.startsWith(root + path.sep)) {
    throw err('VANTADB_BINARY_UNTRUSTED',
      'binaryPath must resolve outside the project root');
  }
}

function verifyBinaryDigest(abs, expected) {
  const actual = crypto.createHash('sha256')
    .update(fs.readFileSync(abs)).digest('hex');
  if (actual !== String(expected).toLowerCase()) {
    throw err('VANTADB_HASH_MISMATCH',
      'enrolled binary digest changed; re-run vantadb setup --apply');
  }
}

export function loadVantaDBConfig(ctx) {
  const abs = vantaDBConfigAbs(ctx);
  if (!fs.existsSync(abs)) return null;
  const value = readJsonFile(abs, 'vantadb config', 65536);
  closed(value, CONFIG_KEYS_ALLOWED, CONFIG_KEYS, 'VANTADB_CONFIG_MALFORMED', 'vantadb config');
  if (value.schemaVersion !== 1 || value.backendId !== VANTADB_BACKEND_ID
      || typeof value.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(value.version)
      || typeof value.binaryPath !== 'string' || !path.isAbsolute(value.binaryPath)
      || typeof value.storagePath !== 'string' || !path.isAbsolute(value.storagePath)) {
    throw err('VANTADB_CONFIG_MALFORMED', 'vantadb config fields are invalid');
  }
  if (value.binarySha256 !== undefined
      && (typeof value.binarySha256 !== 'string'
          || !/^[0-9a-fA-F]{64}$/.test(value.binarySha256))) {
    throw err('VANTADB_CONFIG_MALFORMED',
      'binarySha256 must be a 64-hex digest when present');
  }
  assertBinaryTrust(ctx, value.binaryPath);
  return Object.freeze({ ...value });
}

function writeJsonAtomic(abs, value) {
  const tmp = `${abs}.tmp-${crypto.randomBytes(6).toString('hex')}`;
  writeFileExclusive(tmp, JSON.stringify(value, null, 2) + '\n');
  try {
    fs.renameSync(tmp, abs);
  } catch (e) {
    removeIfExists(tmp);
    throw e;
  }
}

export function saveVantaDBConfig(ctx, cfg) {
  closed(cfg, CONFIG_KEYS_ALLOWED, CONFIG_KEYS, 'VANTADB_CONFIG_MALFORMED', 'vantadb config');
  if (cfg.schemaVersion !== 1 || cfg.backendId !== VANTADB_BACKEND_ID
      || !/^\d+\.\d+\.\d+$/.test(cfg.version)
      || !path.isAbsolute(cfg.binaryPath) || !path.isAbsolute(cfg.storagePath)) {
    throw err('VANTADB_CONFIG_MALFORMED', 'vantadb config fields are invalid');
  }
  if (cfg.binarySha256 !== undefined
      && (typeof cfg.binarySha256 !== 'string'
          || !/^[0-9a-fA-F]{64}$/.test(cfg.binarySha256))) {
    throw err('VANTADB_CONFIG_MALFORMED',
      'binarySha256 must be a 64-hex digest when present');
  }
  assertBinaryTrust(ctx, cfg.binaryPath);
  const abs = vantaDBConfigAbs(ctx);
  mkdirpSync(path.dirname(abs));
  writeJsonAtomic(abs, { ...cfg });
  return abs;
}

function downloadBytes(url, maxBytes, redirects = 0) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'user-agent': 'scopegrain' } }, (res) => {
      const status = res.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
        res.resume();
        if (redirects >= MAX_REDIRECTS) {
          reject(err('VANTADB_DOWNLOAD_FAILED', 'too many redirects'));
          return;
        }
        downloadBytes(new URL(res.headers.location, url).href, maxBytes, redirects + 1)
          .then(resolve, reject);
        return;
      }
      if (status !== 200) {
        res.resume();
        reject(err('VANTADB_DOWNLOAD_FAILED', `HTTP ${status} for ${url}`));
        return;
      }
      const chunks = [];
      let total = 0;
      res.on('data', (chunk) => {
        total += chunk.length;
        if (total > maxBytes) {
          request.destroy();
          reject(err('VANTADB_DOWNLOAD_FAILED', 'asset exceeds size limit'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    request.on('error', (e) => reject(err('VANTADB_DOWNLOAD_FAILED', String(e.message || e))));
    request.setTimeout(120000, () => {
      request.destroy();
      reject(err('VANTADB_DOWNLOAD_FAILED', 'download timed out'));
    });
  });
}

function parseSha256Sidecar(text, name) {
  const match = /^([0-9a-fA-F]{64})\s+\*?(\S+)\s*$/m.exec(text);
  if (!match || match[2] !== name) {
    throw err('VANTADB_HASH_MISMATCH', 'sha256 sidecar does not name the asset');
  }
  return match[1].toLowerCase();
}

function extractArchive(execImpl, archiveAbs, destAbs) {
  try {
    execImpl('tar', ['-xf', archiveAbs, '-C', destAbs], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    throw err('VANTADB_EXTRACT_FAILED',
      `tar could not extract the asset: ${String(e.message || e).slice(0, 200)}`);
  }
}

export async function ensureVantaDBBinary({
  version, installRoot, platform = process.platform, arch = process.arch,
  fetchImpl, execImpl,
}) {
  const asset = releaseAsset(version, platform, arch);
  const versionDir = path.join(installRoot, version);
  const binaryAbs = path.join(versionDir, asset.binaryRel);
  if (fs.existsSync(binaryAbs)) {
    return { binaryPath: binaryAbs, version, downloaded: false, sha256: null };
  }
  const fetch = fetchImpl ?? ((url, max) => downloadBytes(url, max));
  const exec = execImpl ?? ((cmd, args, opts) => execFileSync(cmd, args, opts));
  const tmpDir = path.join(installRoot, `.tmp-${crypto.randomBytes(6).toString('hex')}`);
  mkdirpSync(tmpDir);
  try {
    const archive = await fetch(asset.url, ASSET_LIMIT);
    const sidecar = await fetch(asset.sha256Url, 1024);
    const expected = parseSha256Sidecar(sidecar.toString('utf8'), asset.name);
    const actual = crypto.createHash('sha256').update(archive).digest('hex');
    if (actual !== expected) {
      throw err('VANTADB_HASH_MISMATCH', 'asset digest does not match the published sidecar');
    }
    const archiveAbs = path.join(tmpDir, asset.name);
    fs.writeFileSync(archiveAbs, archive);
    extractArchive(exec, archiveAbs, tmpDir);
    const extracted = path.join(tmpDir, asset.binaryRel);
    if (!fs.existsSync(extracted)) {
      throw err('VANTADB_EXTRACT_FAILED', 'asset did not contain vantadb-server');
    }
    if (platform !== 'win32') fs.chmodSync(extracted, 0o755);
    mkdirpSync(installRoot);
    if (fs.existsSync(versionDir)) fs.rmSync(versionDir, { recursive: true, force: true });
    fs.renameSync(tmpDir, versionDir);
    return { binaryPath: binaryAbs, version, downloaded: true, sha256: actual };
  } catch (e) {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup of our own temp dir only
    }
    throw e;
  }
}

// The server reads several VANTADB_MCP_* vars that silently change the
// tool contract: a restricted profile rejects tools outside its
// advertised list ("Tool not found: X (not in profile Y)") which would
// break dispatch-only calls we rely on (memory_list_namespaces,
// capabilities, memory_list); the injection ACLs gate what recall and
// context_assemble may inject; the byte budget truncates search results.
// Pin them explicitly instead of trusting inherited process.env.
const SPAWN_ENV_STRIP = [
  'VANTADB_MCP_PROFILE',
  'VANTADB_MCP_INJECT_NAMESPACES',
  'VANTADB_MCP_TAINTED_NAMESPACES',
  'VANTADB_MCP_INCLUDE_TAINTED',
  'VANTADB_MCP_BYTE_BUDGET',
];

function controlledEnv(storagePath) {
  const env = { ...process.env };
  for (const key of SPAWN_ENV_STRIP) delete env[key];
  env.VANTADB_STORAGE_PATH = storagePath;
  env.VANTADB_QUIET = '1';
  env.VANTADB_MCP_PROFILE = 'brain';
  // Injection ACL: recall/context may only inject the engine's own l1/*
  // memory pool, never arbitrary namespaces such as sg-formal-v1-*.
  env.VANTADB_MCP_INJECT_NAMESPACES = 'l1/';
  return env;
}

export function createStdioMcpClient({
  binaryPath, storagePath, timeoutMs = DEFAULT_TIMEOUT_MS, spawnImpl, env,
}) {
  const spawnFn = spawnImpl ?? spawn;
  let child;
  try {
    child = spawnFn(binaryPath, ['--mcp'], {
      env: env ?? controlledEnv(storagePath),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch (e) {
    // spawn can throw synchronously (EINVAL/ENOEXEC on a file that is
    // not executable) — surface it under the same code as async errors.
    throw err('VANTADB_SPAWN_FAILED',
      `cannot start vantadb-server: ${String(e.message || e)}`);
  }
  const pending = new Map();
  const stderrTail = [];
  let nextId = 1;
  let buf = '';
  let spawnError = null;
  let clientClosed = false;
  let serverInfo = null;

  function rejectAll(code, message) {
    for (const [, p] of pending) {
      clearTimeout(p.timer);
      p.reject(err(code, message));
    }
    pending.clear();
  }

  child.on('error', (e) => {
    spawnError = e;
    rejectAll('VANTADB_SPAWN_FAILED', `cannot start vantadb-server: ${e.message}`);
  });
  child.on('exit', (code, signal) => {
    rejectAll('VANTADB_PROCESS_EXIT', `vantadb-server exited (${code ?? signal})`);
  });
  child.stderr.on('data', (chunk) => {
    stderrTail.push(chunk.toString('utf8'));
    const joined = stderrTail.join('');
    if (joined.length > STDERR_TAIL_LIMIT) {
      stderrTail.splice(0, stderrTail.length);
      stderrTail.push(joined.slice(-STDERR_TAIL_LIMIT));
    }
  });
  child.stdout.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    if (buf.length > STDOUT_BUF_LIMIT) {
      child.kill();
      rejectAll('VANTADB_PROTOCOL', 'stdout buffer exceeded limit');
      return;
    }
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (!line.trim()) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue; // non-JSON noise on stdout is ignored, never trusted
      }
      const p = pending.get(msg.id);
      if (!p) continue;
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) {
        p.reject(err('VANTADB_RPC_ERROR',
          `${msg.error.message ?? 'rpc error'}${stderrTail.length ? ` | stderr: ${stderrTail.join('').slice(-300)}` : ''}`));
      } else {
        p.resolve(msg.result);
      }
    }
  });

  function request(method, params) {
    return new Promise((resolve, reject) => {
      if (clientClosed || spawnError || child.killed) {
        reject(err('VANTADB_PROCESS_EXIT', 'vantadb-server is not running'));
        return;
      }
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(err('VANTADB_TIMEOUT', `${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      try {
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      } catch (e) {
        pending.delete(id);
        clearTimeout(timer);
        reject(err('VANTADB_PROTOCOL', `stdin write failed: ${e.message}`));
      }
    });
  }

  const client = {
    async start() {
      const init = await request('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'scopegrain', version: '0.1.0' },
      });
      serverInfo = init && typeof init === 'object' ? init.serverInfo ?? null : null;
      child.stdin.write(JSON.stringify({
        jsonrpc: '2.0', method: 'notifications/initialized', params: {},
      }) + '\n');
      return client;
    },
    invoke({ name, arguments: args }) {
      return request('tools/call', { name, arguments: args });
    },
    serverInfo() {
      return serverInfo;
    },
    async close() {
      clientClosed = true;
      rejectAll('VANTADB_PROCESS_EXIT', 'client closed');
      try { child.stdin.end(); } catch { /* already closed */ }
      if (!child.killed) {
        try { child.kill(); } catch { /* already dead */ }
        await new Promise((resolve) => {
          const t = setTimeout(resolve, 2000);
          child.once('exit', () => { clearTimeout(t); resolve(); });
        });
      }
    },
  };
  return client;
}

export function requireVantaDBConfig(ctx) {
  const cfg = loadVantaDBConfig(ctx);
  if (!cfg) {
    throw err('VANTADB_NOT_CONFIGURED',
      'vantadb backend is not enrolled; run vantadb setup --apply first');
  }
  return cfg;
}

async function withMcpClient(cfg, timeoutMs, spawnImpl, fn) {
  if (!fs.existsSync(cfg.binaryPath)) {
    throw err('VANTADB_BINARY_MISSING',
      `vantadb-server not found at ${cfg.binaryPath}; re-run vantadb setup --apply`);
  }
  if (cfg.binarySha256) verifyBinaryDigest(cfg.binaryPath, cfg.binarySha256);
  const client = createStdioMcpClient({
    binaryPath: cfg.binaryPath, storagePath: cfg.storagePath,
    timeoutMs, spawnImpl,
  });
  try {
    await client.start();
    return await fn(client);
  } finally {
    await client.close();
  }
}

export async function syncVantaDB({ ctx, bound, cfg, limit, timeoutMs, spawnImpl }) {
  const policy = loadJournalPolicy();
  const effectiveLimit = limit ?? policy.defaultPageSize;
  return withMcpClient(cfg, timeoutMs, spawnImpl, async (client) => {
    const projector = createVantaDBProjector(bound, {
      backendId: cfg.backendId,
      invoke: (request) => client.invoke(request),
    });
    const result = await projector.drain({ limit: effectiveLimit });
    return { ...result, serverInfo: client.serverInfo() };
  });
}

// Opt-in capability probe: spawns the server once, calls `capabilities`
// and surfaces the embedding provider state (fallback/model_present/
// status) plus the raw feature flags. Status without --probe never
// touches the process — this is the only spawn-on-read verb.
export async function vantaDBProbe({ cfg, timeoutMs, spawnImpl }) {
  const result = await withMcpClient(cfg, timeoutMs, spawnImpl,
    async (client) => client.invoke({ name: 'capabilities', arguments: {} }));
  let body = result?.structuredContent ?? null;
  if (body === null) {
    try {
      body = JSON.parse(result?.content?.[0]?.text ?? 'null');
    } catch {
      body = null;
    }
  }
  if (!body || typeof body !== 'object') {
    return { embedding: null, serverInfo: null,
      warning: 'capabilities response had no structured body' };
  }
  const embedding = body.embedding && typeof body.embedding === 'object'
    ? {
        provider: body.embedding.provider ?? null,
        fallback: body.embedding.fallback ?? null,
        model_present: body.embedding.model_present ?? null,
        model_dir: body.embedding.model_dir ?? null,
        status: body.embedding.status ?? body.embedding.reason ?? null,
        notice: body.embedding.notice ?? null,
      }
    : null;
  return {
    embedding,
    vector_search: body.vector_search ?? null,
    persistence: body.persistence ?? null,
    iql_queries: body.iql_queries ?? null,
    runtime_profile: body.runtime_profile ?? null,
  };
}

const TOOL_ARGS_BOUND = 65536;

export async function callVantaDBTool({ cfg, name, arguments: args, timeoutMs, spawnImpl }) {
  if (typeof name !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(name)) {
    throw err('VANTADB_INVALID_INPUT', 'tool name must be a bounded identifier');
  }
  if (args === undefined || args === null
      || ![Object.prototype, null].includes(Object.getPrototypeOf(args))) {
    throw err('VANTADB_INVALID_INPUT', 'tool arguments must be a plain object');
  }
  let bytes;
  try {
    bytes = Buffer.byteLength(JSON.stringify(args));
  } catch {
    throw err('VANTADB_INVALID_INPUT', 'tool arguments are not JSON-serializable');
  }
  if (bytes > TOOL_ARGS_BOUND) {
    throw err('VANTADB_INVALID_INPUT', 'tool arguments exceed bound');
  }
  return withMcpClient(cfg, timeoutMs, spawnImpl, async (client) => {
    return client.invoke({ name, arguments: args });
  });
}

const FORMAL_NS_PREFIX = 'sg-formal-v1-';
const MAX_CONTEXT_NAMESPACES = 32;
const MAX_CONTEXT_TOP_K = 50;

// Record-level rehydration: enumerates remote sg-formal-v1-* namespaces
// (one per distinct scope hash) and keyword-searches each for the record
// ID. Projected journal events carry recordId verbatim in their payload,
// so keyword search recovers every remote event for that record without
// needing the local journal. Single stdio session; read-only.
export async function vantaDBContext({ cfg, recordId, topK, maxNamespaces,
  timeoutMs, spawnImpl }) {
  if (typeof recordId !== 'string' || recordId.length < 8
      || recordId.length > 256 || !/^[\w:.-]+$/.test(recordId)) {
    throw err('VANTADB_INVALID_INPUT',
      'recordId must be a bounded identifier (8..256, word/colon/dot/dash)');
  }
  const k = topK === undefined ? 10 : Number(topK);
  const cap = maxNamespaces === undefined ? MAX_CONTEXT_NAMESPACES
    : Number(maxNamespaces);
  if (!Number.isInteger(k) || k < 1 || k > MAX_CONTEXT_TOP_K
      || !Number.isInteger(cap) || cap < 1 || cap > 256) {
    throw err('VANTADB_INVALID_INPUT', 'topK/maxNamespaces out of bounds');
  }
  return withMcpClient(cfg, timeoutMs, spawnImpl, async (client) => {
    const listed = await client.invoke({ name: 'memory_list_namespaces',
      arguments: {} });
    // The real server answers this tool as a bare JSON array inside
    // content[].text (no structuredContent); some builds nest it under
    // structuredContent.namespaces. Accept both shapes defensively.
    let raw = listed?.structuredContent?.namespaces
      ?? listed?.structuredContent ?? null;
    if (raw === null) {
      try {
        raw = JSON.parse(listed?.content?.[0]?.text ?? 'null');
      } catch {
        raw = null;
      }
    }
    const names = (Array.isArray(raw) ? raw : raw?.namespaces ?? [])
      .filter((n) => typeof n === 'string' && n.startsWith(FORMAL_NS_PREFIX))
      .sort();
    const scanned = names.slice(0, cap);
    const hits = [];
    const warnings = [];
    for (const namespace of scanned) {
      const res = await client.invoke({ name: 'memory_search',
        arguments: { namespace, text_query: recordId, top_k: k } });
      const page = res?.structuredContent ?? {};
      const found = Array.isArray(page.hits) ? page.hits : [];
      if (found.length > 0) hits.push({ namespace, hits: found });
      // Surface engine signals instead of letting them look like "no hits":
      // abstention means the search refused to rank (low confidence), and
      // the 40KB response byte budget can silently drop trailing hits.
      if (page.abstained === true) {
        warnings.push({ namespace, signal: 'abstained',
          reason: page.abstention_reason ?? null });
      }
      if (page.truncated === true) {
        warnings.push({ namespace, signal: 'truncated',
          reason: 'response byte budget exhausted' });
      }
    }
    const result = { recordId, namespacesFound: names.length,
      namespacesScanned: scanned.length,
      truncated: names.length > cap || warnings.some((w) => w.signal === 'truncated'),
      hits, warnings };
    // Local estimate over prepend_context when a backend shape carries
    // one — heuristic, never the host tokenizer. Absent/non-string
    // fields simply carry no estimate.
    if (typeof result.prepend_context === 'string') {
      result.prependContextEstimate = estimateTokens(result.prepend_context);
    }
    return result;
  });
}

const L1_NS_PREFIX = 'l1/sg-';
const L1_SESSION_KEY = 'scopegrain';
const L1_ISOLATION = { agent_id: 'default', team_id: 'default' };

// Curated L1 dual-write: one episodic MemoryRecord per remote-verified
// (acked) journal event, keyed by eventId so re-runs are idempotent
// upserts. L1 records live under l1/* namespaces where memory_recall's
// cross-session pool reads them; agent_id/team_id = VantaDB's default
// isolation so scope=agent recall sees them. The curated `content` line
// is a deterministic summary — the formal truth stays in sg-formal-v1-*.
export async function vantaDBDistill({ bound, cfg, limit, timeoutMs, spawnImpl }) {
  const policy = loadJournalPolicy();
  const page = limit === undefined ? policy.defaultPageSize : Number(limit);
  if (!Number.isSafeInteger(page) || page <= 0 || page > policy.maxPageSize) {
    throw err('VANTADB_INVALID_INPUT', 'limit must be a positive integer within policy');
  }
  const items = listJournalAcked(bound, { limit: page }).items;
  return withMcpClient(cfg, timeoutMs, spawnImpl, async (client) => {
    const distilled = [];
    const failed = [];
    for (const { event, evidence } of items) {
      const scopeHash = projectionScopeHash(event);
      const namespace = `${L1_NS_PREFIX}${scopeHash.slice(0, 16)}`;
      const key = `sg-event-${event.eventId}`;
      const record = {
        id: event.eventId,
        content: `Scopegrain ${event.operation} of ${event.sourceKind} `
          + `record ${event.recordId} (op ${event.operationId}, `
          + `seq ${event.journalSequence})`,
        type: 'episodic',
        priority: 50,
        scene_name: '',
        source_message_ids: [],
        metadata: {
          scopegrain: true,
          eventId: event.eventId,
          operationId: event.operationId,
          recordId: event.recordId,
          sourceKind: event.sourceKind,
          sourceHash: event.sourceHash,
          formalNamespace: evidence?.remoteNamespace
            ?? `sg-formal-v1-${scopeHash}`,
          formalKey: evidence?.remoteKey ?? event.eventId,
        },
        created_at: event.createdAt,
        updated_at: event.createdAt,
        version: 1,
        session_key: L1_SESSION_KEY,
        ...L1_ISOLATION,
      };
      try {
        const put = await client.invoke({ name: 'memory_put',
          arguments: { namespace, key, payload: JSON.stringify(record) } });
        if (put?.isError) {
          failed.push({ eventId: event.eventId, error: put });
          continue;
        }
        const got = await client.invoke({ name: 'memory_get',
          arguments: { namespace, key } });
        if (got?.isError) {
          failed.push({ eventId: event.eventId, error: got });
          continue;
        }
        distilled.push({ eventId: event.eventId, namespace, key });
      } catch (e) {
        failed.push({ eventId: event.eventId,
          error: { code: e.code ?? 'VANTADB_RPC_ERROR', message: e.message } });
      }
    }
    return { distilled, failed, candidateEvents: items.length };
  });
}

const REINFORCE_OUTCOMES = ['used', 'corrected', 'unused'];

// Host-declared outcome signal: adjusts a record's confidence
// (used +0.05 / corrected,unused -0.10 server-side; derived records are
// rejected by the engine). Lets the scopegrain outcome loop feed back
// into L1 memory confidence.
export async function vantaDBReinforce({ cfg, namespace, key, outcome,
  timeoutMs, spawnImpl }) {
  if (typeof namespace !== 'string' || !namespace || namespace.length > 256
      || typeof key !== 'string' || !key || key.length > 512) {
    throw err('VANTADB_INVALID_INPUT', 'namespace and key must be bounded strings');
  }
  if (!REINFORCE_OUTCOMES.includes(outcome)) {
    throw err('VANTADB_INVALID_INPUT',
      `outcome must be one of ${REINFORCE_OUTCOMES.join(',')}`);
  }
  return callVantaDBTool({ cfg, name: 'memory_reinforce',
    arguments: { namespace, key, outcome }, timeoutMs, spawnImpl });
}

export async function getVantaDBRecord({ cfg, namespace, key, timeoutMs, spawnImpl }) {
  if (typeof namespace !== 'string' || !namespace || namespace.length > 256
      || typeof key !== 'string' || !key || key.length > 512) {
    throw err('VANTADB_INVALID_INPUT', 'namespace and key must be bounded strings');
  }
  return callVantaDBTool({ cfg, name: 'memory_get',
    arguments: { namespace, key }, timeoutMs, spawnImpl });
}

export function vantaDBStatus({ ctx, bound }) {
  const cfg = loadVantaDBConfig(ctx);
  const pending = listJournalPending(bound, {
    afterSequence: 0, limit: loadJournalPolicy().maxPageSize,
  }).items.filter((item) => item.state === 'committed');
  return {
    configured: cfg !== null,
    config: cfg,
    binaryPresent: cfg ? fs.existsSync(cfg.binaryPath) : false,
    storagePresent: cfg ? fs.existsSync(cfg.storagePath) : false,
    pendingCommittedEvents: pending.length,
  };
}

const WORKLOG_NAMES = ['lessons', 'outcomes', 'progress', 'goals',
  'activity'];

function worklogSummary(log, entry) {
  const text = entry.summary ?? entry.title ?? entry.text ?? entry.outcome
    ?? entry.id ?? '';
  return `${String(text).slice(0, 200)}`;
}

// Operational worklog projection: reads the local JSONL logs under
// paths.memory (the authoritative store — unchanged) and upserts one L1
// MemoryRecord per entry under the project-scope l1/sg-* namespace.
// Idempotent: the key embeds a digest of the raw entry, so unchanged
// entries report as skipped and re-runs converge without duplicates.
export async function vantaDBSyncWorklogs({ ctx, bound, cfg, limit, timeoutMs,
  spawnImpl }) {
  const policy = loadJournalPolicy();
  const perLogCap = limit === undefined ? policy.defaultPageSize : Number(limit);
  if (!Number.isSafeInteger(perLogCap) || perLogCap <= 0
      || perLogCap > policy.maxPageSize) {
    throw err('VANTADB_INVALID_INPUT',
      'limit must be a positive integer within policy');
  }
  const scopeHash = canonicalDigest({
    workspaceId: bound.workspaceId, projectId: bound.projectId,
    repositoryId: bound.repositoryId, areaIds: [...bound.areaIds].sort(),
  });
  const namespace = `${L1_NS_PREFIX}${scopeHash.slice(0, 16)}`;
  const projected = [];
  const skipped = [];
  const failed = [];
  return withMcpClient(cfg, timeoutMs, spawnImpl, async (client) => {
    for (const log of WORKLOG_NAMES) {
      const { entries } = readWorklog(ctx, log, { tail: perLogCap });
      for (const entry of entries) {
        const digest = crypto.createHash('sha256')
          .update(JSON.stringify(entry), 'utf8').digest('hex');
        const key = `sg-worklog-${log}-${digest.slice(0, 16)}`;
        try {
          const existing = await client.invoke({ name: 'memory_get',
            arguments: { namespace, key } });
          if (existing && !existing.isError) {
            skipped.push({ log, key });
            continue;
          }
          const record = {
            id: key,
            content: `Scopegrain ${log} entry: ${worklogSummary(log, entry)}`,
            type: 'episodic',
            priority: 50,
            scene_name: '',
            source_message_ids: [],
            metadata: {
              scopegrain: true, record_type: 'sg-worklog', log,
              entryDigest: digest,
              taskId: entry.taskId ?? null, kind: entry.kind ?? null,
            },
            created_at: entry.at ?? null,
            updated_at: entry.at ?? null,
            version: 1,
            session_key: L1_SESSION_KEY,
            ...L1_ISOLATION,
            entry,
          };
          const put = await client.invoke({ name: 'memory_put',
            arguments: { namespace, key, payload: JSON.stringify(record) } });
          if (put?.isError) {
            failed.push({ log, key, error: put });
            continue;
          }
          projected.push({ log, key });
        } catch (e) {
          failed.push({ log, key,
            error: { code: e.code ?? 'VANTADB_RPC_ERROR',
              message: e.message } });
        }
      }
    }
    return { namespace, projected, skipped, failed };
  });
}

const L3_NS_PREFIX = 'l3/sg-persona-';
const PERSONA_CATEGORIES = new Set(['preference', 'decision']);
const CAPTURE_UUID_JSON_RE =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/i;

// Opt-in L3 persona/preferences projection: reads ONLY ownership-proved
// capture notes of category 'preference' or 'decision' from .scopegrain
// (which remains the sole authoritative store) and projects them
// idempotently into VantaDB under l3/sg-persona-<scopeHash>. Unproved or
// drifted captures are never adopted and are reported in skippedUnproved.
export async function vantaDBSyncPersona({
  ctx, bound, cfg, limit, apply = false, timeoutMs, spawnImpl,
}) {
  const policy = loadJournalPolicy();
  const cap = limit === undefined ? policy.defaultPageSize : Number(limit);
  if (!Number.isSafeInteger(cap) || cap <= 0 || cap > policy.maxPageSize) {
    throw err('VANTADB_INVALID_INPUT',
      'limit must be a positive integer within policy');
  }
  const scopeHash = canonicalDigest({
    workspaceId: bound.workspaceId, projectId: bound.projectId,
    repositoryId: bound.repositoryId, areaIds: [...bound.areaIds].sort(),
  });
  const namespace = `${L3_NS_PREFIX}${scopeHash.slice(0, 16)}`;
  const capturesDir = resolveInside(
    ctx.projectRoot, `${ctx.config.paths.memory}/captures`, 'captures dir');
  const candidates = [];
  const skippedUnproved = [];
  const st = lstatOrNull(capturesDir);
  if (st && st.isDirectory()) {
    const store = createCaptureStore(ctx, {
      areaIds: bound.areaIds, origin: 'vantadb-persona',
    });
    const { entries } = readDirBounded(capturesDir, cap * 4);
    for (const e of entries) {
      if (candidates.length >= cap) break;
      const m = CAPTURE_UUID_JSON_RE.exec(e.name);
      if (!m || e.isSymbolicLink() || !e.isFile()) continue;
      const id = m[1];
      let proved;
      try {
        proved = store.get(id);
      } catch (errGet) {
        skippedUnproved.push({
          id, code: errGet.code ?? 'CAPTURE_UNPROVED',
          message: errGet.message,
        });
        continue;
      }
      const note = proved.record;
      if (!PERSONA_CATEGORIES.has(note.category)) continue;
      const key = `sg-persona-${note.category}-${note.id}`;
      const captureDigest = canonicalDigest(note);
      candidates.push({
        id: note.id,
        category: note.category,
        subjectId: note.subjectId,
        title: note.title,
        summary: note.summary,
        basis: note.provenance.basis,
        supersedes: note.supersedes,
        capturedAt: note.capturedAt,
        key,
        captureDigest,
      });
    }
  }

  if (!apply) {
    return {
      mode: 'preview',
      namespace,
      candidates: candidates.map((c) => ({
        id: c.id, category: c.category, subjectId: c.subjectId,
        key: c.key, title: c.title, basis: c.basis,
      })),
      skippedUnproved,
    };
  }

  const projected = [];
  const skipped = [];
  const failed = [];
  return withMcpClient(cfg, timeoutMs, spawnImpl, async (client) => {
    for (const c of candidates) {
      try {
        const existing = await client.invoke({
          name: 'memory_get',
          arguments: { namespace, key: c.key },
        });
        if (existing && !existing.isError) {
          skipped.push({ id: c.id, category: c.category, key: c.key });
          continue;
        }
        const record = {
          id: c.key,
          content: `User ${c.category}${c.subjectId ? ` (${c.subjectId})` : ''}: `
            + `${c.title} — ${c.summary.slice(0, 400)}`,
          type: c.category === 'preference' ? 'persona' : 'semantic',
          priority: 80,
          scene_name: 'persona',
          source_message_ids: [],
          metadata: {
            scopegrain: true,
            record_type: 'sg-persona',
            layer: 'L3',
            captureId: c.id,
            category: c.category,
            subjectId: c.subjectId,
            basis: c.basis,
            supersedes: c.supersedes,
            captureDigest: c.captureDigest,
          },
          created_at: c.capturedAt,
          updated_at: c.capturedAt,
          version: 1,
          session_key: L1_SESSION_KEY,
          ...L1_ISOLATION,
        };
        const put = await client.invoke({
          name: 'memory_put',
          arguments: { namespace, key: c.key, payload: JSON.stringify(record) },
        });
        if (put?.isError) {
          failed.push({ id: c.id, key: c.key, error: put });
          continue;
        }
        const readback = await client.invoke({
          name: 'memory_get',
          arguments: { namespace, key: c.key },
        });
        if (readback?.isError) {
          failed.push({ id: c.id, key: c.key, error: readback });
          continue;
        }
        projected.push({ id: c.id, category: c.category, key: c.key });
      } catch (e) {
        failed.push({
          id: c.id, key: c.key,
          error: { code: e.code ?? 'VANTADB_RPC_ERROR', message: e.message },
        });
      }
    }
    return {
      mode: 'applied',
      namespace,
      projected,
      skipped,
      skippedUnproved,
      failed,
    };
  });
}
