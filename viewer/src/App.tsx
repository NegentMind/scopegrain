import { useEffect, useState } from 'react';
import {
  Activity,
  Camera,
  FileText,
  LayoutDashboard,
  ListTodo,
  ScrollText,
} from 'lucide-react';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { ArtifactsView } from '@/views/ArtifactsView';
import { CapturesView } from '@/views/CapturesView';
import { JournalView } from '@/views/JournalView';
import { TasksView } from '@/views/TasksView';
import { WorkspaceView } from '@/views/WorkspaceView';
import { cn } from '@/lib/utils';

const NAV = [
  { value: 'workspace', label: 'Workspace', icon: LayoutDashboard },
  { value: 'tasks', label: 'Work items', icon: ListTodo },
  { value: 'journal', label: 'Journal', icon: ScrollText },
  { value: 'artifacts', label: 'Artifacts', icon: FileText },
  { value: 'captures', label: 'Captures', icon: Camera },
] as const;

type NavValue = (typeof NAV)[number]['value'];

function useHealthPoll() {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    const check = () => {
      api
        .health()
        .then(() => !cancelled && setOk(true))
        .catch(() => !cancelled && setOk(false));
    };
    check();
    const timer = setInterval(check, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
  return ok;
}

export default function App() {
  const [view, setView] = useState<NavValue>('workspace');
  const healthy = useHealthPoll();

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Activity className="h-5 w-5" aria-hidden />
          <h1 className="text-lg font-semibold tracking-tight">
            Scopegrain Viewer
          </h1>
          <span
            role="status"
            aria-label={healthy === null
              ? 'API status unknown'
              : healthy
                ? 'API connected'
                : 'API unreachable'}
            className={cn(
              'ml-auto inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs',
              healthy === null && 'text-muted-foreground',
              healthy === true &&
                'border-emerald-500/40 text-emerald-600 dark:text-emerald-400',
              healthy === false &&
                'border-destructive/50 text-destructive',
            )}
          >
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                healthy === null && 'bg-muted-foreground',
                healthy === true && 'bg-emerald-500',
                healthy === false && 'bg-destructive',
              )}
            />
            {healthy === null ? 'api…' : healthy ? 'api ok' : 'api down'}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <Tabs value={view} onValueChange={(v) => setView(v as NavValue)}>
          <TabsList
            aria-label="Views"
            className="mb-6 flex h-auto w-full flex-wrap justify-start sm:w-auto"
          >
            {NAV.map(({ value, label, icon: Icon }) => (
              <TabsTrigger key={value} value={value} className="gap-1.5">
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="workspace">
            <WorkspaceView />
          </TabsContent>
          <TabsContent value="tasks">
            <TasksView />
          </TabsContent>
          <TabsContent value="journal">
            <JournalView />
          </TabsContent>
          <TabsContent value="artifacts">
            <ArtifactsView />
          </TabsContent>
          <TabsContent value="captures">
            <CapturesView />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
