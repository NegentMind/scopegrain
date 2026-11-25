// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyPlan } from '../src/core/bootstrap.mjs';
import { createConfig } from '../src/core/config.mjs';
import { resolveContext } from '../src/core/context.mjs';
import { canonicalDigest, canonicalJSON } from '../src/core/digests.mjs';
import { applyJournaledCreation, getJournalEvent, listJournalPending } from '../src/core/journal.mjs';
import { bindWorkspace, prepareWorkspace } from '../src/core/workspaces.mjs';
import { createVantaDBProjector } from '../src/integrations/vantadb.mjs';
import { VALID_ANSWERS, cleanup, makeTempDir, writeJson } from './helpers.mjs';

function fixture() {
  const dir = makeTempDir('vantadb-projection');
  writeJson(dir, '.scopegrain/config.json', createConfig(dir, VALID_ANSWERS, {}));
  const ctx = resolveContext({ project: dir, config: '.scopegrain/config.json' });
  const prepared = prepareWorkspace(ctx, {
    areas: [{ key: 'alpha', name: 'Alpha' }, { key: 'beta', name: 'Beta' }],
  });
  applyPlan(dir, [prepared.file]);
  const [a, b] = prepared.workspace.areas.map((area) => area.id);
  return { dir, ctx, a, b, bound: bindWorkspace(ctx, { areaIds: [a, b] }),
    alpha: bindWorkspace(ctx, { areaIds: [a] }),
    journal: path.join(dir, '.scopegrain/state/journal') };
}

function change(areaIds, recordId, content) {
  return { sourceKind: 'task', recordId, sourceRevision: 0, areaIds,
    file: { rel: `records/${recordId}`, content } };
}

function emit(f, items) {
  return applyJournaledCreation(f.bound, items);
}

function event(f, result, index = 0) {
  return getJournalEvent(f.bound, result.operationId, result.eventIds[index]).event;
}

function addresses(e) {
  const scopeHash = canonicalDigest({ workspaceId: e.workspaceId, projectId: e.projectId,
    repositoryId: e.repositoryId, areaIds: [...e.areaIds].sort() });
  return { events: `sg-formal-v1-${scopeHash}`, chunks: `sg-snapshot-v1-${scopeHash}` };
}

function key(namespace, name) {
  return `${namespace}\0${name}`;
}

function absent() {
  return { isError: true, content: [{ type: 'text', text: JSON.stringify({
    code: -32004, message: 'not found',
    data: { code: 'VANTADB_NOT_FOUND', retriable: false },
  }) }] };
}

function record(namespace, name, payload) {
  const value = { namespace, key: name, payload };
  return { structuredContent: value, content: [{ type: 'text', text: JSON.stringify(value) }] };
}

function backend() {
  const values = new Map();
  const calls = [];
  const invoke = async (request) => {
    calls.push(structuredClone(request));
    const { name, arguments: args } = request;
    const id = key(args.namespace, args.key);
    if (name === 'memory_get') {
      return values.has(id) ? record(args.namespace, args.key, values.get(id)) : absent();
    }
    assert.equal(name, 'memory_put');
    values.set(id, args.payload);
    return record(args.namespace, args.key, args.payload);
  };
  return { values, calls, invoke };
}

function projector(f, b, bound = f.bound) {
  return createVantaDBProjector(bound, { backendId: 'fixture', invoke: b.invoke });
}

function tree(dir) {
  const result = {};
  function visit(abs, rel = '') {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { result[next] = 'directory'; visit(path.join(abs, entry.name), next); }
      else result[next] = fs.readFileSync(path.join(abs, entry.name));
    }
  }
  visit(dir);
  return result;
}

