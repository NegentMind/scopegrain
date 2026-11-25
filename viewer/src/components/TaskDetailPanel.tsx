import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ChevronDown } from 'lucide-react';
import { api, type TaskDetail } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { ListSkeleton, StateBadge } from '@/components/StatusBits';
import { cn } from '@/lib/utils';
import { useLocale, useT, useTEnum } from '@/lib/i18n';
import { Markdown } from '@/components/Markdown';
import { fmtDateTime, shortHash } from '@/lib/format';
import { toneClasses, type Tone } from '@/lib/tones';

// Disposition is an outcome, so it maps onto the shared semantic triad
// (audit E1): deferred→warn, icebox/future→info, discarded→neutral,
// cancelled→err. Consumed by the tasks table and this detail panel.
export const DISPOSITION_TONE: Record<string, Tone> = {
  deferred: 'warn',
  icebox: 'info',
  future: 'info',
  discarded: 'neutral',
  cancelled: 'err',
};

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
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
  const locale = useLocale();
  const doc = useApi(() => api.taskDoc(id), [id], `task-doc:${id}`);
  if (doc.loading) return <ListSkeleton rows={2} />;
  if (doc.error) return null;
  if (!doc.data?.doc) {
    return <p className="text-xs text-muted-foreground">{t('tasks.docMissing')}</p>;
  }
  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ChevronDown className="size-3.5 transition-transform group-data-[state=closed]:-rotate-90" />
        {doc.data.bytes} B ·{' '}
        {doc.data.updatedAt ? fmtDateTime(doc.data.updatedAt, locale) : ''}
        {doc.data.docTruncated ? ` ${t('common.truncatedByApi')}` : ''}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 max-h-[36rem] overflow-auto rounded-md border bg-muted/40 p-3">
          <Markdown>{doc.data.doc}</Markdown>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function TaskDetailPanel({
  task,
  onSelect,
}: {
  task: TaskDetail;
  onSelect: (id: string) => void;
}) {
  const t = useT();
  const te = useTEnum();
  const locale = useLocale();
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
          {task.severity && <Badge variant="outline">{te('sev', task.severity)}</Badge>}
          {task.type && <Badge variant="outline">{te('type', task.type)}</Badge>}
          {task.effort && <Badge variant="outline">{task.effort}</Badge>}
          {task.disposition && (
            <Badge variant="outline"
              className={cn(toneClasses(DISPOSITION_TONE[task.disposition.kind] ?? 'neutral').badge)}>
              {t(`disp.${task.disposition.kind}`)}
            </Badge>
          )}
          {task.backlog && <Badge variant="secondary" className="font-mono">{task.backlog}</Badge>}
          {uncertaintyObj && (
            <Badge variant="outline" className={cn(toneClasses('warn').badge)}>
              {t('tasks.uncertainty')}: {uncertaintyObj.uphill ?? 0}↑ {uncertaintyObj.downhill ?? 0}↓
            </Badge>
          )}
        </div>
      </div>

      <Field label={t('tasks.context')}>
        <dl className="space-y-1 text-xs">
          <KV k={t('tasks.route')} v={task.methodologyRoute ?? m?.preferredRoute ?? t('common.none')} />
          {task.planKey ? <KV k={t('tasks.plan')} v={<span className="font-mono">{task.planKey}</span>} /> : null}
          {task.specId ? <KV k={t('tasks.spec')} v={<span className="font-mono">{shortHash(task.specId)}</span>} /> : null}
          {task.designId ? <KV k={t('tasks.design')} v={<span className="font-mono">{shortHash(task.designId)}</span>} /> : null}
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
              ? ` · ${fmtDateTime(task.disposition.at, locale)}`
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
                {shortHash(id)}
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
                <Badge variant="secondary" className="font-mono text-2xs">{kind}</Badge>
                {ids.map((id) => (
                  <Button key={id} variant="outline" size="sm"
                    className="h-6 px-1.5 font-mono text-xs"
                    onClick={() => onSelect(id)}>
                    {shortHash(id)}
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
              <Badge key={id} variant="outline" className="font-mono">{shortHash(id)}</Badge>
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
                    s.status === 'done' && toneClasses('ok').solid,
                    s.status === 'skipped' && toneClasses('neutral').solid,
                    s.status === 'pending' && toneClasses('warn').solid,
                  )} />
                  <span className={cn(s.status === 'skipped' && 'line-through')}>
                    {s.name ?? s.text}
                  </span>
                </div>
                {(s.action || s.verify || (s.files?.length ?? 0) > 0) && (
                  <dl className="ml-4 mt-0.5 space-y-0.5 text-2xs text-muted-foreground">
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
                    'font-mono text-2xs',
                    c.status === 'pass'
                      ? toneClasses('ok').badge
                      : toneClasses('err').badge,
                  )}>{te('check', c.status)}</Badge>
                  <span className="font-mono">{c.command}</span>
                </div>
                {c.evidence ? (
                  <p className="ml-1 mt-0.5 text-2xs text-muted-foreground">{c.evidence}</p>
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
              <Badge key={s} variant="secondary" className="font-mono text-2xs">{s}</Badge>
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
                    <span className="font-mono tabular-nums text-muted-foreground">
                      {fmtDateTime(note.at, locale)}{' '}
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
              <span className="font-mono tabular-nums text-muted-foreground">
                {fmtDateTime(h.at, locale)}
              </span>{' '}
              {te('ev', h.event)}
              {h.state ? <> <StateBadge state={h.state} /></> : null}
            </li>
          ))}
        </ol>
      </Field>
    </div>
  );
}
