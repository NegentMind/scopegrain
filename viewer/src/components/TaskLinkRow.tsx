import type { ReactNode } from 'react';
import { StateBadge } from '@/components/StatusBits';
import { openTask } from '@/lib/nav';
import { cn } from '@/lib/utils';

// Row linking to a task detail (State, Goals and any view listing linked
// tasks): state badge + truncated title + trailing metadata + short id in
// one keyboard-operable button. The full title/id go in `title` attrs —
// ShortId's tooltip trigger is itself a button and cannot nest here.
export function TaskLinkRow({
  id,
  state,
  title,
  meta,
  className,
}: {
  id: string;
  state?: string;
  title: string;
  /** Trailing content between the title and the id (badges, sources). */
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => openTask(id)}
      className={cn(
        'flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring',
        className,
      )}
    >
      {state ? <StateBadge state={state} /> : null}
      <span className="min-w-0 flex-1 truncate font-medium" title={title}>
        {title}
      </span>
      {meta}
      <span className="font-mono text-xs text-muted-foreground" title={id}>
        {id.slice(0, 8)}
      </span>
    </button>
  );
}
