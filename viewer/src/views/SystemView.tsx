import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useT } from '@/lib/i18n';
import { EmptyBox, ErrorBox, ListSkeleton } from '@/components/StatusBits';
import { LifecycleFunnel, usePoll } from '@/components/viz';
import { cn } from '@/lib/utils';

export function SystemView() {
  const t = useT();
  const vdb = useApi(() => api.vantadb());
  const wf = useApi(() => api.workflow());
  const vc = useApi(() => api.verify());
  const ws = useApi(() => api.workspace());
  usePoll(() => { vdb.reload(); vc.reload(); ws.reload(); });

  if (vdb.loading || wf.loading || vc.loading || ws.loading) return <ListSkeleton />;
  if (vdb.error) return <ErrorBox error={vdb.error} onRetry={vdb.reload} />;
  if (wf.error) return <ErrorBox error={wf.error} onRetry={wf.reload} />;
  if (vc.error) return <ErrorBox error={vc.error} onRetry={vc.reload} />;
  if (ws.error) return <ErrorBox error={ws.error} onRetry={ws.reload} />;

  const v = vdb.data?.vantadb;
  const policy = wf.data?.workflow;
  const commands = vc.data?.commands ?? [];
  const counts = ws.data?.counts.tasksByState ?? {};

  const ownerRows: Array<[string, string]> = [
    ['init', t('system.ownerInit')],
    ['doctor', t('system.ownerDoctor')],
    ['investigate --diff', t('system.ownerDiff')],
    ['structure scan/status', t('system.ownerStructure')],
    ['view', t('system.ownerView')],
    ['verify approve + verify run', t('system.ownerVerify')],
    ['approval answer', t('system.ownerApproval')],
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('system.owner')}</CardTitle>
          <CardDescription>{t('system.ownerDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="space-y-1.5 text-sm">
            {ownerRows.map(([cmd, desc]) => (
              <li key={cmd} className="flex flex-wrap items-baseline gap-x-3">
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                  {cmd}
                </code>
                <span className="text-muted-foreground">{desc}</span>
              </li>
            ))}
          </ul>
          <p className="border-t pt-3 text-xs text-muted-foreground">
            {t('system.ownerBounds')}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('system.lifecycle')}</CardTitle>
          <CardDescription>{t('system.lifecycleDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          {policy && (
            <LifecycleFunnel workflow={policy} counts={counts}
              labels={{ pipeline: t('system.pipeline'), side: t('system.side') }} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('system.vantadb')}</CardTitle>
          <CardDescription>{t('system.vantadbDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          {!v?.configured ? (
            <EmptyBox>{t('system.vantadbOff')}</EmptyBox>
          ) : (
            <div className="space-y-2 text-sm">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">v{v.config?.version}</Badge>
                <Badge variant="outline" className={cn(v.binaryPresent
                  ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
                  : 'border-destructive/40 text-destructive')}>
                  {v.binaryPresent ? t('system.binaryOk') : t('system.binaryMissing')}
                </Badge>
                <Badge variant="outline" className={cn(v.storagePresent
                  ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
                  : 'border-destructive/40 text-destructive')}>
                  {v.storagePresent ? t('system.storageOk') : t('system.storageMissing')}
                </Badge>
                <Badge variant="outline">
                  {t('system.pending')}: {v.pendingCommittedEvents ?? '-'}
                </Badge>
              </div>
              <div className="font-mono text-xs text-muted-foreground">
                {v.config?.binaryPath}
              </div>
              {(v.warnings ?? []).map((w, i) => (
                <div key={i} className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
                  {w.signal}: {w.detail}
                </div>
              ))}
              {v.error && (
                <div className="text-xs text-destructive">
                  {v.error.code}: {v.error.message}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('system.verify')}</CardTitle>
          <CardDescription>{vc.data?.store}</CardDescription>
        </CardHeader>
        <CardContent>
          {commands.length === 0 ? (
            <EmptyBox>{t('system.verifyEmpty')}</EmptyBox>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">{t('system.approved')}</TableHead>
                  <TableHead>{t('system.command')}</TableHead>
                  <TableHead className="w-24">{t('system.source')}</TableHead>
                  <TableHead className="w-28">{t('system.cwd')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {commands.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Badge variant="outline" className={cn(c.approved
                        ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
                        : 'border-amber-500/40 text-amber-600 dark:text-amber-400')}>
                        {c.approved ? t('common.yes') : t('common.no')}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{c.command}</TableCell>
                    <TableCell className="text-xs">{c.source}</TableCell>
                    <TableCell className="font-mono text-xs">{c.cwd}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
