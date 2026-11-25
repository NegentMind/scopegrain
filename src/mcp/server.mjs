// SPDX-License-Identifier: Apache-2.0
// Optional MCP server (stdio). Bound to one project root and one config at
// startup; tools never accept paths. Mutations are bounded CAS/append
// writes under the same locks and validators the CLI path enforces.
// Importing this module does not start the server and does not load the
// optional dependencies.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { toErrorPayload } from '../core/errors.mjs';
import { decodeUtf8Strict } from '../core/fsx.mjs';
import { resolveContext } from '../core/context.mjs';
import { runDoctor } from '../core/doctor.mjs';
import { inspectProject } from '../discovery/inspect.mjs';
import { getTask, listTasks, prepareTask, createTask }
  from '../core/tasks.mjs';
import {
  checkAction, updateTaskMeta, transitionTask, evaluateTaskTransition,
  validateTransitionInput,
} from '../core/transition.mjs';
import { knownStates } from '../core/policy.mjs';
import { validateMethodologyMode } from '../core/config.mjs';
import { resolveTaskRef } from '../core/active.mjs';
import { suggestCapabilities } from '../core/task-suggest.mjs';
import {
  appendWorklog, readWorklog, listGoals, createGoal, transitionGoal,
  taskMetrics,
} from '../core/worklog.mjs';
import { catalogDestRel, getResource, loadCatalog, loadWorkspaceCatalog } from '../core/catalog.mjs';
import { diagnoseResource, findResources } from '../core/resource-recovery.mjs';
import { err } from '../core/errors.mjs';
import { buildWorkflowPacket } from '../core/workflows.mjs';
import { getPlan, nextPlanTasks, previewPlan }
  from '../core/plans.mjs';
import { getArtifact } from '../core/artifacts.mjs';
import { getSpecification } from '../core/specifications.mjs';
import { getApproval } from '../core/approvals.mjs';
import { checkMethodology } from '../core/methodology.mjs';
import { getSession, resumeSession } from '../core/sessions.mjs';
import { bindWorkspace, getWorkspace } from '../core/workspaces.mjs';
import { callVantaDBTool, getVantaDBRecord, requireVantaDBConfig,
  vantaDBContext, vantaDBStatus }
  from '../integrations/vantadb-runtime.mjs';
import { recordRehydration } from '../integrations/vantadb-rehydrate.mjs';
import { assembleContextPacket } from '../core/context-packet.mjs';
import { buildMcpInventory } from '../core/mcp-inventory.mjs';

const PROTOCOL_NOTE = 'stdout is reserved for MCP protocol; logs go to stderr';

const READ_ONLY = {
  readOnlyHint: true, destructiveHint: false, openWorldHint: false,
};
// Read semantics, but the handler spawns the enrolled vantadb-server
// binary and sends data to the configured memory backend — it reaches
// an external (non-file) world, so openWorldHint must honestly say so.
const READ_BACKEND = {
  readOnlyHint: true, destructiveHint: false, openWorldHint: true,
};
const WRITE_LOCAL = {
  readOnlyHint: false, destructiveHint: false, openWorldHint: false,
  idempotentHint: false,
};
// Discard semantics: these transitions can shelve/drop work
// (discarded|cancelled dispositions, dropped goals), so they carry
// destructiveHint even though the write itself is a bounded CAS patch.
const WRITE_DISCARD = {
  readOnlyHint: false, destructiveHint: true, openWorldHint: false,
  idempotentHint: false,
};
// Worklog logs agents may append to directly. 'goals' stays excluded:
// goal records need generated ids, so they go through the goal tools.
const WORKLOG_APPEND = ['lessons', 'outcomes', 'progress', 'activity'];
const WORKLOG_READ = [...WORKLOG_APPEND, 'goals'];
const DISPOSITION_KINDS =
  ['deferred', 'icebox', 'future', 'discarded', 'cancelled', 'active'];
const STEP_STATUSES = ['pending', 'done', 'skipped'];
const GOAL_STATUSES = ['open', 'achieved', 'dropped'];
const PRIORITY_RANK = { p0: 0, p1: 1, p2: 2, p3: 3, backlog: 4 };

// Tool-argument bounds. The stdio transport parses a whole JSON-RPC line
// before validation, so caps live in BOTH layers: per-field zod maxLength
// (advertised in tools/list) and a serialized-args ceiling in strictify
// (direct handler calls bypass zod entirely). Every legit arg is far below
// these values (UUID 36, sha256 64, plan key <= 64).
const MAX_ARG_CHARS = 4096;
const MAX_ARGS_BYTES = 65536;

function textResult(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value === null || typeof value !== 'object'
        || Array.isArray(value) ? { result: value } : value,
  };
}

function errorResult(e) {
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(toErrorPayload(e)) }],
  };
}

function wrap(fn) {
  return async (args) => {
    try {
      return textResult(await fn(args || {}));
    } catch (e) {
      return errorResult(e);
    }
  };
}

// Untrusted-provenance marking (indirect prompt-injection surface): tools
// whose payloads carry verbatim bytes authored outside the harness —
// catalog resource bodies, workspace snapshot text, worklog entries,
// VantaDB backend records — get the mark at BOTH levels the wire format
// supports: `_meta` on the result and on each content block (SDK 1.x
// schemas carry it through), plus `trust`/`source` fields injected into
// the serialized payload so the mark reaches the model even when the
// client drops `_meta`. Non-object payloads are enveloped so the mark
// always lands.
function untrustedResult(value, source) {
  const meta = {
    'scopegrain/trust': 'untrusted', 'scopegrain/source': source,
  };
  const marked = value === null || typeof value !== 'object'
      || Array.isArray(value)
    ? { result: value, trust: 'untrusted', source }
    : { ...value, trust: 'untrusted', source };
  return {
    _meta: meta,
    content: [{ type: 'text', text: JSON.stringify(marked, null, 2),
      _meta: meta }],
    structuredContent: marked,
  };
}

