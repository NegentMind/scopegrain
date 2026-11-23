// SPDX-License-Identifier: Apache-2.0
// Verified token locks over absolute paths: the journal acquire/release
// discipline generalized for the *.lock callers. acquire writes a random
// token under 'wx' and records the created file's {dev, ino}; release
// re-proves the SAME file still carries that token before unlinking, so
// a stale finally can never delete a successor's lock.
//
// Stale-lock recovery (posture changed 2026-11-20, owner decision):
// lock payloads are JSON {t, pid, at}. A lock whose recorded pid is
// provably DEAD (ESRCH) is broken and reclaimed — the process can never
// finish its write. A lock whose pid is alive is never broken,
// regardless of age. Locks without pid metadata (legacy bare tokens,
// zero-byte sentinels) are reclaimed only after staleMs of mtime age,
// and the reclaim re-verifies {dev, ino} so a delete+recreate race
// cannot make us delete a successor's lock.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { err } from './errors.mjs';
import { readFileLimited } from './fsx.mjs';

// Bounded read for the cleanup prefix check. The close is tolerant: a
// completed read keeps its bytes even when closeSync fails — a close-time
// error must not strand a lock we provably own.
function readLockPrefix(lockPath, limit) {
  let fd;
  let content = null;
  try {
    fd = fs.openSync(lockPath, 'r');
    const st = fs.fstatSync(fd);
    if (st.size > limit) return null;
    const buf = Buffer.alloc(st.size);
    let off = 0;
    while (off < st.size) {
      const n = fs.readSync(fd, buf, off, st.size - off, off);
      if (n <= 0) return null;
      off += n;
    }
    content = buf;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* descriptor may be broken */ }
    }
  }
  return content;
}

// Cleanup counterpart of journal's removeOwned: after an acquire-time
// write failure, unlink only a file still provably ours — same dev/ino
// and contents that are a prefix of the token bytes we were writing.
// An inconclusive read preserves the file.
function removeOwnedLock(lockPath, owner, bytes) {
  try {
    const current = fs.lstatSync(lockPath, { bigint: true });
    if (!owner || !current.isFile() || current.dev !== owner.dev
        || current.ino !== owner.ino) {
      return;
    }
    const content = readLockPrefix(lockPath, bytes.length);
    if (content === null
        || !bytes.subarray(0, content.length).equals(content)) {
      return;
    }
    fs.unlinkSync(lockPath);
  } catch { /* preserve anything not provably ours */ }
}

// Default staleness for metadata-less locks (legacy tokens, sentinels):
// one hour. Locks carrying a live pid are never reclaimed — a suspended
// writer is still a real writer and breaking its lock permits a second
// writer into the same section.
const DEFAULT_STALE_MS = 60 * 60 * 1000;

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true; // exists (ESRCH would throw; EPERM also means exists)
  } catch (e) {
    return e && e.code === 'EPERM'; // exists but owned by another user
  }
}

// Decide whether an existing lock file is reclaimable, then break it.
// Re-verifies {dev, ino} between inspect and unlink: if the file was
// deleted and recreated meanwhile, we preserve the successor's lock.
// Known limitation (documented owner posture): a pid value that was
// REUSED by an unrelated live process keeps the lock unbreakable
// forever — liveness proves only that some process exists. Breaking a
// live-pid lock by age would defeat the suspended-writer guarantee, so
// recovery from pid reuse remains a manual operator action.
function tryReclaimStaleLock(lockPath, staleMs) {
  let stat;
  try {
    stat = fs.lstatSync(lockPath, { bigint: true });
  } catch {
    return; // vanished under us — nothing to reclaim
  }
  if (!stat.isFile()) return;
  const raw = readLockPrefix(lockPath, 4096);
  const text = raw === null ? '' : raw.toString('utf8');
  let pid = null;
  try {
    const parsed = JSON.parse(text);
    if (Number.isSafeInteger(parsed?.pid) && parsed.pid > 0) {
      pid = parsed.pid;
    }
  } catch { /* legacy bare token or empty sentinel */ }
  const reclaimable = pid !== null
    ? !pidAlive(pid) // dead writer: always reclaimable
    : Date.now() - Number(stat.mtimeMs) > staleMs;
  if (!reclaimable) return;
  let before;
  try {
    before = fs.lstatSync(lockPath, { bigint: true });
  } catch {
    return;
  }
  if (before.dev !== stat.dev || before.ino !== stat.ino) return;
  try {
    fs.unlinkSync(lockPath);
  } catch { /* someone else reclaimed it — the 'wx' retry decides */ }
}

