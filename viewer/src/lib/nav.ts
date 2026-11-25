// Cross-view navigation intents, now a façade over the hash router.
// Views render inside separate tab panels that unmount on switch, so a
// target selection is carried as a pending request consumed once by the
// destination view (TasksView calls consumeTaskRequest on mount).
// `registerNavigate` is kept for compatibility: when no handler is
// registered the default action writes `#/tasks/<id>` via the router.
import { getRoute, navigate } from './hashRoute';

let pendingTask: string | null = null;
let navigateHandler: ((view: string) => void) | null = null;

export function registerNavigate(fn: ((view: string) => void) | null) {
  navigateHandler = fn;
}

export function openTask(id: string) {
  pendingTask = id;
  if (navigateHandler) navigateHandler('tasks');
  else navigate('tasks', id);
}

// The route fallback yields an id once per route entry: consuming marks the
// current key, leaving `#/tasks` resets it, and arriving at `#/tasks/<id>`
// again (back/forward, remount on a different route) yields it again.
let consumedRouteKey: string | null = null;
const routeKey = (view: string, id?: string) =>
  view === 'tasks' && id ? `tasks/${id}` : null;

export function consumeTaskRequest(): string | null {
  const route = getRoute();
  const key = routeKey(route.view, route.id);
  if (!key) consumedRouteKey = null;
  const id = pendingTask;
  pendingTask = null;
  if (id) {
    // Queue intent wins; mark the current route as consumed so the same
    // `#/tasks/<id>` is not yielded again on the next read.
    if (key) consumedRouteKey = key;
    return id;
  }
  // Deep-link fallback: landing on `#/tasks/<id>` selects that task even
  // without a queued intent (fresh load, pasted URL, back/forward).
  if (key && key !== consumedRouteKey) {
    consumedRouteKey = key;
    return route.id ?? null;
  }
  return null;
}