test('factory and empty drain are read-only, closed and bounded', async () => {
  const f = fixture();
  const b = backend();
  try {
    const before = tree(f.dir);
    const p = projector(f, b);
    assert.equal(Object.isFrozen(p), true);
    assert.deepEqual(await p.drain(), {
      acknowledgedEventIds: [], blockedEventIds: [], failure: null, warnings: [],
    });
    assert.deepEqual(tree(f.dir), before);
    assert.deepEqual(b.calls, []);
    for (const options of [null, [], { limit: 0 }, { limit: 101 }, { limit: 1.5 }, { extra: true }]) {
      await assert.rejects(p.drain(options), (e) => e.code === 'BRAIN_INVALID_INPUT');
    }
    for (const config of [null, {}, { backendId: 'INVALID', invoke: b.invoke },
      { backendId: 'fixture', invoke: b.invoke, extra: true }]) {
      assert.throws(() => createVantaDBProjector(f.bound, config),
        (e) => e.code === 'BRAIN_INVALID_INPUT');
    }
    assert.throws(() => createVantaDBProjector({ ...f.bound },
      { backendId: 'fixture', invoke: b.invoke }), (e) => e.code === 'SCOPE_DENIED');
    assert.deepEqual(tree(f.dir), before);
    assert.deepEqual(b.calls, []);
  } finally { cleanup(f.dir); }
});

test('projection policy rejects missing, extra or non-v1 protocol values without editing it', () => {
  const f = fixture();
  const b = backend();
  const open = fs.openSync;
  const policyPath = fileURLToPath(new URL('../policy/vantadb-projection.json', import.meta.url));
  const replacement = path.join(f.dir, 'fixture-policy.json');
  try {
    const valid = { schemaVersion: 1, formatVersion: 1,
      chunkBytes: 262144, maxToolResultBytes: 8388608 };
    fs.openSync = function (file, flags, ...args) {
      return open.call(this, file === policyPath ? replacement : file, flags, ...args);
    };
    for (const value of [
      { ...valid, extra: true }, { ...valid, formatVersion: 2 },
      { ...valid, chunkBytes: 1 }, { ...valid, maxToolResultBytes: 1 },
      { schemaVersion: 1 },
    ]) {
      fs.writeFileSync(replacement, JSON.stringify(value));
      assert.throws(() => projector(f, b), (e) => e.code === 'POLICY_MALFORMED');
    }
    fs.writeFileSync(replacement, 'x'.repeat(1048577));
    assert.throws(() => projector(f, b), (e) => e.code === 'POLICY_MALFORMED');
    assert.deepEqual(b.calls, []);
  } finally { fs.openSync = open; cleanup(f.dir); }
});

test('UTF8 BOM and multibyte boundary, binary and empty source roundtrip exactly', async () => {
  const f = fixture();
  const b = backend();
  try {
    const utf8 = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.alloc(262140, 0x61), Buffer.from('😊fin')]);
    const binary = Buffer.from([0xff, 0x00, 0xc3, 0x28]);
    const r = emit(f, [change([f.a], 'utf8', utf8), change([f.a], 'binary', binary),
      change([f.a], 'empty', Buffer.alloc(0))]);
    const report = await projector(f, b).drain();
    assert.deepEqual(report.acknowledgedEventIds, r.eventIds);
    assert.equal(report.failure, null);
    for (const [i, bytes] of [utf8, binary, Buffer.alloc(0)].entries()) {
      const e = event(f, r, i);
      const ns = addresses(e);
      const raw = b.values.get(key(ns.events, e.eventId));
      const envelope = JSON.parse(raw);
      assert.equal(raw, canonicalJSON(envelope));
      assert.deepEqual(Object.keys(envelope).sort(),
        ['event', 'eventDigest', 'schemaVersion', 'snapshot', 'type']);
      assert.deepEqual(Object.keys(envelope.snapshot).sort(),
        ['byteLength', 'chunks', 'encoding', 'namespace', 'sourceHash']);
      assert.deepEqual(envelope.event, e);
      assert.equal(envelope.eventDigest, canonicalDigest(e));
      assert.equal(envelope.snapshot.namespace, ns.chunks);
      assert.equal(envelope.snapshot.byteLength, bytes.length);
      assert.equal(envelope.snapshot.sourceHash, e.sourceHash);
      assert.equal(envelope.snapshot.encoding, i === 1 ? 'base64' : 'utf8');
      const chunks = envelope.snapshot.chunks.map((k) => b.values.get(key(ns.chunks, k)));
      assert.ok(chunks.every((chunk) => Buffer.byteLength(chunk) <= 262144));
      const restored = Buffer.from(chunks.join(''), envelope.snapshot.encoding);
      assert.deepEqual(restored, bytes);
      if (i === 0) {
        assert.equal(chunks.length, 2);
        assert.equal(Buffer.byteLength(chunks[0]), 262143);
      }
      if (i === 2) assert.deepEqual(chunks, []);
    }
  } finally { cleanup(f.dir); }
});

