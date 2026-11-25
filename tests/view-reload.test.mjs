// SPDX-License-Identifier: Apache-2.0
// `view` auto-reload supervisor (api/view-reload.mjs): the API runs in a
// Worker thread so a source edit gets a fresh module registry — the bug
// this prevents is a stale server running pre-change validators/routes.
// Tests drive the poll on a temp watchRoot (never the real src tree).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConfig } from '../src/core/config.mjs';
import { startReloadingView } from '../src/api/view-reload.mjs';
import { srcStamp } from '../src/api/stamp.mjs';
import {
  VALID_ANSWERS, cleanup, makeTempDir, writeJson,
} from './helpers.mjs';

const CONFIG_REL = '.scopegrain/config.json';

function fixture() {
  const dir = makeTempDir('view-reload');
  writeJson(dir, CONFIG_REL, createConfig(dir, VALID_ANSWERS, {}));
  return { dir };
}

async function get(port, rel) {
  const res = await fetch(`http://127.0.0.1:${port}${rel}`);
  return { status: res.status, body: await res.json() };
}

async function waitFor(fn, ms = 8000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 40));
  }
  return null;
}

test('srcStamp covers edits, adds and deletes deterministically', () => {
  const dir = makeTempDir('stamp');
  try {
    const src = path.join(dir, 'src');
    fs.mkdirSync(src, { recursive: true });
    const a = srcStamp(dir);
    assert.equal(a.files, 0);
    fs.writeFileSync(path.join(src, 'one.mjs'), 'export const x = 1;\n');
    const b = srcStamp(dir);
    assert.equal(b.files, 1);
    assert.notEqual(a.stamp, b.stamp);
    // Same tree, same stamp.
    assert.equal(srcStamp(dir).stamp, b.stamp);
    fs.writeFileSync(path.join(src, 'one.mjs'), 'export const x = 22;\n');
    // Content-only same-size/mtime edge: mtime granularity may hide a
    // rewrite within the same tick — byte size+time is the contract,
    // not content hashing. Force a detectable delta via size change.
    fs.writeFileSync(path.join(src, 'one.mjs'), 'export const x = 333;\n');
    const c = srcStamp(dir);
    assert.notEqual(b.stamp, c.stamp);
    fs.unlinkSync(path.join(src, 'one.mjs'));
    assert.equal(srcStamp(dir).stamp, a.stamp);
  } finally { cleanup(dir); }
});

test('supervised view binds, reports reloadMode and restarts on change', async () => {
  const f = fixture();
  const watch = makeTempDir('watch');
  let restarts = 0;
  const srv = await startReloadingView({
    project: f.dir, config: CONFIG_REL, port: 0,
    watchRoot: watch, pollMs: 40,
    onRestart: () => { restarts += 1; },
  });
  try {
    const h1 = await get(srv.port, '/api/health');
    assert.equal(h1.status, 200);
    assert.equal(h1.body.reloadMode, 'supervised');
    assert.equal(h1.body.stale, false);
    assert.equal(typeof h1.body.stamp, 'string');
    assert.equal(typeof h1.body.startedAt, 'string');
    // A source change under watchRoot respawns the worker with a fresh
    // module registry — detected via a new startedAt.
    fs.mkdirSync(path.join(watch, 'src'), { recursive: true });
    fs.writeFileSync(path.join(watch, 'src', 'probe.mjs'),
      'export const v = 1;\n');
    const h2 = await waitFor(async () => {
      try {
        const r = await get(srv.port, '/api/health');
        return r.body.startedAt !== h1.body.startedAt ? r : null;
      } catch { return null; }
    });
    assert.ok(h2, 'worker did not restart after src change');
    assert.ok(restarts >= 1);
    // The respawned worker is healthy on the same port.
    assert.equal(h2.status, 200);
    assert.equal(h2.body.status, 'ok');
    assert.equal(h2.body.reloadMode, 'supervised');
  } finally {
    await srv.close();
    cleanup(f.dir);
    cleanup(watch);
  }
  // After close, nothing serves the port.
  await assert.rejects(get(srv.port, '/api/health'));
});

test('port walk honors portWalk and explicit binds conflict', async () => {
  const f = fixture();
  const a = await startReloadingView({
    project: f.dir, config: CONFIG_REL, port: 0, pollMs: 60000,
  });
  try {
    // Walking mode picks the next free port.
    const b = await startReloadingView({
      project: f.dir, config: CONFIG_REL, port: a.port, portWalk: true,
      pollMs: 60000,
    });
    try {
      assert.equal(b.port, a.port + 1);
    } finally { await b.close(); }
    // An explicit bind on an occupied port fails, no walk.
    await assert.rejects(startReloadingView({
      project: f.dir, config: CONFIG_REL, port: a.port, portWalk: false,
      pollMs: 60000,
    }), (e) => e.code === 'EADDRINUSE');
  } finally {
    await a.close();
    cleanup(f.dir);
  }
});
