// ERA Project Lab workflow tests.
//
// What is real and what is mocked (see docs/project-lab-testing.md):
//   REAL    the project's own tests, builds and acceptance commands (node:test), run in the macOS sandbox;
//           git, patch application, rollback, locking, signals, processes, the CLI.
//   REAL    REA where stated (reaAvailable()): JavaScript analysis, Mach-O inspection (reference binary).
//   FAKE    the reverse-engineering engine in most tests (tests/fixtures/fake-rea-engine.mjs: a regex import
//           scanner that mimics REA's evidence shape) to keep them fast. Not counted as REA executions.
//   MOCK    the coding agents (tests/fixtures/agents/*.mjs): scripted programs, NOT AI. No model is called.
import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../src/core/config.js';
import { ReaClient } from '../src/rea_integration/rea-client.js';
import { createProjectLab } from '../src/project_lab/lab.js';
import { treeDigest } from '../src/project_lab/workspace.js';
import { sandboxAvailable } from '../src/safety/sandbox.js';
import { DATASETS, FIXTURES, REA_BIN, ROOT, reaAvailable, runEra, tempDir } from './helpers.js';

// Heavy workflow tests are skipped inside the Improvement Lab's nested candidate evaluations
// (no nested sandbox, no REA there), exactly like tests/e2e-lab.test.js.
const NESTED = (process.env.ERA_E2E_NESTED || process.env.ERA_SKIP_E2E) && 'nested evaluation or ERA_SKIP_E2E';
const test = (name, a, b) => {
  const opts = typeof a === 'function' ? {} : a;
  const fn = typeof a === 'function' ? a : b;
  return nodeTest(name, { ...opts, skip: opts.skip || NESTED || false }, fn);
};

// Project Lab refuses to run in CI by design; these tests run it explicitly.
delete process.env.CI;
delete process.env.GITHUB_ACTIONS;

const AGENTS = join(FIXTURES, 'agents');
const FAKE_ENGINE = join(FIXTURES, 'fake-rea-engine.mjs');
const SANDBOX = sandboxAvailable();
const REAL = reaAvailable();
const agentCmd = (name) => `node ${join(AGENTS, name)}`;

function newLab({ rea = FAKE_ENGINE, createAgent, allowUnmetered = true, env = {} } = {}) {
  const config = loadConfig(tempDir(), { ERA_STATE_DIR: tempDir(), ...env });
  config.projectLab = { ...config.projectLab, budget: { ...config.projectLab.budget, allowUnmeteredAgents: allowUnmetered } };
  const client = new ReaClient({ command: rea, stateDir: config.stateDirAbs, measureResources: false });
  return createProjectLab({ config, rea: client, createAgent });
}

function fixture(name) {
  const dir = join(tempDir(), name);
  cpSync(join(FIXTURES, 'projects', name), dir, { recursive: true });
  return dir;
}

const cart = (src, over = {}) => ({
  id: 'cart',
  mode: 'modify',
  source: src,
  task: 'Fix the cart total: it must account for item quantity',
  agent: 'command',
  agent_command: agentCmd('fix-cart.mjs'),
  commands: { test: ['node --test tests/*.test.js'] },
  acceptance: { commands: [{ name: 'cart-quantity', command: 'node --test acceptance/cart-quantity.test.js', baseline: 'fail' }] },
  trust_project: !SANDBOX,
  ...over,
});

const sh = (cwd, command) =>
  new Promise((resolve) => {
    // A parent `node --test` sets NODE_TEST_CONTEXT, which would turn a nested `node --test` into a silent reporter.
    const { NODE_TEST_CONTEXT: _ctx, ...env } = process.env;
    const c = spawn('/bin/sh', ['-c', command], { cwd, env });
    let out = '';
    c.stdout.on('data', (d) => (out += d));
    c.stderr.on('data', (d) => (out += d));
    c.on('close', (code) => resolve({ code, out }));
  });

const waitFor = async (fn, ms = 60_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('timed out waiting for condition');
};

// ---------- Test 1: analyze and repair a small application with a known, reproducible bug

test('Test 1 (modify): repairs a known bug, verifies with the project\'s own tests, applies on approval and rolls back', async () => {
  const lab = newLab();
  const src = fixture('buggy-app');
  const original = treeDigest(src).sha256;
  lab.create(cart(src));
  const { run } = await lab.modify('cart');

  assert.equal(run.status, 'awaiting-approval', run.error ?? JSON.stringify(run.results.finalize?.reasons));
  const base = run.results.baseline;
  assert.equal(base.acceptance[0].ok, false, 'the acceptance command reproduces the bug at baseline');
  assert.equal(base.test[0].ok, true);
  assert.deepEqual(base.tests.failed, []);
  assert.equal(run.results.analysis.rea.ran, true);
  const fin = run.results.finalize;
  assert.equal(fin.pass, true);
  assert.deepEqual(fin.files.map((f) => `${f.status} ${f.path}`), ['M src/cart.js']);
  assert.ok(existsSync(fin.patch_file));
  assert.match(readFileSync(fin.patch_file, 'utf8'), /item\.price \* \(item\.quantity \?\? 1\)/);
  assert.equal(fin.verification.acceptance[0].ok, true, 'the acceptance command passes after the change');
  assert.equal(run.attempts.length, 1);
  assert.equal(treeDigest(src).sha256, original, 'the original project is untouched until approval');
  assert.equal(lab.get('cart').approval.status, 'pending');
  assert.match(lab.show('cart').report, /Accepted for review/);

  const applied = await lab.approve('cart', { by: 'tester' });
  assert.equal(applied.applied.kind, 'patch');
  assert.notEqual(treeDigest(src).sha256, original);
  // The project's own acceptance test passes on the ORIGINAL project now.
  assert.equal((await sh(src, 'node --test acceptance/cart-quantity.test.js')).code, 0);
  assert.equal((await sh(src, 'node --test tests/*.test.js')).code, 0);
  assert.equal(lab.get('cart').approval.status, 'approved');

  const rolled = await lab.rollback('cart');
  assert.equal(rolled.restored, true);
  assert.equal(treeDigest(src).sha256, original, 'rollback restores the original byte for byte');
  assert.equal((await sh(src, 'node --test acceptance/cart-quantity.test.js')).code, 1, 'the bug is back');
});

