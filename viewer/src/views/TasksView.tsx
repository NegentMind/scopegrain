import { useEffect, useMemo, useState } from 'react';
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChevronDown } from 'lucide-react';
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
import { consumeTaskRequest } from '@/lib/nav';
import { Markdown } from '@/components/Markdown';

const DISPOSITION_TONE: Record<string, string> = {
  deferred: 'border-amber-500/40 text-amber-600 dark:text-amber-400',
  icebox: 'border-sky-500/40 text-sky-600 dark:text-sky-400',
  future: 'border-violet-500/40 text-violet-600 dark:text-violet-400',
  discarded: 'border-zinc-500/40 text-zinc-500',
  cancelled: 'border-destructive/40 text-destructive',
};

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
  const list = useApi(() => api.tasks(500));
  usePoll(list.reload);
  const detail = useApi<TaskDetail | null>(
    () => (selected ? api.task(selected).then((r) => r.task) : Promise.resolve(null)),
    [selected],
  );

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
              options={opts.type} onChange={setFType} />
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
                    <TableHead className="min-w-48">{t('common.title')}</TableHead>
                    <TableHead>{t('common.state')}</TableHead>
                    <TableHead className="hidden md:table-cell">{t('tasks.priority')}</TableHead>
                    <TableHead className="hidden md:table-cell">{t('tasks.type')}</TableHead>
                    <TableHead className="hidden lg:table-cell">{t('tasks.effort')}</TableHead>
                    <TableHead className="hidden lg:table-cell">{t('tasks.backlog')}</TableHead>
                    <TableHead className="hidden xl:table-cell">{t('tasks.disposition')}</TableHead>
                    <TableHead className="hidden xl:table-cell">{t('tasks.deps')}</TableHead>
                    <TableHead className="hidden 2xl:table-cell">{t('tasks.steps')}</TableHead>
                    <TableHead className="hidden text-right md:table-cell">{t('common.updated')}</TableHead>
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
                        'cursor-pointer whitespace-nowrap focus-visible:outline-ring',
                        selected === task.id && 'bg-accent',
                      )}
                    >
                      <TableCell>
                        <ShortId id={task.id} />
                      </TableCell>
                      <TableCell className="max-w-72 font-medium">
                        <span className="block truncate" title={task.title}>
                          {task.title}
                        </span>
                        {task.planKey ? (
                          <Badge variant="secondary" className="mt-0.5 font-mono text-[10px]">
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
                        {task.type ?? t('common.none')}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-xs">
                        {task.effort ?? t('common.none')}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {task.backlog ? (
                          <Badge variant="secondary" className="font-mono">{task.backlog}</Badge>
                        ) : t('common.none')}
                      </TableCell>
                      <TableCell className="hidden xl:table-cell">
                        {task.disposition ? (
                          <Badge variant="outline"
                            className={cn(DISPOSITION_TONE[task.disposition.kind] ?? '')}>
                            {t(`disp.${task.disposition.kind}`)}
                          </Badge>
                        ) : t('common.none')}
                      </TableCell>
                      <TableCell className="hidden xl:table-cell text-xs">
                        {task.dependsOn.length > 0 ? task.dependsOn.length : t('common.none')}
                      </TableCell>
                      <TableCell className="hidden 2xl:table-cell text-xs">
                        {task.stepsTotal > 0
                          ? `${task.stepsDone}/${task.stepsTotal}`
                          : t('common.none')}
                      </TableCell>
                      <TableCell className="hidden text-right text-xs text-muted-foreground md:table-cell">
                        {task.updatedAt.slice(0, 10)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
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

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-2">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="break-words">{v}</dd>
    </div>
  );
}

interface MethodologyShape {
  request?: string;
  intent?: string;
  authorization?: { status?: string; actor?: string; reference?: string } | null;
  understanding?: string;
  uncertainty?: string;
  risk?: string;
  riskCategories?: string[];
  continuity?: string;
  evidence?: string[];
  preferredRoute?: string;
}

function TaskDocSection({ id }: { id: string }) {
  const t = useT();
  const doc = useApi(() => api.taskDoc(id), [id]);
  if (doc.loading) return <ListSkeleton rows={2} />;
  if (doc.error) return null;
  if (!doc.data?.doc) {
    return <p className="text-xs text-muted-foreground">{t('tasks.docMissing')}</p>;
  }
  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ChevronDown className="size-3.5 transition-transform group-data-[state=closed]:-rotate-90" />
        {doc.data.bytes} B · {doc.data.updatedAt?.slice(0, 10)}
        {doc.data.docTruncated ? ` ${t('common.truncatedByApi')}` : ''}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 max-h-96 overflow-auto rounded-md border bg-muted/40 p-3">
          <Markdown>{doc.data.doc}</Markdown>
        </div>
      </CollapsibleContent>
    </Collapsible>
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
  const m = (task.methodology ?? null) as MethodologyShape | null;
  const verification = task.verification as {
    status?: string;
    checks?: { command?: string; cwd?: string; status?: string;
      evidence?: string }[];
  } | null;
  const review = task.review as {
    verdict?: string; mode?: string; owner?: string;
    reference?: string; reason?: string;
  } | null;
  const uncertainty = task.uncertainty;
  const uncertaintyObj = uncertainty !== null && typeof uncertainty === 'object'
    ? uncertainty : null;
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
              {t(`disp.${task.disposition.kind}`)}
            </Badge>
          )}
          {task.backlog && <Badge variant="secondary" className="font-mono">{task.backlog}</Badge>}
          {uncertaintyObj && (
            <Badge variant="outline" className="border-amber-500/40 text-amber-600 dark:text-amber-400">
              {t('tasks.uncertainty')}: {uncertaintyObj.uphill ?? 0}↑ {uncertaintyObj.downhill ?? 0}↓
            </Badge>
          )}
        </div>
      </div>

      <Field label={t('tasks.context')}>
        <dl className="space-y-1 text-xs">
          <KV k={t('tasks.route')} v={task.methodologyRoute ?? m?.preferredRoute ?? t('common.none')} />
          {task.planKey ? <KV k={t('tasks.plan')} v={<span className="font-mono">{task.planKey}</span>} /> : null}
          {task.specId ? <KV k={t('tasks.spec')} v={<span className="font-mono">{task.specId.slice(0, 8)}</span>} /> : null}
          {task.designId ? <KV k={t('tasks.design')} v={<span className="font-mono">{task.designId.slice(0, 8)}</span>} /> : null}
          {task.source ? <KV k={t('tasks.source')} v={task.source} /> : null}
          {task.estimate ? (
            <KV k={t('tasks.estimate')} v={
              [
                task.estimate.turns !== undefined ? `${task.estimate.turns} ${t('tasks.turns')}` : null,
                task.estimate.appetite ? `${t('tasks.appetite')}: ${task.estimate.appetite}` : null,
              ].filter(Boolean).join(' · ')
            } />
          ) : null}
          {(task.scenarioRefs?.length ?? 0) > 0 ? (
            <KV k={t('tasks.scenarios')} v={
              task.scenarioRefs!.map((s) => `${s.requirementId}/${s.scenarioId}`).join(', ')
            } />
          ) : null}
        </dl>
      </Field>

      {m && (
        <Field label={t('tasks.context') + ' — methodology'}>
          <dl className="space-y-1 text-xs">
            {m.request ? <KV k={t('tasks.request')} v={m.request} /> : null}
            {m.intent ? <KV k={t('tasks.intent')} v={m.intent} /> : null}
            {m.authorization ? (
              <KV k={t('tasks.authorization')} v={
                [m.authorization.status, m.authorization.actor, m.authorization.reference]
                  .filter(Boolean).join(' · ')
              } />
            ) : null}
            {m.understanding ? <KV k={t('tasks.understanding')} v={m.understanding} /> : null}
            {m.uncertainty ? <KV k={t('tasks.uncertainty')} v={m.uncertainty} /> : null}
            {m.risk ? <KV k={t('tasks.risk')} v={
              [m.risk, ...(m.riskCategories ?? [])].filter(Boolean).join(' · ')
            } /> : null}
            {m.continuity ? <KV k={t('tasks.continuity')} v={m.continuity} /> : null}
            {(m.evidence?.length ?? 0) > 0 ? (
              <KV k={t('tasks.evidence')} v={
                <ul className="list-inside list-disc">
                  {m.evidence!.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              } />
            ) : null}
          </dl>
        </Field>
      )}

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
          <ol className="space-y-1.5">
            {task.steps!.map((s, i) => (
              <li key={i} className="text-xs">
                <div className="flex items-center gap-2">
                  <span className={cn(
                    'inline-block h-2 w-2 shrink-0 rounded-full',
                    s.status === 'done' && 'bg-emerald-500',
                    s.status === 'skipped' && 'bg-zinc-500',
                    s.status === 'pending' && 'bg-amber-500',
                  )} />
                  <span className={cn(s.status === 'skipped' && 'line-through')}>
                    {s.name ?? s.text}
                  </span>
                </div>
                {(s.action || s.verify || (s.files?.length ?? 0) > 0) && (
                  <dl className="ml-4 mt-0.5 space-y-0.5 text-[11px] text-muted-foreground">
                    {s.action ? <KV k={t('tasks.stepAction')} v={s.action} /> : null}
                    {s.verify ? <KV k={t('tasks.stepVerify')} v={<span className="font-mono">{s.verify}</span>} /> : null}
                    {(s.files?.length ?? 0) > 0 ? (
                      <KV k={t('tasks.stepFiles')} v={
                        <span className="font-mono">{s.files!.join(', ')}</span>
                      } />
                    ) : null}
                  </dl>
                )}
              </li>
            ))}
          </ol>
        </Field>
      )}

      {verification?.checks && verification.checks.length > 0 && (
        <Field label={t('tasks.verification')}>
          <ul className="space-y-1.5 text-xs">
            {verification.checks.map((c, i) => (
              <li key={i}>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={cn(
                    'font-mono text-[10px]',
                    c.status === 'pass'
                      ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
                      : 'border-destructive/40 text-destructive',
                  )}>{c.status}</Badge>
                  <span className="font-mono">{c.command}</span>
                </div>
                {c.evidence ? (
                  <p className="ml-1 mt-0.5 text-[11px] text-muted-foreground">{c.evidence}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </Field>
      )}

      {review && (
        <Field label={t('tasks.review')}>
          <dl className="space-y-1 text-xs">
            {review.verdict ? <KV k={t('tasks.verdict')} v={review.verdict} /> : null}
            {review.mode ? <KV k={t('tasks.mode')} v={review.mode} /> : null}
            {review.owner ? <KV k={t('tasks.owner')} v={review.owner} /> : null}
            {review.reference ? <KV k={t('tasks.reference')} v={review.reference} /> : null}
            {review.reason ? <KV k={t('tasks.reason')} v={review.reason} /> : null}
          </dl>
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
        <Field label={t('tasks.files')}>
          <ul className="list-inside list-disc font-mono text-xs">
            {task.scope.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </Field>
      ) : null}

      <Field label={t('tasks.doc')}>
        <TaskDocSection id={task.id} />
      </Field>

      <Field label={t('tasks.history')}>
        <ol className="space-y-1 border-l-2 border-border pl-3">
          {task.history.map((h, i) => (
            <li key={i} className="text-xs">
              <span className="font-mono text-muted-foreground">
                {h.at.slice(0, 19).replace('T', ' ')}
              </span>{' '}
              {h.event}
              {h.state ? <> <StateBadge state={h.state} /></> : null}
            </li>
          ))}
        </ol>
      </Field>
    </div>
  );
}
