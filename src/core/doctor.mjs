// SPDX-License-Identifier: Apache-2.0
// Read-only health check: validates config, paths, generated file CONTENTS,
// installed templates, discovery freshness and warnings. Executes nothing
// and never asserts that a host or service is installed.
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  decodeUtf8Strict, lstatOrNull, readDirBounded, readFileLimited,
} from './fsx.mjs';
import { isInside, resolveInside } from './paths.mjs';
import { PATH_KEYS, configDirOf } from './config.mjs';
import { inspectProject } from '../discovery/inspect.mjs';
import { diffInvestigation, investigateProject } from '../discovery/semantic.mjs';
import { buildInitPlan, INSTALL_ROOT } from './bootstrap.mjs';
import {
  catalogFiles, checkCatalog, loadCatalog, loadWorkspaceCatalog,
} from './catalog.mjs';
import { loadLimits } from './policy.mjs';
import { validateWorkspace, workspaceFileRel } from './workspaces.mjs';
import { checkDocsCliDrift } from './docs-cli-drift.mjs';
import { failureSignatures } from './error-signature.mjs';
import { readWorklog } from './worklog.mjs';
import { validateSessionShape } from './sessions.mjs';
import { validateVerifyStore, verifyStoreRel } from './verify-commands.mjs';
import { gitHooksDir } from './hooks.mjs';
import { detectHostClis } from './host-cli.mjs';
import { prepareActivation } from '../hosts/activation.mjs';
import { loadNativeVariants } from '../hosts/native.mjs';
import {
  hasManagedSection, managedBody, managedEquals,
} from './managed-section.mjs';
import { loadUserConfig } from './user-config.mjs';

const MAX_LIST = 100000;
const WORKLOG_NAMES = ['lessons', 'outcomes', 'progress', 'goals',
  'activity'];

// Repair guidance attached to every failing check as `fix`: the exact
// command or action an agent can propose to the owner. Doctor stays
// read-only — it names repairs, it never runs them.
const CHECK_FIX = {
  'catalog': 'install-level corruption: reinstall the harness '
    + '(`npm install -g <installRoot>`) or restore the named resource '
    + 'from a clean source checkout',
  'workspace-catalog': 'refresh the pinned snapshot: '
    + '`scopegrain update --project . --reconcile --apply`',
  'upgrade': 'review the snapshot diff, then re-pin: '
    + '`scopegrain update --project . --apply`',
  'templates': 'missing install template: reinstall the harness '
    + '(`npm install -g <installRoot>`)',
  'generated': 'review the divergence, then '
    + '`scopegrain update --project . --apply` (managed sections refresh '
    + 'in place; --reconcile rewrites reconcilable conflicts, the rest '
    + 'merge manually)',
  'workspace-enrollment': 'inspect the named file; re-enroll with '
    + '`scopegrain workspace init --project . --apply` or restore it '
    + 'from `scopegrain backup` output',
  'runtime': 'run scopegrain with Node.js >=22',
  'policy': 'corrupt install policy: reinstall the harness '
    + '(`npm install -g <installRoot>`)',
  'journal-internals': 'inspect the named outbox entries; quarantine or '
    + 'repair the malformed JSON manually',
  'verify-store': 'restore the store from `scopegrain restore --from '
    + '<bundle>` or remove it and re-seed with '
    + '`scopegrain verify discover --project . --apply`',
  'sessions': 'quarantine or repair the named session record files '
    + '(fail-closed by design)',
  'worklogs': 'quarantine or restore the named JSONL file from '
    + '`scopegrain backup` output',
  'error-signatures': 'investigate the recurring failure via '
    + '`scopegrain memory list --log <name>`; resolve the cause instead '
    + 'of retrying',
  'record-ownership': 'quarantine or repair the named sidecar files',
  'vantadb': 'fix or delete the enrollment file, or re-enroll via '
    + '`scopegrain vantadb setup --project . --apply`',
  'hooks': 'repair the git worktree; once .git is usable, '
    + '`scopegrain hooks install --project . --apply` installs the '
    + 'managed hook',
  'stale-locks': 'no action needed — reclaimed automatically on next '
    + 'acquire; delete the named *.lock files only after confirming no '
    + 'live writer holds them',
  'host-fragments': 'inspect with `scopegrain host manifest --host '
    + '<name>`, then `scopegrain host activate --host <name> --apply`',
  'host-merge-targets': 'the project or install was relocated: re-merge '
    + 'the named host config files with current absolute paths',
  'host-cli': 'install the missing host CLI or remove the host from '
    + 'config.hosts',
  'docs-cli-drift': 'warning only: update the documented surface in '
    + 'docs/ or extend the check',
  'mcp-deps': 'run `npm install` inside the harness install root',
  'viewer-build': 'run `npm run build` inside `viewer/` of the install '
    + 'root',
  'user-artifacts': 'quarantine or restore the named JSON records '
    + '(fail-closed by design)',
  'user-config': 'fix or delete the malformed global user config at '
    + 'the named path',
};

function fixFor(name, detail) {
  if (name.startsWith('paths.')) {
    return 'create the expected directory or correct `paths.*` in the '
      + 'config file';
  }
  if (name === 'discovery') {
    return detail.includes('fingerprint')
      ? 're-pin discovery: `scopegrain init --project . --apply`'
      : '`scopegrain update --project . --apply` regenerates a missing '
        + 'file; malformed bytes need a manual restore';
  }
  if (name === 'journal') {
    return detail.includes('active operation')
      ? 'inspect it with `scopegrain journal show <op>`, then '
        + '`scopegrain journal recover <op> --input FILE --apply`'
      : 'restore the journal head from `scopegrain backup` output or '
        + 'repair it manually';
  }
  return CHECK_FIX[name]
    ?? 'no scripted repair — inspect the named item and consult '
      + 'docs/en/cli-reference.md';
}
const POLICY_FILES = [
  'workflow.json', 'operation-limits.json', 'methodology.json',
  'onboarding-defaults.json', 'native-adapters.json',
  'native-variants.json',
];

const REQUIRED_TEMPLATES = [
  'hosts/native-resource.md',
  'hosts/native-agent.md',
  'entrypoint.md',
  'project-instructions.md',
  'task-contract.md',
  'approval-prompts.json',
  'render-specification.mjs',
];

function statusOf(abs) {
  const st = lstatOrNull(abs);
  if (!st) return 'missing';
  if (st.isSymbolicLink()) return 'symlink';
  if (st.isDirectory()) return 'directory';
  return 'file';
}

