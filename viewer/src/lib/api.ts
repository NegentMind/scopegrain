// Typed client for the read-only Scopegrain JSON API (src/api/server.mjs).
// Every payload shape mirrors the endpoint contract; error bodies are
// {error:{code,message}} and surface as ApiError instances.

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export interface Health {
  status: 'ok';
  api: string;
  schemaVersion: number;
  serverTime: string;
}

export interface WorkspaceArea {
  id: string;
  key: string;
  name: string;
}

export interface WorkspaceSummary {
  project: {
    name: string;
    configPath: string;
    methodology: string;
    locale: string;
    hosts: string[];
    paths: Record<string, string>;
  };
  workspace: {
    workspaceId: string;
    projectId: string;
    repositoryId: string;
    revision: number;
    createdAt: string;
    updatedAt: string;
    areas: WorkspaceArea[];
  } | null;
  counts: {
    tasks: number;
    tasksByState: Record<string, number>;
    malformedTasks: number;
    plans: number;
    artifacts: Record<string, number | null>;
    captures: number | string | null;
    journalOperations: number | string | null;
  };
}

export interface TaskDisposition {
  kind: string;
  reason?: string | null;
  at?: string | null;
  by?: string | null;
}

export interface MalformedEntry {
  file: string;
  error: { code: string; message: string };
}

export interface TaskSummary {
  id: string;
  schemaVersion: number;
  title: string;
  titleTruncated: boolean;
  state: string;
  revision: number;
  scopeCount: number;
  methodologyRoute: string | null;
  specId: string | null;
  designId: string | null;
  planKey: string | null;
  scenarioRefCount: number;
  verificationStatus: string | null;
  reviewVerdict: string | null;
  createdAt: string;
  updatedAt: string;
  backlog: string | null;
  disposition: TaskDisposition | null;
  priority: string | null;
  type: string | null;
  effort: string | null;
  source: string | null;
  dependsOn: string[];
  relations: Record<string, string[]>;
  goalIds: string[];
  stepsTotal: number;
  stepsDone: number;
  uncertainty: string | null;
}

export interface TaskHistoryEntry {
  at: string;
  event: string;
  state?: string;
  revision?: number;
  [key: string]: unknown;
}

export interface TaskDetail {
  id: string;
  schemaVersion: number;
  title: string;
  titleTruncated?: boolean;
  contract: string;
  contractTruncated: boolean;
  authorContext: string;
  authorContextTruncated: boolean;
  scope: string[];
  state: string;
  revision: number;
  verification: unknown;
  review: unknown;
  createdAt: string;
  updatedAt: string;
  history: TaskHistoryEntry[];
  methodology?: unknown;
  specId?: string | null;
  designId?: string | null;
  planKey?: string | null;
  scenarioRefs?: { requirementId: string; scenarioId: string }[];
  backlog?: string | null;
  disposition?: TaskDisposition | null;
  priority?: string | null;
  severity?: string | null;
  type?: string | null;
  effort?: string | null;
  estimate?: { turns?: number; appetite?: string } | null;
  source?: string | null;
  dependsOn?: string[];
  relations?: Record<string, string[]>;
  goalIds?: string[];
  analysis?: {
    blastRadius?: string; impact?: string; invariants?: string[];
    debt?: string; debugEvidence?: string; security?: string;
    performance?: string; [k: string]: unknown;
  } | null;
  steps?: {
    name?: string; text?: string; status: string;
    verify?: string; files?: string[]; action?: string;
  }[];
  notes?: ({ text: string; at?: string; by?: string } | string)[];
  skills?: string[];
  uncertainty?: { uphill?: number; downhill?: number } | string | null;
  methodologyRoute?: string | null;
}

export interface TaskDoc {
  id: string;
  doc: string | null;
  docTruncated?: boolean | null;
  bytes?: number;
  updatedAt?: string;
}

