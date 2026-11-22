// SPDX-License-Identifier: Apache-2.0
// Per-host install manifest (spec-kit parity): every file a host
// activation would produce, hashed and labeled by ownership mode —
//   whole:  harness-generated file it owns outright
//   partial: user file with a SCOPEGRAIN managed marker section
//   shared:  manual-merge proposal into host-owned configuration
// The manifest is a render artifact; writing it is a separate explicit
// step so previews stay read-only.

import crypto from 'node:crypto';
import { buildActivation } from './activation.mjs';
import { hasManagedSection } from '../core/managed-section.mjs';

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

export function hostManifest(ctx, { host, surface, installRoot } = {}) {
  const plan = buildActivation(ctx, { host, surface, installRoot });
  const generated = [];
  for (const f of plan.applyable) {
    const buf = Buffer.isBuffer(f.content) ? f.content
      : Buffer.from(f.content);
    const text = buf.toString('utf8');
    generated.push({
      rel: f.rel,
      kind: f.kind,
      sha256: sha256(buf),
      ownership: hasManagedSection(text) ? 'partial' : 'whole',
      source: f.source,
    });
  }
  const shared = plan.skipped.map((s) => ({
    destination: s.destination,
    ownership: 'shared',
    reason: s.reason,
    source: s.source,
  }));
  return Object.freeze({
    schemaVersion: 1,
    host,
    format: plan.format,
    generated,
    shared,
    warnings: [...plan.warnings],
    generatedAt: new Date().toISOString(),
  });
}
