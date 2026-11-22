// SPDX-License-Identifier: Apache-2.0
// Evidence-only risk classifier over a unified diff. Pure module: no fs,
// no git, no child_process. The core deliberately spawns nothing — the
// operator supplies diff bytes (e.g. `git diff > out.patch`) and this
// module derives risk signals from paths, modes and added content only.
// Signal, not authority: output feeds the operator's methodology
// assessment; it never decides or overrides it. Fail-closed: undecidable
// input can raise the tier, never lower it.

const BYTE_CAP = 8 * 1024 * 1024;
const LINE_CAP = 400_000;

// --- signal tables -------------------------------------------------------

const SECURITY_PATH = /(?:^|\/)(?:auth|security|secrets?|credentials?|tokens?|permissions?|crypto|passwords?)(?:\/|\.|_|-)/i;
const SHELL_SOURCE = /\.(?:sh|bash|zsh|fish|ps1|psm1|bat|cmd)$/i;
const CI_WORKFLOW = /(?:^|\/)\.(?:github\/workflows|gitlab-ci\.|circleci|buildkite)|(?:^|\/)(?:azure-pipelines[^/]*\.ya?ml|\.travis\.yml|\.drone\.yml|bitbucket-pipelines\.yml|cloudbuild[^/]*\.(?:ya?ml|json))|Jenkinsfile/i;
const DELIVERY_PATH = /(?:^|\/)(?:Dockerfile[^/]*|docker-compose[^/]*|deploy(?:ment)?s?\/|install(?:er)?s?\/|releases?\/|helm\/|charts\/|terraform\/|k8s\/)/i;
const MIGRATION_PATH = /(?:^|\/)(?:migrations?|migrate|dbmigrate|alembic|flyway|liquibase)(?:\/|\.|_|-)/i;
const CONTRACT_PATH = /(?:^|\/)resources\/manifest\.json$|(?:^|\/)schemas?\/|(?:^|\/)api(?:s)?\/|\.proto$|openapi[^/]*\.(?:ya?ml|json)$|(?:^|\/)package\.json$|(?:^|\/)go\.mod$|(?:^|\/)Cargo\.toml$/i;
const PASSIVE_EXT = /\.(?:md|markdown|rst|adoc|txt|org|tex)$/i;
const DOC_DIRS = /(?:^|\/)(?:docs?|documentation|wiki)(?:\/|$)|(?:^|\/)(?:CHANGELOG[^/]*|LICENSE[^/]*|NOTICE[^/]*)$/i;

// Process-boundary patterns scanned in ADDED lines only. The exclusion
// list exists so documented safe matches (regex exec, db exec) do not
// trip the signal — extend it only with a comment naming the safe API.
const PROCESS_BOUNDARY = new RegExp(
  '(?:child_process|spawn\\s*\\(|spawnSync|execFile|execSync|os\\.system'
  + '|subprocess\\.|ProcessBuilder|posix_spawn|Process\\.Start|popen\\s*\\('
  + '|Runtime\\.getRuntime|\\.exec\\s*\\(|fork\\s*\\(|execvp|CreateProcess'
  + '|(?<![\\w.])exec\\s*\\(|(?<![\\w.])system\\s*\\()', '');
// Global so replace() strips every excluded call on a line, not just the
// first — a line like `db.exec(q); spawn(c)` must still flag `spawn`.
const PROCESS_EXCLUDE =
  /(?:\b(?:re|regexp|db|sql|conn)\.exec|\.execSql|\.execQuery)/gi;

const SHEBANG = /^#!/;
// Any odd octal digit in the last three positions means an execute bit is
// set somewhere (owner/group/other) — e.g. 100755, 100775, 671.
const EXEC_MODE = /[1357][0-9]{0,2}$/;
const CONCURRENCY_HINT = /(?:\bmutex\b|\brwlock\b|\batomic|\bthread\b|goroutine|go\s+func|async\s+def|Promise\.all|race\s+condition|channel\s*<-|Semaphore|CountDownLatch)/i;

// --- unified-diff parser -------------------------------------------------

