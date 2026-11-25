// SPDX-License-Identifier: Apache-2.0
// CLI command surface. All results go to stdout as JSON; failures go to
// stderr as {error:{code,message}} with a non-zero exit code.
import crypto from 'node:crypto';
import path from 'node:path';
import readline from 'node:readline/promises';
import { err, toErrorPayload } from './core/errors.mjs';
import { DEFAULT_PATH_PROPOSALS, KNOWN_HOSTS, PATH_KEYS, VERSIONING_KEYS, loadConfig, resolveConfigPath, validateMethodologyMode } from './core/config.mjs';
import { resolveContext } from './core/context.mjs';
import { configRel, detectProjectRoot, resolveInside, resolveProjectRoot } from './core/paths.mjs';
import { assertSafeId } from './core/identifiers.mjs';
import {
  decodeUtf8Strict, mkdirpSync, readFileLimited, writeFileExclusive,
} from './core/fsx.mjs';
import fs from 'node:fs';
import { loadLimits, loadMethodologyPolicy } from './core/policy.mjs';
import { estimateJson, estimateTokens, TOKEN_ESTIMATOR }
  from './core/tokens.mjs';

// Init-wizard prompt strings: the locale answer is asked FIRST and drives
// the language of every subsequent question, so a project configured `en`
// never sees Spanish prompts. The locale prompt itself stays bilingual.
const WIZARD_LOCALE_PROMPT = 'Language / Idioma (es/en)';
const WIZARD_STRINGS = {
  es: {
    name: 'Nombre del proyecto',
    hosts: (list) => `Anfitriones (${list})`,
    methodology:
      'Metodologia: manual (V1), organic-sdd (proporcional), sdd (formal)',
    methodologyInvalid: 'Metodo invalido: use manual, organic-sdd o sdd.',
    configPath: 'Ruta de configuracion',
    paths: {
      plans: 'Ruta de planes',
      tasks: 'Ruta de tareas',
      reports: 'Ruta de informes',
      research: 'Ruta de investigaciones',
      decisions: 'Ruta de decisiones',
      memory: 'Ruta de memoria',
      state: 'Ruta de estado operativo',
    },
    versioning: (key) => `Versionar ${key}? (yes/no)`,
    versioningInvalid: 'responda yes o no',
    invalidValue: 'Valor invalido',
    resumeStale: 'Sesion previa de init incompatible con el esquema actual; '
      + 'reanudar respuestas compatibles? (yes/no)',
    confirmCreate: 'Crear estos archivos? (yes/no)',
  },
  en: {
    name: 'Project name',
    hosts: (list) => `Hosts (${list})`,
    methodology:
      'Methodology: manual (V1), organic-sdd (proportional), sdd (formal)',
    methodologyInvalid: 'Invalid method: use manual, organic-sdd or sdd.',
    configPath: 'Configuration path',
    paths: {
      plans: 'Plans path',
      tasks: 'Tasks path',
      reports: 'Reports path',
      research: 'Research path',
      decisions: 'Decisions path',
      memory: 'Memory path',
      state: 'Operational state path',
    },
    versioning: (key) => `Version ${key}? (yes/no)`,
    versioningInvalid: 'answer yes or no',
    invalidValue: 'Invalid value',
    resumeStale: 'Previous init session is incompatible with the current '
      + 'schema; resume compatible answers? (yes/no)',
    confirmCreate: 'Create these files? (yes/no)',
  },
};

