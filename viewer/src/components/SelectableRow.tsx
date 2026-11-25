import * as React from 'react';
import { TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

// Selectable table row with the roving-tabindex contract: only the selected
// row is a tab stop (tabIndex={selected ? 0 : -1}), selection is announced
// via aria-selected + data-state="selected" (which also paints the selected
// background through TableRow's own styles), and Enter/Space activate.
// Pass tabIndex explicitly when nothing is selected but the list must stay
// keyboard-reachable (e.g. first row), and combine with useRovingTabindex
// on the <tbody> for ArrowUp/ArrowDown navigation.
export function SelectableRow({
  selected,
  onSelect,
  className,
  onClick,
  onKeyDown,
  tabIndex,
  ...props
}: React.ComponentProps<'tr'> & {
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <TableRow
      data-slot="selectable-row"
      data-state={selected ? 'selected' : undefined}
      aria-selected={selected}
      tabIndex={tabIndex ?? (selected ? 0 : -1)}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) onSelect();
      }}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (e.defaultPrevented) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault(); // Space must not scroll the page
          onSelect();
        }
      }}
      className={cn(
        'cursor-pointer focus-visible:outline-2 focus-visible:outline-ring',
        className,
      )}
      {...props}
    />
  );
}

// Roving tabindex for a list of SelectableRow children. Attach to the
// <tbody>/<div> wrapper: arrows move focus between rows and the last-focused
// row keeps the tab stop, so Tab returns to it instead of restarting.
export function useRovingTabindex<T extends HTMLElement>() {
  const ref = React.useRef<T>(null);

  const onFocus = React.useCallback((e: React.FocusEvent<T>) => {
    const target = e.target as HTMLElement;
    if (target.dataset.slot !== 'selectable-row') return;
    ref.current
      ?.querySelectorAll<HTMLElement>('[data-slot="selectable-row"]')
      .forEach((row) => {
        row.tabIndex = row === target ? 0 : -1;
      });
  }, []);

  const onKeyDown = React.useCallback((e: React.KeyboardEvent<T>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const rows = Array.from(
      ref.current?.querySelectorAll<HTMLElement>(
        '[data-slot="selectable-row"]',
      ) ?? [],
    );
    const index = rows.indexOf(e.target as HTMLElement);
    if (index === -1) return;
    e.preventDefault();
    rows[e.key === 'ArrowDown' ? index + 1 : index - 1]?.focus();
  }, []);

  return { ref, onFocus, onKeyDown };
}
