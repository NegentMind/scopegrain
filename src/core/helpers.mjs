// SPDX-License-Identifier: Apache-2.0
// Project-installable helper scripts with a JSON contract (spec-kit
// helper-script parity). Installation copies the script under
// <configDir>/helpers/ create-only and registers a contract manifest
// {id, file, sha256, runtime, contract}. The harness never executes
// helpers — the contract is metadata for hosts that choose to.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { err } from './errors.mjs';
import { configRel, resolveInside, assertDestination } from './paths.mjs';
import {
  lstatOrNull, readFileLimited, decodeUtf8Strict,
} from './fsx.mjs';
import { loadLimits } from './policy.mjs';

const RUNTIMES = new Set(['node', 'sh', 'pwsh', 'python']);
const dirRel = (ctx) => configRel(ctx, `helpers`);
const manifestRel = (ctx) => configRel(ctx, `helpers.json`);

function readManifest(ctx) {
  const rel = manifestRel(ctx);
  const abs = resolveInside(ctx.projectRoot, rel, 'helpers manifest');
  const st = lstatOrNull(abs);
  if (!st) return { schemaVersion: 1, helpers: [] };
  if (st.isSymbolicLink() || !st.isFile()) {
    throw err('INVALID_PATH', `${rel} is not a regular file`);
  }
  const l = readFileLimited(abs, loadLimits().maxDocumentBytes);
  if (l.exceeded) throw err('DOCUMENT_TOO_LARGE', rel);
  const doc = JSON.parse(decodeUtf8Strict(l.content, 'MALFORMED', rel));
  if (doc === null || typeof doc !== 'object' || !Array.isArray(doc.helpers)) {
    throw err('MALFORMED', `${rel} has invalid shape`);
  }
  return doc;
}

function writeManifest(ctx, doc) {
  const abs = resolveInside(
    ctx.projectRoot, manifestRel(ctx), 'helpers manifest');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n', { flag: 'wx' });
  try { fs.renameSync(tmp, abs); }
  catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* best effort */ }
    throw e;
  }
}

// input: {id, source, runtime, description?} — source is a project-relative
// script path; the copy destination is <configDir>/helpers/<id>-<basename>.
export function installHelper(ctx, input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw err('INVALID_VALUE', 'helper input must be an object');
  }
  for (const k of Object.keys(input)) {
    if (!['id', 'source', 'runtime', 'description'].includes(k)) {
      throw err('UNKNOWN_KEY', `helper input has unknown key '${k}'`);
    }
  }
  if (typeof input.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(input.id)) {
    throw err('INVALID_VALUE', 'helper id must be a slug');
  }
  if (!RUNTIMES.has(input.runtime)) {
    throw err('INVALID_VALUE',
      `runtime must be one of ${[...RUNTIMES].join(', ')}`);
  }
  const srcRel = assertDestination(input.source, 'helper source');
  const srcAbs = resolveInside(ctx.projectRoot, srcRel, 'helper source');
  const st = lstatOrNull(srcAbs);
  if (!st || !st.isFile() || st.isSymbolicLink()) {
    throw err('NOT_FOUND', `helper source ${srcRel} is not a regular file`);
  }
  const content = readFileLimited(srcAbs, loadLimits().maxDocumentBytes);
  if (content.exceeded) throw err('DOCUMENT_TOO_LARGE', srcRel);
  const sha256 = crypto.createHash('sha256').update(content.content).digest('hex');
  const base = path.basename(srcRel).replace(/[^A-Za-z0-9._-]/g, '_');
  const destRel = `${dirRel(ctx)}/${input.id}-${base}`;
  const destAbs = resolveInside(ctx.projectRoot, destRel, 'helper dest');
  if (lstatOrNull(destAbs)) {
    throw err('CONFLICT', `helper destination ${destRel} already exists`);
  }
  const manifest = readManifest(ctx);
  if (manifest.helpers.some((h) => h.id === input.id)) {
    throw err('CONFLICT', `helper id '${input.id}' is already registered`);
  }
  fs.mkdirSync(resolveInside(ctx.projectRoot, dirRel(ctx), 'helpers'),
    { recursive: true });
  const fd = fs.openSync(destAbs, 'wx');
  try {
    fs.writeSync(fd, content.content);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  manifest.helpers.push({
    id: input.id, file: destRel, source: srcRel, sha256,
    runtime: input.runtime,
    description: typeof input.description === 'string'
      ? input.description : '',
    contract: 'json-stdio',
    installedAt: new Date().toISOString(),
  });
  writeManifest(ctx, manifest);
  return Object.freeze(manifest.helpers.at(-1));
}

// Integrity view: each registered helper re-hashed against its contract.
export function listHelpers(ctx) {
  const manifest = readManifest(ctx);
  return manifest.helpers.map((h) => {
    const abs = resolveInside(ctx.projectRoot, h.file, 'helper file');
    const st = lstatOrNull(abs);
    let status = 'ok';
    if (!st || st.isSymbolicLink() || !st.isFile()) status = 'missing';
    else {
      const c = readFileLimited(abs, loadLimits().maxDocumentBytes);
      const sha = crypto.createHash('sha256').update(c.content).digest('hex');
      if (sha !== h.sha256) status = 'tampered';
    }
    return { ...h, status };
  });
}
