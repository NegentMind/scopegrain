// SPDX-License-Identifier: Apache-2.0
// User-story task-list rendering (spec-kit tasks.md parity): renders a
// plan's member tasks as `- [ ] T### [P] [USn] Title (path)` grouped by
// phase. Setup = tasks without scenario refs; each USn maps to the nth
// requirement of the bound spec; [P] marks tasks the wave scheduler
// considers parallel-safe. Read-only — produces text, writes nothing.

import { getPlan, planWaves } from './plans.mjs';
import { getTask } from './tasks.mjs';
import { getSpecification } from './specifications.mjs';

const DONE = new Set(['ACCEPT', 'CLOSE']);

// Returns {markdown, groups} for `plan stories` / `task doc --format`.
export function renderStoryTaskList(ctx, planKey) {
  const plan = getPlan(ctx, planKey);
  const waves = planWaves(ctx, planKey);
  const parallelKeys = new Set();
  for (const w of waves.waves) {
    if (w.parallel) for (const t of w.tasks) parallelKeys.add(t.key);
  }
  const members = plan.tasks.map((t) => {
    let task = null;
    try { task = getTask(ctx, t.id); } catch { /* dangling member */ }
    return { key: t.key, task };
  });
  // Story order follows the spec's requirement order when a spec binds.
  const reqOrder = new Map();
  const specId = members.find((m) => m.task?.specId)?.task?.specId;
  let allReqs = null;
  if (specId) {
    try {
      const reqs = getSpecification(ctx, specId).data.requirements;
      reqs.forEach((r, i) => reqOrder.set(r.id, i + 1));
      allReqs = new Set(reqs.map((r) => r.id));
    } catch { /* spec unreadable: stories fall back to encounter order */ }
  }
  // A V2 task whose refs span every requirement inherited the whole spec
  // (omitted refs normalize to all) — that is foundational work, not a
  // story slice, so it groups under Setup like a ref-less V1 task.
  const storyOf = (m) => {
    const refs = m.task?.scenarioRefs ?? [];
    if (refs.length === 0) return null;
    if (allReqs !== null && refs.length > 1
        && new Set(refs.map((r) => r.requirementId)).size
        === allReqs.size) {
      return null;
    }
    return refs[0].requirementId;
  };
  const storyIndex = new Map();
  const ordered = [...members].sort((a, b) => {
    const ra = storyOf(a); const rb = storyOf(b);
    if (ra === null && rb === null) return 0;
    if (ra === null) return -1;
    if (rb === null) return 1;
    return (reqOrder.get(ra) ?? 999) - (reqOrder.get(rb) ?? 999);
  });
  for (const m of ordered) {
    const r = storyOf(m);
    if (r !== null && !storyIndex.has(r)) {
      storyIndex.set(r, storyIndex.size + 1);
    }
  }
  const lines = [];
  const groups = [];
  let n = 0;
  let currentPhase = null;
  const openGroup = (name) => {
    if (currentPhase !== name) {
      lines.push('', `## Phase: ${name}`, '');
      groups.push(name);
      currentPhase = name;
    }
  };
  for (const m of ordered) {
    const req = storyOf(m);
    const phase = req === null ? 'Setup'
      : `User Story ${storyIndex.get(req)} (${req})`;
    openGroup(phase);
    n += 1;
    const done = m.task && DONE.has(m.task.state);
    const par = parallelKeys.has(m.key) ? ' [P]' : '';
    const story = req === null ? '' : ` [US${storyIndex.get(req)}]`;
    const title = m.task ? m.task.title : `unresolved task ${m.key}`;
    const scope = m.task?.scope?.[0] ? ` \`${m.task.scope[0]}\`` : '';
    lines.push(`- [${done ? 'x' : ' '}] T${String(n).padStart(3, '0')}`
      + `${par}${story} ${title}${scope}`);
  }
  return Object.freeze({
    markdown: `# Tasks — ${plan.title}\n${lines.join('\n')}\n`,
    groups, taskCount: n,
  });
}