export interface PlanDocSummary {
  name: string;
  title?: string;
  status?: string | null;
  kind?: string | null;
  date?: string | null;
  bytes: number;
  updatedAt: string;
}

export interface PlanDoc {
  name: string;
  doc: string;
  docTruncated?: boolean | null;
  bytes: number;
  updatedAt: string;
}

export interface ArtifactDocSummary {
  name: string;
  dir: string;
  title: string;
  status?: string | null;
  date?: string | null;
  bytes: number;
  updatedAt: string;
}

export interface ArtifactDoc {
  kind: ArtifactKind;
  name: string;
  dir: string;
  doc: string;
  docTruncated?: boolean | null;
  bytes: number;
  updatedAt: string;
}

export interface TaskList {
  tasks: TaskSummary[];
  malformed: MalformedEntry[];
  truncated: boolean;
}

export interface PlanReadiness {
  key: string;
  id: string;
  state: string;
  status: 'closed' | 'ready' | 'blocked' | 'active';
  blockedBy: string[];
}

export interface PlanMemberTask {
  key: string;
  id: string;
  dependsOn: string[];
  title: string | null;
  state: string | null;
  disposition: TaskDisposition | null;
  triage: string | null;
  triageReason: string | null;
  error?: { code: string; message: string } | null;
}

export type PlanStatus = 'empty' | 'pending' | 'in_progress' | 'completed';

export interface PlanBreakdown {
  tasks: PlanMemberTask[];
  done: number;
  total: number;
  active: number;
  progress: number | null;
  status: PlanStatus;
}

export interface PlanWaveTask {
  key: string;
  id?: string;
  state?: string;
  status?: string;
  triage?: string;
}

export interface PlanWaves {
  plan: string | { key: string; title: string };
  waves: { wave?: number; parallel: boolean; tasks: (string | PlanWaveTask)[] }[];
  triaged?: { key: string; triage: string; reason?: string }[];
  unscheduled?: (string | PlanWaveTask)[];
  closed?: string[];
}

export interface PlanRunCheckpoint {
  at: string;
  waveCount: number;
  closed: string[];
  remaining: string[];
  completedTasks: number;
  totalTasks: number;
  percent: number;
}

export interface PlanRunState {
  persisted: boolean;
  path: string;
  run: {
    schemaVersion: number;
    planKey: string;
    revision: number;
    createdAt: string;
    updatedAt: string;
    checkpoints: PlanRunCheckpoint[];
    latest: PlanRunCheckpoint;
  } | null;
  resume: {
    totalTasks: number;
    completedTasks: number;
    remainingTasks: string[];
    remainingWaves: number;
    percent: number;
    completedSinceLastCheckpoint: string[];
    complete: boolean;
  };
}

export interface PlanSummary extends PlanBreakdown {
  key: string;
  schemaVersion: number;
  title: string;
  authorContext: string;
  inputDigest: string;
  createdAt: string;
  specId: string | null;
  designId: string | null;
  taskCount: number;
  readiness: PlanReadiness[] | null;
  readinessError: { code: string; message: string } | null;
}

export interface PlanList {
  plans: PlanSummary[];
  malformed: MalformedEntry[];
}

export interface PlanDetail extends PlanBreakdown {
  plan: {
    schemaVersion: number;
    key: string;
    title: string;
    authorContext: string;
    inputDigest: string;
    tasks: { key: string; id: string; dependsOn: string[] }[];
    createdAt: string;
    specId?: string;
    designId?: string;
    appetite?: string | null;
    cynefin?: string | null;
    stopConditions?: string[] | null;
  };
  readiness: PlanReadiness[];
  waves: PlanWaves | null;
  wavesError: { code: string; message: string } | null;
  runState?: PlanRunState | null;
}

export type ArtifactKind =
  | 'spec' | 'design' | 'report' | 'research'
  | 'decision' | 'lesson' | 'handoff' | 'review';

