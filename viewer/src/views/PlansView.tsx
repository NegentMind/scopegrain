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
import { api } from '@/lib/api';
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

const READINESS_TONE: Record<string, string> = {
  ready:
    'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  blocked:
    'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  active:
    'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30',
  closed: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border-zinc-500/30',
};

type Selection =
  | { kind: 'plan'; key: string }
  | { kind: 'doc'; name: string }
  | null;

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
                  <li key={p.key}>
                    <button
                      type="button"
                      onClick={() => setSel({ kind: 'plan', key: p.key })}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-ring',
                        sel?.kind === 'plan' && sel.key === p.key && 'bg-accent',
                      )}
                    >
                      <span className="font-mono font-medium">{p.key}</span>
                      <span className="truncate text-muted-foreground">
                        {p.title}
                      </span>
                      <Badge variant="secondary" className="ml-auto">
                        {p.taskCount} {t('plans.tasks')}
                      </Badge>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('plans.docs')}</CardTitle>
            <CardDescription>{t('nav.plans.desc')}</CardDescription>
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
                        <span className="truncate font-mono text-xs">
                          {d.name}
                        </span>
                        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                          {d.bytes} B · {d.updatedAt.slice(0, 10)}
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

function PlanDetail({ planKey }: { planKey: string }) {
  const t = useT();
  const detail = useApi(() => api.plan(planKey), [planKey]);
  if (detail.loading) return <ListSkeleton rows={3} />;
  if (detail.error) {
    return <ErrorBox error={detail.error} onRetry={detail.reload} />;
  }
  if (!detail.data) return null;
  const { plan, readiness } = detail.data;
  const byId = new Map(readiness.map((r) => [r.id, r]));
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">v{plan.schemaVersion}</Badge>
        <Badge variant="secondary">{plan.tasks.length} {t('plans.tasks')}</Badge>
        {plan.specId ? <Badge variant="outline">spec {plan.specId.slice(0, 8)}</Badge> : null}
        {plan.designId ? <Badge variant="outline">design {plan.designId.slice(0, 8)}</Badge> : null}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('common.key')}</TableHead>
            <TableHead className="w-24">{t('common.id')}</TableHead>
            <TableHead>{t('common.state')}</TableHead>
            <TableHead>{t('plans.blockedBy')}</TableHead>
            <TableHead>{t('tasks.dependsOn')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {plan.tasks.map((task) => {
            const r = byId.get(task.id);
            return (
              <TableRow key={task.id}>
                <TableCell className="font-mono">{task.key}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {task.id.slice(0, 8)}
                </TableCell>
                <TableCell>
                  {r ? <StateBadge state={r.state} /> : t('common.none')}
                </TableCell>
                <TableCell>
                  {r ? (
                    <Badge
                      variant="outline"
                      className={READINESS_TONE[r.status]}
                    >
                      {t(`plans.${r.status}`)}
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
                    ? task.dependsOn.map((d) => d.slice(0, 8)).join(', ')
                    : t('common.none')}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
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
      <ScrollArea className="max-h-[32rem] rounded-md border bg-muted/40">
        <pre className="p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words">
          {detail.data.doc}
        </pre>
      </ScrollArea>
    </div>
  );
}
