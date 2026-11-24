// SPDX-License-Identifier: Apache-2.0
// API audit regressions: IPv6 loopback binding ('::1' in Host arrives
// bracketed through WHATWG URL) and strict-UTF8 decode errors surfacing
// as 422 MALFORMED* instead of 500.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createConfig } from '../src/core/config.mjs';
import { resolveContext } from '../src/core/context.mjs';
import { createTask } from '../src/core/tasks.mjs';
import { createApiServer } from '../src/api/server.mjs';
import {
  VALID_ANSWERS, cleanup, makeTempDir, writeFile, writeJson,
} from './helpers.mjs';

const CONFIG_REL = '.scopegrain/config.json';
const BAD_UTF8 = Buffer.from([0x62, 0x61, 0x64, 0x20, 0xff, 0x0a]);

function baseFixture() {
  const dir = makeTempDir('api-audit');
  writeJson(dir, CONFIG_REL, createConfig(dir, VALID_ANSWERS, {}));
  const ctx = resolveContext({ project: dir, config: CONFIG_REL });
  return { dir, ctx };
}

function ipv6Unavailable(e) {
  const codes = ['EADDRNOTAVAIL', 'EAFNOSUPPORT', 'EPROTONOSUPPORT',
    'ENETUNREACH', 'ECONNREFUSED'];
  return codes.includes(e?.code) || codes.includes(e?.cause?.code);
}

test('api bound to ::1 serves requests without 421', async (t) => {
  const f = baseFixture();
  let api = null;
  try {
    try {
      api = createApiServer({
        project: f.dir, config: CONFIG_REL, host: '::1', port: 0,
      });
      const bound = await api.listen();
      const base = `http://[::1]:${bound.port}`;
      const health = await fetch(`${base}/api/health`);
      assert.equal(health.status, 200);
      assert.equal((await health.json()).status, 'ok');
      const tasks = await fetch(`${base}/api/tasks`);
      assert.equal(tasks.status, 200);
      const unknown = await fetch(`${base}/api/nope`);
      assert.equal(unknown.status, 404);
      await unknown.text();
    } catch (e) {
      if (ipv6Unavailable(e)) {
        t.skip('IPv6 loopback unavailable on this host');
        return;
      }
      throw e;
    }
  } finally {
    if (api) await api.close();
    cleanup(f.dir);
  }
});

test('corrupt UTF-8 in stored docs returns 422 MALFORMED, not 500', async () => {
  const f = baseFixture();
  const p = f.ctx.config.paths;
  const task = createTask(f.ctx, {
    title: 'T', contract: 'C', authorContext: 'a', scope: [],
  });
  writeFile(f.dir, `${p.tasks}/${task.id}.md`, BAD_UTF8);
  writeFile(f.dir, `${p.plans}/broken-plan.md`, BAD_UTF8);
  writeFile(f.dir, `${p.decisions}/broken-doc.md`, BAD_UTF8);
  writeFile(f.dir, `${p.reports}/broken-status.json`, BAD_UTF8);
  writeFile(f.dir, `${p.reports}/syntax-status.json`, 'not json\n');
  writeFile(f.dir, '.scopegrain/prompts/bad.md', BAD_UTF8);
  writeJson(f.dir, '.scopegrain/catalog.json', {
    schemaVersion: 2,
    entries: [
      { kind: 'prompt', id: 'bad', path: 'prompts/bad.md',
        description: 'Corrupt prompt',
        sha256: crypto.createHash('sha256').update(BAD_UTF8).digest('hex') },
    ],
  });
  const api = createApiServer({
    project: f.dir, config: CONFIG_REL, port: 0,
  });
  try {
    const bound = await api.listen();
    const base = `http://127.0.0.1:${bound.port}`;
    const cases = [
      `/api/tasks/${task.id}/doc`,
      '/api/plan-docs/broken-plan.md',
      '/api/artifact-docs/decision/broken-doc.md',
      '/api/reports/broken-status.json',
      '/api/catalog/prompt/bad',
    ];
    for (const rel of cases) {
      const res = await fetch(`${base}${rel}`);
      const body = await res.json();
      assert.equal(res.status, 422, `${rel} -> ${res.status}`);
      assert.ok(String(body.error.code).includes('MALFORMED'),
        `${rel} code ${body.error.code}`);
    }
    const badJson = await fetch(`${base}/api/reports/syntax-status.json`);
    assert.equal(badJson.status, 422);
    assert.equal((await badJson.json()).error.code, 'MALFORMED_JSON');
  } finally {
    await api.close();
    cleanup(f.dir);
  }
});