test('identical snapshots share scoped chunks while events remain distinct', async () => {
  const f = fixture();
  const b = backend();
  try {
    const r = emit(f, [change([f.a], 'a', 'same'), change([f.a], 'b', 'same')]);
    const report = await projector(f, b).drain();
    assert.deepEqual(report.acknowledgedEventIds, r.eventIds);
    const puts = b.calls.filter((call) => call.name === 'memory_put');
    assert.equal(puts.filter((call) => call.arguments.key.startsWith('blob-v1-')).length, 1);
    assert.equal(puts.filter((call) => r.eventIds.includes(call.arguments.key)).length, 2);
  } finally { cleanup(f.dir); }
});

test('multi-segment base64 chunks roundtrip arbitrary bytes', async () => {
  const f = fixture();
  const b = backend();
  try {
    const bytes = Buffer.alloc(200000, 0xff);
    const r = emit(f, [change([f.a], 'binary-large', bytes)]);
    assert.deepEqual((await projector(f, b).drain()).acknowledgedEventIds, r.eventIds);
    const e = event(f, r);
    const ns = addresses(e);
    const envelope = JSON.parse(b.values.get(key(ns.events, e.eventId)));
    assert.equal(envelope.snapshot.encoding, 'base64');
    const segments = envelope.snapshot.chunks.map((item) => b.values.get(key(ns.chunks, item)));
    assert.equal(segments.length, 2);
    assert.equal(segments[0].length, 262144);
    assert.deepEqual(Buffer.from(segments.join(''), 'base64'), bytes);
  } finally { cleanup(f.dir); }
});

test('scopes filter and authorize all-of; separate area sets use separate namespaces', async () => {
  const f = fixture();
  const b = backend();
  try {
    const r = emit(f, [change([f.a], 'a', 'same'), change([f.b], 'b', 'same'),
      change([f.a, f.b], 'shared', 'same')]);
    const limited = projector(f, b, f.alpha);
    assert.deepEqual((await limited.drain()).acknowledgedEventIds, [r.eventIds[0]]);
    const calls = b.calls.length;
    for (const id of r.eventIds.slice(1)) {
      await assert.rejects(limited.project(r.operationId, id), (e) => e.code === 'SCOPE_DENIED');
    }
    assert.equal(b.calls.length, calls);
    const all = await projector(f, b).drain();
    assert.deepEqual(all.acknowledgedEventIds, r.eventIds.slice(1));
    assert.equal(new Set(r.eventIds.map((_, i) => addresses(event(f, r, i)).chunks)).size, 3);
    assert.equal(b.calls.filter((call) => call.name === 'memory_put'
      && call.arguments.key.startsWith('blob-v1-')).length, 3);
  } finally { cleanup(f.dir); }
});

test('lost put reply does not ack; retry reads the same key without another put', async () => {
  for (const kind of ['chunk', 'event']) {
    const f = fixture();
    const b = backend();
    const original = b.invoke;
    let lostKey;
    b.invoke = async (request) => {
      const response = await original(request);
      const isChunk = request.arguments.key.startsWith('blob-v1-');
      if (request.name === 'memory_put' && !lostKey && isChunk === (kind === 'chunk')) {
        lostKey = request.arguments.key;
        throw new Error('lost reply');
      }
      return response;
    };
    try {
      const r = emit(f, [change([f.a], 'a', 'payload')]);
      const p = projector(f, b);
      const first = await p.drain();
      assert.deepEqual(first.acknowledgedEventIds, []);
      assert.equal(first.failure.stage, 'write');
      assert.equal(first.failure.error.code, 'BRAIN_REMOTE_UNCERTAIN');
      assert.equal(listJournalPending(f.bound).items.length, 1);
      assert.ok(lostKey);
      const second = await p.drain();
      assert.deepEqual(second.acknowledgedEventIds, r.eventIds);
      assert.equal(b.calls.filter((call) => call.name === 'memory_put'
        && call.arguments.key === lostKey).length, 1);
    } finally { cleanup(f.dir); }
  }
});

