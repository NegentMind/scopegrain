// Minimal locale store + dictionary for the read-only viewer.
// Precedence: explicit user choice (localStorage) > project config locale
// (api.workspace().project.locale, adopted on first load) > 'en'.
import { useSyncExternalStore } from 'react';

export type Locale = 'en' | 'es';

const STORAGE_KEY = 'scopegrain-viewer-locale';
const listeners = new Set<() => void>();
let current: Locale = 'en';
let adopted = false;

try {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'en' || stored === 'es') {
    current = stored;
    adopted = true; // explicit choice always wins over project default
  }
} catch {
  // storage unavailable (private mode) — fall back to 'en'
}

function emit() {
  for (const fn of listeners) fn();
}

export function setLocale(next: Locale, { persist = true } = {}) {
  if (next !== 'en' && next !== 'es') return;
  current = next;
  if (persist) {
    adopted = true;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }
  emit();
}

// One-time project-locale adoption, only when the user has not chosen yet.
export function adoptProjectLocale(locale: unknown) {
  if (adopted) return;
  if (locale === 'en' || locale === 'es') {
    current = locale;
    adopted = true;
    emit();
  }
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, () => current);
}

const DICT: Record<Locale, Record<string, string>> = {
  en: {
    'app.title': 'Scopegrain Viewer',
    'app.api.unknown': 'api…',
    'app.api.ok': 'api ok',
    'app.api.down': 'api down',
    'app.api.aria.unknown': 'API status unknown',
    'app.api.aria.ok': 'API connected',
    'app.api.aria.down': 'API unreachable',
    'app.locale': 'Language',
    'nav.workspace': 'Workspace',
    'nav.tasks': 'Work items',
    'nav.journal': 'Journal',
    'nav.artifacts': 'Artifacts',
    'nav.captures': 'Captures',
    'nav.memory': 'Memory',
    'nav.goals': 'Goals',
    'nav.metrics': 'Metrics',
    'nav.reports': 'Reports',
    'nav.views': 'Views',
    'common.title': 'Title',
    'common.state': 'State',
    'common.updated': 'Updated',
    'common.key': 'Key',
    'common.name': 'Name',
    'common.loading': 'Loading…',
    'common.retry': 'Retry',
    'common.requestFailed': 'Request failed',
    'common.malformedSuffix': ' (surfaced, not dropped)',
    'common.malformedEntries': 'malformed entries (surfaced, not dropped)',
    'common.none': '—',
    'common.select': 'Select',
    'workspace.storeCounts': 'Store counts',
    'workspace.storeCountsDesc': 'Bounded listing of configured paths',
    'workspace.tasksByState': 'Tasks by state',
    'workspace.enrolledAreas': 'Enrolled areas',
    'workspace.areaId': 'Area id',
    'workspace.noWorkspace': 'No workspace enrolled',
    'workspace.project': 'Project',
    'workspace.plans': 'Plans',
    'tasks.title': 'Work items',
    'tasks.detail': 'Task detail',
    'tasks.selectTask': 'Select a task',
    'tasks.route': 'Route',
    'tasks.contract': 'Contract',
    'tasks.authorContext': 'Author context',
    'tasks.scope': 'Scope',
    'tasks.history': 'History',
    'journal.operations': 'Journal operations',
    'journal.events': 'Events',
    'journal.opEvents': 'Operation events',
    'journal.selectOperation': 'Select an operation',
    'artifacts.title': 'Artifacts',
    'artifacts.view': 'View',
    'artifacts.detail': 'Artifact',
    'artifacts.selectArtifact': 'Select an artifact',
    'artifacts.body': 'Body',
    'artifacts.references': 'References',
    'captures.title': 'Captures',
    'captures.proof': 'Proof',
    'captures.category': 'Category',
    'memory.title': 'Operational memory',
    'memory.log': 'Log',
    'memory.entries': 'entries',
    'memory.empty': 'No entries yet',
    'memory.at': 'At',
    'memory.detail': 'Detail',
    'goals.title': 'Goals',
    'goals.status': 'Status',
    'goals.horizon': 'Horizon',
    'goals.description': 'Description',
    'goals.linked': 'Linked tasks',
    'goals.empty': 'No goals recorded',
    'metrics.title': 'Derived metrics',
    'metrics.tasksTotal': 'Tasks',
    'metrics.byState': 'By state',
    'metrics.byBacklog': 'By backlog',
    'metrics.byType': 'By type',
    'metrics.byPriority': 'By priority',
    'metrics.byDisposition': 'By disposition',
    'metrics.verification': 'Verification',
    'metrics.firstTry': 'First-try rate',
    'metrics.passRate': 'Pass rate',
    'metrics.durations': 'Durations',
    'metrics.skillOutcomes': 'Skill outcomes',
    'metrics.skill': 'Skill',
    'metrics.derived': 'Derived on read — not an authoritative audit store',
    'reports.title': 'Saved reports',
    'reports.file': 'File',
    'reports.status': 'Status',
    'reports.selectReport': 'Select a report',
    'reports.detail': 'Report detail',
    'reports.empty': 'No saved reports',
    'reports.summary': 'Summary',
    'common.truncatedByApi': ' (truncated by API)',
    'tasks.count': 'tasks',
    'tasks.empty': 'No tasks recorded yet.',
    'tasks.selectPrompt': 'Select a task from the list.',
    'journal.empty': 'No journal operations.',
    'journal.selectPrompt': 'Select an operation to see its events.',
    'journal.kind': 'Kind',
    'journal.operation': 'Operation',
    'artifacts.empty': 'No artifacts of this kind.',
    'artifacts.selectPrompt': 'Select an artifact to inspect it.',
    'artifacts.kind': 'Kind',
    'captures.empty': 'No captures recorded.',
    'captures.description':
      'Typed notes with journal-proved ownership. proved = sidecar + committed two-event operation + current bytes match snapshot; drifted = current source differs from its snapshot.',
    'workspace.loading': 'Loading workspace…',
    'workspace.methodology': 'methodology',
    'workspace.locale': 'locale',
    'workspace.hosts': 'hosts',
    'workspace.tasks': 'tasks',
    'workspace.plansCount': 'plans',
    'workspace.artifacts': 'artifacts',
    'workspace.captures': 'captures',
    'workspace.journalOps': 'journal ops',
    'workspace.paths': 'Configured paths',
    'plans.ready': 'ready',
    'plans.blocked': 'blocked',
    'plans.closed': 'closed',
    'plans.active': 'active',
    'plans.tasks': 'tasks',
    'plans.empty': 'No plans recorded.',
    'plans.description': 'Dependency DAGs with readiness from current task state.',
    'plans.blockedBy': 'blocked by',
    'plans.readinessUnavailable': 'readiness unavailable:',
    'journal.selectPromptFull': 'Select an operation from the list.',
    'artifacts.count': 'artifacts',
    'artifacts.selectPromptFull': 'Select an artifact from the list.',
    'artifacts.created': 'Created',
    'workspace.noData': 'No workspace data.',
    'workspace.count': 'Count',
    'workspace.malformedTasks': 'malformed tasks',
    'workspace.enrolledDesc': 'Logical scopes; not OS ACLs or a sandbox.',
    'workspace.notEnrolled': 'Project is not enrolled: no workspace descriptor. Journal and capture endpoints report WORKSPACE_NOT_FOUND.',
    'error.retryAria': 'Retry request',
    'artifacts.bodyTruncated': 'Body truncated by the API bounds.',
    'artifacts.specBinding': 'Spec binding',
  },
  es: {
    'app.title': 'Visor de Scopegrain',
    'app.api.unknown': 'api…',
    'app.api.ok': 'api ok',
    'app.api.down': 'api caída',
    'app.api.aria.unknown': 'Estado de la API desconocido',
    'app.api.aria.ok': 'API conectada',
    'app.api.aria.down': 'API inalcanzable',
    'app.locale': 'Idioma',
    'nav.workspace': 'Espacio de trabajo',
    'nav.tasks': 'Tareas',
    'nav.journal': 'Diario',
    'nav.artifacts': 'Artefactos',
    'nav.captures': 'Capturas',
    'nav.memory': 'Memoria',
    'nav.goals': 'Metas',
    'nav.metrics': 'Métricas',
    'nav.reports': 'Informes',
    'nav.views': 'Vistas',
    'common.title': 'Título',
    'common.state': 'Estado',
    'common.updated': 'Actualizado',
    'common.key': 'Clave',
    'common.name': 'Nombre',
    'common.loading': 'Cargando…',
    'common.retry': 'Reintentar',
    'common.requestFailed': 'La solicitud falló',
    'common.malformedSuffix': ' (mostradas, no descartadas)',
    'common.malformedEntries': 'entradas malformadas (mostradas, no descartadas)',
    'common.none': '—',
    'common.select': 'Seleccionar',
    'workspace.storeCounts': 'Conteos de almacenes',
    'workspace.storeCountsDesc': 'Listado acotado de rutas configuradas',
    'workspace.tasksByState': 'Tareas por estado',
    'workspace.enrolledAreas': 'Áreas inscritas',
    'workspace.areaId': 'Id de área',
    'workspace.noWorkspace': 'Sin espacio de trabajo inscrito',
    'workspace.project': 'Proyecto',
    'workspace.plans': 'Planes',
    'tasks.title': 'Tareas',
    'tasks.detail': 'Detalle de tarea',
    'tasks.selectTask': 'Selecciona una tarea',
    'tasks.route': 'Ruta',
    'tasks.contract': 'Contrato',
    'tasks.authorContext': 'Contexto de autor',
    'tasks.scope': 'Alcance',
    'tasks.history': 'Historial',
    'journal.operations': 'Operaciones del diario',
    'journal.events': 'Eventos',
    'journal.opEvents': 'Eventos de la operación',
    'journal.selectOperation': 'Selecciona una operación',
    'artifacts.title': 'Artefactos',
    'artifacts.view': 'Ver',
    'artifacts.detail': 'Artefacto',
    'artifacts.selectArtifact': 'Selecciona un artefacto',
    'artifacts.body': 'Cuerpo',
    'artifacts.references': 'Referencias',
    'captures.title': 'Capturas',
    'captures.proof': 'Prueba',
    'captures.category': 'Categoría',
    'memory.title': 'Memoria operativa',
    'memory.log': 'Registro',
    'memory.entries': 'entradas',
    'memory.empty': 'Sin entradas todavía',
    'memory.at': 'Fecha',
    'memory.detail': 'Detalle',
    'goals.title': 'Metas',
    'goals.status': 'Estado',
    'goals.horizon': 'Horizonte',
    'goals.description': 'Descripción',
    'goals.linked': 'Tareas enlazadas',
    'goals.empty': 'Sin metas registradas',
    'metrics.title': 'Métricas derivadas',
    'metrics.tasksTotal': 'Tareas',
    'metrics.byState': 'Por estado',
    'metrics.byBacklog': 'Por backlog',
    'metrics.byType': 'Por tipo',
    'metrics.byPriority': 'Por prioridad',
    'metrics.byDisposition': 'Por disposición',
    'metrics.verification': 'Verificación',
    'metrics.firstTry': 'Tasa a la primera',
    'metrics.passRate': 'Tasa de acierto',
    'metrics.durations': 'Duraciones',
    'metrics.skillOutcomes': 'Resultados por skill',
    'metrics.skill': 'Skill',
    'metrics.derived': 'Derivadas al leer — no son un almacén de auditoría',
    'reports.title': 'Informes guardados',
    'reports.file': 'Archivo',
    'reports.status': 'Estado',
    'reports.selectReport': 'Selecciona un informe',
    'reports.detail': 'Detalle del informe',
    'reports.empty': 'Sin informes guardados',
    'reports.summary': 'Resumen',
    'common.truncatedByApi': ' (truncado por la API)',
    'tasks.count': 'tareas',
    'tasks.empty': 'Sin tareas registradas.',
    'tasks.selectPrompt': 'Selecciona una tarea de la lista.',
    'journal.empty': 'Sin operaciones en el diario.',
    'journal.selectPrompt': 'Selecciona una operación para ver sus eventos.',
    'journal.kind': 'Tipo',
    'journal.operation': 'Operación',
    'artifacts.empty': 'Sin artefactos de este tipo.',
    'artifacts.selectPrompt': 'Selecciona un artefacto para inspeccionarlo.',
    'artifacts.kind': 'Tipo',
    'captures.empty': 'Sin capturas registradas.',
    'captures.description':
      'Notas tipadas con propiedad probada en el diario. proved = sidecar + operación de dos eventos confirmada + bytes actuales coinciden con el snapshot; drifted = el origen actual difiere de su snapshot.',
    'workspace.loading': 'Cargando espacio de trabajo…',
    'workspace.methodology': 'metodología',
    'workspace.locale': 'idioma',
    'workspace.hosts': 'hosts',
    'workspace.tasks': 'tareas',
    'workspace.plansCount': 'planes',
    'workspace.artifacts': 'artefactos',
    'workspace.captures': 'capturas',
    'workspace.journalOps': 'ops. diario',
    'workspace.paths': 'Rutas configuradas',
    'plans.ready': 'listas',
    'plans.blocked': 'bloqueadas',
    'plans.closed': 'cerradas',
    'plans.active': 'activas',
    'plans.tasks': 'tareas',
    'plans.empty': 'Sin planes registrados.',
    'plans.description': 'DAGs de dependencias con disponibilidad según el estado actual de las tareas.',
    'plans.blockedBy': 'bloqueada por',
    'plans.readinessUnavailable': 'disponibilidad no disponible:',
    'journal.selectPromptFull': 'Selecciona una operación de la lista.',
    'artifacts.count': 'artefactos',
    'artifacts.selectPromptFull': 'Selecciona un artefacto de la lista.',
    'artifacts.created': 'Creado',
    'workspace.noData': 'Sin datos del espacio de trabajo.',
    'workspace.count': 'Cantidad',
    'workspace.malformedTasks': 'tareas malformadas',
    'workspace.enrolledDesc': 'Ámbitos lógicos; no son ACLs del SO ni un sandbox.',
    'workspace.notEnrolled': 'Proyecto no inscrito: sin descriptor de espacio de trabajo. Los endpoints de diario y capturas responden WORKSPACE_NOT_FOUND.',
    'error.retryAria': 'Reintentar la solicitud',
    'artifacts.bodyTruncated': 'Cuerpo truncado por los límites de la API.',
    'artifacts.specBinding': 'Vinculación de spec',
  },
};

export function t(locale: Locale, key: string): string {
  return DICT[locale][key] ?? DICT.en[key] ?? key;
}

export function useT() {
  const locale = useLocale();
  return (key: string) => t(locale, key);
}
