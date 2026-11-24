import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { api, type ChecklistItemStatus } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useT, useTEnum } from '@/lib/i18n';
import { openTask } from '@/lib/nav';
import { cn } from '@/lib/utils';
import {
  EmptyBox, ErrorBox, ListSkeleton, StateBadge,
} from '@/components/StatusBits';

const ITEM_TONE: Record<ChecklistItemStatus, string> = {
  pass: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  fail: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30',
  pending: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  na: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border-zinc-500/30',
};

export function StateView() {
  const t = useT();
  const te = useTEnum();
  const active = useApi(() => api.activeTask());
  const cons = useApi(() => api.constitution());
  const chk = useApi(() => api.checklists());

  if (active.loading || cons.loading || chk.loading) return <ListSkeleton />;
  if (active.error) {
    return <ErrorBox error={active.error} onRetry={active.reload} />;
  }
  if (cons.error) return <ErrorBox error={cons.error} onRetry={cons.reload} />;
  if (chk.error) return <ErrorBox error={chk.error} onRetry={chk.reload} />;

  const activeData = active.data;
  const constitution = cons.data?.constitution ?? null;
  const checklists = chk.data?.checklists ?? [];
  const malformed = chk.data?.malformed ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('active.title')}</CardTitle>
          <CardDescription>{t('active.desc')}</CardDescription>
        </CardHeader>
        <CardContent>
          {activeData?.error ? (
            <div className="text-xs text-destructive">
              {activeData.error.code}: {activeData.error.message}
            </div>
          ) : !activeData?.task ? (
            <EmptyBox>{t('active.none')}</EmptyBox>
          ) : (
            <button
              onClick={() => openTask(activeData.task!.id)}
              className="flex w-full flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60"
            >
              <StateBadge state={activeData.task.state} />
              <span className="min-w-0 flex-1 truncate font-medium">
                {activeData.task.title}
              </span>
              {activeData.source ? (
                <Badge variant="secondary" className="font-mono text-[10px]">
                  {t('active.source')}: {activeData.source}
                </Badge>
              ) : null}
              <span className="font-mono text-[10px] text-muted-foreground">
                {activeData.task.id.slice(0, 8)}
              </span>
            </button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('const.title')}</CardTitle>
          <CardDescription>{t('const.desc')}</CardDescription>
        </CardHeader>
        <CardContent>
          {!constitution ? (
            <EmptyBox>{t('const.empty')}</EmptyBox>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className="font-mono">
                  v{constitution.version}
                </Badge>
                <Badge variant="secondary" className="font-mono text-[10px]">
                  {constitution.complexity.principles} {t('const.principles')}
                </Badge>
                <Badge variant="secondary" className="font-mono text-[10px]">
                  {constitution.complexity.historyEntries} {t('const.history')}
                </Badge>
              </div>
              <ul className="space-y-2 text-sm">
                {constitution.principles.map((p) => (
                  <li key={p.id} className="rounded-md border px-3 py-2">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-xs text-muted-foreground">
                        {p.id}
                      </span>
                      <span className="font-medium">{p.title}</span>
                    </div>
                    <p className="mt-1 text-muted-foreground">{p.statement}</p>
                  </li>
                ))}
              </ul>
              {constitution.history.length > 0 ? (
                <ul className="space-y-1 border-t pt-3 text-xs text-muted-foreground">
                  {constitution.history.map((h, i) => (
                    <li key={i} className="flex flex-wrap gap-x-2">
                      <span className="font-mono">v{h.version}</span>
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {h.bump}
                      </Badge>
                      <span>{h.at}</span>
                      {h.summary ? <span>· {h.summary}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('checklists.title')}</CardTitle>
          <CardDescription>
            {t('checklists.desc')}
            {chk.data?.truncated ? t('common.truncatedByApi') : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {checklists.length === 0 && malformed.length === 0 ? (
            <EmptyBox>{t('checklists.empty')}</EmptyBox>
          ) : (
            checklists.map((c) => (
              <div key={c.id} className="rounded-md border px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-medium">{c.title}</span>
                    <button
                      onClick={() => openTask(c.taskId)}
                      className="ml-2 font-mono text-[10px] text-muted-foreground underline-offset-2 hover:underline"
                    >
                      {t('checklists.task')} {c.taskId.slice(0, 8)}
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(['pass', 'fail', 'pending', 'na'] as const).map((s) =>
                      c.counts[s] > 0 ? (
                        <Badge
                          key={s}
                          variant="outline"
                          className={cn('font-mono text-[10px]', ITEM_TONE[s])}
                        >
                          {c.counts[s]} {te('check', s)}
                        </Badge>
                      ) : null,
                    )}
                  </div>
                </div>
                <ul className="mt-2 space-y-1 text-sm">
                  {c.items.map((it) => (
                    <li key={it.id} className="flex items-baseline gap-2">
                      <Badge
                        variant="outline"
                        className={cn('shrink-0 font-mono text-[10px]', ITEM_TONE[it.status])}
                      >
                        {it.id}
                      </Badge>
                      <span className="min-w-0 flex-1">
                        {it.text}
                        {it.note ? (
                          <span className="text-muted-foreground"> — {it.note}</span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
          {malformed.length > 0 ? (
            <div className="space-y-1 text-xs">
              <p className="font-medium text-destructive">
                {malformed.length} {t('common.malformedEntries')}
              </p>
              {malformed.map((m, i) => (
                <p key={i} className="font-mono text-muted-foreground">
                  {m.file}: {m.error.code}
                </p>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