const VALUE_FLAGS = new Set([
  '--project', '--config', '--answers', '--evidence',
  '--title', '--contract', '--author', '--scope', '--revision',
  '--input', '--task', '--mode', '--host', '--profile', '--limit',
  '--query', '--interaction', '--spec', '--design', '--plan', '--to',
  '--outcome-evidence', '--from', '--surface', '--since-sequence', '--port',
  '--command', '--timeout', '--version', '--storage', '--binary',
  '--install-dir', '--namespace', '--key', '--top-k', '--record-id',
  '--reason', '--by', '--log', '--tail', '--backlog', '--status', '--index',
  '--text', '--outcome', '--cursor', '--arguments', '--script',
  '--assessment', '--source', '--out', '--registry', '--op', '--id',
  '--token-limit', '--hosts', '--structure-debounce', '--fields',
  '--actor', '--reference', '--expect-digest', '--kind',
]);
const BOOL_FLAGS = new Set([
  '--apply', '--approve', '--help', '--owned', '--save', '--fail-on-error',
  '--reconcile', '--defaults', '--probe', '--diff', '--no-vantadb',
  '--record', '--keep-files', '--no-resume', '--lazy', '--no-structure',
  '--all', '--allow-write', '--compact', '--skip-chain-scan', '--explain',
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
  'journal checkpoint': {
    flags: ['--project', '--config'], pos: 0,
    usage: 'journal checkpoint --project PATH [--config REL]',
  },
  'journal verify': {
    flags: ['--project', '--config', '--expect-digest', '--skip-chain-scan',
      '--fail-on-error'], pos: 0,
    usage: 'journal verify --project PATH [--config REL] [--expect-digest HEX] [--skip-chain-scan] [--fail-on-error]',
  },
  'journal compact': {
    flags: ['--project', '--config', '--apply'], pos: 0,
    usage: 'journal compact --project PATH [--config REL] [--apply]',
  },
  'structure scan': {
    flags: ['--project', '--config', '--apply'], pos: 0,
    usage: 'structure scan --project PATH [--config REL] [--apply]',
  },
  'structure status': {
    flags: ['--project', '--config'], pos: 0,
    usage: 'structure status --project PATH [--config REL]',
  },
  'structure show': {
    flags: ['--project', '--config'], pos: 0,
    usage: 'structure show --project PATH [--config REL]',
  },
  'structure refresh': {
    flags: ['--project', '--config', '--apply'], pos: 0,
    usage: 'structure refresh --project PATH [--config REL] [--apply]',
  },
  'vantadb setup': {
    flags: ['--project', '--config', '--version', '--storage', '--binary',
      '--install-dir', '--apply'], pos: 0,
    usage: 'vantadb setup --project PATH [--version X] [--storage PATH] [--binary PATH] [--install-dir DIR] [--apply]',
  },
  'vantadb status': {
    flags: ['--project', '--config', '--probe', '--timeout'], pos: 0,
    usage: 'vantadb status --project PATH [--probe] [--timeout MS]',
  },
  'vantadb sync': {
    flags: ['--project', '--config', '--limit', '--timeout', '--apply'],
    pos: 0,
    usage: 'vantadb sync --project PATH [--limit N] [--timeout MS] [--apply]',
  },
  'vantadb get': {
    flags: ['--project', '--config', '--namespace', '--key', '--timeout'], pos: 0,
    usage: 'vantadb get --project PATH --namespace NS --key K [--timeout MS]',
  },
  'vantadb search': {
    flags: ['--project', '--config', '--namespace', '--query', '--top-k',
      '--mode', '--timeout'], pos: 0,
    usage: 'vantadb search --project PATH --namespace NS --query TEXT [--top-k N] [--mode keyword|vector|hybrid] [--timeout MS]',
  },
  'vantadb list': {
    flags: ['--project', '--config', '--namespace', '--cursor', '--timeout'],
    pos: 0,
    usage: 'vantadb list --project PATH --namespace NS [--cursor N] [--timeout MS]',
  },
  'vantadb reinforce': {
    flags: ['--project', '--config', '--namespace', '--key', '--outcome',
      '--timeout', '--apply'], pos: 0,
    usage: 'vantadb reinforce --project PATH --namespace NS --key K --outcome used|corrected|unused [--timeout MS] [--apply]',
  },
  'vantadb recall': {
    flags: ['--project', '--config', '--query', '--scope', '--top-k',
      '--timeout'], pos: 0,
    usage: 'vantadb recall --project PATH --query TEXT [--scope session|agent|team] [--top-k N] [--timeout MS]  (default: project namespace; --scope opts into the engine pool)',
  },
  'vantadb context': {
    flags: ['--project', '--config', '--record-id', '--top-k', '--limit',
      '--timeout'], pos: 0,
    usage: 'vantadb context --project PATH --record-id ID [--top-k N] [--limit N] [--timeout MS]',
  },
  'vantadb distill': {
    flags: ['--project', '--config', '--limit', '--timeout', '--apply'],
    pos: 0,
    usage: 'vantadb distill --project PATH [--limit N] [--timeout MS] [--apply]',
  },
  'vantadb sync-memory': {
    flags: ['--project', '--config', '--limit', '--timeout', '--apply'],
    pos: 0,
    usage: 'vantadb sync-memory --project PATH [--limit N] [--timeout MS] [--apply]',
  },
  'vantadb sync-persona': {
    flags: ['--project', '--config', '--limit', '--timeout', '--apply'], pos: 0,
    usage: 'vantadb sync-persona --project PATH [--limit N] [--timeout MS] [--apply]',
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
    flags: ['--project', '--config', '--backlog'], pos: 0,
    usage: 'task list --project PATH [--backlog NAME]',
  },
  'task meta': {
    flags: ['--project', '--config', '--revision', '--input', '--apply'],
    pos: 1,
    usage: 'task meta --project PATH ID --revision N --input FILE [--apply]',
  },
  'task authorize': {
    flags: ['--project', '--config', '--revision', '--actor', '--reference',
      '--apply'], pos: 1,
    usage: 'task authorize --project PATH ID --revision N --actor NAME --reference REF [--apply]',
  },
  'task reassess': {
    flags: ['--project', '--config', '--revision', '--input', '--apply'],
    pos: 1,
    usage: 'task reassess --project PATH ID --revision N --input FILE [--apply]',
  },
  'task link': {
    flags: ['--project', '--config', '--revision', '--kind', '--apply'],
    pos: 2,
    usage: 'task link --project PATH ID TARGET --revision N [--kind REL] [--apply]',
  },
  'task unlink': {
    flags: ['--project', '--config', '--revision', '--kind', '--apply'],
    pos: 2,
    usage: 'task unlink --project PATH ID TARGET --revision N [--kind REL] [--apply]',
  },
  'task disposition': {
    flags: ['--project', '--config', '--revision', '--reason', '--by',
      '--apply'], pos: 2,
    usage: 'task disposition --project PATH ID KIND --revision N [--reason TEXT] [--by X] [--apply]',
  },
  'task note': {
    flags: ['--project', '--config', '--revision', '--text', '--apply'],
    pos: 1,
    usage: 'task note --project PATH ID --revision N --text TEXT [--apply]',
  },
  'task step': {
    flags: ['--project', '--config', '--revision', '--index', '--status',
      '--apply'], pos: 1,
    usage: 'task step --project PATH ID --revision N --index N --status pending|done|skipped [--apply]',
  },
  'task show': {
    flags: ['--project', '--config'], pos: 1,
    usage: 'task show --project PATH ID|SLUG',
  },
  'task activate': {
    flags: ['--project', '--config'], pos: 1,
    usage: 'task activate --project PATH ID|SLUG',
  },
  'task active': {
    flags: ['--project', '--config'], pos: 0,
    usage: 'task active --project PATH',
  },
  'task deactivate': {
    flags: ['--project', '--config'], pos: 0,
    usage: 'task deactivate --project PATH',
  },
  'task transition': {
    flags: ['--project', '--config', '--revision', '--evidence', '--apply'],
    pos: 2,
    usage: 'task transition --project PATH ID STATE --revision N [--evidence FILE] [--apply]',
  },
  'task doc': {
    flags: ['--project', '--config'], pos: 1,
    usage: 'task doc --project PATH ID',
  },
  'task converge': {
    flags: ['--project', '--config', '--record'], pos: 1,
    usage: 'task converge --project PATH ID|SLUG [--record]',
  },
  'task analyze': {
    flags: ['--project', '--config'], pos: 1,
    usage: 'task analyze --project PATH ID|SLUG',
  },
  'task checklist': {
    flags: ['--project', '--config', '--input', '--revision',
      '--status', '--text', '--key', '--apply'],
    pos: -1,
    usage: 'task checklist --project PATH [ID] '
      + '(--input FILE to create | no ID to list | ID to show | '
      + 'ID --key CHK### --status S --revision N [--text NOTE] to mark; '
      + '--apply writes for create and mark)',
  },
  'plan run': {
    flags: ['--project', '--config', '--apply'], pos: 1,
    usage: 'plan run --project PATH KEY [--apply]',
  },
  'plan stories': {
    flags: ['--project', '--config'], pos: 1,
    usage: 'plan stories --project PATH KEY',
  },
  'specification clarify': {
    flags: ['--project', '--config', '--input', '--apply'], pos: 0,
    usage: 'specification clarify --project PATH --input FILE [--apply]',
  },
  'constitution show': {
    flags: ['--project', '--config'], pos: 0,
    usage: 'constitution show --project PATH',
  },
  'constitution set': {
    flags: ['--project', '--config', '--input', '--apply'], pos: 0,
    usage: 'constitution set --project PATH --input FILE [--apply]',
  },
  'config path': {
    flags: [], pos: 0,
    usage: 'config path',
  },
  'config show': {
    flags: [], pos: 0,
    usage: 'config show',
  },
  'config set': {
    flags: ['--input', '--apply'], pos: 0,
    usage: 'config set --input FILE [--apply]',
  },
  'context': {
    flags: ['--project', '--config', '--tail', '--no-vantadb', '--timeout',
      '--no-structure', '--structure-debounce', '--fields', '--compact',
      '--explain'],
    pos: 0,
    usage: 'context --project PATH [--tail N] '
      + '[--no-vantadb] [--no-structure] [--structure-debounce MS] '
      + '[--timeout MS] [--fields CSV] [--compact] [--explain]',
  },
  'task check-action': {
    flags: ['--project', '--config'], pos: 2,
    usage: 'task check-action --project PATH ID ACTION',
  },
  'task suggest': {
    flags: ['--project', '--config', '--limit'], pos: 1,
    usage: 'task suggest --project PATH ID|SLUG [--limit N]  (suggestive only — never mutates task.skills)',
  },
  'task gate': {
    flags: ['--project', '--config'], pos: 2,
    usage: 'task gate --project PATH ID|SLUG|- ACTION  (exit contract: 0 allow, 2 deny, 3 require-gate; any non-zero must block a host hook)',
  },
  'memory add': {
    flags: ['--project', '--config', '--log', '--input', '--apply'], pos: 0,
    usage: 'memory add --project PATH --log lessons|outcomes|progress --input FILE [--apply]',
  },
  'memory list': {
    flags: ['--project', '--config', '--log', '--tail'], pos: 0,
    usage: 'memory list --project PATH --log lessons|outcomes|progress|goals|activity [--tail N]',
  },
  'goal create': {
    flags: ['--project', '--config', '--input', '--apply'], pos: 0,
    usage: 'goal create --project PATH --input FILE [--apply]',
  },
  'goal list': {
    flags: ['--project', '--config'], pos: 0,
    usage: 'goal list --project PATH',
  },
  'goal transition': {
    flags: ['--project', '--config', '--to', '--apply'], pos: 1,
    usage: 'goal transition --project PATH ID --to open|achieved|dropped [--apply]',
  },
  metrics: {
    flags: ['--project', '--config'], pos: 0,
    usage: 'metrics --project PATH',
  },
  'report save': {
    flags: ['--project', '--config'], pos: 0,
    usage: 'report save --project PATH',
  },
  'report list': {
    flags: ['--project', '--config', '--tail'], pos: 0,
    usage: 'report list --project PATH [--tail N]',
  },
  'activity record': {
    flags: ['--project', '--config', '--input', '--apply'], pos: 0,
    usage: 'activity record --project PATH --input FILE [--apply]',
  },
  'hooks install': {
    flags: ['--project', '--config', '--apply'], pos: 0,
    usage: 'hooks install --project PATH [--apply]',
  },
  'hooks uninstall': {
    flags: ['--project', '--config', '--apply'], pos: 0,
    usage: 'hooks uninstall --project PATH [--apply]',
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
  'dist run': {
    flags: ['--project', '--config', '--input', '--no-resume'], pos: 0,
    usage: 'dist run --project PATH --input FILE [--no-resume]',
  },
  'dist stack': {
    flags: ['--project', '--config', '--input'], pos: 0,
    usage: 'dist stack --project PATH --input FILE  ({sources:[{uri,priority}]})',
  },
  'dist compose': {
    flags: ['--project', '--config', '--input'], pos: 0,
    usage: 'dist compose --project PATH --input FILE  ({base, layers})',
  },
  'dist validate': {
    flags: ['--project', '--config', '--input'], pos: 0,
    usage: 'dist validate --project PATH --input FILE  (catalog submission)',
  },
  'dist bundle-validate': {
    flags: ['--project', '--config', '--input'], pos: 0,
    usage: 'dist bundle-validate --project PATH --input FILE',
  },
  'dist extension-register': {
    flags: ['--project', '--config', '--input'], pos: 0,
    usage: 'dist extension-register --project PATH --input FILE',
  },
  'dist extension-list': {
    flags: ['--project', '--config'], pos: 0,
    usage: 'dist extension-list --project PATH',
  },
  'dist extension-activate': {
    flags: ['--project', '--config'], pos: 1,
    usage: 'dist extension-activate --project PATH ID',
  },
  'dist extension-deactivate': {
    flags: ['--project', '--config'], pos: 1,
    usage: 'dist extension-deactivate --project PATH ID',
  },
  'dist bundle-install': {
    flags: ['--project', '--config', '--input', '--apply'], pos: 0,
    usage: 'dist bundle-install --project PATH --input FILE [--apply]',
  },
  'dist bundle-mount': {
    flags: ['--project', '--config'], pos: 1,
    usage: 'dist bundle-mount --project PATH ID',
  },
  'dist bundle-unmount': {
    flags: ['--project', '--config'], pos: 1,
    usage: 'dist bundle-unmount --project PATH ID',
  },
  'dist bundle-uninstall': {
    flags: ['--project', '--config', '--keep-files', '--apply'], pos: 1,
    usage: 'dist bundle-uninstall --project PATH ID [--keep-files] [--apply]',
  },
  'dist mounted-list': {
    flags: ['--project', '--config'], pos: 0,
    usage: 'dist mounted-list --project PATH',
  },
  'dist selftest': {
    flags: ['--project', '--config'], pos: 0,
    usage: 'dist selftest --project PATH',
  },
  'dist journal': {
    flags: ['--project', '--config', '--tail', '--registry', '--op', '--id'],
    pos: 0,
    usage: 'dist journal --project PATH [--tail N] [--registry R] [--op O] [--id I]',
  },
  'dist pack': {
    flags: ['--project', '--config', '--source', '--out'], pos: 0,
    usage: 'dist pack --project PATH --source DIR --out FILE',
  },
  'dist extension-remove': {
    flags: ['--project', '--config', '--apply'], pos: 1,
    usage: 'dist extension-remove --project PATH ID [--apply]',
  },
  'dist preset-remove': {
    flags: ['--project', '--config', '--apply'], pos: 1,
    usage: 'dist preset-remove --project PATH ID [--apply]',
  },
  'dist preset-register': {
    flags: ['--project', '--config', '--input'], pos: 0,
    usage: 'dist preset-register --project PATH --input FILE',
  },
  'dist preset-list': {
    flags: ['--project', '--config'], pos: 0,
    usage: 'dist preset-list --project PATH',
  },
  workflow: {
    flags: ['--project', '--config', '--mode', '--task', '--host',
      '--profile', '--interaction', '--arguments', '--script', '--lazy',
      '--fields', '--compact'],
    pos: 1,
    usage: 'workflow COMMAND [--mode M] [--task UUID] [--host H] '
      + '[--profile ID] [--interaction direct|guided] '
      + '[--arguments TEXT] [--script PATH] [--lazy] '
      + '[--fields CSV] [--compact]',
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
  'plan status': {
    flags: ['--project', '--config'], pos: 1, usage: 'plan status KEY',
  },
  'plan conclude': {
    flags: ['--project', '--config', '--partial', '--report', '--apply'],
    pos: 1,
    usage: 'plan conclude KEY [--partial] [--report] [--apply]',
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
    flags: ['--project', '--config', '--task', '--limit', '--token-limit',
      '--apply'], pos: 0,
    usage: 'session create --task UUID --limit N [--token-limit N] [--apply]',
  },
  'session show': {
    flags: ['--project', '--config'], pos: 1, usage: 'session show UUID',
  },
  'session record': {
    flags: ['--project', '--config', '--revision', '--input', '--apply'], pos: 1,
    usage: 'session record UUID --revision N --input FILE [--apply]',
  },
  'session resume': {
    flags: ['--project', '--config', '--no-vantadb', '--timeout'], pos: 1,
    usage: 'session resume UUID [--no-vantadb] [--timeout MS]',
  },
  adopt: {
    flags: ['--project', '--config', '--apply'], pos: 0,
    usage: 'adopt --project PATH [--config REL] [--apply]',
  },
  update: {
    flags: ['--project', '--config', '--reconcile', '--apply', '--diff'],
    pos: 0,
    usage: 'update --project PATH [--config REL] [--reconcile] [--diff] [--apply]',
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
    flags: ['--project', '--config', '--save', '--diff'], pos: 0,
    usage: 'investigate --project PATH [--config REL] [--save] [--diff]',
  },
  assess: {
    flags: ['--input', '--assessment'], pos: 0,
    usage: 'assess --input DIFF_FILE [--assessment FILE] '
      + '— evidence-only risk classification of a unified diff',
  },
  'host activate': {
    flags: ['--project', '--config', '--host', '--surface', '--apply'], pos: 0,
    usage: 'host activate --project PATH --host NAME [--surface X] [--apply]',
  },
  'host manifest': {
    flags: ['--project', '--config', '--host', '--surface'], pos: 0,
    usage: 'host manifest --project PATH --host NAME [--surface X]',
  },
  'host parity': {
    flags: ['--project', '--config', '--hosts'], pos: 0,
    usage: 'host parity --project PATH [--hosts CSV]',
  },
  'host gate': {
    flags: ['--project', '--config', '--host'], pos: 0,
    usage: 'host gate --project PATH --host NAME  (read-only merge proposal for the native gate channel)',
  },
  'helper install': {
    flags: ['--project', '--config', '--input'], pos: 0,
    usage: 'helper install --project PATH --input FILE',
  },
  'helper list': {
    flags: ['--project', '--config'], pos: 0,
    usage: 'helper list --project PATH',
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
    flags: ['--project', '--config', '--apply', '--all'], pos: 0,
    usage: 'verify approve-discovered --project PATH [--all] [--apply]',
  },
  'verify run': {
    flags: ['--project', '--config', '--timeout', '--fail-on-error'], pos: 1,
    usage: 'verify run ID --project PATH [--timeout MS] [--fail-on-error]',
  },
  view: {
    flags: ['--project', '--config', '--port', '--host', '--allow-write'],
    pos: 0,
    usage: 'view --project PATH [--config REL] [--port N] [--host ADDR] [--allow-write]',
  },
};

// Aliases are derived from canonical catalog command ids at dispatch time;
// the flag set is fixed by the settled interface.
const WORKFLOW_ALIAS_FLAGS = [
  '--project', '--config', '--mode', '--task', '--host', '--profile',
  '--interaction', '--arguments', '--script', '--lazy',
  '--fields', '--compact',
];

// Family-level descriptions: every command resolves its description by
// exact key first, then by its first token (the family). Commands are
// never documented as their own name.
const FAMILY_DESCRIPTIONS = {
  inspect: 'read-only manifest scan of a directory (pre-init snapshot)',
  init: 'bootstrap a directory into a Scopegrain project',
  doctor: 'health report for a configured project',
  mcp: 'start the stdio MCP server bound to a project',
  workflow: 'build a read-only workflow packet for a catalog command',
  context: 'session-start packet (instructions, tasks, goals, journal)',
  metrics: 'task metrics derived from the operational worklog',
  adopt: 'report what adopting an initialized project would bind',
  update: 're-project harness-owned files after an upgrade',
  backup: 'export the config and declared paths into a bundle',
  restore: 'restore a bundle produced by backup (create-only)',
  uninstall: 'remove only files provably owned by the harness',
  investigate: 'semantic project investigation and init suggestions',
  assess: 'evidence-only risk classification of a unified diff',
  view: 'serve the loopback project API/viewer',
  workspace: 'workspace enrollment records',
  journal: 'pending journal operations and recovery',
  structure: 'structural code index (scan/status/show/refresh)',
  vantadb: 'optional VantaDB memory backend integration',
  capture: 'bounded external-input capture store and review',
  task: 'task lifecycle records (create, meta, transition, gate...)',
  plan: 'versioned implementation plans and story rendering',
  specification: 'specification artifacts and clarification sessions',
  design: 'design artifacts (owned records with --owned)',
  outcome: 'outcome-evidence artifacts (owned records with --owned)',
  constitution: 'versioned project constitution',
  config: 'user-global onboarding defaults (~/.config/scopegrain)',
  memory: 'append-only operational memory logs',
  goal: 'goal/objective records linked from tasks',
  report: 'persisted doctor reports',
  activity: 'retroactive activity records (commits outside tasks)',
  hooks: 'git post-commit hook management',
  approval: 'digest-bound approval records (CAS)',
  methodology: 'methodology gate checks for records',
  catalog: 'resource catalog listing, lookup and integrity',
  resource: 'catalog resource diagnosis and pinned restore',
  dist: 'declarative distribution (bundles, presets, extensions)',
  session: 'bounded session records with token budgets',
  host: 'host activation, manifests, parity and gate proposals',
  helper: 'project-local helper script installation',
  verify: 'supervised verification commands (approve, run)',
};

function describeCommand(name) {
  return FAMILY_DESCRIPTIONS[name] ?? FAMILY_DESCRIPTIONS[name.split(' ')[0]] ?? name;
}

function helpResult() {
  return {
    usage: 'scopegrain <command> [options]  |  scopegrain --help  |  scopegrain <command> --help',
    commands: Object.entries(COMMANDS).map(([name, c]) => ({
      command: c.usage,
      description: describeCommand(name),
    })),
    notes: [
      '--yes and --force are not supported; confirmation is always explicit',
      'results are JSON on stdout; errors are JSON on stderr; exit 0 ok, 1 error, 2 usage error (INVALID_ARGS) — task gate also uses 2 for deny and 3 for require-gate, verify run --fail-on-error propagates the child code',
      'GNU forms: --flag=value equals --flag value; a bare -- ends flag parsing and everything after it is positional; -h is --help',
      'scopegrain <command> --help prints {command, usage, flags, description} for that verb',
      '--project PATH: when omitted, the first ancestor directory (cwd included, up to 10 levels) holding .scopegrain/config.json is used; init always requires an explicit PATH — it names the directory to initialize',
      'JSON creation previews do not reserve IDs; use IDs returned by --apply',
      'task create --input is the supported creation path; the --title/--contract/--author flag form only applies to projects in manual methodology mode',
      'mutating verbs preview as {mode:"dry-run",plan|task} unless --apply; this includes task create (both forms), meta/disposition/note/step/transition, checklist mark, goal create/transition, memory add, journal compact, constitution set, dist bundle-uninstall/extension-remove/preset-remove and vantadb sync/reinforce/distill/sync-memory/sync-persona',
      'intake.mode (off|capture|suggest|auto) lives in .scopegrain/config.json under "intake"; edit the key directly — it is not an interactive wizard question and init --answers does not carry it',
      'Methodology checks and stored approvals are not native tool permissions',
      '--owned opts specification create/show into journal ownership; legacy behavior stays unchanged without it',
      '--owned opts design/outcome create/show into journal ownership; new show commands require it',
      'adopt/update/backup/restore/uninstall preview first; --apply is create-only and never overwrites, merges or reinitializes',
      'update --reconcile rewrites ONLY diverged generated files under harness-owned roots (the config dir and generated subdirs) and applyable host destinations (.claude/.devin/.agents/.opencode/.codex/.cursor/.vscode/.github); root-level files (AGENTS.md, CLAUDE.md), the config and manual merge targets always stay conflict',
      'init --defaults skips the prompt loop: answers come from the existing config (noop re-init) or from the investigation suggestions plus the wizard defaults; --apply still gates writes; mutually exclusive with --answers',
      'inspect is the bounded manifest-scan snapshot init stores as discovery.json; investigate is the deeper semantic analysis that adds init-answer suggestions',
      'investigate is read-only; --save writes one research record under paths.research when a config resolves',
      'host activate writes project-local destinations only; global host paths and shared merges are never written',
      'capture proposals lists review proposals; capture review --apply creates an owned capture only from an approved decision',
      'verify add/approve/discover preview first; discover --approve bulk-approves the literal candidates just shown; approve-discovered without candidates approves all stored inferred and needs --all; verify run executes only an explicitly approved command as literal argv (bounded, never a shell)',
      'verify run prints the result JSON and exits 0 by default; --fail-on-error propagates the command exit code (or 1 on timeout/signal)',
      'view serves a loopback API and keeps running; press Ctrl+C to stop; an occupied default port walks to the next free one (an explicit --port fails fast); --allow-write opts in to the bounded catalog-doc edit endpoint (CAS-checked PUT) — the API stays read-only without it',
      'an --input file resolving outside --project emits an INPUT_OUTSIDE_PROJECT warning on stderr — advisory defense-in-depth, never a block',
    ],
  };
}

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    // GNU separator: everything after a bare `--` is positional, even
    // strings that look like flags.
    if (a === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (a === '-h') {
      flags['--help'] = true;
      continue;
    }
    if (REJECTED_FLAGS.has(a)) {
      throw err('INVALID_ARGS',
        `${a} is not supported; confirmation is always explicit`);
    }
    if (BOOL_FLAGS.has(a)) {
      flags[a] = true;
    } else if (VALUE_FLAGS.has(a)) {
      const next = argv[i + 1];
      if (typeof next !== 'string' || next.startsWith('--')) {
        throw err('INVALID_ARGS', `${a} requires a value`);
      }
      flags[a] = argv[++i];
    } else if (typeof a !== 'string') {
      // Programmatic callers (tests, embedders) may pass non-string argv
      // elements; reject structurally instead of crashing on .startsWith.
      throw err('INVALID_ARGS', 'argv elements must be strings');
    } else if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq <= 2) throw err('INVALID_ARGS', `unknown flag ${a}`);
      const name = a.slice(0, eq);
      if (REJECTED_FLAGS.has(name)) {
        throw err('INVALID_ARGS',
          `${name} is not supported; confirmation is always explicit`);
      }
      if (BOOL_FLAGS.has(name)) {
        throw err('INVALID_ARGS', `${name} does not take a value`);
      }
      if (!VALUE_FLAGS.has(name)) {
        throw err('INVALID_ARGS', `unknown flag ${a}`);
      }
      flags[name] = a.slice(eq + 1);
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

// --project default: explicit flag always wins; otherwise the nearest
// ancestor directory (cwd included, up to 10 ascents) holding
// .scopegrain/config.json is bound. With no marker, the error is the
// same INVALID_ARGS an explicit-but-missing flag produced before.
// init is the one verb that keeps requiring the flag explicitly: it
// names the directory to initialize, not a project to bind.
function projectFlag(flags) {
  return flags['--project'] ?? detectProjectRoot(process.cwd())
    ?? requireFlag(flags, '--project');
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
  const { answer: sessionAnswer, status: sessionStatus } = await import('./core/init-session.mjs');
  const { investigateProject, suggestAnswers } = await import('./discovery/semantic.mjs');
  let userCfg = null;
  if (!existing) {
    try {
      const { loadUserConfig } = await import('./core/user-config.mjs');
      userCfg = loadUserConfig().config;
    } catch { userCfg = null; }
  }
  // Adaptive defaults: run the repository investigation once so detected
  // host signals / project name seed the interactive defaults (the user
  // can still override). Investigation is read-only and failure-safe.
  let suggestions = null;
  if (!existing) {
    try {
      suggestions = suggestAnswers(investigateProject(projectRoot, {}));
    } catch { suggestions = null; }
  }
  const st = session === null ? null : sessionStatus(session);
  const answered = new Set(st === null ? [] : st.answered);
  const leaf = (id) => id.split('.').reduce((o, k) => o?.[k], st.answers);
  // Prompt language: an existing config or the user global supplies a hint
  // for messages emitted before the locale answer arrives; the answered
  // locale then takes over for every subsequent question.
  let t = WIZARD_STRINGS[existing?.locale ?? userCfg?.locale]
    ?? WIZARD_STRINGS.en;
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
        io.stderr(`${t.invalidValue}: ${e.message}`);
      }
    }
  };
  const answers = {};
  // Locale is asked first (bilingual prompt) so it can localize the rest.
  answers.locale = await askOrReplay('locale', () => io.ask(
    WIZARD_LOCALE_PROMPT,
    existing ? existing.locale : (userCfg?.locale ?? 'es')));
  t = WIZARD_STRINGS[answers.locale] ?? WIZARD_STRINGS.en;
  answers.name = await askOrReplay('name', () => io.ask(t.name,
    existing ? existing.project.name
      : (suggestions?.name?.value ?? path.basename(projectRoot))));
  const hostList = KNOWN_HOSTS.join(',');
  answers.hosts = await askOrReplay('hosts', async () => {
    const detected = suggestions?.hosts?.value;
    const defaultHosts = existing
      ? existing.hosts.join(',')
      : (detected && detected.length ? detected.join(',')
        : (userCfg?.hosts ? userCfg.hosts.join(',') : hostList));
    const hostsRaw = await io.ask(t.hosts(hostList), defaultHosts);
    return hostsRaw.split(',').map((h) => h.trim()).filter(Boolean);
  });
  // Methodology question: existing normalized mode wins, otherwise the
  // user global default (when set) or authored interactive default.
  const existingMode = existing
    ? validateMethodologyMode(existing.methodology) : null;
  const modeDefault = existingMode
    ?? userCfg?.methodology
    ?? loadMethodologyPolicy().interactiveDefault;
  answers.methodology = await askOrReplay('methodology', async () => {
    for (;;) {
      const reply = (await io.ask(t.methodology, modeDefault)).trim();
      if (loadMethodologyPolicy().modes.includes(reply)) return reply;
      io.stderr(t.methodologyInvalid);
    }
  });
  const configRel = await io.ask(t.configPath, configFlag);
  answers.paths = {};
  for (const key of PATH_KEYS) {
    answers.paths[key] = await askOrReplay(`paths.${key}`,
      () => io.ask(t.paths[key],
        existing ? existing.paths[key] : DEFAULT_PATH_PROPOSALS[key]),
      true);
  }
  // Optional versioning: eight yes/no questions, never guessed defaults.
  answers.versioning = {};
  for (const key of VERSIONING_KEYS) {
    const def = existing
      ? (existing.versioning[key] ? 'yes' : 'no')
      : (userCfg?.versioning?.[key] ? 'yes' : 'no');
    answers.versioning[key] = await askOrReplay(`versioning.${key}`,
      async () => {
        for (;;) {
          const reply = (await io.ask(t.versioning(key), def))
            .trim().toLowerCase();
          if (reply === 'yes' || reply === 'no') return reply === 'yes';
          io.stderr(t.versioningInvalid);
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

// After a successful init apply, seed the structural index so the first
// agent request already has code metrics. Best-effort: a scan failure
// must never fail an already-applied init.
async function initStructureIndex(projectRoot) {
  try {
    const { scanStructure, writeStructureIndex } = await import('./discovery/structure.mjs');
    const ctx = resolveContext({ project: projectRoot });
    const index = scanStructure(ctx.projectRoot);
    const rel = writeStructureIndex(ctx, index);
    return { written: rel, files: index.totals.files };
  } catch (e) {
    return { written: null, error: `${e.code ?? 'INTERNAL'}: ${e.message}` };
  }
}

// --defaults: non-interactive answers at the same trust level as
// accepting every interactive proposal. A valid existing config is the
// preferred source — its values are replayed so a re-init stays a noop;
// otherwise the semantic investigation suggests values and the wizard's
// own defaults fill what detection left unanswered (empty host signals
// fall back to the full host list, exactly like the interactive default).
async function defaultAnswers(projectRoot, configRel) {
  const { investigateProject, suggestAnswers } = await import('./discovery/semantic.mjs');
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
  let userCfg = null;
  try {
    const { loadUserConfig } = await import('./core/user-config.mjs');
    userCfg = loadUserConfig().config;
  } catch { userCfg = null; }
  return {
    name: suggestions.name.value,
    locale: userCfg?.locale ?? 'es',
    hosts: suggestions.hosts.value.length > 0
      ? [...suggestions.hosts.value]
      : (userCfg?.hosts ? [...userCfg.hosts] : [...KNOWN_HOSTS]),
    paths: Object.fromEntries(
      PATH_KEYS.map((key) => [key, suggestions.paths[key].value])),
    versioning: {
      ...suggestions.versioning.value,
      ...(userCfg?.versioning ?? {}),
    },
    methodology: userCfg?.methodology
      ?? loadMethodologyPolicy().interactiveDefault,
  };
}

async function cmdInit(flags, io) {
  const { prepareInit, applyPlan } = await import('./core/bootstrap.mjs');
  const { openInitSession, status: sessionStatus, discard: discardInitSession } = await import('./core/init-session.mjs');
  const projectRoot = resolveProjectRoot(
    requireFlag(flags, '--project'));
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
      // The locale question has not run yet: fall back to the existing
      // config locale, then the user global, then English.
      let priorLocale = existing?.locale ?? null;
      if (priorLocale === null) {
        try {
          const { loadUserConfig } =
            await import('./core/user-config.mjs');
          priorLocale = loadUserConfig().config?.locale ?? null;
        } catch { priorLocale = null; }
      }
      const resume = await io.ask(
        (WIZARD_STRINGS[priorLocale] ?? WIZARD_STRINGS.en).resumeStale,
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
    answers = await defaultAnswers(projectRoot, configRel);
  } else {
    answers = readInputFile(flags['--answers'], 'answers file');
  }
  const prepared = prepareInit({ projectRoot, configRel, answers });
  if (interactive) {
    io.stdout(JSON.stringify({ mode: 'plan', ...planJson(prepared) }, null, 2));
    const confirm = await io.ask(
      (WIZARD_STRINGS[answers.locale] ?? WIZARD_STRINGS.en).confirmCreate,
      'no');
    if (confirm.trim().toLowerCase() !== 'yes') {
      // Declining the plan is an abort: drop the session this run created
      // (plus its now-empty stateDir dirs) so cancel leaves no writes.
      if (sessionCreated) discardInitSession(session);
      return { mode: 'dry-run', applied: false };
    }
    const result = applyPlan(projectRoot, prepared.files);
    if (session !== null) discardInitSession(session);
    const structureIndex = await initStructureIndex(projectRoot);
    return appliedInitResult(result, { structureIndex });
  }
  // --defaults echoes the machine-chosen answers so the operator can audit
  // exactly what consent produced; --answers stays quiet (user-supplied).
  const extra = flags['--defaults'] ? { answers } : {};
  if (flags['--apply']) {
    const result = applyPlan(projectRoot, prepared.files);
    const structureIndex = await initStructureIndex(projectRoot);
    return appliedInitResult(result, { ...extra, structureIndex });
  }
  return { mode: 'dry-run', applied: false, ...extra, ...planJson(prepared) };
}

async function cmdTask(sub, positional, flags, io) {
  const { getTask, listTasks, prepareTask, RELATION_KINDS } =
    await import('./core/tasks.mjs');
  const {
    transitionTask, updateTaskMeta, checkAction, evaluateTaskMeta,
    evaluateTaskTransition, validateMetaUpdateInput,
    validateTransitionInput, authorizeTask, evaluateTaskAuthorization,
    validateAuthorizeInput, reassessTask, evaluateTaskReassessment,
    validateReassessInput,
  } = await import('./core/transition.mjs');
  const { appendWorklog } = await import('./core/worklog.mjs');
  const { writeTaskDoc } = await import('./core/taskdoc.mjs');
  const ctx = resolveContext({
    project: projectFlag(flags),
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
      return await finishCreation(ctx, 'task', prepared.task, prepared.file, flags);
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
    // The legacy flag form follows the same preview/--apply gate as
    // --input (FIND-028): prepare shows the exact record it would write
    // and only --apply persists it.
    const prepared = prepareTask(ctx, {
      title: requireFlag(flags, '--title'),
      contract: requireFlag(flags, '--contract'),
      authorContext: requireFlag(flags, '--author'),
      scope,
      ...(Object.hasOwn(flags, '--spec') ? { specId: flags['--spec'] } : {}),
      ...(Object.hasOwn(flags, '--design') ? { designId: flags['--design'] } : {}),
      ...(Object.hasOwn(flags, '--plan') ? { planKey: flags['--plan'] } : {}),
    });
    return await finishCreation(ctx, 'task', prepared.task, prepared.file, flags);
  }
  if (sub === 'list') {
    const result = listTasks(ctx);
    if (flags['--backlog']) {
      const name = flags['--backlog'];
      result.tasks = result.tasks.filter(
        (t) => (t.backlog ?? 'default') === name);
    }
    return result;
  }
  // Meta mutations share updateTaskMeta; without --apply the same pure
  // evaluation (CAS revision check included) previews the record the
  // write would produce — the dry-run validates exactly like apply.
  const previewMeta = (input) => {
    validateMetaUpdateInput(input);
    const evaluated = evaluateTaskMeta(ctx, getTask(ctx, input.id), input);
    return { mode: 'dry-run', applied: false, task: evaluated.next };
  };
  if (sub === 'meta') {
    const input = readInputFile(requireFlag(flags, '--input'), 'task meta input');
    if (flags['--revision'] === undefined) {
      throw err('INVALID_ARGS', '--revision N is required');
    }
    const metaInput = {
      id: positional[0],
      expectedRevision: decimalInt(flags['--revision'], '--revision'),
      ...input,
    };
    return flags['--apply']
      ? updateTaskMeta(ctx, metaInput) : previewMeta(metaInput);
  }
  if (sub === 'authorize') {
    if (flags['--revision'] === undefined) {
      throw err('INVALID_ARGS', '--revision N is required');
    }
    const authInput = {
      id: positional[0],
      expectedRevision: decimalInt(flags['--revision'], '--revision'),
      actor: requireFlag(flags, '--actor'),
      reference: requireFlag(flags, '--reference'),
    };
    if (!flags['--apply']) {
      validateAuthorizeInput(authInput);
      const evaluated = evaluateTaskAuthorization(
        ctx, getTask(ctx, authInput.id), authInput);
      return { mode: 'dry-run', applied: false, task: evaluated.next };
    }
    return authorizeTask(ctx, authInput);
  }
  if (sub === 'reassess') {
    if (flags['--revision'] === undefined) {
      throw err('INVALID_ARGS', '--revision N is required');
    }
    const reassessInput = {
      id: positional[0],
      expectedRevision: decimalInt(flags['--revision'], '--revision'),
      methodology: readInputFile(requireFlag(flags, '--input'),
        'task reassessment'),
    };
    if (!flags['--apply']) {
      validateReassessInput(reassessInput);
      const evaluated = evaluateTaskReassessment(
        ctx, getTask(ctx, reassessInput.id), reassessInput);
      return { mode: 'dry-run', applied: false, task: evaluated.next };
    }
    return reassessTask(ctx, reassessInput);
  }
  if (sub === 'link' || sub === 'unlink') {
    if (flags['--revision'] === undefined) {
      throw err('INVALID_ARGS', '--revision N is required');
    }
    const kind = flags['--kind'];
    if (kind !== undefined && !RELATION_KINDS.has(kind)) {
      throw err('INVALID_VALUE',
        `--kind must be one of ${[...RELATION_KINDS].join('|')}`);
    }
    const [id, target] = positional;
    if (target === id) {
      throw err('INVALID_VALUE', 'a task cannot depend on or relate to itself');
    }
    const task = getTask(ctx, id);
    const remove = sub === 'unlink';
    let set;
    if (kind === undefined) {
      // dependsOn names task records, not external refs — resolve the
      // target on link so typos do not write dead edges. unlink skips it:
      // removing a dead reference must stay possible.
      if (!remove) getTask(ctx, target);
      const cur = task.dependsOn ?? [];
      const next = remove
        ? cur.filter((x) => x !== target) : [...new Set([...cur, target])];
      set = { dependsOn: next };
    } else {
      const rel = { ...(task.relations ?? {}) };
      const cur = rel[kind] ?? [];
      const next = remove
        ? cur.filter((x) => x !== target) : [...new Set([...cur, target])];
      if (next.length === 0) delete rel[kind];
      else rel[kind] = next;
      set = { relations: rel };
    }
    const metaInput = {
      id,
      expectedRevision: decimalInt(flags['--revision'], '--revision'),
      set,
    };
    return flags['--apply']
      ? updateTaskMeta(ctx, metaInput) : previewMeta(metaInput);
  }
  if (sub === 'disposition') {
    if (flags['--revision'] === undefined) {
      throw err('INVALID_ARGS', '--revision N is required');
    }
    const kind = positional[1];
    const metaInput = {
      id: positional[0],
      expectedRevision: decimalInt(flags['--revision'], '--revision'),
      disposition: kind === 'active' ? null : {
        kind,
        ...(flags['--reason'] ? { reason: flags['--reason'] } : {}),
        ...(flags['--by'] ? { by: flags['--by'] } : {}),
      },
    };
    return flags['--apply']
      ? updateTaskMeta(ctx, metaInput) : previewMeta(metaInput);
  }
  if (sub === 'note') {
    if (flags['--revision'] === undefined) {
      throw err('INVALID_ARGS', '--revision N is required');
    }
    const metaInput = {
      id: positional[0],
      expectedRevision: decimalInt(flags['--revision'], '--revision'),
      addNote: requireFlag(flags, '--text'),
    };
    return flags['--apply']
      ? updateTaskMeta(ctx, metaInput) : previewMeta(metaInput);
  }
  if (sub === 'step') {
    if (flags['--revision'] === undefined) {
      throw err('INVALID_ARGS', '--revision N is required');
    }
    if (flags['--index'] === undefined || flags['--status'] === undefined) {
      throw err('INVALID_ARGS', '--index N and --status S are required');
    }
    const metaInput = {
      id: positional[0],
      expectedRevision: decimalInt(flags['--revision'], '--revision'),
      stepStatus: {
        index: decimalInt(flags['--index'], '--index'),
        status: flags['--status'],
      },
    };
    return flags['--apply']
      ? updateTaskMeta(ctx, metaInput) : previewMeta(metaInput);
  }
  if (sub === 'show') {
    if (positional.length !== 1) {
      throw err('INVALID_ARGS', 'task show requires exactly one ID');
    }
    const { resolveTaskRef } = await import('./core/active.mjs');
    return resolveTaskRef(ctx, positional[0]);
  }
  if (sub === 'activate') {
    if (positional.length !== 1) {
      throw err('INVALID_ARGS', 'task activate requires exactly one ID|SLUG');
    }
    const { setActiveTask } = await import('./core/active.mjs');
    return setActiveTask(ctx, positional[0]);
  }
  if (sub === 'active') {
    const { getActiveTask } = await import('./core/active.mjs');
    const { task, source } = getActiveTask(ctx);
    return task
      ? { task, source }
      : { task: null, source: null,
        note: 'no active task; set via SCOPEGRAIN_TASK or task activate' };
  }
  if (sub === 'deactivate') {
    const { clearActiveTask } = await import('./core/active.mjs');
    return clearActiveTask(ctx);
  }
  if (sub === 'converge') {
    if (positional.length !== 1) {
      throw err('INVALID_ARGS', 'task converge requires exactly one ID|SLUG');
    }
    const { evaluateConvergence, recordConvergence } =
      await import('./core/converge.mjs');
    const { resolveTaskRef } = await import('./core/active.mjs');
    const task = resolveTaskRef(ctx, positional[0]);
    return flags['--record']
      ? recordConvergence(ctx, task.id)
      : evaluateConvergence(ctx, task);
  }
  if (sub === 'analyze') {
    if (positional.length !== 1) {
      throw err('INVALID_ARGS', 'task analyze requires exactly one ID|SLUG');
    }
    const { analyzeTask } = await import('./core/analyze.mjs');
    const { resolveTaskRef } = await import('./core/active.mjs');
    return analyzeTask(ctx, resolveTaskRef(ctx, positional[0]).id);
  }
  if (sub === 'checklist') {
    const cl = await import('./core/checklists.mjs');
    if (Object.hasOwn(flags, '--input')) {
      if (positional.length !== 0) {
        throw err('INVALID_ARGS', 'checklist create takes no positional ID');
      }
      const input = readInputFile(flags['--input'], 'checklist input');
      const prepared = cl.prepareChecklist(ctx, input);
      return await finishCreation(
        ctx, 'checklist', prepared.record, prepared.file, flags);
    }
    if (positional.length === 0) {
      return { checklists: cl.listChecklists(ctx) };
    }
    if (Object.hasOwn(flags, '--key') || Object.hasOwn(flags, '--status')) {
      if (!flags['--key'] || !flags['--status'] || !flags['--revision']) {
        throw err('INVALID_ARGS',
          'checklist mark requires --key CHK### --status S --revision N');
      }
      const markInput = {
        status: flags['--status'], note: flags['--text'],
        expectedRevision: decimalInt(flags['--revision'], '--revision'),
      };
      if (!flags['--apply']) {
        return {
          mode: 'dry-run', applied: false,
          plan: {
            verb: 'task checklist mark', id: positional[0],
            key: flags['--key'], status: markInput.status,
            revision: markInput.expectedRevision,
          },
        };
      }
      return cl.markChecklistItem(
        ctx, positional[0], flags['--key'], markInput);
    }
    return cl.getChecklist(ctx, positional[0]);
  }
  if (sub === 'doc') {
    if (positional.length !== 1) {
      throw err('INVALID_ARGS', 'task doc requires exactly one ID');
    }
    return writeTaskDoc(ctx, positional[0]);
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
    const transitionInput = {
      id: positional[0],
      to: positional[1],
      expectedRevision,
      ...evidence,
    };
    if (!flags['--apply']) {
      // Same input gate and policy evaluation as the write path (pure
      // evaluateTaskTransition): the preview is the exact record --apply
      // would store, methodology gates included.
      validateTransitionInput(transitionInput);
      const evaluated = evaluateTaskTransition(
        ctx, getTask(ctx, transitionInput.id), transitionInput);
      return { mode: 'dry-run', applied: false, task: evaluated.next };
    }
    const next = transitionTask(ctx, transitionInput);
    // Closing a task archives its outcome in the progress log: the
    // avance/backlog-history loop is append-only and derives from the
    // final stored record, not from the transition input.
    if (next.state === 'CLOSE') {
      try {
        appendWorklog(ctx, 'progress', {
          taskId: next.id,
          title: next.title,
          result: next.review?.verdict ?? 'closed',
          summary: next.contract,
          domain: next.backlog,
        });
      } catch { /* progress archive is best-effort; the CLOSE already committed */ }
    }
    return next;
  }
  if (sub === 'check-action') {
    if (positional.length !== 2) {
      throw err('INVALID_ARGS', 'task check-action requires ID and ACTION');
    }
    return checkAction(ctx, positional[0], positional[1]);
  }
  if (sub === 'suggest') {
    const { resolveTaskRef } = await import('./core/active.mjs');
    const { suggestCapabilities } = await import('./core/task-suggest.mjs');
    const task = resolveTaskRef(ctx, positional[0]);
    return suggestCapabilities(ctx, task, {
      limit: flags['--limit'] === undefined ? 5
        : decimalInt(flags['--limit'], '--limit'),
    });
  }
  if (sub === 'gate') {
    if (positional.length !== 2) {
      throw err('INVALID_ARGS',
        'task gate requires TASK(ID|SLUG|-) and ACTION');
    }
    const { resolveTaskRef, getActiveTask }
      = await import('./core/active.mjs');
    const task = positional[0] === '-'
      ? (() => {
        const a = getActiveTask(ctx);
        if (!a.task) {
          throw err('INVALID_ARGS',
            'no active task (set SCOPEGRAIN_TASK or activate one)');
        }
        return a.task;
      })()
      : resolveTaskRef(ctx, positional[0]);
    const check = checkAction(ctx, task.id, positional[1]);
    const decision = !check.allowed ? 'deny'
      : check.gate ? 'gate' : 'allow';
    io.exitCode = decision === 'deny' ? 2 : decision === 'gate' ? 3 : 0;
    return {
      decision, exitCode: io.exitCode, check,
      exitContract: {
        0: 'allow', 2: 'deny', 3: 'require-gate',
        1: 'error — fail-closed: host hooks must block on any non-zero',
      },
    };
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

async function cmdCatalog(sub, positional, flags) {
  const { checkCatalog, getResource, legacyGet, legacyList, loadCatalog, loadWorkspaceCatalog } = await import('./core/catalog.mjs');
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
      ...(r.meta ? { meta: r.meta } : {}),
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

async function cmdResource(sub, rest, flags) {
  const { applyResourceRestore, diagnoseResource, findResources, prepareResourceRestore } = await import('./core/resource-recovery.mjs');
  const ctx = resolveContext({
    project: projectFlag(flags), config: flags['--config'],
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

async function cmdDist(sub, rest, flags) {
  const d = await import('./core/distribution.mjs');
  const ctx = resolveContext({
    project: projectFlag(flags), config: flags['--config'],
  });
  if (sub === 'run') {
    const { runWorkflow } = await import('./core/workflow-runner.mjs');
    const doc = readInputFile(requireFlag(flags, '--input'), 'workflow input');
    return runWorkflow(ctx, doc,
      { resume: flags['--no-resume'] !== true });
  }
  if (sub === 'stack') {
    const input = readInputFile(requireFlag(flags, '--input'), 'stack input');
    return d.loadCatalogStack(ctx, input.sources ?? []);
  }
  if (sub === 'compose') {
    const input = readInputFile(requireFlag(flags, '--input'), 'compose input');
    return { composed: d.composeResource(input.base ?? '',
      input.layers ?? []) };
  }
  if (sub === 'validate') {
    const input = readInputFile(
      requireFlag(flags, '--input'), 'submission input');
    return { valid: true, submission: d.validateSubmission(input) };
  }
  if (sub === 'bundle-validate') {
    const input = readInputFile(requireFlag(flags, '--input'), 'bundle input');
    return { valid: true, bundle: d.validateBundle(input) };
  }
  if (sub === 'extension-register') {
    const input = readInputFile(
      requireFlag(flags, '--input'), 'extension input');
    return d.registerExtension(ctx, input);
  }
  if (sub === 'extension-list') {
    return { extensions: d.listRegistry(ctx, 'extensions') };
  }
  if (sub === 'extension-activate' || sub === 'extension-deactivate') {
    return d.setExtensionState(ctx, rest[0],
      sub === 'extension-activate' ? 'active' : 'disabled');
  }
  if (sub === 'bundle-install') {
    const input = readInputFile(
      requireFlag(flags, '--input'), 'bundle install input');
    return d.installBundle(ctx, input.bundle, input.sources ?? [],
      { apply: flags['--apply'] === true });
  }
  if (sub === 'bundle-mount') {
    return d.mountBundle(ctx, rest[0]);
  }
  if (sub === 'bundle-unmount') {
    return d.unmountBundle(ctx, rest[0]);
  }
  if (sub === 'bundle-uninstall') {
    const keepFiles = flags['--keep-files'] === true;
    if (flags['--apply']) {
      return d.uninstallBundle(ctx, rest[0], { keepFiles });
    }
    assertSafeId(rest[0], 'bundle id');
    const provRel = configRel(ctx, `bundles/${rest[0]}/provenance.json`);
    const provAbs = resolveInside(
      ctx.projectRoot, provRel, 'bundle provenance');
    let provSt = null;
    try { provSt = fs.lstatSync(provAbs); }
    catch (e) { if (!e || e.code !== 'ENOENT') throw e; }
    if (provSt === null || provSt.isSymbolicLink() || !provSt.isFile()) {
      throw err('NOT_FOUND', `bundle '${rest[0]}' is not installed`);
    }
    const limited = readFileLimited(provAbs, loadLimits().maxDocumentBytes);
    if (limited.exceeded) throw err('DOCUMENT_TOO_LARGE', provRel);
    let prov;
    try {
      prov = JSON.parse(
        decodeUtf8Strict(limited.content, 'MALFORMED', provRel));
    } catch (e) {
      if (e && e.code === 'MALFORMED') throw e;
      throw err('MALFORMED',
        `bundle provenance is not valid JSON: ${provRel}`);
    }
    const mountedKeys = d.loadMounted(ctx).entries
      .filter((e) => e.bundle === rest[0])
      .map((e) => `${e.kind}/${e.id}`);
    return {
      mode: 'dry-run', applied: false,
      plan: {
        verb: 'dist bundle-uninstall', bundle: rest[0], keepFiles,
        unmount: mountedKeys,
        deleteCandidates: keepFiles ? []
          : [...(prov.files ?? []).map((f) => f.rel), provRel],
        note: 'files diverging from provenance are left behind',
      },
    };
  }
  if (sub === 'mounted-list') {
    return { mounted: d.loadMounted(ctx).entries };
  }
  if (sub === 'extension-remove') {
    if (flags['--apply']) return d.removeExtension(ctx, rest[0]);
    assertSafeId(rest[0], 'extension id');
    const ext = d.listRegistry(ctx, 'extensions')
      .find((e) => e.id === rest[0]);
    if (!ext) {
      throw err('NOT_FOUND', `extension '${rest[0]}' not registered`);
    }
    if (ext.state === 'active') {
      throw err('CONFLICT',
        `extension '${rest[0]}' is active; deactivate before removing`);
    }
    return {
      mode: 'dry-run', applied: false,
      plan: { verb: 'dist extension-remove', id: rest[0], extension: ext },
    };
  }
  if (sub === 'preset-remove') {
    if (flags['--apply']) return d.removePreset(ctx, rest[0]);
    assertSafeId(rest[0], 'preset id');
    const preset = d.listRegistry(ctx, 'presets')
      .find((p) => p.id === rest[0]);
    if (!preset) {
      throw err('NOT_FOUND', `preset '${rest[0]}' not registered`);
    }
    return {
      mode: 'dry-run', applied: false,
      plan: { verb: 'dist preset-remove', id: rest[0], preset },
    };
  }
  if (sub === 'preset-register') {
    const input = readInputFile(requireFlag(flags, '--input'), 'preset input');
    return d.registerPreset(ctx, input);
  }
  if (sub === 'preset-list') {
    return { presets: d.listRegistry(ctx, 'presets') };
  }
  if (sub === 'selftest') {
    return d.selfTestDist(ctx);
  }
  if (sub === 'journal') {
    return d.readDistJournal(ctx, {
      tail: flags['--tail'] === undefined ? null
        : decimalInt(flags['--tail'], '--tail'),
      registry: flags['--registry'] ?? null,
      op: flags['--op'] ?? null,
      id: flags['--id'] ?? null,
    });
  }
  if (sub === 'pack') {
    const { packDirectory } = await import('./core/packaging.mjs');
    return packDirectory(ctx, requireFlag(flags, '--source'),
      requireFlag(flags, '--out'));
  }
  throw err('INVALID_ARGS', `unknown dist subcommand '${sub}'`);
}

async function cmdWorkflow(command, flags) {
  const { buildWorkflowPacket } = await import('./core/workflows.mjs');
  return buildWorkflowPacket(resolveContext({
    project: projectFlag(flags),
    config: flags['--config'],
  }), {
    command,
    mode: flags['--mode'],
    taskId: flags['--task'],
    host: flags['--host'],
    profile: flags['--profile'],
    interaction: flags['--interaction'],
    ...(flags['--arguments'] !== undefined
      ? { arguments: flags['--arguments'] } : {}),
    ...(flags['--script'] !== undefined ? { script: flags['--script'] } : {}),
    lazy: flags['--lazy'] === true,
  });
}

async function cmdPlan(sub, positional, flags) {
  const { applyPlan, preflightPlan } = await import('./core/bootstrap.mjs');
  const {
    concludePlan, getPlan, listPlans, nextPlanTasks, planStatus,
    preparePlan, recordPlanRun,
  } = await import('./core/plans.mjs');
  const ctx = resolveContext({
    project: projectFlag(flags),
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
  if (sub === 'status') return planStatus(ctx, positional[0]);
  if (sub === 'conclude') {
    return concludePlan(ctx, positional[0], {
      apply: !!flags['--apply'],
      partial: !!flags['--partial'],
      report: !!flags['--report'],
    });
  }
  if (sub === 'run') {
    return recordPlanRun(ctx, positional[0], { apply: !!flags['--apply'] });
  }
  if (sub === 'stories') {
    const { renderStoryTaskList } = await import('./core/story-tasks.mjs');
    return renderStoryTaskList(ctx, positional[0]);
  }
  throw err('INVALID_ARGS', `unknown plan subcommand '${sub}'`);
}

async function cmdArtifact(sub, positional, flags) {
  const { applyPlan, preflightPlan } = await import('./core/bootstrap.mjs');
  const { getArtifact, listArtifacts, prepareArtifact } = await import('./core/artifacts.mjs');
  const ctx = resolveContext({
    project: projectFlag(flags),
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
async function finishCreation(ctx, key, record, file, flags) {
  const { applyPlan, preflightPlan } = await import('./core/bootstrap.mjs');
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

// Session-start context packet: one bounded read assembling everything a
// host needs at the top of a new session — project instructions pointer,
// workspace identity, task distribution, ready work, recent progress,
// open goals, pending journal events and the latest session record.
// Read-only; the host reads, Scopegrain never injects or executes.
async function cmdContext(flags) {
  const { assembleContextPacket } =
    await import('./core/context-packet.mjs');
  const ctx = resolveContext({
    project: projectFlag(flags), config: flags['--config'],
  });
  return assembleContextPacket(ctx, {
    tail: flags['--tail'] !== undefined
      ? decimalInt(flags['--tail'], '--tail') : undefined,
    timeoutMs: flags['--timeout'] !== undefined
      ? decimalInt(flags['--timeout'], '--timeout') : undefined,
    noVantadb: flags['--no-vantadb'] === true,
    noStructure: flags['--no-structure'] === true,
    structureDebounceMs: flags['--structure-debounce'] !== undefined
      ? decimalInt(flags['--structure-debounce'], '--structure-debounce')
      : undefined,
    explain: flags['--explain'] === true,
    fields: flags['--fields'],
    compact: flags['--compact'] === true,
  });
}

async function cmdStructure(sub, flags) {
  const {
    readStructureIndex, refreshStructureIndex, scanStructure,
    structureStatus, writeStructureIndex,
  } = await import('./discovery/structure.mjs');
  const ctx = resolveContext({
    project: projectFlag(flags), config: flags['--config'],
  });
  if (sub === 'status') return structureStatus(ctx);
  if (sub === 'refresh') {
    return refreshStructureIndex(ctx, { apply: !!flags['--apply'] });
  }
  if (sub === 'show') {
    const idx = readStructureIndex(ctx);
    if (idx === null) {
      throw err('NOT_FOUND', 'no structure index; run structure scan');
    }
    return idx;
  }
  // scan: rebuild + persist the index. Writes harness-owned cache data
  // only; still gated behind --apply like every other mutating verb.
  const index = scanStructure(ctx.projectRoot);
  if (!flags['--apply']) {
    const { files: _files, ...preview } = index;
    return { mode: 'preview', index: preview };
  }
  const rel = writeStructureIndex(ctx, index);
  const { files: _files, ...summary } = index;
  return { mode: 'applied', index: summary, written: rel };
}

async function cmdUserConfig(sub, flags) {
  const {
    loadUserConfig, resolveUserConfigPath, saveUserConfig,
  } = await import('./core/user-config.mjs');
  if (sub === 'path') {
    const info = resolveUserConfigPath();
    return {
      ...info,
      exists: info.path ? fs.existsSync(info.path) : false,
    };
  }
  if (sub === 'show') {
    return {
      ...loadUserConfig(),
      precedence: ['workspace', 'answers', 'repo-signals', 'user-global', 'policy-defaults'],
    };
  }
  if (sub === 'set') {
    const input = readInputFile(requireFlag(flags, '--input'), 'user config');
    return saveUserConfig(input, { apply: !!flags['--apply'] });
  }
  throw err('INVALID_ARGS', `unknown config subcommand '${sub}'`);
}

async function cmdWorkspace(sub, flags) {
  const { getWorkspace, prepareWorkspace } = await import('./core/workspaces.mjs');
  const ctx = resolveContext({
    project: projectFlag(flags), config: flags['--config'],
  });
  if (sub === 'show') return getWorkspace(ctx);
  const input = Object.hasOwn(flags, '--input')
    ? readInputFile(flags['--input'], 'workspace input') : {};
  const prepared = prepareWorkspace(ctx, input);
  return await finishCreation(ctx, 'workspace', prepared.workspace, prepared.file, flags);
}

async function cmdCapture(sub, positional, flags) {
  const { getWorkspace } = await import('./core/workspaces.mjs');
  const { createCaptureStore } = await import('./core/captures.mjs');
  const project = projectFlag(flags);
  if (sub === 'proposals') return await cmdCaptureProposals(project, flags);
  if (sub === 'review') return await cmdCaptureReview(project, flags);
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
async function cmdCaptureProposals(project, flags) {
  const { getWorkspace } = await import('./core/workspaces.mjs');
  const { filterRejectedProposals, listProposalDecisions, proposeFromInitAnswers, proposeFromJournal } = await import('./core/capture-proposals.mjs');
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
  const { decisions } = listProposalDecisions(ctx);
  return {
    proposals: [
      ...proposeFromJournal(ctx, options),
      ...filterRejectedProposals(
        proposeFromInitAnswers(answers, { areaIds }), decisions),
    ],
  };
}

// Persisted reports: `report save` snapshots the live doctor report
// under paths.reports (create-only timestamped file); `report list`
// enumerates them newest-first. The avance/reports store the legacy
// system kept under docs/dev/reports.
async function cmdReport(sub, flags) {
  const { runDoctor } = await import('./core/doctor.mjs');
  const ctx = resolveContext({
    project: projectFlag(flags),
    config: flags['--config'],
  });
  const dir = resolveInside(
    ctx.projectRoot, ctx.config.paths.reports, 'paths.reports');
  if (sub === 'save') {
    const report = runDoctor(ctx);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const rel = `${ctx.config.paths.reports}/${stamp}-status.json`;
    const abs = resolveInside(ctx.projectRoot, rel, 'report file');
    mkdirpSync(path.dirname(abs));
    writeFileExclusive(abs, JSON.stringify(report, null, 2) + '\n');
    return { rel, status: report.status, summary: report.summary };
  }
  if (sub === 'list') {
    const tail = flags['--tail'] !== undefined
      ? decimalInt(flags['--tail'], '--tail') : 50;
    let names = [];
    try {
      names = fs.readdirSync(dir)
        .filter((n) => n.endsWith('.json')).sort().reverse();
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    return { reports: names.slice(0, Math.min(tail, 1000)) };
  }
  throw err('INVALID_ARGS', `unknown report subcommand '${sub}'`);
}

// Append-only operational memory: lessons, skill outcomes and the
// progress archive live as bounded JSONL under paths.memory.
async function cmdMemory(sub, flags) {
  const { appendWorklog, readWorklog } = await import('./core/worklog.mjs');
  const ctx = resolveContext({
    project: projectFlag(flags),
    config: flags['--config'],
  });
  if (sub === 'add') {
    const input = readInputFile(
      requireFlag(flags, '--input'), 'memory input');
    const log = requireFlag(flags, '--log');
    if (!flags['--apply']) {
      return {
        mode: 'dry-run', applied: false,
        plan: { verb: 'memory add', log, input },
      };
    }
    return appendWorklog(ctx, log, input);
  }
  if (sub === 'list') {
    const tail = flags['--tail'] !== undefined
      ? decimalInt(flags['--tail'], '--tail') : 50;
    return readWorklog(ctx, requireFlag(flags, '--log'), { tail });
  }
  throw err('INVALID_ARGS', `unknown memory subcommand '${sub}'`);
}

// Retroactive activity registration: actions done outside the task loop
// (direct commits, ad-hoc edits) are recorded as a task plus a progress
// entry. --input carries the activity payload; without --apply it is a
// dry-run echoing the normalized input.
async function cmdActivity(sub, flags) {
  const { normalizeActivityInput, recordActivity } = await import('./core/activity.mjs');
  if (sub !== 'record') {
    throw err('INVALID_ARGS', `unknown activity subcommand '${sub}'`);
  }
  const ctx = resolveContext({
    project: projectFlag(flags),
    config: flags['--config'],
  });
  const input = readInputFile(
    requireFlag(flags, '--input'), 'activity input');
  if (!flags['--apply']) {
    return { mode: 'dry-run', activity: normalizeActivityInput(input) };
  }
  return { mode: 'applied', ...recordActivity(ctx, input) };
}

// Git hook management: `hooks install` appends a managed post-commit
// block that auto-registers every commit via `activity record`; the
// preview reports create/append/already-installed and writes nothing.
async function cmdHooks(sub, flags) {
  const { installHooks, planHooks, uninstallHooks } = await import('./core/hooks.mjs');
  const ctx = resolveContext({
    project: projectFlag(flags),
    config: flags['--config'],
  });
  if (sub === 'install') {
    const binAbs = path.resolve(process.argv[1]);
    if (!flags['--apply']) {
      const plan = planHooks(ctx, { binAbs });
      return { mode: 'dry-run', file: plan.file, state: plan.state };
    }
    return { mode: 'applied', ...installHooks(ctx, { binAbs }) };
  }
  if (sub === 'uninstall') {
    if (!flags['--apply']) {
      const plan = planHooks(ctx, {
        binAbs: path.resolve(process.argv[1]),
      });
      return { mode: 'dry-run', file: plan.file, state: plan.state };
    }
    return { mode: 'applied', ...uninstallHooks(ctx) };
  }
  throw err('INVALID_ARGS', `unknown hooks subcommand '${sub}'`);
}

// Goals are the meta/objective layer: append-only entries in goals.jsonl,
// latest per id wins; tasks link via task.goalIds.
async function cmdGoal(sub, positional, flags) {
  const { listGoals, createGoal, transitionGoal } = await import('./core/worklog.mjs');
  const ctx = resolveContext({
    project: projectFlag(flags),
    config: flags['--config'],
  });
  if (sub === 'create') {
    const input = readInputFile(requireFlag(flags, '--input'), 'goal input');
    if (!flags['--apply']) {
      return {
        mode: 'dry-run', applied: false,
        plan: { verb: 'goal create', input },
      };
    }
    return createGoal(ctx, input);
  }
  if (sub === 'list') return listGoals(ctx);
  if (sub === 'transition') {
    const to = requireFlag(flags, '--to');
    if (!flags['--apply']) {
      return {
        mode: 'dry-run', applied: false,
        plan: { verb: 'goal transition', id: positional[0], to },
      };
    }
    return transitionGoal(ctx, positional[0], to);
  }
  throw err('INVALID_ARGS', `unknown goal subcommand '${sub}'`);
}

// Pure review gate: the resolved decision is returned as-is; only an
// approved decision with --apply feeds the flattened DTO to the store.
async function cmdCaptureReview(project, flags) {
  const { getWorkspace } = await import('./core/workspaces.mjs');
  const { createCaptureStore } = await import('./core/captures.mjs');
  const { persistProposalDecision, reviewProposal } = await import('./core/capture-proposals.mjs');
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
  const ctx = resolveContext({ project, config: flags['--config'] });
  const persisted = persistProposalDecision(ctx, input.proposal, decision);
  if (persisted.review.status !== 'approved') {
    return { mode: 'applied', applied: true,
      review: persisted.review, decision: persisted.decision };
  }
  const workspace = getWorkspace(ctx);
  const store = createCaptureStore(ctx, {
    areaIds: workspace.areas.map((area) => area.id), origin: 'local-cli',
  });
  const created = store.create(
    { ...persisted.review.input.capture, areaIds: persisted.review.input.areaIds });
  return { ...created, review: { status: persisted.review.status },
    decision: persisted.decision };
}

async function cmdJournal(sub, positional, flags, io) {
  const { bindWorkspace, getWorkspace } = await import('./core/workspaces.mjs');
  const { getJournalOperation, listJournalPending, prepareJournalRecovery, recoverJournalOperation, compactJournal, countJournalPending } = await import('./core/journal.mjs');
  const ctx = resolveContext({
    project: projectFlag(flags), config: flags['--config'],
  });
  const workspace = getWorkspace(ctx);
  const bound = bindWorkspace(ctx, { areaIds: workspace.areas.map((area) => area.id) });
  if (sub === 'checkpoint') {
    const { createJournalCheckpoint } =
      await import('./core/integrity/checkpoints.mjs');
    return createJournalCheckpoint(bound);
  }
  if (sub === 'verify') {
    const { verifyJournalIntegrity } =
      await import('./core/integrity/checkpoints.mjs');
    const result = verifyJournalIntegrity(bound, {
      expectDigest: flags['--expect-digest'],
      skipChainScan: flags['--skip-chain-scan'] === true,
    });
    if (flags['--fail-on-error'] === true && !result.ok) io.exitCode = 1;
    return result;
  }
  if (sub === 'list') {
    const options = {};
    if (flags['--since-sequence'] !== undefined) {
      options.afterSequence = decimalInt(
        flags['--since-sequence'], '--since-sequence');
    }
    if (flags['--limit'] !== undefined) {
      options.limit = decimalInt(flags['--limit'], '--limit');
    }
    return listJournalPending(bound, options);
  }
  if (sub === 'show') return getJournalOperation(bound, positional[0]);
  if (sub === 'compact') {
    if (!flags['--apply']) {
      return {
        mode: 'dry-run', applied: false,
        plan: { verb: 'journal compact',
          pendingOperations: countJournalPending(bound) },
      };
    }
    return { mode: 'applied', applied: true, ...compactJournal(bound) };
  }
  const input = readInputFile(requireFlag(flags, '--input'), 'journal recovery input');
  return flags['--apply']
    ? recoverJournalOperation(bound, positional[0], input)
    : prepareJournalRecovery(bound, positional[0], input);
}

const RECALL_SCOPES = ['session', 'agent', 'team'];
const SEARCH_MODES = ['keyword', 'vector', 'hybrid'];

async function cmdVantaDB(sub, positional, flags) {
  const { bindWorkspace, getWorkspace } = await import('./core/workspaces.mjs');
  const { DEFAULT_VANTADB_VERSION, VANTADB_BACKEND_ID, callVantaDBTool, defaultInstallRoot, defaultStoragePath, ensureVantaDBBinary, getVantaDBRecord, releaseAsset, requireVantaDBConfig, saveVantaDBConfig, syncVantaDB, vantaDBContext, vantaDBDistill, vantaDBProbe, vantaDBReinforce, vantaDBStatus, vantaDBSyncPersona, vantaDBSyncWorklogs } = await import('./integrations/vantadb-runtime.mjs');
  const ctx = resolveContext({
    project: projectFlag(flags), config: flags['--config'],
  });
  if (sub === 'setup') {
    const version = flags['--version'] ?? DEFAULT_VANTADB_VERSION;
    const storagePath = flags['--storage']
      ? path.resolve(flags['--storage']) : defaultStoragePath();
    const installRoot = flags['--install-dir']
      ? path.resolve(flags['--install-dir']) : defaultInstallRoot();
    const explicitBinary = flags['--binary'] ? path.resolve(flags['--binary']) : null;
    const asset = explicitBinary ? null : releaseAsset(version);
    const vantaCfgRel = configRel(ctx, 'vantadb.json');
    if (!flags['--apply']) {
      return {
        preview: true, version, storagePath, installRoot,
        binary: explicitBinary ?? `download ${asset.name}`,
        asset, configRel: vantaCfgRel,
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
    // Pin the binary digest at enrollment: when the config already
    // exists on disk (e.g. a cache hit during ensure) or --binary is
    // used, digest the resolved file now so later spawns detect swaps.
    if (sha256 === null) {
      sha256 = crypto.createHash('sha256')
        .update(fs.readFileSync(binaryPath)).digest('hex');
    }
    fs.mkdirSync(storagePath, { recursive: true });
    const cfg = {
      schemaVersion: 1, backendId: VANTADB_BACKEND_ID, version,
      binaryPath, storagePath, binarySha256: sha256,
    };
    const configAbs = saveVantaDBConfig(ctx, cfg);
    return { applied: true, config: cfg, configPath: configAbs, downloaded, sha256 };
  }
  const workspace = getWorkspace(ctx);
  const bound = bindWorkspace(ctx, { areaIds: workspace.areas.map((area) => area.id) });
  const timeoutMs = flags['--timeout'] !== undefined
    ? decimalInt(flags['--timeout'], '--timeout') : undefined;
  if (sub === 'status') {
    const report = vantaDBStatus({ ctx, bound });
    if (flags['--probe'] === true) {
      try {
        report.probe = await vantaDBProbe({ cfg: requireVantaDBConfig(ctx),
          timeoutMs });
        if (report.probe?.embedding?.model_present === false) {
          report.warnings = [{ signal: 'embedding-model-missing',
            detail: report.probe.embedding.detail
              ?? 'local embedding model files not present; vector search degrades to keyword-only' }];
        }
      } catch (e) {
        report.probe = { error: { code: e.code ?? 'VANTADB_PROBE_FAILED',
          message: e.message } };
      }
    }
    return report;
  }
  if (sub === 'get') {
    const namespace = requireFlag(flags, '--namespace');
    const key = requireFlag(flags, '--key');
    return getVantaDBRecord({ cfg: requireVantaDBConfig(ctx), namespace, key, timeoutMs });
  }
  if (sub === 'search') {
    const args = { namespace: requireFlag(flags, '--namespace') };
    if (flags['--query'] !== undefined) args.text_query = flags['--query'];
    if (flags['--top-k'] !== undefined) {
      args.top_k = decimalInt(flags['--top-k'], '--top-k');
    }
    if (flags['--mode'] !== undefined) {
      if (!SEARCH_MODES.includes(flags['--mode'])) {
        throw err('INVALID_ARGS',
          `--mode must be one of ${SEARCH_MODES.join(',')}`);
      }
      args.search_profile = { mode: flags['--mode'] };
    }
    return callVantaDBTool({ cfg: requireVantaDBConfig(ctx),
      name: 'memory_search', arguments: args, timeoutMs });
  }
  if (sub === 'list') {
    const namespace = requireFlag(flags, '--namespace');
    const args = { namespace };
    if (flags['--cursor'] !== undefined) {
      args.cursor = decimalInt(flags['--cursor'], '--cursor');
    }
    return callVantaDBTool({ cfg: requireVantaDBConfig(ctx),
      name: 'memory_list', arguments: args, timeoutMs });
  }
  if (sub === 'recall') {
    const args = { query: requireFlag(flags, '--query') };
    if (flags['--top-k'] !== undefined) {
      args.top_k = decimalInt(flags['--top-k'], '--top-k');
    }
    // Explicit --scope opts INTO the engine's memory_recall pool
    // (machine-global at scope=agent); the default is project-scoped
    // memory_search at l1/sg-<projectHash> — see the module comment in
    // vantadb-rehydrate.mjs for why recall cannot isolate by project.
    if (flags['--scope'] !== undefined) {
      if (!RECALL_SCOPES.includes(flags['--scope'])) {
        throw err('INVALID_ARGS',
          `--scope must be one of ${RECALL_SCOPES.join(',')}`);
      }
      args.scope = flags['--scope'];
      return callVantaDBTool({ cfg: requireVantaDBConfig(ctx),
        name: 'memory_recall', arguments: args, timeoutMs });
    }
    const { projectScopedRecall } = await import(
      './integrations/vantadb-rehydrate.mjs');
    return projectScopedRecall({ ctx, query: args.query,
      topK: args.top_k, timeoutMs });
  }
  if (sub === 'reinforce') {
    const cfg = requireVantaDBConfig(ctx);
    // Server-side mutation: without --apply the call is never made (the
    // records it would modify are remote, so the preview is a plan).
    if (!flags['--apply']) {
      return {
        mode: 'dry-run', applied: false,
        plan: {
          verb: 'vantadb reinforce',
          namespace: requireFlag(flags, '--namespace'),
          key: requireFlag(flags, '--key'),
          outcome: requireFlag(flags, '--outcome'),
        },
      };
    }
    return vantaDBReinforce({ cfg,
      namespace: flags['--namespace'], key: flags['--key'],
      outcome: flags['--outcome'], timeoutMs });
  }
  if (sub === 'context') {
    const recordId = requireFlag(flags, '--record-id');
    return vantaDBContext({ cfg: requireVantaDBConfig(ctx), recordId,
      topK: flags['--top-k'] !== undefined
        ? decimalInt(flags['--top-k'], '--top-k') : undefined,
      maxNamespaces: flags['--limit'] !== undefined
        ? decimalInt(flags['--limit'], '--limit') : undefined,
      timeoutMs });
  }
  if (sub === 'distill') {
    const cfg = requireVantaDBConfig(ctx);
    if (!flags['--apply']) {
      return {
        mode: 'dry-run', applied: false,
        plan: { verb: 'vantadb distill' },
      };
    }
    return vantaDBDistill({ bound, cfg,
      limit: flags['--limit'] !== undefined
        ? decimalInt(flags['--limit'], '--limit') : undefined,
      timeoutMs });
  }
  if (sub === 'sync-memory') {
    const cfg = requireVantaDBConfig(ctx);
    if (!flags['--apply']) {
      return {
        mode: 'dry-run', applied: false,
        plan: { verb: 'vantadb sync-memory' },
      };
    }
    return vantaDBSyncWorklogs({ ctx, bound, cfg,
      limit: flags['--limit'] !== undefined
        ? decimalInt(flags['--limit'], '--limit') : undefined,
      timeoutMs });
  }
  if (sub === 'sync-persona') {
    const apply = !!flags['--apply'];
    const cfg = apply ? requireVantaDBConfig(ctx) : null;
    return vantaDBSyncPersona({ ctx, bound, cfg,
      limit: flags['--limit'] !== undefined
        ? decimalInt(flags['--limit'], '--limit') : undefined,
      apply, timeoutMs });
  }
  // sub === 'sync' — one-shot run; same preview/--apply gate as every
  // other mutating verb (FIND-028).
  const cfg = requireVantaDBConfig(ctx);
  if (!flags['--apply']) {
    return { mode: 'dry-run', applied: false, plan: { verb: 'vantadb sync' } };
  }
  const limit = flags['--limit'] !== undefined
    ? decimalInt(flags['--limit'], '--limit') : undefined;
  return syncVantaDB({ ctx, bound, cfg, limit, timeoutMs });
}

async function cmdOwnedSpecification(sub, positional, flags) {
  const { createOwnedSpecificationStore } = await import('./core/owned-specifications.mjs');
  const { getWorkspace } = await import('./core/workspaces.mjs');
  const project = projectFlag(flags);
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

async function cmdOwnedFormalArtifact(family, sub, positional, flags) {
  const { createOwnedDesignStore } = await import('./core/owned-designs.mjs');
  const { createOwnedOutcomeStore } = await import('./core/owned-outcomes.mjs');
  const { getWorkspace } = await import('./core/workspaces.mjs');
  if (!flags['--owned']) {
    throw err('INVALID_ARGS',
      `${family} show requires --owned; use artifact show for structural reads`);
  }
  const project = projectFlag(flags);
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

async function cmdTypedArtifact(family, sub, positional, flags) {
  const { getSpecification, prepareDesign, prepareSpecification } = await import('./core/specifications.mjs');
  const { prepareOutcomeEvidence } = await import('./core/outcomes.mjs');
  const ctx = resolveContext({
    project: projectFlag(flags), config: flags['--config'],
  });
  if (family === 'specification' && sub === 'show') {
    return getSpecification(ctx, positional[0]);
  }
  if (family === 'specification' && sub === 'clarify') {
    const { prepareClarification } = await import('./core/clarify.mjs');
    const input = readInputFile(
      requireFlag(flags, '--input'), 'clarification input');
    const prepared = prepareClarification(ctx, input);
    return await finishCreation(
      ctx, 'clarification', prepared.record, prepared.file, flags);
  }
  const input = readInputFile(requireFlag(flags, '--input'), `${family} input`);
  const prepare = {
    specification: prepareSpecification,
    design: prepareDesign,
    outcome: prepareOutcomeEvidence,
  }[family];
  const prepared = prepare(ctx, input);
  return await finishCreation(ctx, 'artifact', prepared.artifact, prepared.file, flags);
}

async function cmdConstitution(sub, flags) {
  const { getConstitution, setConstitution } =
    await import('./core/constitution.mjs');
  const ctx = resolveContext({
    project: projectFlag(flags), config: flags['--config'],
  });
  if (sub === 'show') {
    const c = getConstitution(ctx);
    return c ?? { constitution: null,
      note: 'no constitution; create with constitution set --input FILE' };
  }
  if (sub === 'set') {
    const input = readInputFile(
      requireFlag(flags, '--input'), 'constitution input');
    if (!flags['--apply']) {
      return {
        mode: 'dry-run', applied: false,
        plan: { verb: 'constitution set', input },
      };
    }
    return setConstitution(ctx, input);
  }
  throw err('INVALID_ARGS', `unknown constitution subcommand '${sub}'`);
}

async function cmdApproval(sub, positional, flags) {
  const { answerApproval, describeApprovalTarget, getApproval, prepareApproval, prepareApprovalAnswer } = await import('./core/approvals.mjs');
  const ctx = resolveContext({
    project: projectFlag(flags), config: flags['--config'],
  });
  if (sub === 'show') return getApproval(ctx, positional[0]);
  const input = readInputFile(requireFlag(flags, '--input'), 'approval input');
  if (sub === 'target') return describeApprovalTarget(ctx, input);
  if (sub === 'create') {
    const prepared = prepareApproval(ctx, input);
    return await finishCreation(ctx, 'approval', prepared.approval, prepared.file, flags);
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

async function cmdMethodology(positional, flags) {
  const { checkMethodology } = await import('./core/methodology.mjs');
  const ctx = resolveContext({
    project: projectFlag(flags), config: flags['--config'],
  });
  return checkMethodology(ctx, {
    taskId: positional[0],
    ...(Object.hasOwn(flags, '--to') ? { to: flags['--to'] } : {}),
    ...(Object.hasOwn(flags, '--outcome-evidence')
      ? { outcomeEvidenceId: flags['--outcome-evidence'] } : {}),
  });
}

async function cmdSession(sub, positional, flags) {
  const { applyPlan, preflightPlan } = await import('./core/bootstrap.mjs');
  const { ensureSessionsDir, getSession, prepareSession, prepareSessionRecord, recordSession, resumeSession } = await import('./core/sessions.mjs');
  const ctx = resolveContext({
    project: projectFlag(flags),
    config: flags['--config'],
  });
  if (sub === 'create') {
    const prepared = prepareSession(ctx, {
      taskId: requireFlag(flags, '--task'),
      limit: decimalInt(requireFlag(flags, '--limit'), '--limit'),
      ...(Object.hasOwn(flags, '--token-limit')
        ? { tokenLimit: decimalInt(flags['--token-limit'], '--token-limit') }
        : {}),
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
      if (!['action', 'evidence', 'context', 'tokens'].includes(k)) {
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
      ...(input.tokens !== undefined ? { tokens: input.tokens } : {}),
    };
    // Dry-run validates against CURRENT state exactly like apply does.
    const prep = prepareSessionRecord(ctx, recordInput);
    if (!flags['--apply']) {
      return {
        mode: 'dry-run', applied: false,
        session: { id: prep.session.id, used: prep.session.used,
          limit: prep.session.limit, revision: prep.session.revision },
        tokenUsage: prep.tokenUsage,
      };
    }
    return recordSession(ctx, recordInput);
  }
  if (sub === 'resume') {
    const result = resumeSession(ctx, positional[0]);
    // Automatic record-level rehydration: scan projected sg-formal-v1-*
    // namespaces for journal events naming this task. Read-only, bounded,
    // degradable; --no-vantadb skips the backend spawn entirely.
    if (flags['--no-vantadb'] === true) {
      return { ...result, vantadb: { enrolled: null, context: null,
        skipped: true } };
    }
    const { recordRehydration } = await import(
      './integrations/vantadb-rehydrate.mjs');
    return {
      ...result,
      vantadb: await recordRehydration({
        ctx, recordId: result.task.id,
        timeoutMs: flags['--timeout'] !== undefined
          ? decimalInt(flags['--timeout'], '--timeout') : undefined,
      }),
    };
  }
  throw err('INVALID_ARGS', `unknown session subcommand '${sub}'`);
}

// --- Product lifecycle verbs ---------------------------------------------
// Each verb previews read-only by default; --apply is create-only and every
// apply re-runs its prepare internally. Nothing is overwritten or merged.

async function cmdAdopt(flags) {
  const { applyPlan, preflightPlan } = await import('./core/bootstrap.mjs');
  const { prepareWorkspace } = await import('./core/workspaces.mjs');
  const { prepareAdopt } = await import('./core/lifecycle.mjs');
  const project = projectFlag(flags);
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
    project: projectFlag(flags), config: flags['--config'],
  });
}

async function cmdUpdate(flags) {
  const { applyUpdate, prepareUpdate } = await import('./core/lifecycle.mjs');
  const ctx = lifecycleCtx(flags);
  const options = {};
  if (flags['--reconcile']) options.reconcile = true;
  const result = flags['--apply']
    ? applyUpdate(ctx, options) : prepareUpdate(ctx, options);
  if (!flags['--diff']) return result;
  const { diffInvestigation, investigateProject }
    = await import('./discovery/semantic.mjs');
  return { ...result, discoveryDiff: diffInvestigation(ctx.config,
    investigateProject(ctx.projectRoot, { config: ctx.config })) };
}

async function cmdBackup(flags) {
  const { applyBackup, prepareBackup } = await import('./core/lifecycle.mjs');
  const destination = requireFlag(flags, '--to');
  const ctx = lifecycleCtx(flags);
  return flags['--apply']
    ? applyBackup(ctx, { destination }) : prepareBackup(ctx, { destination });
}

async function cmdRestore(flags) {
  const { applyRestore, prepareRestore } = await import('./core/lifecycle.mjs');
  const bundleRel = requireFlag(flags, '--from');
  const projectRoot = resolveProjectRoot(projectFlag(flags));
  return flags['--apply']
    ? applyRestore(projectRoot, bundleRel) : prepareRestore(projectRoot, bundleRel);
}

async function cmdUninstall(flags) {
  const { applyUninstall, prepareUninstall } = await import('./core/lifecycle.mjs');
  const ctx = lifecycleCtx(flags);
  return flags['--apply'] ? applyUninstall(ctx) : prepareUninstall(ctx);
}

// Read-only diff risk classification. The core spawns no git: the
// operator supplies unified-diff bytes produced by their own tooling
// (e.g. `git diff > out.patch`). Optional --assessment compares the
// derived tier with a declared methodology risk and reports divergence.
async function cmdAssess(flags) {
  const { parseUnifiedDiff, classifyRisk } =
    await import('./discovery/risk-assess.mjs');
  const file = requireFlag(flags, '--input');
  const abs = path.resolve(file);
  let st;
  try {
    st = fs.lstatSync(abs);
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      throw err('INPUT_NOT_FOUND', `diff file not found: ${abs}`);
    }
    throw e;
  }
  if (!st.isFile()) {
    throw err('INVALID_PATH', `diff path is not a file: ${abs}`);
  }
  const limited = readFileLimited(abs, 8 * 1024 * 1024);
  if (limited.exceeded) {
    throw err('INPUT_TOO_LARGE',
      `diff file exceeds 8MiB: ${abs} (${limited.size} bytes)`);
  }
  const text = decodeUtf8Strict(
    limited.content, 'MALFORMED_DIFF', `diff file: ${abs}`);
  const envelope = classifyRisk(parseUnifiedDiff(text));
  // The key is always present: null when no declaration was supplied or
  // when the declaration matches the derived tier.
  envelope.discrepancy = null;
  if (flags['--assessment'] !== undefined) {
    const declared = readInputFile(flags['--assessment'],
      'assessment file');
    const dr = typeof declared?.risk === 'string' ? declared.risk
      : typeof declared?.methodology?.risk === 'string'
        ? declared.methodology.risk : null;
    const derived = envelope.risk;
    const under = dr !== null && dr !== 'unknown'
      && dr === 'contained' && derived !== 'passive';
    const over = dr === 'named' && derived === 'passive';
    if (under || over) {
      envelope.discrepancy = { declared_risk: dr, derived_tier: derived,
        direction: under ? 'under-declared' : 'over-declared' };
    } else if (dr !== 'contained' && dr !== 'named') {
      // null, 'unknown' or any out-of-schema value carries no comparable
      // risk claim — report it rather than treating it as consistent.
      envelope.discrepancy = { declared_risk: dr, derived_tier: derived,
        direction: 'uncomparable' };
    }
  }
  return envelope;
}

// Read-only semantic investigation plus answer suggestions. A config is
// resolved opportunistically: an explicit --config reports its own error,
// while a project with no config still investigates (and --save then emits
// the record instead of writing it).
async function cmdInvestigate(flags) {
  const { applyPlan } = await import('./core/bootstrap.mjs');
  const { buildResearchRecord, diffInvestigation, investigateProject, suggestAnswers } = await import('./discovery/semantic.mjs');
  const project = projectFlag(flags);
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
  if (flags['--diff']) {
    result.diff = ctx === null
      ? { stale: null, reason: 'no persisted config to diff against' }
      : diffInvestigation(ctx.config, investigation);
  }
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
async function cmdHelper(sub, flags) {
  const { installHelper, listHelpers } = await import('./core/helpers.mjs');
  const ctx = lifecycleCtx(flags);
  if (sub === 'list') return { helpers: listHelpers(ctx) };
  if (sub === 'install') {
    const input = readInputFile(
      requireFlag(flags, '--input'), 'helper input');
    return installHelper(ctx, input);
  }
  throw err('INVALID_ARGS', `unknown helper subcommand '${sub}'`);
}

async function cmdHost(sub, flags) {
  if (sub === 'gate') {
    const { gateProposal } = await import('./hosts/gate-proposal.mjs');
    const ctx = lifecycleCtx(flags);
    return gateProposal(ctx, { host: requireFlag(flags, '--host') });
  }
  if (sub === 'parity') {
    const { hostParity } = await import('./hosts/parity.mjs');
    const ctx = lifecycleCtx(flags);
    const options = {};
    if (Object.hasOwn(flags, '--hosts')) {
      options.hosts = flags['--hosts'].split(',')
        .map((h) => h.trim()).filter(Boolean);
    }
    return hostParity(ctx, options);
  }
  if (sub === 'manifest') {
    const { hostManifest } = await import('./hosts/host-manifest.mjs');
    const ctx = lifecycleCtx(flags);
    const options = { host: requireFlag(flags, '--host') };
    if (Object.hasOwn(flags, '--surface')) options.surface = flags['--surface'];
    return hostManifest(ctx, options);
  }
  const { applyActivation, prepareActivation } = await import('./hosts/activation.mjs');
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
  const { investigateProject } = await import('./discovery/semantic.mjs');
  const { applyAddCommand, applyApproveCommand, applyApproveDiscoveredCommands, applyImportCommands, listVerifyCommands, prepareAddCommand, prepareApproveCommand, prepareApproveDiscoveredCommands, prepareImportCommands, runVerifyCommand } = await import('./core/verify-commands.mjs');
  const ctx = resolveContext({
    project: projectFlag(flags), config: flags['--config'],
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
    const options = { all: flags['--all'] === true };
    if (!flags['--apply']) {
      return { mode: 'dry-run', applied: false,
        ...prepareApproveDiscoveredCommands(ctx, options) };
    }
    return { mode: 'applied', applied: true,
      ...applyApproveDiscoveredCommands(ctx, options) };
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

// Loopback viewer API — read-only unless --allow-write opts in to the
// bounded catalog-doc edit endpoint. The returned server handle keeps the
// process alive; the operator stops it with Ctrl+C. The live handle is
// exposed on io.viewServer so embedders/tests can close it explicitly.
async function cmdView(flags, io) {
  const { runDoctor } = await import('./core/doctor.mjs');
  const { inspectProject } = await import('./discovery/inspect.mjs');
  const { taskMetrics } = await import('./core/worklog.mjs');
  const { loadCatalog, loadWorkspaceCatalog } = await import('./core/catalog.mjs');
  const { createApiServer } = await import('./api/server.mjs');
  const options = {
    project: projectFlag(flags), config: flags['--config'],
  };
  if (Object.hasOwn(flags, '--host')) options.host = flags['--host'];
  const explicitPort = Object.hasOwn(flags, '--port');
  if (explicitPort) {
    options.port = decimalInt(flags['--port'], '--port');
  }
  if (flags['--allow-write']) options.allowWrite = true;
  const attempts = explicitPort ? 1 : 16;
  let api = null;
  let bound = null;
  let lastErr = null;
  for (let i = 0; i < attempts && bound === null; i++) {
    api = createApiServer(options);
    try {
      bound = await api.listen();
    } catch (e) {
      lastErr = e;
      if (!e || e.code !== 'EADDRINUSE') throw e;
      options.port = api.port + 1;
    }
  }
  if (bound === null) throw lastErr;
  if (io !== null && typeof io === 'object') io.viewServer = api;
  const host = bound.host.includes(':') ? `[${bound.host}]` : bound.host;
  return { url: `http://${host}:${bound.port}/`,
    host: bound.host, port: bound.port };
}

export async function run(argv, io) {
  try {
    if (argv.length === 1
        && (argv[0] === '--version' || argv[0] === '-v' || argv[0] === '-V')) {
      const pkg = JSON.parse(fs.readFileSync(
        new URL('../package.json', import.meta.url), 'utf8'));
      io.stdout(JSON.stringify({
        name: pkg.name,
        version: pkg.version,
        node: process.version,
      }, null, 2));
      return 0;
    }
    if (argv.length === 1 && argv[0] === '-h') {
      io.stdout(JSON.stringify(helpResult(), null, 2));
      return 0;
    }

    const { flags, positional } = parseArgs(argv);
    if (positional.length === 0) {
      io.stdout(JSON.stringify(helpResult(), null, 2));
      return 0;
    }
    const GROUPED = new Set(['task', 'catalog', 'plan', 'artifact', 'session', 'resource', 'workspace', 'journal', 'capture',
      'specification', 'design', 'outcome', 'approval', 'methodology', 'host', 'verify', 'vantadb',
      'helper', 'dist',
      'memory', 'goal', 'report', 'activity', 'hooks', 'structure',
      'constitution', 'config']);
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
      const { loadCatalog, loadWorkspaceCatalog } =
        await import('./core/catalog.mjs');
      // A detected ancestor project also binds the workspace snapshot;
      // a broken detected config falls back to the installation
      // catalog and the real error surfaces at context resolution.
      const aliasProject = flags['--project']
        ?? detectProjectRoot(process.cwd());
      let cat = null;
      if (aliasProject) {
        try {
          cat = loadWorkspaceCatalog(resolveContext({
            project: aliasProject, config: flags['--config'] }));
        } catch (e) {
          if (flags['--project']) throw e;
          cat = null;
        }
      }
      cat = cat ?? loadCatalog({});
      if (cat.byKey.has(`command/${positional[0]}`.toLowerCase())
          || cat.aliases?.some(
            (a) => a.kind === 'command'
              && a.id.toLowerCase() === positional[0].toLowerCase())) {
        aliasCommand = positional[0];
        cmdKey = positional[0];
        spec = { flags: WORKFLOW_ALIAS_FLAGS, pos: 0,
          usage: `${positional[0]} --project PATH [--mode M] [--task UUID] [--host H] [--profile ID] [--arguments TEXT] [--script PATH] [--lazy]` };
      }
    }
    if (!spec) {
      if (flags['--help']) {
        io.stdout(JSON.stringify(helpResult(), null, 2));
        return 0;
      }
      throw err('INVALID_ARGS',
        `unknown command '${positional.slice(0, 2).join(' ')}'; run scopegrain --help`);
    }
    for (const name of Object.keys(flags)) {
      if (name !== '--help' && !spec.flags.includes(name)) {
        throw err('INVALID_ARGS', `${name} is not valid for ${cmdKey}`);
      }
    }
    if (flags['--help']) {
      io.stdout(JSON.stringify({
        command: cmdKey,
        usage: `scopegrain ${spec.usage}`,
        flags: [...spec.flags],
        description: aliasCommand !== null
          ? 'catalog command alias resolved to a workflow packet'
          : describeCommand(cmdKey),
      }, null, 2));
      return 0;
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
      result = (await import('./discovery/inspect.mjs'))
        .inspectProject(projectFlag(flags));
    } else if (cmdKey === 'init') {
      result = await cmdInit(flags, io);
    } else if (cmdKey === 'doctor') {
      result = (await import('./core/doctor.mjs')).runDoctor(resolveContext({
        project: projectFlag(flags),
        config: flags['--config'],
      }));
    } else if (cmdKey === 'mcp') {
      const { startMCPServer } = await import('./mcp/server.mjs');
      await startMCPServer({
        project: projectFlag(flags),
        config: flags['--config'],
      });
      return 0;
    } else if (isAlias) {
      result = await cmdWorkflow(aliasCommand, flags);
    } else if (cmdKey === 'workflow') {
      result = await cmdWorkflow(rest[0], flags);
    } else if (cmdKey === 'context') {
      result = await cmdContext(flags);
    } else if (cmdKey.startsWith('task ')) {
      result = await cmdTask(cmdKey.slice(5), rest, flags, io);
    } else if (cmdKey.startsWith('workspace ')) {
      result = await cmdWorkspace(cmdKey.slice(10), flags);
    } else if (cmdKey.startsWith('journal ')) {
      result = await cmdJournal(cmdKey.slice(8), rest, flags, io);
    } else if (cmdKey.startsWith('structure ')) {
      result = await cmdStructure(cmdKey.slice(10), flags);
    } else if (cmdKey.startsWith('config ')) {
      result = await cmdUserConfig(cmdKey.slice(7), flags);
    } else if (cmdKey.startsWith('vantadb ')) {
      result = await cmdVantaDB(cmdKey.slice(8), rest, flags);
    } else if (cmdKey.startsWith('capture ')) {
      result = await cmdCapture(cmdKey.slice(8), rest, flags);
    } else if (cmdKey.startsWith('catalog ')) {
      result = await cmdCatalog(cmdKey.slice(8), rest, flags);
    } else if (cmdKey.startsWith('dist ')) {
      result = await cmdDist(cmdKey.slice(5), rest, flags);
    } else if (cmdKey.startsWith('resource ')) {
      result = await cmdResource(cmdKey.slice(9), rest, flags);
    } else if (cmdKey.startsWith('plan ')) {
      result = await cmdPlan(cmdKey.slice(5), rest, flags);
    } else if (cmdKey.startsWith('artifact ')) {
      result = await cmdArtifact(cmdKey.slice(9), rest, flags);
    } else if (positional[0] === 'specification' && flags['--owned']) {
      result = await cmdOwnedSpecification(positional[1], rest, flags);
    } else if (['design', 'outcome'].includes(positional[0])
        && (flags['--owned'] || positional[1] === 'show')) {
      result = await cmdOwnedFormalArtifact(positional[0], positional[1], rest, flags);
    } else if (['specification', 'design', 'outcome'].includes(positional[0])) {
      result = await cmdTypedArtifact(positional[0], positional[1], rest, flags);
    } else if (cmdKey.startsWith('approval ')) {
      result = await cmdApproval(cmdKey.slice(9), rest, flags);
    } else if (cmdKey === 'methodology check') {
      result = await cmdMethodology(rest, flags);
    } else if (cmdKey.startsWith('constitution ')) {
      result = await cmdConstitution(cmdKey.slice(13), flags);
    } else if (cmdKey === 'adopt') {
      result = await cmdAdopt(flags);
    } else if (cmdKey === 'update') {
      result = await cmdUpdate(flags);
    } else if (cmdKey === 'backup') {
      result = await cmdBackup(flags);
    } else if (cmdKey === 'restore') {
      result = await cmdRestore(flags);
    } else if (cmdKey === 'uninstall') {
      result = await cmdUninstall(flags);
    } else if (cmdKey === 'investigate') {
      result = await cmdInvestigate(flags);
    } else if (cmdKey === 'assess') {
      result = await cmdAssess(flags);
    } else if (cmdKey === 'view') {
      result = await cmdView(flags, io);
    } else if (cmdKey.startsWith('verify ')) {
      result = await cmdVerify(cmdKey.slice(7), rest, flags, io);
    } else if (cmdKey.startsWith('memory ')) {
      result = await cmdMemory(cmdKey.slice(7), flags);
    } else if (cmdKey.startsWith('goal ')) {
      result = await cmdGoal(cmdKey.slice(5), rest, flags);
    } else if (cmdKey === 'metrics') {
      result = (await import('./core/worklog.mjs')).taskMetrics(resolveContext({
        project: projectFlag(flags),
        config: flags['--config'],
      }));
    } else if (cmdKey.startsWith('report ')) {
      result = await cmdReport(cmdKey.slice(7), flags);
    } else if (cmdKey.startsWith('activity ')) {
      result = await cmdActivity(cmdKey.slice(9), flags);
    } else if (cmdKey.startsWith('hooks ')) {
      result = await cmdHooks(cmdKey.slice(6), flags);
    } else if (cmdKey.startsWith('host ')) {
      result = await cmdHost(cmdKey.slice(5), flags);
    } else if (cmdKey.startsWith('helper ')) {
      result = await cmdHelper(cmdKey.slice(7), flags);
    } else if (cmdKey.startsWith('session ')) {
      result = await cmdSession(cmdKey.slice(8), rest, flags);
    } else {
      throw err('INVALID_ARGS', `unknown command '${cmdKey}'`);
    }
    const boundProject = flags['--project']
      ?? detectProjectRoot(process.cwd());
    if (flags['--input'] !== undefined && boundProject !== null
        && boundProject !== undefined) {
      const inputAbs = path.resolve(flags['--input']);
      const rel = path.relative(path.resolve(boundProject), inputAbs);
      if (rel === '..' || rel.startsWith(`..${path.sep}`)
          || path.isAbsolute(rel)) {
        io.stderr(JSON.stringify({ warning: {
          code: 'INPUT_OUTSIDE_PROJECT',
          message: `--input resolves outside the project root: ${inputAbs}`,
        } }));
      }
    }
    // --fields CSV: top-level key projection for large packets
    // (context/workflow whitelist the flag; other verbs reject it).
    if (flags['--fields'] !== undefined && result !== null
        && typeof result === 'object' && !Array.isArray(result)) {
      const keep = flags['--fields'].split(',')
        .map((s) => s.trim()).filter(Boolean);
      result = Object.fromEntries(
        keep.filter((k) => Object.hasOwn(result, k))
          .map((k) => [k, result[k]]));
    }
    io.stdout(JSON.stringify(result, null, flags['--compact'] ? 0 : 2));
    // Commands may request a specific success-path exit code through
    // io.exitCode (verify run --fail-on-error); absent means 0.
    return Number.isInteger(io.exitCode) ? io.exitCode : 0;
  } catch (e) {

    const payload = toErrorPayload(e);
    if (e.conflicts) payload.conflicts = e.conflicts;
    io.stderr(JSON.stringify({ error: payload }, null, 2));
    // Usage errors exit 2 (the common CLI convention); every other
    // failure keeps exit 1. task gate's documented contract reserves
    // 2 for deny on the success path — a usage-error 2 is equally
    // fail-closed for a host hook.
    return e && e.code === 'INVALID_ARGS' ? 2 : 1;
  } finally {
    if (typeof io.close === 'function') io.close();
  }
}

// Default IO bound to real stdio; the interactive ask uses readline.
export function defaultIO() {
  // A consumer that truncates the stream (`| head`, `| Select -First`)
  // raises EPIPE on the next write — exit cleanly instead of crashing
  // with an unhandled 'error' event. Other stream errors still throw.
  process.stdout.on('error', (e) => {
    if (e && e.code === 'EPIPE') process.exit(0);
    throw e;
  });
  process.stderr.on('error', (e) => {
    if (e && e.code === 'EPIPE') process.exit(0);
    throw e;
  });
  let rl = null;
  return {
    isTTY: !!process.stdin.isTTY,
    stdout: (s) => process.stdout.write(s + '\n'),
    stderr: (s) => process.stderr.write(s + '\n'),
    ask: async (label, def) => {
      rl = rl || readline.createInterface({
        // Two-stream rule: prompts are UI noise and belong to stderr so
        // stdout never carries anything but the result JSON.
        input: process.stdin, output: process.stderr,
      });
      const suffix = def ? ` [${def}]` : '';
      const answer = await rl.question(`${label}${suffix}: `);
      return answer.trim() === '' ? (def || '') : answer.trim();
    },
    close: () => { if (rl) rl.close(); },
  };
}
