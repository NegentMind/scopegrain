// Minimal hash router for the viewer's tab shell. Routes look like
// `#/tasks` or `#/tasks/<id>`; an empty or unknown hash resolves to the
// caller's default view. No dependency — ~50 LOC covers deep-linking,
// F5 persistence and back/forward for a 16-view local console.
import { useSyncExternalStore } from 'react';

export interface Route {
  view: string;
  id?: string;
}

const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

// getSnapshot must return a cached object: a fresh {view,id} per call
// makes useSyncExternalStore loop forever.
let lastRaw: string | null = null;
let lastRoute: Route = { view: '' };

export function getRoute(): Route {
  const raw = window.location.hash;
  if (raw !== lastRaw) {
    lastRaw = raw;
    const [view = '', id] = raw.replace(/^#\/?/, '').split('/');
    let decoded: string | undefined;
    try {
      decoded =
        id === undefined || id === '' ? undefined : decodeURIComponent(id);
    } catch {
      decoded = id; // malformed %-escape: keep the raw segment, never crash
    }
    lastRoute = { view, id: decoded };
  }
  return lastRoute;
}

// Write a route. No-op when the hash already matches so re-selecting the
// active tab does not push history entries.
export function navigate(view: string, id?: string) {
  const target = `#/${view}${id !== undefined ? `/${encodeURIComponent(id)}` : ''}`;
  if (window.location.hash === target) return;
  window.location.hash = target;
  // jsdom does not reliably dispatch `hashchange`; notify subscribers
  // directly. In browsers the real hashchange fires too, but the cached
  // snapshot above makes the second notification a no-op re-render.
  emit();
}

// Clear a `#/…` route, leaving bare hashes (#main) and empty hashes alone.
export function clearRoute() {
  if (window.location.hash.startsWith('#/')) {
    window.location.hash = '';
    emit();
  }
}

export function useHashRoute(): Route {
  return useSyncExternalStore((cb) => {
    listeners.add(cb);
    window.addEventListener('hashchange', cb);
    return () => {
      listeners.delete(cb);
      window.removeEventListener('hashchange', cb);
    };
  }, getRoute);
}
