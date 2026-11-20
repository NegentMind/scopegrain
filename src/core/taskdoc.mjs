// Human-readable task documents: renders the authoritative task JSON
// record into a Markdown file the owner can read/diff. The JSON stays
// the truth; the .md is a derived artifact regenerated on demand.
import { getTask, tasksDirAbs } from './tasks.mjs';
import { mkdirpSync } from './fsx.mjs';
import fs from 'node:fs';
import path from 'node:path';

const RELATION_ORDER = ['blocks', 'blocked-by', 'relates', 'duplicates',
  'caused-by', 'follows'];

function list(lines, items, fmt) {
  for (const it of items ?? []) lines.push(`- ${fmt(it)}`);
}

export function renderTaskDoc(task) {
  const L = [];
  L.push('---');
  L.push(`kind: task`);
  L.push(`id: "${task.id}"`);
  L.push(`title: ${JSON.stringify(task.title)}`);
  L.push(`state: ${task.state}`);
  L.push(`revision: ${task.revision}`);
  L.push(`schemaVersion: ${task.schemaVersion}`);
  for (const [k, v] of [['backlog', task.backlog], ['type', task.type],
      ['priority', task.priority], ['severity', task.severity],
      ['effort', task.effort], ['disposition', task.disposition],
      ['source', task.source], ['planKey', task.planKey]]) {
    if (v !== undefined && v !== null) L.push(`${k}: ${JSON.stringify(v)}`);
  }
  L.push(`createdAt: "${task.createdAt}"`);
  L.push(`updatedAt: "${task.updatedAt}"`);
  L.push('---');
  L.push('');
  L.push(`# ${task.title}`);
  L.push('');
  L.push('## Contract');
  L.push('');
  L.push(task.contract);
  L.push('');
  if (task.authorContext) {
    L.push('## Author context');
    L.push('');
    L.push(task.authorContext);
    L.push('');
  }
  if (task.scope?.length) {
    L.push('## Scope');
    L.push('');
    list(L, task.scope, (s) => `\`${s}\``);
    L.push('');
  }
  if (task.dependsOn?.length || Object.keys(task.relations ?? {}).length) {
    L.push('## Dependencies & relations');
    L.push('');
    list(L, task.dependsOn, (d) => `dependsOn \`${d}\``);
    for (const kind of RELATION_ORDER) {
      const ids = task.relations?.[kind];
      if (ids?.length) list(L, ids, (id) => `${kind} \`${id}\``);
    }
    for (const [kind, ids] of Object.entries(task.relations ?? {})) {
      if (!RELATION_ORDER.includes(kind) && ids.length) {
        list(L, ids, (id) => `${kind} \`${id}\``);
      }
    }
    L.push('');
  }
  if (task.goalIds?.length) {
    L.push('## Goals');
    L.push('');
    list(L, task.goalIds, (g) => `\`${g}\``);
    L.push('');
  }
  if (task.steps?.length) {
    L.push('## Steps');
    L.push('');
    for (const [i, s] of task.steps.entries()) {
      const mark = s.status === 'done' ? 'x' : s.status === 'skipped' ? '-' : ' ';
      L.push(`- [${mark}] ${i + 1}. ${s.text} _(${s.status})_`);
    }
    L.push('');
  }
  if (task.analysis && Object.values(task.analysis).some((v) =>
      (Array.isArray(v) && v.length) || (typeof v === 'string' && v))) {
    L.push('## Analysis');
    L.push('');
    for (const [k, v] of Object.entries(task.analysis)) {
      if (Array.isArray(v)) {
        if (v.length) { L.push(`- **${k}**:`); list(L, v, (x) => x); }
      } else if (typeof v === 'string' && v) {
        L.push(`- **${k}**: ${v}`);
      }
    }
    L.push('');
  }
  if (task.notes?.length) {
    L.push('## Notes');
    L.push('');
    list(L, task.notes, (n) => {
      if (typeof n === 'string') return n;
      const at = typeof n?.at === 'string' ? `\`${n.at.slice(0, 10)}\` ` : '';
      const by = typeof n?.by === 'string' ? `**${n.by}** ` : '';
      return `${at}${by}${n?.text ?? ''}`;
    });
    L.push('');
  }
  L.push('## History');
  L.push('');
  for (const h of task.history ?? []) {
    L.push(`- \`${h.at}\` ${h.event}${h.state ? ` → **${h.state}**` : ''}`);
  }
  L.push('');
  L.push('<!-- Derived from the task JSON record; regenerate with',
    '`scopegrain task doc`. Do not edit by hand. -->');
  return L.join('\n') + '\n';
}

export function taskDocPath(ctx, taskId) {
  return path.join(tasksDirAbs(ctx), `${taskId}.md`);
}

export function writeTaskDoc(ctx, taskId) {
  const task = getTask(ctx, taskId);
  const abs = taskDocPath(ctx, task.id);
  const content = renderTaskDoc(task);
  let prior = null;
  try { prior = fs.readFileSync(abs, 'utf8'); } catch { /* absent */ }
  if (prior === content) return { path: abs, taskId: task.id, changed: false };
  mkdirpSync(path.dirname(abs));
  fs.writeFileSync(abs, content, 'utf8');
  return { path: abs, taskId: task.id, changed: true };
}
