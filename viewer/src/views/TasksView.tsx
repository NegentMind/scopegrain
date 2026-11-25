import { useEffect, useMemo, useState } from 'react';
import {
  Card,
  CardAction,
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
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { api, type TaskDetail, type TaskSummary } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import {
  EmptyBox,
  ErrorBox,
  ListSkeleton,
  ShortId,
  StateBadge,
} from '@/components/StatusBits';
import {
  SelectableRow,
  useRovingTabindex,
} from '@/components/SelectableRow';
import { MalformedNote } from '@/components/MalformedNote';
import {
  DISPOSITION_TONE,
  TaskDetailPanel,
} from '@/components/TaskDetailPanel';
import { fmtDateTime, fmtRel } from '@/lib/format';
import { toneClasses } from '@/lib/tones';
import { cn } from '@/lib/utils';
import { useLocale, useT, useTEnum } from '@/lib/i18n';
import { usePoll } from '@/components/viz';
import { consumeTaskRequest } from '@/lib/nav';

const ALL_VALUE = '__all__';

function FilterSelect({
  label, value, options, onChange, i18nPrefix,
}: {
  label: string; value: string; options: string[];
  onChange: (v: string) => void; i18nPrefix?: string;
}) {
  const t = useT();
  const label_ = (o: string) => {
    if (!i18nPrefix) return o;
    const tr = t(`${i18nPrefix}.${o}`);
    return tr === `${i18nPrefix}.${o}` ? o : tr;
  };
  return (
    <Select
      value={value === '' ? ALL_VALUE : value}
      onValueChange={(v) => onChange(v === ALL_VALUE ? '' : v)}
    >
      <SelectTrigger size="sm" className="w-auto min-w-24" aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_VALUE}>{label}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o} value={o}>{label_(o)}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function TasksView() {
  const t = useT();
  const te = useTEnum();
  const locale = useLocale();
  const [selected, setSelected] = useState<string | null>(null);
  const [fState, setFState] = useState('');
  const [fBacklog, setFBacklog] = useState('');
  const [fPriority, setFPriority] = useState('');
  const [fType, setFType] = useState('');
  const [fDisposition, setFDisposition] = useState('');
  const [q, setQ] = useState('');

  // Cross-view intent (goals/plans link straight into a task detail).
  useEffect(() => {
    const requested = consumeTaskRequest();
    if (requested) setSelected(requested);
  }, []);
  const list = useApi(() => api.tasks(500), [], 'tasks:500');
  usePoll(list.reload);
  const detail = useApi<TaskDetail | null>(
    () => (selected ? api.task(selected).then((r) => r.task) : Promise.resolve(null)),
    [selected],
  );
  const roving = useRovingTabindex<HTMLTableSectionElement>();

  const all = useMemo(() => list.data?.tasks ?? [], [list.data?.tasks]);
  const opts = useMemo(() => {
    const uniq = (k: keyof TaskSummary) =>
      [...new Set(all.map((x) => x[k]).filter((v): v is string => typeof v === 'string'))].sort();
    return {
      state: uniq('state'), backlog: uniq('backlog'), priority: uniq('priority'),
      type: uniq('type'),
      disposition: [...new Set(
        all.map((x) => x.disposition?.kind)
          .filter((v): v is string => typeof v === 'string'),
      )].sort(),
    };
  }, [all]);

  const tasks = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((x) =>
      (!fState || x.state === fState)
      && (!fBacklog || x.backlog === fBacklog)
      && (!fPriority || x.priority === fPriority)
      && (!fType || x.type === fType)
      && (!fDisposition || x.disposition?.kind === fDisposition)
      && (!needle || x.title.toLowerCase().includes(needle)
        || x.id.toLowerCase().includes(needle)));
  }, [all, fState, fBacklog, fPriority, fType, fDisposition, q]);

  if (list.loading) return <ListSkeleton />;
  if (list.error) return <ErrorBox error={list.error} onRetry={list.reload} />;
  const malformed = list.data?.malformed ?? [];

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>{t('tasks.title')}</CardTitle>
          <CardAction>
            {/* Live revalidate indicator: pulses while a poll is in flight. */}
            <span
              aria-hidden="true"
              className={cn(
                'mt-1 block size-1.5 rounded-full bg-primary transition-opacity duration-300',
                list.refreshing ? 'animate-pulse opacity-100' : 'opacity-0',
              )}
            />
          </CardAction>
          <CardDescription>
            {tasks.length}/{all.length} {t('tasks.count')}
            {list.data?.truncated ? t('common.truncatedByApi') : ''}
          </CardDescription>
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('tasks.filter')}
              className="w-44"
              aria-label={t('tasks.filter')}
            />
            <FilterSelect label={t('common.state')} value={fState}
              options={opts.state} onChange={setFState} i18nPrefix="state" />
            <FilterSelect label={t('tasks.backlog')} value={fBacklog}
              options={opts.backlog} onChange={setFBacklog} />
            <FilterSelect label={t('tasks.priority')} value={fPriority}
              options={opts.priority} onChange={setFPriority} />
            <FilterSelect label={t('tasks.type')} value={fType}
              options={opts.type} onChange={setFType} i18nPrefix="type" />
            <FilterSelect label={t('tasks.disposition')} value={fDisposition}
              options={opts.disposition} onChange={setFDisposition} i18nPrefix="disp" />
          </div>
        </CardHeader>
        <CardContent>
          {tasks.length === 0 && malformed.length === 0 ? (
            <EmptyBox>{t('tasks.empty')}</EmptyBox>
          ) : (
            <ScrollArea className="w-full">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">{t('common.id')}</TableHead>
                    <TableHead className="min-w-44">{t('common.title')}</TableHead>
                    <TableHead>{t('common.state')}</TableHead>
                    <TableHead className="hidden md:table-cell">{t('tasks.priority')}</TableHead>
                    <TableHead className="hidden md:table-cell">{t('tasks.type')}</TableHead>
                    <TableHead className="hidden 2xl:table-cell">{t('tasks.effort')}</TableHead>
                    <TableHead className="hidden 2xl:table-cell">{t('tasks.backlog')}</TableHead>
                    <TableHead className="hidden 2xl:table-cell">{t('tasks.disposition')}</TableHead>
                    <TableHead className="hidden 2xl:table-cell">{t('tasks.deps')}</TableHead>
                    <TableHead className="hidden 2xl:table-cell">{t('tasks.steps')}</TableHead>
                    <TableHead className="hidden text-right 2xl:table-cell">{t('common.updated')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody {...roving}>
                  {tasks.map((task, i) => (
                    <SelectableRow
                      key={task.id}
                      selected={selected === task.id}
                      onSelect={() => setSelected(task.id)}
                      tabIndex={selected === null && i === 0 ? 0 : undefined}
                      className="animate-in fade-in-50 duration-200"
                    >
                      <TableCell className="whitespace-nowrap">
                        <ShortId id={task.id} />
                      </TableCell>
                      <TableCell className="max-w-56 font-medium">
                        <span className="block truncate" title={task.title}>
                          {task.title}
                        </span>
                        {task.planKey ? (
                          <Badge variant="secondary" className="mt-0.5 font-mono text-2xs">
                            {task.planKey}
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <StateBadge state={task.state} />
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {task.priority ? (
                          <Badge variant="outline" className="font-mono">{task.priority}</Badge>
                        ) : t('common.none')}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-xs">
                        {task.type ? te('type', task.type) : t('common.none')}
                      </TableCell>
                      <TableCell className="hidden 2xl:table-cell text-xs">
                        {task.effort ?? t('common.none')}
                      </TableCell>
                      <TableCell className="hidden 2xl:table-cell">
                        {task.backlog ? (
                          <Badge variant="secondary" className="font-mono">{task.backlog}</Badge>
                        ) : t('common.none')}
                      </TableCell>
                      <TableCell className="hidden 2xl:table-cell">
                        {task.disposition ? (
                          <Badge variant="outline"
                            className={cn(toneClasses(DISPOSITION_TONE[task.disposition.kind] ?? 'neutral').badge)}>
                            {t(`disp.${task.disposition.kind}`)}
                          </Badge>
                        ) : t('common.none')}
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap tabular-nums 2xl:table-cell text-xs">
                        {task.dependsOn.length > 0 ? task.dependsOn.length : t('common.none')}
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap tabular-nums 2xl:table-cell text-xs">
                        {task.stepsTotal > 0
                          ? `${task.stepsDone}/${task.stepsTotal}`
                          : t('common.none')}
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap tabular-nums text-right text-xs text-muted-foreground 2xl:table-cell">
                        <span title={fmtDateTime(task.updatedAt, locale)}>
                          {fmtRel(task.updatedAt, locale)}
                        </span>
                      </TableCell>
                    </SelectableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
          <MalformedNote
            count={malformed.length}
            details={malformed.map((m) => `${m.file}: ${m.error.code}`)}
          />
        </CardContent>
      </Card>

      <Card className="min-w-0 self-start">
        <CardHeader>
          <CardTitle>{t('tasks.detail')}</CardTitle>
          <CardDescription>
            {selected ? <ShortId id={selected} /> : t('tasks.selectTask')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!selected ? (
            <EmptyBox title={t('tasks.selectTask')}>
              {t('tasks.selectPrompt')}
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
              <TaskDetailPanel task={detail.data} onSelect={setSelected} />
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
