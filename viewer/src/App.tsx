import { useEffect, useState } from 'react';
import {
  Activity,
  BookMarked,
  Camera,
  FileText,
  Flag,
  Gauge,
  Globe,
  Handshake,
  LayoutDashboard,
  ListTodo,
  MonitorCog,
  Newspaper,
  ScrollText,
  Share2,
  Timer,
  Workflow,
  Brain,
} from 'lucide-react';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TooltipProvider } from '@/components/ui/tooltip';
import { api } from '@/lib/api';
import {
  adoptProjectLocale,
  setLocale,
  useLocale,
  useT,
  type Locale,
} from '@/lib/i18n';
import { ApprovalsView } from '@/views/ApprovalsView';
import { ArtifactsView } from '@/views/ArtifactsView';
import { CapturesView } from '@/views/CapturesView';
import { CatalogView } from '@/views/CatalogView';
import { GoalsView } from '@/views/GoalsView';
import { GraphView } from '@/views/GraphView';
import { JournalView } from '@/views/JournalView';
import { MemoryView } from '@/views/MemoryView';
import { MetricsView } from '@/views/MetricsView';
import { PlansView } from '@/views/PlansView';
import { ReportsView } from '@/views/ReportsView';
import { SessionsView } from '@/views/SessionsView';
import { SystemView } from '@/views/SystemView';
import { TasksView } from '@/views/TasksView';
import { WorkspaceView } from '@/views/WorkspaceView';
import { cn } from '@/lib/utils';

const NAV = [
  { value: 'workspace', labelKey: 'nav.workspace', descKey: 'nav.workspace.desc', icon: LayoutDashboard },
  { value: 'tasks', labelKey: 'nav.tasks', descKey: 'nav.tasks.desc', icon: ListTodo },
  { value: 'plans', labelKey: 'nav.plans', descKey: 'nav.plans.desc', icon: Workflow },
  { value: 'graph', labelKey: 'nav.graph', descKey: 'nav.graph.desc', icon: Share2 },
  { value: 'journal', labelKey: 'nav.journal', descKey: 'nav.journal.desc', icon: ScrollText },
  { value: 'artifacts', labelKey: 'nav.artifacts', descKey: 'nav.artifacts.desc', icon: FileText },
  { value: 'captures', labelKey: 'nav.captures', descKey: 'nav.captures.desc', icon: Camera },
  { value: 'memory', labelKey: 'nav.memory', descKey: 'nav.memory.desc', icon: Brain },
  { value: 'goals', labelKey: 'nav.goals', descKey: 'nav.goals.desc', icon: Flag },
  { value: 'sessions', labelKey: 'nav.sessions', descKey: 'nav.sessions.desc', icon: Timer },
  { value: 'approvals', labelKey: 'nav.approvals', descKey: 'nav.approvals.desc', icon: Handshake },
  { value: 'catalog', labelKey: 'nav.catalog', descKey: 'nav.catalog.desc', icon: BookMarked },
  { value: 'metrics', labelKey: 'nav.metrics', descKey: 'nav.metrics.desc', icon: Gauge },
  { value: 'reports', labelKey: 'nav.reports', descKey: 'nav.reports.desc', icon: Newspaper },
  { value: 'system', labelKey: 'nav.system', descKey: 'nav.system.desc', icon: MonitorCog },
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

function LocaleSelect() {
  const locale = useLocale();
  const t = useT();
  return (
    <Select
      value={locale}
      onValueChange={(v) => setLocale(v as Locale)}
    >
      <SelectTrigger
        size="sm"
        className="w-auto gap-1.5"
        aria-label={t('app.locale')}
      >
        <Globe className="size-3.5 text-muted-foreground" aria-hidden />
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        <SelectItem value="es">Español</SelectItem>
        <SelectItem value="en">English</SelectItem>
      </SelectContent>
    </Select>
  );
}

function HealthBadge({ healthy }: { healthy: boolean | null }) {
  const t = useT();
  return (
    <Badge
      variant="outline"
      role="status"
      aria-label={
        healthy === null
          ? t('app.api.aria.unknown')
          : healthy
            ? t('app.api.aria.ok')
            : t('app.api.aria.down')
      }
      className={cn(
        'gap-1.5 transition-colors',
        healthy === null && 'text-muted-foreground',
        healthy === true &&
          'border-emerald-500/40 text-emerald-600 dark:text-emerald-400',
        healthy === false && 'border-destructive/50 text-destructive',
      )}
    >
      <span className="relative flex h-1.5 w-1.5">
        {healthy === true && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
        )}
        <span
          className={cn(
            'relative inline-flex h-1.5 w-1.5 rounded-full',
            healthy === null && 'bg-muted-foreground',
            healthy === true && 'bg-emerald-500',
            healthy === false && 'bg-destructive',
          )}
        />
      </span>
      {healthy === null
        ? t('app.api.unknown')
        : healthy
          ? t('app.api.ok')
          : t('app.api.down')}
    </Badge>
  );
}

