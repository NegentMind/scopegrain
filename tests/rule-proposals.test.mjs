// SPDX-License-Identifier: Apache-2.0
// Rule proposals through the shared review gate: memory promote results
// map to 'rule' capture proposals, approve writes a Status:Proposed
// draft in the local overlay, reject suppresses re-emission. Nothing
// reaches active without a separate `rule approve`.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { applyPlan } from '../src/core/bootstrap.mjs';
import { prepareWorkspace } from '../src/core/workspaces.mjs';
import { proposeMemoryRules } from '../src/core/memory-rules.mjs';
import { applyRuleProposalDraft, showRule }
  from '../src/core/rules.mjs';
import {
  filterRejectedProposals, listProposalDecisions,
  persistProposalDecision, reviewProposal, ruleProposalsFromMemory,
} from '../src/core/capture-proposals.mjs';
import { appendWorklog } from '../src/core/worklog.mjs';
import { parseRuleMeta } from '../src/core/rule-meta.mjs';
import {
  bootstrappedCtx, cleanup,
} from './helpers.mjs';

const lesson = (ctx, fields) => appendWorklog(ctx, 'lessons', fields);

function enrolled(ctx, dir) {
  const prepared = prepareWorkspace(ctx, {
    areas: [{ key: 'alpha', name: 'Alpha' }],
  });
  applyPlan(dir, [prepared.file]);
  return prepared.workspace.areas.map((a) => a.id);
}

function gateProposal(ctx, areaIds) {
  const memory = proposeMemoryRules(ctx);
  return ruleProposalsFromMemory(memory, { areaIds });
}

test('mapper emits rule proposals from promote results only', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const areaIds = enrolled(ctx, dir);
    // 'lint-style' is no catalog rule -> promote; 'evidence' is a
    // canonical rule -> merge (excluded from the gate).
    for (let i = 0; i < 2; i += 1) {
      lesson(ctx, { topic: 'lint-style', text: `lint lesson ${i}` });
      lesson(ctx, { topic: 'evidence',
        text: `evidence lesson ${i}` });
    }
    const memory = proposeMemoryRules(ctx);
    assert.ok(memory.proposals.some((p) =>
      p.kind === 'merge' && p.rule?.id === 'evidence'));
    const proposals = gateProposal(ctx, areaIds);
    const promote = proposals.filter(
      (p) => p.suggestedSubjectId === 'lint-style');
    assert.equal(promote.length, 1);
    const p = promote[0];
    assert.equal(p.category, 'rule');
    assert.equal(p.statement.kind, 'inferred');
    assert.equal(p.provenance.producer, 'memory-rules');
    assert.equal(p.provenance.recordId, 'lint-style');
    // The gate proposal reuses the memory proposalId — one signal,
    // one decision key.
    const mp = memory.proposals.find((x) =>
      x.suggestedRule?.id === 'lint-style');
    assert.equal(p.proposalId, mp.proposalId);
    // Merge suggestions never enter the gate — approving one would
    // need a write to a pinned canonical file.
    assert.ok(!proposals.some((x) =>
      x.suggestedSubjectId === 'evidence'));
  } finally { cleanup(dir); }
});

test('approve persists the decision and writes a proposed draft', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const areaIds = enrolled(ctx, dir);
    for (let i = 0; i < 2; i += 1) {
      lesson(ctx, { topic: 'gate-rule', text: `gated lesson ${i}` });
    }
    const [p] = gateProposal(ctx, areaIds);
    const review = reviewProposal(p, { action: 'approve' });
    assert.equal(review.status, 'approved');
    assert.equal(review.input.capture.category, 'rule');
    const persisted = persistProposalDecision(ctx, p,
      { action: 'approve' });
    assert.equal(persisted.decision.action, 'approve');
    // The gate path: capture.subjectId + capture.summary feed the
    // draft writer, exactly like cmdCaptureReview.
    const draft = applyRuleProposalDraft(ctx, {
      id: persisted.review.input.capture.subjectId,
      content: persisted.review.input.capture.summary });
    assert.equal(draft.id, 'gate-rule');
    const body = fs.readFileSync(
      path.join(dir, draft.rel), 'utf8');
    const meta = parseRuleMeta(body, 'gate-rule', { source: 'local' });
    assert.equal(meta.status, 'proposed');
    // The draft is dormant: `rule show` reports proposed, never
    // active without a separate `rule approve`.
    assert.equal(showRule(ctx, 'gate-rule').status, 'proposed');
  } finally { cleanup(dir); }
});

test('reject suppresses re-emission; edit lands in the draft', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const areaIds = enrolled(ctx, dir);
    for (let i = 0; i < 2; i += 1) {
      lesson(ctx, { topic: 'edit-me', text: `edit lesson ${i}` });
    }
    const [p] = gateProposal(ctx, areaIds);
    // Reject first: the same proposal must not reappear.
    persistProposalDecision(ctx, p, { action: 'reject' });
    const { decisions } = listProposalDecisions(ctx);
    assert.equal(filterRejectedProposals([p], decisions).length, 0);
    // Edit: the corrected summary becomes the draft body.
    const review = reviewProposal(p, { action: 'edit',
      changes: { title: 'Curated rule',
        summary: '# Curated\n\n> **Status:** Proposed\n\nedited body' } });
    assert.equal(review.status, 'approved');
    const draft = applyRuleProposalDraft(ctx, {
      id: review.input.capture.subjectId,
      content: review.input.capture.summary });
    const body = fs.readFileSync(
      path.join(dir, draft.rel), 'utf8');
    assert.ok(body.includes('edited body'));
  } finally { cleanup(dir); }
});
