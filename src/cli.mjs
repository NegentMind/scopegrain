// CLI command surface. All results go to stdout as JSON; failures go to
// stderr as {error:{code,message}} with a non-zero exit code.
import path from 'node:path';
import readline from 'node:readline/promises';
import { err, toErrorPayload } from './core/errors.mjs';
import { DEFAULT_PATH_PROPOSALS, KNOWN_HOSTS, PATH_KEYS, VERSIONING_KEYS, loadConfig, resolveConfigPath, validateMethodologyMode } from './core/config.mjs';
import { resolveContext } from './core/context.mjs';
import { resolveProjectRoot } from './core/paths.mjs';
import { prepareInit, applyPlan, preflightPlan } from './core/bootstrap.mjs';
import { runDoctor } from './core/doctor.mjs';
import { inspectProject } from './discovery/inspect.mjs';
import { createTask, getTask, listTasks, prepareTask } from './core/tasks.mjs';
import { transitionTask, checkAction } from './core/transition.mjs';
import { decodeUtf8Strict, readFileLimited } from './core/fsx.mjs';
import fs from 'node:fs';
import { loadLimits, loadMethodologyPolicy } from './core/policy.mjs';
import { checkCatalog, getResource, legacyGet, legacyList, loadCatalog, loadWorkspaceCatalog } from './core/catalog.mjs';
import { applyResourceRestore, diagnoseResource, findResources, prepareResourceRestore } from './core/resource-recovery.mjs';
import { buildWorkflowPacket } from './core/workflows.mjs';
import {
  getPlan, listPlans, nextPlanTasks, preparePlan,
} from './core/plans.mjs';
import {
  getArtifact, listArtifacts, prepareArtifact,
} from './core/artifacts.mjs';
import {
  getSpecification, prepareDesign, prepareSpecification,
} from './core/specifications.mjs';
import { createOwnedSpecificationStore } from './core/owned-specifications.mjs';
import { createOwnedDesignStore } from './core/owned-designs.mjs';
import { createOwnedOutcomeStore } from './core/owned-outcomes.mjs';
import { prepareOutcomeEvidence } from './core/outcomes.mjs';
import {
  answerApproval, describeApprovalTarget, getApproval, prepareApproval,
  prepareApprovalAnswer,
} from './core/approvals.mjs';
import { checkMethodology } from './core/methodology.mjs';
import {
  ensureSessionsDir, getSession, prepareSession, prepareSessionRecord,
  recordSession, resumeSession,
} from './core/sessions.mjs';
import { bindWorkspace, getWorkspace, prepareWorkspace } from './core/workspaces.mjs';
import { getJournalOperation, listJournalPending, prepareJournalRecovery,
  recoverJournalOperation }
  from './core/journal.mjs';
import { createCaptureStore } from './core/captures.mjs';
import { openInitSession, answer as sessionAnswer, status as sessionStatus,
  discard as discardInitSession }
  from './core/init-session.mjs';
import {
  applyBackup, applyRestore, applyUninstall, applyUpdate,
  prepareAdopt, prepareBackup, prepareRestore, prepareUninstall, prepareUpdate,
} from './core/lifecycle.mjs';
import {
  buildResearchRecord, investigateProject, suggestAnswers,
} from './discovery/semantic.mjs';
import { applyActivation, prepareActivation } from './hosts/activation.mjs';
import { DEFAULT_VANTADB_VERSION, VANTADB_BACKEND_ID, defaultInstallRoot,
  defaultStoragePath, ensureVantaDBBinary, getVantaDBRecord, releaseAsset,
  requireVantaDBConfig, saveVantaDBConfig, syncVantaDB, vantaDBStatus }
  from './integrations/vantadb-runtime.mjs';
import {
  proposeFromInitAnswers, proposeFromJournal, reviewProposal,
} from './core/capture-proposals.mjs';
import {
  applyAddCommand, applyApproveCommand,
  applyApproveDiscoveredCommands, applyImportCommands,
  listVerifyCommands, prepareAddCommand, prepareApproveCommand,
  prepareApproveDiscoveredCommands, prepareImportCommands,
  runVerifyCommand,
} from './core/verify-commands.mjs';
import { createApiServer } from './api/server.mjs';

const PATH_LABELS = {
  plans: 'Ruta de planes',
  tasks: 'Ruta de tareas',
  reports: 'Ruta de informes',
  research: 'Ruta de investigaciones',
  decisions: 'Ruta de decisiones',
  memory: 'Ruta de memoria',
  state: 'Ruta de estado operativo',
};

const VALUE_FLAGS = new Set([
  '--project', '--config', '--answers', '--evidence',
  '--title', '--contract', '--author', '--scope', '--revision',
  '--input', '--task', '--mode', '--host', '--profile', '--limit',
  '--query', '--interaction', '--spec', '--design', '--plan', '--to',
  '--outcome-evidence', '--from', '--surface', '--since-sequence', '--port',
  '--command', '--timeout', '--version', '--storage', '--binary',
  '--install-dir', '--namespace', '--key',
]);
const BOOL_FLAGS = new Set([
  '--apply', '--approve', '--help', '--owned', '--save', '--fail-on-error',
  '--reconcile', '--defaults',
]);
const REJECTED_FLAGS = new Set(['--yes', '--force']);