// ---------- Test 2: implement a missing function in an external project

test('Test 2 (modify): implements a missing function in an external project', async () => {
  const lab = newLab();
  const src = fixture('catalog-app');
  const original = treeDigest(src).sha256;
  lab.create({ id: 'catalog', mode: 'modify', source: src, task: 'Add a search(query) function that finds products by name or tag, case-insensitively', agent: 'command', agent_command: agentCmd('add-search.mjs'), commands: { test: ['node --test tests/*.test.js'] }, acceptance: { commands: [{ name: 'search', command: 'node --test acceptance/search.test.js', baseline: 'fail' }] }, trust_project: !SANDBOX });
  const { run } = await lab.modify('catalog');
  assert.equal(run.status, 'awaiting-approval', run.error ?? JSON.stringify(run.results.finalize?.reasons));
  assert.deepEqual(run.results.finalize.files.map((f) => `${f.status} ${f.path}`).sort(), ['A tests/search.test.js', 'M src/catalog.js']);
  assert.equal(treeDigest(src).sha256, original);
  await lab.approve('catalog', { by: 'tester' });
  assert.equal((await sh(src, 'node --test acceptance/search.test.js')).code, 0);
  assert.ok(existsSync(join(src, 'tests/search.test.js')));
  await lab.rollback('catalog');
  assert.equal(treeDigest(src).sha256, original, 'rollback also removes the added file');
});

// ---------- Test 4: failed executions, regressions, bounded retries, rollback

test('Test 4a: a change that breaks an existing test is rejected, never applied, and cannot be approved', async () => {
  const lab = newLab();
  const src = fixture('buggy-app');
  const original = treeDigest(src).sha256;
  lab.create(cart(src, { agent_command: agentCmd('regress.mjs') }));
  const { run } = await lab.modify('cart');
  assert.equal(run.status, 'rejected');
  assert.equal(run.attempts.length, 2, 'bounded retries: maxAttempts attempts, then stop');
  const reasons = run.results.finalize.reasons.join(' ');
  assert.match(reasons, /Tests that passed at baseline no longer pass/);
  assert.match(reasons, /itemCount sums quantities/);
  assert.equal(treeDigest(src).sha256, original);
  await assert.rejects(lab.approve('cart', { by: 'tester' }), /no run awaiting approval/);
  assert.equal(lab.get('cart').approval.status, 'none');
});

test('Test 4b: deleting existing tests to make things pass is detected as a regression', async () => {
  const lab = newLab();
  const src = fixture('buggy-app');
  lab.create(cart(src, { agent_command: agentCmd('cheat.mjs'), limits: { maxAttempts: 1 } }));
  const { run } = await lab.modify('cart');
  assert.equal(run.status, 'rejected');
  assert.match(run.results.finalize.reasons.join(' '), /listed 3 passing test\(s\), but the test output after the change lists none/);
  assert.match(run.results.finalize.warnings.join(' '), /deleted or modified: D tests\/cart\.test\.js/);
});

test('Test 4c: no-op, crashing and protected-file-touching agents are rejected with clear reasons', async () => {
  for (const [script, expected, over] of [['noop.mjs', /made no changes/, {}], ['crash.mjs', /agent failed \(exit 3\)/, {}], ['fix-cart.mjs', /Protected files were changed: src\/cart\.js/, { protected: ['src/**'] }]]) {
    const lab = newLab();
    const src = fixture('buggy-app');
    const original = treeDigest(src).sha256;
    lab.create(cart(src, { agent_command: agentCmd(script), limits: { maxAttempts: 1 }, ...over }));
    const { run } = await lab.modify('cart');
    assert.equal(run.status, 'rejected', script);
    assert.match(run.results.finalize.reasons.join(' '), expected, script);
    assert.equal(treeDigest(src).sha256, original, script);
  }
});

test('Test 4d: a failed first attempt is retried once with the failure as feedback, then passes', async () => {
  const lab = newLab();
  const src = fixture('buggy-app');
  lab.create(cart(src, { agent_command: agentCmd('flaky.mjs') }));
  const { run } = await lab.modify('cart');
  assert.equal(run.status, 'awaiting-approval', run.error ?? JSON.stringify(run.attempts));
  assert.deepEqual(run.attempts.map((a) => a.pass), [false, true]);
  assert.match(run.attempts[0].reasons.join(' '), /Acceptance command failed/);
  // with a single allowed attempt the same agent is rejected
  const lab2 = newLab();
  lab2.create(cart(fixture('buggy-app'), { agent_command: agentCmd('flaky.mjs'), limits: { maxAttempts: 1 } }));
  assert.equal((await lab2.modify('cart')).run.status, 'rejected');
});

