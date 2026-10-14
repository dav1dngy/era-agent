// Regression tests for two intermittent production failures found in v0.2.0-dev.1.
//
//  1. "Unknown run": a status read while a run directory exists but its run.json is not yet published.
//  2. ENOTEMPTY while removing a candidate-test temp directory that a descendant is still writing into,
//     which replaced the real outcome (or a clean interruption) with a cleanup error.
//
// Both are reproduced deterministically (a half-created run directory; a writer that left the process group),
// not by retrying until they happen. Everything here is REAL file-system and process behavior; nothing is mocked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { removeTree } from '../src/core/util.js';
import { runTests } from '../src/evaluation/tests.js';
import { ProjectStore } from '../src/project_lab/store.js';
import { tempDir } from './helpers.js';

const STORE_MODULE = fileURLToPath(new URL('../src/project_lab/store.js', import.meta.url));

const project = (id = 'demo') => ({ id, mode: 'review', status: 'created', approval: { status: 'none' } });

test('status reads skip a run whose directory exists but whose run.json is not published yet', () => {
  const store = new ProjectStore(tempDir());
  store.save(project());
  const first = store.newRun(project(), 'review');
  // The window in which the failure happened: the next run's directory is there, run.json is not.
  mkdirSync(store.runDir('demo', 'run-20260101T000000-aaaaaa'), { recursive: true });
  assert.doesNotThrow(() => store.listRuns('demo'));
  assert.deepEqual(store.listRuns('demo').map((r) => r.run_id), [first.run_id]);
  assert.equal(store.latestRun('demo').run_id, first.run_id);
  // A run that does not exist at all is still an error when asked for by id.
  assert.throws(() => store.loadRun('demo', 'run-20260101T000000-aaaaaa'), /Unknown run/);
  // Once the run is published it is listed, in order.
  writeFileSync(join(store.runDir('demo', 'run-20260101T000000-aaaaaa'), 'run.json'), JSON.stringify({ run_id: 'run-20260101T000000-aaaaaa', project_id: 'demo', seq: 2, created_at: '2026-01-01T00:00:00.000Z', steps: {}, results: {}, attempts: [] }));
  assert.equal(store.listRuns('demo').length, 2);
});

test('a reader polling while another process creates runs never sees "Unknown run"', async () => {
  const stateDir = tempDir();
  const store = new ProjectStore(stateDir);
  store.save(project());
  // A separate process creates 60 runs through the real store while this one reads continuously.
  const writer = spawn(process.execPath, ['--input-type=module', '-e', `
    import { ProjectStore } from ${JSON.stringify(STORE_MODULE)};
    const s = new ProjectStore(${JSON.stringify(stateDir)});
    for (let i = 0; i < 60; i++) { s.newRun({ id: 'demo' }, 'review'); await new Promise((r) => setTimeout(r, 2)); }
  `], { stdio: 'ignore' });
  const done = new Promise((r) => writer.once('exit', r));
  let reads = 0;
  const errors = [];
  let finished = false;
  done.then(() => { finished = true; });
  while (!finished) {
    try {
      store.listRuns('demo');
      store.latestRun('demo');
      reads++;
    } catch (err) {
      errors.push(err.message);
    }
    await new Promise((r) => setImmediate(r));
  }
  assert.deepEqual(errors, []);
  // How many reads fit in depends on CPU scheduling (a starved reader may get few), so only correctness is asserted here;
  // the deterministic proof is the half-created-directory test above.
  assert.ok(reads > 0, 'the reader ran at least once');
  assert.equal(store.listRuns('demo').length, 60);
});

// A process that leaves the session (detached) escapes process-group termination and keeps writing.
const spawnEscapedWriter = (dir, ms) => {
  const child = spawn(process.execPath, ['-e', `
    const fs = require('node:fs'); const path = require('node:path');
    const end = Date.now() + ${ms}; let i = 0;
    fs.mkdirSync(path.join(${JSON.stringify(dir)}, 'sub'), { recursive: true });
    const tick = () => { if (Date.now() > end) return; try { fs.writeFileSync(path.join(${JSON.stringify(dir)}, 'sub', 'f' + (i++)), 'x'); } catch {} setTimeout(tick, 1); };
    tick();
  `], { detached: true, stdio: 'ignore' });
  child.unref();
  return child;
};

