// Testing Engine (protected path): runs the node:test suite of a checkout.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProcess } from '../core/process.js';
import { removeTree } from '../core/util.js';

export function parseTapSummary(text) {
  const num = (key) => {
    const m = new RegExp(`^# ${key} (\\d+(?:\\.\\d+)?)`, 'm').exec(text);
    return m ? Number(m[1]) : null;
  };
  return { tests: num('tests'), passed: num('pass'), failed: num('fail'), skipped: num('skipped'), cancelled: num('cancelled'), duration_ms: num('duration_ms') };
}

// Top-level test results from node:test TAP output (subtests are indented).
export function parseTapTests(text) {
  const tests = [];
  for (const line of text.split('\n')) {
    const m = /^(not ok|ok) \d+ - (.+?)(?: # (SKIP|TODO)\b.*)?$/.exec(line);
    if (!m) continue;
    tests.push({ name: m[2].trim(), status: m[3] ? 'skip' : m[1] === 'ok' ? 'pass' : 'fail' });
  }
  return tests;
}

// With an isolation, the suite runs as untrusted candidate code: sandboxed
// (writes only to its own checkout and a private temp directory, no network,
// no reads of the stable ERA state), secret-free environment, and without the
// tests that need the REA engine, a nested sandbox or the end-to-end Lab (those
// are skipped identically for baseline and candidate).
export async function runTests(dir, { timeoutMs = 900_000, env = process.env, isolation = null, denyRead = [] } = {}) {
  // A parent node:test run sets NODE_TEST_CONTEXT, which turns a nested
  // `node --test` into a silent child reporter; the suite must run standalone.
  const { NODE_TEST_CONTEXT: _parentTestContext, ...cleanEnv } = env;
  let command = process.execPath;
  let args = ['--test', '--test-reporter=tap', 'tests/*.test.js'];
  let runEnv = cleanEnv;
  let tmp = null;
  if (isolation) {
    const { wrapCandidate } = await import('../safety/candidate-sandbox.js');
    tmp = mkdtempSync(join(tmpdir(), 'era-candidate-tests-'));
    ({ command, args, env: runEnv } = wrapCandidate(isolation, command, args, { writable: [dir], denyRead, tmp, env: cleanEnv, extraEnv: { ERA_SKIP_REA: '1', ERA_SKIP_E2E: '1' } }));
  }
  let r;
  try {
    r = await runProcess(command, args, { cwd: dir, timeoutMs, env: runEnv, watchdog: true });
  } finally {
    // Cleanup is best-effort and must never mask the real result (or a clean interruption).
    if (tmp) removeTree(tmp);
  }
  const summary = parseTapSummary(r.stdout);
  const ok = r.exitCode === 0 && summary.failed === 0 && (summary.passed ?? 0) > 0;
  const failures = [...r.stdout.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1]);
  return { ok, exit_code: r.exitCode, timed_out: r.timedOut, ...summary, failures, inventory: parseTapTests(r.stdout), wall_ms: Math.round(r.durationMs) };
}
