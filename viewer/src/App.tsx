import { useEffect, useRef, useState } from 'react';
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
  ListChecks,
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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { api } from '@/lib/api';
import { reloadAllApis } from '@/lib/useApi';
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
import { StateView } from '@/views/StateView';
import { SystemView } from '@/views/SystemView';
import { TasksView } from '@/views/TasksView';
import { WorkspaceView } from '@/views/WorkspaceView';
import { toneClasses } from '@/lib/tones';
import { cn } from '@/lib/utils';
import { clearRoute, navigate, useHashRoute } from '@/lib/hashRoute';

// Pixel height of the sticky header below: py-3 (24) + logo h-8 (32) +
// 1px border = 57. The sidebar's sticky offset and max-height are bound
// to this constant; keep them in sync if the header layout changes.
const HEADER_H_PX = 57;

// Sidebar sections (ux-structure N2): 16 flat items exceed comfortable
// scanning — group by concern. `section` keys resolve through
// `nav.section.*` in the i18n dicts.
const NAV_SECTIONS = ['work', 'log', 'system'] as const;

const NAV = [
  { value: 'workspace', section: 'work', labelKey: 'nav.workspace', descKey: 'nav.workspace.desc', icon: LayoutDashboard, component: WorkspaceView },
  { value: 'tasks', section: 'work', labelKey: 'nav.tasks', descKey: 'nav.tasks.desc', icon: ListTodo, component: TasksView },
  { value: 'plans', section: 'work', labelKey: 'nav.plans', descKey: 'nav.plans.desc', icon: Workflow, component: PlansView },
  { value: 'goals', section: 'work', labelKey: 'nav.goals', descKey: 'nav.goals.desc', icon: Flag, component: GoalsView },
  { value: 'state', section: 'work', labelKey: 'nav.state', descKey: 'nav.state.desc', icon: ListChecks, component: StateView },
  { value: 'sessions', section: 'work', labelKey: 'nav.sessions', descKey: 'nav.sessions.desc', icon: Timer, component: SessionsView },
  { value: 'approvals', section: 'work', labelKey: 'nav.approvals', descKey: 'nav.approvals.desc', icon: Handshake, component: ApprovalsView },
  { value: 'journal', section: 'log', labelKey: 'nav.journal', descKey: 'nav.journal.desc', icon: ScrollText, component: JournalView },
  { value: 'artifacts', section: 'log', labelKey: 'nav.artifacts', descKey: 'nav.artifacts.desc', icon: FileText, component: ArtifactsView },
  { value: 'captures', section: 'log', labelKey: 'nav.captures', descKey: 'nav.captures.desc', icon: Camera, component: CapturesView },
  { value: 'memory', section: 'log', labelKey: 'nav.memory', descKey: 'nav.memory.desc', icon: Brain, component: MemoryView },
  { value: 'reports', section: 'log', labelKey: 'nav.reports', descKey: 'nav.reports.desc', icon: Newspaper, component: ReportsView },
  { value: 'graph', section: 'system', labelKey: 'nav.graph', descKey: 'nav.graph.desc', icon: Share2, component: GraphView },
  { value: 'metrics', section: 'system', labelKey: 'nav.metrics', descKey: 'nav.metrics.desc', icon: Gauge, component: MetricsView },
  { value: 'catalog', section: 'system', labelKey: 'nav.catalog', descKey: 'nav.catalog.desc', icon: BookMarked, component: CatalogView },
  { value: 'system', section: 'system', labelKey: 'nav.system', descKey: 'nav.system.desc', icon: MonitorCog, component: SystemView },
] as const;

type NavValue = (typeof NAV)[number]['value'];
type NavSection = (typeof NAV_SECTIONS)[number];

function isNavValue(v: string): v is NavValue {
  return (NAV as readonly { value: string }[]).some((n) => n.value === v);
}