test('removeTree outlasts a descendant that is still writing, and never throws', async () => {
  for (let round = 0; round < 5; round++) {
    const dir = join(tempDir(), 'victim');
    mkdirSync(dir, { recursive: true });
    spawnEscapedWriter(dir, 400);
    await new Promise((r) => setTimeout(r, 60)); // the writer is running
    const result = removeTree(dir);
    assert.equal(result.ok, true, result.error);
    assert.equal(existsSync(dir), false);
  }
});

test('removeTree reports (does not throw) a directory it cannot remove', () => {
  // A path component that is a FILE makes the removal impossible on every platform.
  const base = tempDir();
  writeFileSync(join(base, 'file'), 'x');
  const r = removeTree(join(base, 'file', 'child'));
  assert.equal(typeof r.ok, 'boolean');
  assert.doesNotThrow(() => removeTree(join(base, 'does-not-exist')));
});

const suiteWithEscapedWriter = (dir, { hang = false } = {}) => {
  mkdirSync(join(dir, 'tests'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), '{"name":"t","type":"commonjs"}');
  writeFileSync(join(dir, 'tests', 'a.test.js'), `
    const { test } = require('node:test'); const { spawn } = require('node:child_process');
    test('leaves a writer behind', async () => {
      spawn(process.execPath, ['-e', \`const fs=require('fs'),p=require('path');const d=process.env.TMPDIR||require('os').tmpdir();const end=Date.now()+500;let i=0;fs.mkdirSync(p.join(d,'leak'),{recursive:true});(function t(){if(Date.now()>end)return;try{fs.writeFileSync(p.join(d,'leak','f'+(i++)),'x')}catch{}setTimeout(t,1)})()\`], { detached: true, stdio: 'ignore' }).unref();
      ${hang ? 'await new Promise((r) => setTimeout(r, 60000));' : 'await new Promise((r) => setTimeout(r, 80));'}
    });
  `);
};

test('runTests returns its real result when a descendant keeps writing into the temp directory', async () => {
  const dir = tempDir();
  suiteWithEscapedWriter(dir);
  for (let i = 0; i < 3; i++) {
    const r = await runTests(dir, { isolation: { mode: 'trusted', mechanism: 'none' }, timeoutMs: 60_000 });
    assert.equal(r.ok, true, JSON.stringify(r.failures));
    assert.equal(r.passed, 1);
  }
});

test('an interrupted/timed-out run reports the timeout, not a cleanup error', async () => {
  const dir = tempDir();
  suiteWithEscapedWriter(dir, { hang: true });
  const r = await runTests(dir, { isolation: { mode: 'trusted', mechanism: 'none' }, timeoutMs: 2500 });
  assert.equal(r.timed_out, true);
  assert.equal(r.ok, false);
});

test('after a run whose descendant keeps writing, no candidate temp directory is left behind', async () => {
  // os.tmpdir() reads TMPDIR on every call, so an isolated TMPDIR lets us see exactly what runTests creates and leaves.
  const mine = tempDir();
  const saved = process.env.TMPDIR;
  process.env.TMPDIR = mine;
  try {
    const dir = join(mine, 'project');
    suiteWithEscapedWriter(dir);
    const r = await runTests(dir, { isolation: { mode: 'trusted', mechanism: 'none' }, timeoutMs: 60_000 });
    assert.equal(r.ok, true);
    await new Promise((res) => setTimeout(res, 800)); // the escaped writer stops after ~500 ms
    const left = readdirSync(mine).filter((n) => n.startsWith('era-candidate-tests-'));
    assert.deepEqual(left, [], 'the temp directory was removed even though a descendant was still writing into it');
  } finally {
    if (saved === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = saved;
  }
});
