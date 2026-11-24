// SPDX-License-Identifier: Apache-2.0
// API <-> viewer contract: every endpoint the typed client
// (viewer/src/lib/api.ts) calls must be a registered route, and every
// registered route must have a client caller. Drift fails the test.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ROUTES } from '../src/api/server.mjs';

const CLIENT_SRC = fileURLToPath(
  new URL('../viewer/src/lib/api.ts', import.meta.url));

const normalized = (segments) =>
  segments.map((s) => (s.startsWith(':') ? ':' : s)).join('/');

test('viewer client endpoints and server routes stay in parity', () => {
  const source = fs.readFileSync(CLIENT_SRC, 'utf8');
  const literals = [...source.matchAll(/['"`](\/api\/[^'"`\s]*)['"`]/g)]
    .map((m) => m[1]);
  const clientPatterns = new Set(literals.map((lit) => lit.split('?')[0]
    .split('/').filter(Boolean)
    .map((seg) => (seg.includes('${') ? ':' : seg))
    .join('/')));
  const serverPatterns = new Set(ROUTES.map((r) => normalized(r.pattern)));
  assert.ok(clientPatterns.size > 0, 'no /api/ literals found in api.ts');
  const clientOnly = [...clientPatterns]
    .filter((p) => !serverPatterns.has(p));
  const serverOnly = [...serverPatterns]
    .filter((p) => !clientPatterns.has(p));
  assert.deepEqual(clientOnly, [],
    `client calls unregistered routes: ${clientOnly.join(', ')}`);
  assert.deepEqual(serverOnly, [],
    `routes with no client caller: ${serverOnly.join(', ')}`);
});

test('viewer write calls only target routes with a put handler', () => {
  const writable = ROUTES.filter((r) => typeof r.put === 'function')
    .map((r) => normalized(r.pattern));
  const source = fs.readFileSync(CLIENT_SRC, 'utf8');
  const puts = source.match(/method:\s*'PUT'/g) ?? [];
  const otherWrites = source.match(/method:\s*'(POST|PATCH|DELETE)'/g) ?? [];
  assert.equal(puts.length, writable.length);
  assert.equal(otherWrites.length, 0);
  assert.deepEqual(writable, ['api/catalog/:/:']);
});
