import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import {
  Alert, AlertDescription, AlertTitle,
} from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle } from 'lucide-react';
import { api, type ChecklistItemStatus } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useT, useTEnum } from '@/lib/i18n';
import { openTask } from '@/lib/nav';
import { toneClasses, type Tone } from '@/lib/tones';
import { cn } from '@/lib/utils';
import { TaskLinkRow } from '@/components/TaskLinkRow';
import {
  EmptyBox, ErrorBox, ListSkeleton,
} from '@/components/StatusBits';

// Checklist outcomes map onto the semantic triad: pass/fail/pending are
// results (color), n/a is inert (neutral). Shared via lib/tones, not a
// per-view palette.
const ITEM_TONE: Record<ChecklistItemStatus, Tone> = {
  pass: 'ok',
  fail: 'err',
  pending: 'warn',
  na: 'neutral',
};

export function StateView() {
  const t = useT();
  const te = useTEnum();
  const active = useApi(() => api.activeTask(), [], 'active-task');
  const cons = useApi(() => api.constitution(), [], 'constitution');
  const chk = useApi(() => api.checklists(), [], 'checklists');

  const activeData = active.data;
  const constitution = cons.data?.constitution ?? null;
  const checklists = chk.data?.checklists ?? [];
  const malformed = chk.data?.malformed ?? [];

  // Partial degradation (audit P1-01): a failed endpoint must only blank
  // its own card — a 404 on /api/active-task must not hide the
  // constitution or the checklists.
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('active.title')}</CardTitle>
          <CardDescription>{t('active.desc')}</CardDescription>
        </CardHeader>
        <CardContent>
          {active.loading ? (
            <ListSkeleton rows={1} label={t('common.loading')} />
          ) : active.error ? (
            <ErrorBox error={active.error} onRetry={active.reload} />
          ) : activeData?.error ? (
            <div className="text-xs text-destructive">
              {activeData.error.code}: {activeData.error.message}
            </div>
          ) : !activeData?.task ? (
            <EmptyBox>{t('active.none')}</EmptyBox>
          ) : (
            <TaskLinkRow
              id={activeData.task.id}
              state={activeData.task.state}
              title={activeData.task.title}
              className="flex-wrap px-3 py-2"
              meta={
                activeData.source ? (
                  <Badge variant="secondary" className="font-mono text-xs">
                    {t('active.source')}: {activeData.source}
                  </Badge>
                ) : null
              }
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('const.title')}</CardTitle>
          <CardDescription>{t('const.desc')}</CardDescription>
        </CardHeader>
        <CardContent>
          {cons.loading ? (
            <ListSkeleton rows={2} label={t('common.loading')} />
          ) : cons.error ? (
            <ErrorBox error={cons.error} onRetry={cons.reload} />
          ) : !constitution ? (
            <EmptyBox>{t('const.empty')}</EmptyBox>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className="font-mono">
                  v{constitution.version}
                </Badge>
                <Badge variant="secondary" className="font-mono text-xs">
                  {constitution.complexity.principles} {t('const.principles')}
                </Badge>
                <Badge variant="secondary" className="font-mono text-xs">
                  {constitution.complexity.historyEntries} {t('const.history')}
                </Badge>
              </div>
              <ul className="space-y-2 text-sm">
                {constitution.principles.map((p) => (
                  <li key={p.id} className="rounded-md border px-3 py-2">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-xs text-muted-foreground">
                        {p.id}
                      </span>
                      <span className="font-medium">{p.title}</span>
                    </div>
                    <p className="mt-1 text-muted-foreground">{p.statement}</p>
                  </li>
                ))}
              </ul>
              {constitution.history.length > 0 ? (
                <ul className="space-y-1 border-t pt-3 text-xs text-muted-foreground">
                  {constitution.history.map((h, i) => (
                    <li key={i} className="flex flex-wrap gap-x-2">
                      <span className="font-mono">v{h.version}</span>
                      <Badge variant="outline" className="font-mono text-xs">
                        {h.bump}
                      </Badge>
                      <span>{h.at}</span>
                      {h.summary ? <span>· {h.summary}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('checklists.title')}</CardTitle>
          <CardDescription>
            {t('checklists.desc')}
            {chk.data?.truncated ? t('common.truncatedByApi') : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {chk.loading ? (
            <ListSkeleton rows={2} label={t('common.loading')} />
          ) : chk.error ? (
            <ErrorBox error={chk.error} onRetry={chk.reload} />
          ) : (
            <>
              {checklists.length === 0 && malformed.length === 0 ? (
                <EmptyBox>{t('checklists.empty')}</EmptyBox>
              ) : (
                checklists.map((c) => (
                  <div key={c.id} className="rounded-md border px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <span className="font-medium">{c.title}</span>
                        <button
                          onClick={() => openTask(c.taskId)}
                          title={c.taskId}
                          className="ml-2 font-mono text-xs text-muted-foreground underline-offset-2 hover:underline"
                        >
                          {t('checklists.task')} {c.taskId.slice(0, 8)}
                        </button>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {(['pass', 'fail', 'pending', 'na'] as const).map((s) =>
                          c.counts[s] > 0 ? (
                            <Badge
                              key={s}
                              variant="outline"
                              className={cn('font-mono text-xs', toneClasses(ITEM_TONE[s]).badge)}
                            >
                              {c.counts[s]} {te('check', s)}
                            </Badge>
                          ) : null,
                        )}
                      </div>
                    </div>
                    <ul className="mt-2 space-y-1 text-sm">
                      {c.items.map((it) => (
                        <li key={it.id} className="flex items-baseline gap-2">
                          <Badge
                            variant="outline"
                            className={cn('shrink-0 font-mono text-xs', toneClasses(ITEM_TONE[it.status]).badge)}
                          >
                            {it.id}
                          </Badge>
                          <span className="min-w-0 flex-1">
                            {it.text}
                            {it.note ? (
                              <span className="text-muted-foreground"> — {it.note}</span>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
              {malformed.length > 0 ? (
                <Alert variant="destructive">
                  <AlertTriangle />
                  <AlertTitle>
                    {malformed.length} {t('common.malformedEntries')}
                  </AlertTitle>
                  <AlertDescription>
                    <ul className="space-y-0.5">
                      {malformed.map((m, i) => (
                        <li key={i} className="font-mono">
                          {m.file}: {m.error.code}
                        </li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
