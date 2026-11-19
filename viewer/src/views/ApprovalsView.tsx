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
import { useApi } from '@/lib/useApi';
import { useT } from '@/lib/i18n';
import { EmptyBox, ErrorBox, ListSkeleton } from '@/components/StatusBits';
import { usePoll } from '@/components/viz';
import { cn } from '@/lib/utils';

const TONE: Record<string, string> = {
  pending: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  approve: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  reject: 'bg-destructive/15 text-destructive border-destructive/30',
  decline: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border-zinc-500/30',
  revoke: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border-zinc-500/30',
};

function ApprovalDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT();
  const { data, loading, error, reload } = useApi(() => api.approval(id));
  if (loading) return <ListSkeleton />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const a = data?.approval;
  if (!a) return null;
  const answers = Array.isArray(a.answers) ? a.answers : [];
  return (
    <Card className="mt-4">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="font-mono text-sm">{a.id.slice(0, 16)}…</CardTitle>
          <CardDescription>
            {t('approvals.target')}: {a.target?.kind ?? '-'}
            {a.specId ? ` · spec ${a.specId.slice(0, 8)}` : ''}
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={onClose}>{t('common.close')}</Button>
      </CardHeader>
      <CardContent>
        {answers.length === 0 ? (
          <EmptyBox>{t('approvals.noAnswers')}</EmptyBox>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('approvals.answer')}</TableHead>
                <TableHead>{t('approvals.actor')}</TableHead>
                <TableHead>{t('common.at')}</TableHead>
                <TableHead>{t('approvals.rationale')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {answers.map((an, i) => (
                <TableRow key={i}>
                  <TableCell><Badge variant="outline">{an.answer}</Badge></TableCell>
                  <TableCell className="text-xs">{an.actor ?? '-'}</TableCell>
                  <TableCell className="font-mono text-xs">{an.at ?? '-'}</TableCell>
                  <TableCell className="text-xs">{an.rationale ?? '-'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {a.scope?.paths && a.scope.paths.length > 0 && (
          <div className="mt-3 text-xs text-muted-foreground">
            {t('approvals.scope')}: {a.scope.paths.join(', ')}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ApprovalsView() {
  const t = useT();
  const { data, loading, error, reload } = useApi(() => api.approvals());
  const [openId, setOpenId] = useState<string | null>(null);
  usePoll(reload);

  if (loading) return <ListSkeleton />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const approvals = data?.approvals ?? [];

  return (
    <div>
      <Card>
        <CardHeader>
          <CardTitle>{t('approvals.title')}</CardTitle>
          <CardDescription>{t('approvals.desc')}</CardDescription>
        </CardHeader>
        <CardContent>
          {approvals.length === 0 ? (
            <EmptyBox>{t('approvals.empty')}</EmptyBox>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">{t('approvals.status')}</TableHead>
                  <TableHead>{t('common.id')}</TableHead>
                  <TableHead>{t('approvals.target')}</TableHead>
                  <TableHead>{t('approvals.answers')}</TableHead>
                  <TableHead>{t('common.updatedAt')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {approvals.map((a) => (
                  <TableRow key={a.id} className="cursor-pointer"
                    onClick={() => setOpenId(openId === a.id ? null : a.id)}>
                    <TableCell>
                      <Badge variant="outline" className={cn(TONE[a.status] ?? '')}>
                        {a.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{a.id.slice(0, 12)}…</TableCell>
                    <TableCell className="text-xs">{a.target?.kind ?? '-'}</TableCell>
                    <TableCell>{a.answers}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{a.updatedAt}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {openId && <ApprovalDetail id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
