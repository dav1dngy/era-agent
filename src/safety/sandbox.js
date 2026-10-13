// Sandbox for executing untrusted native targets during runtime capture.
// macOS: sandbox-exec (Seatbelt) profile that denies all network access and
// all filesystem writes except a per-analysis scratch directory, /dev/null and
// terminals. sandbox-exec is deprecated by Apple but functional; Seatbelt is
// the same kernel mechanism App Sandbox uses. Git worktrees and REA's process
// capture are NOT sandboxes. Other platforms report no sandbox.
import { existsSync, realpathSync, mkdirSync } from 'node:fs';

export const SANDBOX_EXEC = '/usr/bin/sandbox-exec';

export function sandboxAvailable(platform = process.platform) {
  return platform === 'darwin' && existsSync(SANDBOX_EXEC);
}

const quote = (p) => `"${p.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

export function sandboxProfile({ writableDirs = [] } = {}) {
  const dirs = writableDirs.map((d) => {
    mkdirSync(d, { recursive: true });
    return realpathSync(d);
  });
  return [
    '(version 1)',
    '(allow default)',
    '(deny network*)',
    '(deny file-write*)',
    `(allow file-write* ${[...dirs.map((d) => `(subpath ${quote(d)})`), '(literal "/dev/null")', '(regex #"^/dev/(tty|ttys)[0-9a-z]*$")'].join(' ')})`,
  ].join('\n');
}

// Wraps an executable and its arguments so they run inside the sandbox.
export function sandboxCommand(executable, args, { writableDirs }) {
  if (!sandboxAvailable()) throw new Error('No sandbox is available on this platform (macOS sandbox-exec not found).');
  const profile = sandboxProfile({ writableDirs });
  return { executable: SANDBOX_EXEC, arguments: ['-p', profile, executable, ...args], profile, mechanism: 'macos-sandbox-exec' };
}