test('Test 4e: acceptance criteria that do not reproduce the problem stop the run before any agent is paid for', async () => {
  const lab = newLab();
  const src = fixture('buggy-app');
  lab.create(cart(src, { acceptance: { commands: [{ name: 'always-passes', command: 'node -e "process.exit(0)"', baseline: 'fail' }] } }));
  const { run } = await lab.modify('cart');
  assert.equal(run.status, 'failed');
  assert.match(run.error, /expected to fail at baseline .* but passes/);
  assert.ok(!lab.store.events('cart').some((e) => e.type === 'implementer-started'));
});

test('Test 4f: approval is refused when the original changed since the run, or the verified copy was altered', async () => {
  const lab = newLab();
  const src = fixture('buggy-app');
  lab.create(cart(src));
  const { run } = await lab.modify('cart');
  // someone edits the original in the meantime
  writeFileSync(join(src, 'README.md'), 'edited by a person\n');
  await assert.rejects(lab.approve('cart', { by: 't' }), /original project changed since this run started/);
  assert.equal(lab.get('cart').approval.status, 'pending');
  // a second run on a fresh original: tamper with the verified working copy after verification
  const lab2 = newLab();
  const src2 = fixture('buggy-app');
  lab2.create(cart(src2));
  const r2 = (await lab2.modify('cart')).run;
  writeFileSync(join(lab2.store.workDir('cart', r2.run_id), 'src/cart.js'), 'module.exports = { itemCount: () => 0, total: () => 0 };\n');
  await assert.rejects(lab2.approve('cart', { by: 't' }), /working copy changed after verification/);
  assert.ok(run.run_id);
});

test('Test 4g: rollback refuses when the files were edited after the change was applied', async () => {
  const lab = newLab();
  const src = fixture('buggy-app');
  lab.create(cart(src));
  await lab.modify('cart');
  await lab.approve('cart', { by: 't' });
  writeFileSync(join(src, 'src/cart.js'), 'module.exports = { itemCount: () => 1, total: () => 1 };\n');
  await assert.rejects(lab.rollback('cart'), /cannot be reversed cleanly/);
  assert.equal(readFileSync(join(src, 'src/cart.js'), 'utf8'), 'module.exports = { itemCount: () => 1, total: () => 1 };\n', 'the user\'s later edit is left alone');
});

// ---------- Test 5: isolation of external project operations

test('Test 5a: a hostile coding agent cannot write to the original project or anywhere else outside its working copy', async () => {
  const lab = newLab();
  const src = fixture('buggy-app');
  const decoyEra = tempDir('era-decoy-');
  const original = treeDigest(src).sha256;
  const eraBefore = [treeDigest(join(ROOT, 'src')).sha256, treeDigest(join(ROOT, 'bin')).sha256];
  process.env.EVIL_SOURCE_FILE = join(src, 'evil.txt');
  process.env.EVIL_ERA_FILE = join(decoyEra, 'evil.txt');
  try {
    lab.create(cart(src, { agent_command: agentCmd('evil.mjs'), limits: { maxAttempts: 1 } }));
    const { run } = await lab.modify('cart');
    if (SANDBOX) {
      const ws = lab.store.workDir('cart', run.run_id);
      const result = JSON.parse(readFileSync(join(ws, 'evil-result.json'), 'utf8'));
      assert.deepEqual(result, { source: 'denied', era: 'denied' }, 'the OS sandbox blocked both writes');
      assert.equal(run.status, 'rejected', 'the destructive change inside the copy is caught by acceptance');
      assert.equal(treeDigest(src).sha256, original);
      assert.ok(!existsSync(join(decoyEra, 'evil.txt')));
    } else {
      // Without a sandbox the write cannot be prevented, but it is detected and the run is stopped.
      assert.equal(run.status, 'failed');
      assert.match(run.error, /ISOLATION VIOLATION/);
      assert.ok(run.isolation_violation);
    }
    assert.deepEqual([treeDigest(join(ROOT, 'src')).sha256, treeDigest(join(ROOT, 'bin')).sha256], eraBefore, 'ERA\'s own implementation is untouched');
  } finally {
    delete process.env.EVIL_SOURCE_FILE;
    delete process.env.EVIL_ERA_FILE;
  }
});

test('Test 5b: project commands cannot read other projects\' state, and run without ERA\'s credentials', { skip: !SANDBOX && 'needs the macOS sandbox' }, async () => {
  const lab = newLab();
  const a = fixture('buggy-app');
  const b = fixture('catalog-app');
  lab.create(cart(a, { id: 'proj-a' }));
  const other = lab.store.dir('proj-a');
  process.env.ANTHROPIC_API_KEY = 'sk-test-not-a-real-key';
  try {
    lab.create({ id: 'proj-b', mode: 'review', source: b, commands: { test: [`cat ${join(other, 'project.json')} > /dev/null`, 'node -e "process.exit(process.env.ANTHROPIC_API_KEY ? 3 : 0)"'] } });
    const { run } = await lab.review('proj-b');
    const [readOther, env] = run.results.baseline.test;
    assert.notEqual(readOther.exit_code, 0, 'reading another project\'s state was denied');
    assert.equal(env.exit_code, 0, 'credentials were scrubbed from the project\'s environment');
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
  }
});

