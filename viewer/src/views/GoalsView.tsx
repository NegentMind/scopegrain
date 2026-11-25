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
import { cn } from '@/lib/utils';
import {
  EmptyBox,
  ErrorBox,
  ListSkeleton,
} from '@/components/StatusBits';
import { ProgressBar } from '@/components/ProgressBar';
import { TaskLinkRow } from '@/components/TaskLinkRow';
import { MalformedNote } from '@/components/MalformedNote';
import { shortHash } from '@/lib/format';
import { toneClasses, type Tone } from '@/lib/tones';

const STATUS_TONE: Record<string, Tone> = {
  open: 'info',
  achieved: 'ok',
  dropped: 'neutral',
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
          const progress = g.progress;
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
                      className={cn(
                        'font-mono',
                        toneClasses(STATUS_TONE[g.status] ?? 'neutral').badge,
                      )}
                    >
                      {t(`goals.statuses.${g.status}`)}
                    </Badge>
                    {g.horizon ? (
                      <Badge variant="secondary" className="font-mono">
                        {t(`goals.horizons.${g.horizon}`)}
                      </Badge>
                    ) : null}
                    <Badge variant="secondary" className="font-mono text-[10px]">
                      {shortHash(g.id)}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Progress bar + counts */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="tabular-nums text-muted-foreground">
                      {g.taskCount === 0
                        ? t('goals.noTasks')
                        : `${g.tasksDone}/${g.taskCount} ${t('goals.tasksDone')} · ${pending} ${t('goals.tasksPending')}`}
                    </span>
                    {progress !== null ? (
                      <span className="font-mono tabular-nums font-semibold">{progress}%</span>
                    ) : null}
                  </div>
                  <ProgressBar pct={progress} label={g.title} />
                </div>

                {/* Linked tasks */}
                {g.tasks.length > 0 ? (
                  <div className="space-y-1">
                    {g.tasks.map((tk) => (
                      <TaskLinkRow
                        key={tk.id}
                        id={tk.id}
                        state={tk.state}
                        title={tk.title}
                        meta={
                          <>
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
                          </>
                        }
                      />
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
      <MalformedNote
        count={malformed.length}
        details={malformed.map((m) => m.line)}
        className="mt-0"
      />
    </div>
  );
}