// 'wx' create + token write + fsync; EEXIST maps to the caller's lock
// code, every other open/write failure propagates raw (callers may map
// e.g. ENOENT). The returned handle binds the path, token, inode
// identity and the caller's error code for the matching release.
export function acquireVerifiedLock(lockPath, code, existsMessage, options) {
  const staleMs = Number.isSafeInteger(options?.staleMs)
    ? options.staleMs : DEFAULT_STALE_MS;
  const token = crypto.randomUUID();
  // Lock payload: JSON {t,pid,at} so stale recovery can distinguish a
  // crashed writer (dead pid, reclaim) from a live one (never reclaim).
  const bytes = Buffer.from(
    `${JSON.stringify({ t: token, pid: process.pid,
      at: Date.now() })}\n`);
  let fd;
  try {
    fd = fs.openSync(lockPath, 'wx');
  } catch (e) {
    if (e && e.code === 'EEXIST') {
      tryReclaimStaleLock(lockPath, staleMs);
      try {
        fd = fs.openSync(lockPath, 'wx');
      } catch (e2) {
        if (e2 && e2.code === 'EEXIST') throw err(code, existsMessage);
        throw e2;
      }
    } else {
      throw e;
    }
  }
  let closed = false;
  let owner = null;
  try {
    const stats = fs.fstatSync(fd, { bigint: true });
    owner = { dev: stats.dev, ino: stats.ino };
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.writeSync(fd, bytes, offset, bytes.length - offset,
        offset);
      if (count <= 0) {
        throw err('WRITE_FAILED',
          `lock write made no progress: ${lockPath}`);
      }
      offset += count;
    }
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    closed = true;
    return { path: lockPath, token, owner, code };
  } catch (e) {
    if (!closed) {
      try { fs.closeSync(fd); } catch { /* descriptor may be closed */ }
    }
    removeOwnedLock(lockPath, owner, bytes);
    throw e;
  }
}

// Release proves ownership twice — before AND after the token read — so
// a delete+recreate race cannot turn our unlink into deleting a
// successor's lock. Any mismatch throws the caller's lock code: the
// lock was removed, replaced, or its token rewritten while held.
export function releaseVerifiedLock(lock) {
  const { path: lockPath, token, owner, code } = lock;
  const tokenBytes = Buffer.from(token);
  const checkOwner = () => {
    let current;
    try {
      current = fs.lstatSync(lockPath, { bigint: true });
    } catch (e) {
      if (e && e.code === 'ENOENT') {
        throw err(code, `lock file was removed: ${lockPath}`);
      }
      throw e;
    }
    if (!current.isFile() || current.dev !== owner.dev
        || current.ino !== owner.ino) {
      throw err(code, `lock file was replaced: ${lockPath}`);
    }
  };
  checkOwner();
  let limited;
  try {
    // 4 KiB bound: the JSON payload {t,pid,at} is ~90 bytes but a forged
    // file could be anything; the cap only exists to bound the read.
    limited = readFileLimited(lockPath, 4096);
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      throw err(code, `lock file was removed: ${lockPath}`);
    }
    throw e;
  }
  // Accept both payloads: JSON {t,pid,at} (current) and the legacy bare
  // token, so a lock written by an older binary still releases cleanly.
  let held = false;
  if (!limited.exceeded) {
    const text = limited.content.toString('utf8');
    try {
      held = JSON.parse(text)?.t === token;
    } catch {
      held = limited.content.equals(tokenBytes);
    }
  }
  if (!held) {
    throw err(code, `lock token was replaced: ${lockPath}`);
  }
  checkOwner();
  fs.unlinkSync(lockPath);
}