// Exact byte equality; allowCRLF additionally accepts the CRLF form that
// core.autocrlf produces for root-level files unreachable by the nested
// configDir .gitattributes. latin1 keeps every byte — never trim or bare-CR.
function bytesEqualOnDisk(abs, content, { allowCRLF = false } = {}) {
  const st = lstatOrNull(abs);
  if (!st || !st.isFile() || st.isSymbolicLink()) return false;
  const incoming = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const limited = readFileLimited(abs,
    allowCRLF
      ? Math.min(loadLimits().maxDocumentBytes, incoming.length * 2)
      : incoming.length);
  if (limited.exceeded) return false;
  if (limited.content.equals(incoming)) return true;
  if (!allowCRLF) return false;
  const lf = (b) => Buffer.from(
    b.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
  return lf(limited.content).equals(lf(incoming));
}

// ctx: {projectRoot, configPath, configDir, config} from resolveContext.
// A malformed config fails in resolveContext before doctor runs.
// opts.installRoot allows tests to simulate a missing-template install.
export function runDoctor(ctx, opts = {}) {
  const { projectRoot, config, configPath } = ctx;
  const installRoot = opts.installRoot || INSTALL_ROOT;
  const warnings = [];
  const checks = [];
  // Failed checks push a warning entry; severity:'warning' marks
  // non-blocking findings that count under summary.warnings, never
  // summary.failures. `extra` merges structured fields into the check.
  let failureCount = 0;
  const push = (name, ok, detail, extra = null) => {
    const check = { name, ok, detail, ...extra };
    if (!ok && check.fix === undefined) {
      check.fix = fixFor(name, detail);
    }
    checks.push(check);
    if (!ok) {
      warnings.push(`${name}: ${detail}`);
      if (check.severity !== 'warning') failureCount += 1;
    }
  };

  push('config', true, `valid configuration at ${configPath}`);

  // Catalog integrity surfaces explicitly (projection drift, corrupt
  // profiles, missing resources are needs-attention, never repaired).
  const cat = checkCatalog({ installRoot });
  if (cat.ok) {
    push('catalog', true, `${cat.entries} catalog entries validated`);
  } else {
    push('catalog', false,
      cat.issues.map((i) => i.message).join(' | '));
  }

  // Workspace snapshot is a SEPARATE check from the installation catalog:
  // an old-but-valid pin is an upgrade notice, never corruption.
  let workspace = null;
  let upgradeAvailable = null;
  try {
    workspace = loadWorkspaceCatalog({ projectRoot, configDir: ctx.configDir });
    push('workspace-catalog', true,
      `snapshot integrity ${workspace.integrity} (${workspace.entries.length} entries)`);
    // Local rules overlay: owner-authored rules under rules/local/ are
    // un-pinned by design — report the count so the layer is visible.
    push('rule-overlay', true,
      `${workspace.localRules ?? 0} local overlay rule(s) under rules/local/`);
    if (workspace.snapshotVersion === 1) {
      push('workspace-catalog', false,
        'legacy-unpinned snapshot: no sha256 coverage; upgrade recommended');
    }
  } catch (e) {
    push('workspace-catalog', false, `${e.code}: ${e.message}`);
  }
  if (workspace && workspace.snapshotVersion === 2 && cat.ok) {
    try {
      const expectedFiles = catalogFiles({ installRoot });
      const expectedManifest = JSON.parse(expectedFiles.find(
        (f) => f.rel === 'catalog.json').content);
      // Exclude the mounted layer — mounted entries are appended by
      // mergeMounted AFTER the snapshot manifest and would make this
      // comparison diverge permanently (false 'upgrade' every doctor
      // run once any bundle is mounted).
      // Exclude mounted AND local-overlay layers — both are appended
      // after the snapshot manifest and would make this comparison
      // diverge permanently.
      const snapshotEntries = workspace.entries.slice(
        0, workspace.entries.length
          - (workspace.mounted ?? 0) - (workspace.localRules ?? 0));
      const snapshotManifest = {
        schemaVersion: workspace.snapshotVersion,
        entries: snapshotEntries.map((e) => ({
          ...e, sha256: e.sha256.toLowerCase(),
        })),
        aliases: workspace.aliases,
      };
      // Compare both directions and include metadata/aliases, not only
      // hashes of entries that still exist in the workspace.
      upgradeAvailable = !isDeepStrictEqual(
        snapshotManifest, expectedManifest);
      if (upgradeAvailable) {
        push('upgrade', false,
          'snapshot differs from this installation; pin integrity is valid, explicit review required');
      }
    } catch (e) {
      push('upgrade', false, `cannot compare versions: ${e.message}`);
    }
  } else if (workspace && workspace.snapshotVersion === 1) {
    upgradeAvailable = null;
  }

  // Required installed templates must exist to produce/verify generated files.
  let templatesOk = true;
  const templatesDir = path.join(installRoot, 'templates');
  for (const rel of REQUIRED_TEMPLATES) {
    const st = lstatOrNull(path.join(templatesDir, ...rel.split('/')));
    if (!st || !st.isFile()) {
      templatesOk = false;
      push('templates', false, `missing template ${rel}`);
    }
  }
  if (templatesOk) push('templates', true, 'required templates installed');

  for (const key of PATH_KEYS) {
    const rel = config.paths[key];
    const abs = resolveInside(projectRoot, rel, `paths.${key}`);
    const s = statusOf(abs);
    push(`paths.${key}`, s === 'directory' || s === 'missing', `${rel} -> ${s}`);
  }

  // Compare every generated file's bytes against what init would produce
  // today. config.json and discovery.json are exempt: preserved re-init
  // bytes are legitimate, and fingerprint freshness is checked separately.
  const cfgDir = configDirOf(configPath);
  const discoveryRel = cfgDir === '.' ? 'discovery.json' : `${cfgDir}/discovery.json`;
  const discoveryAbs = resolveInside(projectRoot, discoveryRel);

  // discovery.json is required as a valid record: present regular file,
  // parseable JSON, schemaVersion 1, fingerprint matching the config.
  {
    const st = lstatOrNull(discoveryAbs);
    if (!st || st.isSymbolicLink() || !st.isFile()) {
      push('discovery', false, `${discoveryRel} -> ${statusOf(discoveryAbs)}`);
    } else {
      let rec;
      try {
        const limited = readFileLimited(
          discoveryAbs, loadLimits().maxDocumentBytes);
        if (limited.exceeded) {
          push('discovery', false, `${discoveryRel} exceeds document limit`);
        } else {
          rec = JSON.parse(decodeUtf8Strict(
            limited.content, 'MALFORMED_JSON', discoveryRel));
        }
      } catch {
        push('discovery', false, `${discoveryRel} contains malformed JSON`);
      }
      if (rec !== undefined) {
        if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) {
          push('discovery', false, `${discoveryRel} must contain an object`);
        } else if (rec.schemaVersion !== 1) {
          push('discovery', false, `${discoveryRel} schemaVersion is not 1`);
        } else if (rec.fingerprint !== config.discovery.fingerprint) {
          push('discovery', false,
            `${discoveryRel} fingerprint does not match config`);
        } else {
          push('discovery', true, `${discoveryRel} valid record`);
        }
      }
    }
  }

  let expected = [];
  try {
    const plan = buildInitPlan({
      projectRoot,
      configRel: configPath,
      config,
      configContent: (() => {
        const l = readFileLimited(resolveInside(projectRoot, configPath),
          loadLimits().maxDocumentBytes);
        return l.exceeded ? undefined : l.content;
      })(),
      templatesDir,
      installRoot,
      discovery: null,
      discoveryContent: (st => (st && st.isFile() && !st.isSymbolicLink()
        ? (() => {
          const l = readFileLimited(discoveryAbs, loadLimits().maxDocumentBytes);
          return l.exceeded ? undefined : l.content;
        })() : undefined))(lstatOrNull(discoveryAbs)),
    });
    expected = plan.files;
  } catch (e) {
    push('generated', false, `cannot regenerate expected files: ${e.message}`);
  }
  for (const f of expected) {
    if (f.rel === configPath || f.rel === discoveryRel) continue;
    const abs = resolveInside(projectRoot, f.rel);
    const s = statusOf(abs);
    if (s !== 'file') {
      push('generated', false, `${f.rel} -> ${s}`);
    } else {
      const isMd = f.rel === 'AGENTS.md' || f.rel === 'CLAUDE.md';
      let same;
      try {
        const incomingText = decodeUtf8Strict(
          Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content),
          'MANAGED_MALFORMED', f.rel);
        if (hasManagedSection(incomingText)) {
          // Files that opted into managed refresh are judged on the managed
          // body alone: every byte outside the markers is user content.
          const limited = readFileLimited(abs, loadLimits().maxDocumentBytes);
          const diskText = limited.exceeded ? null
            : decodeUtf8Strict(limited.content, 'MANAGED_MALFORMED', f.rel)
              .replace(/\r\n/g, '\n');
          same = diskText !== null && hasManagedSection(diskText)
            ? managedEquals(diskText, managedBody(incomingText))
            : bytesEqualOnDisk(abs, f.content, { allowCRLF: isMd });
        } else {
          same = bytesEqualOnDisk(abs, f.content, { allowCRLF: isMd });
        }
      } catch {
        push('generated', false, `${f.rel} -> read failed during compare`);
        continue;
      }
      if (!same) {
        // When the workspace snapshot is healthy V2 and this difference is
        // version-only, label it upgrade-or-local-edit, not corruption.
        const label = upgradeAvailable
          ? 'upgrade-or-local-edit'
          : 'content differs from generated fragment';
        push('generated', false, `${f.rel} -> ${label}`);
      }
    }
  }
  if (expected.length > 0
      && !warnings.some((w) => w.startsWith('generated'))) {
    push('generated', true, 'generated files match current fragments');
  }

  // Lifecycle diagnostics (read-only): workspace enrollment and journal
  // head. These report state only; recovery stays with journal recovery.
  {
    const stateRel = config.paths.state;
    const wsRel = workspaceFileRel(ctx);
    const wsAbs = resolveInside(projectRoot, wsRel, 'workspace file');
    const wst = lstatOrNull(wsAbs);
    if (!wst) {
      push('workspace-enrollment', true, 'not enrolled');
    } else if (wst.isSymbolicLink() || !wst.isFile()) {
      push('workspace-enrollment', false, `${wsRel} is not a regular file`);
    } else {
      try {
        const limited = readFileLimited(wsAbs, loadLimits().maxDocumentBytes);
        if (limited.exceeded) {
          push('workspace-enrollment', false,
            `${wsRel} exceeds document limit`);
        } else {
          const ws = validateWorkspace(JSON.parse(decodeUtf8Strict(
            limited.content, 'MALFORMED_JSON', wsRel)));
          push('workspace-enrollment', true,
            `enrolled revision ${ws.revision} (${ws.areas.length} areas)`);
        }
      } catch (e) {
        push('workspace-enrollment', false, `${e.code}: ${e.message}`);
      }
    }

    const journalRel = `${stateRel}/journal`;
    const jAbs = resolveInside(projectRoot, journalRel, 'journal');
    const jst = lstatOrNull(jAbs);
    if (!jst) {
      push('journal', true, 'no journal');
    } else if (jst.isSymbolicLink() || !jst.isDirectory()) {
      push('journal', false, `${journalRel} is not a directory`);
    } else {
      const headAbs = resolveInside(
        projectRoot, `${journalRel}/head.json`, 'journal head');
      const hst = lstatOrNull(headAbs);
      if (!hst) {
        const hasHistory = ['operations', 'outbox',
          'archive/operations'].some((rel) => {
          const dAbs = path.join(jAbs, ...rel.split('/'));
          const dst = lstatOrNull(dAbs);
          if (!dst) return false;
          if (!dst.isDirectory() || dst.isSymbolicLink()) return true;
          try {
            return readDirBounded(dAbs, 1).entries.length > 0;
          } catch {
            return true; // unreadable history counts as present
          }
        });
        push('journal', !hasHistory, hasHistory
          ? 'journal head is missing while history exists'
          : 'no recorded operations');
      } else if (hst.isSymbolicLink() || !hst.isFile()) {
        push('journal', false, 'journal head is not a regular file');
      } else {
        try {
          const limited = readFileLimited(headAbs, loadLimits().maxDocumentBytes);
          if (limited.exceeded) {
            push('journal', false, 'journal head exceeds document limit');
          } else {
            const head = JSON.parse(decodeUtf8Strict(
              limited.content, 'JOURNAL_MALFORMED', 'journal head'));
            if (head === null || typeof head !== 'object' || Array.isArray(head)
                || head.schemaVersion !== 1) {
              push('journal', false, 'journal head has invalid fields');
            } else if (head.activeOperation !== null
                && head.activeOperation !== undefined) {
              push('journal', false,
                'journal has an active operation; explicit recovery required');
            } else {
              push('journal', true, 'journal idle');
            }
          }
        } catch (e) {
          push('journal', false, `journal head unreadable: ${e.message}`);
        }
      }
    }
  }

  // Operational state health (read-only): integrity of mutable state that
  // each subsystem otherwise only validates on first use. Absence is OK;
  // corruption is a failure — the same fail-closed posture as the writers.

  {
    const major = Number(process.versions.node.split('.')[0]);
    push('runtime', major >= 22,
      `node ${process.versions.node} (requires >=22)`);
  }

  // Canonical install policies: runtime loads them lazily, so corruption
  // would surface inside an unrelated check instead of with its own name.
  {
    const policyDir = path.join(installRoot, 'policy');
    const bad = [];
    for (const rel of POLICY_FILES) {
      const abs = path.join(policyDir, rel);
      const st = lstatOrNull(abs);
      if (!st || st.isSymbolicLink() || !st.isFile()) {
        bad.push(`${rel}: missing`);
        continue;
      }
      try {
        const l = readFileLimited(abs, loadLimits().maxDocumentBytes);
        if (l.exceeded) { bad.push(`${rel}: exceeds limit`); continue; }
        const doc = JSON.parse(decodeUtf8Strict(
          l.content, 'POLICY_MALFORMED', rel));
        if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
          bad.push(`${rel}: not an object`);
        }
      } catch { bad.push(`${rel}: malformed`); }
    }
    if (bad.length === 0) {
      push('policy', true, `${POLICY_FILES.length} policy files parse`);
    } else {
      for (const b of bad) push('policy', false, b);
    }
  }

  // Journal internals beyond the head: component counts plus outbox
  // index parseability.
  {
    const journalAbs = resolveInside(
      projectRoot, `${config.paths.state}/journal`, 'journal');
    const jst = lstatOrNull(journalAbs);
    if (jst && jst.isDirectory() && !jst.isSymbolicLink()) {
      const countDir = (rel) => {
        const dAbs = path.join(journalAbs, ...rel.split('/'));
        const st = lstatOrNull(dAbs);
        if (!st || !st.isDirectory() || st.isSymbolicLink()) return null;
        return readDirBounded(dAbs, MAX_LIST).entries.length;
      };
      const counts = `ops=${countDir('operations') ?? '-'}`
        + ` outbox=${countDir('outbox') ?? '-'}`
        + ` archived=${countDir('archive/operations') ?? '-'}`;
      const outboxAbs = path.join(journalAbs, 'outbox');
      const bad = [];
      const ost = lstatOrNull(outboxAbs);
      if (ost && ost.isDirectory() && !ost.isSymbolicLink()) {
        for (const e of readDirBounded(outboxAbs, MAX_LIST).entries) {
          if (!e.isFile()) continue;
          const f = path.join(outboxAbs, e.name);
          try {
            const fst = lstatOrNull(f);
            if (!fst || fst.isSymbolicLink() || !fst.isFile()) throw 0;
            const l = readFileLimited(f, loadLimits().maxDocumentBytes);
            if (l.exceeded) throw 0;
            const doc = JSON.parse(decodeUtf8Strict(
              l.content, 'JOURNAL_MALFORMED', e.name));
            if (doc === null || typeof doc !== 'object'
                || Array.isArray(doc)) throw 0;
          } catch { bad.push(e.name); }
        }
      }
      if (bad.length === 0) {
        push('journal-internals', true, counts);
      } else {
        push('journal-internals', false,
          `${counts}; malformed outbox entries: ${bad.join(', ')}`);
      }
      const tmp = [];
      for (const e of readDirBounded(journalAbs, MAX_LIST).entries) {
        if (e.isFile() && /^\.head-[^/]+\.tmp$/.test(e.name)) {
          tmp.push(e.name);
        }
      }
      push('journal-tmp', tmp.length === 0,
        tmp.length === 0 ? 'no orphan temp files'
          : `${tmp.length} orphan temp file(s), interrupted head write: `
            + `${tmp.slice(0, 5).join(', ')}`,
        tmp.length === 0 ? null : { severity: 'warning' });
    }
  }

  {
    const rel = verifyStoreRel(ctx);
    const abs = resolveInside(projectRoot, rel, 'verify store');
    const st = lstatOrNull(abs);
    if (!st) {
      push('verify-store', true, 'no verify store');
    } else if (st.isSymbolicLink() || !st.isFile()) {
      push('verify-store', false, `${rel} is not a regular file`);
    } else {
      try {
        const l = readFileLimited(abs, loadLimits().maxDocumentBytes);
        if (l.exceeded) {
          push('verify-store', false, `${rel} exceeds document limit`);
        } else {
          const doc = JSON.parse(decodeUtf8Strict(
            l.content, 'VERIFY_STORE_MALFORMED', rel));
          validateVerifyStore(doc);
          push('verify-store', true,
            `${doc.commands.length} commands validated`);
        }
      } catch (e) {
        push('verify-store', false, `${e.code}: ${e.message}`);
      }
    }
  }

  {
    const rel = `${config.paths.state}/sessions`;
    const abs = resolveInside(projectRoot, rel, 'sessions');
    const st = lstatOrNull(abs);
    if (!st) {
      push('sessions', true, 'no sessions');
    } else if (st.isSymbolicLink() || !st.isDirectory()) {
      push('sessions', false, `${rel} is not a directory`);
    } else {
      let ok = 0;
      const bad = [];
      for (const e of readDirBounded(abs, MAX_LIST).entries) {
        if (!e.isFile() || !e.name.endsWith('.json')) continue;
        try {
          const f = path.join(abs, e.name);
          const fst = lstatOrNull(f);
          if (!fst || fst.isSymbolicLink() || !fst.isFile()) throw 0;
          const l = readFileLimited(f, loadLimits().maxDocumentBytes);
          if (l.exceeded) throw 0;
          validateSessionShape(JSON.parse(decodeUtf8Strict(
            l.content, 'SESSION_MALFORMED', e.name)), e.name);
          ok += 1;
        } catch { bad.push(e.name); }
      }
      if (bad.length === 0) {
        push('sessions', true, `${ok} session records valid`);
      } else {
        push('sessions', false,
          `${bad.length} malformed: ${bad.slice(0, 5).join(', ')}`);
      }
    }
  }

  // Worklogs plus rotated archive segments: every JSONL line parses to
  // an object. Bounded read per file; an unreadable line names its file.
  {
    const memAbs = resolveInside(
      projectRoot, config.paths.memory, 'memory');
    const candidates = WORKLOG_NAMES.map((n) => `${n}.jsonl`);
    const arcAbs = path.join(memAbs, 'archive');
    const ast = lstatOrNull(arcAbs);
    if (ast && ast.isDirectory() && !ast.isSymbolicLink()) {
      for (const e of readDirBounded(arcAbs, MAX_LIST).entries) {
        if (e.isFile() && e.name.endsWith('.jsonl')) {
          candidates.push(`archive/${e.name}`);
        }
      }
    }
    let entries = 0;
    const bad = [];
    for (const rel of candidates) {
      const abs = path.join(memAbs, ...rel.split('/'));
      const st = lstatOrNull(abs);
      if (!st) continue;
      if (st.isSymbolicLink() || !st.isFile()) {
        bad.push(`${rel}: not a regular file`);
        continue;
      }
      try {
        const l = readFileLimited(abs, loadLimits().maxDocumentBytes);
        if (l.exceeded) { bad.push(`${rel}: exceeds document limit`); continue; }
        const text = decodeUtf8Strict(
          l.content, 'WORKLOG_MALFORMED', rel);
        let line = 0;
        for (const raw of text.split('\n')) {
          if (!raw.trim()) continue;
          line += 1;
          try {
            const v = JSON.parse(raw);
            if (v === null || typeof v !== 'object'
                || Array.isArray(v)) throw 0;
          } catch {
            bad.push(`${rel}: malformed line ${line}`);
            break;
          }
        }
        entries += line;
      } catch { bad.push(`${rel}: unreadable`); }
    }
    if (bad.length === 0) {
      push('worklogs', true, `${entries} entries well-formed`);
    } else {
      for (const b of bad) push('worklogs', false, b);
    }
  }

  // Error-signature dedup: a failure signature repeating in recent
  // worklog entries means the same error keeps reoccurring — escalate
  // instead of letting it blend into the log (workflow.md stop-retry
  // rule made executable). Read-only: scans the bounded tail.
  {
    const tail = [];
    for (const name of ['activity', 'progress', 'outcomes']) {
      tail.push(...readWorklog(ctx, name, { tail: 200 }).entries);
    }
    const sigs = failureSignatures(tail);
    const repeated = [...sigs.entries()].filter(([, r]) => r.count >= 2);
    if (repeated.length === 0) {
      push('error-signatures', true,
        `${sigs.size} unique failure signature(s), none repeated`);
    } else {
      for (const [sig, r] of repeated
        .sort((a, b) => b[1].count - a[1].count).slice(0, 5)) {
        push('error-signatures', false,
          `signature repeated x${r.count}: ${sig.slice(0, 80)}`);
      }
    }
  }

  // Record-ownership sidecars: every stored sidecar is a JSON object.
  {
    const rel = `${config.paths.state}/record-ownership`;
    const abs = resolveInside(projectRoot, rel, 'record-ownership');
    const st = lstatOrNull(abs);
    if (!st) {
      push('record-ownership', true, 'no ownership sidecars');
    } else if (st.isSymbolicLink() || !st.isDirectory()) {
      push('record-ownership', false, `${rel} is not a directory`);
    } else {
      let ok = 0;
      const bad = [];
      for (const kind of readDirBounded(abs, MAX_LIST).entries) {
        if (!kind.isDirectory() || kind.isSymbolicLink()) continue;
        const kindAbs = path.join(abs, kind.name);
        for (const e of readDirBounded(kindAbs, MAX_LIST).entries) {
          if (!e.isFile() || !e.name.endsWith('.json')) continue;
          try {
            const f = path.join(kindAbs, e.name);
            const fst = lstatOrNull(f);
            if (!fst || fst.isSymbolicLink() || !fst.isFile()) throw 0;
            const l = readFileLimited(f, loadLimits().maxDocumentBytes);
            if (l.exceeded) throw 0;
            const doc = JSON.parse(decodeUtf8Strict(
              l.content, 'OWNERSHIP_MALFORMED', e.name));
            if (doc === null || typeof doc !== 'object'
                || Array.isArray(doc)) throw 0;
            ok += 1;
          } catch { bad.push(`${kind.name}/${e.name}`); }
        }
      }
      if (bad.length === 0) {
        push('record-ownership', true, `${ok} sidecars parse`);
      } else {
        push('record-ownership', false,
          `${bad.length} malformed: ${bad.slice(0, 5).join(', ')}`);
      }
    }
  }

  // VantaDB enrollment file: shape check only — never touches the
  // runtime (doctor's core must stay free of child_process/network).
  {
    const cd = ctx.configDir === '.' ? '' : `${ctx.configDir}/`;
    const rel = `${cd}vantadb.json`;
    const abs = resolveInside(projectRoot, rel, 'vantadb config');
    const st = lstatOrNull(abs);
    if (!st) {
      push('vantadb', true, 'not enrolled');
    } else if (st.isSymbolicLink() || !st.isFile()) {
      push('vantadb', false, `${rel} is not a regular file`);
    } else {
      try {
        const l = readFileLimited(abs, 65536);
        if (l.exceeded) {
          push('vantadb', false, `${rel} exceeds 64KiB`);
        } else {
          const doc = JSON.parse(decodeUtf8Strict(
            l.content, 'VANTADB_CONFIG_MALFORMED', rel));
          if (doc === null || typeof doc !== 'object' || Array.isArray(doc)
              || doc.schemaVersion !== 1) {
            push('vantadb', false, `${rel} has invalid fields`);
          } else {
            push('vantadb', true,
              `enrolled backend ${doc.backendId ?? '?'}`
              + ` v${doc.version ?? '?'}`);
          }
        }
      } catch (e) {
        push('vantadb', false, `${e.code}: ${e.message}`);
      }
    }
  }

  // Managed git hook presence is informational: hooks are opt-in, so
  // "absent" is a valid state, not a failure.
  {
    let hooksDir = null;
    try {
      hooksDir = gitHooksDir(ctx);
    } catch (e) {
      if (e.code === 'NOT_FOUND') {
        push('hooks', true, 'not a git worktree');
      } else {
        push('hooks', false, `.git unusable: ${e.message}`);
      }
    }
    if (hooksDir !== null) {
      const file = path.join(hooksDir, 'post-commit');
      const st = lstatOrNull(file);
      if (!st) {
        push('hooks', true, 'managed hook absent');
      } else if (st.isSymbolicLink() || !st.isFile()) {
        push('hooks', false, 'post-commit is not a regular file');
      } else {
        const l = readFileLimited(file, 65536);
        const text = l.exceeded ? '' : l.content.toString('latin1');
        push('hooks', true,
          text.includes('scopegrain-activity')
            ? 'managed hook installed'
            : 'post-commit exists without managed block');
      }
    }
  }

  // Stale locks: *.lock files under the state dir are classified with
  // the same rule the lock layer uses — a {t,pid,at} payload whose pid
  // is provably dead is reclaimable; a live pid is a real writer, never
  // broken; metadata-less payloads age out past the default TTL. Stale
  // findings are warnings: the next acquire reclaims them automatically.
  {
    const stateAbs = resolveInside(
      projectRoot, config.paths.state, 'state');
    const locks = [];
    const queue = [{ abs: stateAbs, rel: config.paths.state, depth: 0 }];
    let entriesSeen = 0;
    while (queue.length > 0 && entriesSeen < MAX_LIST) {
      const cur = queue.shift();
      const st = lstatOrNull(cur.abs);
      if (!st || !st.isDirectory() || st.isSymbolicLink()) continue;
      const { entries } = readDirBounded(cur.abs, MAX_LIST);
      entriesSeen += entries.length;
      for (const e of entries) {
        const rel = `${cur.rel}/${e.name}`;
        const abs = path.join(cur.abs, e.name);
        if (e.isDirectory() && !e.isSymbolicLink() && cur.depth < 3) {
          queue.push({ abs, rel, depth: cur.depth + 1 });
        } else if (e.isFile() && e.name.endsWith('.lock')) {
          locks.push({ abs, rel });
        }
      }
    }
    const stale = [];
    let held = 0;
    for (const { abs, rel } of locks) {
      const l = readFileLimited(abs, 4096);
      const text = l.exceeded ? '' : l.content.toString('utf8');
      let pid = null;
      try {
        const parsed = JSON.parse(text);
        if (Number.isSafeInteger(parsed?.pid) && parsed.pid > 0) {
          pid = parsed.pid;
        }
      } catch { /* legacy payload */ }
      if (pid !== null) {
        try {
          process.kill(pid, 0);
          held += 1;
        } catch (e) {
          if (e && e.code === 'EPERM') held += 1;
          else stale.push(`${rel}: dead pid ${pid}`);
        }
      } else {
        const st = lstatOrNull(abs);
        const age = st ? Date.now() - Number(st.mtimeMs) : 0;
        if (age > 60 * 60 * 1000) {
          stale.push(`${rel}: metadata-less, older than TTL`);
        } else {
          held += 1;
        }
      }
    }
    if (stale.length === 0) {
      push('stale-locks', true,
        locks.length === 0 ? 'no lock files' : `${held} held, none stale`);
    } else {
      push('stale-locks', false,
        `${stale.length} stale (auto-reclaimed on next acquire): `
        + `${stale.slice(0, 5).join(', ')}`, { severity: 'warning' });
    }
  }

  // Quoted-string literals that look like absolute paths (Windows drive,
  // UNC or POSIX root) — valid for JSON, JSONC and TOML basic strings,
  // which share the same escaping for the subset we emit.
  const QUOTED_STRING = /"((?:[^"\\]|\\.)*)"/g;
  const ABSOLUTE_PREFIX = /^([A-Za-z]:[\\/]|\\\\|\/)/;
  // Separator-equivalent comparison: hand-edited merges legitimately use
  // '/' where the generator emits '\\' on Windows — same path, false
  // divergence otherwise.
  const normalizeLit = (s) => s.replace(/\\/g, '/');
  const absoluteLiterals = (text) => {
    const out = new Set();
    for (const m of text.matchAll(QUOTED_STRING)) {
      let s;
      try { s = JSON.parse(`"${m[1]}"`); } catch { continue; }
      if (typeof s === 'string' && ABSOLUTE_PREFIX.test(s)) out.add(s);
    }
    return out;
  };

  // Merge targets disclosed by the activation plan (shared host config
  // files, never written by the harness): destination -> fragment
  // sources. Collected while evaluating host-fragments below, then
  // inspected by the host-merge-targets check.
  const mergeTargets = new Map();

  // Host-fragment drift: re-render the activation proposals for each
  // configured host and classify destinations. `conflict` means the
  // installed fragment diverges from what the current catalog+policy
  // would generate (local edit or tamper) — a failure, mirroring the
  // generated-files check. `create` entries are proposals never applied.
  {
    const hosts = Array.isArray(config.hosts) ? config.hosts : [];
    if (hosts.length === 0) {
      push('host-fragments', true, 'no hosts configured');
    } else {
      const details = [];
      const bad = [];
      // Multi-variant hosts (antigravity app-cli/ide) declare their
      // installable surfaces in policy/native-variants.json — evaluate
      // each surface separately; the unsurfaced plan intentionally errors
      // because the variants share destinations by design.
      let declaredVariants = {};
      try {
        declaredVariants = loadNativeVariants({ installRoot }).hosts ?? {};
      } catch { /* variants file absent: hosts emit no variants */ }
      try {
        for (const host of hosts) {
          const surfaces = (Array.isArray(declaredVariants[host])
              && declaredVariants[host].length > 0)
            ? declaredVariants[host].map((v) => v.id)
            : [null];
          for (const surface of surfaces) {
            const label = surface === null ? host : `${host}:${surface}`;
            try {
              const plan = prepareActivation(
                ctx, { host, surface: surface ?? undefined, installRoot });
              for (const s of plan.skipped) {
                if (s.reason !== 'requires manual merge into shared '
                    + 'host configuration'
                    || typeof s.destination !== 'string') continue;
                const set = mergeTargets.get(s.destination) ?? new Set();
                if (typeof s.source === 'string') set.add(s.source);
                mergeTargets.set(s.destination, set);
              }
              const c = { create: 0, noop: 0, conflict: 0 };
              const divergent = [];
              for (const f of plan.files) {
                c[f.action] = (c[f.action] ?? 0) + 1;
                if (f.action === 'conflict') divergent.push(f.rel);
              }
              details.push(`${label}: ${c.noop} ok, ${c.create} pending`
                + (c.conflict > 0 ? `, ${c.conflict} divergent` : ''));
              if (c.conflict > 0) {
                bad.push(`${label}: ${divergent.slice(0, 5).join(', ')}`);
              }
            } catch (e) {
              bad.push(`${label}: ${e.code ?? 'ERROR'}: ${e.message}`);
            }
          }
        }
      } catch (e) {
        bad.push(`cannot evaluate: ${e.code ?? e.message}`);
      }
      if (bad.length === 0) {
        push('host-fragments', true, details.join(' | '));
      } else {
        push('host-fragments', false,
          `${details.join(' | ')} — divergent: ${bad.join(' | ')}`);
      }
    }
  }

  // Manually-merged host config files (opencode.jsonc, .mcp.json,
  // .codex/config.toml, .devin/config.json): the declared merge targets
  // embed machine-local absolute paths generated for THIS machine.
  // host-fragments only sees whole-file applyable destinations — these
  // shared, hand-merged files are otherwise invisible. A literal that
  // resolves outside the current projectRoot is stale (project or
  // install relocated) and fails; a literal that differs from the
  // generated fragment marks a hand-edited merge — a warning, not
  // corruption.
  {
    if (mergeTargets.size === 0) {
      push('host-merge-targets', true, 'no merge targets declared');
    } else {
      const stale = [];
      const diverged = [];
      const pending = [];
      for (const [dest, sources] of mergeTargets) {
        let abs;
        try {
          abs = resolveInside(projectRoot, dest, 'merge target');
        } catch (e) {
          stale.push(`${dest}: ${e.code ?? 'INVALID_PATH'}`);
          continue;
        }
        const st = lstatOrNull(abs);
        if (!st) { pending.push(dest); continue; }
        if (st.isSymbolicLink() || !st.isFile()) {
          stale.push(`${dest}: not a regular file`);
          continue;
        }
        let limited;
        try {
          limited = readFileLimited(abs, loadLimits().maxDocumentBytes);
        } catch (e) {
          stale.push(`${dest}: ${e.code ?? 'READ_FAILED'}`);
          continue;
        }
        if (limited.exceeded) {
          stale.push(`${dest}: exceeds document limit`);
          continue;
        }
        const fragLits = new Set();
        for (const src of sources) {
          try {
            const sAbs = resolveInside(projectRoot, src, 'merge fragment');
            const sl = readFileLimited(sAbs, loadLimits().maxDocumentBytes);
            if (sl.exceeded) continue;
            for (const lit of absoluteLiterals(
              sl.content.toString('utf8'))) fragLits.add(normalizeLit(lit));
          } catch { /* fragment unavailable: nothing to compare against */ }
        }
        for (const lit of absoluteLiterals(
          limited.content.toString('utf8'))) {
          // Fragment literals are the ground truth for this machine: they
          // may legitimately resolve outside projectRoot (the server path
          // points at the installation, not the project).
          if (fragLits.has(normalizeLit(lit))) continue;
          if (!isInside(projectRoot, path.resolve(lit))) {
            stale.push(`${dest}: absolute path outside project root `
              + `and generated fragment: ${lit}`);
          } else {
            diverged.push(
              `${dest}: '${lit}' not present in generated fragment`);
          }
        }
      }
      const declared = [...mergeTargets.keys()].join(', ');
      const pendNote = pending.length > 0
        ? `; pending merge: ${pending.join(', ')}` : '';
      if (stale.length === 0 && diverged.length === 0) {
        push('host-merge-targets', true,
          `${mergeTargets.size} merge target(s) inspected (${declared})`
            + pendNote);
      } else {
        push('host-merge-targets', false,
          `${declared}${pendNote} — ${[...stale, ...diverged].join(' | ')}`,
          stale.length === 0 ? { severity: 'warning' } : {});
      }
    }
  }

  // Host CLI reachability is informational: probes PATH entries and
  // well-known install dirs without spawning anything. A missing CLI
  // never fails doctor — host fragments can be useful regardless — but
  // the per-host status is structured for consumers.
  {
    const hosts = Array.isArray(config.hosts) ? config.hosts : [];
    if (hosts.length === 0) {
      push('host-cli', true, 'no hosts configured');
    } else {
      const detected = detectHostClis(hosts);
      const missing = hosts.filter((h) => !detected[h].found);
      const found = hosts.filter((h) => detected[h].found);
      push('host-cli', true,
        missing.length === 0
          ? `all ${hosts.length} host CLIs on PATH or known locations`
          : `found: ${found.join(', ') || 'none'}; not found: `
            + missing.join(', '),
        { hosts: detected, missing });
    }
  }

  // Docs <-> CLI surface drift is a warning-level check: stale or
  // undocumented verbs never count as failures. Catalog command ids and
  // aliases are dispatchable verbs, so the install catalog (workspace
  // snapshot as fallback) extends the comparison set.
  {
    let driftCatalog = null;
    try {
      driftCatalog = loadCatalog({ installRoot });
    } catch {
      driftCatalog = workspace;
    }
    try {
      const drift = checkDocsCliDrift({
        projectRoot, installRoot, catalog: driftCatalog,
      });
      // Structured findings alongside the flattened `detail` text, in the
      // same shape the check emits (empty lists when the check passes or
      // skips): consumers diff programmatically instead of parsing text.
      const extra = {
        stale: drift.stale,
        undocumented: drift.undocumented,
        scannedDocs: drift.scannedDocs,
        flags: drift.flags,
        counts: drift.counts,
        parity: drift.parity,
      };
      if (drift.ok) {
        push('docs-cli-drift', true, drift.detail, extra);
      } else {
        push('docs-cli-drift', false, drift.detail,
          { severity: 'warning', ...extra });
      }
    } catch (e) {
      push('docs-cli-drift', false, `cannot evaluate: ${e.message}`,
        { severity: 'warning' });
    }
  }

  // Optional MCP server dependencies declared in package.json.
  // Resolved purely via filesystem walks (no child_process, no import).
  {
    const expected = ['@modelcontextprotocol/sdk', 'zod'];
    const hasPkg = (pkgName) => {
      const rootAbs = path.resolve(installRoot);
      const local = path.join(
        rootAbs, 'node_modules', ...pkgName.split('/'), 'package.json');
      const localSt = lstatOrNull(local);
      if (localSt && localSt.isFile()) return true;
      // Only walk upward when installRoot itself lives inside a node_modules
      // tree (hoisted npm install), never into arbitrary user home dirs.
      const parts = rootAbs.split(path.sep);
      if (!parts.includes('node_modules')) return false;
      let cur = path.dirname(rootAbs);
      for (let depth = 0; depth < 8; depth++) {
        const candidate = path.join(
          cur, 'node_modules', ...pkgName.split('/'), 'package.json');
        const st = lstatOrNull(candidate);
        if (st && st.isFile()) return true;
        const parent = path.dirname(cur);
        if (parent === cur) break;
        cur = parent;
      }
      return false;
    };
    const installed = expected.filter(hasPkg);
    const missing = expected.filter((p) => !installed.includes(p));
    // MCP server is optional (the CLI core runs with zero deps), so missing
    // MCP deps are reported structurally without degrading CLI-only readiness.
    push('mcp-deps', true,
      missing.length === 0
        ? `MCP dependencies installed (${installed.join(', ')})`
        : `optional MCP dependencies not installed: ${missing.join(', ')}`,
      { installed, missing, ready: missing.length === 0 });
  }

  // Viewer SPA build presence under installRoot/viewer/dist. Informational
  // (never fails ready status because the viewer is optional and the API
  // still serves /api/* without a built SPA).
  {
    const indexAbs = path.join(installRoot, 'viewer', 'dist', 'index.html');
    const st = lstatOrNull(indexAbs);
    const built = !!st && st.isFile();
    push('viewer-build', true,
      built
        ? 'viewer/dist/index.html present'
        : 'viewer/dist not built (API-only; run npm run build in viewer/)',
      { built });
  }

  // User artifacts integrity: optional <configDir>/context.md plus JSON
  // records under user-owned artifact stores (tasks, plans, specs, designs,
  // reports, approvals). Bounded, read-only, rejects symlinks and bad JSON.
  {
    const limits = loadLimits();
    const bad = [];
    let checked = 0;
    const cap = 500;
    const contextRel = ctx.configDir === '.'
      ? 'context.md' : `${ctx.configDir}/context.md`;
    let contextAbs = null;
    try { contextAbs = resolveInside(projectRoot, contextRel, 'doctor:context.md'); }
    catch { contextAbs = null; }
    const ctxSt = contextAbs ? lstatOrNull(contextAbs) : null;
    if (ctxSt) {
      checked++;
      if (ctxSt.isSymbolicLink() || !ctxSt.isFile()) {
        bad.push('context.md: not a regular file');
      } else {
        try {
          const lim = readFileLimited(contextAbs, limits.maxDocumentBytes);
          if (lim.exceeded) {
            bad.push('context.md: DOCUMENT_TOO_LARGE');
          } else {
            decodeUtf8Strict(lim.content, 'INVALID_UTF8', 'context.md');
          }
        } catch (e) {
          bad.push(`context.md: ${e.code ?? e.message}`);
        }
      }
    }
    const scanDirs = [
      { label: 'tasks', rel: config.paths.tasks },
      { label: 'plans', rel: config.paths.plans },
      { label: 'specs', rel: `${config.paths.plans}/specs` },
      { label: 'designs', rel: `${config.paths.plans}/designs` },
      { label: 'reports', rel: config.paths.reports },
      { label: 'approvals', rel: `${config.paths.decisions}/approvals` },
    ];
    for (const { label, rel } of scanDirs) {
      if (checked >= cap) break;
      let dirAbs;
      try { dirAbs = resolveInside(projectRoot, rel, `doctor:${label}`); }
      catch { continue; }
      const st = lstatOrNull(dirAbs);
      if (!st || !st.isDirectory()) continue;
      let entries;
      try { entries = readDirBounded(dirAbs, cap - checked).entries; }
      catch (e) { bad.push(`${label}: ${e.code ?? e.message}`); continue; }
      for (const e of entries) {
        if (checked >= cap) break;
        if (!e.name.endsWith('.json')) continue;
        checked++;
        const fAbs = path.join(dirAbs, e.name);
        if (e.isSymbolicLink() || !e.isFile()) {
          bad.push(`${label}/${e.name}: not a regular file`);
          continue;
        }
        try {
          const lim = readFileLimited(fAbs, limits.maxDocumentBytes);
          if (lim.exceeded) {
            bad.push(`${label}/${e.name}: DOCUMENT_TOO_LARGE`);
            continue;
          }
          const raw = decodeUtf8Strict(
            lim.content, 'INVALID_UTF8', `${label}/${e.name}`);
          const parsed = JSON.parse(raw);
          if (parsed === null || typeof parsed !== 'object'
              || Array.isArray(parsed)) {
            bad.push(`${label}/${e.name}: not a JSON object`);
          }
        } catch (err2) {
          bad.push(`${label}/${e.name}: ${err2.code ?? 'MALFORMED_JSON'}`);
        }
      }
    }
    if (bad.length === 0) {
      push('user-artifacts', true,
        checked === 0
          ? 'no user artifacts yet'
          : `${checked} user artifact(s) valid`,
        { checked });
    } else {
      push('user-artifacts', false,
        `${bad.length} malformed user artifact(s): ${bad.slice(0, 5).join('; ')}`,
        { checked, malformed: bad.slice(0, 20) });
    }
  }

  // Optional global user config (~/.config/scopegrain/config.json). Never
  // overrides workspace config; malformed global file surfaces as warning.
  {
    try {
      const uc = loadUserConfig();
      push('user-config', true,
        uc.exists
          ? `valid user defaults at ${uc.path} (workspace always takes precedence)`
          : 'no global user config (using workspace/policy defaults)',
        { path: uc.path, exists: uc.exists, source: uc.source });
    } catch (e) {
      push('user-config', false,
        `malformed global user config: ${e.code ?? 'ERROR'}: ${e.message}`,
        { severity: 'warning' });
    }
  }

  let current = null;
  try {
    current = inspectProject(projectRoot);
  } catch (e) {
    warnings.push(`discovery failed: ${e.message}`);
  }
  if (current) {
    for (const w of current.warnings) {
      warnings.push(`discovery:${w.code} ${w.message}`);
    }
  }
  const changedDiscovery = !!current
    && current.fingerprint !== config.discovery.fingerprint;
  let discoveryDiff = null;
  if (changedDiscovery) {
    warnings.push('manifest fingerprint changed since init; repair: '
      + '`scopegrain init --project . --apply` re-pins discovery');
    try {
      discoveryDiff = diffInvestigation(
        config, investigateProject(projectRoot, { config }));
    } catch {
      discoveryDiff = null;
    }
    if (discoveryDiff) {
      for (const d of discoveryDiff.staleDecisions) {
        warnings.push(`stale decision: ${d}`);
      }
    }
  }

  // summary partitions the outcome so consumers can distinguish "checks
  // failed" from "checks passed but warnings exist" without parsing the
  // status string: every failed check produces exactly one warnings[]
  // entry, so warnings.length - failureCount is the pure warning count.
  // status is unchanged: 'needs-attention' whenever warnings exist.
  const ok = warnings.length === 0;
  return {
    schemaVersion: 1,
    status: ok ? 'ready' : 'needs-attention',
    summary: {
      ok: checks.filter((c) => c.ok).length,
      warnings: warnings.length - failureCount,
      failures: failureCount,
    },
    changedDiscovery,
    discoveryDiff,
    upgradeAvailable,
    checks,
    warnings,
  };
}