test('later chunk failure retains prior chunk and does not ack or write event', async () => {
  const f = fixture();
  const b = backend();
  const original = b.invoke;
  let failed = false;
  b.invoke = async (request) => {
    if (!failed && request.name === 'memory_put' && request.arguments.key.endsWith('-0001')) {
      failed = true;
      b.calls.push(structuredClone(request));
      throw new Error('network lost');
    }
    return original(request);
  };
  try {
    const r = emit(f, [change([f.a], 'large', Buffer.alloc(262145, 0x61))]);
    const e = event(f, r);
    const ns = addresses(e);
    const p = projector(f, b);
    const first = await p.drain();
    assert.equal(first.failure.stage, 'write');
    assert.deepEqual(first.acknowledgedEventIds, []);
    assert.equal(b.values.has(key(ns.events, e.eventId)), false);
    const firstChunk = b.calls.find((call) => call.name === 'memory_put'
      && call.arguments.key.endsWith('-0000')).arguments.key;
    assert.deepEqual((await p.drain()).acknowledgedEventIds, r.eventIds);
    assert.equal(b.calls.filter((call) => call.name === 'memory_put'
      && call.arguments.key === firstChunk).length, 1);
  } finally { cleanup(f.dir); }
});

test('later event failure preserves earlier ack and leaves the outbox index', async () => {
  const f = fixture();
  const b = backend();
  const original = b.invoke;
  try {
    const r = emit(f, [change([f.a], 'one', 'one'), change([f.a], 'two', 'two')]);
    b.invoke = async (request) => {
      if (request.name === 'memory_get' && request.arguments.key === r.eventIds[1]) {
        b.calls.push(structuredClone(request));
        return { isError: true, content: [{ type: 'text',
          text: JSON.stringify({ code: -32001, message: 'busy', data: { code: 'BUSY' } }) }] };
      }
      return original(request);
    };
    const report = await projector(f, b).drain();
    assert.deepEqual(report.acknowledgedEventIds, [r.eventIds[0]]);
    assert.equal(report.failure.eventId, r.eventIds[1]);
    assert.equal(report.failure.error.code, 'BRAIN_BACKEND_ERROR');
    assert.deepEqual(listJournalPending(f.bound).items.map((item) => item.event.eventId),
      [r.eventIds[1]]);
    assert.equal(fs.existsSync(path.join(f.journal, 'outbox', `${r.operationId}.json`)), true);
  } finally { cleanup(f.dir); }
});

test('event conflict stops before chunks; chunk conflict never overwrites', async () => {
  for (const variant of ['event', 'chunk']) {
    const f = fixture();
    const b = backend();
    try {
      const r = emit(f, [change([f.a], 'a', 'payload')]);
      const e = event(f, r);
      const ns = addresses(e);
      const target = variant === 'event' ? key(ns.events, e.eventId)
        : key(ns.chunks, `blob-v1-${e.sourceHash}-utf8-0000`);
      b.values.set(target, variant === 'event' ? '{"wrong":true}' : 'wrong');
      const report = await projector(f, b).drain();
      assert.equal(report.failure.error.code, 'BRAIN_REMOTE_CONFLICT');
      assert.deepEqual(report.acknowledgedEventIds, []);
      assert.equal(b.values.get(target), variant === 'event' ? '{"wrong":true}' : 'wrong');
      assert.equal(b.calls.filter((call) => call.name === 'memory_put').length, 0);
    } finally { cleanup(f.dir); }
  }
});

test('matching event and missing chunk is verified and repaired before ack', async () => {
  const f = fixture();
  const b = backend();
  try {
    const r = emit(f, [change([f.a], 'a', 'payload')]);
    const e = event(f, r);
    const ns = addresses(e);
    const chunk = `blob-v1-${e.sourceHash}-utf8-0000`;
    b.values.set(key(ns.events, e.eventId), canonicalJSON({
      schemaVersion: 1, type: 'scopegrain.journal-event', event: e,
      eventDigest: canonicalDigest(e),
      snapshot: { namespace: ns.chunks, encoding: 'utf8', byteLength: 7,
        sourceHash: e.sourceHash, chunks: [chunk] },
    }));
    assert.deepEqual((await projector(f, b).drain()).acknowledgedEventIds, r.eventIds);
    assert.equal(b.values.get(key(ns.chunks, chunk)), 'payload');
    assert.equal(b.calls.filter((call) => call.name === 'memory_put'
      && call.arguments.key === e.eventId).length, 0);
  } finally { cleanup(f.dir); }
});

