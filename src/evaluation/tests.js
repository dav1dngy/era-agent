// Testing Engine (protected path): runs the node:test suite of a checkout.
import { runProcess } from '../core/process.js';

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

export async function runTests(dir, { timeoutMs = 900_000, env = process.env } = {}) {
  // A parent node:test run sets NODE_TEST_CONTEXT, which turns a nested
  // `node --test` into a silent child reporter; the suite must run standalone.
  const { NODE_TEST_CONTEXT: _parentTestContext, ...cleanEnv } = env;
  const r = await runProcess(process.execPath, ['--test', '--test-reporter=tap', 'tests/*.test.js'], { cwd: dir, timeoutMs, env: cleanEnv, watchdog: true });
  const summary = parseTapSummary(r.stdout);
  const ok = r.exitCode === 0 && summary.failed === 0 && (summary.passed ?? 0) > 0;
  const failures = [...r.stdout.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1]);
  return { ok, exit_code: r.exitCode, timed_out: r.timedOut, ...summary, failures, inventory: parseTapTests(r.stdout), wall_ms: Math.round(r.durationMs) };
}
