// Cross-view navigation intents: views render inside separate tab panels
// that unmount on switch, so a target selection is carried as a pending
// request consumed once by the destination view.
let pendingTask: string | null = null;
let navigate: ((view: string) => void) | null = null;

export function registerNavigate(fn: (view: string) => void) {
  navigate = fn;
}

export function openTask(id: string) {
  pendingTask = id;
  navigate?.('tasks');
}

export function consumeTaskRequest(): string | null {
  const id = pendingTask;
  pendingTask = null;
  return id;
}