// Per-command flag whitelist and exact positional count (after 'task <sub>').
const COMMANDS = {
  inspect: { flags: ['--project'], pos: 0, usage: 'inspect --project PATH' },
  init: {
    flags: ['--project', '--config', '--answers', '--defaults', '--apply'],
    pos: 0,
    usage: 'init --project PATH [--config REL] [--answers FILE | --defaults] [--apply]',
  },
  doctor: {
    flags: ['--project', '--config'],
    pos: 0,
    usage: 'doctor --project PATH [--config REL]',
  },
  mcp: {
    flags: ['--project', '--config'],
    pos: 0,
    usage: 'mcp --project PATH [--config REL]',
  },
  'workspace show': {
    flags: ['--project', '--config'], pos: 0,
    usage: 'workspace show --project PATH [--config REL]',
  },
  'workspace init': {
    flags: ['--project', '--config', '--input', '--apply'], pos: 0,
    usage: 'workspace init --project PATH [--config REL] [--input FILE] [--apply]',
  },
  'journal list': {
    flags: ['--project', '--config', '--since-sequence', '--limit'], pos: 0,
    usage: 'journal list --project PATH [--config REL] [--since-sequence N] [--limit N]',
  },
  'journal show': {
    flags: ['--project', '--config'], pos: 1,
    usage: 'journal show OPERATION --project PATH [--config REL]',
  },
  'journal recover': {
    flags: ['--project', '--config', '--input', '--apply'], pos: 1,
    usage: 'journal recover OPERATION --project PATH [--config REL] --input FILE [--apply]',
  },
  'vantadb setup': {
    flags: ['--project', '--config', '--version', '--storage', '--binary',
      '--install-dir', '--apply'], pos: 0,
    usage: 'vantadb setup --project PATH [--version X] [--storage PATH] [--binary PATH] [--install-dir DIR] [--apply]',
  },
  'vantadb status': {
    flags: ['--project', '--config'], pos: 0,
    usage: 'vantadb status --project PATH',
  },
  'vantadb sync': {
    flags: ['--project', '--config', '--limit', '--timeout'], pos: 0,
    usage: 'vantadb sync --project PATH [--limit N] [--timeout MS]',
  },
  'vantadb get': {
    flags: ['--project', '--config', '--namespace', '--key', '--timeout'], pos: 0,
    usage: 'vantadb get --project PATH --namespace NS --key K [--timeout MS]',
  },
  'capture create': {
    flags: ['--project', '--config', '--input', '--apply'], pos: 0,
    usage: 'capture create --project PATH [--config REL] --input FILE [--apply]',
  },
  'capture show': {
    flags: ['--project', '--config'], pos: 1,
    usage: 'capture show UUID --project PATH [--config REL]',
  },
  'task create': {
    flags: ['--project', '--config', '--title', '--contract', '--author', '--scope',
      '--spec', '--design', '--plan', '--input', '--apply'],
    pos: 0,
    usage: 'task create --project PATH --input FILE [--apply]',
  },
  'task list': {
    flags: ['--project', '--config'], pos: 0,
    usage: 'task list --project PATH',
  },
  'task show': {
    flags: ['--project', '--config'], pos: 1,
    usage: 'task show --project PATH ID',
  },
  'task transition': {
    flags: ['--project', '--config', '--revision', '--evidence'], pos: 2,
    usage: 'task transition --project PATH ID STATE --revision N [--evidence FILE]',
  },
  'task check-action': {
    flags: ['--project', '--config'], pos: 2,
    usage: 'task check-action --project PATH ID ACTION',
  },
  'specification create': {
    flags: ['--project', '--config', '--input', '--apply', '--owned'], pos: 0,
    usage: 'specification create --project PATH --input FILE [--owned] [--apply]',
  },
  'specification show': {
    flags: ['--project', '--config', '--owned'], pos: 1,
    usage: 'specification show --project PATH UUID [--owned]',
  },
  'design create': {
    flags: ['--project', '--config', '--input', '--apply', '--owned'], pos: 0,
    usage: 'design create --project PATH --input FILE [--owned] [--apply]',
  },
  'design show': {
    flags: ['--project', '--config', '--owned'], pos: 1,
    usage: 'design show --project PATH UUID --owned',
  },
  'outcome create': {
    flags: ['--project', '--config', '--input', '--apply', '--owned'], pos: 0,
    usage: 'outcome create --project PATH --input FILE [--owned] [--apply]',
  },
  'outcome show': {
    flags: ['--project', '--config', '--owned'], pos: 1,
    usage: 'outcome show --project PATH UUID --owned',
  },
  'approval target': {
    flags: ['--project', '--config', '--input'], pos: 0,
    usage: 'approval target --project PATH --input FILE',
  },
  'approval create': {
    flags: ['--project', '--config', '--input', '--apply'], pos: 0,
    usage: 'approval create --project PATH --input FILE [--apply]',
  },
  'approval show': {
    flags: ['--project', '--config'], pos: 1,
    usage: 'approval show --project PATH DIGEST',
  },
  'approval answer': {
    flags: ['--project', '--config', '--input', '--apply'], pos: 0,
    usage: 'approval answer --project PATH --input FILE [--apply]',
  },
  'methodology check': {
    flags: ['--project', '--config', '--to', '--outcome-evidence'], pos: 1,
    usage: 'methodology check --project PATH UUID [--to ACT|ACCEPT] [--outcome-evidence UUID]',
  },
  'catalog list': {
    flags: ['--project', '--config'], pos: -1,
    usage: 'catalog list [KIND] [--project PATH]',
  },
  'catalog show': {
    flags: ['--project', '--config'], pos: 2,
    usage: 'catalog show KIND ID [--project PATH]',
  },
  'catalog check': {
    flags: ['--project', '--config'], pos: 0,
    usage: 'catalog check [--project PATH]',
  },
  'resource search': {
    flags: ['--project', '--config', '--query'], pos: -1,
    usage: 'resource search [KIND] --project PATH [--query Q]',
  },
  'resource diagnose': {
    flags: ['--project', '--config'], pos: 2,
    usage: 'resource diagnose KIND ID --project PATH',
  },
  'resource restore-plan': {
    flags: ['--project', '--config', '--input'], pos: 0,
    usage: 'resource restore-plan --project PATH --input FILE',
  },
  'resource restore': {
    flags: ['--project', '--config', '--input', '--apply'], pos: 0,
    usage: 'resource restore --project PATH --input FILE [--apply]',
  },
  'catalog legacy': {
    flags: [], pos: -1,
    usage: 'catalog legacy [KIND]  (frozen provenance metadata only)',
  },
  'catalog legacy-show': {
    flags: [], pos: 2,
    usage: 'catalog legacy-show KIND ID',
  },
  workflow: {
    flags: ['--project', '--config', '--mode', '--task', '--host', '--profile', '--interaction'],
    pos: 1,
    usage: 'workflow COMMAND [--mode M] [--task UUID] [--host H] [--profile ID] [--interaction direct|guided]',
  },
  'plan create': {
    flags: ['--project', '--config', '--input', '--apply'], pos: 0,
    usage: 'plan create --project PATH --input FILE [--apply]',
  },
  'plan list': { flags: ['--project', '--config'], pos: 0, usage: 'plan list' },
  'plan show': {
    flags: ['--project', '--config'], pos: 1, usage: 'plan show KEY',
  },
  'plan next': {
    flags: ['--project', '--config'], pos: 1, usage: 'plan next KEY',
  },
  'artifact add': {
    flags: ['--project', '--config', '--input', '--apply'], pos: 1,
    usage: 'artifact add KIND --input FILE [--apply]',
  },
  'artifact list': {
    flags: ['--project', '--config'], pos: 1, usage: 'artifact list KIND',
  },
  'artifact show': {
    flags: ['--project', '--config'], pos: 2, usage: 'artifact show KIND UUID',
  },
  'session create': {
    flags: ['--project', '--config', '--task', '--limit', '--apply'], pos: 0,
    usage: 'session create --task UUID --limit N [--apply]',
  },
  'session show': {
    flags: ['--project', '--config'], pos: 1, usage: 'session show UUID',
  },
  'session record': {
    flags: ['--project', '--config', '--revision', '--input', '--apply'], pos: 1,
    usage: 'session record UUID --revision N --input FILE [--apply]',
  },
  'session resume': {
    flags: ['--project', '--config'], pos: 1, usage: 'session resume UUID',
  },
  adopt: {
    flags: ['--project', '--config', '--apply'], pos: 0,
    usage: 'adopt --project PATH [--config REL] [--apply]',
  },
  update: {
    flags: ['--project', '--config', '--reconcile', '--apply'], pos: 0,
    usage: 'update --project PATH [--config REL] [--reconcile] [--apply]',
  },
  backup: {
    flags: ['--project', '--config', '--to', '--apply'], pos: 0,
    usage: 'backup --project PATH --to REL [--config REL] [--apply]',
  },
  restore: {
    flags: ['--project', '--from', '--apply'], pos: 0,
    usage: 'restore --project PATH --from REL [--apply]',
  },
  uninstall: {
    flags: ['--project', '--config', '--apply'], pos: 0,
    usage: 'uninstall --project PATH [--config REL] [--apply]',
  },
  investigate: {
    flags: ['--project', '--config', '--save'], pos: 0,
    usage: 'investigate --project PATH [--config REL] [--save]',
  },
  'host activate': {
    flags: ['--project', '--config', '--host', '--surface', '--apply'], pos: 0,
    usage: 'host activate --project PATH --host NAME [--surface X] [--apply]',
  },
  'capture proposals': {
    flags: ['--project', '--config', '--since-sequence'], pos: 0,
    usage: 'capture proposals --project PATH [--config REL] [--since-sequence N]',
  },
  'capture review': {
    flags: ['--project', '--config', '--input', '--apply'], pos: 0,
    usage: 'capture review --project PATH --input FILE [--apply]',
  },
  'verify list': {
    flags: ['--project', '--config'], pos: 0,
    usage: 'verify list --project PATH [--config REL]',
  },
  'verify add': {
    flags: ['--project', '--config', '--command', '--apply'], pos: 0,
    usage: 'verify add --project PATH --command CMD [--apply]',
  },
  'verify approve': {
    flags: ['--project', '--config', '--apply'], pos: 1,
    usage: 'verify approve ID --project PATH [--apply]',
  },
  'verify discover': {
    flags: ['--project', '--config', '--apply', '--approve'], pos: 0,
    usage: 'verify discover --project PATH [--apply] [--approve]',
  },
  'verify approve-discovered': {
    flags: ['--project', '--config', '--apply'], pos: 0,
    usage: 'verify approve-discovered --project PATH [--apply]',
  },
  'verify run': {
    flags: ['--project', '--config', '--timeout', '--fail-on-error'], pos: 1,
    usage: 'verify run ID --project PATH [--timeout MS] [--fail-on-error]',
  },
  view: {
    flags: ['--project', '--config', '--port', '--host'], pos: 0,
    usage: 'view --project PATH [--config REL] [--port N] [--host ADDR]',
  },
};

// Aliases are derived from canonical catalog command ids at dispatch time;
// the flag set is fixed by the settled interface.
const WORKFLOW_ALIAS_FLAGS = [
  '--project', '--config', '--mode', '--task', '--host', '--profile',
  '--interaction',
];

