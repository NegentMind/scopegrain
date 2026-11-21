// SPDX-License-Identifier: Apache-2.0
// Command-body placeholders (spec-kit parity): literal token substitution
// for $ARGUMENTS, {SCRIPT} and __X_COMMAND_<ID>__ handoffs. Substitution
// is text-only — Scopegrain never executes the result; every token must
// resolve or rendering fails closed (a dangling token in a projected
// command is a defect, not a warning).

import { err } from './errors.mjs';

const HANDOFF_RE = /__X_COMMAND_([A-Z0-9_]+)__/g;
const SCRIPT_TOKEN = '{SCRIPT}';
const ARGS_TOKEN = '$ARGUMENTS';

// Inventory of tokens present in a body (diagnostics, dry-run).
export function findPlaceholders(body) {
  const text = String(body);
  const out = { arguments: false, script: false, handoffs: [] };
  out.arguments = text.includes(ARGS_TOKEN);
  out.script = text.includes(SCRIPT_TOKEN);
  for (const m of text.matchAll(HANDOFF_RE)) {
    out.handoffs.push(m[1]);
  }
  return out;
}

// Declared helper script from frontmatter (`script: path`), if any.
export function scriptFromFrontmatter(body) {
  const text = String(body);
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return null;
  const line = fm[1].split('\n')
    .find((l) => l.trimStart().startsWith('script:'));
  if (!line) return null;
  const v = line.slice(line.indexOf(':') + 1).trim().replace(/^["']|["']$/g, '');
  return v === '' ? null : v;
}

// render(body, {arguments, script, handoffMap, handoffPrefix}):
//  - $ARGUMENTS        -> arguments (defaults to empty string)
//  - {SCRIPT}          -> script ?? scriptFromFrontmatter(body); unresolved -> error
//  - __X_COMMAND_X__   -> handoffMap[ID_LOWER-hyphen] ?? `${handoffPrefix}${id}`
// Handoff IDs normalize FOO_BAR -> foo-bar.
export function renderPlaceholders(body, {
  arguments: args = '', script, handoffMap = {}, handoffPrefix = 'workflow ',
} = {}) {
  let text = String(body);
  const inv = findPlaceholders(text);
  if (inv.arguments) {
    text = text.split(ARGS_TOKEN).join(String(args));
  }
  if (inv.script) {
    const resolved = script ?? scriptFromFrontmatter(text);
    if (resolved === null || resolved === undefined || resolved === '') {
      throw err('UNRESOLVED_PLACEHOLDER',
        'body uses {SCRIPT} but no script is declared or supplied');
    }
    text = text.split(SCRIPT_TOKEN).join(String(resolved));
  }
  if (inv.handoffs.length > 0) {
    text = text.replace(HANDOFF_RE, (match, raw) => {
      const id = raw.toLowerCase().replace(/_/g, '-');
      const target = handoffMap[id] ?? `${handoffPrefix}${id}`;
      return target;
    });
  }
  const left = findPlaceholders(text);
  if (left.script || left.handoffs.length > 0) {
    throw err('UNRESOLVED_PLACEHOLDER',
      'rendered body still contains unresolved placeholders');
  }
  return text;
}
