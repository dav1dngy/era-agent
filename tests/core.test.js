import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, deepMerge, DEFAULT_CONFIG } from '../src/core/config.js';
import { median, sha256Text } from '../src/core/util.js';
import { parseTimeOutput, runProcess, terminateAllChildren, activeChildCount } from '../src/core/process.js';
import { tempDir } from './helpers.js';

test('loadConfig returns defaults without a config file', () => {
  const dir = tempDir();
  const c = loadConfig(dir, {});
  assert.equal(c.limits.maxCycles, DEFAULT_CONFIG.limits.maxCycles);
  assert.equal(c.stateDirAbs, join(dir, '.era'));
});

test('loadConfig merges era.config.json and env overrides', () => {
  const dir = tempDir();
  writeFileSync(join(dir, 'era.config.json'), JSON.stringify({ limits: { maxCycles: 2 }, rea: { timeoutMs: 5 } }));
  const c = loadConfig(dir, { ERA_REA_BIN: '/opt/rea', ERA_STATE_DIR: '/tmp/state' });
  assert.equal(c.limits.maxCycles, 2);
  assert.equal(c.limits.maxReaRunsPerCycle, DEFAULT_CONFIG.limits.maxReaRunsPerCycle);
  assert.equal(c.rea.command, '/opt/rea');
  assert.equal(c.rea.timeoutMs, 5);
  assert.equal(c.stateDirAbs, '/tmp/state');
});

test('loadConfig rejects invalid JSON', () => {
  const dir = tempDir();
  writeFileSync(join(dir, 'era.config.json'), '{nope');
  assert.throws(() => loadConfig(dir, {}), /Invalid era.config.json/);
});

test('deepMerge replaces arrays and merges objects', () => {
  assert.deepEqual(deepMerge({ a: { b: 1, c: 2 }, l: [1] }, { a: { c: 3 }, l: [2] }), { a: { b: 1, c: 3 }, l: [2] });
});

test('median and sha256Text', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
  assert.equal(sha256Text('era').length, 64);
});

test('parseTimeOutput extracts macOS time -l resources and strips them', () => {
  const stderr = 'progress line\n        1.50 real         0.80 user         0.20 sys\n  123456  maximum resident set size\n   0  page reclaims\n';
  const r = parseTimeOutput(stderr);
  assert.equal(r.stderr, 'progress line\n');
  assert.deepEqual(r.resources, { real_s: 1.5, user_s: 0.8, sys_s: 0.2, max_rss_bytes: 123456 });
  assert.deepEqual(parseTimeOutput('plain'), { stderr: 'plain', resources: null });
});

test('runProcess enforces timeouts', async () => {
  const r = await runProcess(process.execPath, ['-e', 'setTimeout(()=>{}, 10000)'], { timeoutMs: 200 });
  assert.equal(r.timedOut, true);
  assert.ok(r.durationMs < 5000);
});

test('runProcess reports spawn errors for missing executables', async () => {
  const r = await runProcess('/nonexistent/era-binary', [], { timeoutMs: 1000 });
  assert.equal(r.exitCode, null);
  assert.match(r.spawnError, /ENOENT/);
});

test('timeouts kill the whole process tree, not only the direct child', async () => {
  const dir = tempDir();
  const pidFile = join(dir, 'grandchild.pid');
  // The direct child spawns a long-lived grandchild that inherits stdout, then waits.
  const script = `const { spawn } = require('node:child_process'); const g = spawn(process.execPath, ['-e', 'setInterval(()=>{}, 1000)'], { stdio: 'inherit' }); require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(g.pid)); setInterval(()=>{}, 1000);`;
  const started = Date.now();
  const r = await runProcess(process.execPath, ['-e', script], { timeoutMs: 1000 });
  assert.equal(r.timedOut, true);
  assert.ok(Date.now() - started < 8000, 'run settles promptly');
  const grandchild = Number(readFileSync(pidFile, 'utf8'));
  await new Promise((res) => setTimeout(res, 300));
  assert.throws(() => process.kill(grandchild, 0), /ESRCH/, 'grandchild was terminated');
  assert.equal(activeChildCount(), 0);
});

test('a run settles when an escaped grandchild keeps the pipes open', async () => {
  // The grandchild detaches into its own process group and keeps stdout; the direct child exits at once.
  const script = `const { spawn } = require('node:child_process'); const g = spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 4000)'], { stdio: 'inherit', detached: true }); g.unref(); process.stdout.write(String(g.pid));`;
  const started = Date.now();
  const r = await runProcess(process.execPath, ['-e', script], { timeoutMs: 20_000 });
  assert.equal(r.exitCode, 0);
  assert.equal(r.timedOut, false);
  assert.ok(Date.now() - started < 3500, `settled in ${Date.now() - started} ms`);
  try { process.kill(Number(r.stdout), 'SIGKILL'); } catch { /* already gone */ }
});

test('terminateAllChildren cancels running process groups', async () => {
  const pending = runProcess(process.execPath, ['-e', 'setInterval(()=>{}, 1000)'], { timeoutMs: 30_000 });
  await new Promise((res) => setTimeout(res, 200));
  assert.equal(terminateAllChildren('SIGTERM'), 1);
  const r = await pending;
  assert.equal(r.signal, 'SIGTERM');
});

test('watchdog kills the command group when the ERA parent dies', async () => {
  const dir = tempDir();
  const pidFile = join(dir, 'pid');
  // A parent "era" process starts a watchdog-guarded long command, records its pid, then dies abruptly.
  const parent = `import('${new URL('../src/core/process.js', import.meta.url).href}').then(({ runProcess }) => { runProcess(process.execPath, ['-e', 'require("fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(()=>{}, 1000)'], { timeoutMs: 600000, watchdog: true }); setTimeout(() => process.kill(process.pid, 'SIGKILL'), 1500); });`;
  await runProcess(process.execPath, ['-e', parent], { timeoutMs: 20_000 });
  const pid = Number(readFileSync(pidFile, 'utf8'));
  await new Promise((res) => setTimeout(res, 3500));
  assert.throws(() => process.kill(pid, 0), /ESRCH/, 'guarded command did not outlive its parent');
});

test('watchdog enforces the deadline and preserves exit codes', async () => {
  const ok = await runProcess(process.execPath, ['-e', 'process.exit(7)'], { timeoutMs: 10_000, watchdog: true });
  assert.equal(ok.exitCode, 7);
  const out = await runProcess(process.execPath, ['-e', 'console.log("hi")'], { timeoutMs: 10_000, watchdog: true });
  assert.equal(out.stdout.trim(), 'hi');
  const slow = await runProcess(process.execPath, ['-e', 'setInterval(()=>{}, 1000)'], { timeoutMs: 500, watchdog: true });
  assert.equal(slow.timedOut, true);
});

test('an output flood beyond the quota terminates the run cleanly (audit F14)', async () => {
  const out = join(tempDir(), 'out.bin');
  const r = await runProcess(process.execPath, ['-e', 'const b = Buffer.alloc(65536, 97); (function w() { while (process.stdout.write(b)); process.stdout.once("drain", w); })();'], { timeoutMs: 20_000, stdoutFile: out, maxOutputBytes: 1_000_000 });
  assert.match(r.outputError, /exceeded 1000000 bytes/);
  assert.equal(r.timedOut, false);
});

test('a failing output sink is recorded instead of crashing (audit F14)', async () => {
  const r = await runProcess(process.execPath, ['-e', 'console.log("x".repeat(1000))'], { timeoutMs: 10_000, stdoutFile: join(tempDir(), 'missing-dir', 'out.json') });
  assert.match(r.outputError, /output file error/);
});
