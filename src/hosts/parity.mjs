// SPDX-License-Identifier: Apache-2.0
// Host-projection binding parity: compares the canonical source set each
// selected host would emit (its activation plan — dry-run, read-only)
// and reports drift. A source missing from a host is 'structural' when
// the host projects nothing of that kind at all (a documented host
// limitation), else 'unexpected' — which usually means a projection bug.

import { err } from '../core/errors.mjs';
import { KNOWN_HOSTS } from '../core/config.mjs';
import { buildActivation } from './activation.mjs';
import { loadNativeVariants } from './native.mjs';

// The canonical resource a projected file bridges lives in its
// frontmatter (`source: "command/plan-work"`), not in f.source — the
// latter is the install-tree path and is per-host by construction.
// TOML projections carry the same marker as a `# source:` comment line.
const SOURCE_FM = /^[ \t]*(?:#[ \t]*)?source:\s*"?([^\s"']+)"?\s*$/m;

function fileSource(content) {
  const text = Buffer.isBuffer(content)
    ? content.toString('utf8') : String(content);
  const m = SOURCE_FM.exec(text.slice(0, 2000));
  return m ? m[1] : null;
}

export function hostParity(ctx, { hosts, installRoot } = {}) {
  const selected = hosts ?? ctx.config.hosts;
  if (!Array.isArray(selected) || selected.length === 0) {
    throw err('INVALID_ARGS', 'no hosts selected for parity check');
  }
  for (const h of selected) {
    if (typeof h !== 'string' || !KNOWN_HOSTS.includes(h)) {
      throw err('UNKNOWN_HOST', `unknown host '${h}'`);
    }
    if (!ctx.config.hosts.includes(h)) {
      throw err('HOST_NOT_SELECTED', `host '${h}' is not in config.hosts`);
    }
  }
  const variants = loadNativeVariants({ installRoot }).hosts ?? {};
  const perHost = {};
  const warnings = [];
  for (const host of selected) {
    const sources = new Set();
    const kinds = new Set();
    let plans;
    try {
      plans = [buildActivation(ctx, { host, installRoot })];
    } catch (e) {
      if (!/requires --surface/.test(e.message ?? '')) throw e;
      // Surface-split hosts: parity coverage is the union across all
      // declared variant ids.
      const ids = (variants[host] ?? []).map((v) => v.id);
      if (ids.length === 0) throw e;
      plans = ids.map(
        (surface) => buildActivation(ctx, { host, surface, installRoot }));
    }
    let nonCatalog = 0;
    for (const plan of plans) {
      warnings.push(...(plan.warnings ?? []));
      for (const f of plan.applyable ?? []) {
        const src = fileSource(f.content);
        if (src === null) { nonCatalog += 1; continue; }
        sources.add(src);
        kinds.add(src.split('/')[0]);
      }
    }
    perHost[host] = { sources, kinds, nonCatalog };
  }
  const all = new Set();
  for (const h of selected) {
    for (const s of perHost[h].sources) all.add(s);
  }
  const drift = [];
  const structural = [];
  for (const source of [...all].sort()) {
    const missingFrom = selected.filter(
      (h) => !perHost[h].sources.has(source));
    if (missingFrom.length === 0) continue;
    const kind = String(source).split('/')[0];
    const item = { source, missingFrom };
    if (missingFrom.every((h) => !perHost[h].kinds.has(kind))) {
      structural.push(item);
    } else {
      drift.push(item);
    }
  }
  return {
    ok: drift.length === 0,
    hosts: selected,
    coverage: Object.fromEntries(selected.map(
      (h) => [h, { resources: perHost[h].sources.size,
        nonCatalogFiles: perHost[h].nonCatalog }])),
    drift, structural,
    warnings: [...new Set(warnings)],
  };
}
