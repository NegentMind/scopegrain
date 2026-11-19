// report save/list: persisted doctor snapshots under paths.reports.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createConfig } from '../src/core/config.mjs';
import {
  VALID_ANSWERS, cleanup, makeTempDir, writeJson,
} from './helpers.mjs';
import { run } from '../src/cli.mjs';
import { fakeIO } from './helpers.mjs';

test('report save persists a doctor snapshot; list enumerates newest-first', async () => {
  const dir = makeTempDir('cli-report');
  try {
    writeJson(dir, '.tasksystem/config.json',
      createConfig(dir, VALID_ANSWERS, {}));
    const io = fakeIO();
    const code = await run(['report', 'save', '--project', dir], io);
    assert.equal(code, 0);
    const saved = JSON.parse(io.out.stdout.at(-1));
    assert.ok(saved.rel.endsWith('-status.json'));
    assert.equal(typeof saved.status, 'string');
    const abs = path.join(dir, saved.rel);
    assert.ok(fs.existsSync(abs));
    const stored = JSON.parse(fs.readFileSync(abs, 'utf8'));
    assert.equal(stored.schemaVersion, 1);
    assert.ok(Array.isArray(stored.checks));
    const io2 = fakeIO();
    const code2 = await run(['report', 'list', '--project', dir], io2);
    assert.equal(code2, 0);
    const listed = JSON.parse(io2.out.stdout.at(-1));
    assert.equal(listed.reports.length, 1);
    assert.ok(listed.reports[0].endsWith('-status.json'));
  } finally { cleanup(dir); }
});
