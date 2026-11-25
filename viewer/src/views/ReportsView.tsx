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
import {
  SelectableRow,
  useRovingTabindex,
} from '@/components/SelectableRow';
import { toneClasses, type Tone } from '@/lib/tones';
import { cn } from '@/lib/utils';

const STATUS_TONE: Record<string, Tone> = {
  ok: 'ok',
  'needs-attention': 'warn',
};

export function ReportsView() {
  const t = useT();
  const [selected, setSelected] = useState<string | null>(null);
  const { data, loading, error, reload } = useApi(() => api.reports());
  const detail = useApi(
    () => (selected ? api.report(selected) : Promise.resolve(null)),
    [selected],
  );
  const roving = useRovingTabindex<HTMLTableSectionElement>();

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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('reports.file')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody {...roving}>
                {reports.map((name, i) => (
                  <SelectableRow
                    key={name}
                    selected={selected === name}
                    onSelect={() => setSelected(name)}
                    tabIndex={selected === null && i === 0 ? 0 : undefined}
                  >
                    <TableCell className="font-mono text-xs">{name}</TableCell>
                  </SelectableRow>
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
            <div
              key={selected}
              className="animate-in fade-in-50 slide-in-from-right-1 space-y-4 duration-200"
            >
              <div className="flex items-center gap-3">
                <Badge
                  variant="outline"
                  className={cn(
                    'font-mono',
                    toneClasses(
                      STATUS_TONE[detail.data.report.status] ?? 'warn',
                    ).badge,
                  )}
                >
                  {detail.data.report.status}
                </Badge>
                {detail.data.report.summary ? (
                  <span className="text-xs tabular-nums text-muted-foreground">
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
