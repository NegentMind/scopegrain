// SPDX-License-Identifier: Apache-2.0
// Lock-contention worker. Standalone child process: competes for
// acquireVerifiedLock on --lock, then runs a checkable critical section:
// write our pid into --marker, hold, re-read — a different pid on
// re-read means a second holder entered "our" section (VIOLATION).
// Every event is appended to this child's PRIVATE --log file, so logs
// from concurrent workers can never interleave mid-line.
// Exit lines: OK <round> | LOCKED <code> | VIOLATION ... |
//   SECTION_ERROR <code> | RELEASE_ERROR <code> | SUMMARY ...
import fs from 'node:fs';
import {
  acquireVerifiedLock, releaseVerifiedLock,
} from '../../../src/core/locks.mjs';

const flag = (name, fallback) => {
  const i = process.argv.indexOf(name);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  return v !== undefined && !v.startsWith('--') ? v : fallback;
};

const lockPath = flag('--lock', null);
const marker = flag('--marker', null);
const logPath = flag('--log', null);
const rounds = Number(flag('--rounds', '10'));
const tries = Number(flag('--tries', '200'));
const holdMs = Number(flag('--hold', '15'));
const staleMs = Number(flag('--stale', '60000'));
const orphanStaleMs = Number(flag('--orphan-stale', '60000'));

if (!lockPath || !marker || !logPath) {
  process.stderr.write('lock-contender-child: --lock --marker --log required\n');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = () => 2 + Math.floor(Math.random() * 10);
const log = (line) => fs.appendFileSync(logPath, `${line}\n`);

let acquired = 0;
let refused = 0;
let violations = 0;

for (let i = 0; i < rounds; i += 1) {
  let lock = null;
  // Retry until acquired (bounded): contention must only ever produce
  // the structured lock code — and must not starve a worker forever.
  for (let attempt = 0; attempt < tries && !lock; attempt += 1) {
    try {
      lock = acquireVerifiedLock(lockPath, 'TEST_LOCKED',
        'lock held by another process', { staleMs, orphanStaleMs });
    } catch (e) {
      refused += 1;
      log(`LOCKED ${e.code ?? 'UNKNOWN'}`);
      await sleep(jitter());
    }
  }
  if (!lock) {
    log(`STARVED ${i} tries=${tries}`);
    continue;
  }
  try {
    fs.writeFileSync(marker, String(process.pid));
    await sleep(holdMs + Math.floor(Math.random() * holdMs));
    let seen = null;
    try {
      seen = fs.readFileSync(marker, 'utf8');
    } catch { /* marker vanished under us: a second writer */ }
    if (seen !== String(process.pid)) {
      violations += 1;
      log(`VIOLATION expected=${process.pid} seen=${String(seen)}`);
    }
    try { fs.rmSync(marker); } catch { /* best effort */ }
    releaseVerifiedLock(lock);
    acquired += 1;
    log(`OK ${i}`);
  } catch (e) {
    log(`SECTION_ERROR ${e.code ?? e.message}`);
    try {
      releaseVerifiedLock(lock);
    } catch (e2) {
      log(`RELEASE_ERROR ${e2.code ?? e2.message}`);
    }
  }
  await sleep(jitter());
}

log(`SUMMARY acquired=${acquired} locked=${refused} violations=${violations}`);
process.stdout.write('EXIT\n');
