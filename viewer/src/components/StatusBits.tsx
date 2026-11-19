import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { CaptureStatus } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';

const STATE_TONE: Record<string, string> = {
  PLAN: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30',
  ACT: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  VERIFY:
    'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30',
  COLLATERAL:
    'bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30',
  RESEARCH:
    'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30',
  EVALUATE:
    'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30',
  REVIEW:
    'bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-500/30',
  ACCEPT:
    'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  CLOSE:
    'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border-zinc-500/30',
  STALL: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30',
};

export function StateBadge({ state }: { state: string }) {
  return (
    <Badge variant="outline" className={cn('font-mono', STATE_TONE[state])}>
      {state}
    </Badge>
  );
}

const OWNERSHIP_TONE: Record<CaptureStatus, string> = {
  proved:
    'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  drifted:
    'bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30',
  unconfirmed:
    'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  unproved: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border-zinc-500/30',
  malformed:
    'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30',
  error: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30',
};

export function OwnershipBadge({ status }: { status: CaptureStatus }) {
  return (
    <Badge
      variant="outline"
      className={cn('font-mono', OWNERSHIP_TONE[status] ?? OWNERSHIP_TONE.error)}
    >
      {status}
    </Badge>
  );
}

const JOURNAL_TONE: Record<string, string> = {
  committed:
    'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  prepared:
    'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  abandoned:
    'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30',
};

export function JournalStateBadge({ state }: { state: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'font-mono',
        JOURNAL_TONE[state] ?? 'bg-zinc-500/15 text-zinc-600 border-zinc-500/30',
      )}
    >
      {state}
    </Badge>
  );
}

export function ErrorBox({
  error,
  onRetry,
}: {
  error: { code?: string; message: string; status?: number };
  onRetry?: () => void;
}) {
  const t = useT();
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-destructive">
          {error.code ? `${error.code}` : t('common.requestFailed')}
          {error.status ? ` (HTTP ${error.status})` : ''}
        </p>
        <p className="mt-1 break-words text-muted-foreground">{error.message}</p>
      </div>
      {onRetry ? (
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          aria-label={t('error.retryAria')}
        >
          <RefreshCw className="mr-1 h-3.5 w-3.5" />
          {t('common.retry')}
        </Button>
      ) : null}
    </div>
  );
}

export function EmptyBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  );
}

export function ShortId({ id }: { id: string }) {
  return (
    <span className="font-mono text-xs text-muted-foreground" title={id}>
      {id.slice(0, 8)}
    </span>
  );
}
