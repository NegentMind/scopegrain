import { useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  api,
  type PlanStatus,
  type PlanSummary,
} from '@/lib/api';
import { useApi } from '@/lib/useApi';
import {
  EmptyBox,
  ErrorBox,
  ListSkeleton,
  StateBadge,
} from '@/components/StatusBits';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { usePoll } from '@/components/viz';
import { openTask } from '@/lib/nav';
import { Markdown } from '@/components/Markdown';

const READINESS_TONE: Record<string, string> = {
  ready:
    'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  blocked:
    'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  active:
    'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30',
  closed: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border-zinc-500/30',
};

const STATUS_TONE: Record<PlanStatus, string> = {
  completed:
    'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  in_progress:
    'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30',
  pending:
    'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  empty: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border-zinc-500/30',
};

type Selection =
  | { kind: 'plan'; key: string }
  | { kind: 'doc'; name: string }
  | null;

function ProgressBar({ pct, done }: { pct: number | null; done?: boolean }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={cn(
          'h-full rounded-full transition-all',
          done || pct === 100 ? 'bg-emerald-500' : 'bg-primary',
        )}
        style={{ width: `${pct ?? 0}%` }}
      />
    </div>
  );
}

export function PlansView() {
  const t = useT();
  const [sel, setSel] = useState<Selection>(null);
  const plans = useApi(() => api.plans());
  const docs = useApi(() => api.planDocs());
  usePoll(() => {
    plans.reload();
    docs.reload();
  });

  if (plans.loading || docs.loading) return <ListSkeleton />;
  if (plans.error) return <ErrorBox error={plans.error} onRetry={plans.reload} />;
  if (docs.error) return <ErrorBox error={docs.error} onRetry={docs.reload} />;

  const semantic = plans.data?.plans ?? [];
  const docList = docs.data?.docs ?? [];

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="min-w-0 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>{t('plans.semantic')}</CardTitle>
            <CardDescription>{t('plans.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            {semantic.length === 0 ? (
              <EmptyBox>{t('plans.empty')}</EmptyBox>
            ) : (
              <ul className="space-y-1.5">
                {semantic.map((p) => (
                  <PlanRow
                    key={p.key}
                    plan={p}
                    active={sel?.kind === 'plan' && sel.key === p.key}
                    onSelect={() => setSel({ kind: 'plan', key: p.key })}
                  />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('plans.docs')}</CardTitle>
            <CardDescription>
              {t('nav.plans.desc')}
              {docs.data?.truncated ? t('common.truncatedByApi') : ''}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {docList.length === 0 ? (
              <EmptyBox>{t('plans.docEmpty')}</EmptyBox>
            ) : (
              <ScrollArea className="max-h-96">
                <ul className="space-y-1.5">
                  {docList.map((d) => (
                    <li key={d.name}>
                      <button
                        type="button"
                        onClick={() => setSel({ kind: 'doc', name: d.name })}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-ring',
                          sel?.kind === 'doc' && sel.name === d.name && 'bg-accent',
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">
                            {d.title ?? d.name}
                          </span>
                          <span className="block truncate font-mono text-[10px] text-muted-foreground">
                            {d.name}
                          </span>
                        </span>
                        {d.status ? (
                          <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
                            {d.status}
                          </Badge>
                        ) : null}
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {d.date ?? d.updatedAt.slice(0, 10)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="min-w-0 self-start">
        <CardHeader>
          <CardTitle>{t('plans.title')}</CardTitle>
          <CardDescription>
            {sel === null
              ? `${t('plans.selectPlan')} · ${t('plans.selectDoc')}`
              : sel.kind === 'plan'
                ? sel.key
                : sel.name}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sel === null ? (
            <EmptyBox>{t('plans.selectPlan')}</EmptyBox>
          ) : sel.kind === 'plan' ? (
            <PlanDetail planKey={sel.key} />
          ) : (
            <PlanDocDetail name={sel.name} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PlanRow({
  plan: p,
  active,
  onSelect,
}: {
  plan: PlanSummary;
  active: boolean;
  onSelect: () => void;
}) {
  const t = useT();
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'w-full space-y-1.5 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-ring',
          active && 'bg-accent',
        )}
      >
        <div className="flex items-center gap-2">
          <span className="font-mono font-medium">{p.key}</span>
          <Badge variant="outline" className={STATUS_TONE[p.status]}>
            {t(`plans.statuses.${p.status}`)}
          </Badge>
          <span className="ml-auto text-xs text-muted-foreground">
            {p.createdAt.slice(0, 16).replace('T', ' ')}
          </span>
        </div>
        <p className="truncate text-muted-foreground">{p.title}</p>
        <div className="flex items-center gap-3">
          <ProgressBar pct={p.progress} />
          <span className="shrink-0 font-mono text-xs text-muted-foreground">
            {p.done}/{p.total}
            {p.progress !== null ? ` · ${p.progress}%` : ''}
          </span>
        </div>
      </button>
    </li>
  );
}

function PlanDetail({ planKey }: { planKey: string }) {
  const t = useT();
  const detail = useApi(() => api.plan(planKey), [planKey]);
  if (detail.loading) return <ListSkeleton rows={3} />;
  if (detail.error) {
    return <ErrorBox error={detail.error} onRetry={detail.reload} />;
  }
  if (!detail.data) return null;
  const { plan, readiness, waves, runState } = detail.data;
  const byId = new Map(readiness.map((r) => [r.id, r]));
  const members = detail.data.tasks;
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className={STATUS_TONE[detail.data.status]}>
          {t(`plans.statuses.${detail.data.status}`)}
        </Badge>
        <Badge variant="secondary">v{plan.schemaVersion}</Badge>
        <Badge variant="secondary">
          {detail.data.done}/{detail.data.total} {t('plans.tasks')}
        </Badge>
        {detail.data.progress !== null ? (
          <Badge variant="secondary" className="font-mono">
            {detail.data.progress}%
          </Badge>
        ) : null}
        {plan.specId ? <Badge variant="outline">spec {plan.specId.slice(0, 8)}</Badge> : null}
        {plan.designId ? <Badge variant="outline">design {plan.designId.slice(0, 8)}</Badge> : null}
        {plan.appetite ? <Badge variant="outline">appetite: {plan.appetite}</Badge> : null}
        {plan.cynefin ? <Badge variant="outline">cynefin: {plan.cynefin}</Badge> : null}
        <span className="text-xs text-muted-foreground">
          {plan.createdAt.slice(0, 16).replace('T', ' ')}
        </span>
      </div>
      <ProgressBar pct={detail.data.progress} />

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('common.key')}</TableHead>
            <TableHead>{t('common.title')}</TableHead>
            <TableHead>{t('common.state')}</TableHead>
            <TableHead>{t('plans.blockedBy')}</TableHead>
            <TableHead>{t('tasks.dependsOn')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((task) => {
            const r = byId.get(task.id);
            return (
              <TableRow key={task.id}>
                <TableCell className="font-mono">{task.key}</TableCell>
                <TableCell>
                  {task.id ? (
                    <button
                      type="button"
                      onClick={() => openTask(task.id)}
                      className="max-w-64 truncate text-left font-medium text-primary underline-offset-4 hover:underline"
                    >
                      {task.title ?? task.id.slice(0, 8)}
                    </button>
                  ) : (
                    task.title ?? t('common.none')
                  )}
                </TableCell>
                <TableCell>
                  {task.state ? <StateBadge state={task.state} /> : t('common.none')}
                </TableCell>
                <TableCell>
                  {r ? (
                    <Badge
                      variant="outline"
                      className={READINESS_TONE[r.status]}
                    >
                      {t(`plans.${r.status}`)}
                    </Badge>
                  ) : task.triage ? (
                    <Badge variant="outline" className="font-mono">
                      {task.triage}
                    </Badge>
                  ) : t('common.none')}
                  {r && r.blockedBy.length > 0 ? (
                    <span className="ml-1 text-xs text-muted-foreground">
                      {r.blockedBy.join(', ')}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {task.dependsOn.length > 0
                    ? task.dependsOn.join(', ')
                    : t('common.none')}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {waves && waves.waves.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            {t('plans.waves')}
          </p>
          {waves.waves.map((w, i) => (
            <div
              key={i}
              className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-1.5 text-xs"
            >
              <Badge variant="secondary" className="font-mono">
                {t('plans.wave')} {w.wave ?? i}
                {w.parallel ? ` · ${t('plans.parallel')}` : ''}
              </Badge>
              <div className="flex flex-wrap items-center gap-1.5">
                {w.tasks.map((item, idx) => {
                  const key = typeof item === 'string' ? item : item.key;
                  const id = typeof item === 'string' ? undefined : item.id;
                  const state = typeof item === 'string' ? undefined : item.state;
                  return id ? (
                    <button
                      key={`${key}-${idx}`}
                      type="button"
                      onClick={() => openTask(id)}
                      className="inline-flex items-center gap-1 rounded border bg-muted/40 px-1.5 py-0.5 font-mono text-xs text-primary hover:bg-muted"
                    >
                      <span>{key}</span>
                      {state ? <span className="text-muted-foreground">({state})</span> : null}
                    </button>
                  ) : (
                    <Badge key={`${key}-${idx}`} variant="outline" className="font-mono">
                      {key}
                    </Badge>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {runState ? (
        <div className="space-y-1.5 rounded-md border bg-muted/30 p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium text-foreground">{t('plans.runTracking')}</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {runState.persisted && runState.run ? (
                <Badge variant="secondary" className="font-mono">
                  {runState.run.checkpoints.length} {t('plans.checkpoints')} · rev {runState.run.revision}
                </Badge>
              ) : null}
              <Badge variant="outline" className="font-mono">
                {runState.resume.complete
                  ? t('plans.allDone')
                  : `${runState.resume.remainingWaves} ${t('plans.remainingWaves')} · ${runState.resume.percent}%`}
              </Badge>
            </div>
          </div>
          {runState.persisted && runState.run ? (
            <div className="space-y-1 text-muted-foreground">
              <p className="font-mono">
                {runState.run.updatedAt.slice(0, 19).replace('T', ' ')} · {runState.path}
              </p>
              {runState.resume.completedSinceLastCheckpoint.length > 0 ? (
                <p>
                  {t('plans.sinceCheckpoint')}:{' '}
                  <span className="font-mono text-foreground">
                    {runState.resume.completedSinceLastCheckpoint.join(', ')}
                  </span>
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-muted-foreground">
              {t('plans.notPersisted')}{' '}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">
                scopegrain plan run --project . {plan.key} --apply
              </code>
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function PlanDocDetail({ name }: { name: string }) {
  const t = useT();
  const detail = useApi(() => api.planDoc(name), [name]);
  if (detail.loading) return <ListSkeleton rows={3} />;
  if (detail.error) {
    return <ErrorBox error={detail.error} onRetry={detail.reload} />;
  }
  if (!detail.data) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {detail.data.bytes} B · {detail.data.updatedAt.slice(0, 10)}
        {detail.data.docTruncated ? ` ${t('plans.docTruncated')}` : ''}
      </p>
      <ScrollArea className="max-h-[36rem] rounded-md border bg-muted/40 p-4">
        <Markdown>{detail.data.doc}</Markdown>
      </ScrollArea>
    </div>
  );
}