function helpResult() {
  return {
    usage: 'scopegrain <command> [options]  |  scopegrain --help',
    commands: Object.entries(COMMANDS).map(([name, c]) => ({
      command: c.usage,
      description: name,
    })),
    notes: [
      'tasksystem remains a compatible CLI alias',
      '--yes and --force are not supported; confirmation is always explicit',
      'results are JSON on stdout; errors are JSON on stderr with exit code 1',
      'JSON creation previews do not reserve IDs; use IDs returned by --apply',
      'task create --input is the supported creation path; the --title/--contract/--author flag form only applies to projects in manual methodology mode',
      'Methodology checks and stored approvals are not native tool permissions',
      '--owned opts specification create/show into journal ownership; legacy behavior stays unchanged without it',
      '--owned opts design/outcome create/show into journal ownership; new show commands require it',
      'adopt/update/backup/restore/uninstall preview first; --apply is create-only and never overwrites, merges or reinitializes',
      'update --reconcile rewrites ONLY diverged generated files under harness-owned roots (the config dir and generated subdirs); root-level files (AGENTS.md, CLAUDE.md) and the config always stay conflict',
      'init --defaults skips the prompt loop: answers come from the existing config (noop re-init) or from the investigation suggestions plus the wizard defaults; --apply still gates writes; mutually exclusive with --answers',
      'inspect is the bounded manifest-scan snapshot init stores as discovery.json; investigate is the deeper semantic analysis that adds init-answer suggestions',
      'investigate is read-only; --save writes one research record under paths.research when a config resolves',
      'host activate writes project-local destinations only; global host paths and shared merges are never written',
      'capture proposals lists review proposals; capture review --apply creates an owned capture only from an approved decision',
      'verify add/approve/discover preview first; discover --approve or approve-discovered bulk-approves literal candidates; verify run executes only an explicitly approved command as literal argv (bounded, never a shell)',
      'verify run prints the result JSON and exits 0 by default; --fail-on-error propagates the command exit code (or 1 on timeout/signal)',
      'view serves a loopback read-only API and keeps running; press Ctrl+C to stop',
    ],
  };
}

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (REJECTED_FLAGS.has(a)) {
      throw err('INVALID_ARGS',
        `${a} is not supported; confirmation is always explicit`);
    }
    if (BOOL_FLAGS.has(a)) {
      flags[a] = true;
    } else if (VALUE_FLAGS.has(a)) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        throw err('INVALID_ARGS', `${a} requires a value`);
      }
      flags[a] = argv[++i];
    } else if (a.startsWith('--')) {
      throw err('INVALID_ARGS', `unknown flag ${a}`);
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

function requireFlag(flags, name) {
  if (!flags[name]) throw err('INVALID_ARGS', `${name} is required`);
  return flags[name];
}

// CLI JSON inputs are bounded by the authored document limit.
function readInputFile(file, label) {
  const abs = path.resolve(file);
  let st;
  try {
    st = fs.lstatSync(abs);
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      throw err('INPUT_NOT_FOUND', `${label} not found: ${abs}`);
    }
    throw e;
  }
  if (!st.isFile() || st.isSymbolicLink()) {
    throw err('READ_FAILED', `${label} is not a regular file: ${abs}`);
  }
  const limited = readFileLimited(abs, loadLimits().maxDocumentBytes);
  if (limited.exceeded) {
    throw err('INPUT_TOO_LARGE',
      `${label} exceeds ${loadLimits().maxDocumentBytes} bytes`);
  }
  try {
    const text = limited.content.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(limited.content)) {
      throw err('MALFORMED_JSON', `malformed JSON in ${label}: ${abs}`);
    }
    return JSON.parse(text);
  } catch {
    throw err('MALFORMED_JSON', `malformed JSON in ${label}: ${abs}`);
  }
}

function validateEvidenceArg(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw err('INVALID_EVIDENCE', 'evidence file must contain a JSON object');
  }
  for (const key of Object.keys(raw)) {
    if (key !== 'verification' && key !== 'review') {
      throw err('INVALID_EVIDENCE',
        `evidence file may only contain verification/review, got '${key}'`);
    }
  }
  return raw;
}

// Interactive defaults prefer an existing valid config over generic
// proposals, so re-init never conflicts with saved preferences. When a
// resumable init session is supplied, already-answered questions are
// replayed from the session and new answers are recorded as they come —
// an interrupted run resumes at the first unanswered question.
async function askInteractive(io, projectRoot, configFlag, existing,
    session = null) {
  const st = session === null ? null : sessionStatus(session);
  const answered = new Set(st === null ? [] : st.answered);
  const leaf = (id) => id.split('.').reduce((o, k) => o?.[k], st.answers);
  // askOrReplay returns the stored value for answered questions and runs
  // `ask` otherwise, recording the outcome in the session. With
  // retryOnInvalid a rejected value re-prompts instead of aborting the
  // wizard (session validation is eager for paths).
  const askOrReplay = async (id, ask, retryOnInvalid = false) => {
    if (session !== null && answered.has(id)) return leaf(id);
    for (;;) {
      const value = await ask();
      if (session === null) return value;
      try {
        sessionAnswer(session, id, value);
        return value;
      } catch (e) {
        if (!retryOnInvalid) throw e;
        io.stderr(`Valor invalido: ${e.message}`);
      }
    }
  };
  const answers = {};
  answers.name = await askOrReplay('name', () => io.ask('Nombre del proyecto',
    existing ? existing.project.name : path.basename(projectRoot)));
  answers.locale = await askOrReplay('locale', () => io.ask('Idioma (es/en)',
    existing ? existing.locale : 'es'));
  const hostList = KNOWN_HOSTS.join(',');
  answers.hosts = await askOrReplay('hosts', async () => {
    const hostsRaw = await io.ask(`Anfitriones (${hostList})`,
      existing ? existing.hosts.join(',') : hostList);
    return hostsRaw.split(',').map((h) => h.trim()).filter(Boolean);
  });
  // Methodology question: existing normalized mode wins, otherwise the
  // authored interactive default (organic-sdd). Re-prompt on invalid.
  const existingMode = existing
    ? validateMethodologyMode(existing.methodology) : null;
  const modeDefault = existingMode
    ?? loadMethodologyPolicy().interactiveDefault;
  answers.methodology = await askOrReplay('methodology', async () => {
    for (;;) {
      const reply = (await io.ask(
        'Metodologia: manual (V1), organic-sdd (proporcional), sdd (formal)',
        modeDefault)).trim();
      if (loadMethodologyPolicy().modes.includes(reply)) return reply;
      io.stderr('Metodo invalido: use manual, organic-sdd o sdd.');
    }
  });
  const configRel = await io.ask('Ruta de configuracion', configFlag);
  answers.paths = {};
  for (const key of PATH_KEYS) {
    answers.paths[key] = await askOrReplay(`paths.${key}`,
      () => io.ask(PATH_LABELS[key],
        existing ? existing.paths[key] : DEFAULT_PATH_PROPOSALS[key]),
      true);
  }
  // Optional versioning: eight yes/no questions, never guessed defaults.
  answers.versioning = {};
  for (const key of VERSIONING_KEYS) {
    const def = existing ? (existing.versioning[key] ? 'yes' : 'no') : 'no';
    answers.versioning[key] = await askOrReplay(`versioning.${key}`,
      async () => {
        for (;;) {
          const reply = (await io.ask(`Versionar ${key}? (yes/no)`, def))
            .trim().toLowerCase();
          if (reply === 'yes' || reply === 'no') return reply === 'yes';
          io.stderr('responda yes o no');
        }
      });
  }
  return { answers, configRel };
}

function planJson(prepared) {
  return {
    files: prepared.files.map((f) => ({ path: f.rel, action: f.action })),
    discovery: {
      stacks: prepared.discovery.stacks,
      commands: prepared.discovery.commands,
      fingerprint: prepared.discovery.fingerprint,
    },
    methodology: prepared.config.methodology,
    warnings: [
      ...(prepared.warnings ?? []),
      ...(prepared.discovery.warnings ?? []),
    ],
  };
}

// Truthful apply reporting: `applied` reflects whether bytes were
// actually written, `files` lists only written destinations and `counts`
// mirrors the update verb's {create,noop,conflict} shape — a re-init that
// created nothing reports applied:false instead of listing the plan.
function appliedInitResult(result, extra = {}) {
  return {
    mode: 'applied',
    applied: result.created > 0,
    ...extra,
    ...result,
    counts: {
      create: result.created,
      noop: result.noop.length,
      conflict: 0,
    },
  };
}

