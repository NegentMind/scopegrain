// SPDX-License-Identifier: Apache-2.0
// Unified untrusted-identifier validation. Every id that can become a
// path component (catalog entries, extensions, presets, workflow runs,
// bundle ids) is validated here — a slug that is also a Windows reserved
// device name or ends in a dot/space is a real filesystem hazard on
// Windows even though it matches the character class.

import { err } from './errors.mjs';

export const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

// Windows device names are reserved case-insensitively and WITH any
// extension (CON.txt still hits the device), so the stem is checked.
const WINDOWS_RESERVED = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

export function assertSafeId(id, label = 'id') {
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    throw err('INVALID_VALUE',
      `${label} must be a slug: [a-z0-9][a-z0-9-]{0,63}`);
  }
  const stem = id.split('-', 1)[0].split('.', 1)[0].toLowerCase();
  if (WINDOWS_RESERVED.has(stem)) {
    throw err('INVALID_VALUE',
      `${label} '${id}' is a Windows reserved device name`);
  }
  // ID_RE forbids these already, but keep the defense explicit so a
  // future relaxation of the pattern cannot silently admit them.
  if (id.endsWith('.') || id.endsWith(' ')) {
    throw err('INVALID_VALUE', `${label} cannot end in '.' or ' '`);
  }
  return id;
}
