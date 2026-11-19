import { useEffect, useState } from 'react';
import {
  Activity,
  Camera,
  FileText,
  Flag,
  Gauge,
  LayoutDashboard,
  ListTodo,
  Newspaper,
  ScrollText,
  Brain,
} from 'lucide-react';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { adoptProjectLocale, setLocale, useLocale, useT } from '@/lib/i18n';
import { ArtifactsView } from '@/views/ArtifactsView';
import { CapturesView } from '@/views/CapturesView';
import { GoalsView } from '@/views/GoalsView';
import { JournalView } from '@/views/JournalView';
import { MemoryView } from '@/views/MemoryView';
import { MetricsView } from '@/views/MetricsView';
import { ReportsView } from '@/views/ReportsView';
import { TasksView } from '@/views/TasksView';
import { WorkspaceView } from '@/views/WorkspaceView';
import { cn } from '@/lib/utils';

const NAV = [
  { value: 'workspace', labelKey: 'nav.workspace', icon: LayoutDashboard },
  { value: 'tasks', labelKey: 'nav.tasks', icon: ListTodo },
  { value: 'journal', labelKey: 'nav.journal', icon: ScrollText },
  { value: 'artifacts', labelKey: 'nav.artifacts', icon: FileText },
  { value: 'captures', labelKey: 'nav.captures', icon: Camera },
  { value: 'memory', labelKey: 'nav.memory', icon: Brain },
  { value: 'goals', labelKey: 'nav.goals', icon: Flag },
  { value: 'metrics', labelKey: 'nav.metrics', icon: Gauge },
  { value: 'reports', labelKey: 'nav.reports', icon: Newspaper },
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
  const locale = useLocale();
  const t = useT();

  // Adopt the project-configured locale once, unless the user already chose.
  useEffect(() => {
    api
      .workspace()
      .then((ws) => adoptProjectLocale(ws.project.locale))
      .catch(() => undefined);
  }, []);

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Activity className="h-5 w-5" aria-hidden />
          <h1 className="text-lg font-semibold tracking-tight">
            {t('app.title')}
          </h1>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 font-mono text-xs"
              aria-label={t('app.locale')}
              onClick={() => setLocale(locale === 'en' ? 'es' : 'en')}
            >
              {locale === 'en' ? 'EN' : 'ES'}
            </Button>
            <span
              role="status"
              aria-label={healthy === null
                ? t('app.api.aria.unknown')
                : healthy
                  ? t('app.api.aria.ok')
                  : t('app.api.aria.down')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs',
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
              {healthy === null
                ? t('app.api.unknown')
                : healthy
                  ? t('app.api.ok')
                  : t('app.api.down')}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <Tabs value={view} onValueChange={(v) => setView(v as NavValue)}>
          <TabsList
            aria-label={t('nav.views')}
            className="mb-6 flex h-auto w-full flex-wrap justify-start sm:w-auto"
          >
            {NAV.map(({ value, labelKey, icon: Icon }) => (
              <TabsTrigger key={value} value={value} className="gap-1.5">
                <Icon className="h-4 w-4" aria-hidden />
                {t(labelKey)}
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
          <TabsContent value="memory">
            <MemoryView />
          </TabsContent>
          <TabsContent value="goals">
            <GoalsView />
          </TabsContent>
          <TabsContent value="metrics">
            <MetricsView />
          </TabsContent>
          <TabsContent value="reports">
            <ReportsView />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
