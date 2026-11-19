// Shared read-only visualizations: C0 lifecycle funnel, task dependency
// DAG and a polling hook. Pure SVG — no chart dependency.
import { useEffect, useRef } from 'react';
import type { WorkflowPolicy } from '@/lib/api';

// Ordered pipeline for display; side states shown separately.
export const PIPELINE_ORDER = [
  'PLAN', 'ACT', 'VERIFY', 'COLLATERAL', 'EVALUATE', 'REVIEW', 'ACCEPT', 'CLOSE',
];
const SIDE_STATES = ['RESEARCH', 'STALL'];

export function usePoll(fn: () => void, ms = 10000) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const t = setInterval(() => ref.current(), ms);
    return () => clearInterval(t);
  }, [ms]);
}

export function LifecycleFunnel({
  workflow,
  counts,
  labels,
}: {
  workflow: WorkflowPolicy;
  counts: Record<string, number>;
  labels: { pipeline: string; side: string };
}) {
  const order = [
    ...PIPELINE_ORDER.filter((s) => workflow.transitions[s] !== undefined),
    ...Object.keys(workflow.transitions).filter(
      (s) => !PIPELINE_ORDER.includes(s) && !SIDE_STATES.includes(s)),
  ];
  const W = 112;
  const H = 44;
  const GAP = 34;
  const totalW = order.length * (W + GAP) - GAP;
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted-foreground">{labels.pipeline}</div>
      <div className="overflow-x-auto">
        <svg width={totalW + 8} height={H + 30} role="img"
          aria-label={labels.pipeline}>
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5"
              markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className="fill-muted-foreground" />
            </marker>
          </defs>
          {order.map((s, i) => {
            const x = i * (W + GAP) + 4;
            const c = counts[s] ?? 0;
            return (
              <g key={s}>
                <rect x={x} y={14} width={W} height={H} rx={8}
                  className={c > 0
                    ? 'fill-primary/15 stroke-primary/50'
                    : 'fill-muted/40 stroke-border'}
                  strokeWidth={1.5} />
                <text x={x + W / 2} y={34} textAnchor="middle"
                  className="fill-foreground text-[11px] font-semibold">{s}</text>
                <text x={x + W / 2} y={50} textAnchor="middle"
                  className="fill-muted-foreground text-[11px]">{c}</text>
                {i < order.length - 1 && (
                  <line x1={x + W} y1={14 + H / 2} x2={x + W + GAP} y2={14 + H / 2}
                    className="stroke-muted-foreground" strokeWidth={1.5}
                    markerEnd="url(#arrow)" />
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
        <span>{labels.side}:</span>
        {SIDE_STATES.map((s) => (
          <span key={s}>{s}: <b className="text-foreground">{counts[s] ?? 0}</b></span>
        ))}
      </div>
    </div>
  );
}

// Simple topologically-layered DAG for task dependsOn/relations edges.
export function TaskDag({
  nodes,
  edges,
  labels,
}: {
  nodes: { id: string; label: string; state?: string }[];
  edges: { from: string; to: string; kind: string }[];
  labels: { empty: string };
}) {
  if (nodes.length === 0) {
    return <div className="text-sm text-muted-foreground">{labels.empty}</div>;
  }
  const idSet = new Set(nodes.map((n) => n.id));
  const depth = new Map<string, number>();
  const remaining = new Set(idSet);
  const guard = nodes.length * 2;
  let it = 0;
  while (remaining.size && it < guard) {
    it += 1;
    for (const id of [...remaining]) {
      const deps = edges.filter((e) => e.to === id && idSet.has(e.from));
      if (deps.every((e) => depth.has(e.from))) {
        depth.set(id, deps.length
          ? Math.max(...deps.map((e) => depth.get(e.from)!)) + 1 : 0);
        remaining.delete(id);
      }
    }
  }
  for (const id of remaining) depth.set(id, 0); // cycles land at layer 0
  const layers = new Map<number, string[]>();
  for (const [id, d] of depth) {
    const l = layers.get(d) ?? [];
    l.push(id);
    layers.set(d, l);
  }
  const maxLayer = Math.max(...depth.values());
  const W = 150;
  const H = 40;
  const GX = 40;
  const GY = 22;
  const pos = new Map<string, { x: number; y: number }>();
  for (let d = 0; d <= maxLayer; d += 1) {
    (layers.get(d) ?? []).forEach((id, i) => {
      pos.set(id, { x: d * (W + GX), y: i * (H + GY) });
    });
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const svgH = Math.max(60, ...[...pos.values()].map((p) => p.y + H)) + 10;
  const svgW = (maxLayer + 1) * (W + GX) + 10;
  return (
    <div className="overflow-x-auto">
      <svg width={svgW} height={svgH} role="img" aria-label="task dependency graph">
        <defs>
          <marker id="darrow" viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className="fill-muted-foreground" />
          </marker>
        </defs>
        {edges.filter((e) => pos.has(e.from) && pos.has(e.to)).map((e, i) => {
          const a = pos.get(e.from)!;
          const b = pos.get(e.to)!;
          return (
            <line key={i} x1={a.x + W} y1={a.y + H / 2} x2={b.x} y2={b.y + H / 2}
              className={e.kind === 'dependsOn' ? 'stroke-primary/60' : 'stroke-muted-foreground/60'}
              strokeWidth={1.4} strokeDasharray={e.kind === 'dependsOn' ? '' : '4 3'}
              markerEnd="url(#darrow)" />
          );
        })}
        {[...pos.entries()].map(([id, p]) => {
          const n = byId.get(id)!;
          const short = n.label.length > 18 ? `${n.label.slice(0, 17)}…` : n.label;
          return (
            <g key={id}>
              <rect x={p.x} y={p.y} width={W} height={H} rx={7}
                className="fill-card stroke-border" strokeWidth={1.4} />
              <text x={p.x + W / 2} y={p.y + 17} textAnchor="middle"
                className="fill-foreground text-[10px] font-medium">{short}</text>
              <text x={p.x + W / 2} y={p.y + 32} textAnchor="middle"
                className="fill-muted-foreground text-[9px]">{n.state ?? id.slice(0, 8)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
