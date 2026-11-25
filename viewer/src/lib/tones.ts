// Single semantic-tone system for the whole viewer. The audit calls for a
// triad + neutral instead of the ~10 competing hues: ok→emerald,
// warn→amber, err→rose, info→the single cold accent (primary),
// neutral→muted. Colors resolve through the --ok/--warn/--err tokens in
// index.css, so dark/light adaptation is automatic.

export type Tone = 'ok' | 'warn' | 'err' | 'info' | 'neutral';

export interface ToneClasses {
  /** bg + text + border in one shot — the badge/table-chip use case. */
  badge: string;
  text: string;
  border: string;
  /** Translucent tint for fills/backgrounds. */
  bg: string;
  /** Opaque fill (progress bars, dots). */
  solid: string;
}

const TONES: Record<Tone, ToneClasses> = {
  ok: {
    badge: 'border-ok/30 bg-ok/15 text-ok',
    text: 'text-ok',
    border: 'border-ok/30',
    bg: 'bg-ok/15',
    solid: 'bg-ok',
  },
  warn: {
    badge: 'border-warn/30 bg-warn/15 text-warn',
    text: 'text-warn',
    border: 'border-warn/30',
    bg: 'bg-warn/15',
    solid: 'bg-warn',
  },
  err: {
    badge: 'border-err/30 bg-err/15 text-err',
    text: 'text-err',
    border: 'border-err/30',
    bg: 'bg-err/15',
    solid: 'bg-err',
  },
  info: {
    badge: 'border-primary/30 bg-primary/15 text-primary',
    text: 'text-primary',
    border: 'border-primary/30',
    bg: 'bg-primary/15',
    solid: 'bg-primary',
  },
  neutral: {
    badge: 'border-border bg-muted/60 text-muted-foreground',
    text: 'text-muted-foreground',
    border: 'border-border',
    bg: 'bg-muted/60',
    solid: 'bg-muted-foreground',
  },
};

export function toneClasses(tone: Tone): ToneClasses {
  return TONES[tone];
}
