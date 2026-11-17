// Read-only health check: validates config, paths, generated file CONTENTS,
// installed templates, discovery freshness and warnings. Executes nothing
// and never asserts that a host or service is installed.
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { decodeUtf8Strict, lstatOrNull, readFileLimited } from './fsx.mjs';
import { resolveInside } from './paths.mjs';
import { PATH_KEYS, configDirOf } from './config.mjs';
import { inspectProject } from '../discovery/inspect.mjs';
import { buildInitPlan, INSTALL_ROOT } from './bootstrap.mjs';
import {
  catalogFiles, checkCatalog, loadWorkspaceCatalog,
} from './catalog.mjs';
import { loadLimits } from './policy.mjs';
import { validateWorkspace, workspaceFileRel } from './workspaces.mjs';

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

  const push = (name, ok, detail) => {
    checks.push({ name, ok, detail });
    if (!ok) warnings.push(`${name}: ${detail}`);
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
      const snapshotManifest = {
        schemaVersion: workspace.snapshotVersion,
        entries: workspace.entries.map((e) => ({
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
      let same;
      try {
        same = bytesEqualOnDisk(abs, f.content, {
          allowCRLF: f.rel === 'AGENTS.md' || f.rel === 'CLAUDE.md',
        });
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
        push('journal', true, 'no recorded operations');
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
  if (changedDiscovery) {
    warnings.push('manifest fingerprint changed since init; consider re-discovery');
  }

  const ok = warnings.length === 0;
  return {
    schemaVersion: 1,
    status: ok ? 'ready' : 'needs-attention',
    changedDiscovery,
    upgradeAvailable,
    checks,
    warnings,
  };
}
