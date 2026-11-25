import { AlertTriangle } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { toneClasses } from '@/lib/tones';
import { cn } from '@/lib/utils';

// Compact notice for entries the API surfaced but could not parse. Replaces
// the ad-hoc "N malformed entries" paragraphs copied across views: a single
// destructive-tinted block with the count plus optional per-entry detail
// lines (file: CODE or the raw malformed line).
export function MalformedNote({
  count,
  details,
  className,
}: {
  count: number;
  details?: string[];
  className?: string;
}) {
  const t = useT();
  const tone = toneClasses('err');
  if (count <= 0) return null;
  return (
    <div
      className={cn(
        'mt-4 space-y-1 rounded-md border p-2.5 text-xs',
        tone.border,
        tone.bg,
        className,
      )}
    >
      <p className={cn('flex items-center gap-1.5 font-medium', tone.text)}>
        <AlertTriangle className="size-3.5" aria-hidden="true" />
        {count} {t('common.malformedEntries')}
      </p>
      {details?.map((d, i) => (
        <p key={i} className="break-all font-mono text-muted-foreground">
          {d}
        </p>
      ))}
    </div>
  );
}