function wrapUntrusted(source, fn) {
  return async (args) => {
    try {
      return untrustedResult(await fn(args || {}), source);
    } catch (e) {
      return errorResult(e);
    }
  };
}

// Strict input: unknown tool arguments are rejected at the handler level,
// not silently stripped by schema parsing. The serialized-args ceiling is
// checked first - it also covers direct handler calls that skip zod.
function strictify(tools) {
  for (const t of tools) {
    const allowed = new Set(Object.keys(t.config.inputSchema ?? {}));
    const inner = t.handler;
    t.handler = async (args) => {
      let argBytes;
      try {
        argBytes = Buffer.byteLength(JSON.stringify(args ?? {}), 'utf8');
      } catch {
        return errorResult(
          err('INVALID_ARGS', 'tool arguments are not JSON-serializable'));
      }
      if (argBytes > MAX_ARGS_BYTES) {
        return errorResult(err('INVALID_ARGS',
          `tool arguments exceed ${MAX_ARGS_BYTES} bytes`));
      }
      for (const k of Object.keys(args || {})) {
        if (!allowed.has(k)) {
          return errorResult(
            err('INVALID_ARGS', `unknown tool argument '${k}'`));
        }
      }
      return inner(args);
    };
  }
  return tools;
}

// Tool descriptors shared by the real server and tests. Every handler closes
// over the bound ctx; no tool argument can redirect to another path.
export function createMCPTools(ctx, z) {
  const OBJECT = z.object({}).passthrough();
  const TASK = z.object({
    id: z.string(), title: z.string(), state: z.string(),
    revision: z.number().int(),
  }).passthrough();
  const APPLIED_TASK = z.object({
    mode: z.enum(['dry-run', 'applied']), applied: z.boolean(), task: TASK,
  }).passthrough();
  const OUTPUT = {
    scopegrain_context: z.object({
      schemaVersion: z.number().int(), generatedAt: z.string(),
    }).passthrough(),
    scopegrain_list_tasks: z.object({
      tasks: z.array(TASK), malformed: z.array(z.record(z.unknown())),
    }).passthrough(),
    scopegrain_get_task: TASK,
    scopegrain_task_meta: TASK,
    scopegrain_task_disposition: TASK,
    scopegrain_task_transition: APPLIED_TASK,
    scopegrain_task_create: APPLIED_TASK,
    scopegrain_next_task: z.object({
      next: TASK.nullable(), claimed: z.boolean(),
      candidates: z.number().int(),
    }).passthrough(),
    scopegrain_check_action: z.object({
      id: z.string(), state: z.string(), action: z.string(),
      allowed: z.boolean(), permitted: z.array(z.string()),
    }).passthrough(),
    scopegrain_task_suggest: z.object({
      taskId: z.string(), suggestions: z.array(z.record(z.unknown())),
    }).passthrough(),
    scopegrain_catalog_list: z.object({
      resourceRoot: z.string().nullable(),
      entries: z.array(z.record(z.unknown())),
      aliases: z.array(z.record(z.unknown())),
    }).passthrough(),
    scopegrain_catalog_get: z.object({
      kind: z.string(), id: z.string(), content: z.string(),
    }).passthrough(),
    scopegrain_plan_next: z.object({
      tasks: z.array(z.record(z.unknown())),
    }).passthrough(),
    scopegrain_methodology_check: z.object({
      allowed: z.boolean(), issues: z.array(z.record(z.unknown())),
    }).passthrough(),
    scopegrain_memory_status: z.object({
      configured: z.boolean(), binaryPresent: z.boolean(),
      storagePresent: z.boolean(),
      pendingCommittedEvents: z.number().int(),
    }).passthrough(),
    scopegrain_memory_add: z.object({ at: z.string() }).passthrough(),
    scopegrain_memory_read: z.object({
      entries: z.array(z.unknown()),
      malformed: z.array(z.record(z.unknown())), truncated: z.boolean(),
    }).passthrough(),
    scopegrain_goal_create: z.object({ at: z.string() }).passthrough(),
    scopegrain_goal_transition: z.object({ at: z.string() }).passthrough(),
    scopegrain_goal_list: z.object({
      goals: z.array(z.record(z.unknown())),
      malformed: z.array(z.record(z.unknown())),
    }).passthrough(),
    scopegrain_metrics: z.object({
      schemaVersion: z.number().int(), tasks: z.record(z.unknown()),
      verification: z.record(z.unknown()),
      durationMs: z.record(z.unknown()),
      skillOutcomes: z.record(z.unknown()),
      malformed: z.array(z.record(z.unknown())),
    }).passthrough(),
  };
  const tools = [
    {
      name: 'scopegrain_inspect',
      config: {
        title: 'Inspect Project',
        description: 'Read-only manifest discovery for the bound project',
        inputSchema: {},
        annotations: READ_ONLY,
      },
      handler: wrap(async () => inspectProject(ctx.projectRoot)),
    },
    {
      name: 'scopegrain_status',
      config: {
        title: 'Project Status',
        description: 'Read-only doctor report for the bound project',
        inputSchema: {},
        annotations: READ_ONLY,
      },
      handler: wrap(async () => runDoctor(ctx)),
    },
    {
      name: 'scopegrain_context',
      config: {
        title: 'Session Context Packet',
        description: 'Session-start packet for the bound project: '
          + 'instructions pointer, workspace identity, task distribution, '
          + 'ready work, recent progress, open goals, pending journal '
          + 'events, active task and memory rehydration. Same bounded '
          + 'read as the CLI `context` command — call it at the top of '
          + 'a session before the first task action. When the VantaDB '
          + 'backend is enrolled this tool spawns the enrolled '
          + 'vantadb-server binary and sends a bounded project-scoped '
          + 'memory_search to it (per-project namespace); pass noVantadb '
          + 'to keep the call fully local.',
        inputSchema: {
          tail: z.number().int().min(1).max(100).optional()
            .describe('worklog tail size (default 5)'),
          timeoutMs: z.number().int().min(1).max(60000).optional()
            .describe('memory rehydration timeout in ms'),
          noVantadb: z.boolean().optional()
            .describe('skip the VantaDB rehydration section'),
          noStructure: z.boolean().optional()
            .describe('serve the persisted structure index without rescanning'),
          structureDebounceMs: z.number().int().min(1).max(3600000).optional()
            .describe('serve a cached structure status younger than this '
              + 'window and refresh the cache record under <state>/cache '
              + '(small derived write); omit for a strictly read-only '
              + 'stat-only rescan'),
          explain: z.boolean().optional()
            .describe('append per-section provenance (source, selection '
              + 'rule, flag-driven exclusions, estimatedTokens)'),
        },
        annotations: READ_BACKEND,
      },
      handler: wrapUntrusted('session-packet',
        async ({ tail, timeoutMs, noVantadb, noStructure,
          structureDebounceMs, explain }) =>
          assembleContextPacket(ctx, { tail, timeoutMs, noVantadb,
            noStructure, structureDebounceMs, explain })),
    },
    {
      name: 'scopegrain_list_tasks',
      config: {
        title: 'List Tasks',
        description: 'List stored tasks and malformed entries',
        inputSchema: {},
        annotations: READ_ONLY,
      },
      handler: wrap(async () => listTasks(ctx)),
    },
    {
      name: 'scopegrain_get_task',
      config: {
        title: 'Get Task',
        description: 'Get one task by UUID',
        inputSchema: { id: z.string().max(MAX_ARG_CHARS).describe('task UUID') },
        annotations: READ_ONLY,
      },
      handler: wrap(async ({ id }) => getTask(ctx, id)),
    },
    {
      name: 'scopegrain_check_action',
      config: {
        title: 'Check Action',
        description: 'Check whether policy allows an action in the task state',
        inputSchema: {
          taskId: z.string().max(MAX_ARG_CHARS).describe('task UUID'),
          action: z.string().max(MAX_ARG_CHARS).describe('action name, e.g. read, edit, verify'),
        },
        annotations: READ_ONLY,
      },
      handler: wrap(async ({ taskId, action }) => checkAction(ctx, taskId, action)),
    },
    {
      name: 'scopegrain_task_suggest',
      config: {
        title: 'Suggest Task Capabilities',
        description: 'Suggest capabilities from task metadata (type/title/contract/scope). Suggestive only — never mutates task.skills; declaration stays explicit.',
        inputSchema: {
          taskId: z.string().max(MAX_ARG_CHARS).describe('task UUID or slug'),
          limit: z.number().int().min(1).max(50).optional().describe('max suggestions (default 5)'),
        },
        annotations: READ_ONLY,
      },
      handler: wrap(async ({ taskId, limit }) =>
        suggestCapabilities(ctx, resolveTaskRef(ctx, taskId),
          { limit: limit ?? 5 })),
    },
    {
      name: 'scopegrain_catalog_list',
      config: {
        title: 'List Catalog Entries',
        description: 'List catalog entries, optionally filtered by kind',
        inputSchema: { kind: z.string().max(MAX_ARG_CHARS).optional().describe('entry kind') },
        annotations: READ_ONLY,
      },
      handler: wrapUntrusted('catalog', async ({ kind }) => {
        const catalog = loadWorkspaceCatalog(ctx);
        const entries = kind
          ? catalog.entries.filter((e) => e.kind === kind) : catalog.entries;
        if (kind && !catalog.entries.some((e) => e.kind === kind)) {
          throw err('CATALOG_UNKNOWN_KIND', `unknown catalog kind '${kind}'`);
        }
        return {
          resourceRoot: ctx.configDir,
          entries: entries.map((e) => ({
            kind: e.kind, id: e.id, description: e.description,
            path: catalogDestRel(e), sourcePath: e.path,
          })),
          aliases: (catalog.aliases ?? []).map((a) => ({
            kind: a.kind, id: a.id, mode: a.mode ?? null,
            default: a.default === true, target: a.target,
            targetMode: a.targetMode ?? null, parameters: a.parameters ?? {},
          })),
        };
      }),
    },
    {
      name: 'scopegrain_catalog_get',
      config: {
        title: 'Get Catalog Resource',
        description: 'Get one catalog resource with verbatim content',
        inputSchema: {
          kind: z.string().max(MAX_ARG_CHARS).describe('entry kind'),
          id: z.string().max(MAX_ARG_CHARS).describe('entry id'),
        },
        annotations: READ_ONLY,
      },
      handler: wrapUntrusted('catalog', async ({ kind, id }) => {
        const r = getResource(kind, id,
          { catalog: loadWorkspaceCatalog(ctx) });
        return {
          kind: r.kind, id: r.id,
          path: catalogDestRel(r), sourcePath: r.path,
          resourceRoot: ctx.configDir,
          description: r.description,
          ...(r.meta ? { meta: r.meta } : {}),
          content: decodeUtf8Strict(r.content,
            'CATALOG_MALFORMED', `catalog resource ${r.kind}/${r.id}`),
        };
      }),
    },
    {
      name: 'scopegrain_workflow_packet',
      config: {
        title: 'Workflow Packet',
        description: 'Read-only workflow packet for a catalog command',
        inputSchema: {
          command: z.string().max(MAX_ARG_CHARS),
          mode: z.string().max(MAX_ARG_CHARS).optional(),
          taskId: z.string().max(MAX_ARG_CHARS).optional(),
          host: z.string().max(MAX_ARG_CHARS).optional(),
          profile: z.string().max(MAX_ARG_CHARS).optional(),
          interaction: z.enum(['direct', 'guided']).optional(),
          lazy: z.boolean().optional()
            .describe('return the binding index without bodies; hydrate '
              + 'via scopegrain_catalog_get'),
        },
        annotations: READ_ONLY,
      },
      handler: wrapUntrusted('catalog',
        async (a) => buildWorkflowPacket(ctx, a)),
    },
    {
      name: 'scopegrain_resource_search',
      config: {
        title: 'Search Resources',
        description: 'Search workspace snapshot resource metadata (read-only)',
        inputSchema: {
          kind: z.string().max(MAX_ARG_CHARS).optional(),
          query: z.string().max(MAX_ARG_CHARS).optional(),
        },
        annotations: READ_ONLY,
      },
      handler: wrapUntrusted('resource-snapshot',
        async (a) => findResources(ctx, a)),
    },
    {
      name: 'scopegrain_resource_diagnose',
      config: {
        title: 'Diagnose Resource',
        description: 'Diagnose one snapshot resource vs its pinned hash (read-only)',
        inputSchema: { kind: z.string().max(MAX_ARG_CHARS), id: z.string().max(MAX_ARG_CHARS) },
        annotations: READ_ONLY,
      },
      handler: wrapUntrusted('resource-snapshot',
        async (a) => diagnoseResource(ctx, a)),
    },
    {
      name: 'scopegrain_plan_get',
      config: {
        title: 'Get Plan',
        description: 'Get one stored plan by key',
        inputSchema: { key: z.string().max(MAX_ARG_CHARS) },
        annotations: READ_ONLY,
      },
      handler: wrap(async ({ key }) => getPlan(ctx, key)),
    },
    {
      name: 'scopegrain_plan_next',
      config: {
        title: 'Plan Next Tasks',
        description: 'Dependency readiness of a plan from actual task state',
        inputSchema: { key: z.string().max(MAX_ARG_CHARS) },
        annotations: READ_ONLY,
      },
      handler: wrap(async ({ key }) => ({ tasks: nextPlanTasks(ctx, key) })),
    },
    {
      name: 'scopegrain_plan_preview',
      config: {
        title: 'Plan Preview',
        description: 'Pre-execution x-ray: readiness, waves, ordering '
          + 'risks and aggregate token estimate; read-only',
        inputSchema: { key: z.string().max(MAX_ARG_CHARS) },
        annotations: READ_ONLY,
      },
      handler: wrap(async ({ key }) => previewPlan(ctx, key)),
    },
    {
      name: 'scopegrain_artifact_get',
      config: {
        title: 'Get Artifact',
        description: 'Get one stored artifact by kind and UUID',
        inputSchema: { kind: z.string().max(MAX_ARG_CHARS), id: z.string().max(MAX_ARG_CHARS) },
        annotations: READ_ONLY,
      },
      handler: wrap(async ({ kind, id }) => getArtifact(ctx, kind, id)),
    },
    {
      name: 'scopegrain_specification_get',
      config: {
        title: 'Get Specification',
        description: 'Read a structured specification by UUID for the bound project.',
        inputSchema: { id: z.string().max(MAX_ARG_CHARS).describe('structured specification UUID') },
        annotations: READ_ONLY,
      },
      handler: wrap(async ({ id }) => getSpecification(ctx, id)),
    },
    {
      name: 'scopegrain_approval_get',
      config: {
        title: 'Get Approval',
        description: 'Read a stored content-bound approval by SHA-256 ID.',
        inputSchema: { id: z.string().max(MAX_ARG_CHARS).describe('approval SHA-256 ID') },
        annotations: READ_ONLY,
      },
      handler: wrap(async ({ id }) => getApproval(ctx, id)),
    },
    {
      name: 'scopegrain_methodology_check',
      config: {
        title: 'Check Methodology Gate',
        description: 'Check declared methodology gates for ACT or ACCEPT without writing.',
        inputSchema: {
          taskId: z.string().max(MAX_ARG_CHARS).describe('task UUID'),
          to: z.enum(['ACT', 'ACCEPT']).optional().describe('methodology gate to inspect; defaults to ACT'),
          outcomeEvidenceId: z.string().max(MAX_ARG_CHARS).optional().describe('optional outcome report UUID for an ACCEPT preview'),
        },
        annotations: READ_ONLY,
      },
      handler: wrap(async (a) => checkMethodology(ctx, a)),
    },
    {
      name: 'scopegrain_session_get',
      config: {
        title: 'Get Session',
        description: 'Get one stored session by UUID',
        inputSchema: { id: z.string().max(MAX_ARG_CHARS) },
        annotations: READ_ONLY,
      },
      handler: wrap(async ({ id }) => getSession(ctx, id)),
    },
    {
      name: 'scopegrain_session_resume',
      config: {
        title: 'Resume Session',
        description: 'Restore operational session state only — NOT conversation history: session usage plus actual task state, guidance reference and automatic record-level VantaDB rehydration (degradable); when enrolled it spawns the enrolled vantadb-server binary and sends the record ID to the configured memory backend; pass noVantadb to keep the call fully local and timeoutMs to bound the backend wait (15 s default)',
        inputSchema: {
          id: z.string().max(MAX_ARG_CHARS).describe('session UUID'),
          noVantadb: z.boolean().optional()
            .describe('skip the record-level VantaDB rehydration spawn'),
          timeoutMs: z.number().int().min(1).max(60000).optional()
            .describe('rehydration timeout in ms'),
        },
        annotations: READ_BACKEND,
      },
      handler: wrapUntrusted('session-packet',
        async ({ id, noVantadb, timeoutMs }) => {
          const result = resumeSession(ctx, id);
          if (noVantadb === true) {
            return { ...result, vantadb: { enrolled: null, context: null,
              skipped: true } };
          }
          return { ...result,
            vantadb: await recordRehydration({ ctx,
              recordId: result.task.id, timeoutMs }) };
        }),
    },
    {
      name: 'scopegrain_memory_status',
      config: {
        title: 'Memory Status',
        description: 'VantaDB enrollment, binary/storage presence and pending committed journal events (read-only)',
        inputSchema: {},
        annotations: READ_ONLY,
      },
      handler: wrap(async () => {
        const workspace = getWorkspace(ctx);
        const bound = bindWorkspace(ctx, {
          areaIds: workspace.areas.map((area) => area.id),
        });
        return vantaDBStatus({ ctx, bound });
      }),
    },
    {
      name: 'scopegrain_memory_get',
      config: {
        title: 'Get Memory Record',
        description: 'Read one record from the enrolled VantaDB memory backend by namespace and key; spawns the enrolled vantadb-server binary and sends namespace+key to the backend',
        inputSchema: {
          namespace: z.string().max(MAX_ARG_CHARS).describe('memory record namespace'),
          key: z.string().max(MAX_ARG_CHARS).describe('memory record key'),
        },
        annotations: READ_BACKEND,
      },
      handler: wrapUntrusted('vantadb-backend',
        async ({ namespace, key }) =>
          getVantaDBRecord({ cfg: requireVantaDBConfig(ctx),
            namespace, key })),
    },
    {
      name: 'scopegrain_memory_search',
      config: {
        title: 'Search Memory',
        description: 'Hybrid search over one namespace of the enrolled VantaDB memory backend; spawns the enrolled vantadb-server binary and sends the query to it',
        inputSchema: {
          namespace: z.string().max(MAX_ARG_CHARS).describe('memory record namespace'),
          query: z.string().max(MAX_ARG_CHARS).optional()
            .describe('optional text query for hybrid search'),
          topK: z.number().int().min(1).max(100).optional()
            .describe('maximum hits, default server-side'),
          mode: z.enum(['keyword', 'vector', 'hybrid']).optional()
            .describe('search profile mode; keyword works without an embedding provider'),
        },
        annotations: READ_BACKEND,
      },
      handler: wrapUntrusted('vantadb-backend',
        async ({ namespace, query, topK, mode }) => {
          const args = { namespace };
          if (query !== undefined) args.text_query = query;
          if (topK !== undefined) args.top_k = topK;
          if (mode !== undefined) args.search_profile = { mode };
          return callVantaDBTool({ cfg: requireVantaDBConfig(ctx),
            name: 'memory_search', arguments: args });
        }),
    },
    {
      name: 'scopegrain_memory_recall',
      config: {
        title: 'Recall Memory',
        description: 'L1 recall over the enrolled VantaDB backend. Default: project-scoped memory_search at l1/sg-<projectHash> (only this project\'s records); an explicit scope opts into the engine\'s memory_recall pool, machine-global at agent/team. WARNING: with an explicit scope, recalled hits can include OTHER projects\' memories stored under the same agent/team id — content leaves the project isolation boundary and is untrusted. Returns recalled hits plus prepend_context',
        inputSchema: {
          query: z.string().max(MAX_ARG_CHARS).describe('raw recall query text'),
          scope: z.enum(['session', 'agent', 'team']).optional()
            .describe('opt into the engine memory_recall pool reach; '
              + 'machine-global at agent/team (cross-project leak); '
              + 'omit for the project-scoped default'),
          topK: z.number().int().min(1).max(100).optional()
            .describe('maximum memories returned, default 5'),
        },
        annotations: READ_BACKEND,
      },
      handler: wrapUntrusted('vantadb-backend',
        async ({ query, scope, topK }) => {
          if (scope !== undefined) {
            const args = { query, scope };
            if (topK !== undefined) args.top_k = topK;
            return callVantaDBTool({ cfg: requireVantaDBConfig(ctx),
              name: 'memory_recall', arguments: args });
          }
          const { projectScopedRecall } = await import(
            '../integrations/vantadb-rehydrate.mjs');
          return projectScopedRecall({ ctx, query, topK });
        }),
    },
    {
      name: 'scopegrain_memory_context',
      config: {
        title: 'Memory Record Context',
        description: 'Rehydrate one record: searches every projected sg-formal-v1-* namespace for journal events mentioning the record ID; spawns the enrolled vantadb-server binary and sends the record ID to the configured memory backend',
        inputSchema: {
          recordId: z.string().max(MAX_ARG_CHARS)
            .describe('task/capture/spec record UUID to look up remotely'),
          topK: z.number().int().min(1).max(50).optional()
            .describe('hits per namespace, default 10'),
          maxNamespaces: z.number().int().min(1).max(256).optional()
            .describe('namespace scan cap, default 32'),
        },
        annotations: READ_BACKEND,
      },
      handler: wrapUntrusted('vantadb-backend',
        async ({ recordId, topK, maxNamespaces }) =>
          vantaDBContext({ cfg: requireVantaDBConfig(ctx), recordId,
            topK, maxNamespaces })),
    },
    {
      // Next ready task: PLAN, active disposition, unclaimed, all
      // dependsOn targets already CLOSE. Ordering: priority then
      // createdAt. claimBy appends a 'claimed by X' note through the
      // same CAS writer the CLI uses; claimed tasks are skipped.
      name: 'scopegrain_next_task',
      config: {
        title: 'Next Task',
        description: 'Select the next ready task (PLAN + active + deps met), optionally claiming it with a note',
        inputSchema: {
          backlog: z.string().max(MAX_ARG_CHARS).optional()
            .describe('restrict to a named backlog'),
          claimBy: z.string().max(MAX_ARG_CHARS).optional()
            .describe('actor name; appends a claim note via CAS update'),
        },
        // Selection is read-only, but claimBy performs a CAS write, so the
        // tool is advertised as mutating.
        annotations: WRITE_LOCAL,
      },
      handler: wrap(async ({ backlog, claimBy }) => {
        const { tasks } = listTasks(ctx);
        const closed = new Set(
          tasks.filter((t) => t.state === 'CLOSE').map((t) => t.id));
        const isClaimed = (t) => Array.isArray(t.notes)
          && t.notes.some((n) => n.startsWith('claimed by '));
        const candidates = tasks.filter((t) =>
          t.state === 'PLAN'
          && (t.disposition ?? null) === null
          && !isClaimed(t)
          && (backlog === undefined || (t.backlog ?? 'default') === backlog)
          && (!Array.isArray(t.dependsOn)
            || t.dependsOn.every((d) => closed.has(d))));
        candidates.sort((a, b) =>
          (PRIORITY_RANK[a.priority] ?? 5) - (PRIORITY_RANK[b.priority] ?? 5)
          || String(a.createdAt).localeCompare(String(b.createdAt)));
        const next = candidates[0] ?? null;
        let claimed = null;
        if (next && claimBy) {
          claimed = updateTaskMeta(ctx, {
            id: next.id, expectedRevision: next.revision,
            addNote: `claimed by ${claimBy}`,
          });
        }
        return {
          next: claimed ?? next,
          claimed: claimed !== null,
          candidates: candidates.length,
        };
      }),
    },
    {
      name: 'scopegrain_task_meta',
      config: {
        title: 'Update Task Metadata',
        description: 'CAS metadata patch on a task: set semantic fields, append a note, or update a step status',
        inputSchema: {
          id: z.string().max(MAX_ARG_CHARS).describe('task UUID'),
          expectedRevision: z.number().int().min(0)
            .max(Number.MAX_SAFE_INTEGER).describe('CAS revision'),
          set: z.record(z.unknown()).optional()
            .describe('semantic fields patch (backlog, priority, type, ...)'),
          addNote: z.string().max(MAX_ARG_CHARS).optional(),
          stepIndex: z.number().int().min(0).max(1000000).optional(),
          stepStatus: z.enum(STEP_STATUSES).optional(),
        },
        annotations: WRITE_LOCAL,
      },
      handler: wrap(async (a) => {
        const input = {
          id: a.id, expectedRevision: a.expectedRevision,
        };
        if (a.set !== undefined) input.set = a.set;
        if (a.addNote !== undefined) input.addNote = a.addNote;
        if (a.stepIndex !== undefined || a.stepStatus !== undefined) {
          input.stepStatus = { index: a.stepIndex, status: a.stepStatus };
        }
        return updateTaskMeta(ctx, input);
      }),
    },
    {
      name: 'scopegrain_task_disposition',
      config: {
        title: 'Set Task Disposition',
        description: 'Set or clear a task disposition (deferred|icebox|future|discarded|cancelled; active clears)',
        inputSchema: {
          id: z.string().max(MAX_ARG_CHARS).describe('task UUID'),
          expectedRevision: z.number().int().min(0)
            .max(Number.MAX_SAFE_INTEGER).describe('CAS revision'),
          kind: z.enum(DISPOSITION_KINDS),
          reason: z.string().max(MAX_ARG_CHARS).optional(),
          by: z.string().max(MAX_ARG_CHARS).optional(),
        },
        annotations: WRITE_DISCARD,
      },
      handler: wrap(async (a) => updateTaskMeta(ctx, {
        id: a.id, expectedRevision: a.expectedRevision,
        disposition: a.kind === 'active' ? null : {
          kind: a.kind,
          ...(a.reason !== undefined ? { reason: a.reason } : {}),
          ...(a.by !== undefined ? { by: a.by } : {}),
        },
      })),
    },
    {
      name: 'scopegrain_task_transition',
      config: {
        title: 'Transition Task',
        description: 'Drive the task FSM with the same CAS transition the '
          + 'CLI `task transition` runs: dry-run by default (returns the '
          + 'exact record the write would store, methodology gates '
          + 'included); apply:true commits. On CLOSE the outcome is '
          + 'archived to the progress log (best-effort), same as the CLI.',
        inputSchema: {
          taskId: z.string().max(MAX_ARG_CHARS).describe('task UUID'),
          to: z.enum(knownStates()).describe('target workflow state'),
          expectedRevision: z.number().int().min(0)
            .max(Number.MAX_SAFE_INTEGER).describe('CAS revision'),
          verification: z.record(z.unknown()).optional()
            .describe('verification evidence payload'),
          review: z.record(z.unknown()).optional()
            .describe('review evidence payload'),
          apply: z.boolean().optional()
            .describe('commit the transition; omitted/false previews'),
        },
        annotations: WRITE_LOCAL,
      },
      handler: wrap(async (a) => {
        const input = {
          id: a.taskId, to: a.to, expectedRevision: a.expectedRevision,
        };
        if (a.verification !== undefined) {
          input.verification = a.verification;
        }
        if (a.review !== undefined) input.review = a.review;
        if (a.apply !== true) {
          validateTransitionInput(input);
          const evaluated = evaluateTaskTransition(
            ctx, getTask(ctx, input.id), input);
          return { mode: 'dry-run', applied: false, task: evaluated.next };
        }
        const next = transitionTask(ctx, input);
        if (next.state === 'CLOSE') {
          try {
            appendWorklog(ctx, 'progress', {
              taskId: next.id, title: next.title,
              result: next.review?.verdict ?? 'closed',
              summary: next.contract, domain: next.backlog,
            });
          } catch { }
        }
        return { mode: 'applied', applied: true, task: next };
      }),
    },
    {
      name: 'scopegrain_task_create',
      config: {
        title: 'Create Task',
        description: 'Create a task record in the initial workflow state '
          + 'with the same normalization the CLI `task create` runs: '
          + 'dry-run by default; apply:true writes the record. Pass '
          + '`input` for the full task input document (methodology '
          + 'assessment, V3 fields) or the flat fields '
          + '(title/contract/authorContext/scope plus optional '
          + 'specId/designId/planKey/scenarioRefs/dependsOn/goalIds); '
          + '`input` is mutually exclusive with the flat fields.',
        inputSchema: {
          input: z.record(z.unknown()).optional()
            .describe('full task input document (task create --input keys)'),
          title: z.string().max(MAX_ARG_CHARS).optional(),
          contract: z.string().max(MAX_ARG_CHARS).optional(),
          authorContext: z.string().max(MAX_ARG_CHARS).optional(),
          scope: z.array(z.string().max(MAX_ARG_CHARS)).max(256).optional()
            .describe('relative scope paths inside the project'),
          specId: z.string().max(MAX_ARG_CHARS).optional()
            .describe('structured specification UUID'),
          designId: z.string().max(MAX_ARG_CHARS).optional()
            .describe('design artifact UUID bound to specId'),
          planKey: z.string().max(MAX_ARG_CHARS).optional(),
          scenarioRefs: z.array(z.string().max(MAX_ARG_CHARS)).max(256)
            .optional(),
          methodology: z.record(z.unknown()).optional()
            .describe('methodology assessment (organic-sdd)'),
          dependsOn: z.array(z.string().max(MAX_ARG_CHARS)).max(256)
            .optional().describe('task UUIDs this task depends on'),
          relations: z.record(
            z.array(z.string().max(MAX_ARG_CHARS)).max(256))
            .optional().describe('typed edges: see|supersedes|duplicateOf|blocks'),
          goalIds: z.array(z.string().max(MAX_ARG_CHARS)).max(256)
            .optional(),
          apply: z.boolean().optional()
            .describe('write the record; omitted/false previews'),
        },
        annotations: WRITE_LOCAL,
      },
      handler: wrap(async (a) => {
        const FLAT = ['title', 'contract', 'authorContext', 'scope',
          'specId', 'designId', 'planKey', 'scenarioRefs', 'methodology',
          'dependsOn', 'relations', 'goalIds'];
        if (a.input !== undefined
            && FLAT.some((k) => a[k] !== undefined)) {
          throw err('INVALID_ARGS',
            'input is mutually exclusive with flat create fields');
        }
        if (a.input === undefined) {
          const mode = validateMethodologyMode(
            ctx.config.methodology, 'config.methodology');
          if (mode !== 'manual'
              && a.specId === undefined && a.designId === undefined) {
            throw err('METHODOLOGY_REQUIRED',
              `task create under methodology '${mode}' requires ` +
              'input carrying a methodology assessment or the ' +
              'specId+designId pair');
          }
        }
        const input = a.input ?? {
          title: a.title, contract: a.contract,
          authorContext: a.authorContext, scope: a.scope ?? [],
          ...(a.specId !== undefined ? { specId: a.specId } : {}),
          ...(a.designId !== undefined ? { designId: a.designId } : {}),
          ...(a.planKey !== undefined ? { planKey: a.planKey } : {}),
          ...(a.scenarioRefs !== undefined
            ? { scenarioRefs: a.scenarioRefs } : {}),
          ...(a.methodology !== undefined
            ? { methodology: a.methodology } : {}),
          ...(a.dependsOn !== undefined
            ? { dependsOn: a.dependsOn } : {}),
          ...(a.relations !== undefined
            ? { relations: a.relations } : {}),
          ...(a.goalIds !== undefined ? { goalIds: a.goalIds } : {}),
        };
        if (a.apply === true) {
          return { mode: 'applied', applied: true,
            task: createTask(ctx, input) };
        }
        const prepared = prepareTask(ctx, input);
        return { mode: 'dry-run', applied: false, task: prepared.task };
      }),
    },
    {
      name: 'scopegrain_memory_add',
      config: {
        title: 'Append Memory Entry',
        description: 'Append an entry to an operational memory log (lessons|outcomes|progress)',
        inputSchema: {
          log: z.enum(WORKLOG_APPEND),
          entry: z.record(z.unknown())
            .describe('log entry fields; validated by the core'),
        },
        annotations: WRITE_LOCAL,
      },
      handler: wrap(async ({ log, entry }) =>
        appendWorklog(ctx, log, entry)),
    },
    {
      name: 'scopegrain_memory_read',
      config: {
        title: 'Read Memory Log',
        description: 'Read tail entries from an operational memory log',
        inputSchema: {
          log: z.enum(WORKLOG_READ),
          tail: z.number().int().min(0).max(1000).optional(),
        },
        annotations: READ_ONLY,
      },
      handler: wrapUntrusted('worklog', async ({ log, tail }) =>
        readWorklog(ctx, log, tail === undefined ? {} : { tail })),
    },
    {
      name: 'scopegrain_goal_create',
      config: {
        title: 'Create Goal',
        description: 'Create a goal/objective record tasks can link to via goalIds',
        inputSchema: {
          title: z.string().max(MAX_ARG_CHARS),
          description: z.string().max(MAX_ARG_CHARS).optional(),
          horizon: z.string().max(MAX_ARG_CHARS).optional(),
          metrics: z.record(z.unknown()).optional(),
        },
        annotations: WRITE_LOCAL,
      },
      handler: wrap(async (a) => createGoal(ctx, a)),
    },
    {
      name: 'scopegrain_goal_list',
      config: {
        title: 'List Goals',
        description: 'List goals; latest entry per id wins',
        inputSchema: {},
        annotations: READ_ONLY,
      },
      handler: wrap(async () => listGoals(ctx)),
    },
    {
      name: 'scopegrain_goal_transition',
      config: {
        title: 'Transition Goal',
        description: 'Change a goal status (open|achieved|dropped)',
        inputSchema: {
          id: z.string().max(MAX_ARG_CHARS).describe('goal UUID'),
          to: z.enum(GOAL_STATUSES),
        },
        annotations: WRITE_DISCARD,
      },
      handler: wrap(async ({ id, to }) => transitionGoal(ctx, id, to)),
    },
    {
      name: 'scopegrain_metrics',
      config: {
        title: 'Task Metrics',
        description: 'Derived task metrics: state/backlog/priority/disposition counts, verification and first-try rates, close-time percentiles, per-skill outcomes',
        inputSchema: {},
        annotations: READ_ONLY,
      },
      handler: wrap(async () => taskMetrics(ctx)),
    },
    // Self-describing contract inventory (spec-kit parity). The handler
    // closes over the `tools` array itself, so the advertised inventory
    // can never drift from what the server actually registers.
    {
      name: 'scopegrain_mcp_inventory',
      config: {
        title: 'MCP Tool Inventory',
        description: 'Formal MCP tool inventory: every registered tool '
          + 'with its disposition (read-only | local-write), contract '
          + 'version, argument capability list and network posture. '
          + 'Derived from the live descriptors.',
        inputSchema: {},
        annotations: READ_ONLY,
      },
      handler: wrap(async () => buildMcpInventory(tools)),
    },
  ];
  for (const t of tools) {
    t.config.outputSchema = OUTPUT[t.name] ?? OBJECT;
  }
  return strictify(tools);
}