// --defaults: non-interactive answers at the same trust level as
// accepting every interactive proposal. A valid existing config is the
// preferred source — its values are replayed so a re-init stays a noop;
// otherwise the semantic investigation suggests values and the wizard's
// own defaults fill what detection left unanswered (empty host signals
// fall back to the full host list, exactly like the interactive default).
function defaultAnswers(projectRoot, configRel) {
  let existing = null;
  try {
    existing = loadConfig(projectRoot, configRel).config;
  } catch (e) {
    if (e.code !== 'CONFIG_NOT_FOUND') throw e;
  }
  if (existing !== null) {
    return {
      name: existing.project.name,
      locale: existing.locale,
      hosts: [...existing.hosts],
      paths: structuredClone(existing.paths),
      versioning: structuredClone(existing.versioning),
      methodology: existing.methodology,
    };
  }
  const suggestions = suggestAnswers(investigateProject(projectRoot, {}));
  return {
    name: suggestions.name.value,
    locale: 'es',
    hosts: suggestions.hosts.value.length > 0
      ? [...suggestions.hosts.value] : [...KNOWN_HOSTS],
    paths: Object.fromEntries(
      PATH_KEYS.map((key) => [key, suggestions.paths[key].value])),
    versioning: { ...suggestions.versioning.value },
    methodology: loadMethodologyPolicy().interactiveDefault,
  };
}

async function cmdInit(flags, io) {
  const projectRoot = resolveProjectRoot(requireFlag(flags, '--project'));
  if (flags['--answers'] && flags['--defaults']) {
    throw err('INVALID_ARGS',
      '--answers and --defaults are mutually exclusive');
  }
  let answers;
  let configRel = resolveConfigPath(projectRoot, flags['--config']);
  const interactive = !flags['--answers'] && !flags['--defaults'];
  let existing = null;
  let session = null;
  // Whether this run created the session file (vs resuming a prior one):
  // a declined plan owes the tree a discard only for its own writes.
  let sessionCreated = false;
  if (interactive) {
    if (!io.isTTY) {
      throw err('INTERACTIVE_REQUIRED',
        'init without --answers requires a terminal; no implicit writes');
    }
    try {
      existing = loadConfig(projectRoot, configRel).config;
    } catch (e) {
      if (e.code !== 'CONFIG_NOT_FOUND') throw e;
    }
    // Resumable wizard: answers persist under <stateDir>/init-session.json
    // so an interrupted init resumes at the first unanswered question. A
    // session written against a different answers-schema fingerprint is
    // stale; resuming it is explicit opt-in, never implicit adoption.
    let opened = openInitSession({ projectRoot });
    session = opened.session;
    // The session file is created eagerly so mid-wizard interruption can
    // resume; a run that creates it owes the tree a discard if the plan is
    // declined ('cancel leaves no writes'), while a pre-existing session
    // belongs to an earlier run and is kept either way.
    sessionCreated = opened.created;
    if (sessionStatus(session).stale) {
      const resume = await io.ask(
        'Sesion previa de init incompatible con el esquema actual; reanudar respuestas compatibles? (yes/no)',
        'no');
      if (resume.trim().toLowerCase() === 'yes') {
        opened = openInitSession({ projectRoot }, { resumeStale: true });
        session = opened.session;
        sessionCreated = opened.created;
      } else {
        discardInitSession(session);
        opened = openInitSession({ projectRoot });
        session = opened.session;
        sessionCreated = opened.created;
      }
    }
    const got = await askInteractive(io, projectRoot, configRel, existing,
      session);
    answers = got.answers;
    configRel = got.configRel;
  } else if (flags['--defaults']) {
    answers = defaultAnswers(projectRoot, configRel);
  } else {
    answers = readInputFile(flags['--answers'], 'answers file');
  }
  const prepared = prepareInit({ projectRoot, configRel, answers });
  if (interactive) {
    io.stdout(JSON.stringify({ mode: 'plan', ...planJson(prepared) }, null, 2));
    const confirm = await io.ask('Crear estos archivos? (yes/no)', 'no');
    if (confirm.trim().toLowerCase() !== 'yes') {
      // Declining the plan is an abort: drop the session this run created
      // (plus its now-empty stateDir dirs) so cancel leaves no writes.
      if (sessionCreated) discardInitSession(session);
      return { mode: 'dry-run', applied: false };
    }
    const result = applyPlan(projectRoot, prepared.files);
    if (session !== null) discardInitSession(session);
    return appliedInitResult(result);
  }
  // --defaults echoes the machine-chosen answers so the operator can audit
  // exactly what consent produced; --answers stays quiet (user-supplied).
  const extra = flags['--defaults'] ? { answers } : {};
  if (flags['--apply']) {
    const result = applyPlan(projectRoot, prepared.files);
    return appliedInitResult(result, extra);
  }
  return { mode: 'dry-run', applied: false, ...extra, ...planJson(prepared) };
}

async function cmdTask(sub, positional, flags, io) {
  const ctx = resolveContext({
    project: requireFlag(flags, '--project'),
    config: flags['--config'],
  });
  if (sub === 'create') {
    const legacyFlags = ['--title', '--contract', '--author', '--scope',
      '--spec', '--design', '--plan'];
    if (Object.hasOwn(flags, '--input')) {
      if (legacyFlags.some((name) => Object.hasOwn(flags, name))) {
        throw err('INVALID_ARGS',
          '--input is mutually exclusive with legacy task create flags');
      }
      const input = readInputFile(requireFlag(flags, '--input'), 'task input');
      const prepared = prepareTask(ctx, input);
      return finishCreation(ctx, 'task', prepared.task, prepared.file, flags);
    }
    if (flags['--apply']) {
      throw err('INVALID_ARGS',
        '--apply requires --input for task create; legacy flags create directly');
    }
    // Methodology-gated modes cannot be satisfied by the flag form: flags
    // cannot express an assessment, and --input is the only way to supply
    // one. Fail before flag-level validation so the error names the
    // supported path instead of bubbling an unexplained gate failure.
    // The formal --spec/--design pair still flows through the same
    // normalization as --input, so it stays legal under every mode.
    const mode = validateMethodologyMode(
      ctx.config.methodology, 'config.methodology');
    if (mode !== 'manual'
        && !Object.hasOwn(flags, '--spec') && !Object.hasOwn(flags, '--design')) {
      throw err('METHODOLOGY_REQUIRED',
        `task create under methodology '${mode}' requires --input FILE ` +
        'carrying a methodology assessment or the specId+designId pair; ' +
        'the flag form cannot express an assessment — see ' +
        'docs/methodology.md and schemas/organic-assessment.schema.json');
    }
    const scope = flags['--scope']
      ? flags['--scope'].split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    return createTask(ctx, {
      title: requireFlag(flags, '--title'),
      contract: requireFlag(flags, '--contract'),
      authorContext: requireFlag(flags, '--author'),
      scope,
      ...(Object.hasOwn(flags, '--spec') ? { specId: flags['--spec'] } : {}),
      ...(Object.hasOwn(flags, '--design') ? { designId: flags['--design'] } : {}),
      ...(Object.hasOwn(flags, '--plan') ? { planKey: flags['--plan'] } : {}),
    });
  }
  if (sub === 'list') return listTasks(ctx);
  if (sub === 'show') {
    if (positional.length !== 1) {
      throw err('INVALID_ARGS', 'task show requires exactly one ID');
    }
    return getTask(ctx, positional[0]);
  }
  if (sub === 'transition') {
    if (positional.length !== 2) {
      throw err('INVALID_ARGS', 'task transition requires ID and STATE');
    }
    if (!flags['--revision']) {
      throw err('INVALID_ARGS', '--revision N is required');
    }
    const expectedRevision = decimalInt(flags['--revision'], '--revision');
    const evidence = flags['--evidence']
      ? validateEvidenceArg(readInputFile(flags['--evidence'], 'evidence file'))
      : {};
    return transitionTask(ctx, {
      id: positional[0],
      to: positional[1],
      expectedRevision,
      ...evidence,
    });
  }
  if (sub === 'check-action') {
    if (positional.length !== 2) {
      throw err('INVALID_ARGS', 'task check-action requires ID and ACTION');
    }
    return checkAction(ctx, positional[0], positional[1]);
  }
  throw err('INVALID_ARGS', `unknown task subcommand '${sub}'`);
}

// Strict non-negative decimal parsing for CLI integer flags.
function decimalInt(value, label) {
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) {
    throw err('INVALID_ARGS', `${label} must be a non-negative decimal integer`);
  }
  return Number(value);
}

