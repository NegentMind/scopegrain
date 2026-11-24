// SPDX-License-Identifier: Apache-2.0
// Canonicalization helpers for golden sessions and cross-mode parity.
// Two CLI executions of the same steps can never be byte-identical
// (random UUIDs, wall-clock timestamps, machine-specific temp roots),
// so comparisons run on a normalized projection instead.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const UUID_RE =
  /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;
const ISO_TS_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g;
const ESTTOK_RE = /~\d+ estTok/g;
// Whole-value sha256 digests. Volatile digests (structure-index
// fingerprint is explicitly a path+size+mtime signature) can never
// repeat across runs; deterministic digests (discovery fingerprint,
// approval digests) hash the same inputs on both sides of a comparison,
// so replacing the value loses nothing — the inputs are still pinned by
// envelope fields and the state-tree hash.
const SHA256_RE = /\b[0-9a-fA-F]{64}\b/g;
// Catalog fingerprints persist "<size>:<mtimeNs>" pairs per file — the
// mtime half is inherently volatile while the size is meaningful state.
// 11+ digits cannot collide with revisions, sizes or ports.
const MTIME_RE = /(\d+:)\d{11,}(\.\d+)?/g;

// Object keys replaced wholesale during normalization. tokenEstimate is a
// heuristic figure that embeds the absolute project path length and the
// packet's own byte size; equal-length roots would make it deterministic,
// but pinning it would couple goldens to the machine's temp-dir layout.
const VOLATILE_KEYS = new Set(['tokenEstimate']);

// Every spelling the project root can take inside emitted or persisted
// JSON: native separators, forward slashes, and the JSON-escaped form
// found inside nested JSON payloads (integration fragments).
export function rootForms(root) {
  const fwd = root.split(path.sep).join('/');
  const escaped = JSON.stringify(root).slice(1, -1);
  return [...new Set([root, fwd, escaped])]
    .sort((a, b) => b.length - a.length);
}

export function normalizeString(s, forms) {
  let out = s;
  for (const form of forms) out = out.split(form).join('<ROOT>');
  return out
    .replace(UUID_RE, '<UUID>')
    .replace(ISO_TS_RE, '<TS>')
    .replace(SHA256_RE, '<SHA256>')
    .replace(MTIME_RE, '$1<MTIME>')
    .replace(ESTTOK_RE, '~<N> estTok');
}

export function normalizeValue(value, forms) {
  if (typeof value === 'string') return normalizeString(value, forms);
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item, forms));
  }
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = VOLATILE_KEYS.has(key)
        ? '<VOLATILE>' : normalizeValue(item, forms);
    }
    return out;
  }
  return value;
}

// The comparison unit for golden sessions and process/in-process parity:
// argv, exit code and both channels, parsed to JSON when the wire is JSON.
export function stepEnvelope(step, forms) {
  const normChannel = (parsed, raw) => parsed !== undefined
    ? normalizeValue(parsed, forms)
    : normalizeString(raw, forms);
  return {
    cmd: step.cmd.map((arg) => normalizeString(arg, forms)),
    exit: step.exit,
    stdout: normChannel(step.stdoutJson, step.stdout),
    stderr: normChannel(step.stderrJson, step.stderr),
  };
}

// Deterministic serialization for hashing (sorted object keys).
export function canonicalize(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

// Canonical sha256 over the whole persisted state tree: every file's
// normalized relative path and normalized content, sorted walk order.
// Equal hashes mean the two runs left byte-equivalent state modulo the
// volatile fields the normalizer scrubs.
export function hashStateTree(root) {
  const forms = rootForms(root);
  const hash = crypto.createHash('sha256');
  const walk = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      const rel = path.relative(root, abs).split(path.sep).join('/');
      if (entry.isSymbolicLink()) {
        hash.update(`LINK\0${normalizeString(rel, forms)}\0`);
        continue;
      }
      let content;
      try {
        content = normalizeString(fs.readFileSync(abs, 'utf8'), forms);
      } catch {
        content = fs.readFileSync(abs); // binary: hash bytes as-is
      }
      hash.update(`${normalizeString(rel, forms)}\0${content}\0`);
    }
  };
  walk(root);
  return hash.digest('hex');
}
