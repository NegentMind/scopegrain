// Shared display-format helpers. Pure, no i18n dict dependency — callers
// pass the active locale when they want localized output.

// Truncated id/hash display. `n=8` matches the existing ShortId convention.
export function shortHash(id: string, n = 8): string {
  return id.slice(0, n);
}

// Absolute timestamp: "22 nov 21:37" / "Nov 22, 21:37" depending on locale.
// Falls back to the raw input on unparseable dates (no silent data loss).
export function fmtDateTime(iso: string, locale?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

const REL_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
  ['second', 1],
];

// Relative timestamp ("hace 2 h" / "2 hours ago") in the largest unit that
// fits. Unparseable input returns the raw string.
export function fmtRel(iso: string, locale?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const seconds = (d.getTime() - Date.now()) / 1000;
  for (const [unit, size] of REL_UNITS) {
    if (Math.abs(seconds) >= size || unit === 'second') {
      return rtf.format(Math.round(seconds / size), unit);
    }
  }
  return rtf.format(0, 'second');
}

// Percentage of a denominator; null when there is nothing to divide by so
// callers render "—" instead of a fake 100%/0%.
export function pct(num: number, den: number): number | null {
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return null;
  return Math.round((num / den) * 1000) / 10;
}

// Clamps to [0, 100] for style widths; null/NaN collapse to 0.
export function clampPct(v: number | null | undefined): number {
  if (v === null || v === undefined || !Number.isFinite(v)) return 0;
  return Math.min(100, Math.max(0, v));
}