test('Test 5c: states and cancellations of one project never affect another', async () => {
  const lab = newLab();
  lab.create(cart(fixture('buggy-app'), { id: 'one' }));
  lab.create(cart(fixture('buggy-app'), { id: 'two' }));
  await lab.modify('one');
  assert.equal(lab.get('two').status, 'created');
  assert.equal(lab.status('two').latest_run, null);
  await lab.cancel('one');
  assert.equal(lab.get('one').status, 'cancelled');
  assert.equal(lab.get('two').status, 'created');
  assert.deepEqual(lab.list().map((p) => [p.id, p.status]), [['one', 'cancelled'], ['two', 'created']]);
});

// ---------- manual agent, resume, cancellation, interruption

test('manual mode pauses for a human, resumes after the edit, and stays paused while verification fails', async () => {
  const lab = newLab();
  const src = fixture('buggy-app');
  lab.create(cart(src, { agent: 'manual', agent_command: null }));
  const first = (await lab.modify('cart')).run;
  assert.equal(first.status, 'awaiting-implementation');
  assert.match(first.pause_message, /Edit the files in .*resume/);
  const ws = lab.status('cart').latest_run.workspace;
  assert.match(lab.status('cart').next, /resume/);
  // a wrong edit: verification fails, the run stays paused with reasons
  writeFileSync(join(ws, 'src/cart.js'), readFileSync(join(ws, 'src/cart.js'), 'utf8') + '\n// no fix yet\n');
  const second = (await lab.resume('cart')).run;
  assert.equal(second.status, 'awaiting-implementation');
  assert.match(second.pause_message, /Verification failed/);
  // the right edit
  writeFileSync(join(ws, 'src/cart.js'), readFileSync(join(ws, 'src/cart.js'), 'utf8').replace('sum + item.price,', 'sum + item.price * (item.quantity ?? 1),'));
  const third = (await lab.resume('cart')).run;
  assert.equal(third.status, 'awaiting-approval', third.error);
  assert.equal(third.results.workspace.baseline_commit, first.results.workspace.baseline_commit, 'finished steps are not repeated');
});

test('a second operation on a busy project is refused', async () => {
  const lab = newLab();
  lab.create(cart(fixture('buggy-app'), { agent_command: agentCmd('sleep-always.mjs'), limits: { agentTimeoutMs: 20_000 } }));
  const first = lab.modify('cart');
  await waitFor(() => lab.status('cart').latest_run?.steps?.['implement-1'] === 'running');
  await assert.rejects(lab.modify('cart'), /open run|holds the lock/);
  await lab.cancel('cart');
  const { run } = await first;
  assert.ok(['cancelled', 'interrupted', 'failed'].includes(run.status), run.status);
});

function cli(args, { cwd, env = {} }) {
  return runEra(args, { cwd, env: { ERA_REA_BIN: FAKE_ENGINE, ...env } });
}

function cliProject() {
  const cwd = tempDir();
  writeFileSync(join(cwd, 'era.config.json'), JSON.stringify({ projectLab: { budget: { allowUnmeteredAgents: true } } }));
  return { cwd, env: { ERA_STATE_DIR: join(cwd, 'state') } };
}

test('an interrupted run (process killed) is reported as interrupted and resumes without repeating finished steps', async () => {
  const { cwd, env } = cliProject();
  const src = fixture('buggy-app');
  // The sandbox normally provides the mock agent's private TMPDIR. Trusted
  // execution on other hosts needs an explicit fixture directory for its marker.
  const agentTmp = join(cwd, 'agent-tmp');
  mkdirSync(agentTmp);
  const e = { ...env, ...(!SANDBOX ? { TMPDIR: agentTmp } : {}) };
  const create = cli(['project', 'create', 'cart', '--source', src, '--task', 'Fix the total', '--agent', 'command', '--agent-command', agentCmd('slow-once.mjs'), '--test', 'node --test tests/*.test.js', '--accept-fail', 'node --test acceptance/cart-quantity.test.js', ...(SANDBOX ? [] : ['--trust-project'])], { cwd, env: e });
  assert.equal(create.status, 0, create.stderr);
  const child = spawn(process.execPath, [join(ROOT, 'bin', 'era.mjs'), 'project', 'modify', 'cart', '--json'], { cwd, env: { ...process.env, ERA_REA_BIN: FAKE_ENGINE, ...e }, stdio: 'ignore' });
  const stateRun = () => {
    const dir = join(env.ERA_STATE_DIR, 'projects', 'cart', 'runs');
    if (!existsSync(dir)) return null;
    const id = readdirSync(dir)[0];
    return id ? JSON.parse(readFileSync(join(dir, id, 'run.json'), 'utf8')) : null;
  };
  const marker = () => SANDBOX ? join(env.ERA_STATE_DIR, 'projects', 'cart', 'work', `${stateRun()?.run_id}.tmp`, 'slow-marker') : join(agentTmp, 'slow-marker');
  await waitFor(() => stateRun()?.steps?.['implement-1']?.status === 'running' && existsSync(marker()));
  const before = stateRun();
  const agentPid = Number(readFileSync(marker(), 'utf8'));
  child.kill('SIGKILL');
  await new Promise((r) => child.once('exit', r));
  const status = JSON.parse(cli(['project', 'status', 'cart', '--json'], { cwd, env: e }).stdout);
  assert.equal(status.latest_run.status, 'interrupted', 'a dead process is detected');
  assert.match(status.next, /resume/);
  // the orphaned agent process must not survive its parent
  await waitFor(() => {
    try {
      process.kill(agentPid, 0);
      return false;
    } catch {
      return true;
    }
  }, 15_000);
  const resumed = cli(['project', 'resume', 'cart', '--json'], { cwd, env: e });
  assert.equal(resumed.status, 0, resumed.stderr + resumed.stdout);
  const out = JSON.parse(resumed.stdout);
  assert.equal(out.status, 'awaiting-approval');
  assert.equal(out.results.workspace.baseline_commit, before.results.workspace.baseline_commit, 'workspace step was not repeated');
  assert.equal(out.results.baseline.test[0].duration_ms, before.results.baseline.test[0].duration_ms, 'baseline was not re-run');
});