function cmdCatalog(sub, positional, flags) {
  if (flags['--config'] && !flags['--project']) {
    throw err('INVALID_ARGS', '--config requires --project');
  }
  // --project binds to the workspace snapshot; otherwise installation
  // (labelled so the two sources are never confused).
  const ctx = flags['--project']
    ? resolveContext({ project: flags['--project'], config: flags['--config'] })
    : null;
  const bound = ctx ? loadWorkspaceCatalog(ctx) : null;
  const source = ctx ? 'workspace-snapshot' : 'installation';
  if (sub === 'legacy') {
    return { source, ...legacyList({ kind: positional[0] }, {}) };
  }
  if (sub === 'legacy-show') {
    return { source, ...legacyGet(positional[0], positional[1], {}) };
  }
  if (sub === 'list') {
    const catalog = bound ?? loadCatalog({});
    const kind = positional[0];
    const entries = kind
      ? catalog.entries.filter((e) => e.kind === kind)
      : catalog.entries;
    if (kind && !catalog.entries.some((e) => e.kind === kind)) {
      throw err('CATALOG_UNKNOWN_KIND', `unknown catalog kind '${kind}'`);
    }
    return {
      source,
      entries: entries.map(({ kind: k, id, description, path: p }) =>
        ({ kind: k, id, description, path: p })),
      aliases: (catalog.aliases ?? []).map((a) => ({
        kind: a.kind, id: a.id, mode: a.mode ?? null,
        default: a.default === true, target: a.target,
        targetMode: a.targetMode ?? null, parameters: a.parameters ?? {},
      })),
    };
  }
  if (sub === 'show') {
    const r = bound
      ? getResource(positional[0], positional[1], { catalog: bound })
      : getResource(positional[0], positional[1], {});
    return {
      source,
      kind: r.kind, id: r.id, path: r.path,
      requestedId: r.requestedId, canonicalId: r.canonicalId,
      resolvedVia: r.resolvedVia,
      description: r.description,
      content: decodeUtf8Strict(r.content,
        'CATALOG_MALFORMED', `catalog resource ${r.kind}/${r.id}`),
    };
  }
  if (sub === 'check') {
    const report = bound
      ? { ok: true, issues: [], entries: bound.entries.length,
          integrity: bound.integrity, warnings: bound.warnings }
      : checkCatalog({});
    if (!report.ok) {
      throw err('CATALOG_INVALID',
        `catalog check failed: ${report.issues.map((i) => i.message).join(' | ')}`);
    }
    return { source, ...report };
  }
  throw err('INVALID_ARGS', `unknown catalog subcommand '${sub}'`);
}

function cmdResource(sub, rest, flags) {
  const ctx = resolveContext({
    project: requireFlag(flags, '--project'), config: flags['--config'],
  });
  if (sub === 'search') {
    return findResources(ctx, { kind: rest[0], query: flags['--query'] });
  }
  if (sub === 'diagnose') {
    return diagnoseResource(ctx, { kind: rest[0], id: rest[1] });
  }
  if (!flags['--input']) {
    throw err('INVALID_ARGS', `${sub} requires --input FILE`);
  }
  const input = readInputFile(flags['--input'], 'resource input');
  if (sub === 'restore-plan') {
    return prepareResourceRestore(ctx, input);
  }
  if (sub === 'restore') {
    if (flags['--apply'] !== true) {
      return { mode: 'dry-run', ...prepareResourceRestore(ctx, input) };
    }
    return { mode: 'apply', ...applyResourceRestore(ctx, input) };
  }
  throw err('INVALID_ARGS', `unknown resource subcommand '${sub}'`);
}

function cmdWorkflow(command, flags) {
  return buildWorkflowPacket(resolveContext({
    project: requireFlag(flags, '--project'),
    config: flags['--config'],
  }), {
    command,
    mode: flags['--mode'],
    taskId: flags['--task'],
    host: flags['--host'],
    profile: flags['--profile'],
    interaction: flags['--interaction'],
  });
}

function cmdPlan(sub, positional, flags) {
  const ctx = resolveContext({
    project: requireFlag(flags, '--project'),
    config: flags['--config'],
  });
  if (sub === 'create') {
    const input = readInputFile(requireFlag(flags, '--input'), 'plan input');
    const prepared = preparePlan(ctx, input);
    const planned = preflightPlan(ctx.projectRoot, prepared.files);
    if (!flags['--apply']) {
      return {
        mode: 'dry-run', applied: false, plan: prepared.plan,
        files: planned.map((f) => ({ path: f.rel, action: f.action })),
      };
    }
    const result = applyPlan(ctx.projectRoot, planned);
    return { mode: 'applied', applied: true, plan: prepared.plan, ...result };
  }
  if (sub === 'list') return listPlans(ctx);
  if (sub === 'show') return getPlan(ctx, positional[0]);
  if (sub === 'next') return { tasks: nextPlanTasks(ctx, positional[0]) };
  throw err('INVALID_ARGS', `unknown plan subcommand '${sub}'`);
}

function cmdArtifact(sub, positional, flags) {
  const ctx = resolveContext({
    project: requireFlag(flags, '--project'),
    config: flags['--config'],
  });
  if (sub === 'add') {
    const input = readInputFile(requireFlag(flags, '--input'), 'artifact input');
    const prepared = prepareArtifact(ctx, positional[0], input);
    const planned = preflightPlan(ctx.projectRoot, [prepared.file]);
    if (!flags['--apply']) {
      return {
        mode: 'dry-run', applied: false, artifact: prepared.artifact,
        files: planned.map((f) => ({ path: f.rel, action: f.action })),
      };
    }
    const result = applyPlan(ctx.projectRoot, planned);
    return {
      mode: 'applied', applied: true, artifact: prepared.artifact, ...result,
    };
  }
  if (sub === 'list') return listArtifacts(ctx, positional[0]);
  if (sub === 'show') return getArtifact(ctx, positional[0], positional[1]);
  throw err('INVALID_ARGS', `unknown artifact subcommand '${sub}'`);
}

// Create-only records use exclusive bootstrap writes. Mutable approval
// answers deliberately do NOT go through this helper.
function finishCreation(ctx, key, record, file, flags) {
  const planned = preflightPlan(ctx.projectRoot, [file]);
  if (!flags['--apply']) {
    return {
      mode: 'dry-run', applied: false, [key]: record,
      files: planned.map((f) => ({ path: f.rel, action: f.action })),
    };
  }
  const result = applyPlan(ctx.projectRoot, planned);
  return { mode: 'applied', applied: true, [key]: record, ...result };
}

function cmdWorkspace(sub, flags) {
  const ctx = resolveContext({
    project: requireFlag(flags, '--project'), config: flags['--config'],
  });
  if (sub === 'show') return getWorkspace(ctx);
  const input = Object.hasOwn(flags, '--input')
    ? readInputFile(flags['--input'], 'workspace input') : {};
  const prepared = prepareWorkspace(ctx, input);
  return finishCreation(ctx, 'workspace', prepared.workspace, prepared.file, flags);
}

function cmdCapture(sub, positional, flags) {
  const project = requireFlag(flags, '--project');
  if (sub === 'proposals') return cmdCaptureProposals(project, flags);
  if (sub === 'review') return cmdCaptureReview(project, flags);
  // The bounded input is read before context/workspace resolution so a
  // malformed payload is reported as itself, never masked or trusted.
  const input = sub === 'create'
    ? readInputFile(requireFlag(flags, '--input'), 'capture input') : null;
  const ctx = resolveContext({ project, config: flags['--config'] });
  const workspace = getWorkspace(ctx);
  const store = createCaptureStore(ctx, {
    areaIds: workspace.areas.map((area) => area.id), origin: 'local-cli',
  });
  if (sub === 'show') return store.get(positional[0]);
  return flags['--apply'] ? store.create(input) : store.prepare(input);
}

// Review material, not an audit trail: committed journal operations plus
// the persisted init answers, bound to every enrolled area like the other
// capture CLI paths.
function cmdCaptureProposals(project, flags) {
  const options = {};
  if (Object.hasOwn(flags, '--since-sequence')) {
    options.sinceSequence = decimalInt(
      flags['--since-sequence'], '--since-sequence');
  }
  const ctx = resolveContext({ project, config: flags['--config'] });
  const workspace = getWorkspace(ctx);
  const areaIds = workspace.areas.map((area) => area.id);
  const config = ctx.config;
  // The persisted config carries the fields init answers carried; both
  // optional keys are stored, so these proposals are declared.
  const answers = {
    name: config.project.name, locale: config.locale, hosts: config.hosts,
    paths: config.paths, versioning: config.versioning,
    methodology: config.methodology,
  };
  return {
    proposals: [
      ...proposeFromJournal(ctx, options),
      ...proposeFromInitAnswers(answers, { areaIds }),
    ],
  };
}

