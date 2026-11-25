import { useState } from 'react';
import {
  Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import type { SessionRecord } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useLocale, useT } from '@/lib/i18n';
import { EmptyBox, ErrorBox, ListSkeleton, StateBadge } from '@/components/StatusBits';
import {
  SelectableRow,
  useRovingTabindex,
} from '@/components/SelectableRow';
import { ProgressBar } from '@/components/ProgressBar';
import { fmtDateTime, fmtRel, shortHash } from '@/lib/format';
import { cn } from '@/lib/utils';
import { usePoll } from '@/components/viz';

function SessionDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT();
  const locale = useLocale();
  const { data, loading, error, reload } = useApi(() => api.session(id), [id], `session:${id}`);
  if (loading) return <ListSkeleton />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const s = data?.session as SessionRecord | undefined;
  const ctx = data?.resumeContext;
  if (!s) return null;
  return (
    <Card id="session-detail" className="mt-4">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="font-mono text-sm">{s.id}</CardTitle>
          <CardDescription>
            {t('sessions.task')}: <span className="font-mono">{shortHash(s.taskId)}</span>
            {ctx?.task ? ` · ${ctx.task.title}` : ''}
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={onClose}>{t('common.close')}</Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {ctx ? (
          <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-foreground">{t('sessions.contextTitle')}</span>
              <span className="font-mono tabular-nums text-muted-foreground">
                {t('sessions.budget')}: {ctx.budget.used}/{ctx.budget.limit} ({ctx.budget.remaining} {t('sessions.remaining')})
              </span>
            </div>
            <ProgressBar pct={ctx.budget.percent} label={t('sessions.budget')} />
            {ctx.tokenUsage && (ctx.tokenUsage.limit != null || ctx.tokenUsage.reported > 0) ? (
              <p className="font-mono tabular-nums text-muted-foreground">
                {t('sessions.tokens')}: {ctx.tokenUsage.reported}
                {ctx.tokenUsage.limit != null ? `/${ctx.tokenUsage.limit}` : ''}
                {ctx.tokenUsage.remaining != null ? ` (${ctx.tokenUsage.remaining} ${t('sessions.remaining')})` : ''}
                {' '}— {t('sessions.selfReported')}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">{t('sessions.linkedTask')}:</span>
              {ctx.task ? (
                <>
                  <StateBadge state={ctx.task.state} />
                  <span className="font-medium text-foreground">{ctx.task.title}</span>
                  <Badge variant="secondary" className="font-mono">rev {ctx.task.revision}</Badge>
                  {ctx.task.planKey ? <Badge variant="outline" className="font-mono">{t('sessions.ref.plan')}:{ctx.task.planKey}</Badge> : null}
                  {ctx.task.specId ? <Badge variant="outline" className="font-mono">{t('sessions.ref.spec')}:{shortHash(ctx.task.specId)}</Badge> : null}
                  {ctx.task.designId ? <Badge variant="outline" className="font-mono">{t('sessions.ref.design')}:{shortHash(ctx.task.designId)}</Badge> : null}
                </>
              ) : (
                <span className="text-muted-foreground">{t('sessions.taskMissing')}</span>
              )}
            </div>
            {ctx.lastEvent ? (
              <p className="text-muted-foreground">
                {t('sessions.lastAction')}: <span className="font-mono text-foreground">{ctx.lastEvent.action}</span>{' '}
                <span className="tabular-nums">({fmtDateTime(ctx.lastEvent.at, locale)})</span>
              </p>
            ) : null}
            <p className="text-muted-foreground">
              {t('sessions.resumeCmd')}:{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">
                {ctx.resumeCommand}
              </code>
            </p>
          </div>
        ) : null}
        {s.events.length === 0 ? (
          <EmptyBox>{t('sessions.noEvents')}</EmptyBox>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-40">{t('common.at')}</TableHead>
                <TableHead className="w-32">{t('sessions.action')}</TableHead>
                <TableHead>{t('sessions.evidence')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...s.events].reverse().map((ev, i) => (
                <TableRow key={i}>
                  <TableCell className="whitespace-nowrap font-mono tabular-nums text-xs">
                    {fmtDateTime(ev.at, locale)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{ev.action}</TableCell>
                  <TableCell className="text-xs">{ev.evidence}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export function SessionsView() {
  const t = useT();
  const locale = useLocale();
  const { data, loading, error, refreshing, reload } = useApi(() => api.sessions(), [], 'sessions');
  const [openId, setOpenId] = useState<string | null>(null);
  usePoll(reload);
  const roving = useRovingTabindex<HTMLTableSectionElement>();

  if (loading) return <ListSkeleton />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const sessions = data?.sessions ?? [];

  return (
    <div>
      <Card>
        <CardHeader>
          <CardTitle>{t('sessions.title')}</CardTitle>
          <CardAction>
            {/* Live revalidate indicator: pulses while a poll is in flight. */}
            <span
              aria-hidden="true"
              className={cn(
                'mt-1 block size-1.5 rounded-full bg-primary transition-opacity duration-300',
                refreshing ? 'animate-pulse opacity-100' : 'opacity-0',
              )}
            />
          </CardAction>
          <CardDescription>
            {t('sessions.desc')}
            {data?.truncated ? t('common.truncatedByApi') : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sessions.length === 0 ? (
            <EmptyBox>{t('sessions.empty')}</EmptyBox>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('common.id')}</TableHead>
                  <TableHead>{t('sessions.task')}</TableHead>
                  <TableHead>{t('sessions.events')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('sessions.used')}</TableHead>
                  <TableHead>{t('common.updatedAt')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody {...roving}>
                {sessions.map((s, i) => (
                  <SelectableRow
                    key={s.id}
                    selected={openId === s.id}
                    onSelect={() => setOpenId(openId === s.id ? null : s.id)}
                    tabIndex={openId === null && i === 0 ? 0 : undefined}
                    aria-expanded={openId === s.id}
                    aria-controls={openId === s.id ? 'session-detail' : undefined}
                    className="animate-in fade-in-50 duration-200"
                  >
                    <TableCell className="whitespace-nowrap font-mono text-xs">{shortHash(s.id)}</TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs">{shortHash(s.taskId)}</TableCell>
                    <TableCell className="tabular-nums">{s.events}</TableCell>
                    <TableCell className="hidden whitespace-nowrap font-mono tabular-nums text-xs md:table-cell">{s.used}/{s.limit}</TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums text-xs text-muted-foreground">
                      <span title={fmtDateTime(s.updatedAt, locale)}>
                        {fmtRel(s.updatedAt, locale)}
                      </span>
                    </TableCell>
                  </SelectableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {openId && (
        <div
          key={openId}
          className="animate-in fade-in-50 slide-in-from-right-1 duration-200"
        >
          <SessionDetail id={openId} onClose={() => setOpenId(null)} />
        </div>
      )}
    </div>
  );
}