test('event is rechecked after chunks and a newly conflicting value is never overwritten', async () => {
  const f = fixture();
  const b = backend();
  const original = b.invoke;
  try {
    const r = emit(f, [change([f.a], 'a', 'payload')]);
    const e = event(f, r);
    const ns = addresses(e);
    let injected = false;
    b.invoke = async (request) => {
      const result = await original(request);
      if (!injected && request.name === 'memory_put'
          && request.arguments.key.startsWith('blob-v1-')) {
        injected = true;
        b.values.set(key(ns.events, e.eventId), '{"foreign":true}');
      }
      return result;
    };
    const report = await projector(f, b).drain();
    assert.equal(report.failure.error.code, 'BRAIN_REMOTE_CONFLICT');
    assert.deepEqual(report.acknowledgedEventIds, []);
    assert.equal(b.values.get(key(ns.events, e.eventId)), '{"foreign":true}');
    assert.equal(b.calls.filter((call) => call.name === 'memory_put'
      && call.arguments.key === e.eventId).length, 0);
  } finally { cleanup(f.dir); }
});

test('only exact typed get-not-found is absence, including thrown RPC form', async () => {
  const { McpError } = await import('@modelcontextprotocol/sdk/types.js');
  for (const variant of ['envelope', 'thrown', 'text-success']) {
    const f = fixture();
    const b = backend();
    const original = b.invoke;
    b.invoke = async (request) => {
      const response = await original(request);
      if (request.name === 'memory_get' && response.isError && variant === 'thrown') {
        throw new McpError(-32004, 'ignored remote text',
          { code: 'VANTADB_NOT_FOUND', retriable: false });
      }
      if (!response.isError && variant === 'text-success') {
        return { content: response.content };
      }
      return response;
    };
    try {
      const r = emit(f, [change([f.a], 'a', 'payload')]);
      assert.deepEqual((await projector(f, b).drain()).acknowledgedEventIds, r.eventIds);
    } finally { cleanup(f.dir); }
  }
});

test('busy, malformed, wrong identity and oversized results never trigger put', async () => {
  const variants = [
    { response: { isError: true, content: [{ type: 'text', text: JSON.stringify({
      code: -32001, message: 'busy', data: { code: 'BUSY', retriable: true },
    }) }] }, code: 'BRAIN_BACKEND_ERROR' },
    { response: { isError: true, content: [{ type: 'text', text: JSON.stringify({
      code: -32004, message: 'not found', data: { code: 'VANTADB_NOT_FOUND', retriable: true },
    }) }] }, code: 'BRAIN_BACKEND_ERROR' },
    { response: { isError: true, content: [{ type: 'text', text: 'not JSON' }] },
      code: 'BRAIN_INVALID_RESPONSE' },
    { response: { content: [{ type: 'text', text: '{}' }, { type: 'text', text: '{}' }] },
      code: 'BRAIN_INVALID_RESPONSE' },
    { response: { structuredContent: { namespace: 'wrong', key: 'wrong', payload: 'x' },
      content: [] }, code: 'BRAIN_INVALID_RESPONSE' },
    { response: { content: [{ type: 'text', text: 'x'.repeat(8388609) }] },
      code: 'BRAIN_RESPONSE_TOO_LARGE' },
  ];
  for (const variant of variants) {
    const f = fixture();
    const calls = [];
    try {
      emit(f, [change([f.a], 'a', 'payload')]);
      const p = createVantaDBProjector(f.bound, { backendId: 'fixture', invoke: async (request) => {
        calls.push(request);
        return variant.response;
      } });
      const report = await p.drain();
      assert.equal(report.failure.stage, 'read');
      assert.equal(report.failure.error.code, variant.code);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].name, 'memory_get');
      assert.equal(listJournalPending(f.bound).items.length, 1);
    } finally { cleanup(f.dir); }
  }
});

