import { useMemo } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useT } from '@/lib/i18n';
import { EmptyBox, ErrorBox, ListSkeleton } from '@/components/StatusBits';
import { ViewSection } from '@/components/ViewSection';
import { TaskDag, usePoll } from '@/components/viz';

export function GraphView() {
  const t = useT();
  // The lifecycle funnel lives in SystemView (pipeline metric); this view
  // keeps the dependency DAG only — no duplicated api.workflow/workspace
  // fetches (audit N7).
  const tasksApi = useApi(() => api.tasks(500));
  usePoll(tasksApi.reload);

  const graph = useMemo(() => {
    const tasks = tasksApi.data?.tasks ?? [];
    const ids = new Set(tasks.map((x) => x.id));
    const edges: { from: string; to: string; kind: string }[] = [];
    const involved = new Set<string>();
    for (const task of tasks) {
      for (const dep of task.dependsOn ?? []) {
        if (ids.has(dep)) {
          edges.push({ from: dep, to: task.id, kind: 'dependsOn' });
          involved.add(dep);
          involved.add(task.id);
        }
      }
      for (const [relKind, targets] of Object.entries(task.relations ?? {})) {
        for (const target of targets as string[]) {
          if (ids.has(target)) {
            edges.push({ from: task.id, to: target, kind: relKind });
            involved.add(task.id);
            involved.add(target);
          }
        }
      }
    }
    const nodes = tasks.filter((x) => involved.has(x.id)).map((x) => ({
      id: x.id,
      label: x.title || x.id.slice(0, 8),
      state: x.state,
    }));
    return { nodes, edges };
  }, [tasksApi.data]);

  if (tasksApi.loading) {
    return <ListSkeleton label={t('common.loading')} />;
  }
  if (tasksApi.error) {
    return <ErrorBox error={tasksApi.error} onRetry={tasksApi.reload} />;
  }

  return (
    <ViewSection
      title={t('graph.dag')}
      description={t('graph.dagDesc')}
      refreshing={tasksApi.refreshing}
      truncated={tasksApi.data?.truncated === true}
    >
      {graph.nodes.length === 0 ? (
        <EmptyBox>{t('graph.empty')}</EmptyBox>
      ) : (
        <TaskDag
          nodes={graph.nodes}
          edges={graph.edges}
          labels={{ empty: t('graph.empty'), dag: t('graph.dag') }}
        />
      )}
    </ViewSection>
  );
}
