// Isolation for untrusted Improvement Lab candidate code (protected path).
//
// Candidate code (tests, fact extraction, pass planning, CLI help) runs under a
// macOS sandbox-exec profile: no network, writes only to the candidate worktree
// and private scratch directories, no reads of ground truth, the stable ERA state
// or common credential stores, and an environment without secret-looking
// variables. REA itself is trusted and runs outside the sandbox under the stable
// supervisor (REA cannot run inside such a profile; it needs its own writable
// locations). Without a sandbox, evaluation fails closed unless the maintainer
// explicitly declares the candidate trusted (--trust-candidate).
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import { SANDBOX_EXEC, SIGNAL_RULES, readConfinement, sandboxAvailable } from './sandbox.js';
import { SafetyError } from './policy.js';

export const SECRET_ENV = /(TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|CREDENTIAL|AUTH|COOKIE|SESSION|PRIVATE|^GH_|^GITHUB_|^AWS_|^ANTHROPIC_|^OPENAI_|^NPM_|^SSH_AUTH_SOCK$|^GIT_ASKPASS$)/i;

const SENSITIVE_HOME = ['.ssh', '.aws', '.gnupg', '.config/gh', '.config/gcloud', '.azure', '.kube', '.docker', '.netrc', '.git-credentials', '.npmrc', '.pypirc', '.cargo/credentials', '.cargo/credentials.toml', '.claude.json', '.claude', '.codex', 'Library/Keychains'];

const real = (p) => {
  mkdirSync(p, { recursive: true });
  return realpathSync(p);
};
const quote = (p) => `"${p.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

export function candidateEnv(base, { tmp, extra = {} }) {
  const env = {};
  for (const [k, v] of Object.entries(base)) if (!SECRET_ENV.test(k)) env[k] = v;
  return { ...env, TMPDIR: tmp, npm_config_cache: join(tmp, 'npm-cache'), ERA_IN_CANDIDATE_SANDBOX: '1', ...extra };
}

// `network: true` is only for trusted tooling that needs it (for example a
// user-configured coding-agent command); candidate code never gets it.
// `readable` names extra read-only inputs. `confineHome: false` keeps the pre-audit read behavior (everything except the
// listed credential stores) for trusted, user-configured agent CLIs that need their own configuration; every other caller
// gets the home directory and the shared temporary directories closed, plus the signalling restriction (which always applies).
export function candidateProfile({ writable = [], denyRead = [], readable = [], network = false, confineHome = true }) {
  const w = writable.map(real);
  const ro = readable.filter(existsSync).map((p) => realpathSync(p));
  const sensitive = SENSITIVE_HOME.map((p) => join(homedir(), p)).filter(existsSync).map((p) => realpathSync(p));
  const r = [...denyRead.filter(existsSync).map((p) => realpathSync(p)), ...sensitive];
  const confinement = confineHome ? readConfinement({ allow: [...w, ...ro] }) : null;
  const q = (list) => list.map((d) => `(subpath ${quote(d)})`).join(' ');
  // Work areas that live INSIDE a denied directory (a working copy under ERA's state directory) must stay readable.
  const reopen = [...w, ...ro].filter((d) => r.some((x) => d !== x && d.startsWith(x + sep)));
  return [
    '(version 1)',
    '(allow default)',
    ...(network ? [] : ['(deny network*)']),
    ...SIGNAL_RULES,
    ...(confinement ? confinement.before : []),
    '(deny file-write*)',
    `(allow file-write* ${[...w.map((d) => `(subpath ${quote(d)})`), '(literal "/dev/null")', '(regex #"^/dev/(tty|ttys)[0-9a-z]*$")'].join(' ')})`,
    ...(confinement?.protectedAfter.length ? [`(deny file-read* ${q(confinement.protectedAfter)})`] : []),
    ...(r.length ? [`(deny file-read* ${q(r)})`] : []),
    ...(reopen.length ? [`(allow file-read* ${q(reopen)})`] : []),
  ].join('\n');
}

// Stable ERA state that candidate code must not read (experiment worktrees,
// which also live under the state directory, stay readable).
export function protectedStatePaths(stateDir) {
  return ['runs', 'cycles', 'ledger.jsonl', 'logs', 'self-analyses', 'analyses', 'benchmarks', 'improve.lock'].map((p) => join(stateDir, p));
}

// Decides how candidate code may run. Fails closed without a sandbox.
export function candidateIsolation({ trust = false } = {}) {
  if (sandboxAvailable()) return { mode: 'sandbox', mechanism: 'macos-sandbox-exec' };
  if (trust) return { mode: 'trusted', mechanism: 'none', note: 'maintainer declared the candidate trusted (--trust-candidate)' };
  throw new SafetyError('No sandbox is available for untrusted candidate code on this platform. Evaluate only code you trust, with --trust-candidate.');
}

// Returns { command, args, env } for running candidate code under the isolation.
export function wrapCandidate(isolation, command, args, { writable, denyRead = [], readable = [], tmp, env = process.env, extraEnv = {}, network = false, keepEnv = false, confineHome = !keepEnv }) {
  // keepEnv: trusted, user-configured tooling that needs its own credentials.
  const cleanEnv = keepEnv ? { ...env, TMPDIR: tmp, ...extraEnv } : candidateEnv(env, { tmp, extra: extraEnv });
  // A parent `node --test` run sets NODE_TEST_CONTEXT, which turns a nested `node --test`
  // into a silent reporter that exits 0 (tests would "pass" without running).
  delete cleanEnv.NODE_TEST_CONTEXT;
  if (isolation.mode !== 'sandbox') return { command, args, env: cleanEnv };
  return { command: SANDBOX_EXEC, args: ['-p', candidateProfile({ writable: [...writable, tmp], denyRead, readable, network, confineHome }), command, ...args], env: cleanEnv };
}
