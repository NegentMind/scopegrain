import { useMemo, useState } from 'react';
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
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api, type TaskDetail, type TaskSummary } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import {
  EmptyBox,
  ErrorBox,
  ListSkeleton,
  ShortId,
  StateBadge,
} from '@/components/StatusBits';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { usePoll } from '@/components/viz';

const DISPOSITION_TONE: Record<string, string> = {
  deferred: 'border-amber-500/40 text-amber-600 dark:text-amber-400',
  icebox: 'border-sky-500/40 text-sky-600 dark:text-sky-400',
  future: 'border-violet-500/40 text-violet-600 dark:text-violet-400',
  discarded: 'border-zinc-500/40 text-zinc-500',
  cancelled: 'border-destructive/40 text-destructive',
};

const ALL_VALUE = '__all__';

function FilterSelect({
  label, value, options, onChange,
}: {
  label: string; value: string; options: string[]; onChange: (v: string) => void;
}) {
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
          <SelectItem key={o} value={o}>{o}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function TasksView() {
  const t = useT();
  const [selected, setSelected] = useState<string | null>(null);
  const [fState, setFState] = useState('');
  const [fBacklog, setFBacklog] = useState('');
  const [fPriority, setFPriority] = useState('');
  const [fType, setFType] = useState('');
  const [fDisposition, setFDisposition] = useState('');
  const [q, setQ] = useState('');
  const list = useApi(() => api.tasks(500));
  usePoll(list.reload);
  const detail = useApi<TaskDetail | null>(
    () => (selected ? api.task(selected).then((r) => r.task) : Promise.resolve(null)),
    [selected],
  );

  const all = list.data?.tasks ?? [];
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
    <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>{t('tasks.title')}</CardTitle>
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
              options={opts.state} onChange={setFState} />
            <FilterSelect label={t('tasks.backlog')} value={fBacklog}
              options={opts.backlog} onChange={setFBacklog} />
            <FilterSelect label={t('tasks.priority')} value={fPriority}
              options={opts.priority} onChange={setFPriority} />
            <FilterSelect label={t('tasks.type')} value={fType}
              options={opts.type} onChange={setFType} />
            <FilterSelect label={t('tasks.disposition')} value={fDisposition}
              options={opts.disposition} onChange={setFDisposition} />
          </div>
        </CardHeader>
        <CardContent>
          {tasks.length === 0 && malformed.length === 0 ? (
            <EmptyBox>{t('tasks.empty')}</EmptyBox>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">{t('common.id')}</TableHead>
                  <TableHead>{t('common.title')}</TableHead>
                  <TableHead>{t('common.state')}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t('tasks.badges')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('common.updated')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((task) => (
                  <TableRow
                    key={task.id}
                    onClick={() => setSelected(task.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') setSelected(task.id);
                    }}
                    tabIndex={0}
                    aria-selected={selected === task.id}
                    className={cn(
                      'cursor-pointer focus-visible:outline-ring',
                      selected === task.id && 'bg-accent',
                    )}
                  >
                    <TableCell>
                      <ShortId id={task.id} />
                    </TableCell>
                    <TableCell className="font-medium">
                      {task.title}
                      {task.planKey ? (
                        <Badge variant="secondary" className="ml-2 font-mono">
                          {task.planKey}
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <StateBadge state={task.state} />
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <span className="flex flex-wrap gap-1">
                        {task.priority && (
                          <Badge variant="outline" className="font-mono">{task.priority}</Badge>
                        )}
                        {task.disposition && (
                          <Badge variant="outline"
                            className={cn(DISPOSITION_TONE[task.disposition.kind] ?? '')}>
                            {task.disposition.kind}
                          </Badge>
                        )}
                        {task.backlog && (
                          <Badge variant="secondary" className="font-mono">{task.backlog}</Badge>
                        )}
                        {task.stepsTotal > 0 && (
                          <Badge variant="secondary">{task.stepsDone}/{task.stepsTotal}</Badge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                      {task.updatedAt.slice(0, 19).replace('T', ' ')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {malformed.length > 0 ? (
            <div className="mt-4 space-y-1 text-xs">
              <p className="font-medium text-destructive">
                {malformed.length} {t('common.malformedEntries')}
              </p>
              {malformed.map((m) => (
                <p key={m.file} className="font-mono text-muted-foreground">
                  {m.file}: {m.error.code}
                </p>
              ))}
            </div>
          ) : null}
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
            <EmptyBox>{t('tasks.selectPrompt')}</EmptyBox>
          ) : detail.loading ? (
            <ListSkeleton rows={3} />
          ) : detail.error ? (
            <ErrorBox error={detail.error} onRetry={detail.reload} />
          ) : detail.data ? (
            <TaskDetailPanel task={detail.data} onSelect={setSelected} />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section aria-label={label}>
      <h4 className="mb-1 text-xs font-medium uppercase text-muted-foreground">
        {label}
      </h4>
      {children}
    </section>
  );
}

function TaskDetailPanel({
  task, onSelect,
}: { task: TaskDetail; onSelect: (id: string) => void }) {
  const t = useT();
  const relEntries = Object.entries(task.relations ?? {})
    .filter(([, ids]) => ids.length > 0);
  const analysis = task.analysis ?? null;
  const analysisFields = analysis
    ? (['blastRadius', 'impact', 'debt', 'debugEvidence', 'security',
        'performance'] as const).filter((k) => analysis[k])
    : [];
  return (
    <div className="space-y-4 text-sm">
      <div>
        <h3 className="text-base font-semibold">{task.title}</h3>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <StateBadge state={task.state} />
          <Badge variant="secondary">rev {task.revision}</Badge>
          <Badge variant="secondary">v{task.schemaVersion}</Badge>
          {task.priority && <Badge variant="outline" className="font-mono">{task.priority}</Badge>}
          {task.severity && <Badge variant="outline">{task.severity}</Badge>}
          {task.type && <Badge variant="outline">{task.type}</Badge>}
          {task.effort && <Badge variant="outline">{task.effort}</Badge>}
          {task.disposition && (
            <Badge variant="outline"
              className={cn(DISPOSITION_TONE[task.disposition.kind] ?? '')}>
              {task.disposition.kind}
            </Badge>
          )}
          {task.backlog && <Badge variant="secondary" className="font-mono">{task.backlog}</Badge>}
          {task.uncertainty && (
            <Badge variant="outline" className="border-amber-500/40 text-amber-600 dark:text-amber-400">
              {task.uncertainty}
            </Badge>
          )}
        </div>
      </div>

      {task.disposition && (
        <Field label={t('tasks.disposition')}>
          <p className="text-xs text-muted-foreground">
            {task.disposition.reason ?? ''}
            {task.disposition.by ? ` · ${task.disposition.by}` : ''}
            {task.disposition.at
              ? ` · ${task.disposition.at.slice(0, 10)}`
              : ''}
          </p>
        </Field>
      )}

      <Field label={t('tasks.contract')}>
        <p className="whitespace-pre-wrap break-words">{task.contract}</p>
        {task.contractTruncated ? (
          <p className="text-xs text-muted-foreground">{t('common.truncatedByApi')}</p>
        ) : null}
      </Field>

      {(task.dependsOn?.length ?? 0) > 0 && (
        <Field label={t('tasks.dependsOn')}>
          <div className="flex flex-wrap gap-1">
            {task.dependsOn!.map((id) => (
              <Button key={id} variant="outline" size="sm"
                className="h-6 px-1.5 font-mono text-xs"
                onClick={() => onSelect(id)}>
                {id.slice(0, 8)}
              </Button>
            ))}
          </div>
        </Field>
      )}

      {relEntries.length > 0 && (
        <Field label={t('tasks.relations')}>
          <div className="space-y-1">
            {relEntries.map(([kind, ids]) => (
              <div key={kind} className="flex flex-wrap items-center gap-1">
                <Badge variant="secondary" className="font-mono text-[10px]">{kind}</Badge>
                {ids.map((id) => (
                  <Button key={id} variant="outline" size="sm"
                    className="h-6 px-1.5 font-mono text-xs"
                    onClick={() => onSelect(id)}>
                    {id.slice(0, 8)}
                  </Button>
                ))}
              </div>
            ))}
          </div>
        </Field>
      )}

      {(task.goalIds?.length ?? 0) > 0 && (
        <Field label={t('tasks.goals')}>
          <div className="flex flex-wrap gap-1">
            {task.goalIds!.map((id) => (
              <Badge key={id} variant="outline" className="font-mono">{id.slice(0, 8)}</Badge>
            ))}
          </div>
        </Field>
      )}

      {(task.steps?.length ?? 0) > 0 && (
        <Field label={t('tasks.steps')}>
          <ol className="space-y-0.5">
            {task.steps!.map((s, i) => (
              <li key={i} className="flex items-center gap-2 text-xs">
                <span className={cn(
                  'inline-block h-2 w-2 rounded-full',
                  s.status === 'done' && 'bg-emerald-500',
                  s.status === 'skipped' && 'bg-zinc-500',
                  s.status === 'pending' && 'bg-amber-500',
                )} />
                <span className={cn(s.status === 'skipped' && 'line-through')}>{s.text}</span>
              </li>
            ))}
          </ol>
        </Field>
      )}

      {analysisFields.length > 0 && (
        <Field label={t('tasks.analysis')}>
          <dl className="space-y-1 text-xs">
            {analysisFields.map((k) => (
              <div key={k}>
                <dt className="font-mono text-muted-foreground">{k}</dt>
                <dd className="whitespace-pre-wrap break-words">{String(analysis![k])}</dd>
              </div>
            ))}
            {analysis!.invariants && analysis!.invariants.length > 0 && (
              <div>
                <dt className="font-mono text-muted-foreground">invariants</dt>
                <dd><ul className="list-inside list-disc">
                  {analysis!.invariants.map((iv, i) => <li key={i}>{iv}</li>)}
                </ul></dd>
              </div>
            )}
          </dl>
        </Field>
      )}

      {(task.skills?.length ?? 0) > 0 && (
        <Field label={t('tasks.skills')}>
          <div className="flex flex-wrap gap-1">
            {task.skills!.map((s) => (
              <Badge key={s} variant="secondary" className="font-mono text-[10px]">{s}</Badge>
            ))}
          </div>
        </Field>
      )}

      {(task.notes?.length ?? 0) > 0 && (
        <Field label={t('tasks.notes')}>
          <ul className="space-y-0.5 text-xs">
            {task.notes!.map((n, i) => {
              const note = typeof n === 'string' ? { text: n } : n;
              return (
                <li key={i}>
                  {typeof note.at === 'string' && (
                    <span className="font-mono text-muted-foreground">
                      {note.at.slice(0, 10)}{' '}
                    </span>
                  )}
                  {typeof note.by === 'string' && (
                    <span className="text-muted-foreground">[{note.by}] </span>
                  )}
                  {note.text}
                </li>
              );
            })}
          </ul>
        </Field>
      )}

      <Field label={t('tasks.authorContext')}>
        <p className="whitespace-pre-wrap break-words">{task.authorContext}</p>
      </Field>

      {task.scope.length > 0 ? (
        <Field label={t('tasks.scope')}>
          <ul className="list-inside list-disc font-mono text-xs">
            {task.scope.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </Field>
      ) : null}

      <Field label={t('tasks.history')}>
        <ol className="space-y-1 border-l-2 border-border pl-3">
          {task.history.map((h, i) => (
            <li key={i} className="text-xs">
              <span className="font-mono text-muted-foreground">
                {h.at.slice(0, 19).replace('T', ' ')}
              </span>{' '}
              {h.event}
              {h.state ? <StateBadge state={h.state} /> : null}
            </li>
          ))}
        </ol>
      </Field>
    </div>
  );
}
