// SPDX-License-Identifier: Apache-2.0
// Workflow packets: read-only bundles that hand a command declaration plus
// its resolved dependencies to a host. Project-bound: content comes from
// the workspace snapshot, never silently from the installation.
import crypto from 'node:crypto';
import { err } from './errors.mjs';
import { decodeUtf8Strict } from './fsx.mjs';
import {
  catalogDestRel, getResource, loadWorkspaceCatalog, resolveInvocation,
  validateProfile,
} from './catalog.mjs';
import { loadLimits, loadPolicy } from './policy.mjs';
import { getTask } from './tasks.mjs';
import { KNOWN_HOSTS, validateMethodologyMode } from './config.mjs';
import { evaluateTaskActions } from './methodology.mjs';
import { findPlaceholders, renderPlaceholders } from './placeholders.mjs';
import { hooksFor } from './hooks-policy.mjs';
import {
  presetLayers, listRegistry, composeResource,
} from './distribution.mjs';

const ALLOWED = new Set([
  'command', 'mode', 'taskId', 'host', 'profile', 'interaction',
  'arguments', 'script',
]);
const INTERACTIONS = new Set(['direct', 'guided']);

function resolveResources(kind, ids, catalog, presets, applied) {
  const out = [];
  const seen = new Set();
  for (const id of ids) {
    const r = getResource(kind, id, { catalog });
    const canon = r.canonicalId ?? r.id;
    const k = `${kind}/${canon}`.toLowerCase();
    if (seen.has(k)) continue; // alias+target dedupe post-resolution
    seen.add(k);
    const base = decodeUtf8Strict(
      r.content, 'CATALOG_MALFORMED', `catalog resource ${kind}/${canon}`);
    const { layers, applied: hits } = presetLayers(presets, kind, canon);
    for (const h of hits) applied.push({ resource: k, ...h });
    out.push({
      kind, id: canon,
      description: r.description, path: catalogDestRel(r),
      content: composeResource(base, layers),
    });
  }
  return out;
}

