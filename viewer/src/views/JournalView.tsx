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
import {
  SelectableRow,
  useRovingTabindex,
} from '@/components/SelectableRow';
import { MalformedNote } from '@/components/MalformedNote';
import { fmtDateTime, fmtRel, shortHash } from '@/lib/format';
import { useLocale, useT } from '@/lib/i18n';

export function JournalView() {
  const t = useT();
  const locale = useLocale();
  const [selected, setSelected] = useState<string | null>(null);
  const list = useApi(() => api.journalOperations(), [], 'journal-ops');
  const detail = useApi<JournalOperationDetail | null>(
    () =>
      selected
        ? api.journalOperation(selected)
        : Promise.resolve(null),
    [selected],
  );
  const roving = useRovingTabindex<HTMLTableSectionElement>();

  if (list.loading) return <ListSkeleton />;
  if (list.error) return <ErrorBox error={list.error} onRetry={list.reload} />;
  const ops = list.data?.operations ?? [];
  const malformed = list.data?.malformed ?? [];

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>{t('journal.operations')}</CardTitle>
          <CardDescription>
            {t('journal.desc')}
            {list.data?.truncated ? t('common.truncatedByApi') : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {ops.length === 0 && malformed.length === 0 ? (
            <EmptyBox>{t('journal.empty')}</EmptyBox>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">{t('common.op')}</TableHead>
                  <TableHead>{t('common.state')}</TableHead>
                  <TableHead>{t('journal.events')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('common.kinds')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('common.created')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody {...roving}>
                {ops.map((op, i) => (
                  <SelectableRow
                    key={op.operationId}
                    selected={selected === op.operationId}
                    onSelect={() => setSelected(op.operationId)}
                    tabIndex={selected === null && i === 0 ? 0 : undefined}
                    className="animate-in fade-in-50 duration-200"
                  >
                    <TableCell className="whitespace-nowrap">
                      <ShortId id={op.operationId} />
                    </TableCell>
                    <TableCell>
                      <JournalStateBadge state={op.state} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono tabular-nums">
                      {op.eventCount}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {op.sourceKinds.map((k) => (
                        <Badge key={k} variant="secondary" className="mr-1">
                          {k}
                        </Badge>
                      ))}
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap tabular-nums text-xs text-muted-foreground md:table-cell">
                      <span title={fmtDateTime(op.createdAt, locale)}>
                        {fmtRel(op.createdAt, locale)}
                      </span>
                    </TableCell>
                  </SelectableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <MalformedNote count={malformed.length} />
        </CardContent>
      </Card>

      <Card className="min-w-0 self-start">
        <CardHeader>
          <CardTitle>{t('journal.opEvents')}</CardTitle>
          <CardDescription>
            {selected ? <ShortId id={selected} /> : t('journal.selectOperation')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!selected ? (
            <EmptyBox title={t('journal.selectOperation')}>
              {t('journal.selectPromptFull')}
            </EmptyBox>
          ) : detail.loading ? (
            <ListSkeleton rows={3} />
          ) : detail.error ? (
            <ErrorBox error={detail.error} onRetry={detail.reload} />
          ) : detail.data ? (
            <div
              key={selected}
              className="animate-in fade-in-50 slide-in-from-right-1 duration-200"
            >
              <OperationPanel op={detail.data} />
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function OperationPanel({ op }: { op: JournalOperationDetail }) {
  const t = useT();
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center gap-2">
        <JournalStateBadge state={op.state} />
        <span className="break-all font-mono text-xs text-muted-foreground">
          {t('journal.digest')} {shortHash(op.intentDigest)}…
        </span>
      </div>
      <ol className="space-y-2">
        {op.intent.events.map((ev) => (
          <li key={ev.eventId} className="rounded-md border p-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="font-mono tabular-nums">
                {t('journal.seq')} {ev.journalSequence}
              </Badge>
              <span className="font-medium">
                {ev.sourceKind}/{shortHash(ev.recordId)}
              </span>
              <span className="text-muted-foreground">{ev.operation}</span>
            </div>
            <p className="mt-1 break-all font-mono text-muted-foreground">
              {ev.sourceRel}
            </p>
            <p className="break-all font-mono text-muted-foreground">
              {t('journal.sha256')} {shortHash(ev.sourceHash)}…
            </p>
          </li>
        ))}
      </ol>
      {op.recovery ? (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {t('journal.recovery')}: {op.recovery.action} — {op.recovery.reason}
        </p>
      ) : null}
    </div>
  );
}
