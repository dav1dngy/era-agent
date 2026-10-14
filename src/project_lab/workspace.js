// Isolated, reversible working copies (Project Lab).
//
// The original project is never modified by any operation. Each run works in a
// copy under <stateDir>/projects/<id>/work/<run>. The copy is a fresh git
// repository (independent of whether the source uses git), so every change is a
// reviewable diff against the "baseline" commit. Approved changes reach the
// original only as a patch, applied after verifying that the original has not
// changed since the run began, and can be reversed with the same patch.
import { createHash } from 'node:crypto';
import { copyFileSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { runProcess } from '../core/process.js';
import { removeTree } from '../core/util.js';
import { SafetyError } from '../safety/policy.js';

// Never copied into a working copy, never part of a digest.
export const IGNORED_DIRS = new Set(['.git', '.hg', '.svn', 'node_modules', '.era', '__pycache__', '.venv', 'venv', '.tox', '.mypy_cache', '.pytest_cache', 'target', 'dist', 'build', '.next', '.gradle', '.idea', '.vscode', 'coverage']);

export function walkFiles(root, { onSkip = () => {} } = {}) {
  const out = [];
  const visit = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      if (IGNORED_DIRS.has(name)) continue;
      const full = join(dir, name);
      const st = lstatSync(full);
      if (st.isDirectory()) visit(full);
      else if (st.isSymbolicLink()) out.push({ rel: relative(root, full), type: 'symlink', full });
      else if (st.isFile()) out.push({ rel: relative(root, full), type: 'file', size: st.size, mode: st.mode & 0o777, full });
      else onSkip(full, 'special file');
    }
  };
  visit(root);
  return out;
}

// Content digest of a project tree (ignores IGNORED_DIRS). Used to prove the
// original project was not touched and to bind approval to the state the run saw.
export function treeDigest(root) {
  const h = createHash('sha256');
  const files = walkFiles(root);
  for (const f of files) {
    h.update(`${f.type}\0${f.rel}\0`);
    if (f.type === 'symlink') h.update(readlinkSync(f.full));
    else h.update(`${f.mode}\0`).update(readFileSync(f.full));
    h.update('\n');
  }
  return { sha256: h.digest('hex'), files: files.length, bytes: files.reduce((s, f) => s + (f.size ?? 0), 0) };
}

// Complete inventory of a directory for deletion safety: EVERY path (nothing is ignored, including .git, build, dist and
// node_modules), symlinks are recorded and never followed. treeDigest() is a source-copy digest that deliberately skips
// generated directories; it must never be used to justify deleting a tree.
export function fullManifest(root) {
  const entries = [];
  const visit = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const rel = relative(root, full);
      const st = lstatSync(full);
      if (st.isSymbolicLink()) entries.push({ path: rel, type: 'symlink', target: readlinkSync(full) });
      else if (st.isDirectory()) {
        entries.push({ path: rel, type: 'dir' });
        visit(full);
      } else if (st.isFile()) entries.push({ path: rel, type: 'file', mode: st.mode & 0o777, size: st.size, sha256: createHash('sha256').update(readFileSync(full)).digest('hex') });
      else entries.push({ path: rel, type: 'special' });
    }
  };
  visit(root);
  return entries;
}

export const manifestSha256 = (entries) => createHash('sha256').update(JSON.stringify(entries)).digest('hex');

// What differs between an expected and the current manifest (paths only).
export function manifestDiff(expected, actual) {
  const key = (e) => JSON.stringify(e);
  const exp = new Map(expected.map((e) => [e.path, key(e)]));
  const act = new Map(actual.map((e) => [e.path, key(e)]));
  const added = [...act.keys()].filter((p) => !exp.has(p));
  const removed = [...exp.keys()].filter((p) => !act.has(p));
  const modified = [...act.keys()].filter((p) => exp.has(p) && exp.get(p) !== act.get(p));
  return { added, removed, modified, same: !added.length && !removed.length && !modified.length };
}

// Copies the project into `dest`, refusing oversized trees, and never following
// symlinks (links that leave the tree are skipped and reported).
export function copyProject(src, dest, { maxBytes, maxFiles, exclude = null }) {
  const skipped = [];
  const excluded = [];
  const files = walkFiles(src, { onSkip: (p, why) => skipped.push({ path: relative(src, p), reason: why }) }).filter((f) => {
    const why = exclude?.(f.rel) ?? null;
    if (why) excluded.push({ path: f.rel, reason: why });
    return !why;
  });
  if (files.length > maxFiles) throw new Error(`Project has ${files.length} files (limit ${maxFiles}); raise limits.maxCopyFiles or exclude generated files.`);
  const bytes = files.reduce((s, f) => s + (f.size ?? 0), 0);
  if (bytes > maxBytes) throw new Error(`Project is ${bytes} bytes (limit ${maxBytes}); raise limits.maxCopyBytes or exclude generated files.`);
  const realSrc = realpathSync(src);
  mkdirSync(dest, { recursive: true });
  for (const f of files) {
    const target = join(dest, f.rel);
    mkdirSync(dirname(target), { recursive: true });
    if (f.type === 'symlink') {
      const link = readlinkSync(f.full);
      const resolved = resolve(realpathSync(dirname(f.full)), link);
      if (link.startsWith('/') || !resolved.startsWith(realSrc + sep)) {
        skipped.push({ path: f.rel, reason: 'symlink leaves the project' });
        continue;
      }
      symlinkSync(link, target);
    } else {
      copyFileSync(f.full, target);
    }
  }
  return { files: files.length, bytes, skipped, excluded };
}