// Pure review gate: the resolved decision is returned as-is; only an
// approved decision with --apply feeds the flattened DTO to the store.
function cmdCaptureReview(project, flags) {
  const input = readInputFile(
    requireFlag(flags, '--input'), 'capture review input');
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw err('INVALID_ARGS', 'capture review input must be an object');
  }
  for (const key of Object.keys(input)) {
    if (!['proposal', 'action', 'reason', 'changes'].includes(key)) {
      throw err('INVALID_ARGS',
        `capture review input has unknown key '${key}'`
          + `; expected one of: action, changes, proposal, reason`);
    }
  }
  const decision = { action: input.action };
  if (Object.hasOwn(input, 'reason')) decision.reason = input.reason;
  if (Object.hasOwn(input, 'changes')) decision.changes = input.changes;
  const review = reviewProposal(input.proposal, decision);
  if (!flags['--apply']) return { mode: 'dry-run', review };
  if (review.status !== 'approved') {
    return { mode: 'applied', applied: false, review };
  }
  const ctx = resolveContext({ project, config: flags['--config'] });
  const workspace = getWorkspace(ctx);
  const store = createCaptureStore(ctx, {
    areaIds: workspace.areas.map((area) => area.id), origin: 'local-cli',
  });
  const created = store.create(
    { ...review.input.capture, areaIds: review.input.areaIds });
  return { ...created, review: { status: review.status } };
}

function cmdJournal(sub, positional, flags) {
  const ctx = resolveContext({
    project: requireFlag(flags, '--project'), config: flags['--config'],
  });
  const workspace = getWorkspace(ctx);
  const bound = bindWorkspace(ctx, { areaIds: workspace.areas.map((area) => area.id) });
  if (sub === 'list') {
    const options = {};
    if (flags['--since-sequence'] !== undefined) {
      options.afterSequence = Number(flags['--since-sequence']);
    }
    if (flags['--limit'] !== undefined) {
      options.limit = Number(flags['--limit']);
    }
    return listJournalPending(bound, options);
  }
  if (sub === 'show') return getJournalOperation(bound, positional[0]);
  const input = readInputFile(requireFlag(flags, '--input'), 'journal recovery input');
  return flags['--apply']
    ? recoverJournalOperation(bound, positional[0], input)
    : prepareJournalRecovery(bound, positional[0], input);
}

async function cmdVantaDB(sub, positional, flags) {
  const ctx = resolveContext({
    project: requireFlag(flags, '--project'), config: flags['--config'],
  });
  if (sub === 'setup') {
    const version = flags['--version'] ?? DEFAULT_VANTADB_VERSION;
    const storagePath = flags['--storage']
      ? path.resolve(flags['--storage']) : defaultStoragePath();
    const installRoot = flags['--install-dir']
      ? path.resolve(flags['--install-dir']) : defaultInstallRoot();
    const explicitBinary = flags['--binary'] ? path.resolve(flags['--binary']) : null;
    const asset = explicitBinary ? null : releaseAsset(version);
    const configRel = `${ctx.configDir}/vantadb.json`;
    if (!flags['--apply']) {
      return {
        preview: true, version, storagePath, installRoot,
        binary: explicitBinary ?? `download ${asset.name}`,
        asset, configRel,
      };
    }
    let binaryPath;
    let downloaded = false;
    let sha256 = null;
    if (explicitBinary) {
      if (!fs.existsSync(explicitBinary) || !fs.statSync(explicitBinary).isFile()) {
        throw err('VANTADB_BINARY_MISSING',
          `--binary does not name a file: ${explicitBinary}`);
      }
      binaryPath = explicitBinary;
    } else {
      const ensured = await ensureVantaDBBinary({ version, installRoot });
      binaryPath = ensured.binaryPath;
      downloaded = ensured.downloaded;
      sha256 = ensured.sha256;
    }
    fs.mkdirSync(storagePath, { recursive: true });
    const cfg = {
      schemaVersion: 1, backendId: VANTADB_BACKEND_ID, version,
      binaryPath, storagePath,
    };
    const configAbs = saveVantaDBConfig(ctx, cfg);
    return { applied: true, config: cfg, configPath: configAbs, downloaded, sha256 };
  }
  const workspace = getWorkspace(ctx);
  const bound = bindWorkspace(ctx, { areaIds: workspace.areas.map((area) => area.id) });
  if (sub === 'status') return vantaDBStatus({ ctx, bound });
  const timeoutMs = flags['--timeout'] !== undefined
    ? Number(flags['--timeout']) : undefined;
  if (sub === 'get') {
    const namespace = requireFlag(flags, '--namespace');
    const key = requireFlag(flags, '--key');
    return getVantaDBRecord({ cfg: requireVantaDBConfig(ctx), namespace, key, timeoutMs });
  }
  const cfg = requireVantaDBConfig(ctx);
  const limit = flags['--limit'] !== undefined ? Number(flags['--limit']) : undefined;
  return syncVantaDB({ ctx, bound, cfg, limit, timeoutMs });
}

function cmdOwnedSpecification(sub, positional, flags) {
  const project = requireFlag(flags, '--project');
  const input = sub === 'create'
    ? readInputFile(requireFlag(flags, '--input'), 'owned specification input')
    : null;
  const ctx = resolveContext({ project, config: flags['--config'] });
  const workspace = getWorkspace(ctx);
  const store = createOwnedSpecificationStore(ctx, {
    areaIds: workspace.areas.map((area) => area.id),
  });
  if (sub === 'show') return store.get(positional[0]);
  return flags['--apply'] ? store.create(input) : store.prepare(input);
}

function cmdOwnedFormalArtifact(family, sub, positional, flags) {
  if (!flags['--owned']) {
    throw err('INVALID_ARGS',
      `${family} show requires --owned; use artifact show for structural reads`);
  }
  const project = requireFlag(flags, '--project');
  const input = sub === 'create'
    ? readInputFile(requireFlag(flags, '--input'), `owned ${family} input`)
    : null;
  const ctx = resolveContext({ project, config: flags['--config'] });
  const workspace = getWorkspace(ctx);
  const factory = family === 'design'
    ? createOwnedDesignStore : createOwnedOutcomeStore;
  const store = factory(ctx, {
    areaIds: workspace.areas.map((area) => area.id),
  });
  if (sub === 'show') return store.get(positional[0]);
  return flags['--apply'] ? store.create(input) : store.prepare(input);
}

function cmdTypedArtifact(family, sub, positional, flags) {
  const ctx = resolveContext({
    project: requireFlag(flags, '--project'), config: flags['--config'],
  });
  if (family === 'specification' && sub === 'show') {
    return getSpecification(ctx, positional[0]);
  }
  const input = readInputFile(requireFlag(flags, '--input'), `${family} input`);
  const prepare = {
    specification: prepareSpecification,
    design: prepareDesign,
    outcome: prepareOutcomeEvidence,
  }[family];
  const prepared = prepare(ctx, input);
  return finishCreation(ctx, 'artifact', prepared.artifact, prepared.file, flags);
}

function cmdApproval(sub, positional, flags) {
  const ctx = resolveContext({
    project: requireFlag(flags, '--project'), config: flags['--config'],
  });
  if (sub === 'show') return getApproval(ctx, positional[0]);
  const input = readInputFile(requireFlag(flags, '--input'), 'approval input');
  if (sub === 'target') return describeApprovalTarget(ctx, input);
  if (sub === 'create') {
    const prepared = prepareApproval(ctx, input);
    return finishCreation(ctx, 'approval', prepared.approval, prepared.file, flags);
  }
  if (sub === 'answer') {
    if (flags['--apply']) {
      // Core revalidates CAS against current content under its own lock.
      const approval = answerApproval(ctx, input);
      return { mode: 'applied', applied: true, approval };
    }
    const { previous, next, file } = prepareApprovalAnswer(ctx, input);
    return {
      mode: 'dry-run', applied: false, approval: next,
      previousRevision: previous.revision,
      files: [{ path: file.rel, action: 'update' }],
    };
  }
  throw err('INVALID_ARGS', `unknown approval subcommand '${sub}'`);
}

function cmdMethodology(positional, flags) {
  const ctx = resolveContext({
    project: requireFlag(flags, '--project'), config: flags['--config'],
  });
  return checkMethodology(ctx, {
    taskId: positional[0],
    ...(Object.hasOwn(flags, '--to') ? { to: flags['--to'] } : {}),
    ...(Object.hasOwn(flags, '--outcome-evidence')
      ? { outcomeEvidenceId: flags['--outcome-evidence'] } : {}),
  });
}

