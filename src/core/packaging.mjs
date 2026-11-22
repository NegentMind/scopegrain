// SPDX-License-Identifier: Apache-2.0
// Reproducible packaging: deterministic POSIX ustar output so identical
// input bytes always produce identical archive bytes — fixed metadata
// (mtime 0, uid/gid 0, empty uname/gname, normalized modes), entries
// sorted by name in byte order, no machine-local fields. Distribution is
// local-only; this is the publishable-artifact path, not a remote feed.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { err } from './errors.mjs';
import { isInside, resolveInside } from './paths.mjs';
import { lstatOrNull, readFileLimited } from './fsx.mjs';
import { loadLimits } from './policy.mjs';

const BLOCK = 512;
const MAX_ENTRIES = 4096;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const EPOCH = 0; // fixed timestamp: reproducibility over novelty

function octal(value, width) {
  const s = value.toString(8).padStart(width - 1, '0');
  if (s.length >= width) {
    throw err('INVALID_VALUE', 'tar field overflow');
  }
  return Buffer.from(`${s}\0`, 'ascii');
}

function str(value, width) {
  const b = Buffer.from(value, 'utf8');
  if (b.length >= width) {
    throw err('INVALID_VALUE', `tar name too long: ${value}`);
  }
  return Buffer.concat([b, Buffer.alloc(width - b.length)]);
}

function header(name, mode, size, typeflag) {
  const h = Buffer.alloc(BLOCK);
  str(name, 100).copy(h, 0);
  octal(mode, 8).copy(h, 100);
  octal(0, 8).copy(h, 108); // uid
  octal(0, 8).copy(h, 116); // gid
  octal(size, 12).copy(h, 124);
  octal(EPOCH, 12).copy(h, 136);
  h.fill(0x20, 148, 156); // checksum placeholder: spaces
  h.write(typeflag, 156, 'ascii');
  Buffer.from('ustar\0', 'ascii').copy(h, 257);
  Buffer.from('00', 'ascii').copy(h, 263);
  let sum = 0;
  for (const byte of h) sum += byte;
  octal(sum, 8).copy(h, 148);
  return h;
}

function pad(size) {
  const rem = size % BLOCK;
  return rem === 0 ? 0 : BLOCK - rem;
}

// entries: [{name, data(Buffer), mode?}] — sorted by name in byte order.
export function writeDeterministicTar(entries) {
  const sorted = [...entries].sort((a, b) => {
    const x = Buffer.from(a.name, 'utf8');
    const y = Buffer.from(b.name, 'utf8');
    return Buffer.compare(x, y);
  });
  const parts = [];
  const dirs = new Set();
  for (const e of sorted) {
    if (typeof e.name !== 'string' || e.name.startsWith('/')
        || e.name.split('/').some((seg) => seg === '..' || seg === '')) {
      throw err('INVALID_VALUE', `unsafe tar entry name: ${e.name}`);
    }
    // Emit ancestor directory records once, so extraction never depends
    // on implicit mkdir ordering.
    const segs = e.name.split('/');
    for (let i = 1; i < segs.length; i += 1) {
      const d = `${segs.slice(0, i).join('/')}/`;
      if (!dirs.has(d)) {
        dirs.add(d);
        parts.push(header(d, 0o755, 0, '5'));
      }
    }
    const data = Buffer.isBuffer(e.data) ? e.data
      : Buffer.from(e.data ?? '', 'utf8');
    parts.push(header(e.name, e.mode ?? 0o644, data.length, '0'));
    parts.push(data);
    const p = pad(data.length);
    if (p > 0) parts.push(Buffer.alloc(p));
  }
  parts.push(Buffer.alloc(BLOCK * 2)); // end-of-archive marker
  return Buffer.concat(parts);
}

// Bounded deterministic walk: regular files only, sorted names, no
// links, incremental bounds — same contract as bundle collection.
export function collectPackEntries(rootAbs, label = 'pack source') {
  const out = [];
  let bytes = 0;
  const walk = (abs, rel) => {
    const list = fs.readdirSync(abs, { withFileTypes: true })
      .sort((a, b) => Buffer.compare(
        Buffer.from(a.name), Buffer.from(b.name)));
    for (const ent of list) {
      const childAbs = path.join(abs, ent.name);
      const childRel = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        walk(childAbs, childRel);
        continue;
      }
      const st = lstatOrNull(childAbs);
      if (!st || !st.isFile() || st.isSymbolicLink() || !ent.isFile()) {
        throw err('INVALID_PATH',
          `${label} entry is not a regular file: ${childRel}`);
      }
      const l = readFileLimited(childAbs, loadLimits().maxDocumentBytes);
      if (l.exceeded) {
        throw err('DOCUMENT_TOO_LARGE', `${label}: ${childRel}`);
      }
      out.push({ name: childRel, data: l.content });
      bytes += l.content.length;
      if (out.length > MAX_ENTRIES || bytes > MAX_TOTAL_BYTES) {
        throw err('BUNDLE_TOO_LARGE',
          `${label} exceeds pack limits`);
      }
    }
  };
  const st = lstatOrNull(rootAbs);
  if (!st || !st.isDirectory() || st.isSymbolicLink()) {
    throw err('INVALID_PATH', `${label} must be a real directory`);
  }
  walk(rootAbs, '');
  return out;
}

// Pack a project-relative directory into a deterministic tar inside the
// project. Returns bytes + sha256 so two runs can be compared exactly.
export function packDirectory(ctx, sourceRel, outRel) {
  const srcAbs = resolveInside(ctx.projectRoot, sourceRel, 'pack source');
  const outAbs = resolveInside(ctx.projectRoot, outRel, 'pack output');
  if (!isInside(ctx.projectRoot, outAbs)) {
    throw err('INVALID_PATH', 'pack output must stay in the project');
  }
  const entries = collectPackEntries(srcAbs);
  const tar = writeDeterministicTar(entries);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  const tmp = `${outAbs}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, tar, { flag: 'wx' });
  try { fs.renameSync(tmp, outAbs); }
  catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* best effort */ }
    throw e;
  }
  return Object.freeze({
    files: entries.length,
    bytes: tar.length,
    sha256: crypto.createHash('sha256').update(tar).digest('hex'),
    out: outRel,
  });
}
