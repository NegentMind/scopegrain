// Link suggestion (read-only): surfaces candidate edges the registry
// does not yet record. Nothing here writes — `task link --apply` stays
// the only writer, so a suggestion can never silently become truth.
//
// Heuristics, all deterministic:
//   plan-dag    — a plan DAG edge (member.dependsOn keys resolved to ids)
//                 absent from the record's dependsOn. The gate already
//                 enforces the edge at plan level; the record just does
//                 not mirror it yet (legacy materializations predate the
//                 propagation in preparePlan).
//   title-sim   — Jaccard over normalized title tokens. An open task
//                 strongly resembling an ABANDON one suggests
//                 `supersedes`; two open tasks nearly identical suggest
//                 `see` (asserting duplicateOf on live work is too
//                 presumptuous for a hint).
//
// Existing edges are never re-suggested, including already-declared
// relations of any kind between the same pair.

const TITLE_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'para',
  'con', 'los', 'las', 'una', 'del', 'por', 'que', 'task', 'tarea',
]);

const SUPERSEDES_MIN = 0.8;
const SEE_MIN = 0.75;
const MAX_SUGGESTIONS = 50;

function titleTokens(title) {
  const tokens = new Set();
  for (const raw of String(title ?? '').toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length >= 3 && !TITLE_STOPWORDS.has(raw)) tokens.add(raw);
  }
  return tokens;
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared);
}

/**
 * @param {{tasks: object[], plans?: object[]}} input task records (as
 *   returned by listTasks) and plan records (for DAG edges).
 * @returns {object[]} suggestions, each
 *   `{sourceId, targetId, kind, reason, evidence}` where `kind` is
 *   `dependsOn` or a RELATION_KINDS member and `reason` names the
 *   heuristic — stable, sorted output for UI and CLI.
 */
export function suggestTaskLinks({ tasks, plans = [] }) {
  const byId = new Map();
  for (const t of tasks ?? []) {
    if (t && typeof t.id === 'string') byId.set(t.id, t);
  }
  const declared = new Set();
  for (const t of byId.values()) {
    for (const dep of t.dependsOn ?? []) {
      declared.add(`${t.id}${dep}dependsOn`);
    }
    for (const [kind, refs] of Object.entries(t.relations ?? {})) {
      for (const ref of refs) declared.add(`${t.id}${ref}${kind}`);
    }
  }

  const out = [];
  const seen = new Set();
  const push = (sourceId, targetId, kind, reason, evidence) => {
    if (sourceId === targetId) return;
    if (!byId.has(sourceId) || !byId.has(targetId)) return;
    const key = `${sourceId}${targetId}${kind}`;
    if (seen.has(key) || declared.has(key)) return;
    seen.add(key);
    out.push({ sourceId, targetId, kind, reason, evidence });
  };

  // H1: plan DAG edges not mirrored on the record. Member ids may be
  // absent on plans prepared before materialization — skip those.
  for (const plan of plans ?? []) {
    const members = plan.tasks ?? [];
    const byKey = new Map(members.map((m) => [m.key, m]));
    for (const member of members) {
      for (const depKey of member.dependsOn ?? []) {
        const dep = byKey.get(depKey);
        if (member.id && dep?.id) {
          push(member.id, dep.id, 'dependsOn', 'plan-dag',
            { planKey: plan.key, memberKey: member.key, depKey });
        }
      }
    }
  }

  // H2: title similarity. An ABANDONED task re-registered under a
  // similar title is the common duplicate pattern in a CLI intake flow.
  const open = (tasks ?? []).filter(
    (t) => byId.has(t.id) && t.state !== 'ABANDON');
  const dead = (tasks ?? []).filter(
    (t) => byId.has(t.id) && t.state === 'ABANDON');
  const tokens = new Map([...byId.values()]
    .map((t) => [t.id, titleTokens(t.title)]));

  for (const a of open) {
    for (const b of dead) {
      const sim = jaccard(tokens.get(a.id), tokens.get(b.id));
      if (sim >= SUPERSEDES_MIN) {
        push(a.id, b.id, 'supersedes', 'title-sim',
          { similarity: Number(sim.toFixed(2)), targetState: 'ABANDON' });
      } else if (sim >= SEE_MIN) {
        push(a.id, b.id, 'see', 'title-sim',
          { similarity: Number(sim.toFixed(2)), targetState: 'ABANDON' });
      }
    }
  }
  for (let i = 0; i < open.length; i++) {
    for (let j = i + 1; j < open.length; j++) {
      const a = open[i]; const b = open[j];
      const sim = jaccard(tokens.get(a.id), tokens.get(b.id));
      if (sim >= SUPERSEDES_MIN) {
        // Direction: the later task sees the earlier — ordering by the
        // record's position keeps the hint stable without inventing a
        // creation-order claim.
        push(b.id, a.id, 'see', 'title-sim',
          { similarity: Number(sim.toFixed(2)) });
      }
    }
  }

  out.sort((x, y) =>
    x.reason.localeCompare(y.reason)
    || (y.evidence?.similarity ?? 0) - (x.evidence?.similarity ?? 0)
    || x.sourceId.localeCompare(y.sourceId)
    || x.targetId.localeCompare(y.targetId));
  return out.slice(0, MAX_SUGGESTIONS);
}
