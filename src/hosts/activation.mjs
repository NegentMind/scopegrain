// SPDX-License-Identifier: Apache-2.0
// Opt-in host activation: previews and applies generated native proposals
// into project-local host destinations (e.g. .claude/skills/<n>/SKILL.md).
//
// Boundaries, mirroring the bootstrap contract:
// - preview mirrors preflightPlan semantics WITHOUT throwing, so callers
//   can report create|conflict|noop per destination;
// - apply delegates the write to applyPlan, which re-runs the throwing
//   preflightPlan immediately before `wx` creation and rolls back only
//   the files it created;
// - create-only: an existing identical file is noop, anything else is
//   conflict and blocks the whole apply;
// - destinations are canonical project-relative paths only. Global host
//   paths (~/...) and merge-required fragments (shared config files) are
//   classified manual-only and never written;
// - proposal bytes are re-derived from catalog + policy at call time, so
//   a hand-edited proposal file can never propagate into a destination.
import path from 'node:path';
import { err } from '../core/errors.mjs';
import { lstatOrNull, readFileLimited } from '../core/fsx.mjs';
import {
  RESERVED_PREFIXES, isSameOrAncestor, portableKey, resolveInside,
  toCanonicalRelative,
} from '../core/paths.mjs';
import { KNOWN_HOSTS, configDirOf } from '../core/config.mjs';
import { loadCatalog, loadWorkspaceCatalog } from '../core/catalog.mjs';
import { applyPlan } from '../core/bootstrap.mjs';
import { renderNativeAdapters } from './native.mjs';

// Entry kinds that merge into a SHARED host configuration file (possibly
// user-owned). They are review fragments, never whole new files, so
// activation never writes them.
const MERGE_KINDS = new Set(['agent-declaration', 'mcp']);
// Shell home expansion: '~' or '~/...' denotes a global path.
const GLOBAL_DEST = /^~([/\\]|$)/;

function assertCtx(ctx) {
  const { projectRoot, configPath, config } = ctx || {};
  if (typeof projectRoot !== 'string' || !path.isAbsolute(projectRoot)) {
    throw err('INVALID_ADAPTER_INPUT', 'ctx.projectRoot must be absolute');
  }
  if (config === null || typeof config !== 'object'
      || !Array.isArray(config.hosts)) {
    throw err('INVALID_ADAPTER_INPUT', 'ctx.config.hosts must be an array');
  }
  const configRel = toCanonicalRelative(configPath, 'ctx.configPath');
  return { projectRoot, configRel, config };
}

// Non-throwing mirror of preflightPlan: identical checks (planned
// collisions, containment, links/non-files, bounded identical-bytes
// comparison) but reports an action per file instead of throwing.
function previewActions(projectRoot, files) {
  const collide = new Set();
  for (let i = 0; i < files.length; i++) {
    for (let j = i + 1; j < files.length; j++) {
      if (isSameOrAncestor(files[i].rel, files[j].rel)
          || isSameOrAncestor(files[j].rel, files[i].rel)) {
        collide.add(i);
        collide.add(j);
      }
    }
  }
  return files.map((f, i) => {
    if (collide.has(i)) {
      return { ...f, action: 'conflict',
        reason: 'planned destination collides with another' };
    }
    let abs;
    try {
      abs = resolveInside(
        projectRoot, f.rel, `activation destination ${f.rel}`);
    } catch (e) {
      return { ...f, action: 'conflict', reason: e.code || 'INVALID_PATH' };
    }
    const st = lstatOrNull(abs);
    if (!st) return { ...f, action: 'create' };
    if (st.isSymbolicLink() || !st.isFile()) {
      return { ...f, action: 'conflict',
        reason: 'destination is a link or directory' };
    }
    const incoming = Buffer.isBuffer(f.content)
      ? f.content : Buffer.from(f.content);
    const limited = readFileLimited(abs, incoming.length);
    if (limited.exceeded || !limited.content.equals(incoming)) {
      return { ...f, action: 'conflict',
        reason: 'destination exists with different content' };
    }
    return { ...f, action: 'noop' };
  });
}