// Parses the subset of unified diff needed for classification: file
// headers, mode changes, binary markers and added/removed line counts and
// content. Malformed hunks are tolerated: unknown bytes simply cannot
// prove passive. Each hunk's declared line counts (@@ -a,b +c,d @@) are
// validated against the lines actually consumed — a truncated or
// overstated hunk makes the file undecidable, never passive.
const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseUnifiedDiff(text) {
  const files = [];
  let cur = null;
  let hunk = null;
  const closeHunk = () => {
    if (hunk && (hunk.gotOld !== hunk.old || hunk.gotNew !== hunk.new)) {
      cur.malformed = true;
    }
    hunk = null;
  };
  // Normalise CRLF so anchors ($) and header prefixes still match when a
  // Windows editor or PowerShell re-saves the diff.
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (m) {
      if (cur) closeHunk();
      cur = { path: m[2], oldPath: m[1], oldMode: null, newMode: null,
        added: 0, removed: 0, addedLines: [], binary: false,
        malformed: false };
      files.push(cur);
      continue;
    }
    if (!cur) continue;
    if (line.startsWith('@@ ')) {
      const h = HUNK_RE.exec(line);
      if (h) {
        closeHunk();
        hunk = { old: h[2] === undefined ? 1 : parseInt(h[2], 10),
          new: h[4] === undefined ? 1 : parseInt(h[4], 10),
          gotOld: 0, gotNew: 0 };
      } else {
        // A hunk-shaped line without parseable counts cannot prove
        // anything — fail closed, same as a truncated hunk.
        closeHunk();
        cur.malformed = true;
      }
      continue;
    }
    if (!hunk) {
      if (line.startsWith('old mode ')) cur.oldMode = line.slice(9).trim();
      else if (line.startsWith('new mode ')) {
        cur.newMode = line.slice(10).trim();
      } else if (line.startsWith('new file mode ')) {
        cur.newMode = line.slice(14).trim();
      } else if (line.startsWith('deleted file mode ')) {
        cur.oldMode = line.slice(18).trim();
      } else if (line.startsWith('Binary files')
          || line.startsWith('GIT binary patch')) {
        cur.binary = true;
      } else if (line.startsWith('rename to ')) {
        cur.path = line.slice(10).trim();
      } else if (line.startsWith('rename from ')) {
        cur.oldPath = line.slice(12).trim();
      } else if ((line.startsWith('+') && !line.startsWith('+++'))
          || (line.startsWith('-') && !line.startsWith('---'))) {
        // Content-shaped lines outside any hunk mean the diff is malformed
        // (e.g. an empty line ended hunk tracking) — they cannot prove
        // passive, so the file is marked undecidable.
        cur.malformed = true;
      }
      continue;
    }
    // Inside a hunk every +/- line is content — including literal `+++i;`
    // or `---x` payloads, which is why header parsing stays above.
    if (line.startsWith('+')) {
      cur.added += 1;
      cur.addedLines.push(line.slice(1));
      hunk.gotNew += 1;
    } else if (line.startsWith('-')) {
      cur.removed += 1;
      hunk.gotOld += 1;
    } else if (line.startsWith(' ')) {
      hunk.gotOld += 1;
      hunk.gotNew += 1;
    } else if (!line.startsWith('\\')) {
      closeHunk();
    }
  }
  if (cur) closeHunk();
  return { files };
}

// --- classifier ----------------------------------------------------------

const reason = (signal, file, detail) => ({ signal, path: file, detail });

