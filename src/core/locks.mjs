// Verified token locks over absolute paths: the journal acquire/release
// discipline generalized for the *.lock callers. acquire writes a random
// token under 'wx' and records the created file's {dev, ino}; release
// re-proves the SAME file still carries that token before unlinking, so
// a stale finally can never delete a successor's lock. A pre-existing
// file — including a legacy zero-byte lock — still counts as held:
// there is no stale-lock recovery.
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

// 'wx' create + token write + fsync; EEXIST maps to the caller's lock
// code, every other open/write failure propagates raw (callers may map
// e.g. ENOENT). The returned handle binds the path, token, inode
// identity and the caller's error code for the matching release.
export function acquireVerifiedLock(lockPath, code, existsMessage) {
  const token = crypto.randomUUID();
  const bytes = Buffer.from(token);
  let fd;
  try {
    fd = fs.openSync(lockPath, 'wx');
  } catch (e) {
    if (e && e.code === 'EEXIST') throw err(code, existsMessage);
    throw e;
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
    limited = readFileLimited(lockPath, tokenBytes.length);
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      throw err(code, `lock file was removed: ${lockPath}`);
    }
    throw e;
  }
  if (limited.exceeded || !limited.content.equals(tokenBytes)) {
    throw err(code, `lock token was replaced: ${lockPath}`);
  }
  checkOwner();
  fs.unlinkSync(lockPath);
}
