// SPDX-License-Identifier: Apache-2.0
// Global user-level configuration: optional onboarding defaults stored in
// ~/.config/scopegrain/config.json (or $XDG_CONFIG_HOME/scopegrain/config.json,
// or $SCOPEGRAIN_USER_CONFIG).
//
// Authority invariant:
//   workspace config (.scopegrain/config.json) > explicit --answers
//   > repo investigation signals > user global config > policy defaults.
//
// Global config NEVER carries execution permissions, verification commands,
// approvals, project roots or bypass flags, and NEVER overrides an existing
// workspace config at runtime.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { err } from './errors.mjs';
import { decodeUtf8Strict, lstatOrNull, readFileLimited } from './fsx.mjs';
import {
  KNOWN_HOSTS, LOCALES, VERSIONING_KEYS, validateMethodologyMode,
} from './config.mjs';
import { loadLimits } from './policy.mjs';

const ALLOWED_KEYS = new Set([
  'schemaVersion', 'locale', 'hosts', 'methodology', 'versioning',
]);

export function resolveUserConfigPath(env = process.env) {
  if (Object.prototype.hasOwnProperty.call(env, 'SCOPEGRAIN_USER_CONFIG')) {
    const raw = String(env.SCOPEGRAIN_USER_CONFIG ?? '').trim();
    if (raw === '' || raw.toLowerCase() === 'none') {
      return { path: null, source: 'disabled' };
    }
    return { path: path.resolve(raw), source: 'env' };
  }
  const xdg = env.XDG_CONFIG_HOME && String(env.XDG_CONFIG_HOME).trim();
  if (xdg) {
    return {
      path: path.join(path.resolve(xdg), 'scopegrain', 'config.json'),
      source: 'xdg',
    };
  }
  return {
    path: path.join(os.homedir(), '.config', 'scopegrain', 'config.json'),
    source: 'default',
  };
}

export function validateUserConfig(raw, label = 'userConfig') {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw err('USER_CONFIG_INVALID', `${label} must be a JSON object`);
  }
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_KEYS.has(key)) {
      throw err('UNKNOWN_KEY',
        `${label} contains disallowed or unknown key '${key}' `
        + '(global config only holds onboarding defaults: '
        + 'locale, hosts, methodology, versioning)');
    }
  }
  if (raw.schemaVersion !== 1) {
    throw err('USER_CONFIG_INVALID', `${label}.schemaVersion must be 1`);
  }
  const out = { schemaVersion: 1 };
  if (raw.locale !== undefined) {
    if (typeof raw.locale !== 'string' || !LOCALES.includes(raw.locale)) {
      throw err('USER_CONFIG_INVALID',
        `${label}.locale must be one of ${LOCALES.join(', ')}`);
    }
    out.locale = raw.locale;
  }
  if (raw.hosts !== undefined) {
    if (!Array.isArray(raw.hosts) || raw.hosts.length === 0) {
      throw err('USER_CONFIG_INVALID',
        `${label}.hosts must be a non-empty array of known hosts`);
    }
    const seen = new Set();
    const hosts = [];
    for (const h of raw.hosts) {
      if (typeof h !== 'string' || !KNOWN_HOSTS.includes(h)) {
        throw err('USER_CONFIG_INVALID',
          `${label}.hosts contains unknown host '${String(h)}'`);
      }
      if (seen.has(h)) {
        throw err('USER_CONFIG_INVALID',
          `${label}.hosts contains duplicate host '${h}'`);
      }
      seen.add(h);
      hosts.push(h);
    }
    out.hosts = hosts;
  }
  if (raw.methodology !== undefined) {
    out.methodology = validateMethodologyMode(
      raw.methodology, `${label}.methodology`);
  }
  if (raw.versioning !== undefined) {
    if (raw.versioning === null || typeof raw.versioning !== 'object'
        || Array.isArray(raw.versioning)) {
      throw err('USER_CONFIG_INVALID', `${label}.versioning must be an object`);
    }
    const v = {};
    for (const [k, val] of Object.entries(raw.versioning)) {
      if (!VERSIONING_KEYS.includes(k)) {
        throw err('UNKNOWN_KEY',
          `${label}.versioning contains unknown key '${k}'`);
      }
      if (typeof val !== 'boolean') {
        throw err('USER_CONFIG_INVALID',
          `${label}.versioning.${k} must be boolean`);
      }
      v[k] = val;
    }
    out.versioning = v;
  }
  return out;
}

// Read-only loader. Returns { path, source, exists, config }.
// Missing file -> { exists: false, config: null }.
// Corrupt or symlinked file -> throws USER_CONFIG_MALFORMED / USER_CONFIG_INVALID.
export function loadUserConfig(opts = {}) {
  const { path: cfgPath, source } = resolveUserConfigPath(opts.env);
  if (!cfgPath) {
    return { path: null, source, exists: false, config: null };
  }
  const st = lstatOrNull(cfgPath);
  if (!st) {
    return { path: cfgPath, source, exists: false, config: null };
  }
  if (st.isSymbolicLink() || !st.isFile()) {
    throw err('USER_CONFIG_MALFORMED',
      `user config path is not a regular file: ${cfgPath}`);
  }
  const limits = loadLimits();
  const lim = readFileLimited(cfgPath, limits.maxDocumentBytes);
  if (lim.exceeded) {
    throw err('DOCUMENT_TOO_LARGE',
      `user config exceeds ${limits.maxDocumentBytes} bytes`);
  }
  const text = decodeUtf8Strict(lim.content, 'USER_CONFIG_MALFORMED', cfgPath);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw err('USER_CONFIG_MALFORMED', `user config is not valid JSON: ${cfgPath}`);
  }
  return {
    path: cfgPath,
    source,
    exists: true,
    config: validateUserConfig(parsed),
  };
}

// Validates and optionally writes the global user config atomically.
// Preview by default; writes only with apply:true. Refuses symlinks.
export function saveUserConfig(input, { apply = false, env } = {}) {
  const normalized = validateUserConfig(
    { schemaVersion: 1, ...input }, 'userConfig');
  const { path: cfgPath, source } = resolveUserConfigPath(env);
  if (!cfgPath) {
    throw err('USER_CONFIG_DISABLED',
      'user config is disabled via SCOPEGRAIN_USER_CONFIG');
  }
  const st = lstatOrNull(cfgPath);
  if (st && (st.isSymbolicLink() || !st.isFile())) {
    throw err('USER_CONFIG_MALFORMED',
      `refusing to overwrite non-regular user config path: ${cfgPath}`);
  }
  if (!apply) {
    return {
      mode: 'preview',
      applied: false,
      path: cfgPath,
      source,
      existed: st !== null,
      config: normalized,
    };
  }
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
  const tmp = `${cfgPath}.tmp-${crypto.randomBytes(8).toString('hex')}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(normalized, null, 2) + '\n',
      { flag: 'wx' });
    fs.renameSync(tmp, cfgPath);
  } finally {
    try { if (lstatOrNull(tmp)) fs.unlinkSync(tmp); } catch { /* noop */ }
  }
  return {
    mode: 'applied',
    applied: true,
    path: cfgPath,
    source,
    existed: st !== null,
    config: normalized,
  };
}
