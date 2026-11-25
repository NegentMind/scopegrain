import { clampPct } from '@/lib/format';
import { toneClasses, type Tone } from '@/lib/tones';
import { cn } from '@/lib/utils';

// Accessible progress bar. pct=null renders an indeterminate bar (ARIA: no
// aria-valuenow) at 0 width so a 0/0 ratio never masquerades as 100%.
// Defaults preserve the legacy visual: accent fill, green at 100%.
export function ProgressBar({
  pct,
  tone,
  label,
  className,
}: {
  pct: number | null;
  tone?: Tone;
  label?: string;
  className?: string;
}) {
  const fill = tone
    ? toneClasses(tone).solid
    : pct === 100
      ? toneClasses('ok').solid
      : 'bg-primary';
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct === null ? undefined : clampPct(pct)}
      aria-label={label}
      className={cn(
        'h-1.5 w-full overflow-hidden rounded-full bg-muted',
        className,
      )}
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-300 ease-out',
          fill,
        )}
        style={{ width: `${clampPct(pct)}%` }}
      />
    </div>
  );
}
