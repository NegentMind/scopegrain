import { useMemo, type ReactNode } from 'react';
import {
  api,
  type GraphFiles,
  type GraphTaskNode,
  type LinkSuggestions,
} from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useT } from '@/lib/i18n';
import { EmptyBox, ErrorBox, ListSkeleton } from '@/components/StatusBits';
import { Badge } from '@/components/ui/badge';
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
  const tasksApi = useApi(() => api.tasks(500), [], 'tasks:500');
  const plansApi = useApi(() => api.plans(), [], 'plans');
  const impactApi = useApi(() => api.graphFiles(500), [], 'graph-files:500');
  const suggestApi = useApi(
    () => api.taskLinkSuggestions(), [], 'link-suggest');
  usePoll(tasksApi.reload);
  usePoll(plansApi.reload);
  usePoll(impactApi.reload);
  usePoll(suggestApi.reload);

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

  if (tasksApi.loading || plansApi.loading || impactApi.loading
    || suggestApi.loading) {
    return <ListSkeleton label={t('common.loading')} />;
  }
  if (tasksApi.error) {
    return <ErrorBox error={tasksApi.error} onRetry={tasksApi.reload} />;
  }
  if (plansApi.error) {
    return <ErrorBox error={plansApi.error} onRetry={plansApi.reload} />;
  }
  if (impactApi.error) {
    return <ErrorBox error={impactApi.error} onRetry={impactApi.reload} />;
  }
  if (suggestApi.error) {
    return (
      <ErrorBox error={suggestApi.error} onRetry={suggestApi.reload} />
    );
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
      <FileImpactSection
        data={impactApi.data ?? undefined}
        refreshing={impactApi.refreshing}
      />
      <LinkSuggestSection
        data={suggestApi.data ?? undefined}
        refreshing={suggestApi.refreshing}
      />
    </div>
  );
}