function cmdSession(sub, positional, flags) {
  const ctx = resolveContext({
    project: requireFlag(flags, '--project'),
    config: flags['--config'],
  });
  if (sub === 'create') {
    const prepared = prepareSession(ctx, {
      taskId: requireFlag(flags, '--task'),
      limit: decimalInt(requireFlag(flags, '--limit'), '--limit'),
    });
    const planned = preflightPlan(ctx.projectRoot, [prepared.file]);
    if (!flags['--apply']) {
      return {
        mode: 'dry-run', applied: false, session: prepared.session,
        files: planned.map((f) => ({ path: f.rel, action: f.action })),
      };
    }
    ensureSessionsDir(ctx);
    const result = applyPlan(ctx.projectRoot, planned);
    return {
      mode: 'applied', applied: true, session: prepared.session, ...result,
    };
  }
  if (sub === 'show') return getSession(ctx, positional[0]);
  if (sub === 'record') {
    const input = readInputFile(requireFlag(flags, '--input'), 'record input');
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      throw err('INVALID_SESSION', 'record input must be an object');
    }
    for (const k of Object.keys(input)) {
      if (!['action', 'evidence', 'context'].includes(k)) {
        throw err('UNKNOWN_KEY', `record input has unknown key '${k}'`);
      }
    }
    const recordInput = {
      id: positional[0],
      expectedRevision: decimalInt(
        requireFlag(flags, '--revision'), '--revision'),
      action: input.action,
      evidence: input.evidence,
      context: input.context,
    };
    // Dry-run validates against CURRENT state exactly like apply does.
    const prep = prepareSessionRecord(ctx, recordInput);
    if (!flags['--apply']) {
      return {
        mode: 'dry-run', applied: false,
        session: { id: prep.session.id, used: prep.session.used,
          limit: prep.session.limit, revision: prep.session.revision },
      };
    }
    return recordSession(ctx, recordInput);
  }
  if (sub === 'resume') return resumeSession(ctx, positional[0]);
  throw err('INVALID_ARGS', `unknown session subcommand '${sub}'`);
}

// --- Product lifecycle verbs ---------------------------------------------
// Each verb previews read-only by default; --apply is create-only and every
// apply re-runs its prepare internally. Nothing is overwritten or merged.

function cmdAdopt(flags) {
  const project = requireFlag(flags, '--project');
  const report = prepareAdopt(project, { config: flags['--config'] });
  if (!flags['--apply']) return report;
  // --apply performs ONLY the binding actions the report marks adoptable:
  // workspace enrollment when it is missing and everything else is clean.
  // It never reinitializes, never overwrites and never ignores attention.
  const actions = [];
  if (report.status === 'adoptable' && report.workspace === null
      && report.config !== null) {
    const ctx = resolveContext({ project, config: report.configRel });
    const prepared = prepareWorkspace(ctx, {});
    const planned = preflightPlan(ctx.projectRoot, [prepared.file]);
    const result = applyPlan(ctx.projectRoot, planned);
    actions.push({ action: 'workspace-enrollment',
      path: prepared.file.rel, created: result.created });
  }
  return { ...report, mode: 'applied', applied: actions.length > 0, actions };
}

function lifecycleCtx(flags) {
  return resolveContext({
    project: requireFlag(flags, '--project'), config: flags['--config'],
  });
}

function cmdUpdate(flags) {
  const ctx = lifecycleCtx(flags);
  const options = {};
  if (flags['--reconcile']) options.reconcile = true;
  return flags['--apply']
    ? applyUpdate(ctx, options) : prepareUpdate(ctx, options);
}

function cmdBackup(flags) {
  const destination = requireFlag(flags, '--to');
  const ctx = lifecycleCtx(flags);
  return flags['--apply']
    ? applyBackup(ctx, { destination }) : prepareBackup(ctx, { destination });
}

function cmdRestore(flags) {
  const bundleRel = requireFlag(flags, '--from');
  const projectRoot = resolveProjectRoot(requireFlag(flags, '--project'));
  return flags['--apply']
    ? applyRestore(projectRoot, bundleRel) : prepareRestore(projectRoot, bundleRel);
}

function cmdUninstall(flags) {
  const ctx = lifecycleCtx(flags);
  return flags['--apply'] ? applyUninstall(ctx) : prepareUninstall(ctx);
}

// Read-only semantic investigation plus answer suggestions. A config is
// resolved opportunistically: an explicit --config reports its own error,
// while a project with no config still investigates (and --save then emits
// the record instead of writing it).
function cmdInvestigate(flags) {
  const project = requireFlag(flags, '--project');
  let ctx = null;
  try {
    ctx = resolveContext({ project, config: flags['--config'] });
  } catch (e) {
    if (e.code !== 'CONFIG_NOT_FOUND' || Object.hasOwn(flags, '--config')) {
      throw e;
    }
  }
  const investigation = investigateProject(
    project, ctx ? { config: ctx.config } : {});
  const result = { investigation, suggestions: suggestAnswers(investigation) };
  if (flags['--save']) {
    const { record, suggestedPath } = buildResearchRecord(investigation);
    if (ctx === null) {
      result.research = { saved: false, suggestedPath, record };
    } else {
      const rel = `${ctx.config.paths.research}/${suggestedPath}`;
      const applied = applyPlan(ctx.projectRoot,
        [{ rel, content: JSON.stringify(record, null, 2) + '\n' }]);
      result.research = {
        saved: true, path: rel, suggestedPath, created: applied.created,
      };
    }
  }
  return result;
}

// Opt-in host activation: previews/applies generated proposals into
// project-local destinations only; global and merge-required entries are
// reported as skipped, never written.
function cmdHost(flags) {
  const options = { host: requireFlag(flags, '--host') };
  if (Object.hasOwn(flags, '--surface')) options.surface = flags['--surface'];
  const ctx = lifecycleCtx(flags);
  return flags['--apply']
    ? applyActivation(ctx, options) : prepareActivation(ctx, options);
}

// Supervised verification commands (debt B6). add/approve preview
// first like the other mutating verbs; discover reads candidates from
// the semantic layer and stores them inferred + unapproved; run is the
// only executor and requires an explicitly approved record — the
// harness still never executes project commands on its own initiative.
async function cmdVerify(sub, positional, flags, io) {
  const ctx = resolveContext({
    project: requireFlag(flags, '--project'), config: flags['--config'],
  });
  if (sub === 'list') return listVerifyCommands(ctx);
  if (sub === 'add') {
    const options = { command: requireFlag(flags, '--command') };
    if (!flags['--apply']) {
      return { mode: 'dry-run', applied: false,
        ...prepareAddCommand(ctx, options) };
    }
    return { mode: 'applied', applied: true,
      ...applyAddCommand(ctx, options) };
  }
  if (sub === 'approve') {
    if (!flags['--apply']) {
      return { mode: 'dry-run', applied: false,
        ...prepareApproveCommand(ctx, positional[0]) };
    }
    return { mode: 'applied', applied: true,
      ...applyApproveCommand(ctx, positional[0]) };
  }
  if (sub === 'discover') {
    const inv = investigateProject(ctx.projectRoot, { config: ctx.config });
    const options = { commands: inv.commands };
    const prepare = flags['--approve']
      ? prepareApproveDiscoveredCommands : prepareImportCommands;
    const apply = flags['--approve']
      ? applyApproveDiscoveredCommands : applyImportCommands;
    if (!flags['--apply']) {
      return { mode: 'dry-run', applied: false, ...prepare(ctx, options) };
    }
    return { mode: 'applied', applied: true, ...apply(ctx, options) };
  }
  if (sub === 'approve-discovered') {
    if (!flags['--apply']) {
      return { mode: 'dry-run', applied: false,
        ...prepareApproveDiscoveredCommands(ctx, {}) };
    }
    return { mode: 'applied', applied: true,
      ...applyApproveDiscoveredCommands(ctx, {}) };
  }
  if (sub === 'run') {
    const options = {};
    if (Object.hasOwn(flags, '--timeout')) {
      options.timeoutMs = decimalInt(flags['--timeout'], '--timeout');
    }
    const result = await runVerifyCommand(ctx, positional[0], options);
    // Opt-in CI mode: the result JSON is still printed on stdout, but a
    // run that is not a clean exit-0 (non-zero code, timeout or signal)
    // propagates as a non-zero process exit. The child code is preserved
    // when it exists; timeout/signal terminations have no code and map
    // to 1. run() reads io.exitCode like cmdView's io.viewServer handle.
    if (flags['--fail-on-error']
        && !(result.status === 'exit' && result.code === 0)) {
      io.exitCode = result.status === 'exit'
          && Number.isInteger(result.code) && result.code > 0
        ? result.code : 1;
    }
    return result;
  }
  throw err('INVALID_ARGS', `unknown verify subcommand '${sub}'`);
}

