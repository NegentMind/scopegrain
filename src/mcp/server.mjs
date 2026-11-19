// Optional MCP server (stdio). Bound to one project root and one config at
// startup; tools never accept paths. Mutations are bounded CAS/append
// writes under the same locks and validators the CLI path enforces.
// Importing this module does not start the server and does not load the
// optional dependencies.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toErrorPayload } from '../core/errors.mjs';
import { decodeUtf8Strict } from '../core/fsx.mjs';
import { resolveContext } from '../core/context.mjs';
import { runDoctor } from '../core/doctor.mjs';
import { inspectProject } from '../discovery/inspect.mjs';
import { getTask, listTasks } from '../core/tasks.mjs';
import { checkAction, updateTaskMeta } from '../core/transition.mjs';
import {
  appendWorklog, readWorklog, listGoals, createGoal, transitionGoal,
  taskMetrics,
} from '../core/worklog.mjs';
import { catalogDestRel, getResource, loadCatalog, loadWorkspaceCatalog } from '../core/catalog.mjs';
import { diagnoseResource, findResources } from '../core/resource-recovery.mjs';
import { err } from '../core/errors.mjs';
import { buildWorkflowPacket } from '../core/workflows.mjs';
import { getPlan, nextPlanTasks } from '../core/plans.mjs';
import { getArtifact } from '../core/artifacts.mjs';
import { getSpecification } from '../core/specifications.mjs';
import { getApproval } from '../core/approvals.mjs';
import { checkMethodology } from '../core/methodology.mjs';
import { getSession, resumeSession } from '../core/sessions.mjs';
import { bindWorkspace, getWorkspace } from '../core/workspaces.mjs';
import { callVantaDBTool, getVantaDBRecord, requireVantaDBConfig,
  vantaDBContext, vantaDBStatus }
  from '../integrations/vantadb-runtime.mjs';

const PROTOCOL_NOTE = 'stdout is reserved for MCP protocol; logs go to stderr';

