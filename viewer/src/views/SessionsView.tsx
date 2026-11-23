import { useState } from 'react';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import type { SessionRecord } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useT } from '@/lib/i18n';
import { EmptyBox, ErrorBox, ListSkeleton, StateBadge } from '@/components/StatusBits';
import { usePoll } from '@/components/viz';

function SessionDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT();
  const { data, loading, error, reload } = useApi(() => api.session(id), [id]);
  if (loading) return <ListSkeleton />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const s = data?.session as SessionRecord | undefined;
  const ctx = data?.resumeContext;
  if (!s) return null;
  return (
    <Card className="mt-4">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="font-mono text-sm">{s.id}</CardTitle>
          <CardDescription>
            {t('sessions.task')}: <span className="font-mono">{s.taskId.slice(0, 8)}</span>
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
              <span className="font-mono text-muted-foreground">
                {t('sessions.budget')}: {ctx.budget.used}/{ctx.budget.limit} ({ctx.budget.remaining} {t('sessions.remaining')})
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${ctx.budget.percent}%` }}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">{t('sessions.linkedTask')}:</span>
              {ctx.task ? (
                <>
                  <StateBadge state={ctx.task.state} />
                  <span className="font-medium text-foreground">{ctx.task.title}</span>
                  <Badge variant="secondary" className="font-mono">rev {ctx.task.revision}</Badge>
                  {ctx.task.planKey ? <Badge variant="outline" className="font-mono">plan:{ctx.task.planKey}</Badge> : null}
                  {ctx.task.specId ? <Badge variant="outline" className="font-mono">spec:{ctx.task.specId.slice(0, 8)}</Badge> : null}
                  {ctx.task.designId ? <Badge variant="outline" className="font-mono">design:{ctx.task.designId.slice(0, 8)}</Badge> : null}
                </>
              ) : (
                <span className="text-muted-foreground">{t('sessions.taskMissing')}</span>
              )}
            </div>
            {ctx.lastEvent ? (
              <p className="text-muted-foreground">
                {t('sessions.lastAction')}: <span className="font-mono text-foreground">{ctx.lastEvent.action}</span>{' '}
                ({ctx.lastEvent.at.slice(0, 19).replace('T', ' ')})
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
                  <TableCell className="font-mono text-xs">{ev.at}</TableCell>
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
  const { data, loading, error, reload } = useApi(() => api.sessions());
  const [openId, setOpenId] = useState<string | null>(null);
  usePoll(reload);

  if (loading) return <ListSkeleton />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const sessions = data?.sessions ?? [];

  return (
    <div>
      <Card>
        <CardHeader>
          <CardTitle>{t('sessions.title')}</CardTitle>
          <CardDescription>{t('sessions.desc')}</CardDescription>
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
                  <TableHead>{t('sessions.used')}</TableHead>
                  <TableHead>{t('common.updatedAt')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((s) => (
                  <TableRow key={s.id} className="cursor-pointer focus-visible:outline-ring"
                    tabIndex={0}
                    aria-expanded={openId === s.id}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        setOpenId(openId === s.id ? null : s.id);
                      }
                    }}
                    onClick={() => setOpenId(openId === s.id ? null : s.id)}>
                    <TableCell className="font-mono text-xs">{s.id.slice(0, 8)}</TableCell>
                    <TableCell className="font-mono text-xs">{s.taskId.slice(0, 8)}</TableCell>
                    <TableCell>{s.events}</TableCell>
                    <TableCell className="font-mono text-xs">{s.used}/{s.limit}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{s.updatedAt}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {openId && <SessionDetail id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
