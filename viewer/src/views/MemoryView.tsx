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
import {
  ToggleGroup,
  ToggleGroupItem,
} from '@/components/ui/toggle-group';
import {
  api,
  type MemoryLogName,
} from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useLocale, useT, type Locale } from '@/lib/i18n';
import {
  EmptyBox,
  ErrorBox,
  ListSkeleton,
} from '@/components/StatusBits';
import { MalformedNote } from '@/components/MalformedNote';
import { fmtDateTime, shortHash } from '@/lib/format';
import { toneClasses } from '@/lib/tones';
import { cn } from '@/lib/utils';

const LOGS: MemoryLogName[] = [
  'lessons', 'outcomes', 'progress', 'activity', 'goals',
];

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

// Render a memory entry as structured columns instead of a JSON blob:
// each log keeps its own shape, so the table headers follow the log.
export function MemoryView() {
  const t = useT();
  const locale = useLocale();
  const [log, setLog] = useState<MemoryLogName>('lessons');
  const { data, loading, error, reload } = useApi(
    () => api.memory(log),
    [log],
  );

  if (loading) return <ListSkeleton />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const entries = data?.entries ?? [];
  const malformed = data?.malformed ?? [];

  const goalsView = log === 'goals';

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>{t('memory.title')}</CardTitle>
            <CardDescription>
              {entries.length} {t('memory.entries')}
            </CardDescription>
          </div>
          <ToggleGroup
            type="single"
            variant="outline"
            spacing={0}
            size="sm"
            value={log}
            onValueChange={(v) => v && setLog(v as MemoryLogName)}
            aria-label={t('memory.log')}
          >
            {LOGS.map((l) => (
              <ToggleGroupItem key={l} value={l}>
                {l}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </CardHeader>
      <CardContent>
        {entries.length === 0 && malformed.length === 0 ? (
          <EmptyBox>{t('memory.empty')}</EmptyBox>
        ) : goalsView ? (
          <GoalsTable entries={entries} locale={locale} />
        ) : (
          <EntriesTable log={log} entries={entries} locale={locale} />
        )}
        <MalformedNote
          count={malformed.length}
          details={malformed.map((m) => m.line)}
        />
      </CardContent>
    </Card>
  );
}

function At({ value, locale }: { value: unknown; locale: Locale }) {
  const iso = str(value);
  return (
    <TableCell className="whitespace-nowrap font-mono tabular-nums text-xs text-muted-foreground">
      {iso ? fmtDateTime(iso, locale) : ''}
    </TableCell>
  );
}

function EntriesTable({
  log,
  entries,
  locale,
}: {
  log: MemoryLogName;
  entries: Record<string, unknown>[];
  locale: Locale;
}) {
  const t = useT();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-40">{t('memory.at')}</TableHead>
          {log === 'lessons' ? (
            <>
              <TableHead className="w-32">{t('memory.topic')}</TableHead>
              <TableHead>{t('memory.text')}</TableHead>
              <TableHead className="w-48">{t('memory.ref')}</TableHead>
            </>
          ) : log === 'outcomes' ? (
            <>
              <TableHead className="w-28">{t('memory.task')}</TableHead>
              <TableHead className="w-24">{t('memory.outcome')}</TableHead>
              <TableHead>{t('memory.skills')}</TableHead>
            </>
          ) : (
            <>
              <TableHead className="w-32">{t('memory.action')}</TableHead>
              <TableHead>{t('memory.detail')}</TableHead>
            </>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((e, i) => (
          <TableRow key={i}>
            <At value={e.at} locale={locale} />
            {log === 'lessons' ? (
              <>
                <TableCell>
                  {str(e.topic) ? (
                    <Badge variant="secondary" className="font-mono text-xs">
                      {str(e.topic)}
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell className="text-sm">{str(e.text) ?? ''}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {str(e.ref) ?? ''}
                </TableCell>
              </>
            ) : log === 'outcomes' ? (
              <>
                <TableCell className="font-mono text-xs">
                  {str(e.taskId) ? shortHash(str(e.taskId)!) : ''}
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={cn(
                      str(e.outcome) === 'ok'
                        ? toneClasses('ok').badge
                        : toneClasses('err').badge,
                    )}
                  >
                    {str(e.outcome) ?? ''}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {Array.isArray(e.skills)
                    ? (e.skills as unknown[]).join(', ')
                    : str(e.detail) ?? ''}
                </TableCell>
              </>
            ) : (
              <>
                <TableCell>
                  {(str(e.action) ?? str(e.kind)) ? (
                    <Badge variant="secondary" className="font-mono text-xs">
                      {str(e.action) ?? str(e.kind)}
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell className="text-sm">
                  {str(e.text) ?? str(e.detail) ?? str(e.summary)
                    ?? str(e.title) ?? ''}
                </TableCell>
              </>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// Goal entries rendered as rows of structured data. The memory endpoint
// returns the raw goals worklog (id/title/description/status/horizon/
// metrics) — the linked-task join only exists on api.goals(), which is
// what GoalsView consumes.
function GoalsTable({
  entries,
  locale,
}: {
  entries: Record<string, unknown>[];
  locale: Locale;
}) {
  const t = useT();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-40">{t('memory.at')}</TableHead>
          <TableHead>{t('common.title')}</TableHead>
          <TableHead className="w-24">{t('goals.status')}</TableHead>
          <TableHead className="w-24">{t('goals.horizon')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((e, i) => (
          <TableRow key={i}>
            <At value={e.at} locale={locale} />
            <TableCell>
              <div className="space-y-1">
                <p className="text-sm font-medium">{str(e.title) ?? ''}</p>
                {str(e.description) ? (
                  <p className="text-xs text-muted-foreground">
                    {str(e.description)}
                  </p>
                ) : null}
              </div>
            </TableCell>
            <TableCell>
              <Badge variant="outline">{str(e.status) ?? ''}</Badge>
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {str(e.horizon) ?? ''}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
