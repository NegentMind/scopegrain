import { useMemo, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useT } from '@/lib/i18n';
import { EmptyBox, ErrorBox, ListSkeleton } from '@/components/StatusBits';
import { ViewSection } from '@/components/ViewSection';
import { TaskDag, usePoll } from '@/components/viz';

interface DagModel {
  nodes: { id: string; label: string; state?: string; status?: string }[];
  edges: { from: string; to: string; kind: string }[];
}

export function GraphView() {
  const t = useT();
  // Two dependency layers, deliberately kept separate:
  //  - plan DAGs: key-based edges stored on the plan; the ACT gate
  //    enforces them (hard constraint). Materialized plan tasks also
  //    mirror them into task.dependsOn — filtered out below.
  //  - task links: id-based dependsOn/relations on the record itself
  //    (declared, informational). Shown only when not already drawn by
  //    a plan DAG.
  const tasksApi = useApi(() => api.tasks(500));
  const plansApi = useApi(() => api.plans());
  usePoll(tasksApi.reload);
  usePoll(plansApi.reload);

  const planDags = useMemo(() => {
    const out: ({ key: string; title: string; done: number; total: number }
      & DagModel)[] = [];
    for (const p of plansApi.data?.plans ?? []) {
      const byKey = new Map(p.tasks.map((x) => [x.key, x]));
      const edges: DagModel['edges'] = [];
      const involved = new Set<string>();
      for (const task of p.tasks) {
        for (const dep of task.dependsOn) {
          const d = byKey.get(dep);
          if (!d) continue;
          edges.push({ from: d.id, to: task.id, kind: 'dependsOn' });
          involved.add(d.id);
          involved.add(task.id);
        }
      }
      if (edges.length === 0) continue;
      const statusByKey = new Map(
        (p.readiness ?? []).map((r) => [r.key, r.status]),
      );
      const nodes = p.tasks
        .filter((x) => involved.has(x.id))
        .map((x) => ({
          id: x.id,
          label: x.title || x.key,
          state: x.state ?? undefined,
          status: statusByKey.get(x.key),
        }));
      out.push({
        key: p.key, title: p.title, done: p.done, total: p.total,
        nodes, edges,
      });
    }
    return out;
  }, [plansApi.data]);

  const taskGraph = useMemo<DagModel>(() => {
    const tasks = tasksApi.data?.tasks ?? [];
    const ids = new Set(tasks.map((x) => x.id));
    // dependsOn edges already rendered inside a plan DAG are skipped so
    // plan-propagated record deps do not draw the same edge twice.
    const planPairs = new Set(
      planDags.flatMap((d) => d.edges.map((e) => `${e.from}>${e.to}`)),
    );
    const edges: DagModel['edges'] = [];
    const involved = new Set<string>();
    for (const task of tasks) {
      for (const dep of task.dependsOn ?? []) {
        if (!ids.has(dep) || planPairs.has(`${dep}>${task.id}`)) continue;
        edges.push({ from: dep, to: task.id, kind: 'dependsOn' });
        involved.add(dep);
        involved.add(task.id);
      }
      for (const [relKind, targets] of Object.entries(task.relations ?? {})) {
        for (const target of targets as string[]) {
          if (!ids.has(target)) continue;
          edges.push({ from: task.id, to: target, kind: relKind });
          involved.add(task.id);
          involved.add(target);
        }
      }
    }
    const nodes = tasks.filter((x) => involved.has(x.id)).map((x) => ({
      id: x.id,
      label: x.title || x.id.slice(0, 8),
      state: x.state,
    }));
    return { nodes, edges };
  }, [tasksApi.data, planDags]);

  if (tasksApi.loading || plansApi.loading) {
    return <ListSkeleton label={t('common.loading')} />;
  }
  if (tasksApi.error) {
    return <ErrorBox error={tasksApi.error} onRetry={tasksApi.reload} />;
  }
  if (plansApi.error) {
    return <ErrorBox error={plansApi.error} onRetry={plansApi.reload} />;
  }

  const totalTasks = tasksApi.data?.tasks.length ?? 0;
  const linkedIds = new Set([
    ...planDags.flatMap((d) => d.nodes.map((n) => n.id)),
    ...taskGraph.nodes.map((n) => n.id),
  ]);
  const totalEdges =
    planDags.reduce((a, d) => a + d.edges.length, 0) + taskGraph.edges.length;
  const empty = planDags.length === 0 && taskGraph.nodes.length === 0;
  const href = (id: string) => `#/tasks/${encodeURIComponent(id)}`;

  return (
    <div className="space-y-6">
      <ViewSection
        title={t('graph.dag')}
        description={t('graph.dagDesc')}
        refreshing={tasksApi.refreshing || plansApi.refreshing}
        truncated={tasksApi.data?.truncated === true}
      >
        <p className="text-sm text-muted-foreground">
          {t('graph.context')
            .replace('{linked}', String(linkedIds.size))
            .replace('{total}', String(totalTasks))
            .replace('{plans}', String(planDags.length))
            .replace('{edges}', String(totalEdges))}
        </p>
        {empty ? (
          <EmptyBox>{t('graph.empty')}</EmptyBox>
        ) : (
          <div className="space-y-6">
            {planDags.map((dag) => (
              <section key={dag.key}>
                <h4 className="mb-1 text-sm font-medium">{dag.title}</h4>
                <p className="mb-2 font-mono text-xs text-muted-foreground">
                  {dag.key} · {dag.done}/{dag.total}
                </p>
                <TaskDag
                  nodes={dag.nodes}
                  edges={dag.edges}
                  labels={{ empty: t('graph.empty'), dag: t('graph.dag') }}
                  nodeHref={href}
                />
              </section>
            ))}
            {taskGraph.nodes.length > 0 ? (
              <section>
                <h4 className="mb-2 text-sm font-medium">
                  {t('graph.taskLinks')}
                </h4>
                <TaskDag
                  nodes={taskGraph.nodes}
                  edges={taskGraph.edges}
                  labels={{ empty: t('graph.empty'), dag: t('graph.dag') }}
                  nodeHref={href}
                />
              </section>
            ) : null}
            <DagLegend />
          </div>
        )}
      </ViewSection>
    </div>
  );
}

