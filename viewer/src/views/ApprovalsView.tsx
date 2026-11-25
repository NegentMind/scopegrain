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
import { fmtRel } from '@/lib/format';
import { useLocale, useT, useTEnum } from '@/lib/i18n';
import { EmptyBox, ErrorBox, ListSkeleton, ShortId } from '@/components/StatusBits';
import { RefreshDot } from '@/components/ViewSection';
import { usePoll } from '@/components/viz';
import { toneClasses, type Tone } from '@/lib/tones';
import { cn } from '@/lib/utils';

const TONE: Record<string, Tone> = {
  pending: 'warn',
  approve: 'ok',
  reject: 'err',
  decline: 'neutral',
  revoke: 'neutral',
};

function ApprovalDetail({
  id,
  regionId,
  onClose,
}: {
  id: string;
  /** DOM id wired to the row's aria-controls. */
  regionId: string;
  onClose: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const { data, loading, error, reload } = useApi(() => api.approval(id), [id]);
  if (loading) return <ListSkeleton label={t('common.loading')} />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const a = data?.approval;
  if (!a) return null;
  const answers = Array.isArray(a.answers) ? a.answers : [];
  return (
    <Card id={regionId} className="mt-4">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="font-mono text-sm">
            <ShortId id={a.id} />
          </CardTitle>
          <CardDescription>
            {t('approvals.target')}: {a.target?.kind ?? t('common.none')}
            {a.specId ? ` · ${t('tasks.spec')} ${a.specId.slice(0, 8)}` : ''}
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
                  <TableCell className="text-xs">{an.actor ?? t('common.none')}</TableCell>
                  <TableCell className="font-mono text-xs" title={an.at}>
                    {an.at ? fmtRel(an.at, locale) : t('common.none')}
                  </TableCell>
                  <TableCell className="text-xs">{an.rationale ?? t('common.none')}</TableCell>
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
  const te = useTEnum();
  const locale = useLocale();
  const { data, loading, error, reload, refreshing } = useApi(() => api.approvals());
  const [openId, setOpenId] = useState<string | null>(null);
  usePoll(reload);

  if (loading) return <ListSkeleton label={t('common.loading')} />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const approvals = data?.approvals ?? [];

  return (
    <div>
      <Card>
        {/* No duplicated CardHeader (audit P2-07): the view header above
            already shows title + description. */}
        <CardContent>
          <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
            <RefreshDot active={refreshing} />
            {data?.truncated ? t('common.truncatedByApi').trim() : null}
          </div>
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
                  <TableRow key={a.id} className="cursor-pointer focus-visible:outline-2 focus-visible:outline-ring"
                    tabIndex={0}
                    aria-expanded={openId === a.id}
                    aria-controls={openId === a.id ? `approval-detail-${a.id}` : undefined}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault(); // Space must not scroll the page
                        setOpenId(openId === a.id ? null : a.id);
                      }
                    }}
                    onClick={() => setOpenId(openId === a.id ? null : a.id)}>
                    <TableCell>
                      <Badge variant="outline" className={cn(toneClasses(TONE[a.status] ?? 'neutral').badge)}>
                        {te('appr', a.status)}
                      </Badge>
                    </TableCell>
                    <TableCell><ShortId id={a.id} /></TableCell>
                    <TableCell className="text-xs">{a.target?.kind ?? t('common.none')}</TableCell>
                    <TableCell className="tabular-nums">{a.answers}</TableCell>
                    <TableCell className="text-xs text-muted-foreground" title={a.updatedAt}>
                      {fmtRel(a.updatedAt, locale)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {openId && (
        <ApprovalDetail
          id={openId}
          regionId={`approval-detail-${openId}`}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}
