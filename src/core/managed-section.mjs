// SPDX-License-Identifier: Apache-2.0
// Managed marker sections inside user-owned files. A BEGIN/END marker pair
// delimits the only region the harness may refresh in place; every byte
// outside the markers is user content that is never compared nor rewritten.
// The presence of markers in a file is the explicit opt-in that makes an
// in-place refresh legal (same contract as spec-kit's agent-context block).

export const MANAGED_BEGIN = '<!-- SCOPEGRAIN:BEGIN -->';
export const MANAGED_END = '<!-- SCOPEGRAIN:END -->';

// A marker is recognized only as a whole trimmed line, so the literal
// strings may be quoted inside prose without opening a section.
const isBegin = (line) => line.trim() === MANAGED_BEGIN;
const isEnd = (line) => line.trim() === MANAGED_END;

// Render a whole managed block. `body` is normalized to a single trailing
// newline so BEGIN/END always sit on their own lines.
export function wrapManaged(body) {
  const inner = String(body).replace(/\n*$/, '\n');
  return `${MANAGED_BEGIN}\n${inner}${MANAGED_END}\n`;
}

// Locate the first BEGIN and the first END marker line. Either may be
// absent; a BEGIN after an END still counts as the opening of a section.
function locate(lines) {
  let begin = -1;
  let end = -1;
  for (let i = 0; i < lines.length; i++) {
    if (begin === -1 && isBegin(lines[i])) begin = i;
    else if (end === -1 && isEnd(lines[i])) end = i;
    if (begin !== -1 && end !== -1) break;
  }
  return { begin, end };
}

export function hasManagedSection(text) {
  const { begin, end } = locate(String(text).split('\n'));
  return begin !== -1 || end !== -1;
}

// The bytes strictly inside the managed region with trailing newlines
// stripped, or null when no BEGIN marker exists. A dangling BEGIN (no END)
// owns the rest of the file.
export function managedBody(text) {
  const lines = String(text).split('\n');
  const { begin, end } = locate(lines);
  if (begin === -1) return null;
  const stop = end === -1 || end < begin ? lines.length : end;
  return lines.slice(begin + 1, stop).join('\n').replace(/\n*$/, '');
}

// Whether the file's managed region already holds `body`, comparing with
// trailing newlines stripped on both sides.
export function managedEquals(text, body) {
  const current = managedBody(text);
  return current !== null && current === String(body).replace(/\n*$/, '');
}

// Upsert `body` into the managed region, preserving every byte outside.
// Both markers -> replace inside. BEGIN only -> owns to EOF. END only ->
// insert the block right before END. No markers -> append at EOF.
export function upsertManaged(existing, body) {
  const text = String(existing);
  const block = wrapManaged(body).replace(/\n$/, '');
  const lines = text.split('\n');
  const { begin, end } = locate(lines);
  if (begin !== -1) {
    const stop = end !== -1 && end > begin ? end + 1 : lines.length;
    const kept = lines.slice(stop).join('\n');
    let out = kept === ''
      ? [...lines.slice(0, begin), ...block.split('\n')].join('\n')
      : [...lines.slice(0, begin), ...block.split('\n'), kept].join('\n');
    if (kept === '' && text.endsWith('\n')) out += '\n';
    return out;
  }
  if (end !== -1) {
    return [...lines.slice(0, end), ...block.split('\n'),
      ...lines.slice(end + 1)].join('\n');
  }
  return text === ''
    ? `${block}\n`
    : `${text.replace(/\n*$/, '\n')}\n${block}\n`;
}
