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

export interface PlanSummary {
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

export interface PlanDetail {
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
  };
  readiness: PlanReadiness[];
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

export type MemoryLogName = 'lessons' | 'outcomes' | 'progress' | 'goals';

export interface MemoryLogResult {
  log: MemoryLogName;
  entries: Record<string, unknown>[];
  malformed: { line: string }[];
}

export interface Goal {
  id: string;
  title: string;
  description: string | null;
  status: 'open' | 'achieved' | 'dropped';
  horizon: string | null;
  metrics: string | null;
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
  plans: () => request<PlanList>('/api/plans'),
  plan: (key: string) =>
    request<PlanDetail>(`/api/plans/${encodeURIComponent(key)}`),
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
};