export interface ArtifactSummary {
  id: string;
  kind: ArtifactKind;
  schemaVersion: number;
  title: string;
  body: string;
  bodyTruncated: boolean;
  references: string[];
  createdAt: string;
  data: unknown;
}

export interface ArtifactList {
  kind: ArtifactKind;
  artifacts: ArtifactSummary[];
  malformed: MalformedEntry[];
  truncated: boolean;
}

export interface JournalEvent {
  schemaVersion: number;
  eventId: string;
  operationId: string;
  journalSequence: number;
  workspaceId: string;
  projectId: string;
  repositoryId: string;
  areaIds: string[];
  sourceKind: string;
  recordId: string;
  sourceRevision: number | null;
  sourceRel: string;
  previousHash: string | null;
  sourceHash: string;
  snapshotRef: string;
  operation: string;
  createdAt: string;
}

export interface JournalOperationSummary {
  operationId: string;
  state: 'prepared' | 'committed' | 'abandoned' | string;
  intentDigest: string;
  createdAt: string;
  eventCount: number;
  sourceKinds: string[];
  recordIds: string[];
  hasRecovery: boolean;
}

export interface JournalOperationList {
  operations: JournalOperationSummary[];
  malformed: MalformedEntry[];
  truncated: boolean;
}

export interface JournalOperationDetail {
  operationId: string;
  state: string;
  intentDigest: string;
  intent: {
    schemaVersion: number;
    operationId: string;
    state: string;
    createdAt: string;
    events: JournalEvent[];
  };
  recovery: {
    action: string;
    reason: string;
    decidedAt: string;
    [key: string]: unknown;
  } | null;
}

export type CaptureStatus =
  | 'proved' | 'drifted' | 'unconfirmed' | 'unproved' | 'malformed' | 'error';

export interface CaptureItem {
  id: string;
  status: CaptureStatus;
  ownershipConfirmed: boolean;
  record: {
    kind: string;
    revision: number;
    category: string;
    title: string;
    summary: string;
    summaryTruncated: boolean;
    subjectId: string | null;
    supersedes: string | null;
    capturedAt: string;
    provenance: { basis: string; origin: string };
  } | null;
  scope: { areaIds: string[] } | null;
  locator: { operationId: string; eventId: string } | null;
  error?: { code: string; message: string };
}

export interface CaptureList {
  captures: CaptureItem[];
  malformed: MalformedEntry[];
  truncated: boolean;
}

export type MemoryLogName =
  | 'lessons' | 'outcomes' | 'progress' | 'goals' | 'activity';

export interface MemoryLogResult {
  log: MemoryLogName;
  entries: Record<string, unknown>[];
  malformed: { line: string }[];
}

export interface GoalLinkedTask {
  id: string;
  title: string;
  state: string;
  disposition: TaskDisposition | null;
  priority: string | null;
  type: string | null;
}

export interface Goal {
  id: string;
  title: string;
  description: string | null;
  status: 'open' | 'achieved' | 'dropped';
  horizon: string | null;
  metrics: string | null;
  tasks: GoalLinkedTask[];
  taskCount: number;
  tasksDone: number;
  progress: number | null;
  [key: string]: unknown;
}

export interface GoalList {
  goals: Goal[];
  malformed: { line: string }[];
}

export interface Metrics {
  schemaVersion: number;
  tasks: {
    total: number;
    byState: Record<string, number>;
    byBacklog: Record<string, number>;
    byType: Record<string, number>;
    byPriority: Record<string, number>;
    byDisposition: Record<string, number>;
  };
  verification: {
    checks: number;
    passed: number;
    passRate: number | null;
    firstTryTotal: number;
    firstTryPass: number;
    firstTryRate: number | null;
  };
  durationMs: { p50: number | null; p95: number | null; p99: number | null };
  skillOutcomes: Record<string, { ok: number; fail: number }>;
  malformed: MalformedEntry[];
}