// Shared pipeline for prepare/apply: validates context and selectors,
// re-renders proposals and classifies every activation-plan entry into
// applyable (project-local whole file) or skipped (manual-only).
export function buildActivation(ctx, { host, surface, installRoot } = {}) {
  const { projectRoot, configRel, config } = assertCtx(ctx);
  if (typeof host !== 'string' || !KNOWN_HOSTS.includes(host)) {
    throw err('UNKNOWN_HOST', `unknown host '${host}'`);
  }
  if (!config.hosts.includes(host)) {
    throw err('HOST_NOT_SELECTED', `host '${host}' is not in config.hosts`);
  }
  if (surface !== undefined
      && (typeof surface !== 'string' || surface === '')) {
    throw err('INVALID_ARGS', 'surface must be a non-empty string');
  }
  // Workspace catalog (not install catalog): mounted bundle resources
  // materialize as native bridges too — catalogDestRel of a mounted
  // entry resolves inside <configDir>/bundles/, which is a valid
  // project-local resource pointer for the bridge frontmatter.
  // No workspace snapshot means no mounted layer can exist — unless a
  // dangling mounted-catalog.json was hand-planted, which fails closed.
  const configDir = ctx.configDir ?? configDirOf(configRel);
  let catalog;
  try {
    catalog = loadWorkspaceCatalog({ ...ctx, configDir });
  } catch (e) {
    if (e.code !== 'WORKSPACE_CATALOG_MISSING') throw e;
    const dangling = lstatOrNull(path.join(
      projectRoot, configDir, 'mounted-catalog.json'));
    if (dangling) throw e;
    catalog = loadCatalog({ installRoot });
  }
  const { files: rendered, activationPlan } = renderNativeAdapters(config,
    { configRel, projectRoot, installRoot, catalog });
  const byRel = new Map(rendered.map((f) => [f.rel, f.content]));
  const warnings = [];

  let entries = activationPlan.entries.filter((e) => e.host === host);
  if (surface !== undefined) {
    if (!entries.some((e) => e.variant !== undefined)) {
      warnings.push(`surface '${surface}' ignored: ${host} emits `
        + 'no variant proposals');
    } else {
      const matched = entries.filter((e) => e.variant === undefined
        || e.variant === surface || (e.surfaces || []).includes(surface));
      if (!matched.some((e) => e.variant !== undefined)) {
        throw err('INVALID_ARGS',
          `surface '${surface}' matches no ${host} proposal`);
      }
      entries = matched;
    }
  } else if (entries.some((e) => e.selectionRequired === true)) {
    // Multi-variant hosts (policy marks every variant selectionRequired):
    // without a surface the plan mixes variants and collides on shared
    // destinations. Name the valid selectors instead of failing later
    // with an opaque PLAN_CONFLICT.
    const selectors = [...new Set(entries.flatMap((e) =>
      [e.variant, ...(e.surfaces ?? [])].filter(Boolean)))];
    throw err('INVALID_ARGS',
      `host '${host}' requires --surface `
      + `(declared surfaces: ${selectors.join(', ')})`);
  }

  const applyable = [];
  const skipped = [];
  for (const e of entries) {
    if (MERGE_KINDS.has(e.kind)) {
      skipped.push({ source: e.source, destination: e.destination,
        reason: 'requires manual merge into shared host configuration' });
      continue;
    }
    if (typeof e.destination !== 'string' || GLOBAL_DEST.test(e.destination)) {
      skipped.push({ source: e.source, destination: e.destination,
        reason: 'destination is a global host path; never auto-applied' });
      continue;
    }
    let rel;
    try {
      rel = toCanonicalRelative(e.destination, 'destination');
    } catch {
      skipped.push({ source: e.source, destination: e.destination,
        reason: 'destination is not a project-relative path' });
      continue;
    }
    // Reserved prefixes guard harness-owned roots (.git, node_modules,
    // legacy, .opencode). Activation destinations are host directories:
    // '.opencode' is the documented opencode host root, so it stays
    // applyable for opencode only. Any other reserved first segment is
    // classified skipped - never written, like every manual-only entry.
    const first = portableKey(rel.split('/')[0]);
    if (RESERVED_PREFIXES.has(first)
        && !(first === '.opencode' && host === 'opencode')) {
      skipped.push({ source: e.source, destination: e.destination,
        reason: `destination targets reserved prefix '${first}'` });
      continue;
    }
    const content = byRel.get(e.source);
    if (content === undefined) {
      skipped.push({ source: e.source, destination: e.destination,
        reason: 'proposal source was not generated' });
      continue;
    }
    applyable.push({ rel, content,
      source: e.source, kind: e.kind, format: e.format });
  }
  // Identical proposals claiming one destination are not a conflict —
  // dedupe same rel+content pairs before the collision check. Same rel
  // with different bytes stays doubled and still collides downstream.
  const seen = new Set();
  for (let i = applyable.length - 1; i >= 0; i -= 1) {
    const f = applyable[i];
    const key = `${f.rel} ${Buffer.from(f.content).toString('base64')}`;
    if (seen.has(key)) applyable.splice(i, 1);
    else seen.add(key);
  }
  if (skipped.length > 0) {
    warnings.push(`${skipped.length} proposal(s) require manual merge or `
      + 'review and are never auto-applied');
  }
  if (skipped.some((s) => GLOBAL_DEST.test(String(s.destination)))) {
    warnings.push('one or more destinations are global host paths '
      + '(~/...); the harness never writes them');
  }
  if (applyable.some((f) => f.rel === '.agents'
      || f.rel.startsWith('.agents/'))) {
    warnings.push('.agents destinations are a shared convention '
      + 'discoverable by more than one host; not product isolation');
  }
  const format = entries.some((e) => e.format === 'provisional')
    ? 'provisional' : 'documented-only';
  return { projectRoot, applyable, skipped, warnings, format };
}

