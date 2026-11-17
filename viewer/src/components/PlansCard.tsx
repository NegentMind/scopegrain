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
import {
  EmptyBox,
  ErrorBox,
  ListSkeleton,
  StateBadge,
} from '@/components/StatusBits';

const READINESS_TONE: Record<string, string> = {
  ready:
    'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  blocked:
    'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  active:
    'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30',
  closed: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border-zinc-500/30',
};

export function PlansCard() {
  const { data, loading, error, reload } = useApi(() => api.plans());

  if (loading) return <ListSkeleton rows={2} />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const plans = data?.plans ?? [];

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle>Plans</CardTitle>
        <CardDescription>
          Dependency DAGs with readiness from current task state.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {plans.length === 0 ? (
          <EmptyBox>No plans recorded.</EmptyBox>
        ) : (
          plans.map((p) => (
            <div key={p.key} className="rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-medium">{p.key}</span>
                <span className="text-muted-foreground">{p.title}</span>
                <Badge variant="secondary">{p.taskCount} tasks</Badge>
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
                        className={READINESS_TONE[r.status]}
                      >
                        {r.status}
                      </Badge>
                      {r.blockedBy.length > 0 ? (
                        <span className="text-muted-foreground">
                          blocked by {r.blockedBy.join(', ')}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-destructive">
                  readiness unavailable: {p.readinessError?.code}
                </p>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
