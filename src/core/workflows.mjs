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
import { suggestCapabilities } from './task-suggest.mjs';
import { KNOWN_HOSTS, validateMethodologyMode } from './config.mjs';
import { evaluateTaskActions } from './methodology.mjs';
import { findPlaceholders, renderPlaceholders } from './placeholders.mjs';
import { hooksFor } from './hooks-policy.mjs';
import { estimateJson, estimateTokens, TOKEN_ESTIMATOR }
  from './tokens.mjs';
import {
  presetLayers, listRegistry, composeResource,
} from './distribution.mjs';

const ALLOWED = new Set([
  'command', 'mode', 'taskId', 'host', 'profile', 'interaction',
  'arguments', 'script', 'lazy',
]);
const INTERACTIONS = new Set(['direct', 'guided']);

function resolveResources(kind, ids, catalog, presets, hits, lazy) {
  const out = [];
  const seen = new Set();
  for (const id of ids) {
    const r = getResource(kind, id, { catalog });
    const canon = r.canonicalId ?? r.id;
    const k = `${kind}/${canon}`.toLowerCase();
    if (seen.has(k)) continue; // alias+target dedupe post-resolution
    seen.add(k);
    if (lazy) {
      // Index entry only: the body is hydrated on demand via catalog
      // show / scopegrain_catalog_get. Preset layers are not composed —
      // their hits are declared on the caller's deferred list.
      const { applied: h } = presetLayers(presets, kind, canon);
      for (const hh of h) hits.push({ resource: k, ...hh });
      out.push({
        kind, id: canon,
        description: r.description, path: catalogDestRel(r),
        sha256: r.sha256 ?? null,
        ...(r.meta ? { meta: r.meta } : {}),
        ...(r.bundle ? { bundle: r.bundle } : {}),
      });
      continue;
    }
    const base = decodeUtf8Strict(
      r.content, 'CATALOG_MALFORMED', `catalog resource ${kind}/${canon}`);
    const { layers, applied: h } = presetLayers(presets, kind, canon);
    for (const hh of h) hits.push({ resource: k, ...hh });
    out.push({
      kind, id: canon,
      description: r.description, path: catalogDestRel(r),
      content: composeResource(base, layers),
      ...(r.meta ? { meta: r.meta } : {}),
      ...(r.bundle ? { bundle: r.bundle } : {}),
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
  // Core profile always supplements the selected profile; mcps is an
  // optional profile list (pre-gating profiles carry none).
  const merged = { skills: [], rules: [], references: [], mcps: [] };
  for (const lk of Object.keys(merged)) {
    merged[lk] = [...new Set([
      ...(profile[lk] ?? []), ...(core[lk] ?? [])])];
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
  const lazy = opts.lazy === true;
  let task = null;
  let allowedActions = null;
  const methodology = {
    mode: validateMethodologyMode(ctx.config.methodology, 'config.methodology'),
    available: true, taskCheck: null,
    authenticatesEvidence: false, interceptsNativeTools: false,
  };
  let actionHooks = null;
  if (opts.taskId !== undefined) {
    task = getTask(ctx, opts.taskId);
    const effective = evaluateTaskActions(ctx, task);
    allowedActions = effective.permitted;
    methodology.taskCheck = effective.methodology;
    // Bounded pre-action hook trace: `applied` lists every hook that
    // matched (block/record/require-gate), `gated` flags actions the host
    // must obtain approval for before exercising — declared, never silent.
    actionHooks = effective.actionHooks;
  }
  // Task-typed routing: skills declared on the task record auto-include
  // into the packet's skills bucket. Ids that do not resolve are reported
  // on the skipped list — declared, never silent; command-declared deps
  // still fail closed through resolveResources.
  const taskRouting = opts.taskId === undefined ? null
    : { taskId: task.id, skills: [], included: [], skipped: [],
      suggested: [] };
  if (taskRouting) {
    const declared = Array.isArray(task.skills) ? task.skills : [];
    for (const sid of declared) {
      if (typeof sid !== 'string' || sid.trim() === '') continue;
      taskRouting.skills.push(sid);
      try {
        const r = getResource('skill', sid, { catalog });
        taskRouting.included.push(r.canonicalId ?? r.id);
      } catch {
        taskRouting.skipped.push(sid);
      }
    }
    // Suggestive trace: ranked capability candidates derived from task
    // metadata (type/title/contract/scope). Declared in the packet so a
    // reviewer sees what the heuristic would propose — it never writes
    // task.skills and never enters the skills bucket by itself.
    taskRouting.suggested = suggestCapabilities(ctx, task).suggestions;
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
  // Placeholder rendering is optional: callers pass --arguments /
  // --script; unresolved tokens fail closed, never silently strip.
  // When no placeholder exists the rendered body equals content —
  // serializing both used to duplicate ~55% of a lazy packet, so the
  // packet emits `sameAsContent` instead of a second copy.
  const renderedBody = (() => {
    const ph = findPlaceholders(commandBase);
    if (!ph.arguments && !ph.script && ph.handoffs.length === 0) {
      return commandBase;
    }
    return renderPlaceholders(commandBase, {
      arguments: opts.arguments ?? '',
      script: opts.script,
    });
  })();
  // Active extensions contribute declared resources into extra kind
  // buckets. Activation already validated ids; resolution re-validates —
  // catalog drift since activation fails closed at getResource.
  const extensionApplied = [];
  const presetDeferred = [];
  const hitsTarget = lazy ? presetDeferred : presetApplied;
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
      const base = lazy ? null : decodeUtf8Strict(r.content,
        'CATALOG_MALFORMED', `catalog resource ${key}`);
      const { layers, applied: hits } =
        presetLayers(presets, kind, canon);
      for (const h of hits) {
        hitsTarget.push({ resource: key, ...h });
      }
      contributedResources[bucket].push({ kind, id: canon,
        description: r.description, path: catalogDestRel(r),
        ...(lazy
          ? { sha256: r.sha256 ?? null }
          : { content: composeResource(base, layers) }),
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
    // Copied: the catalog's warnings array is shared with the verified
    // cache — packet-level additions must not leak back into it.
    warnings: [...(catalog.warnings ?? [])],
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
      // `rendered` is emitted only when it differs from `content`;
      // `sameAsContent` marks the common no-placeholder case so
      // consumers can fall back (`command.rendered ?? command.content`).
      ...(renderedBody === commandBase
        ? { sameAsContent: true }
        : { rendered: renderedBody }),
    },
    interaction,
    host: opts.host ?? null,
    // Declarative before_/after_ hooks from policy/hooks.json — advisory
    // data projected to hosts; the harness never executes them.
    hooks: hooksFor(inv.canonicalId),
    // Installed preset override layers applied to projected resources —
    // declared, never silent. In lazy mode layers are not composed into
    // bodies, so their hits are reported under `deferred` instead.
    presets: { applied: presetApplied,
      ...(presetDeferred.length ? { deferred: presetDeferred } : {}) },
    lazy: lazy || undefined,
    // Posture declaration: full remains an explicit request (hosts
    // without catalog access still need inlined bodies); `recommended`
    // is the documented default posture for hosts that can hydrate via
    // `catalog show` / scopegrain_catalog_get — the MCP server always
    // exposes that tool.
    posture: { current: lazy ? 'lazy' : 'full', recommended: 'lazy' },
    hydrate: lazy ? {
      cli: 'scopegrain catalog show KIND ID --project PATH',
      mcp: 'scopegrain_catalog_get',
    } : undefined,
    // Opt-in deep layer: mounted bundle entries (kind/id + owning
    // bundle) are already merged in the workspace catalog — entries
    // carrying `bundle` are deep resources whose bodies live under
    // <configDir>/bundles/<bundle>/ and hydrate through the same
    // channels as snapshot resources.
    deep: {
      available: (catalog.mounted ?? 0) > 0,
      mounted: catalog.mounted ?? 0,
      bundles: [...new Set(catalog.entries
        .filter((e) => e.bundle).map((e) => e.bundle))].sort(),
      path: 'bundles/',
    },
    taskRouting: taskRouting ?? undefined,
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
        presets, hitsTarget, lazy),
      skills: resolveResources('skill',
        [...new Set([...commandDeps.skills, ...merged.skills,
          ...(taskRouting?.included ?? [])])], catalog,
        presets, hitsTarget, lazy),
      rules: resolveResources('rule',
        [...new Set([...commandDeps.rules, ...merged.rules])], catalog,
        presets, hitsTarget, lazy),
      references: resolveResources('reference',
        [...new Set([...commandDeps.references, ...merged.references])],
        catalog, presets, hitsTarget, lazy),
      prompts: resolveResources('prompt', commandDeps.prompts, catalog,
        presets, hitsTarget, lazy),
      mcps: resolveResources('mcp',
        [...new Set([...commandDeps.mcps, ...merged.mcps])], catalog,
        presets, hitsTarget, lazy),
    },
    contributedResources,
    paths: { ...ctx.config.paths },
    resourceRoot: ctx.configDir,
    task,
    allowedActions,
    actionHooks,
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
      ...(lazy ? ['Lazy packet: resource entries carry the declared '
        + 'index only — hydrate bodies via `catalog show KIND ID` '
        + 'or the scopegrain_catalog_get MCP tool. Preset layers are '
        + 'not composed into hydrated bodies.'] : []),
      'Dependency resources supplement the selected profile; core safety '
        + 'resources always apply.',
    ],
  };
  // Estimated resource cost over the resolved contents — post
  // composeResource/presets — so hosts can budget before interpreting
  // them. Local utf8-bytes/4 heuristic, never the host's real tokenizer.
  // Computed before the document cap so the limit covers the final
  // packet including this block.
  const costTexts = {
    command: [commandBase],
    profile: [Buffer.isBuffer(profileEntry.content)
      ? decodeUtf8Strict(profileEntry.content,
        'PROFILE_MALFORMED', `profile ${profile.id}`)
      : profileEntry.content],
  };
  for (const bucket of [
    'agents', 'skills', 'rules', 'references', 'prompts', 'mcps',
  ]) {
    costTexts[bucket] = [
      ...packet.resources[bucket].map((r) => r.content),
      ...contributedResources[bucket].map((r) => r.content),
    ];
  }
  const byBucket = {};
  let costTotal = 0;
  for (const [bucket, texts] of Object.entries(costTexts)) {
    let estimatedTokens = 0;
    let bytes = 0;
    for (const text of texts) {
      if (typeof text !== 'string') continue;
      const est = estimateTokens(text);
      estimatedTokens += est.estimatedTokens;
      bytes += est.bytes;
    }
    byBucket[bucket] = { estimatedTokens, bytes };
    costTotal += estimatedTokens;
  }
  packet.resourceCost = {
    estimator: TOKEN_ESTIMATOR, total: costTotal, byBucket,
  };
  // Advisory token budget (policy/operation-limits.json
  // packetBudgetTokens): a warning on the packet itself, never an
  // error — the 1 MiB document cap below stays the hard bound. The
  // warning is pushed BEFORE the cap check so an over-budget packet
  // still fails closed if the warning itself tips it over.
  const budgetTokens = limits.packetBudgetTokens;
  if (Number.isInteger(budgetTokens) && budgetTokens > 0) {
    const est = estimateJson(packet).estimatedTokens;
    if (est > budgetTokens) {
      packet.warnings.push(
        `workflow packet is ~${est} estTok (estimator ${TOKEN_ESTIMATOR}),`
          + ` over advisory packetBudgetTokens=${budgetTokens};`
          + ' prefer lazy:true and hydrate on demand');
    }
  }
  const bytes = Buffer.byteLength(JSON.stringify(packet), 'utf8');
  if (bytes > limits.maxDocumentBytes) {
    throw err('CONTEXT_TOO_LARGE',
      `workflow packet exceeds ${limits.maxDocumentBytes} bytes`);
  }
  return packet;
}