test('put errors including typed not-found never acknowledge the event', async () => {
  const f = fixture();
  const b = backend();
  const original = b.invoke;
  b.invoke = async (request) => {
    if (request.name === 'memory_put') { b.calls.push(request); return absent(); }
    return original(request);
  };
  try {
    emit(f, [change([f.a], 'a', 'payload')]);
    const report = await projector(f, b).drain();
    assert.equal(report.failure.stage, 'write');
    assert.deepEqual(report.acknowledgedEventIds, []);
    assert.equal(listJournalPending(f.bound).items.length, 1);
  } finally { cleanup(f.dir); }
});

test('thrown busy and generic errors are not absence and do not leak remote text', async () => {
  for (const variant of ['busy', 'generic']) {
    const f = fixture();
    const calls = [];
    try {
      emit(f, [change([f.a], 'a', 'payload')]);
      const p = createVantaDBProjector(f.bound, { backendId: 'fixture', invoke: async (request) => {
        calls.push(request);
        const error = new Error('PRIVATE REMOTE DIAGNOSTIC');
        if (variant === 'busy') {
          error.code = -32001;
          error.data = { code: 'BUSY', retriable: true };
        }
        throw error;
      } });
      const result = await p.drain();
      assert.equal(result.failure.error.code, 'BRAIN_BACKEND_ERROR');
      assert.equal(result.failure.stage, 'read');
      assert.equal(JSON.stringify(result).includes('PRIVATE REMOTE DIAGNOSTIC'), false);
      assert.deepEqual(calls.map((call) => call.name), ['memory_get']);
    } finally { cleanup(f.dir); }
  }
});

test('response accessors are rejected without invoking the getter', async () => {
  const f = fixture();
  let getterCalls = 0;
  const calls = [];
  try {
    emit(f, [change([f.a], 'a', 'payload')]);
    const response = {};
    Object.defineProperty(response, 'structuredContent', {
      enumerable: true, get() { getterCalls += 1; return {}; },
    });
    const p = createVantaDBProjector(f.bound, { backendId: 'fixture', invoke: async (request) => {
      calls.push(request);
      return response;
    } });
    const result = await p.drain();
    assert.equal(result.failure.error.code, 'BRAIN_INVALID_RESPONSE');
    assert.equal(getterCalls, 0);
    assert.deepEqual(calls.map((call) => call.name), ['memory_get']);
  } finally { cleanup(f.dir); }
});

test('put may include native warning and fallback fields without changing the projection', async () => {
  const f = fixture();
  const b = backend();
  const original = b.invoke;
  b.invoke = async (request) => {
    const response = await original(request);
    if (request.name === 'memory_put') {
      response.structuredContent.warning = 'fixture warning';
      response.structuredContent.fallback = true;
    }
    return response;
  };
  try {
    const r = emit(f, [change([f.a], 'a', 'payload')]);
    const result = await projector(f, b).drain();
    assert.deepEqual(result.acknowledgedEventIds, r.eventIds);
    assert.equal(result.failure, null);
    assert.deepEqual(result.warnings, []);
  } finally { cleanup(f.dir); }
});

test('prepared events are blocked without lease, writes or remote calls', async () => {
  const f = fixture();
  const b = backend();
  const open = fs.openSync;
  try {
    const destination = path.join(f.dir, 'records', 'a');
    fs.openSync = function (file, flags, ...args) {
      // applyPlan stages via an exclusive `<dest>.*` temp; both paths fail.
      if ((file === destination || String(file).startsWith(`${destination}.`))
          && flags === 'wx') throw new Error('source failure');
      return open.call(this, file, flags, ...args);
    };
    const r = emit(f, [change([f.a], 'a', 'payload')]);
    fs.openSync = open;
    assert.equal(r.status, 'unconfirmed');
    const before = tree(f.dir);
    const p = projector(f, b);
    const report = await p.drain();
    assert.deepEqual(report.blockedEventIds, r.eventIds);
    assert.deepEqual(report.acknowledgedEventIds, []);
    await assert.rejects(p.project(r.operationId, r.eventIds[0]),
      (e) => e.code === 'JOURNAL_NOT_COMMITTED');
    assert.deepEqual(tree(f.dir), before);
    assert.deepEqual(b.calls, []);
  } finally { fs.openSync = open; cleanup(f.dir); }
});

