import * as React from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

// Right-hand detail panel for master-detail layouts: labelled landmark with
// header (title/description/actions/close) and a scrollable body. Give it a
// height via className (e.g. "max-h-[36rem]") — the body scrolls, the header
// stays put.
export function DocPanel({
  title,
  description,
  actions,
  onClose,
  closeLabel = 'Close',
  className,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  onClose?: () => void;
  closeLabel?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const titleId = React.useId();
  return (
    <aside
      aria-labelledby={titleId}
      className={cn(
        'flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2 border-b px-4 py-3">
        <div className="min-w-0">
          <h3 id={titleId} className="font-heading text-sm font-medium">
            {title}
          </h3>
          {description ? (
            <div className="mt-0.5 text-xs text-muted-foreground">
              {description}
            </div>
          ) : null}
        </div>
        {actions || onClose ? (
          <div className="flex shrink-0 items-center gap-1">
            {actions}
            {onClose ? (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onClose}
                aria-label={closeLabel}
              >
                <X aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-4">{children}</div>
      </ScrollArea>
    </aside>
  );
}