export interface ReportList {
  reports: string[];
  malformed: MalformedEntry[];
  truncated: boolean;
}

export interface ReportDetail {
  name: string;
  report: {
    schemaVersion: number;
    status: string;
    summary?: { ok: number; warnings: number; failures: number };
    checks?: { name: string; ok: boolean; detail: string; severity?: string }[];
    [key: string]: unknown;
  };
}

async function request<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' } });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // fall through to the generic error below
  }
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string } } | null)
      ?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'HTTP_ERROR',
      err?.message ?? `request failed with status ${res.status}`,
    );
  }
  return body as T;
}

export const api = {
  health: () => request<Health>('/api/health'),
  workspace: () => request<WorkspaceSummary>('/api/workspace'),
  tasks: (limit = 200) =>
    request<TaskList>(`/api/tasks?limit=${encodeURIComponent(limit)}`),
  task: (id: string) =>
    request<{ task: TaskDetail }>(`/api/tasks/${encodeURIComponent(id)}`),
  taskDoc: (id: string) =>
    request<TaskDoc>(`/api/tasks/${encodeURIComponent(id)}/doc`),
  plans: () => request<PlanList>('/api/plans'),
  planDocs: () =>
    request<{ docs: PlanDocSummary[]; truncated?: boolean | null }>(
      '/api/plan-docs'),
  planDoc: (name: string) =>
    request<PlanDoc>(`/api/plan-docs/${encodeURIComponent(name)}`),
  plan: (key: string) =>
    request<PlanDetail>(`/api/plans/${encodeURIComponent(key)}`),
  artifactDocs: (kind: ArtifactKind) =>
    request<{ kind: ArtifactKind; docs: ArtifactDocSummary[] }>(
      `/api/artifact-docs?kind=${encodeURIComponent(kind)}`),
  artifactDoc: (kind: ArtifactKind, name: string) =>
    request<ArtifactDoc>(
      `/api/artifact-docs/${encodeURIComponent(kind)}/${encodeURIComponent(name)}`),
  artifacts: (kind: ArtifactKind, limit = 200) =>
    request<ArtifactList>(
      `/api/artifacts?kind=${encodeURIComponent(kind)}&limit=${encodeURIComponent(limit)}`),
  artifact: (kind: ArtifactKind, id: string) =>
    request<{ artifact: ArtifactSummary }>(
      `/api/artifacts/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`),
  journalOperations: (limit = 200) =>
    request<JournalOperationList>(
      `/api/journal/operations?limit=${encodeURIComponent(limit)}`),
  journalOperation: (id: string) =>
    request<JournalOperationDetail>(
      `/api/journal/operations/${encodeURIComponent(id)}`),
  captures: (limit = 200) =>
    request<CaptureList>(`/api/captures?limit=${encodeURIComponent(limit)}`),
  memory: (log: MemoryLogName, tail = 200) =>
    request<MemoryLogResult>(
      `/api/memory?log=${encodeURIComponent(log)}&tail=${encodeURIComponent(tail)}`),
  goals: () => request<GoalList>('/api/goals'),
  metrics: () => request<Metrics>('/api/metrics'),
  reports: (limit = 200) =>
    request<ReportList>(`/api/reports?limit=${encodeURIComponent(limit)}`),
  report: (name: string) =>
    request<ReportDetail>(`/api/reports/${encodeURIComponent(name)}`),
  sessions: (limit = 200) =>
    request<SessionList>(`/api/sessions?limit=${encodeURIComponent(limit)}`),
  session: (id: string) =>
    request<{ session: SessionRecord; resumeContext?: SessionResumeContext }>(
      `/api/sessions/${encodeURIComponent(id)}`),
  approvals: (limit = 200) =>
    request<ApprovalList>(`/api/approvals?limit=${encodeURIComponent(limit)}`),
  approval: (id: string) =>
    request<{ approval: ApprovalRecord }>(`/api/approvals/${encodeURIComponent(id)}`),
  catalog: () => request<CatalogResponse>('/api/catalog'),
  verify: () => request<VerifyResponse>('/api/verify'),
  vantadb: () => request<VantaDBResponse>('/api/vantadb'),
  workflow: () => request<WorkflowResponse>('/api/workflow'),
};