test('tampered snapshot and stale binding stop remote delivery', async () => {
  for (const variant of ['snapshot', 'stale-after-call']) {
    const f = fixture();
    const b = backend();
    const original = b.invoke;
    try {
      const r = emit(f, [change([f.a], 'a', 'payload')]);
      const e = event(f, r);
      if (variant === 'snapshot') {
        fs.writeFileSync(path.join(f.dir, ...e.snapshotRef.split('/')), 'tampered');
      } else {
        b.invoke = async (request) => {
          const response = await original(request);
          const metadata = path.join(f.dir, '.scopegrain/state/workspace.json');
          const workspace = JSON.parse(fs.readFileSync(metadata));
          workspace.revision += 1;
          fs.writeFileSync(metadata, JSON.stringify(workspace));
          return response;
        };
      }
      const report = await projector(f, b).drain();
      assert.equal(report.failure.error.code,
        variant === 'snapshot' ? 'JOURNAL_SNAPSHOT_MISMATCH' : 'WORKSPACE_STALE');
      assert.equal(b.calls.length, variant === 'snapshot' ? 0 : 1);
      assert.ok(b.calls.every((call) => call.name === 'memory_get'));
      assert.deepEqual(report.acknowledgedEventIds, []);
    } finally { cleanup(f.dir); }
  }
});

test('lease contention rejects and replaced token or inode survives acknowledged delivery', async () => {
  for (const variant of ['contended', 'replaced', 'inode-replaced']) {
    const f = fixture();
    const b = backend();
    const original = b.invoke;
    try {
      const r = emit(f, [change([f.a], 'a', 'payload')]);
      const lease = path.join(f.journal, '.vantadb-projection.lock');
      if (variant === 'contended') fs.writeFileSync(lease, 'foreign');
      else {
        let replaced = false;
        b.invoke = async (request) => {
          if (!replaced) {
            replaced = true;
            if (variant === 'replaced') {
              fs.writeFileSync(lease, 'replacement');
            } else {
              const bytes = fs.readFileSync(lease);
              const replacement = path.join(f.journal, 'replacement-lease');
              fs.writeFileSync(replacement, bytes);
              const previous = fs.statSync(lease, { bigint: true });
              const next = fs.statSync(replacement, { bigint: true });
              assert.ok(previous.dev !== next.dev || previous.ino !== next.ino);
              fs.unlinkSync(lease);
              fs.renameSync(replacement, lease);
            }
          }
          return original(request);
        };
      }
      const p = projector(f, b);
      if (variant === 'contended') {
        await assert.rejects(p.drain(), (e) => e.code === 'BRAIN_SYNC_LOCKED');
        assert.equal(fs.readFileSync(lease, 'utf8'), 'foreign');
        assert.equal(b.calls.length, 0);
      } else {
        const report = await p.drain();
        assert.deepEqual(report.acknowledgedEventIds, r.eventIds);
        assert.ok(report.warnings.length);
        if (variant === 'replaced') assert.equal(fs.readFileSync(lease, 'utf8'), 'replacement');
        else assert.match(fs.readFileSync(lease, 'utf8'), /^[0-9a-f-]{36}$/);
      }
    } finally { cleanup(f.dir); }
  }
});

test('a suspended invoker holds no journal lock and other local writes can proceed', async () => {
  const f = fixture();
  const b = backend();
  const original = b.invoke;
  let enter;
  let resume;
  const entered = new Promise((resolve) => { enter = resolve; });
  const released = new Promise((resolve) => { resume = resolve; });
  let firstCall = true;
  b.invoke = async (request) => {
    if (firstCall) {
      firstCall = false;
      enter();
      await released;
    }
    return original(request);
  };
  let timeout;
  let draining;
  try {
    const first = emit(f, [change([f.a], 'first', 'one')]);
    draining = projector(f, b).drain();
    await Promise.race([entered, new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('invoker was not reached')), 10000);
    })]);
    clearTimeout(timeout);
    const second = emit(f, [change([f.a], 'second', 'two')]);
    assert.equal(second.status, 'committed');
    resume();
    assert.deepEqual((await draining).acknowledgedEventIds, first.eventIds);
    assert.deepEqual(listJournalPending(f.bound).items.map((item) => item.event.eventId),
      second.eventIds);
  } finally {
    clearTimeout(timeout);
    resume();
    if (draining) await draining.catch(() => {});
    cleanup(f.dir);
  }
});