function useHealthPoll() {
  const [ok, setOk] = useState<boolean | null>(null);
  const [stale, setStale] = useState(false);
  const startedAt = useRef<string | null>(null);
  // Deliberately slower than the 10 s view polls (see usePoll in viz.tsx):
  // health is a coarse liveness signal, not store data.
  useEffect(() => {
    let cancelled = false;
    const check = () => {
      api
        .health()
        .then((h) => {
          if (cancelled) return;
          setOk(true);
          // A new startedAt means the API respawned (supervised reload or
          // manual restart): mounted queries may hold payloads shaped by
          // the old code — revalidate everything without a page reload.
          if (h.startedAt !== undefined) {
            if (startedAt.current !== null && startedAt.current !== h.startedAt) {
              reloadAllApis();
            }
            startedAt.current = h.startedAt;
          }
          // A supervised server self-heals within ~1s of a src change, so
          // its transient stale flag would only flash the banner; a manual
          // (--no-reload) server stays stale until restarted — flag it.
          setStale(h.stale === true && h.reloadMode !== 'supervised');
        })
        .catch(() => {
          if (cancelled) return;
          setOk(false);
          setStale(false);
        });
    };
    check();
    const timer = setInterval(check, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
  return { ok, stale };
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
        healthy === true && toneClasses('ok').badge,
        healthy === false && toneClasses('err').badge,
      )}
    >
      <span className="relative flex h-1.5 w-1.5">
        {healthy === true && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-60" />
        )}
        <span
          className={cn(
            'relative inline-flex h-1.5 w-1.5 rounded-full',
            healthy === null && 'bg-muted-foreground',
            healthy === true && 'bg-ok',
            healthy === false && 'bg-err',
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
  const route = useHashRoute();
  const { ok: healthy, stale } = useHealthPoll();
  const locale = useLocale();
  const t = useT();
  // Unknown or empty hashes resolve to the default view; the hash itself
  // stays untouched so a typo does not silently rewrite the URL.
  const view: NavValue = isNavValue(route.view) ? route.view : 'workspace';
  const setView = (v: NavValue) => navigate(v);

  // Adopt the project-configured locale once, unless the user already chose.
  useEffect(() => {
    api
      .workspace()
      .then((ws) => adoptProjectLocale(ws.project.locale))
      .catch(() => undefined);
  }, []);

  // Keep <html lang> in sync with the active locale (index.html ships 'en').
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  // Test isolation only: jsdom shares window.location across renders in
  // one file, so unmounting releases the route for the next mount.
  // Guarded by MODE — in dev StrictMode the simulated unmount would
  // otherwise clear a legitimate deep-link on first load.
  useEffect(
    () => () => {
      if (import.meta.env.MODE === 'test') clearRoute();
    },
    [],
  );

  const current = NAV.find((n) => n.value === view) ?? NAV[0];
  const CurrentIcon = current.icon;

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background text-foreground">
        {/* href stays for semantics but never navigates: '#main' would
            clobber the '#/view' route hash. Focus is moved explicitly. */}
        <a
          href="#main"
          onClick={(e) => {
            e.preventDefault();
            document.getElementById('main')?.focus();
          }}
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:ring-2 focus:ring-ring"
        >
          {t('app.skip')}
        </a>
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

        {stale ? (
          <div
            role="status"
            className="border-b border-warn/40 bg-warn/10 px-4 py-1.5 text-center text-xs text-warn"
          >
            {t('app.api.stale')}
          </div>
        ) : null}

        <Tabs
          orientation="vertical"
          value={view}
          onValueChange={(v) => setView(v as NavValue)}
          className="mx-auto max-w-[88rem] gap-0"
        >
          <aside className="hidden w-52 shrink-0 border-r md:block">
            <nav
              className="sticky overflow-y-auto"
              style={{
                top: HEADER_H_PX,
                maxHeight: `calc(100vh - ${HEADER_H_PX}px)`,
              }}
              aria-label={t('nav.views')}
            >
              <TabsList
                variant="line"
                className="h-auto w-full flex-col items-stretch gap-0.5 rounded-none p-2"
              >
                {NAV_SECTIONS.map((section: NavSection, i) => (
                  <div key={section} className="flex flex-col gap-0.5">
                    <div
                      className={cn(
                        'px-3 pb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground',
                        i === 0 ? 'pt-1' : 'pt-3',
                      )}
                    >
                      {t(`nav.section.${section}`)}
                    </div>
                    {NAV.filter((n) => n.section === section).map(
                      ({ value, labelKey, icon: Icon }) => (
                        <TabsTrigger
                          key={value}
                          value={value}
                          className="justify-start gap-2.5 rounded-md px-3 py-2 text-sm transition-colors duration-200 data-active:text-primary group-data-[variant=line]/tabs-list:data-active:after:bg-primary"
                        >
                          <Icon className="h-4 w-4" aria-hidden />
                          {t(labelKey)}
                        </TabsTrigger>
                      ),
                    )}
                  </div>
                ))}
              </TabsList>
            </nav>
          </aside>

          <main id="main" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6">
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
                  {NAV_SECTIONS.map((section) => (
                    <SelectGroup key={section}>
                      <SelectLabel>
                        {t(`nav.section.${section}`)}
                      </SelectLabel>
                      {NAV.filter((n) => n.section === section).map(
                        ({ value, labelKey }) => (
                          <SelectItem key={value} value={value}>
                            {t(labelKey)}
                          </SelectItem>
                        ),
                      )}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div
              key={`header-${view}`}
              className="mb-5 flex items-start gap-3 animate-in fade-in-50 slide-in-from-top-1 duration-200"
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

            <ErrorBoundary
              key={`boundary-${view}`}
              region={t(current.labelKey)}
              locale={locale}
            >
              {NAV.map(({ value, component: View }) => (
                <TabsContent key={value} value={value}>
                  <View />
                </TabsContent>
              ))}
            </ErrorBoundary>
          </main>
        </Tabs>
      </div>
    </TooltipProvider>
  );
}
