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
import { api, type TaskDetail } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import {
  EmptyBox,
  ErrorBox,
  ListSkeleton,
  ShortId,
  StateBadge,
} from '@/components/StatusBits';
import { cn } from '@/lib/utils';

export function TasksView() {
  const [selected, setSelected] = useState<string | null>(null);
  const list = useApi(() => api.tasks());
  const detail = useApi<TaskDetail | null>(
    () => (selected ? api.task(selected).then((r) => r.task) : Promise.resolve(null)),
    [selected],
  );

  if (list.loading) return <ListSkeleton />;
  if (list.error) return <ErrorBox error={list.error} onRetry={list.reload} />;
  const tasks = list.data?.tasks ?? [];
  const malformed = list.data?.malformed ?? [];

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Work items</CardTitle>
          <CardDescription>
            {tasks.length} task{tasks.length === 1 ? '' : 's'}
            {list.data?.truncated ? ' (list truncated by API)' : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {tasks.length === 0 && malformed.length === 0 ? (
            <EmptyBox>No tasks recorded yet.</EmptyBox>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Id</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead className="hidden md:table-cell">Route</TableHead>
                  <TableHead className="hidden md:table-cell">Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((t) => (
                  <TableRow
                    key={t.id}
                    onClick={() => setSelected(t.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') setSelected(t.id);
                    }}
                    tabIndex={0}
                    aria-selected={selected === t.id}
                    className={cn(
                      'cursor-pointer focus-visible:outline-ring',
                      selected === t.id && 'bg-accent',
                    )}
                  >
                    <TableCell>
                      <ShortId id={t.id} />
                    </TableCell>
                    <TableCell className="font-medium">
                      {t.title}
                      {t.planKey ? (
                        <Badge variant="secondary" className="ml-2 font-mono">
                          {t.planKey}
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <StateBadge state={t.state} />
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">
                      {t.methodologyRoute ?? '—'}
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                      {t.updatedAt.slice(0, 19).replace('T', ' ')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {malformed.length > 0 ? (
            <div className="mt-4 space-y-1 text-xs">
              <p className="font-medium text-destructive">
                {malformed.length} malformed entr
                {malformed.length === 1 ? 'y' : 'ies'} (surfaced, not dropped)
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
          <CardTitle>Task detail</CardTitle>
          <CardDescription>
            {selected ? <ShortId id={selected} /> : 'Select a task'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!selected ? (
            <EmptyBox>Select a task from the list.</EmptyBox>
          ) : detail.loading ? (
            <ListSkeleton rows={3} />
          ) : detail.error ? (
            <ErrorBox error={detail.error} onRetry={detail.reload} />
          ) : detail.data ? (
            <TaskDetailPanel task={detail.data} />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function TaskDetailPanel({ task }: { task: TaskDetail }) {
  return (
    <div className="space-y-4 text-sm">
      <div>
        <h3 className="text-base font-semibold">{task.title}</h3>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <StateBadge state={task.state} />
          <Badge variant="secondary">rev {task.revision}</Badge>
          <Badge variant="secondary">v{task.schemaVersion}</Badge>
        </div>
      </div>
      <section aria-label="Contract">
        <h4 className="mb-1 text-xs font-medium uppercase text-muted-foreground">
          Contract
        </h4>
        <p className="whitespace-pre-wrap break-words">{task.contract}</p>
        {task.contractTruncated ? (
          <p className="text-xs text-muted-foreground">(truncated by API)</p>
        ) : null}
      </section>
      <section aria-label="Author context">
        <h4 className="mb-1 text-xs font-medium uppercase text-muted-foreground">
          Author context
        </h4>
        <p className="whitespace-pre-wrap break-words">{task.authorContext}</p>
      </section>
      {task.scope.length > 0 ? (
        <section aria-label="Scope">
          <h4 className="mb-1 text-xs font-medium uppercase text-muted-foreground">
            Scope
          </h4>
          <ul className="list-inside list-disc font-mono text-xs">
            {task.scope.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </section>
      ) : null}
      <section aria-label="History">
        <h4 className="mb-1 text-xs font-medium uppercase text-muted-foreground">
          History
        </h4>
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
      </section>
    </div>
  );
}