export interface SessionSummary {
  id: string;
  taskId: string;
  limit: number;
  used: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
  events: number;
}
export interface SessionEvent {
  action: string;
  evidence: string;
  context: string;
  at: string;
  // Self-reported caller declaration (v2 sessions only); never observed.
  tokens?: { prompt: number; completion: number; total: number };
}
export interface SessionRecord extends Omit<SessionSummary, 'events'> {
  events: SessionEvent[];
  // Writer schema is v2; stored v1 documents lack tokenLimit entirely.
  tokenLimit?: number | null;
}
export interface SessionResumeContext {
  task: {
    id: string;
    title: string;
    state: string;
    revision: number;
    scope: string[];
    planKey: string | null;
    specId: string | null;
    designId: string | null;
    goalIds: string[];
  } | null;
  budget: { used: number; limit: number; remaining: number; percent: number };
  tokenUsage?: {
    reported: number;
    limit: number | null;
    remaining: number | null;
    percent: number | null;
    measures: string;
  };
  lastEvent: SessionEvent | null;
  resumeCommand: string;
}
export interface SessionList { sessions: SessionSummary[]; malformed: { file: string }[]; truncated: boolean }

export interface ApprovalSummary {
  id: string;
  status: string;
  target: { kind?: string; id?: string; artifactKind?: string; [k: string]: unknown };
  specId: string | null;
  createdAt: string;
  updatedAt: string;
  answers: number;
}
export interface ApprovalRecord extends Omit<ApprovalSummary, 'answers'> {
  answers: { answer: string; actor?: string; at?: string; rationale?: string }[] | number;
  scope?: { paths?: string[] };
  digest?: string;
  [k: string]: unknown;
}
export interface ApprovalList { approvals: ApprovalSummary[]; malformed: { file: string }[]; truncated: boolean }

export type CatalogDepKey =
  | 'agents' | 'skills' | 'rules' | 'references' | 'prompts' | 'mcps';
export interface CatalogEntry {
  id: string;
  description: string;
  path: string | null;
  modes?: string[];
  // Manifest bindings surfaced verbatim (only the keys the entry declares).
  agents?: string[];
  skills?: string[];
  rules?: string[];
  references?: string[];
  prompts?: string[];
  mcps?: string[];
}
export interface CatalogAlias {
  kind: string;
  id: string;
  target: string;
  mode?: string;
  default?: boolean;
  targetMode?: string;
  parameters?: Record<string, string>;
}
export interface CatalogResponse {
  catalog: {
    counts: Record<string, number>;
    entries: Record<string, CatalogEntry[]>;
    truncated?: boolean | null;
    aliases: CatalogAlias[];
  };
}

export interface VerifyCommand {
  id: string; command: string; argv: string[]; cwd: string;
  source: string; approved: boolean; fingerprint: string;
  [k: string]: unknown;
}
export interface VerifyResponse { store: string; commands: VerifyCommand[]; truncated: boolean }

export interface VantaDBStatus {
  configured: boolean;
  config?: { backendId: string; version: string; binaryPath: string; storagePath: string };
  binaryPresent?: boolean;
  storagePresent?: boolean;
  pendingCommittedEvents?: number | null;
  warnings?: { signal: string; detail?: string }[];
  error?: { code: string; message: string };
}
export interface VantaDBResponse { vantadb: VantaDBStatus }

export interface WorkflowPolicy {
  schemaVersion: number;
  initial: string;
  transitions: Record<string, string[]>;
  actions: Record<string, string[]>;
  acceptance?: unknown;
  execution?: unknown;
}
export interface WorkflowResponse { workflow: WorkflowPolicy }
