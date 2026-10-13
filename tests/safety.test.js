import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HARD_LIMITS, effectiveLimits, assertCycleAllowed, assertNotCI, protectedChanges, assertTargetPath, acquireLock, clearStaleLock, SafetyError } from '../src/safety/policy.js';
import { tempDir } from './helpers.js';

test('configured limits cannot exceed hard limits', () => {
  const l = effectiveLimits({ maxCycles: 1000, maxReaRunsPerCycle: 1e9, commandTimeoutMs: 1e12 }, { implementerTimeoutMs: 1e12 });
  assert.equal(l.maxCycles, HARD_LIMITS.maxCycles);
  assert.equal(l.maxReaRunsPerCycle, HARD_LIMITS.maxReaRunsPerCycle);
  assert.equal(l.commandTimeoutMs, HARD_LIMITS.commandTimeoutMs);
  assert.equal(l.implementerTimeoutMs, HARD_LIMITS.implementerTimeoutMs);
  assert.equal(l.maxParallel, 1);
});

test('invalid limits fall back to safe defaults', () => {
  const l = effectiveLimits({ maxCycles: -1, maxReaRunsPerCycle: 'x' });
  assert.equal(l.maxCycles, 3);
  assert.equal(l.maxReaRunsPerCycle, 12);
});

test('cycle limit is enforced', () => {
  assert.doesNotThrow(() => assertCycleAllowed(2, { maxCycles: 3 }));
  assert.throws(() => assertCycleAllowed(3, { maxCycles: 3 }), SafetyError);
});

test('self-improvement refuses to run in CI', () => {
  assert.throws(() => assertNotCI({ CI: 'true' }), SafetyError);
  assert.throws(() => assertNotCI({ GITHUB_ACTIONS: 'true' }), SafetyError);
  assert.doesNotThrow(() => assertNotCI({}));
});

test('protected paths are detected', () => {
  const changed = ['src/cli.js', 'src/safety/policy.js', 'benchmarks/acceptance.json', 'benchmarks/datasets/truth/x.json', 'src/evaluation/score.js', 'tests/safety.test.js', 'tests/core.test.js'];
  assert.deepEqual(protectedChanges(changed), ['src/safety/policy.js', 'benchmarks/acceptance.json', 'benchmarks/datasets/truth/x.json', 'src/evaluation/score.js', 'tests/safety.test.js']);
});

test('target paths must exist and be regular files or directories', () => {
  const dir = tempDir();
  writeFileSync(join(dir, 'f'), 'x');
  assert.doesNotThrow(() => assertTargetPath(join(dir, 'f')));
  assert.doesNotThrow(() => assertTargetPath(dir));
  assert.throws(() => assertTargetPath(join(dir, 'missing')), SafetyError);
  assert.throws(() => assertTargetPath(''), SafetyError);
  assert.throws(() => assertTargetPath('/dev/null'), SafetyError);
});

test('improvement lock is exclusive and released', () => {
  const dir = tempDir();
  const release = acquireLock(dir, 'a');
  assert.throws(() => acquireLock(dir, 'b'), SafetyError);
  release();
  const release2 = acquireLock(dir, 'c');
  release2();
});

test('stale locks from dead processes are replaced', () => {
  const dir = tempDir();
  writeFileSync(join(dir, 'improve.lock'), JSON.stringify({ pid: 2 ** 22 + 12345, owner: 'ghost' }));
  const release = acquireLock(dir, 'fresh');
  release();
});

test('clearStaleLock removes only locks held by dead processes', () => {
  const dir = tempDir();
  assert.equal(clearStaleLock(dir), false);
  const release = acquireLock(dir, 'live');
  assert.equal(clearStaleLock(dir), false, 'live holder keeps the lock');
  release();
  writeFileSync(join(dir, 'improve.lock'), JSON.stringify({ pid: 2 ** 22 + 54321, owner: 'dead' }));
  assert.equal(clearStaleLock(dir), true);
});

test('lock acquisition is exclusive across processes and release honours ownership', async () => {
  const { runProcess } = await import('../src/core/process.js');
  const dir = tempDir();
  const url = new URL('../src/safety/policy.js', import.meta.url).href;
  const script = `import('${url}').then(({ acquireLock }) => { try { acquireLock(${JSON.stringify(dir)}, 'racer'); console.log('got'); setTimeout(() => {}, 1500); } catch { console.log('busy'); } });`;
  const results = await Promise.all([1, 2, 3, 4].map(() => runProcess(process.execPath, ['-e', script], { timeoutMs: 10_000 })));
  assert.equal(results.filter((r) => r.stdout.trim() === 'got').length, 1, results.map((r) => r.stdout.trim()).join(','));
});

test('recovery refuses while a live process holds the lock (audit F06)', async () => {
  const { recoverState } = await import('../src/orchestration/cycle.js');
  const { loadConfig } = await import('../src/core/config.js');
  const { initRepo } = await import('./helpers.js');
  const { dir } = initRepo();
  const config = loadConfig(dir, {});
  const release = acquireLock(config.stateDirAbs, 'live evaluation');
  try {
    await assert.rejects(recoverState({ root: dir, config }), /still running/);
  } finally {
    release();
  }
  assert.deepEqual(await recoverState({ root: dir, config }), []);
});