const READ_ONLY = {
  readOnlyHint: true, destructiveHint: false, openWorldHint: false,
};
const WRITE_LOCAL = {
  readOnlyHint: false, destructiveHint: false, openWorldHint: false,
  idempotentHint: false,
};
// Worklog logs agents may append to directly. 'goals' stays excluded:
// goal records need generated ids, so they go through the goal tools.
const WORKLOG_APPEND = ['lessons', 'outcomes', 'progress'];
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
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
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
  return strictify([
    {
      name: 'scopegrain_inspect',
      config: {
        description: 'Read-only manifest discovery for the bound project',
        inputSchema: {},
        annotations: READ_ONLY,
      },
      handler: wrap(async () => inspectProject(ctx.projectRoot)),
    },
    {
      name: 'scopegrain_status',
      config: {
        description: 'Read-only doctor report for the bound project',
        inputSchema: {},
        annotations: READ_ONLY,
      },
      handler: wrap(async () => runDoctor(ctx)),
    },
    {
      name: 'scopegrain_list_tasks',
      config: {
        description: 'List stored tasks and malformed entries',
        inputSchema: {},
        annotations: READ_ONLY,
      },
      handler: wrap(async () => listTasks(ctx)),
    },
    {
      name: 'scopegrain_get_task',
      config: {
        description: 'Get one task by UUID',
        inputSchema: { id: z.string().max(MAX_ARG_CHARS).describe('task UUID') },
        annotations: READ_ONLY,
      },
      handler: wrap(async ({ id }) => getTask(ctx, id)),
    },
    {
      name: 'scopegrain_check_action',
      config: {
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
      name: 'scopegrain_catalog_list',
      config: {
        description: 'List catalog entries, optionally filtered by kind',
        inputSchema: { kind: z.string().max(MAX_ARG_CHARS).optional().describe('entry kind') },
        annotations: READ_ONLY,
      },
      handler: wrap(async ({ kind }) => {
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
        description: 'Get one catalog resource with verbatim content',
        inputSchema: {
          kind: z.string().max(MAX_ARG_CHARS).describe('entry kind'),
          id: z.string().max(MAX_ARG_CHARS).describe('entry id'),
        },
        annotations: READ_ONLY,
      },
      handler: wrap(async ({ kind, id }) => {
        const r = getResource(kind, id,
          { catalog: loadWorkspaceCatalog(ctx) });
        return {
          kind: r.kind, id: r.id,
          path: catalogDestRel(r), sourcePath: r.path,
          resourceRoot: ctx.configDir,
          description: r.description,
          content: decodeUtf8Strict(r.content,
            'CATALOG_MALFORMED', `catalog resource ${r.kind}/${r.id}`),
        };
      }),
    },
    {
      name: 'scopegrain_workflow_packet',
      config: {
        description: 'Read-only workflow packet for a catalog command',
        inputSchema: {
          command: z.string().max(MAX_ARG_CHARS),
          mode: z.string().max(MAX_ARG_CHARS).optional(),
          taskId: z.string().max(MAX_ARG_CHARS).optional(),
          host: z.string().max(MAX_ARG_CHARS).optional(),
          profile: z.string().max(MAX_ARG_CHARS).optional(),
          interaction: z.enum(['direct', 'guided']).optional(),
        },
        annotations: READ_ONLY,
      },
      handler: wrap(async (a) => buildWorkflowPacket(ctx, a)),
    },
    {
      name: 'scopegrain_resource_search',
      config: {
        description: 'Search workspace snapshot resource metadata (read-only)',
        inputSchema: {
          kind: z.string().max(MAX_ARG_CHARS).optional(),
          query: z.string().max(MAX_ARG_CHARS).optional(),
        },
        annotations: READ_ONLY,
      },
      handler: wrap(async (a) => findResources(ctx, a)),
    },
    {
      name: 'scopegrain_resource_diagnose',
      config: {
        description: 'Diagnose one snapshot resource vs its pinned hash (read-only)',
        inputSchema: { kind: z.string().max(MAX_ARG_CHARS), id: z.string().max(MAX_ARG_CHARS) },
        annotations: READ_ONLY,
      },
      handler: wrap(async (a) => diagnoseResource(ctx, a)),
    },
    {
      name: 'scopegrain_plan_get',
      config: {
        description: 'Get one stored plan by key',
        inputSchema: { key: z.string().max(MAX_ARG_CHARS) },
        annotations: READ_ONLY,
      },
      handler: wrap(async ({ key }) => getPlan(ctx, key)),
    },
    {
      name: 'scopegrain_plan_next',
      config: {
        description: 'Dependency readiness of a plan from actual task state',
        inputSchema: { key: z.string().max(MAX_ARG_CHARS) },
        annotations: READ_ONLY,
      },
      handler: wrap(async ({ key }) => ({ tasks: nextPlanTasks(ctx, key) })),
    },
    {
      name: 'scopegrain_artifact_get',
      config: {
        description: 'Get one stored artifact by kind and UUID',
        inputSchema: { kind: z.string().max(MAX_ARG_CHARS), id: z.string().max(MAX_ARG_CHARS) },
        annotations: READ_ONLY,
      },
      handler: wrap(async ({ kind, id }) => getArtifact(ctx, kind, id)),
    },
    {
      name: 'scopegrain_specification_get',
      config: {
        description: 'Read a structured specification by UUID for the bound project.',
        inputSchema: { id: z.string().max(MAX_ARG_CHARS).describe('structured specification UUID') },
        annotations: READ_ONLY,
      },
      handler: wrap(async ({ id }) => getSpecification(ctx, id)),
    },
    {
      name: 'scopegrain_approval_get',
      config: {
        description: 'Read a stored content-bound approval by SHA-256 ID.',
        inputSchema: { id: z.string().max(MAX_ARG_CHARS).describe('approval SHA-256 ID') },
        annotations: READ_ONLY,
      },
      handler: wrap(async ({ id }) => getApproval(ctx, id)),
    },
    {
      name: 'scopegrain_methodology_check',
      config: {
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
        description: 'Get one stored session by UUID',
        inputSchema: { id: z.string().max(MAX_ARG_CHARS) },
        annotations: READ_ONLY,
      },
      handler: wrap(async ({ id }) => getSession(ctx, id)),
    },
    {
      name: 'scopegrain_session_resume',
      config: {
        description: 'Session usage plus actual task state and guidance reference',
        inputSchema: { id: z.string().max(MAX_ARG_CHARS) },
        annotations: READ_ONLY,
      },
      handler: wrap(async ({ id }) => resumeSession(ctx, id)),
    },
    {
      name: 'scopegrain_memory_status',
      config: {
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
        description: 'Read one record from the enrolled VantaDB memory backend by namespace and key',
        inputSchema: {
          namespace: z.string().max(MAX_ARG_CHARS).describe('memory record namespace'),
          key: z.string().max(MAX_ARG_CHARS).describe('memory record key'),
        },
        annotations: READ_ONLY,
      },
      handler: wrap(async ({ namespace, key }) =>
        getVantaDBRecord({ cfg: requireVantaDBConfig(ctx), namespace, key })),
    },
    {
      name: 'scopegrain_memory_search',
      config: {
        description: 'Hybrid search over one namespace of the enrolled VantaDB memory backend',
        inputSchema: {
          namespace: z.string().max(MAX_ARG_CHARS).describe('memory record namespace'),
          query: z.string().max(MAX_ARG_CHARS).optional()
            .describe('optional text query for hybrid search'),
          topK: z.number().int().min(1).max(100).optional()
            .describe('maximum hits, default server-side'),
          mode: z.enum(['keyword', 'vector', 'hybrid']).optional()
            .describe('search profile mode; keyword works without an embedding provider'),
        },
        annotations: READ_ONLY,
      },
      handler: wrap(async ({ namespace, query, topK, mode }) => {
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
        description: 'L1 memory recall (dual-pool RRF) over the enrolled VantaDB backend; returns recalled hits plus prepend_context',
        inputSchema: {
          query: z.string().max(MAX_ARG_CHARS).describe('raw recall query text'),
          scope: z.enum(['session', 'agent', 'team']).optional()
            .describe('cross-session reach of the L1 recall pool, default agent'),
          topK: z.number().int().min(1).max(100).optional()
            .describe('maximum memories returned, default 5'),
        },
        annotations: READ_ONLY,
      },
      handler: wrap(async ({ query, scope, topK }) => {
        const args = { query };
        if (scope !== undefined) args.scope = scope;
        if (topK !== undefined) args.top_k = topK;
        return callVantaDBTool({ cfg: requireVantaDBConfig(ctx),
          name: 'memory_recall', arguments: args });
      }),
    },
    {
      name: 'scopegrain_memory_context',
      config: {
        description: 'Rehydrate one record: searches every projected sg-formal-v1-* namespace for journal events mentioning the record ID',
        inputSchema: {
          recordId: z.string().max(MAX_ARG_CHARS)
            .describe('task/capture/spec record UUID to look up remotely'),
          topK: z.number().int().min(1).max(50).optional()
            .describe('hits per namespace, default 10'),
          maxNamespaces: z.number().int().min(1).max(256).optional()
            .describe('namespace scan cap, default 32'),
        },
        annotations: READ_ONLY,
      },
      handler: wrap(async ({ recordId, topK, maxNamespaces }) =>
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
        description: 'Set or clear a task disposition (deferred|icebox|future|discarded|cancelled; active clears)',
        inputSchema: {
          id: z.string().max(MAX_ARG_CHARS).describe('task UUID'),
          expectedRevision: z.number().int().min(0)
            .max(Number.MAX_SAFE_INTEGER).describe('CAS revision'),
          kind: z.enum(DISPOSITION_KINDS),
          reason: z.string().max(MAX_ARG_CHARS).optional(),
          by: z.string().max(MAX_ARG_CHARS).optional(),
        },
        annotations: WRITE_LOCAL,
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
      name: 'scopegrain_memory_add',
      config: {
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
        description: 'Read tail entries from an operational memory log',
        inputSchema: {
          log: z.enum(WORKLOG_READ),
          tail: z.number().int().min(0).max(1000).optional(),
        },
        annotations: READ_ONLY,
      },
      handler: wrap(async ({ log, tail }) =>
        readWorklog(ctx, log, tail === undefined ? {} : { tail })),
    },
    {
      name: 'scopegrain_goal_create',
      config: {
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
        description: 'List goals; latest entry per id wins',
        inputSchema: {},
        annotations: READ_ONLY,
      },
      handler: wrap(async () => listGoals(ctx)),
    },
    {
      name: 'scopegrain_goal_transition',
      config: {
        description: 'Change a goal status (open|achieved|dropped)',
        inputSchema: {
          id: z.string().max(MAX_ARG_CHARS).describe('goal UUID'),
          to: z.enum(GOAL_STATUSES),
        },
        annotations: WRITE_LOCAL,
      },
      handler: wrap(async ({ id, to }) => transitionGoal(ctx, id, to)),
    },
    {
      name: 'scopegrain_metrics',
      config: {
        description: 'Derived task metrics: state/backlog/priority/disposition counts, verification and first-try rates, close-time percentiles, per-skill outcomes',
        inputSchema: {},
        annotations: READ_ONLY,
      },
      handler: wrap(async () => taskMetrics(ctx)),
    },
  ]);
}

// Constructs the MCP server and registers all tools WITHOUT connecting a
// transport. Returns {server, ctx} so callers/tests can inspect registration.
export async function createMCPServer({ project, config }) {
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
  const { z } = await import('zod');
  const ctx = resolveContext({ project, config });
  const server = new McpServer({ name: 'scopegrain', version: '0.1.0' });
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
