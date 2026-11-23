import { describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useApi } from './useApi';

describe('useApi', () => {
  it('resolves the fetcher payload into data', async () => {
    const { result } = renderHook(() =>
      useApi(() => Promise.resolve({ v: 1 })),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ v: 1 });
    expect(result.current.error).toBeNull();
  });

  it('refetches when a dep changes and swaps the payload', async () => {
    const { result, rerender } = renderHook(
      ({ id }) => useApi(() => Promise.resolve({ id }), [id]),
      { initialProps: { id: 'a' } },
    );
    await waitFor(() => expect(result.current.data).toEqual({ id: 'a' }));
    rerender({ id: 'b' });
    await waitFor(() => expect(result.current.data).toEqual({ id: 'b' }));
    expect(result.current.error).toBeNull();
  });

  it('surfaces the error and drops stale data when a dep-change fetch fails', async () => {
    // Regression: a successful fetch for param A followed by a failing fetch
    // for param B must not keep A's payload on screen with a swallowed error.
    const { result, rerender } = renderHook(
      ({ id }) =>
        useApi(
          () =>
            id === 'b'
              ? Promise.reject(new Error('boom'))
              : Promise.resolve({ id }),
          [id],
        ),
      { initialProps: { id: 'a' } },
    );
    await waitFor(() => expect(result.current.data).toEqual({ id: 'a' }));
    rerender({ id: 'b' });
    await waitFor(() =>
      expect(result.current.error).toBeInstanceOf(Error),
    );
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('keeps the previous payload on a failed silent reload', async () => {
    // reload() is a background revalidate: a failure keeps the stale data
    // rather than blanking the panel.
    let fail = false;
    const { result } = renderHook(() =>
      useApi(() =>
        fail ? Promise.reject(new Error('down')) : Promise.resolve({ v: 1 }),
      ),
    );
    await waitFor(() => expect(result.current.data).toEqual({ v: 1 }));
    fail = true;
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(result.current.data).toEqual({ v: 1 });
    expect(result.current.error).toBeNull();
  });
});
