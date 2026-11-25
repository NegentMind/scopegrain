import * as React from 'react';
import { cn } from '@/lib/utils';

// Selectable list-row button for document lists (plan docs, artifact docs):
// title + mono subtitle on the left, optional status badge and a trailing
// metadata slot (usually a date). Selected state is painted via data-state
// so it matches SelectableRow's visual contract.
export function DocListItem({
  selected,
  onSelect,
  title,
  subtitle,
  badge,
  meta,
  className,
}: {
  selected: boolean;
  onSelect: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  badge?: React.ReactNode;
  meta?: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      data-state={selected ? 'selected' : undefined}
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors',
        'hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring data-[state=selected]:bg-accent',
        className,
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{title}</span>
        {subtitle ? (
          <span className="block truncate font-mono text-[10px] text-muted-foreground">
            {subtitle}
          </span>
        ) : null}
      </span>
      {badge}
      {meta ? (
        <span className="shrink-0 text-xs text-muted-foreground">{meta}</span>
      ) : null}
    </button>
  );
}
