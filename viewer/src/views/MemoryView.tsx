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
import { Button } from '@/components/ui/button';
import {
  ToggleGroup,
  ToggleGroupItem,
} from '@/components/ui/toggle-group';
import {
  api,
  type GoalLinkedTask,
  type MemoryLogName,
} from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useT } from '@/lib/i18n';
import { openTask } from '@/lib/nav';
import {
  EmptyBox,
  ErrorBox,
  ListSkeleton,
  StateBadge,
} from '@/components/StatusBits';

const LOGS: MemoryLogName[] = [
  'lessons', 'outcomes', 'progress', 'activity', 'goals',
];

function at(e: Record<string, unknown>): string {
  return typeof e.at === 'string' ? e.at.slice(0, 19).replace('T', ' ') : '';
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

// Render a memory entry as structured columns instead of a JSON blob:
// each log keeps its own shape, so the table headers follow the log.
export function MemoryView() {
  const t = useT();
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
          <GoalsTable entries={entries} />
        ) : (
          <EntriesTable log={log} entries={entries} />
        )}
        {malformed.length > 0 ? (
          <div className="mt-4 space-y-1 text-xs">
            <p className="font-medium text-destructive">
              {malformed.length} malformed
              {t('common.malformedSuffix')}
            </p>
            {malformed.map((m, i) => (
              <p key={i} className="font-mono text-muted-foreground">
                {m.line}
              </p>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function EntriesTable({
  log,
  entries,
}: {
  log: MemoryLogName;
  entries: Record<string, unknown>[];
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
            <TableCell className="font-mono text-xs text-muted-foreground">
              {at(e)}
            </TableCell>
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
                  {str(e.taskId)?.slice(0, 8) ?? ''}
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={
                      str(e.outcome) === 'ok'
                        ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
                        : 'border-red-500/40 text-red-600 dark:text-red-400'
                    }
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

// Goal entries rendered as rows of structured data + their linked tasks.
function GoalsTable({ entries }: { entries: Record<string, unknown>[] }) {
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
        {entries.map((e, i) => {
          const tasks = Array.isArray(e.tasks)
            ? (e.tasks as GoalLinkedTask[])
            : [];
          return (
            <TableRow key={i}>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {at(e)}
              </TableCell>
              <TableCell>
                <div className="space-y-1">
                  <p className="text-sm font-medium">{str(e.title) ?? ''}</p>
                  {str(e.description) ? (
                    <p className="text-xs text-muted-foreground">
                      {str(e.description)}
                    </p>
                  ) : null}
                  {tasks.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {tasks.map((tk) => (
                        <Button
                          key={tk.id}
                          variant="ghost"
                          size="sm"
                          className="h-6 gap-1 px-1.5 text-xs"
                          onClick={() => openTask(tk.id)}
                        >
                          <StateBadge state={tk.state} />
                          <span className="max-w-48 truncate">{tk.title}</span>
                        </Button>
                      ))}
                    </div>
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
          );
        })}
      </TableBody>
    </Table>
  );
}
