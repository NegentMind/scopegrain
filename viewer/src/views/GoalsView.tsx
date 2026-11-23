import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useT } from '@/lib/i18n';
import { openTask } from '@/lib/nav';
import { cn } from '@/lib/utils';
import {
  EmptyBox,
  ErrorBox,
  ListSkeleton,
  StateBadge,
} from '@/components/StatusBits';

const STATUS_TONE: Record<string, string> = {
  open: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30',
  achieved:
    'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  dropped:
    'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border-zinc-500/30',
};

export function GoalsView() {
  const t = useT();
  const { data, loading, error, reload } = useApi(() => api.goals());

  if (loading) return <ListSkeleton />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const goals = data?.goals ?? [];
  const malformed = data?.malformed ?? [];

  return (
    <div className="space-y-3">
      {goals.length === 0 && malformed.length === 0 ? (
        <EmptyBox>{t('goals.empty')}</EmptyBox>
      ) : (
        goals.map((g) => {
          const pct = g.progress;
          const pending = g.taskCount - g.tasksDone;
          return (
            <Card key={g.id}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="text-base">{g.title}</CardTitle>
                    {g.description ? (
                      <CardDescription className="mt-1 max-w-3xl">
                        {g.description}
                      </CardDescription>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge
                      variant="outline"
                      className={cn('font-mono', STATUS_TONE[g.status])}
                    >
                      {t(`goals.statuses.${g.status}`)}
                    </Badge>
                    {g.horizon ? (
                      <Badge variant="secondary" className="font-mono">
                        {t(`goals.horizons.${g.horizon}`)}
                      </Badge>
                    ) : null}
                    <Badge variant="secondary" className="font-mono text-[10px]">
                      {g.id.slice(0, 8)}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Progress bar + counts */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      {g.taskCount === 0
                        ? t('goals.noTasks')
                        : `${g.tasksDone}/${g.taskCount} ${t('goals.tasksDone')} · ${pending} ${t('goals.tasksPending')}`}
                    </span>
                    {pct !== null ? (
                      <span className="font-mono font-semibold">{pct}%</span>
                    ) : null}
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all',
                        pct === 100 ? 'bg-emerald-500' : 'bg-primary',
                      )}
                      style={{ width: `${pct ?? 0}%` }}
                    />
                  </div>
                </div>

                {/* Linked tasks */}
                {g.tasks.length > 0 ? (
                  <div className="space-y-1">
                    {g.tasks.map((tk) => (
                      <button
                        key={tk.id}
                        onClick={() => openTask(tk.id)}
                        className="flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-muted/60"
                      >
                        <StateBadge state={tk.state} />
                        <span className="min-w-0 flex-1 truncate">
                          {tk.title}
                        </span>
                        {tk.disposition ? (
                          <Badge variant="outline" className="font-mono text-[10px]">
                            {t(`disp.${tk.disposition.kind}`)}
                          </Badge>
                        ) : null}
                        {tk.priority ? (
                          <Badge variant="secondary" className="font-mono text-[10px]">
                            {tk.priority}
                          </Badge>
                        ) : null}
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {tk.id.slice(0, 8)}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {t('goals.noTasks')}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })
      )}
      {malformed.length > 0 ? (
        <div className="space-y-1 text-xs">
          <p className="font-medium text-destructive">
            {malformed.length} {t('common.malformedEntries')}
          </p>
          {malformed.map((m, i) => (
            <p key={i} className="font-mono text-muted-foreground">
              {m.line}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
