// Version Manager: git branches/worktrees for experiments, annotated tags for
// accepted versions, non-destructive rollback. Never force-pushes or rewrites history.
import { runProcess } from '../core/process.js';

export const STABLE_BRANCH = 'main';
const TAG_PREFIX = 'era-v';

export async function git(cwd, args, { allowFail = false } = {}) {
  const r = await runProcess('git', args, { cwd, timeoutMs: 120_000 });
  if (r.exitCode !== 0 && !allowFail) {
    throw new Error(`git ${args.join(' ')} failed: ${(r.stderr || r.stdout).trim()}`);
  }
  return { code: r.exitCode, stdout: r.stdout.trim(), stderr: r.stderr.trim() };
}

export async function repoRoot(cwd) {
  const r = await git(cwd, ['rev-parse', '--show-toplevel'], { allowFail: true });
  return r.code === 0 ? r.stdout : null;
}

export async function currentBranch(cwd) {
  const r = await git(cwd, ['symbolic-ref', '--short', 'HEAD'], { allowFail: true });
  return r.code === 0 ? r.stdout : null;
}

export async function headCommit(cwd, ref = 'HEAD') {
  return (await git(cwd, ['rev-parse', ref])).stdout;
}

export async function isClean(cwd) {
  return (await git(cwd, ['status', '--porcelain'])).stdout === '';
}

export async function listVersions(cwd) {
  const r = await git(cwd, ['for-each-ref', '--sort=creatordate', '--format=%(refname:short)%09%(objectname:short)%09%(*objectname:short)%09%(creatordate:iso8601)%09%(contents:subject)', `refs/tags/${TAG_PREFIX}*`]);
  return r.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [tag, obj, target, date, subject] = line.split('\t');
      return { tag, commit: target || obj, date, subject, number: Number(tag.slice(TAG_PREFIX.length)) };
    })
    .sort((a, b) => a.number - b.number);
}

export async function currentVersion(cwd) {
  const r = await git(cwd, ['describe', '--tags', '--match', `${TAG_PREFIX}*`, '--abbrev=0'], { allowFail: true });
  return r.code === 0 ? r.stdout : null;
}

export async function nextVersionTag(cwd) {
  const versions = await listVersions(cwd);
  const max = versions.reduce((m, v) => Math.max(m, Number.isFinite(v.number) ? v.number : 0), 0);
  return `${TAG_PREFIX}${max + 1}`;
}

export async function tagVersion(cwd, tag, message) {
  await git(cwd, ['tag', '-a', tag, '-m', message]);
  return tag;
}

export async function assertStable(cwd) {
  const branch = await currentBranch(cwd);
  if (branch !== STABLE_BRANCH) throw new Error(`Self-improvement must run from the stable branch "${STABLE_BRANCH}" (current: ${branch}).`);
  if (!(await isClean(cwd))) throw new Error('The stable checkout has uncommitted changes; commit or stash them first.');
}

export async function createExperimentWorktree(cwd, { id, path, baseCommit }) {
  const branch = `experiment/${id}`;
  await git(cwd, ['worktree', 'add', '-b', branch, path, baseCommit]);
  return { branch, path };
}

export async function removeWorktree(cwd, path) {
  await git(cwd, ['worktree', 'remove', '--force', path], { allowFail: true });
  await git(cwd, ['worktree', 'prune'], { allowFail: true });
}

export async function commitAll(cwd, message) {
  await git(cwd, ['add', '-A']);
  const staged = await git(cwd, ['diff', '--cached', '--quiet'], { allowFail: true });
  if (staged.code === 0) return null;
  await git(cwd, ['commit', '-m', message]);
  return headCommit(cwd);
}

export async function commitsAhead(cwd, base, branch) {
  return Number((await git(cwd, ['rev-list', '--count', `${base}..${branch}`])).stdout);
}

export async function changedFiles(cwd, base, branch) {
  const r = await git(cwd, ['diff', '--name-only', `${base}...${branch}`]);
  return r.stdout.split('\n').filter(Boolean);
}

export async function diffStat(cwd, base, branch) {
  return (await git(cwd, ['diff', '--stat', `${base}...${branch}`])).stdout;
}

export async function promote(cwd, branch, message) {
  await assertStable(cwd);
  await git(cwd, ['merge', '--no-ff', '-m', message, branch]);
  return headCommit(cwd);
}

// Restores the tree of an earlier version as a new commit on the stable branch.
export async function rollbackTo(cwd, tag) {
  await assertStable(cwd);
  const versions = await listVersions(cwd);
  if (!versions.some((v) => v.tag === tag)) throw new Error(`Unknown version "${tag}". Known: ${versions.map((v) => v.tag).join(', ') || 'none'}`);
  await git(cwd, ['restore', `--source=${tag}`, '--staged', '--worktree', '--', '.']);
  const commit = await commitAll(cwd, `rollback: restore ${tag}`);
  return { commit, unchanged: commit === null };
}
