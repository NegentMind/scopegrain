// SPDX-License-Identifier: Apache-2.0
// Small synchronous filesystem helpers shared by core modules.
import fs from 'node:fs';
import path from 'node:path';
import { err } from './errors.mjs';

let displayRoot = null;

export function setPathDisplayRoot(rootAbs) {
  displayRoot = typeof rootAbs === 'string' && rootAbs.length > 0
    ? path.resolve(rootAbs) : null;
}

export function displayPath(p) {
  try {
    const abs = path.resolve(p);
    if (displayRoot) {
      const rel = path.relative(displayRoot, abs);
      if (rel === '') return '.';
      if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
        return rel.split(path.sep).join('/');
      }
    }
    return path.basename(abs);
  } catch {
    return String(p);
  }
}

export function lstatOrNull(p) {
  try {
    return fs.lstatSync(p);
  } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    throw e;
  }
}

// Bounded read via descriptor + fstat; never buffers more than maxBytes.
export function readFileLimited(p, maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw err('INVALID_VALUE', 'maxBytes must be a non-negative safe integer');
  }
  const fd = fs.openSync(p, 'r');
  try {
    const st = fs.fstatSync(fd);
    if (st.size > maxBytes) {
      return { exceeded: true, size: st.size, content: null };
    }
    const buf = Buffer.alloc(st.size);
    let off = 0;
    while (off < st.size) {
      const n = fs.readSync(fd, buf, off, st.size - off, off);
      if (n <= 0) {
        throw err('READ_FAILED',
          `read made no progress on ${displayPath(p)} (${off}/${st.size})`);
      }
      off += n;
    }
    const st2 = fs.fstatSync(fd);
    if (st2.size > maxBytes) {
      return { exceeded: true, size: st2.size, content: null };
    }
    if (st2.size !== st.size) {
      throw err('READ_FAILED',
        `${displayPath(p)} changed size during read (${st.size} -> ${st2.size})`);
    }
    return { exceeded: false, size: st.size, content: buf };
  } finally {
    fs.closeSync(fd);
  }
}

// Strict UTF-8 decode: toString('utf8') rewrites invalid byte sequences to
// U+FFFD, so a byte-exact roundtrip is the only reliable corruption check.
// Valid literal U+FFFD bytes (EF BF BD) roundtrip and still decode.
// `code` is the caller's domain code for stored malformed data.
export function decodeUtf8Strict(bytes, code, label) {
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) {
    throw err(code, `${label} is not roundtrippable UTF-8`);
  }
  return text;
}

export function readJsonFile(p, label, maxBytes = 1048576) {
  let limited;
  try {
    limited = readFileLimited(p, maxBytes);
  } catch (e) {
    if (e && e.code === 'READ_FAILED') throw e;
    throw err('READ_FAILED', `cannot read ${label}: ${displayPath(p)}`);
  }
  if (limited.exceeded) {
    throw err('DOCUMENT_TOO_LARGE',
      `${label} exceeds ${maxBytes} bytes: ${displayPath(p)}`);
  }
  // Non-roundtrippable bytes are malformed input: the file cannot decode
  // to faithful JSON text, so it shares the MALFORMED_JSON domain code a
  // syntactically broken document already produces.
  const text = decodeUtf8Strict(
    limited.content, 'MALFORMED_JSON', `${label}: ${displayPath(p)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw err('MALFORMED_JSON',
      `malformed JSON in ${label}: ${displayPath(p)}`);
  }
}

// Bounded directory listing via opendir: collects at most max entries and
// closes the iterator in all cases. Exactly-max directories are NOT
// truncated: a single extra peek decides whether more entries exist.
export function readDirBounded(dirAbs, max) {
  const dir = fs.opendirSync(dirAbs);
  const entries = [];
  let truncated = false;
  try {
    while (entries.length < max) {
      const dirent = dir.readSync();
      if (dirent === null) return { entries, truncated };
      entries.push(dirent);
    }
    truncated = dir.readSync() !== null; // one peek, never processed
  } finally {
    dir.closeSync();
  }
  return { entries, truncated };
}

// Exclusive write with ownership semantics: the fd is opened OUTSIDE the
// try, so a failed 'wx' open (EEXIST/EACCES) never triggers cleanup of a
// file we do not own. After a successful open the file is ours — write
// loops until complete, and any write/close failure removes only it.
export function writeFileExclusive(file, content) {
  const fd = fs.openSync(file, 'wx');
  try {
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
    let off = 0;
    while (off < buf.length) {
      const n = fs.writeSync(fd, buf, off, buf.length - off);
      if (n <= 0) {
        throw err('WRITE_FAILED',
          `write made no progress on ${displayPath(file)}`);
      }
      off += n;
    }
    // The journal marks creations `committed` durably; the source file
    // must reach stable storage before close, or a crash leaves a
    // committed operation whose source never existed.
    fs.fsyncSync(fd);
    fs.closeSync(fd);
  } catch (e) {
    try { fs.closeSync(fd); } catch { /* already closed */ }
    removeIfExists(file); // ours: created by the successful open above
    throw e;
  }
}

export function mkdirpSync(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const st = lstatOrNull(dir);
  if (!st || !st.isDirectory()) {
    throw err('FILE_ANCESTOR',
      `mkdir target is not a real directory: ${displayPath(dir)}`);
  }
}

export function removeIfExists(p) {
  try {
    fs.rmSync(p, { force: true });
  } catch {
    // best-effort cleanup of our own artifacts only
  }
}
