import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react';
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { CaptureStatus } from '@/lib/api';
import { useTEnum } from '@/lib/i18n';
import { toneClasses, type Tone } from '@/lib/tones';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';

// Pipeline phases are positions in a flow, not health: they render as
// neutral mono. Color is reserved for outcome (audit E1 triad + neutral).
const STATE_TONE: Record<string, Tone> = {
  PLAN: 'neutral',
  ACT: 'neutral',
  VERIFY: 'neutral',
  COLLATERAL: 'neutral',
  RESEARCH: 'neutral',
  EVALUATE: 'neutral',
  REVIEW: 'neutral',
  ACCEPT: 'ok',
  CLOSE: 'neutral',
  STALL: 'warn',
  ABANDON: 'err',
};

export function StateBadge({ state }: { state: string }) {
  const t = useT();
  return (
    <Badge
      variant="outline"
      title={state}
      className={cn(
        'font-mono',
        toneClasses(STATE_TONE[state] ?? 'neutral').badge,
      )}
    >
      {t(`state.${state}`) === `state.${state}` ? state : t(`state.${state}`)}
    </Badge>
  );
}

const OWNERSHIP_TONE: Record<CaptureStatus, Tone> = {
  proved: 'ok',
  drifted: 'warn',
  unconfirmed: 'warn',
  unproved: 'neutral',
  malformed: 'err',
  error: 'err',
};

export function OwnershipBadge({ status }: { status: CaptureStatus }) {
  const te = useTEnum();
  return (
    <Badge
      variant="outline"
      className={cn(
        'font-mono',
        toneClasses(OWNERSHIP_TONE[status] ?? 'err').badge,
      )}
    >
      {te('cap', status)}
    </Badge>
  );
}

const JOURNAL_TONE: Record<string, Tone> = {
  committed: 'ok',
  prepared: 'warn',
  abandoned: 'err',
};

export function JournalStateBadge({ state }: { state: string }) {
  const te = useTEnum();
  return (
    <Badge
      variant="outline"
      className={cn(
        'font-mono',
        toneClasses(JOURNAL_TONE[state] ?? 'neutral').badge,
      )}
    >
      {te('jstate', state)}
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
    <Alert variant="destructive">
      <AlertTriangle />
      <AlertTitle>
        {error.code ? `${error.code}` : t('common.requestFailed')}
        {error.status ? ` (HTTP ${error.status})` : ''}
      </AlertTitle>
      <AlertDescription className="break-words">
        {error.message}
      </AlertDescription>
      {onRetry ? (
        <AlertAction>
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            aria-label={t('error.retryAria')}
          >
            <RefreshCw />
            {t('common.retry')}
          </Button>
        </AlertAction>
      ) : null}
    </Alert>
  );
}

export function EmptyBox({
  title,
  icon,
  children,
}: {
  title?: React.ReactNode;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          {icon ?? <Inbox aria-hidden="true" />}
        </EmptyMedia>
        {title ? <EmptyTitle>{title}</EmptyTitle> : null}
        <EmptyDescription>{children}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function ListSkeleton({
  rows = 5,
  label = 'Loading',
}: {
  rows?: number;
  label?: string;
}) {
  return (
    <div className="space-y-3" role="status" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  );
}

export function ShortId({ id }: { id: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        className="cursor-default font-mono text-xs text-muted-foreground"
      >
        {id.slice(0, 8)}
      </TooltipTrigger>
      <TooltipContent className="font-mono">{id}</TooltipContent>
    </Tooltip>
  );
}
