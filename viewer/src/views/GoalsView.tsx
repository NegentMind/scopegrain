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
import { api } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useT } from '@/lib/i18n';
import { EmptyBox, ErrorBox, ListSkeleton } from '@/components/StatusBits';
import { cn } from '@/lib/utils';

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
    <Card>
      <CardHeader>
        <CardTitle>{t('goals.title')}</CardTitle>
        <CardDescription>{t('metrics.derived')}</CardDescription>
      </CardHeader>
      <CardContent>
        {goals.length === 0 && malformed.length === 0 ? (
          <EmptyBox>{t('goals.empty')}</EmptyBox>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">{t('goals.status')}</TableHead>
                <TableHead>{t('common.title')}</TableHead>
                <TableHead className="hidden md:table-cell">
                  {t('goals.horizon')}
                </TableHead>
                <TableHead className="hidden lg:table-cell">
                  {t('goals.description')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {goals.map((g) => (
                <TableRow key={g.id}>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn('font-mono', STATUS_TONE[g.status])}
                    >
                      {g.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium">{g.title}</TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                    {g.horizon ?? t('common.none')}
                  </TableCell>
                  <TableCell className="hidden max-w-md truncate text-xs text-muted-foreground lg:table-cell">
                    {g.description ?? t('common.none')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {malformed.length > 0 ? (
          <div className="mt-4 space-y-1 text-xs">
            <p className="font-medium text-destructive">
              {malformed.length} malformed
              {t('common.malformedSuffix')}
            </p>
            {malformed.map((m, i) => (
              <p key={i} className="font-mono text-muted-foreground">
                {m.line}
              </p>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