function DagLegend() {
  const t = useT();
  const Item = ({ children }: { children: ReactNode }) => (
    <span className="inline-flex items-center gap-1.5">{children}</span>
  );
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t pt-3 text-xs text-muted-foreground"
      role="note"
    >
      <Item>
        <svg width="26" height="8" aria-hidden>
          <line x1="0" y1="4" x2="26" y2="4" className="stroke-primary/60"
            strokeWidth="1.4" />
        </svg>
        {t('graph.legend.dep')}
      </Item>
      <Item>
        <svg width="26" height="8" aria-hidden>
          <line x1="0" y1="4" x2="26" y2="4"
            className="stroke-muted-foreground/60" strokeWidth="1.4"
            strokeDasharray="4 3" />
        </svg>
        {t('graph.legend.rel')}
      </Item>
      <Item>
        <svg width="26" height="8" aria-hidden>
          <line x1="0" y1="4" x2="26" y2="4" className="stroke-err/50"
            strokeWidth="1.4" strokeDasharray="4 3" />
        </svg>
        {t('graph.legend.blocks')}
      </Item>
      <span className="ml-auto inline-flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Item>
          <span className="inline-block size-2.5 rounded-sm bg-primary/60" />
          {t('plans.ready')}
        </Item>
        <Item>
          <span className="inline-block size-2.5 rounded-sm bg-warn/60" />
          {t('plans.blocked')}
        </Item>
        <Item>
          <span className="inline-block size-2.5 rounded-sm bg-ok/50" />
          {t('plans.closed')}
        </Item>
        <Item>
          <span className="inline-block size-2.5 rounded-sm bg-err/50" />
          ABANDON
        </Item>
      </span>
    </div>
  );
}
