// Runs the PROJECT'S OWN build, test and acceptance commands (Project Lab).
// Project code is untrusted: commands run in the macOS sandbox (no network,
// writes only to the working copy and a private temp directory, no reads of ERA
// state or other projects) with a scrubbed environment. Without a sandbox they
// run only if the maintainer declared the project trusted.
import { mkdtempSync } from 'node:fs';
import { removeTree } from '../core/util.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProcess } from '../core/process.js';
import { redactText } from '../safety/secrets.js';
import { candidateIsolation, protectedStatePaths, wrapCandidate } from '../safety/candidate-sandbox.js';

export function projectIsolation({ trust = false } = {}) {
  return candidateIsolation({ trust });
}

// Paths the sandboxed project code must not read: ERA's own state and other projects.
export function denyReadPaths(stateDir, projectsRoot, projectId, existsProjects = []) {
  return [...protectedStatePaths(stateDir), ...existsProjects.filter((id) => id !== projectId).map((id) => join(projectsRoot, id))];
}

const cap = (s, n = 20_000) => (s.length > n ? `${s.slice(0, n / 2)}\n… [${s.length - n} characters omitted] …\n${s.slice(-n / 2)}` : s);

export async function runProjectCommand({ command, cwd, timeoutMs, isolation, denyRead = [], extraWritable = [], env = process.env, extraEnv = {}, input = null }) {
  const tmp = mkdtempSync(join(tmpdir(), 'era-project-'));
  try {
    const w = wrapCandidate(isolation, '/bin/sh', ['-c', command], { writable: [cwd, ...extraWritable], denyRead, tmp, env, extraEnv });
    const r = await runProcess(w.command, w.args, { cwd, env: w.env, timeoutMs, watchdog: true, input });
    const stdout = redactText(r.stdout);
    const stderr = redactText(r.stderr);
    const tests = parseTestOutput(`${stdout}\n${stderr}`);
    return {
      command,
      exit_code: r.exitCode,
      timed_out: r.timedOut,
      signal: r.signal ?? null,
      duration_ms: Math.round(r.durationMs),
      spawn_error: r.spawnError ?? null,
      ok: r.exitCode === 0 && !r.timedOut,
      stdout_tail: cap(stdout),
      stderr_tail: cap(stderr),
      stdout,
      tests,
    };
  } finally {
    removeTree(tmp);
  }
}

// ---- test output parsing: names of tests that passed, failed or were skipped.
const PARSERS = [
  {
    format: 'tap',
    re: /^(not ok|ok) \d+ - (.+?)(?: # (SKIP|TODO)\b.*)?$/,
    read: (m) => [m[2].trim(), m[3] ? 'skipped' : m[1] === 'ok' ? 'passed' : 'failed'],
  },
  {
    format: 'spec',
    re: /^\s*(?:[✔✓√]|✔) (.+?)(?: \(\d+(?:\.\d+)?m?s\))?$/u,
    read: (m) => [m[1].trim(), 'passed'],
  },
  { format: 'spec', re: /^\s*(?:[✖✗✕×]) (.+?)(?: \(\d+(?:\.\d+)?m?s\))?$/u, read: (m) => [m[1].trim().replace(/^\d+\)\s*/, ''), 'failed'] },
  { format: 'pytest', re: /^(\S+::\S+) (PASSED|FAILED|ERROR|SKIPPED)/, read: (m) => [m[1], m[2] === 'PASSED' ? 'passed' : m[2] === 'SKIPPED' ? 'skipped' : 'failed'] },
  { format: 'go', re: /^\s*--- (PASS|FAIL|SKIP): (\S+)/, read: (m) => [m[2], m[1] === 'PASS' ? 'passed' : m[1] === 'SKIP' ? 'skipped' : 'failed'] },
  { format: 'cargo', re: /^test (\S+) \.\.\. (ok|FAILED|ignored)/, read: (m) => [m[1], m[2] === 'ok' ? 'passed' : m[2] === 'ignored' ? 'skipped' : 'failed'] },
];

export function parseTestOutput(text) {
  const byFormat = new Map();
  for (const line of text.split('\n')) {
    for (const p of PARSERS) {
      const m = p.re.exec(line);
      if (!m) continue;
      const [name, status] = p.read(m);
      const entry = byFormat.get(p.format) ?? new Map();
      // A name reported failed anywhere stays failed (node prints failures twice).
      if (entry.get(name) !== 'failed') entry.set(name, status);
      byFormat.set(p.format, entry);
      break;
    }
  }
  let best = null;
  for (const [format, entry] of byFormat) if (!best || entry.size > best.entry.size) best = { format, entry };
  if (!best || best.entry.size === 0) return null;
  const names = (s) => [...best.entry].filter(([, v]) => v === s).map(([k]) => k).sort();
  return { format: best.format, passed: names('passed'), failed: names('failed'), skipped: names('skipped') };
}

// Tests that passed at baseline must still pass.
export function regressions(baselineTests, afterTests) {
  if (!baselineTests || !afterTests) return { comparable: false, regressed: [], fixed: [], newly_failing: [] };
  const after = new Set(afterTests.passed);
  const regressed = baselineTests.passed.filter((t) => !after.has(t));
  const fixed = baselineTests.failed.filter((t) => after.has(t));
  const known = new Set([...baselineTests.passed, ...baselineTests.failed, ...baselineTests.skipped]);
  const newlyFailing = afterTests.failed.filter((t) => !known.has(t));
  return { comparable: true, regressed, fixed, newly_failing: newlyFailing };
}