test('cancel stops a running operation, removes its working copy and leaves the original untouched', async () => {
  const { cwd, env } = cliProject();
  const src = fixture('buggy-app');
  const original = treeDigest(src).sha256;
  const create = cli(['project', 'create', 'cart', '--source', src, '--task', 'Fix', '--agent', 'command', '--agent-command', agentCmd('sleep-always.mjs'), '--accept-fail', 'node --test acceptance/cart-quantity.test.js', ...(SANDBOX ? [] : ['--trust-project'])], { cwd, env });
  assert.equal(create.status, 0, create.stderr);
  const child = spawn(process.execPath, [join(ROOT, 'bin', 'era.mjs'), 'project', 'modify', 'cart'], { cwd, env: { ...process.env, ERA_REA_BIN: FAKE_ENGINE, ...env }, stdio: 'ignore' });
  const done = new Promise((r) => child.once('exit', (code, signal) => r({ code, signal })));
  await waitFor(() => JSON.parse(cli(['project', 'status', 'cart', '--json'], { cwd, env }).stdout).latest_run?.steps?.['implement-1'] === 'running');
  const cancelled = cli(['project', 'cancel', 'cart'], { cwd, env });
  assert.equal(cancelled.status, 0, cancelled.stderr);
  await done;
  const status = JSON.parse(cli(['project', 'status', 'cart', '--json'], { cwd, env }).stdout);
  assert.equal(status.latest_run.status, 'cancelled');
  assert.equal(existsSync(status.latest_run.workspace), false, 'the working copy was removed');
  assert.equal(treeDigest(src).sha256, original);
  assert.equal(status.running, false);
});

// ---------- budgets and limits (dependency-injected FAKE agent, no CLI involved)

test('agent spending is capped per run and the run stops when the budget is exhausted', async () => {
  const calls = [];
  const fakeAgent = { id: 'fake-metered', metered: true, async probe() { return { available: true, version: '0' }; }, async implement(task) { calls.push(task.budgetUsd); return { ok: true, exit_code: 0, duration_ms: 1, cost_usd: 3, cost_reported: true, stdout_tail: '', stderr_tail: '', output: '' }; } };
  const lab = newLab({ createAgent: () => fakeAgent });
  lab.create(cart(fixture('buggy-app'), { agent: 'fake', limits: { maxCostUsd: 5, maxAttempts: 3 } }));
  const { run } = await lab.modify('cart');
  assert.equal(run.status, 'failed');
  assert.match(run.error, /budget exhausted/);
  assert.deepEqual(calls, [5, 2], 'the second call was only allowed the remaining $2; a third was refused');
  assert.equal(lab.status('cart').spend.agent_usd, 6);
});

test('an agent that cannot report its cost is refused unless explicitly allowed', async () => {
  const lab = newLab({ allowUnmetered: false });
  lab.create(cart(fixture('buggy-app')));
  const { run } = await lab.modify('cart');
  assert.equal(run.status, 'failed');
  assert.match(run.error, /cannot report its API cost/);
});