export default function App() {
  const [view, setView] = useState<NavValue>('workspace');
  const healthy = useHealthPoll();
  const t = useT();

  // Adopt the project-configured locale once, unless the user already chose.
  useEffect(() => {
    api
      .workspace()
      .then((ws) => adoptProjectLocale(ws.project.locale))
      .catch(() => undefined);
  }, []);

  const current = NAV.find((n) => n.value === view) ?? NAV[0];
  const CurrentIcon = current.icon;

  return (
    <TooltipProvider>
      <div className="dark min-h-screen bg-background text-foreground">
        <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
          <div className="mx-auto flex max-w-[88rem] items-center gap-3 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <div
                className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/60 text-primary-foreground shadow-sm"
                aria-hidden
              >
                <Activity className="size-4.5" />
              </div>
              <h1 className="text-lg font-semibold tracking-tight">
                {t('app.title')}
              </h1>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <LocaleSelect />
              <Separator orientation="vertical" className="h-5" />
              <HealthBadge healthy={healthy} />
            </div>
          </div>
        </header>

        <Tabs
          orientation="vertical"
          value={view}
          onValueChange={(v) => setView(v as NavValue)}
          className="mx-auto max-w-[88rem] gap-0"
        >
          <aside className="hidden w-52 shrink-0 border-r md:block">
            <nav
              className="sticky top-[57px] max-h-[calc(100vh-57px)] overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              aria-label={t('nav.views')}
            >
              <TabsList
                variant="line"
                className="h-auto w-full flex-col items-stretch gap-0.5 rounded-none p-2"
              >
                {NAV.map(({ value, labelKey, icon: Icon }) => (
                  <TabsTrigger
                    key={value}
                    value={value}
                    className="justify-start gap-2.5 rounded-md px-3 py-2 text-[13px] transition-colors duration-200 data-active:text-primary group-data-[variant=line]/tabs-list:data-active:after:bg-primary"
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                    {t(labelKey)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </nav>
          </aside>

          <main className="min-w-0 flex-1 px-4 py-6">
            <div className="mb-4 md:hidden">
              <Select
                value={view}
                onValueChange={(v) => setView(v as NavValue)}
              >
                <SelectTrigger
                  className="w-full"
                  aria-label={t('nav.views')}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NAV.map(({ value, labelKey }) => (
                    <SelectItem key={value} value={value}>
                      {t(labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div
              key={view}
              className="mb-5 flex items-start gap-3 animate-in fade-in-50 slide-in-from-top-1 duration-300"
            >
              <div
                className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary"
                aria-hidden
              >
                <CurrentIcon className="size-4.5" />
              </div>
              <div>
                <h2 className="text-base font-semibold leading-tight tracking-tight">
                  {t(current.labelKey)}
                </h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {t(current.descKey)}
                </p>
              </div>
            </div>

            <TabsContent value="workspace">
              <WorkspaceView />
            </TabsContent>
            <TabsContent value="tasks">
              <TasksView />
            </TabsContent>
            <TabsContent value="plans">
              <PlansView />
            </TabsContent>
            <TabsContent value="graph">
              <GraphView />
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
            <TabsContent value="sessions">
              <SessionsView />
            </TabsContent>
            <TabsContent value="approvals">
              <ApprovalsView />
            </TabsContent>
            <TabsContent value="catalog">
              <CatalogView />
            </TabsContent>
            <TabsContent value="metrics">
              <MetricsView />
            </TabsContent>
            <TabsContent value="reports">
              <ReportsView />
            </TabsContent>
            <TabsContent value="system">
              <SystemView />
            </TabsContent>
          </main>
        </Tabs>
      </div>
    </TooltipProvider>
  );
}
