// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { detectHostClis } from '../src/core/host-cli.mjs';
import { runDoctor } from '../src/core/doctor.mjs';
import {
  bootstrappedCtx, cleanup, makeTempDir, VALID_ANSWERS,
} from './helpers.mjs';

test('detectHostClis finds binaries in an injected PATH dir', () => {
  const dir = makeTempDir('hostcli');
  try {
    fs.writeFileSync(path.join(dir, 'fakehost'), '#!/bin/sh\n');
    const r = detectHostClis(['fakehost'],
      { path: dir, home: '/nonexistent', platform: 'linux' });
    assert.ok(r.fakehost.found);
    assert.equal(r.fakehost.location, dir);
  } finally {
    cleanup(dir);
  }
});

test('detectHostClis reports missing binaries without throwing', () => {
  const dir = makeTempDir('hostcli-empty');
  try {
    const r = detectHostClis(['claude', 'ghosthost'],
      { path: dir, home: '/nonexistent', platform: 'linux' });
    assert.equal(r.claude.found, false);
    assert.equal(r.ghosthost.found, false);
    assert.equal(r.ghosthost.location, null);
  } finally {
    cleanup(dir);
  }
});

test('detectHostClis probes windows extensions on win32', () => {
  const dir = makeTempDir('hostcli-win');
  try {
    fs.writeFileSync(path.join(dir, 'codex.cmd'), '@echo off\n');
    const r = detectHostClis(['codex'],
      { path: dir, home: dir, platform: 'win32' });
    assert.ok(r.codex.found);
  } finally {
    cleanup(dir);
  }
});

test('doctor host-cli check is informational and structured', () => {
  const { dir, ctx } = bootstrappedCtx(VALID_ANSWERS);
  try {
    const report = runDoctor(ctx);
    const check = report.checks.find((c) => c.name === 'host-cli');
    assert.ok(check, 'host-cli check exists');
    assert.ok(check.ok);
    assert.ok(typeof check.hosts === 'object');
    for (const h of VALID_ANSWERS.hosts) {
      assert.ok(h in check.hosts);
      assert.equal(typeof check.hosts[h].found, 'boolean');
    }
    assert.ok(Array.isArray(check.missing));
  } finally {
    cleanup(dir);
  }
});
