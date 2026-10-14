// Sandbox for executing untrusted native targets during runtime capture.
// macOS: sandbox-exec (Seatbelt) profile that denies all network access and
// all filesystem writes except a per-analysis scratch directory, /dev/null and
// terminals. sandbox-exec is deprecated by Apple but functional; Seatbelt is
// the same kernel mechanism App Sandbox uses. Git worktrees and REA's process
// capture are NOT sandboxes. Other platforms report no sandbox.
import { existsSync, realpathSync, mkdirSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SANDBOX_EXEC = '/usr/bin/sandbox-exec';

// Inside a candidate sandbox, sandbox-exec cannot be nested (sandbox_apply: EPERM).
export function sandboxAvailable(platform = process.platform, env = process.env) {
  return platform === 'darwin' && !env.ERA_IN_CANDIDATE_SANDBOX && existsSync(SANDBOX_EXEC);
}

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const real = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
};

// Process control: a sandboxed command may signal itself and the processes that share its sandbox (its own children),
// and nothing else. Without this rule any build or test script can SIGTERM the user's other programs.
export const SIGNAL_RULES = ['(deny signal)', '(allow signal (target self) (target same-sandbox))'];

// Read confinement. The profiles start from `(allow default)`, so reads are open unless denied; a blacklist of known
// credential stores cannot protect unrelated projects. Contents of the user's home directory and of the shared temporary
// directories are therefore denied, and only what a command legitimately needs is allowed back: the toolchain prefixes on
// PATH (and the running Node), ERA's own code, and the directories the caller names. File NAMES and metadata stay resolvable so
// path lookups work; directory listings and file contents of everything else do not.
// Rules are ordered: SBPL applies the last matching rule.
export function readConfinement({ allow = [], env = process.env } = {}) {
  const home = real(homedir());
  const tmpRoot = real(tmpdir());
  const roots = [...new Set([home, real('/private/tmp'), tmpRoot].filter(Boolean))];
  const toolchains = new Set();
  for (const dir of [...String(env.PATH ?? '').split(':'), dirname(process.execPath)]) {
    const r = isAbsolute(dir) ? real(dir) : null;
    if (!r || !home || !r.startsWith(home + sep)) continue;
    // A tool directory such as ~/.nvm/versions/node/v24/bin needs its prefix (lib/ holds the modules), but never the home itself.
    const prefix = basename(r) === 'bin' && dirname(r) !== home ? dirname(r) : r;
    toolchains.add(prefix);
  }
  // Git fails outright when it cannot read its own configuration; these hold identity and settings, not credentials
  // (credential stores such as ~/.git-credentials and ~/.config/gh stay denied by the caller's sensitive list).
  const benign = home ? ['.gitconfig', '.config/git'].map((p) => real(join(home, p))).filter(Boolean) : [];
  const allowed = [...new Set([...toolchains, PACKAGE_ROOT, ...benign, ...allow.map(real).filter(Boolean)])];
  const subpaths = (list) => list.map((d) => `(subpath ${quote(d)})`).join(' ');
  return {
    // Apple's developer-tool shims (git, make, clang via xcrun) keep a cache named xcrun_db* in the user temp directory and fail
    // without it; it holds only tool locations.
    before: [`(deny file-read* ${subpaths(roots)})`, `(allow file-read-metadata ${subpaths(roots)})`, `(allow file-read* ${subpaths(allowed)})`, ...(tmpRoot ? [`(allow file-read* (regex #"^${tmpRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/xcrun_db")`.concat(')')] : [])],
  };
}

const quote = (p) => `"${p.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

export function sandboxProfile({ writableDirs = [], readableDirs = [], confineReads = true } = {}) {
  const dirs = writableDirs.map((d) => {
    mkdirSync(d, { recursive: true });
    return realpathSync(d);
  });
  const reads = confineReads ? readConfinement({ allow: [...dirs, ...readableDirs] }) : null;
  return [
    '(version 1)',
    '(allow default)',
    '(deny network*)',
    ...SIGNAL_RULES,
    ...(reads ? reads.before : []),
    '(deny file-write*)',
    `(allow file-write* ${[...dirs.map((d) => `(subpath ${quote(d)})`), '(literal "/dev/null")', '(regex #"^/dev/(tty|ttys)[0-9a-z]*$")'].join(' ')})`,
  ].join('\n');
}

// Wraps an executable and its arguments so they run inside the sandbox.
export function sandboxCommand(executable, args, { writableDirs, readableDirs = [] }) {
  if (!sandboxAvailable()) throw new Error('No sandbox is available on this platform (macOS sandbox-exec not found).');
  // The target and the files it is given are read-only inputs: allow their directories (a runtime capture of a binary).
  const inputs = [executable, ...args].filter((a) => typeof a === 'string' && isAbsolute(a) && existsSync(a)).map((a) => (real(a) && !statIsDir(a) ? dirname(real(a)) : real(a)));
  const profile = sandboxProfile({ writableDirs, readableDirs: [...readableDirs, ...inputs.filter(Boolean)] });
  return { executable: SANDBOX_EXEC, arguments: ['-p', profile, executable, ...args], profile, mechanism: 'macos-sandbox-exec' };
}

function statIsDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
