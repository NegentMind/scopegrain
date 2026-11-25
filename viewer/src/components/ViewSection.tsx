import * as React from 'react';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// Silent revalidate indicator for polling views (motion audit §3.5):
// a 1.5px accent dot that pulses while a background fetch is in flight.
// Always rendered (opacity-0 when idle) so it never shifts layout.
export function RefreshDot({ active }: { active?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-1.5 rounded-full bg-primary transition-opacity duration-300',
        active ? 'animate-pulse opacity-100' : 'opacity-0',
      )}
    />
  );
}

// Single-header section card. Replaces the repeated
// Card > CardHeader > (CardTitle + CardDescription [+ truncated note])
// scaffold and gives the refresh indicator a stable home in CardAction.
export function ViewSection({
  title,
  description,
  refreshing = false,
  truncated = false,
  actions,
  className,
  contentClassName,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  refreshing?: boolean;
  /** Appends the localized ' (truncated by API)' suffix to the description. */
  truncated?: boolean;
  actions?: React.ReactNode;
  className?: string;
  contentClassName?: string;
  children: React.ReactNode;
}) {
  const t = useT();
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description !== undefined || truncated ? (
          <CardDescription>
            {description}
            {truncated
              ? description !== undefined
                ? t('common.truncatedByApi')
                : t('common.truncatedByApi').trim()
              : ''}
          </CardDescription>
        ) : null}
        <CardAction>
          <RefreshDot active={refreshing} />
          {actions}
        </CardAction>
      </CardHeader>
      <CardContent className={contentClassName}>{children}</CardContent>
    </Card>
  );
}
