import { useState } from 'react';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import type { SessionRecord } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useT } from '@/lib/i18n';
import { EmptyBox, ErrorBox, ListSkeleton } from '@/components/StatusBits';
import { usePoll } from '@/components/viz';

function SessionDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT();
  const { data, loading, error, reload } = useApi(() => api.session(id));
  if (loading) return <ListSkeleton />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const s = data?.session as SessionRecord | undefined;
  if (!s) return null;
  return (
    <Card className="mt-4">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="font-mono text-sm">{s.id}</CardTitle>
          <CardDescription>
            {t('sessions.task')}: <span className="font-mono">{s.taskId.slice(0, 8)}</span>
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={onClose}>{t('common.close')}</Button>
      </CardHeader>
      <CardContent>
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
