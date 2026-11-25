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
import {
  EmptyBox,
  ErrorBox,
  ListSkeleton,
  StateBadge,
} from '@/components/StatusBits';
import { toneClasses, type Tone } from '@/lib/tones';

const READINESS_TONE: Record<string, Tone> = {
  ready: 'ok',
  blocked: 'warn',
  active: 'info',
  closed: 'neutral',
};

export function PlansCard() {
  const t = useT();
  const { data, loading, error, reload } = useApi(() => api.plans(), [], 'plans');

  if (loading) return <ListSkeleton rows={2} />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const plans = data?.plans ?? [];

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle>{t('workspace.plans')}</CardTitle>
        <CardDescription>{t('plans.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {plans.length === 0 ? (
          <EmptyBox>{t('plans.empty')}</EmptyBox>
        ) : (
          plans.map((p) => (
            <div key={p.key} className="rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-medium">{p.key}</span>
                <span className="text-muted-foreground">{p.title}</span>
                <Badge variant="secondary">{p.taskCount} {t('plans.tasks')}</Badge>
              </div>
              {p.readiness ? (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {p.readiness.map((r) => (
                    <li
                      key={r.key}
                      className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs"
                    >
                      <span className="font-mono">{r.key}</span>
                      <StateBadge state={r.state} />
                      <Badge
                        variant="outline"
                        className={toneClasses(READINESS_TONE[r.status] ?? 'neutral').badge}
                      >
                        {r.status}
                      </Badge>
                      {r.blockedBy.length > 0 ? (
                        <span className="text-muted-foreground">
                          {t('plans.blockedBy')} {r.blockedBy.join(', ')}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-destructive">
                  {t('plans.readinessUnavailable')} {p.readinessError?.code}
                </p>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
