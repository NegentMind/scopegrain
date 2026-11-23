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
import { api } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useT } from '@/lib/i18n';
import { EmptyBox, ErrorBox, ListSkeleton } from '@/components/StatusBits';
import { cn } from '@/lib/utils';

const STATUS_TONE: Record<string, string> = {
  ok: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  'needs-attention':
    'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
};

export function ReportsView() {
  const t = useT();
  const [selected, setSelected] = useState<string | null>(null);
  const { data, loading, error, reload } = useApi(() => api.reports());
  const detail = useApi(
    () => (selected ? api.report(selected) : Promise.resolve(null)),
    [selected],
  );

  if (loading) return <ListSkeleton />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const reports = data?.reports ?? [];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{t('reports.title')}</CardTitle>
          <CardDescription>
            {t('reports.selectReport')}
            {data?.truncated ? t('common.truncatedByApi') : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {reports.length === 0 ? (
            <EmptyBox>{t('reports.empty')}</EmptyBox>
          ) : (
            <Table role="grid">
              <TableHeader>
                <TableRow>
                  <TableHead>{t('reports.file')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map((name) => (
                  <TableRow
                    key={name}
                    onClick={() => setSelected(name)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault(); // Space must not scroll the page
                        setSelected(name);
                      }
                    }}
                    tabIndex={0}
                    aria-selected={selected === name}
                    className={cn(
                      'cursor-pointer focus-visible:outline-ring',
                      selected === name && 'bg-accent',
                    )}
                  >
                    <TableCell className="font-mono text-xs">{name}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('reports.detail')}</CardTitle>
        </CardHeader>
        <CardContent>
          {!selected ? (
            <EmptyBox>{t('reports.selectReport')}</EmptyBox>
          ) : detail.loading ? (
            <ListSkeleton rows={4} />
          ) : detail.error ? (
            <ErrorBox error={detail.error} onRetry={detail.reload} />
          ) : detail.data ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Badge
                  variant="outline"
                  className={cn(
                    'font-mono',
                    STATUS_TONE[detail.data.report.status] ??
                      STATUS_TONE['needs-attention'],
                  )}
                >
                  {detail.data.report.status}
                </Badge>
                {detail.data.report.summary ? (
                  <span className="text-xs text-muted-foreground">
                    {t('common.ok')} {detail.data.report.summary.ok} ·{' '}
                    {t('common.warn')} {detail.data.report.summary.warnings} ·{' '}
                    {t('common.fail')} {detail.data.report.summary.failures}
                  </span>
                ) : null}
              </div>
              {Array.isArray(detail.data.report.checks) ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">{t('common.ok')}</TableHead>
                      <TableHead>{t('common.name')}</TableHead>
                      <TableHead>{t('reports.summary')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.data.report.checks.map((c) => (
                      <TableRow key={c.name}>
                        <TableCell className="font-mono">
                          {c.ok ? '✓' : '✗'}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {c.name}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {c.detail}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