// Candidate edges the registry does not record yet (plan DAG gaps,
// similar titles against ABANDONED tasks). The API only suggests —
// nothing here writes; each row renders the exact `task link` command
// so applying is a paste away, revision included.
function LinkSuggestSection({
  data, refreshing,
}: {
  data: LinkSuggestions | undefined;
  refreshing: boolean;
}) {
  const t = useT();
  const items = data?.suggestions ?? [];
  const href = (id: string) => `#/tasks/${encodeURIComponent(id)}`;
  const cmd = (s: LinkSuggestions['suggestions'][number]) =>
    `scopegrain task link ${s.sourceId} ${s.targetId}` +
    ` --revision ${s.sourceRevision ?? 'N'}` +
    (s.kind === 'dependsOn' ? '' : ` --kind ${s.kind}`) + ' --apply';

  return (
    <ViewSection
      title={t('graph.suggest.title')}
      description={t('graph.suggest.desc')}
      refreshing={refreshing}
    >
      {items.length === 0 ? (
        <EmptyBox>{t('graph.suggest.empty')}</EmptyBox>
      ) : (
        <ul className="space-y-2">
          {items.map((s) => (
            <li
              key={`${s.sourceId}${s.targetId}${s.kind}`}
              className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm"
            >
              <a
                href={href(s.sourceId)}
                className="max-w-48 truncate font-medium hover:text-primary hover:underline"
                title={s.sourceTitle ?? s.sourceId}
              >
                {s.sourceTitle ?? s.sourceId.slice(0, 8)}
              </a>
              <Badge variant="outline" className="font-mono text-2xs">
                {s.kind}
              </Badge>
              <a
                href={href(s.targetId)}
                className="max-w-48 truncate font-medium hover:text-primary hover:underline"
                title={s.targetTitle ?? s.targetId}
              >
                {s.targetTitle ?? s.targetId.slice(0, 8)}
              </a>
              <span className="font-mono text-2xs text-muted-foreground">
                {t(`graph.suggest.reason.${s.reason}`)}
                {typeof s.evidence.similarity === 'number'
                  ? ` · ${s.evidence.similarity}`
                  : ''}
              </span>
              <code className="ml-auto select-all rounded bg-muted px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
                {cmd(s)}
              </code>
            </li>
          ))}
        </ul>
      )}
    </ViewSection>
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

// File impact per node: declared (scope regions, step files) and
// recorded (progress/activity `files`) paths crossed with the structure
// index. `indexed:null` and `matched:null` are surfaced as absent data —
// never invented metadata. When the index itself is missing the whole
// section says so instead of implying zero coverage.
function FileImpactSection({
  data, refreshing,
}: {
  data: GraphFiles | undefined;
  refreshing: boolean;
}) {
  const t = useT();
  const nodes = useMemo(
    () => (data?.tasks ?? [])
      .filter((n) => n.files.length > 0 || n.scope.length > 0),
    [data],
  );
  const indexPresent = data?.index.present === true;
  const viaLabel = (v: string) => t(`graph.via.${v}`);

  return (
    <ViewSection
      title={t('graph.impact')}
      description={t('graph.impactDesc')}
      refreshing={refreshing}
      truncated={data?.truncated === true}
    >
      {!indexPresent && data !== undefined ? (
        <EmptyBox>{t('graph.indexAbsent')}</EmptyBox>
      ) : null}
      {data !== undefined
      && (data.worklogTail.progress.truncated
        || data.worklogTail.activity.truncated
        || data.worklogTail.progress.malformed > 0
        || data.worklogTail.activity.malformed > 0) ? (
          <p className="text-xs text-muted-foreground">
            {t('graph.logTruncated')}
            {(data.worklogTail.progress.malformed
              + data.worklogTail.activity.malformed) > 0
              ? ` ${t('graph.logMalformed').replace('{n}', String(
                  data.worklogTail.progress.malformed
                  + data.worklogTail.activity.malformed))}`
              : ''}
          </p>
        ) : null}
      {nodes.length === 0 ? (
        <EmptyBox>{t('graph.impactEmpty')}</EmptyBox>
      ) : (
        <ul className="space-y-3">
          {nodes.map((n: GraphTaskNode) => (
            <li key={n.id} className="rounded-md border p-3">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <a
                  href={`#/tasks/${encodeURIComponent(n.id)}`}
                  className="font-medium hover:underline"
                >
                  {n.title || n.id.slice(0, 8)}
                </a>
                <span className="font-mono text-xs text-muted-foreground">
                  {n.state}
                </span>
                {n.planKey ? (
                  <span className="font-mono text-xs text-muted-foreground">
                    {n.planKey}
                  </span>
                ) : null}
              </div>
              {n.scope.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {n.scope.map((s) => (
                    <li key={s.region}
                      className="font-mono text-xs text-muted-foreground">
                      {s.region}
                      {s.matched === null ? (
                        <> · {t('graph.notIndexed')}</>
                      ) : (
                        <>
                          {' · '}
                          {t('graph.matched')
                            .replace('{n}', String(s.matched))}
                        </>
                      )}
                      {s.sample.length > 0 ? (
                        <ul className="ml-4 mt-0.5 space-y-0.5">
                          {s.sample.map((p) => (
                            <li key={p}>{p}</li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              {n.files.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {n.files.map((f) => (
                    <li key={f.path}
                      className="flex flex-wrap items-baseline gap-x-2 font-mono text-xs">
                      <span>{f.path}</span>
                      <span className="text-muted-foreground">
                        {f.via.map(viaLabel).join(', ')}
                      </span>
                      {f.indexed ? (
                        <span className="text-muted-foreground">
                          {[
                            f.indexed.lang !== '-' ? f.indexed.lang : null,
                            f.indexed.lines >= 0
                              ? `${f.indexed.lines} L` : null,
                          ].filter(Boolean).join(' · ')
                            || t('graph.indexedNoMeta')}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          {t('graph.notIndexed')}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
              {n.filesTruncated ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('graph.filesTruncated')}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </ViewSection>
  );
}