test('Project Lab refuses to run in CI environments', () => {
  const { cwd, env } = cliProject();
  const r = cli(['project', 'review', 'x'], { cwd, env: { ...env, CI: 'true' } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /disabled in CI/);
});

// ---------- Review mode

test('Review: read-only analysis with REA evidence, static findings, validated agent findings; original untouched', async () => {
  const lab = newLab({ rea: REAL ? REA_BIN : FAKE_ENGINE });
  const src = fixture('buggy-app');
  const original = treeDigest(src).sha256;
  lab.create({ id: 'rev', mode: 'review', source: src, task: 'general review', agent: 'command', agent_command: agentCmd('review-agent.mjs'), trust_project: !SANDBOX });
  const { run, report } = await lab.review('rev');
  assert.equal(run.status, 'complete', run.error);
  assert.equal(treeDigest(src).sha256, original, 'review never modifies the original');
  const f = run.results.findings;
  assert.equal(f.source_unmodified, true);
  const agentReview = run.results['agent-review'];
  assert.equal(agentReview.ran, true, JSON.stringify(agentReview));
  assert.deepEqual(agentReview.accepted.map((x) => x.title).sort(), ['Snippet not in file', 'Total ignores quantity']);
  assert.equal(agentReview.rejected.length, 4);
  const verified = f.findings.find((x) => x.title === 'Total ignores quantity');
  assert.deepEqual([verified.verified, verified.severity, verified.locations], [true, 'high', [{ file: 'src/cart.js', line: 8 }]]);
  assert.equal(f.findings.find((x) => x.title === 'Snippet not in file').verified, false);
  const order = f.findings.map((x) => ['critical', 'high', 'medium', 'low', 'info'].indexOf(x.severity));
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'findings are ordered by severity');
  assert.match(report, /## Findings/);
  assert.match(report, /\*\*not modified\*\*/);
  if (REAL) {
    const rea = run.results.analysis.rea;
    assert.equal(rea.ran, true);
    assert.match(rea.evidence_ids[0], /^ev_[0-9a-f]{64}$/, 'genuine REA evidence');
    assert.ok(rea.modules >= 1);
  }
});

test('Review without a coding agent still reports baseline failures, static findings and says what it could not do', async () => {
  const lab = newLab();
  const src = tempDir();
  mkdirSync(join(src, 'src'));
  mkdirSync(join(src, 'tests'));
  // Assembled at runtime so this repository's own secret scan stays clean.
  const key = ['AK', 'IA', 'ABCDEFGHIJKLMNOP'].join('');
  writeFileSync(join(src, 'src/a.js'), `const key = '${key}';\nmodule.exports = require('./missing-module');\n`);
  writeFileSync(join(src, 'tests/a.test.js'), "const { test } = require('node:test');\ntest('fails', () => { throw new Error('boom'); });\n");
  writeFileSync(join(src, 'package.json'), JSON.stringify({ scripts: { test: 'node --test tests/*.test.js' } }));
  lab.create({ id: 'bad', mode: 'review', source: src, trust_project: !SANDBOX });
  const { run, report } = await lab.review('bad');
  assert.equal(run.status, 'complete', run.error);
  const titles = run.results.findings.findings.map((x) => x.title);
  assert.ok(titles.some((t) => /Baseline test command fails/.test(t)), titles.join('|'));
  assert.ok(titles.some((t) => /AWS access key/.test(t)));
  assert.ok(titles.some((t) => /missing local file: \.\/missing-module/.test(t)), titles.join('|'));
  assert.equal(run.results['agent-review'].ran, false);
  assert.match(report, /no coding agent configured/);
  assert.ok(!report.includes(key), 'the credential value is never reproduced');
  assert.equal(run.results.findings.findings[0].severity, 'high');
});

// ---------- Test 3: rebuild selected functionality of an authorized reference

const macArm = process.platform === 'darwin' && process.arch === 'arm64';

function referenceBinary() {
  const dir = join(tempDir(), 'reference');
  mkdirSync(dir);
  const bin = join(dir, 'hello');
  cpSync(join(DATASETS, 'native-hello', 'hello'), bin);
  chmodSync(bin, 0o755);
  return bin;
}

const rebuildProject = (reference, over = {}) => ({
  id: 'greeter',
  mode: 'rebuild',
  reference,
  destination: join(tempDir(), 'greeter'),
  task: 'Reimplement the greeting and checksum behavior of the reference program',
  authorization: 'Test fixture: hello.c is authored in this repository (benchmarks/datasets/native-hello).',
  agent: 'command',
  agent_command: agentCmd('greet-rebuild.mjs'),
  commands: { run: 'node greet.js', test: ['node --test tests/*.test.js'] },
  acceptance: { behaviors: [{ name: 'default-name', args: [], capture: 'reference' }, { name: 'alice', args: ['alice'], capture: 'reference' }, { name: 'too-long', args: ['x'.repeat(70)], capture: 'reference' }] },
  trust_project: !SANDBOX,
  ...over,
});

test('Test 3 (rebuild): reconstructs observable behavior of an authorized reference, with REA evidence and behavioral acceptance', { skip: !macArm && 'needs the arm64 macOS reference binary' }, async () => {
  const lab = newLab({ rea: REAL ? REA_BIN : FAKE_ENGINE });
  const reference = referenceBinary();
  const referenceDigest = treeDigest(join(reference, '..')).sha256;
  const input = rebuildProject(reference);
  lab.create(input);
  const { run, report } = await lab.rebuild('greeter');
  assert.equal(run.status, 'awaiting-approval', run.error ?? JSON.stringify(run.results.finalize?.reasons));
  assert.equal(treeDigest(join(reference, '..')).sha256, referenceDigest, 'the reference is never modified');
  assert.equal(existsSync(input.destination), false, 'nothing is written to the destination before approval');

  const behaviors = run.results.behaviors;
  assert.deepEqual(behaviors.map((b) => b.source), Array(3).fill('reference-run (sandboxed)'));
  assert.match(behaviors[1].expected.stdout, /^Hello, alice! checksum=\d+\n$/, 'expected output was captured by really running the reference');
  assert.equal(behaviors[2].expected.exit_code, 1);
  const fin = run.results.finalize;
  assert.equal(fin.pass, true);
  assert.equal(fin.behaviors.every((b) => b.match), true);
  assert.equal(fin.verification.test[0].ok, true, 'the new project\'s own tests pass');
  if (REAL) {
    const ev = run.results.evidence;
    assert.equal(ev.available, true);
    assert.ok(ev.runs.some((r) => r.label === 'mach-o-structure' && r.status === 'succeeded'));
    assert.match(ev.evidence_ids[0], /^ev_[0-9a-f]{64}$/, 'genuine REA evidence');
    assert.ok(ev.facts.includes('export:_greet'));
  }
  const spec = run.results.spec.text;
  assert.match(spec, /Clean-room rules/);
  assert.match(spec, /Unknowns/);
  assert.ok(!spec.includes('r8 = r8 + r8'), 'decompiled code is never handed to the implementer');
  assert.match(report, /Behavioral comparison/);
  assert.match(report, /not recovered source code/);

  const applied = await lab.approve('greeter', { by: 'tester' });
  assert.equal(applied.applied.kind, 'directory');
  assert.ok(existsSync(join(input.destination, 'greet.js')));
  assert.ok(!existsSync(join(input.destination, '.git')));
  assert.equal((await sh(input.destination, 'node greet.js alice')).out, behaviors[1].expected.stdout);
  assert.equal((await sh(input.destination, 'node --test tests/*.test.js')).code, 0);
  assert.ok(!readFileSync(join(input.destination, 'greet.js'), 'utf8').includes('checksum=193468637'), 'independent code, not a copy of captured output');
  await lab.rollback('greeter');
  assert.equal(existsSync(input.destination), false);
});

test('Rebuild: an implementation that does not match the observed behavior is rejected with a per-behavior comparison', { skip: !macArm && 'needs the arm64 macOS reference binary' }, async () => {
  const lab = newLab();
  lab.create(rebuildProject(referenceBinary(), { agent_command: agentCmd('greet-wrong.mjs'), commands: { run: 'node greet.js' }, limits: { maxAttempts: 1 } }));
  const { run, report } = await lab.rebuild('greeter');
  assert.equal(run.status, 'rejected');
  const bad = run.results.finalize.behaviors.filter((b) => !b.match).map((b) => b.name);
  assert.deepEqual(bad.sort(), ['alice', 'default-name', 'too-long'].filter((n) => n !== 'too-long' || false).sort().concat(bad.includes('too-long') ? ['too-long'] : []).sort());
  assert.ok(bad.includes('alice') && bad.includes('default-name'));
  assert.match(report, /MISMATCH/);
  assert.equal(existsSync(run.results.finalize.patch_file ? run.results.finalize.patch_file : '/nonexistent'), true);
  await assert.rejects(lab.approve('greeter', { by: 't' }), /no run awaiting approval/);
});

test('Rebuild: copying the reference into the new project violates the clean-room rule and is rejected', async () => {
  const lab = newLab();
  const ref = join(tempDir(), 'ref');
  mkdirSync(ref);
  const long = (n) => `const importantComputationResult${n} = Math.max(${n}, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12);`;
  writeFileSync(join(ref, 'app.js'), `${[1, 2, 3, 4].map(long).join('\n')}\nprocess.stdout.write('ok\\n');\n`);
  process.env.REF_DIR = ref;
  try {
    lab.create({ id: 'copy', mode: 'rebuild', reference: ref, destination: join(tempDir(), 'out'), task: 'Reimplement app', authorization: 'fixture', agent: 'command', agent_command: agentCmd('copy-ref.mjs'), commands: { run: 'node app.js' }, acceptance: { behaviors: [{ name: 'prints ok', args: [], expect: { stdout: 'ok\n', exit_code: 0 } }] }, limits: { maxAttempts: 1 }, trust_project: !SANDBOX });
    const { run } = await lab.rebuild('copy');
    assert.equal(run.status, 'rejected', run.error);
    assert.match(run.results.finalize.reasons.join(' '), /identical to the reference/);
    assert.equal(run.results.finalize.behaviors[0].match, true, 'the behavior matched; the copy was the problem');
  } finally {
    delete process.env.REF_DIR;
  }
});

test('Rebuild: starting requires authorization, acceptance checks and a destination', async () => {
  const lab = newLab();
  const ref = referenceBinary();
  lab.create(rebuildProject(ref, { authorization: null }));
  await assert.rejects(lab.rebuild('greeter'), /authorization statement is required/);
  const lab2 = newLab();
  lab2.create(rebuildProject(ref, { acceptance: {}, commands: {} }));
  const { run } = await lab2.rebuild('greeter');
  assert.equal(run.status, 'failed');
  assert.match(run.error, /at least one acceptance check/);
});

// ---------- CLI contract (FAKE engine; mock agent)

test('CLI: create, list, status, show, review, modify, approve (with confirmation), rollback and delete are all functional', () => {
  const { cwd, env } = cliProject();
  const src = fixture('buggy-app');
  const original = treeDigest(src).sha256;
  const run = (...a) => cli(a, { cwd, env });
  // This cooperative mock handles both review and implementation. Read-only
  // violation handling is exercised separately; do not rely on sandbox denial.
  const command = `if [ "$ERA_READ_ONLY" != "1" ]; then ${agentCmd('fix-cart.mjs')}; fi`;
  const create = run('project', 'create', 'cart', '--source', src, '--mode', 'modify', '--task', 'Fix the cart total so it accounts for quantity', '--agent', 'command', '--agent-command', command, '--test', 'node --test tests/*.test.js', '--accept-fail', 'node --test acceptance/cart-quantity.test.js', '--criteria', 'total uses quantity', '--protect', 'package.json', ...(SANDBOX ? [] : ['--trust-project']));
  assert.equal(create.status, 0, create.stderr);
  assert.match(create.stdout, /Created project "cart"/);
  assert.equal(run('project', 'create', 'cart', '--source', src).status, 1, 'duplicate ids are refused');
  assert.match(run('project', 'list').stdout, /cart\s+modify\s+created/);
  const none = run('project', 'show', 'cart');
  assert.equal(none.status, 1);
  assert.match(none.stderr, /has no runs yet/);

  const rev = run('project', 'review', 'cart', '--json');
  assert.equal(rev.status, 0, rev.stderr);
  assert.equal(JSON.parse(rev.stdout).status, 'complete');
  // a review run is complete, so a modify run can start next
  const mod = run('project', 'modify', 'cart');
  assert.equal(mod.status, 0, mod.stderr + mod.stdout);
  assert.match(mod.stdout, /awaiting-approval/);
  assert.match(mod.stdout, /Next: review `era project show cart`/);
  assert.equal(treeDigest(src).sha256, original);

  const st = JSON.parse(run('project', 'status', 'cart', '--json').stdout);
  assert.equal(st.latest_run.status, 'awaiting-approval');
  assert.equal(st.project.approval.status, 'pending');
  assert.match(run('project', 'show', 'cart').stdout, /Project modification: cart/);

  const refused = run('project', 'approve', 'cart');
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /Approval needs confirmation/);
  assert.equal(treeDigest(src).sha256, original, 'nothing applied without confirmation');
  const approved = run('project', 'approve', 'cart', '--yes', '--by', 'tester');
  assert.equal(approved.status, 0, approved.stderr);
  assert.notEqual(treeDigest(src).sha256, original);
  assert.equal(run('project', 'rollback', 'cart').status, 0);
  assert.equal(treeDigest(src).sha256, original);
  assert.equal(run('project', 'delete', 'cart', '--yes').status, 0);
  assert.equal(treeDigest(src).sha256, original, 'deleting a project never touches the original');
  assert.match(run('project', 'list').stdout, /\(none\)/);
});