// buildWorkflowPacket(ctx, {command, mode, taskId, host, profile='core',
//   interaction='direct'}).
export function buildWorkflowPacket(ctx, opts = {}) {
  if (opts === null || typeof opts !== 'object' || Array.isArray(opts)) {
    throw err('INVALID_ARGS', 'workflow options must be an object');
  }
  for (const k of Object.keys(opts)) {
    if (!ALLOWED.has(k)) {
      throw err('UNKNOWN_KEY', `unknown workflow option '${k}'`);
    }
  }
  const catalog = loadWorkspaceCatalog(ctx);
  const inv = resolveInvocation(catalog, {
    command: opts.command, mode: opts.mode,
  });
  const interaction = opts.interaction ?? inv.parameters.interaction ?? 'direct';
  if (!INTERACTIONS.has(interaction)) {
    throw err('INVALID_ARGS',
      `interaction must be one of: ${[...INTERACTIONS].join(', ')}`);
  }
  if (inv.parameters.interaction === 'guided' && opts.interaction === 'direct') {
    throw err('INVALID_ARGS',
      `alias '${opts.command}' requires guided interaction; direct conflicts`);
  }
  const command = getResource('command', inv.canonicalId, { catalog });
  const mode = inv.requestedMode;
  const profileId = opts.profile === undefined ? 'core' : opts.profile;
  if (typeof profileId !== 'string' || profileId === '') {
    throw err('INVALID_PROFILE', 'profile must be a non-empty id');
  }
  const profileEntry = getResource('profile', profileId, { catalog });
  const profile = validateProfile(
    profileEntry.canonicalId ?? profileEntry.id, profileEntry.content);
  const coreEntry = getResource('profile', 'core', { catalog });
  const core = validateProfile('core', coreEntry.content);
  // Core profile always supplements the selected profile.
  const merged = { skills: [], rules: [], references: [] };
  for (const lk of ['skills', 'rules', 'references']) {
    merged[lk] = [...new Set([...profile[lk], ...core[lk]])];
  }
  const commandDeps = {
    agents: command.agents || [],
    skills: command.skills || [],
    rules: command.rules || [],
    references: command.references || [],
    prompts: command.prompts || [],
    mcps: command.mcps || [],
  };
  if (opts.host !== undefined && !ctx.config.hosts.includes(opts.host)) {
    throw err('INVALID_HOST', `host '${opts.host}' is not selected`);
  }
  let task = null;
  let allowedActions = null;
  const methodology = {
    mode: validateMethodologyMode(ctx.config.methodology, 'config.methodology'),
    available: true, taskCheck: null,
    authenticatesEvidence: false, interceptsNativeTools: false,
  };
  if (opts.taskId !== undefined) {
    task = getTask(ctx, opts.taskId);
    const effective = evaluateTaskActions(ctx, task);
    allowedActions = effective.permitted;
    methodology.taskCheck = effective.methodology;
  }
  const alias = catalog.aliases.find(
    (a) => a.kind === 'command'
      && a.id.toLowerCase() === String(opts.command).toLowerCase());
  const limits = loadLimits();
  const presets = listRegistry(ctx, 'presets');
  const presetApplied = [];
  const { layers: commandLayers, applied: commandHits } = presetLayers(
    presets, 'command', inv.canonicalId);
  const commandBase = composeResource(
    decodeUtf8Strict(command.content,
      'CATALOG_MALFORMED', `catalog resource command/${command.id}`),
    commandLayers);
  for (const h of commandHits) {
    presetApplied.push({ resource: `command/${inv.canonicalId}`, ...h });
  }
  // Active extensions contribute declared resources into extra kind
  // buckets. Activation already validated ids; resolution re-validates —
  // catalog drift since activation fails closed at getResource.
  const extensionApplied = [];
  const contributedResources = { agents: [], skills: [], rules: [],
    references: [], prompts: [], mcps: [] };
  const BUCKET = { agent: 'agents', skill: 'skills', rule: 'rules',
    reference: 'references', prompt: 'prompts', mcp: 'mcps',
    command: null, profile: null };
  for (const ext of listRegistry(ctx, 'extensions')) {
    if (ext.state !== 'active') continue;
    for (const c of ext.contributes) {
      const [kind, cid] = c.split('/');
      const bucket = BUCKET[kind];
      if (!bucket) continue;
      const r = getResource(kind, cid, { catalog });
      const canon = r.canonicalId ?? r.id;
      const key = `${kind}/${canon}`.toLowerCase();
      if (contributedResources[bucket]
        .some((x) => x._key === key)) continue;
      const base = decodeUtf8Strict(r.content,
        'CATALOG_MALFORMED', `catalog resource ${key}`);
      const { layers, applied: hits } =
        presetLayers(presets, kind, canon);
      for (const h of hits) {
        presetApplied.push({ resource: key, ...h });
      }
      contributedResources[bucket].push({ kind, id: canon,
        description: r.description, path: catalogDestRel(r),
        content: composeResource(base, layers),
        extension: ext.id });
      extensionApplied.push({ extension: ext.id, resource: key });
    }
  }
  for (const list of Object.values(contributedResources)) {
    for (const x of list) delete x._key;
  }
  const packet = {
    schemaVersion: 1,
    authority: {
      resourceSource: catalog.snapshot ? 'workspace-snapshot' : 'installation',
      snapshotIntegrity: catalog.integrity,
      runtimePolicySource: 'installed-runtime',
      policyDigest: crypto.createHash('sha256')
        .update(JSON.stringify(loadPolicy())).digest('hex'),
    },
    warnings: catalog.warnings,
    command: {
      id: opts.command,
      requestedMode: inv.requestedMode,
      canonicalId: inv.canonicalId,
      canonicalMode: inv.canonicalMode,
      canonicalModes: command.modes,
      deprecated: inv.deprecated,
      parameters: inv.parameters,
      mode,
      modes: alias ? [...new Set(catalog.aliases
        .filter((a) => a.id === alias.id).map((a) => a.mode))] : command.modes,
      description: command.description,
      path: catalogDestRel(command),
      content: commandBase,
      // Placeholder rendering is optional: callers pass --arguments /
      // --script; unresolved tokens fail closed, never silently strip.
      rendered: (() => {
        const body = commandBase;
        const inv = findPlaceholders(body);
        if (!inv.arguments && !inv.script && inv.handoffs.length === 0) {
          return body;
        }
        return renderPlaceholders(body, {
          arguments: opts.arguments ?? '',
          script: opts.script,
        });
      })(),
    },
    interaction,
    host: opts.host ?? null,
    // Declarative before_/after_ hooks from policy/hooks.json — advisory
    // data projected to hosts; the harness never executes them.
    hooks: hooksFor(inv.canonicalId),
    // Installed preset override layers applied to projected resources —
    // declared, never silent.
    presets: { applied: presetApplied },
    // Active extensions contribute their declared resources to this
    // packet — same rule: declared, never silent.
    extensions: { applied: extensionApplied },
    locale: ctx.config.locale,
    profile: {
      id: profile.id,
      description: profile.description,
      path: catalogDestRel(profileEntry),
      activation: profile.activation,
      externalServices: profile.externalServices,
    },
    resources: {
      agents: resolveResources('agent', commandDeps.agents, catalog,
        presets, presetApplied),
      skills: resolveResources('skill',
        [...new Set([...commandDeps.skills, ...merged.skills])], catalog,
        presets, presetApplied),
      rules: resolveResources('rule',
        [...new Set([...commandDeps.rules, ...merged.rules])], catalog,
        presets, presetApplied),
      references: resolveResources('reference',
        [...new Set([...commandDeps.references, ...merged.references])],
        catalog, presets, presetApplied),
      prompts: resolveResources('prompt', commandDeps.prompts, catalog,
        presets, presetApplied),
      mcps: resolveResources('mcp', commandDeps.mcps, catalog,
        presets, presetApplied),
    },
    contributedResources,
    paths: { ...ctx.config.paths },
    resourceRoot: ctx.configDir,
    task,
    allowedActions,
    methodology,
    capabilities: {
      executesProjectCommands: limits.executesProjectCommands,
      authenticatesEvidence: limits.authenticatesEvidence,
      interceptsNativeTools: limits.interceptsNativeTools,
      executesWorkflowText: false,
      interpretsResourcesAsCode: false,
      executesAgent: false,
      appliesHostRoots: false,
      callsModels: false,
      networkAccess: false,
    },
    notes: [
      'Resource contents are verbatim data for a host to interpret; the '
        + 'harness never executes them.',
      'Dependency resources supplement the selected profile; core safety '
        + 'resources always apply.',
    ],
  };
  const bytes = Buffer.byteLength(JSON.stringify(packet), 'utf8');
  if (bytes > limits.maxDocumentBytes) {
    throw err('CONTEXT_TOO_LARGE',
      `workflow packet exceeds ${limits.maxDocumentBytes} bytes`);
  }
  return packet;
}