// Loopback read-only viewer API. The returned server handle keeps the
// process alive; the operator stops it with Ctrl+C. The live handle is
// exposed on io.viewServer so embedders/tests can close it explicitly.
async function cmdView(flags, io) {
  const options = {
    project: requireFlag(flags, '--project'), config: flags['--config'],
  };
  if (Object.hasOwn(flags, '--host')) options.host = flags['--host'];
  if (Object.hasOwn(flags, '--port')) {
    options.port = decimalInt(flags['--port'], '--port');
  }
  const api = createApiServer(options);
  const bound = await api.listen();
  if (io !== null && typeof io === 'object') io.viewServer = api;
  const host = bound.host.includes(':') ? `[${bound.host}]` : bound.host;
  return { url: `http://${host}:${bound.port}/`,
    host: bound.host, port: bound.port };
}

export async function run(argv, io) {
  try {

    const { flags, positional } = parseArgs(argv);
    if (flags['--help'] || positional.length === 0) {
      io.stdout(JSON.stringify(helpResult(), null, 2));
      return 0;
    }
    const GROUPED = new Set(['task', 'catalog', 'plan', 'artifact', 'session', 'resource', 'workspace', 'journal', 'capture',
      'specification', 'design', 'outcome', 'approval', 'methodology', 'host', 'verify', 'vantadb']);
    let cmdKey;
    let spec;
    let aliasCommand = null;
    if (GROUPED.has(positional[0])) {
      cmdKey = `${positional[0]} ${positional[1] || ''}`.trim();
      spec = COMMANDS[cmdKey];
    } else if (Object.hasOwn(COMMANDS, positional[0])) {
      cmdKey = positional[0];
      spec = COMMANDS[cmdKey];
    } else {
      // Aliases derive from canonical catalog command ids; catalog is only
      // loaded on this path so inspect/init stay independent of it. With
      // --project the alias set comes from the workspace snapshot.
      const cat = flags['--project']
        ? loadWorkspaceCatalog(resolveContext({
          project: flags['--project'], config: flags['--config'] }))
        : loadCatalog({});
      if (cat.byKey.has(`command/${positional[0]}`.toLowerCase())
          || cat.aliases?.some(
            (a) => a.kind === 'command'
              && a.id.toLowerCase() === positional[0].toLowerCase())) {
        aliasCommand = positional[0];
        cmdKey = positional[0];
        spec = { flags: WORKFLOW_ALIAS_FLAGS, pos: 0,
          usage: `${positional[0]} --project PATH [--mode M] [--task UUID] [--host H] [--profile ID]` };
      }
    }
    if (!spec) {
      throw err('INVALID_ARGS',
        `unknown command '${positional.slice(0, 2).join(' ')}'; run scopegrain --help`);
    }
    for (const name of Object.keys(flags)) {
      if (name !== '--help' && !spec.flags.includes(name)) {
        throw err('INVALID_ARGS', `${name} is not valid for ${cmdKey}`);
      }
    }
    const isAlias = aliasCommand !== null;
    const grouped = GROUPED.has(positional[0]);
    const rest = grouped ? positional.slice(2) : positional.slice(1);
    const [minP, maxP] = spec.pos === -1 ? [0, 1] : [spec.pos, spec.pos];
    if (rest.length < minP || rest.length > maxP) {
      throw err('INVALID_ARGS',
        `wrong argument count for ${cmdKey}: ${spec.usage}`);
    }
    let result;
    if (cmdKey === 'inspect') {
      result = inspectProject(requireFlag(flags, '--project'));
    } else if (cmdKey === 'init') {
      result = await cmdInit(flags, io);
    } else if (cmdKey === 'doctor') {
      result = runDoctor(resolveContext({
        project: requireFlag(flags, '--project'),
        config: flags['--config'],
      }));
    } else if (cmdKey === 'mcp') {
      const { startMCPServer } = await import('./mcp/server.mjs');
      await startMCPServer({
        project: requireFlag(flags, '--project'),
        config: flags['--config'],
      });
      return 0;
    } else if (isAlias) {
      result = cmdWorkflow(aliasCommand, flags);
    } else if (cmdKey === 'workflow') {
      result = cmdWorkflow(rest[0], flags);
    } else if (cmdKey.startsWith('task ')) {
      result = await cmdTask(cmdKey.slice(5), rest, flags, io);
    } else if (cmdKey.startsWith('workspace ')) {
      result = cmdWorkspace(cmdKey.slice(10), flags);
    } else if (cmdKey.startsWith('journal ')) {
      result = cmdJournal(cmdKey.slice(8), rest, flags);
    } else if (cmdKey.startsWith('vantadb ')) {
      result = await cmdVantaDB(cmdKey.slice(8), rest, flags);
    } else if (cmdKey.startsWith('capture ')) {
      result = cmdCapture(cmdKey.slice(8), rest, flags);
    } else if (cmdKey.startsWith('catalog ')) {
      result = cmdCatalog(cmdKey.slice(8), rest, flags);
    } else if (cmdKey.startsWith('resource ')) {
      result = cmdResource(cmdKey.slice(9), rest, flags);
    } else if (cmdKey.startsWith('plan ')) {
      result = cmdPlan(cmdKey.slice(5), rest, flags);
    } else if (cmdKey.startsWith('artifact ')) {
      result = cmdArtifact(cmdKey.slice(9), rest, flags);
    } else if (positional[0] === 'specification' && flags['--owned']) {
      result = cmdOwnedSpecification(positional[1], rest, flags);
    } else if (['design', 'outcome'].includes(positional[0])
        && (flags['--owned'] || positional[1] === 'show')) {
      result = cmdOwnedFormalArtifact(positional[0], positional[1], rest, flags);
    } else if (['specification', 'design', 'outcome'].includes(positional[0])) {
      result = cmdTypedArtifact(positional[0], positional[1], rest, flags);
    } else if (cmdKey.startsWith('approval ')) {
      result = cmdApproval(cmdKey.slice(9), rest, flags);
    } else if (cmdKey === 'methodology check') {
      result = cmdMethodology(rest, flags);
    } else if (cmdKey === 'adopt') {
      result = cmdAdopt(flags);
    } else if (cmdKey === 'update') {
      result = cmdUpdate(flags);
    } else if (cmdKey === 'backup') {
      result = cmdBackup(flags);
    } else if (cmdKey === 'restore') {
      result = cmdRestore(flags);
    } else if (cmdKey === 'uninstall') {
      result = cmdUninstall(flags);
    } else if (cmdKey === 'investigate') {
      result = cmdInvestigate(flags);
    } else if (cmdKey === 'view') {
      result = await cmdView(flags, io);
    } else if (cmdKey.startsWith('verify ')) {
      result = await cmdVerify(cmdKey.slice(7), rest, flags, io);
    } else if (cmdKey.startsWith('host ')) {
      result = cmdHost(flags);
    } else {
      result = cmdSession(cmdKey.slice(8), rest, flags);
    }
    io.stdout(JSON.stringify(result, null, 2));
    // Commands may request a specific success-path exit code through
    // io.exitCode (verify run --fail-on-error); absent means 0.
    return Number.isInteger(io.exitCode) ? io.exitCode : 0;
  } catch (e) {

    const payload = toErrorPayload(e);
    if (e.conflicts) payload.conflicts = e.conflicts;
    io.stderr(JSON.stringify({ error: payload }, null, 2));
    return 1;
  } finally {
    if (typeof io.close === 'function') io.close();
  }
}

// Default IO bound to real stdio; the interactive ask uses readline.
export function defaultIO() {
  let rl = null;
  return {
    isTTY: !!process.stdin.isTTY,
    stdout: (s) => process.stdout.write(s + '\n'),
    stderr: (s) => process.stderr.write(s + '\n'),
    ask: async (label, def) => {
      rl = rl || readline.createInterface({
        input: process.stdin, output: process.stdout,
      });
      const suffix = def ? ` [${def}]` : '';
      const answer = await rl.question(`${label}${suffix}: `);
      return answer.trim() === '' ? (def || '') : answer.trim();
    },
    close: () => { if (rl) rl.close(); },
  };
}