const shape = (planned) => planned.map(
  ({ rel, action, source, kind, reason }) =>
    ({ rel, action, source, kind, ...(reason ? { reason } : {}) }));

// prepareActivation(ctx, {host, surface?}) -> dry-run preview.
// ctx is a resolveContext result (or the equivalent {projectRoot,
// configPath, config}); surface optionally selects a variant id or one of
// its declared surfaces. Writes nothing.
export function prepareActivation(ctx, { host, surface, installRoot } = {}) {
  const plan = buildActivation(ctx, { host, surface, installRoot });
  const planned = previewActions(plan.projectRoot, plan.applyable);
  return {
    mode: 'dry-run',
    host,
    surface: surface ?? null,
    format: plan.format,
    files: shape(planned),
    skipped: plan.skipped,
    warnings: plan.warnings,
  };
}

// applyActivation(ctx, {host, surface?}) -> applied result.
// Re-runs the throwing preflight inside applyPlan immediately before
// writing; any conflict aborts the whole apply (PLAN_CONFLICT) and
// created files roll back. Never overwrites, never writes outside the
// project root, never touches global host configuration.
export function applyActivation(ctx, { host, surface, installRoot } = {}) {
  const plan = buildActivation(ctx, { host, surface, installRoot });
  const planned = previewActions(plan.projectRoot, plan.applyable);
  const result = applyPlan(plan.projectRoot,
    plan.applyable.map((f) => ({ rel: f.rel, content: f.content })));
  return {
    mode: 'applied',
    host,
    surface: surface ?? null,
    format: plan.format,
    applied: result.created,
    files: shape(planned),
    skipped: plan.skipped,
    warnings: plan.warnings,
  };
}