test('explicit project retries ack cleanup without rewriting remote data or timestamp', async () => {
  const f = fixture();
  const b = backend();
  const unlink = fs.unlinkSync;
  try {
    const r = emit(f, [change([f.a], 'a', 'payload')]);
    const index = path.join(f.journal, 'outbox', `${r.operationId}.json`);
    let injected = false;
    fs.unlinkSync = function (file, ...args) {
      if (file === index && !injected) {
        injected = true;
        throw new Error('fixture outbox unlink failure');
      }
      return unlink.call(this, file, ...args);
    };
    const p = projector(f, b);
    const first = await p.drain();
    fs.unlinkSync = unlink;
    assert.equal(first.failure.stage, 'ack');
    assert.equal(first.failure.error.code, 'BRAIN_LOCAL_ACK_UNCERTAIN');
    assert.deepEqual(first.acknowledgedEventIds, []);
    const ack = path.join(f.journal, 'operations', r.operationId, 'acks', `${r.eventIds[0]}.json`);
    const bytes = fs.readFileSync(ack);
    const calls = b.calls.length;
    assert.deepEqual((await p.drain()).acknowledgedEventIds, []);
    assert.equal(b.calls.length, calls);
    const putCount = b.calls.filter((call) => call.name === 'memory_put').length;
    const retry = await p.project(r.operationId, r.eventIds[0]);
    assert.deepEqual(retry.acknowledgedEventIds, r.eventIds);
    assert.equal(b.calls.filter((call) => call.name === 'memory_put').length, putCount);
    assert.deepEqual(fs.readFileSync(ack), bytes);
    assert.equal(fs.existsSync(index), false);
  } finally { fs.unlinkSync = unlink; cleanup(f.dir); }
});

test('SDK 1.x in-memory MCP transport roundtrips exact get and put contract', async () => {
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
  const { CallToolRequestSchema, ListToolsRequestSchema } =
    await import('@modelcontextprotocol/sdk/types.js');
  const { z } = await import('zod');
  const schemas = {
    memory_get: z.object({ namespace: z.string(), key: z.string() }).strict(),
    memory_put: z.object({ namespace: z.string(), key: z.string(),
      payload: z.string(), metadata: z.record(z.any()).optional() }).strict(),
  };
  const f = fixture();
  const b = backend();
  let client;
  let server;
  try {
    server = new Server({ name: 'fixture-vantadb', version: '1.0.0' },
      { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: Object.keys(schemas).map((name) => ({
        name, inputSchema: { type: 'object', properties: {
          namespace: { type: 'string' }, key: { type: 'string' },
          ...(name === 'memory_put' ? { payload: { type: 'string' } } : {}),
        }, required: name === 'memory_put' ? ['namespace', 'key', 'payload'] : ['namespace', 'key'],
        additionalProperties: false },
      })),
    }));
    server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
      assert.ok(Object.hasOwn(schemas, params.name));
      assert.equal(schemas[params.name].safeParse(params.arguments).success, true);
      return b.invoke({ name: params.name, arguments: params.arguments });
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'fixture-client', version: '1.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name).sort(),
      ['memory_get', 'memory_put']);
    const r = emit(f, [change([f.a], 'wire', 'wire data')]);
    const p = createVantaDBProjector(f.bound, {
      backendId: 'fixture', invoke: (request) => client.callTool(request),
    });
    assert.deepEqual((await p.drain()).acknowledgedEventIds, r.eventIds);
    assert.ok(b.calls.some((call) => call.name === 'memory_get'));
    assert.ok(b.calls.some((call) => call.name === 'memory_put'));
  } finally {
    try { if (client) await client.close(); }
    finally { try { if (server) await server.close(); } finally { cleanup(f.dir); } }
  }
});
