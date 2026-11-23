import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CATALOG_DESC_ES } from './catalogEs';

// The ES overlay must cover every manifest entry exactly: a missing key
// silently falls back to English, an extra key is dead weight.
const manifest = JSON.parse(
  readFileSync(resolve(__dirname, '../../../resources/manifest.json'), 'utf8'),
) as { entries: { kind: string; id: string; path?: string }[] };

describe('catalog ES description overlay', () => {
  it('covers every manifest entry exactly once', () => {
    const expected = new Set(
      manifest.entries.map((e) => `${e.kind}:${e.id}`),
    );
    expect(Object.keys(CATALOG_DESC_ES).sort())
      .toEqual([...expected].sort());
  });

  it('has non-empty Spanish values', () => {
    for (const [k, v] of Object.entries(CATALOG_DESC_ES)) {
      expect(v.trim().length, k).toBeGreaterThan(0);
    }
  });
});

// The catalog-doc endpoint serves resources/i18n/es/<entry.path> when the
// viewer asks for locale=es. Every entry must have its variant or the UI
// degrades to canonical English with a notice.
describe('catalog ES doc variants', () => {
  it('has a Spanish variant for every manifest entry path', () => {
    const missing = manifest.entries
      .map((e) => e.path)
      .filter((p): p is string => typeof p === 'string' && p.endsWith('.md'))
      .map((p) => p.replace(/^resources\//, ''))
      .filter((p) =>
        !existsSync(resolve(__dirname, '../../../resources/i18n/es', p)));
    expect(missing).toEqual([]);
  });
});
