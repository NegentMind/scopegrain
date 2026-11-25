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

// Module-level stale-while-revalidate store: survives view switches and
// remounts (TabsContent unmounts), so a remount replays the last payload
// instantly and revalidates in the background instead of flashing a
// skeleton. Entries are JSON snapshots — the same dedup marker the hook
// already used — capped FIFO so a long session stays bounded.
const SWR_CAP = 150;
const swrCache = new Map<string, string>();
const RELOAD_EVENT = 'sg:api-reload';

export function reloadAllApis() {
  window.dispatchEvent(new Event(RELOAD_EVENT));
}

/** Test seam: drop every cached payload. */
export function clearApiCache() {
  swrCache.clear();
}

function swrSet(key: string, json: string) {
  if (swrCache.size >= SWR_CAP && !swrCache.has(key)) {
    const oldest = swrCache.keys().next().value;
    if (oldest !== undefined) swrCache.delete(oldest);
  }
  swrCache.set(key, json);
}

// Minimal fetch hook: loading/error/empty handling stays in the views.
// `deps` re-triggers the request (e.g. selected artifact kind); every value
// captured by the fetcher closure must be listed there or the view keeps
// showing the previous params' payload.
// `key` opts into the SWR cache: it must uniquely name the request
// (include every dep — `artifact-doc:${kind}:${name}`), or a different
// params set would replay the wrong payload.
// reload() is a silent revalidate: existing data stays on screen, the result
// is only committed when it structurally changed, and a background failure
// keeps the stale payload instead of blanking the panel. A deps change is
// NOT silent: the previous payload is dropped up front so it is never
// attributed to the new params, and a failure surfaces as an error.
export function useApi<T>(
  fetcher: () => Promise<T>,
  deps: readonly unknown[] = [],
  key?: string,
): ApiState<T> {
  // Initialize from the SWR snapshot so a remount replays instantly —
  // zero skeleton frames, not just fewer. The effect still revalidates.
  const [data, setData] = useState<T | null>(() => {
    const cached = key !== undefined ? swrCache.get(key) : undefined;
    return cached !== undefined ? (JSON.parse(cached) as T) : null;
  });
  const [loading, setLoading] = useState(
    () => !(key !== undefined && swrCache.has(key)));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [tick, setTick] = useState(0);
  const silent = useRef(false);
  const lastJson = useRef<string | null>(
    key !== undefined ? (swrCache.get(key) ?? null) : null);

  const reload = useCallback(() => {
    silent.current = true;
    setTick((t) => t + 1);
  }, []);

  // A supervised API restart (or a manual `view` respawn) makes cached
  // payloads potentially stale — the App health watcher fires this event
  // and every mounted query revalidates without a page reload.
  useEffect(() => {
    const onReload = () => reload();
    window.addEventListener(RELOAD_EVENT, onReload);
    return () => window.removeEventListener(RELOAD_EVENT, onReload);
  }, [reload]);

  useEffect(() => {
    let cancelled = false;
    const isSilent = silent.current;
    silent.current = false;
    if (isSilent && lastJson.current !== null) {
      setRefreshing(true);
    } else {
      // Mount or deps change: replay the cached payload under this key
      // when present — same JSON marker, so a no-change revalidation
      // costs zero renders and the panel never flashes a skeleton.
      const cached = key !== undefined ? swrCache.get(key) : undefined;
      lastJson.current = cached ?? null;
      if (cached !== undefined) {
        setData(JSON.parse(cached) as T);
        setLoading(false);
        setRefreshing(true);
        setError(null);
      } else {
        setData(null);
        setLoading(true);
        setError(null);
      }
    }
    fetcher()
      .then((d) => {
        if (cancelled) return;
        const json = JSON.stringify(d);
        if (json !== lastJson.current) {
          lastJson.current = json;
          setData(d);
        }
        if (key !== undefined) swrSet(key, json);
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
