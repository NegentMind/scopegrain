import {
  Card,
  CardContent,
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
import { api } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { pct } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { EmptyBox, ErrorBox, ListSkeleton } from '@/components/StatusBits';

// pct() yields null for a 0 denominator — a 0/0 ratio renders '—', never
// a fake 100.0% (audit P2-11).
function fmtPct(v: number | null, none: string): string {
  return v === null ? none : `${v.toFixed(1)}%`;
}

function ms(v: number | null): string {
  if (v === null) return '—';
  if (v < 60_000) return `${(v / 1000).toFixed(0)}s`;
  if (v < 3_600_000) return `${(v / 60_000).toFixed(1)}m`;
  return `${(v / 3_600_000).toFixed(1)}h`;
}

function CountTable({
  title,
  rows,
}: {
  title: string;
  rows: [string, number][];
}) {
  if (rows.length === 0) return null;
  return (
    <section aria-label={title} className="space-y-2">
      <h3 className="text-sm font-medium">{title}</h3>
      <Table>
        <TableBody>
          {rows.map(([k, v]) => (
            <TableRow key={k}>
              <TableCell className="font-mono text-xs">{k}</TableCell>
              <TableCell className="w-20 text-right font-mono tabular-nums">{v}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

export function MetricsView() {
  const t = useT();
  const { data, loading, error, reload } = useApi(() => api.metrics());

  if (loading) return <ListSkeleton label={t('common.loading')} />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const m = data;
  const passPct = pct(
    m?.verification.passed ?? 0,
    m?.verification.checks ?? 0,
  );
  const firstTryPct = pct(
    m?.verification.firstTryPass ?? 0,
    m?.verification.firstTryTotal ?? 0,
  );

  const sorted = (rec: Record<string, number> | undefined) =>
    Object.entries(rec ?? {}).sort((a, b) => b[1] - a[1]);
  const skills = Object.entries(m?.skillOutcomes ?? {}).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        {/* No duplicated CardHeader: the view header already titles this
            card; only the derivation caveat stays, as a muted note. */}
        <CardContent className="space-y-6">
          <p className="text-xs text-muted-foreground">{t('metrics.derived')}</p>
          <p className="text-sm">
            {t('metrics.tasksTotal')}:{' '}
            <span className="font-mono font-semibold">
              {m?.tasks.total ?? 0}
            </span>
          </p>
          <CountTable title={t('metrics.byState')} rows={sorted(m?.tasks.byState)} />
          <CountTable
            title={t('metrics.byDisposition')}
            rows={sorted(m?.tasks.byDisposition)}
          />
          <CountTable
            title={t('metrics.byBacklog')}
            rows={sorted(m?.tasks.byBacklog)}
          />
          <CountTable title={t('metrics.byType')} rows={sorted(m?.tasks.byType)} />
          <CountTable
            title={t('metrics.byPriority')}
            rows={sorted(m?.tasks.byPriority)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('metrics.verification')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <Table>
            <TableBody>
              <TableRow>
                <TableCell>{t('metrics.passRate')}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {fmtPct(passPct, t('common.none'))}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {m?.verification.passed ?? 0}/{m?.verification.checks ?? 0}
                  </span>
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>{t('metrics.firstTry')}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {fmtPct(firstTryPct, t('common.none'))}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {m?.verification.firstTryPass ?? 0}/
                    {m?.verification.firstTryTotal ?? 0}
                  </span>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>

          <section aria-label={t('metrics.durations')} className="space-y-2">
            <h3 className="text-sm font-medium">{t('metrics.durations')}</h3>
            <Table>
              <TableBody>
                {(['p50', 'p95', 'p99'] as const).map((p) => (
                  <TableRow key={p}>
                    <TableCell className="font-mono">{p}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {ms(m?.durationMs[p] ?? null)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>

          <section
            aria-label={t('metrics.skillOutcomes')}
            className="space-y-2"
          >
            <h3 className="text-sm font-medium">
              {t('metrics.skillOutcomes')}
            </h3>
            {skills.length === 0 ? (
              <EmptyBox>{t('memory.empty')}</EmptyBox>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('metrics.skill')}</TableHead>
                    <TableHead className="w-16 text-right">{t('common.ok')}</TableHead>
                    <TableHead className="w-16 text-right">{t('common.fail')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {skills.map(([name, s]) => (
                    <TableRow key={name}>
                      <TableCell className="font-mono text-xs">
                        {name}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {s.ok}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {s.fail}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>
        </CardContent>
      </Card>
    </div>
  );
}
