// SPDX-License-Identifier: Apache-2.0
// Error-signature extraction: normalize failure text into a stable
// signature so repeated errors dedup to one counter. Pure, no I/O.
// Volatile parts (uuid, hex, timestamps, paths, quoted payloads,
// numbers) collapse to placeholders so the SAME failure on different
// inputs still shares a signature.

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const TS_RE = /\b\d{4}-\d{2}-\d{2}([T ][0-9:.]+Z?)?\b/g;
const HEX_RE = /\b[0-9a-f]{16,}\b/gi;
const PATH_RE = /(?:[a-zA-Z]:)?[\\/][\w.\-\\/]+/g;
const QUOTED_RE = /"[^"]*"|'[^']*'/g;
// Bare filenames (not inside a path) carry no signature signal.
const FILENAME_RE = /\b[\w-]+\.[a-z0-9]{1,6}\b/gi;
// Numbers, optionally with a short unit suffix (30s, 200ms, 404).
const NUM_RE = /\b\d+[a-z]{0,3}\b/gi;
const WS_RE = /\s+/g;

export function errorSignature(text) {
  const line = String(text ?? '')
    .split('\n')
    .find((l) => l.trim() !== '') ?? '';
  return line.toLowerCase()
    .replace(UUID_RE, '<uuid>')
    .replace(TS_RE, '<ts>')
    .replace(HEX_RE, '<hex>')
    .replace(QUOTED_RE, '<s>')
    .replace(PATH_RE, '<p>')
    .replace(FILENAME_RE, '<f>')
    .replace(NUM_RE, '<n>')
    .replace(WS_RE, ' ')
    .trim()
    .slice(0, 160);
}

export const FAILURE_MARK = /\b(fail(?:ed|ure)?|error|unable|blocked|denied|exception|timeout|crash)\b/i;

const TEXT_KEYS = ['result', 'summary', 'title', 'error', 'detail'];

// Groups failure-looking worklog entries by normalized signature.
// Returns Map<signature, {count, sample}>.
export function failureSignatures(entries) {
  const map = new Map();
  for (const e of entries ?? []) {
    if (e === null || typeof e !== 'object') continue;
    const text = TEXT_KEYS
      .map((k) => e[k])
      .filter((v) => typeof v === 'string' && v.trim() !== '')
      .join(' ');
    if (text === '' || !FAILURE_MARK.test(text)) continue;
    const sig = errorSignature(text);
    if (sig === '') continue;
    const rec = map.get(sig) ?? { count: 0, sample: text.slice(0, 160) };
    rec.count += 1;
    map.set(sig, rec);
  }
  return map;
}
