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
import { api, type JournalOperationDetail } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import {
  EmptyBox,
  ErrorBox,
  JournalStateBadge,
  ListSkeleton,
  ShortId,
} from '@/components/StatusBits';
import { cn } from '@/lib/utils';

export function JournalView() {
  const [selected, setSelected] = useState<string | null>(null);
  const list = useApi(() => api.journalOperations());
  const detail = useApi<JournalOperationDetail | null>(
    () =>
      selected
        ? api.journalOperation(selected)
        : Promise.resolve(null),
    [selected],
  );

  if (list.loading) return <ListSkeleton />;
  if (list.error) return <ErrorBox error={list.error} onRetry={list.reload} />;
  const ops = list.data?.operations ?? [];
  const malformed = list.data?.malformed ?? [];

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Journal operations</CardTitle>
          <CardDescription>
            Create-only record operations; committed / prepared / abandoned.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {ops.length === 0 && malformed.length === 0 ? (
            <EmptyBox>No journal operations.</EmptyBox>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Op</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Events</TableHead>
                  <TableHead className="hidden md:table-cell">Kinds</TableHead>
                  <TableHead className="hidden md:table-cell">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ops.map((op) => (
                  <TableRow
                    key={op.operationId}
                    onClick={() => setSelected(op.operationId)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        setSelected(op.operationId);
                      }
                    }}
                    tabIndex={0}
                    aria-selected={selected === op.operationId}
                    className={cn(
                      'cursor-pointer focus-visible:outline-ring',
                      selected === op.operationId && 'bg-accent',
                    )}
                  >
                    <TableCell>
                      <ShortId id={op.operationId} />
                    </TableCell>
                    <TableCell>
                      <JournalStateBadge state={op.state} />
                    </TableCell>
                    <TableCell className="font-mono">{op.eventCount}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      {op.sourceKinds.map((k) => (
                        <Badge key={k} variant="secondary" className="mr-1">
                          {k}
                        </Badge>
                      ))}
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                      {op.createdAt.slice(0, 19).replace('T', ' ')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {malformed.length > 0 ? (
            <p className="mt-4 text-xs text-destructive">
              {malformed.length} malformed journal entr
              {malformed.length === 1 ? 'y' : 'ies'} surfaced.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="min-w-0 self-start">
        <CardHeader>
          <CardTitle>Operation events</CardTitle>
          <CardDescription>
            {selected ? <ShortId id={selected} /> : 'Select an operation'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!selected ? (
            <EmptyBox>Select an operation from the list.</EmptyBox>
          ) : detail.loading ? (
            <ListSkeleton rows={3} />
          ) : detail.error ? (
            <ErrorBox error={detail.error} onRetry={detail.reload} />
          ) : detail.data ? (
            <OperationPanel op={detail.data} />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function OperationPanel({ op }: { op: JournalOperationDetail }) {
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center gap-2">
        <JournalStateBadge state={op.state} />
        <span className="font-mono text-xs text-muted-foreground break-all">
          digest {op.intentDigest.slice(0, 16)}…
        </span>
      </div>
      <ol className="space-y-2">
        {op.intent.events.map((ev) => (
          <li key={ev.eventId} className="rounded-md border p-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="font-mono">
                seq {ev.journalSequence}
              </Badge>
              <span className="font-medium">
                {ev.sourceKind}/{ev.recordId.slice(0, 8)}
              </span>
              <span className="text-muted-foreground">{ev.operation}</span>
            </div>
            <p className="mt-1 break-all font-mono text-muted-foreground">
              {ev.sourceRel}
            </p>
            <p className="break-all font-mono text-muted-foreground">
              sha256 {ev.sourceHash.slice(0, 16)}…
            </p>
          </li>
        ))}
      </ol>
      {op.recovery ? (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Recovery receipt: {op.recovery.action} — {op.recovery.reason}
        </p>
      ) : null}
    </div>
  );
}
