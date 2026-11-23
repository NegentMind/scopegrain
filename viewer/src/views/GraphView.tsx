import { useMemo } from 'react';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import { api } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useT } from '@/lib/i18n';
import { EmptyBox, ErrorBox, ListSkeleton } from '@/components/StatusBits';
import { LifecycleFunnel, TaskDag, usePoll } from '@/components/viz';

export function GraphView() {
  const t = useT();
  const tasksApi = useApi(() => api.tasks(500));
  const wfApi = useApi(() => api.workflow());
  const wsApi = useApi(() => api.workspace());
  usePoll(() => { tasksApi.reload(); wsApi.reload(); });

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

  if (tasksApi.loading || wfApi.loading || wsApi.loading) return <ListSkeleton />;
  if (tasksApi.error) return <ErrorBox error={tasksApi.error} onRetry={tasksApi.reload} />;
  if (wfApi.error) return <ErrorBox error={wfApi.error} onRetry={wfApi.reload} />;
  if (wsApi.error) return <ErrorBox error={wsApi.error} onRetry={wsApi.reload} />;

  const counts = wsApi.data?.counts.tasksByState ?? {};
  const policy = wfApi.data?.workflow;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('graph.lifecycle')}</CardTitle>
          <CardDescription>{t('graph.lifecycleDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          {policy && (
            <LifecycleFunnel workflow={policy} counts={counts}
              labels={{ pipeline: t('system.pipeline'), side: t('system.side') }} />
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('graph.dag')}</CardTitle>
          <CardDescription>
            {t('graph.dagDesc')}
            {tasksApi.data?.truncated ? t('common.truncatedByApi') : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {graph.nodes.length === 0 ? (
            <EmptyBox>{t('graph.empty')}</EmptyBox>
          ) : (
            <TaskDag nodes={graph.nodes} edges={graph.edges}
              labels={{ empty: t('graph.empty'), dag: t('graph.dag') }} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
