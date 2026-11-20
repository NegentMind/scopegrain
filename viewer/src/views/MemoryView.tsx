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
import { api, type MemoryLogName } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useT } from '@/lib/i18n';
import { EmptyBox, ErrorBox, ListSkeleton } from '@/components/StatusBits';

const LOGS: MemoryLogName[] = ['lessons', 'outcomes', 'progress', 'goals'];

function summarize(entry: Record<string, unknown>): string {
  const pick = entry.title ?? entry.summary ?? entry.taskId ?? entry.outcome;
  if (typeof pick === 'string') return pick;
  try {
    const s = JSON.stringify(entry);
    return s.length > 140 ? `${s.slice(0, 137)}…` : s;
  } catch {
    return '';
  }
}

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
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-44">{t('memory.at')}</TableHead>
                <TableHead>{t('memory.detail')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e, i) => (
                <TableRow key={i}>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {typeof e.at === 'string'
                      ? e.at.slice(0, 19).replace('T', ' ')
                      : t('common.none')}
                  </TableCell>
                  <TableCell className="text-sm">
                    <Badge variant="secondary" className="mr-2 font-mono">
                      {typeof e.outcome === 'string'
                        ? e.outcome
                        : typeof e.status === 'string'
                          ? e.status
                          : log}
                    </Badge>
                    {summarize(e)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
