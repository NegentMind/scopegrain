import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { clearApiCache, reloadAllApis, useApi } from './useApi';

describe('useApi', () => {
  beforeEach(() => clearApiCache());

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

  it('replays a keyed payload on remount instead of flashing loading', async () => {
    // SWR contract: a remount (view switch) renders the cached payload
    // synchronously and revalidates in the background.
    const first = renderHook(() =>
      useApi(() => Promise.resolve({ v: 7 }), [], 'k-remount'),
    );
    await waitFor(() => expect(first.result.current.data).toEqual({ v: 7 }));
    first.unmount();
    const second = renderHook(() =>
      useApi(() => Promise.resolve({ v: 7 }), [], 'k-remount'),
    );
    // No async wait: the cached payload must be there on the first render.
    expect(second.result.current.loading).toBe(false);
    expect(second.result.current.data).toEqual({ v: 7 });
  });

  it('a different params set under a different key does not cross-replay', async () => {
    const first = renderHook(() =>
      useApi(() => Promise.resolve({ kind: 'a' }), [], 'k-a'),
    );
    await waitFor(() =>
      expect(first.result.current.data).toEqual({ kind: 'a' }));
    first.unmount();
    const second = renderHook(() =>
      useApi(() => Promise.resolve({ kind: 'b' }), [], 'k-b'),
    );
    // 'k-b' has no snapshot: loading until the fetch resolves.
    expect(second.result.current.loading).toBe(true);
    await waitFor(() =>
      expect(second.result.current.data).toEqual({ kind: 'b' }));
  });

  it('reloadAllApis revalidates mounted queries without unmounting', async () => {
    let v = 1;
    const { result } = renderHook(() =>
      useApi(() => Promise.resolve({ v }), [], 'k-reload'),
    );
    await waitFor(() => expect(result.current.data).toEqual({ v: 1 }));
    v = 2;
    act(() => reloadAllApis());
    await waitFor(() => expect(result.current.data).toEqual({ v: 2 }));
    expect(result.current.error).toBeNull();
  });
});