// ---- git, strictly confined to the working copy
const GIT_IDENTITY = { GIT_AUTHOR_NAME: 'ERA Project Lab', GIT_AUTHOR_EMAIL: 'project-lab@era.invalid', GIT_COMMITTER_NAME: 'ERA Project Lab', GIT_COMMITTER_EMAIL: 'project-lab@era.invalid' };
const GIT_CONFIG = ['-c', 'core.excludesFile=/dev/null', '-c', 'core.autocrlf=false', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'core.quotePath=false'];

// Every git command for a working copy runs with GIT_CEILING_DIRECTORIES so git
// can never walk up into another repository (for example ERA's own).
export async function wgit(dir, args, { allowFail = false, input = null } = {}) {
  const env = { ...process.env, ...GIT_IDENTITY, GIT_CEILING_DIRECTORIES: dirname(resolve(dir)), GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  const r = await runProcess('git', [...GIT_CONFIG, ...args], { cwd: dir, env, timeoutMs: 120_000, input });
  if (r.exitCode !== 0 && !allowFail) throw new Error(`git ${args.slice(0, 3).join(' ')} failed in ${basename(dir)}: ${(r.stderr || r.stdout).trim().slice(0, 500)}`);
  return { code: r.exitCode, stdout: r.stdout, stderr: r.stderr };
}

async function assertOwnRepo(dir) {
  const top = (await wgit(dir, ['rev-parse', '--show-toplevel'])).stdout.trim();
  if (realpathSync(top) !== realpathSync(dir)) throw new SafetyError(`Refusing to run git: ${dir} is not its own repository (git resolved ${top}).`);
}

export async function initBaseline(dir, message = 'baseline') {
  await wgit(dir, ['init', '-q', '-b', 'main']);
  await assertOwnRepo(dir);
  await wgit(dir, ['add', '-A', '--force']);
  await wgit(dir, ['commit', '-q', '--allow-empty', '-m', message]);
  return (await wgit(dir, ['rev-parse', 'HEAD'])).stdout.trim();
}

export async function workspaceChanges(dir, baseline) {
  await assertOwnRepo(dir);
  await wgit(dir, ['add', '-A', '--force']);
  const status = (await wgit(dir, ['diff', '--cached', '--name-status', '--no-renames', baseline])).stdout.trim();
  const files = status ? status.split('\n').map((l) => ({ status: l[0], path: l.slice(2).trim() })) : [];
  const patch = (await wgit(dir, ['diff', '--cached', '--binary', '--no-renames', baseline])).stdout;
  const stat = (await wgit(dir, ['diff', '--cached', '--stat', '--no-renames', baseline])).stdout.trim();
  return { files, patch, stat };
}

export const patchSha256 = (changes) => createHash('sha256').update(changes.patch).digest('hex');

// Commits the current workspace state (used to checkpoint agent attempts).
export async function checkpoint(dir, message) {
  await assertOwnRepo(dir);
  await wgit(dir, ['add', '-A', '--force']);
  await wgit(dir, ['commit', '-q', '--allow-empty', '-m', message]);
  return (await wgit(dir, ['rev-parse', 'HEAD'])).stdout.trim();
}

// Applies a patch to the ORIGINAL project (no repository discovery above it).
export async function applyPatch(target, patchFile, { reverse = false, check = false } = {}) {
  const args = ['apply', '--whitespace=nowarn', ...(reverse ? ['-R'] : []), ...(check ? ['--check'] : []), patchFile];
  return wgit(target, args, { allowFail: true });
}

export function removeWorkspace(dir) {
  return removeTree(dir);
}

export function writePatch(file, patch) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, patch);
}

// Minimal glob matcher for `protected` patterns: ** (any depth), * (no slash), ? .
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (i === glob.length - 1) re += '.*';
        else {
          if (glob[i + 1] === '/') i++;
          re += '(?:.*/)?';
        }
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

// Files that may never change, whatever the project configuration says.
export const ALWAYS_PROTECTED = ['.git/**', '.era/**'];

export function protectedViolations(changedPaths, patterns) {
  const regs = [...ALWAYS_PROTECTED, ...patterns].map((g) => [g, globToRegExp(g.endsWith('/') ? `${g}**` : g)]);
  return changedPaths.filter((p) => regs.some(([, re]) => re.test(p) || re.test(`${p}/`)));
}