export function classifyRisk(parsed) {
  const files = Array.isArray(parsed?.files) ? parsed.files : [];
  const reasons = [];
  let changedLines = 0;
  let contentBytes = 0;
  let allPassive = files.length > 0;

  for (const f of files) {
    changedLines += f.added + f.removed;
    const joined = f.addedLines.join('\n');
    contentBytes += Buffer.byteLength(joined, 'utf8');

    // Path signals check both sides of a rename: src/auth/x.js -> docs/x.md
    // must not shed its security signal by moving into a passive-looking
    // path.
    const signalPaths = f.oldPath && f.oldPath !== f.path
      ? [f.path, f.oldPath] : [f.path];
    const hitPath = (re) => signalPaths.find((p) => re.test(p));
    const securityPath = hitPath(SECURITY_PATH);
    if (securityPath !== undefined) {
      reasons.push(reason('security', securityPath,
        'path touches security/auth/credential surface'));
    }
    const ciPath = hitPath(CI_WORKFLOW);
    if (ciPath !== undefined) {
      reasons.push(reason('delivery', ciPath,
        'CI/workflow definition changed'));
    }
    const deliveryPath = hitPath(DELIVERY_PATH);
    if (deliveryPath !== undefined) {
      reasons.push(reason('delivery', deliveryPath,
        'delivery/installer/deploy artifact changed'));
    }
    const migrationPath = hitPath(MIGRATION_PATH);
    if (migrationPath !== undefined) {
      reasons.push(reason('data-integrity', migrationPath,
        'migration or persisted-format path changed'));
    }
    const contractPath = hitPath(CONTRACT_PATH);
    if (contractPath !== undefined) {
      reasons.push(reason('public-contract', contractPath,
        'public contract manifest/schema/api path changed'));
    }
    const shellPath = hitPath(SHELL_SOURCE);
    if (shellPath !== undefined) {
      reasons.push(reason('delivery', shellPath,
        'executable shell source changed'));
    }
    if (f.newMode && EXEC_MODE.test(f.newMode)) {
      reasons.push(reason('executable-mode', f.path,
        `mode set to ${f.newMode}`));
    }
    if (f.binary) {
      reasons.push(reason('undecidable', f.path,
        'binary content cannot be inspected'));
    }
    if (f.malformed) {
      reasons.push(reason('undecidable', f.path,
        'diff lines outside any hunk — malformed input'));
    }
    const hit = f.addedLines.find((l) =>
      PROCESS_BOUNDARY.test(l.replace(PROCESS_EXCLUDE, '')));
    if (hit !== undefined) {
      reasons.push(reason('process-boundary', f.path,
        `added process-boundary call: ${hit.trim().slice(0, 80)}`));
    }
    if (CONCURRENCY_HINT.test(joined)) {
      reasons.push(reason('concurrency', f.path,
        'added concurrency primitives or shared-state hints'));
    }

    // Passive proof: every file must be provably passive on its own bytes.
    const passivePath = PASSIVE_EXT.test(f.path) || DOC_DIRS.test(f.path);
    const execMode = f.newMode && EXEC_MODE.test(f.newMode);
    const hasShebang = f.addedLines.some((l) => SHEBANG.test(l));
    const hasNul = joined.includes(String.fromCharCode(0));
    if (!passivePath || f.binary || execMode || hasShebang || hasNul) {
      allPassive = false;
    }
  }

  if (contentBytes > BYTE_CAP) {
    allPassive = false;
    reasons.push(reason('byte-cap', null,
      `added content ${contentBytes} exceeds scan cap ${BYTE_CAP}`));
  }
  if (changedLines > LINE_CAP) {
    allPassive = false;
    reasons.push(reason('line-cap', null,
      `changed lines ${changedLines} exceeds ${LINE_CAP}`));
  }
  if (files.length === 0) {
    reasons.push(reason('undecidable', null,
      'no changed files parsed — empty or malformed diff'));
  }

  const HIGH = new Set(['security', 'delivery', 'data-integrity',
    'public-contract', 'process-boundary', 'executable-mode',
    'undecidable', 'byte-cap', 'line-cap']);
  const tier = reasons.some((r) => HIGH.has(r.signal)) ? 'high'
    : allPassive ? 'passive' : 'medium';

  reasons.sort((a, b) => a.signal.localeCompare(b.signal)
    || String(a.path ?? '').localeCompare(String(b.path ?? '')));

  return {
    risk: tier,
    reasons,
    changed_paths: files.map((f) => f.path),
    changed_lines: changedLines,
    review_due: tier === 'high'
      ? { value: true, reason: 'high_risk' }
      : tier === 'medium'
        ? { value: false, reason: 'under_budget' }
        : { value: false, reason: 'passive' },
  };
}