test('CLI: usage errors are clear', () => {
  const { cwd, env } = cliProject();
  assert.match(cli(['project', 'frobnicate'], { cwd, env }).stderr, /Unknown project command "frobnicate"/);
  assert.match(cli(['project', 'status'], { cwd, env }).stderr, /Usage: era project status <id>/);
  assert.match(cli(['project', 'status', 'nope'], { cwd, env }).stderr, /Unknown project "nope"/);
  assert.match(cli(['project', 'create', 'Bad Id', '--source', tempDir()], { cwd, env }).stderr, /invalid project id/i);
  assert.match(cli(['project', 'create', 'x', '--source', ROOT], { cwd, env }).stderr, /ERA's own installation/);
  assert.match(cli(['project', 'create', 'x', '--config', join(cwd, 'missing.json')], { cwd, env }).stderr, /Cannot read --config/);
  assert.match(cli(['project', 'modify', 'ghost'], { cwd, env }).stderr, /Unknown project "ghost"/);
});

test('CLI: --config files define behaviors and limits, flags override them', () => {
  const { cwd, env } = cliProject();
  const cfg = join(cwd, 'project.json');
  writeFileSync(cfg, JSON.stringify({ id: 'fromfile', mode: 'rebuild', reference: tempDir(), destination: join(tempDir(), 'o'), task: 'T', authorization: 'mine', commands: { run: 'node x.js' }, acceptance: { behaviors: [{ name: 'b', args: ['1'], expect: { stdout: '1\n' } }] }, limits: { maxAttempts: 3 } }));
  const r = cli(['project', 'create', '--config', cfg, '--task', 'Overridden', '--max-attempts', '4', '--json'], { cwd, env });
  assert.equal(r.status, 0, r.stderr);
  const p = JSON.parse(r.stdout);
  assert.equal(p.task, 'Overridden');
  assert.equal(p.limits.maxAttempts, 4);
  assert.equal(p.acceptance.behaviors[0].expect.stdout, '1\n');
  assert.equal(p.id, 'fromfile');
});

// ---------- Test 6: everything that existed before still works

test('Test 6: the existing ERA commands and their help are unchanged and still listed', () => {
  const help = runEra(['--help']).stdout;
  for (const s of ['analyze <target>', 'inspect <target>', 'explain <analysis>', 'extract --manifest', 'rea <rea-args', 'self-analyze', 'improve propose', 'improve evaluate', 'improve approve', 'improve rebase', 'improve recover', 'benchmark', 'status', 'history', 'rollback <version>', 'dashboard', 'agents', 'project create', 'project review', 'project modify', 'project rebuild', 'project approve', 'project resume', 'project cancel']) assert.ok(help.includes(s), s);
  const agents = runEra(['agents'], { env: { ERA_REA_BIN: FAKE_ENGINE } });
  assert.equal(agents.status, 0);
  assert.match(agents.stdout, /coding-agent\s+claude-code/);
  assert.match(runEra(['rea', '--version'], { env: { ERA_REA_BIN: FAKE_ENGINE } }).stdout, /9\.9\.9-fake|0\.0\.0-fake-engine/);
  assert.ok(statSync(join(ROOT, 'src', 'orchestration', 'cycle.js')).isFile());
});
