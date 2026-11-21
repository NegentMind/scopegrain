// SPDX-License-Identifier: Apache-2.0
// Minimal JSONC support (host settings parity): strips // and /* */
// comments outside strings, then JSON.parse. deepMerge applies object
// overlays recursively; arrays and scalars replace wholesale — same
// semantics host settings files (settings.json with comments) expect.

import { err } from './errors.mjs';

export function stripJsonComments(text) {
  const s = String(text);
  let out = '';
  let i = 0; let inStr = false; let quote = '';
  while (i < s.length) {
    const c = s[i];
    if (inStr) {
      out += c;
      if (c === '\\') { out += s[i + 1] ?? ''; i += 2; continue; }
      if (c === quote) inStr = false;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'") { inStr = true; quote = c; out += c; i += 1; continue; }
    if (c === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && s[i + 1] === '*') {
      i += 2;
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += c; i += 1;
  }
  return out;
}

export function parseJsonc(text, label = 'jsonc') {
  const stripped = stripJsonComments(text);
  try {
    return JSON.parse(stripped);
  } catch (e) {
    throw err('MALFORMED', `${label}: ${e.message}`);
  }
}

const isObj = (v) =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

export function deepMerge(base, overlay) {
  if (isObj(base) && isObj(overlay)) {
    const out = { ...base };
    for (const [k, v] of Object.entries(overlay)) {
      out[k] = k in out ? deepMerge(out[k], v) : v;
    }
    return out;
  }
  return overlay;
}