// Server version reported to MCP clients — read from the package
// manifest so it cannot drift behind the released version.
const PKG_VERSION = JSON.parse(fs.readFileSync(
  new URL('../../package.json', import.meta.url), 'utf8')).version;

// Constructs the MCP server and registers all tools WITHOUT connecting a
// transport. Returns {server, ctx} so callers/tests can inspect registration.
export async function createMCPServer({ project, config }) {
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
  const { z } = await import('zod');
  const ctx = resolveContext({ project, config });
  const server = new McpServer({ name: 'scopegrain', version: PKG_VERSION });
  for (const tool of createMCPTools(ctx, z)) {
    // Explicit strict object schema: the SDK preserves it, so unknown wire
    // args are rejected BEFORE the handler (raw shape would strip them).
    server.registerTool(tool.name, {
      ...tool.config,
      inputSchema: z.object(tool.config.inputSchema ?? {}).strict(),
    }, tool.handler);
  }
  return { server, ctx };
}

export async function startMCPServer({ project, config }) {
  const { StdioServerTransport } =
    await import('@modelcontextprotocol/sdk/server/stdio.js');
  const { server } = await createMCPServer({ project, config });
  process.stderr.write(`scopegrain mcp: ${PROTOCOL_NOTE}\n`);
  await server.connect(new StdioServerTransport());
  return server;
}

// Main guard: running `node src/mcp/server.mjs --project P [--config C]`
// starts the server; importing the module does not.
const invokedAs = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedAs && invokedAs === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  // A flag without a value must not swallow the next flag: missing or
  // '--'-prefixed values are absent, not arguments.
  const flagValue = (flag) => {
    const i = argv.indexOf(flag);
    const v = i >= 0 ? argv[i + 1] : undefined;
    return v !== undefined && !v.startsWith('--') ? v : undefined;
  };
  const project = flagValue('--project');
  if (!project) {
    const payload = toErrorPayload(
      err('INVALID_ARGS', 'mcp requires --project PATH'));
    process.stderr.write(JSON.stringify({ error: payload }) + '\n');
    process.exitCode = 1;
  } else {
    const config = flagValue('--config');
    startMCPServer({ project, config }).catch((e) => {
      const payload = toErrorPayload(e);
      process.stderr.write(JSON.stringify({ error: payload }) + '\n');
      process.exitCode = 1;
    });
  }
}
