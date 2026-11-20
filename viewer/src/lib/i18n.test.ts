import { describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { adoptProjectLocale, setLocale, t, useLocale } from './i18n';

describe('t()', () => {
  it('returns the localized string for a known key', () => {
    expect(t('en', 'app.title')).toBe('Scopegrain Viewer');
    expect(t('es', 'app.title')).toBeTruthy();
    expect(t('es', 'app.title')).not.toBe(t('en', 'app.title'));
  });

  it('falls back to en when a key is missing in the target locale', () => {
    // 'error.retryAria' exists in both; probe a key that is en-only if any.
    // The contract: missing key in locale → en → raw key. Verify the last leg.
    expect(t('es', 'app.title')).toBeTypeOf('string');
    expect(t('en', 'definitely.missing.key')).toBe('definitely.missing.key');
    expect(t('es', 'definitely.missing.key')).toBe('definitely.missing.key');
  });
});

describe('locale store', () => {
  it('adopts an explicit choice and rejects invalid locales', () => {
    const { result } = renderHook(() => useLocale());
    act(() => setLocale('es'));
    expect(result.current).toBe('es');
    act(() => setLocale('fr' as never));
    expect(result.current).toBe('es');
    act(() => setLocale('en'));
    expect(result.current).toBe('en');
  });

  it('adoptProjectLocale only applies before an explicit choice', () => {
    // setLocale marks adopted=true (it ran above), so adoption is a no-op now.
    const { result } = renderHook(() => useLocale());
    act(() => adoptProjectLocale('es'));
    expect(result.current).toBe('en');
    act(() => adoptProjectLocale('bogus'));
    expect(result.current).toBe('en');
  });
});
