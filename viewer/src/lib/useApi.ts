import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api';

export interface ApiState<T> {
  data: T | null;
  loading: boolean;
  /** True while a background revalidate is in flight (data stays visible). */
  refreshing: boolean;
  error: ApiError | Error | null;
  reload: () => void;
}

// Minimal fetch hook: loading/error/empty handling stays in the views.
// `deps` re-triggers the request (e.g. selected artifact kind).
// reload() is a silent revalidate: existing data stays on screen, the result
// is only committed when it structurally changed, and a background failure
// keeps the stale payload instead of blanking the panel.
export function useApi<T>(
  fetcher: () => Promise<T>,
  deps: readonly unknown[] = [],
): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [tick, setTick] = useState(0);
  const silent = useRef(false);
  const lastJson = useRef<string | null>(null);

  const reload = useCallback(() => {
    silent.current = true;
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const isSilent = silent.current;
    silent.current = false;
    if (isSilent && lastJson.current !== null) {
      setRefreshing(true);
    } else {
      setLoading(true);
      setError(null);
    }
    fetcher()
      .then((d) => {
        if (cancelled) return;
        const json = JSON.stringify(d);
        if (json !== lastJson.current) {
          lastJson.current = json;
          setData(d);
        }
        setError(null);
        setLoading(false);
        setRefreshing(false);
      })
      .catch((e) => {
        if (cancelled) return;
        // A failed background poll keeps the stale data on screen; only a
        // failure with nothing to show surfaces an error.
        if (lastJson.current === null) {
          setError(e instanceof Error ? e : new Error(String(e)));
        }
        setLoading(false);
        setRefreshing(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { data, loading, refreshing, error, reload };
}
