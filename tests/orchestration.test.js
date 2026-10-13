import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runImplementer } from '../src/improvement/modification.js';
import { renderCycleReport, loadCycle } from '../src/orchestration/cycle.js';
import { renderBenchmarkTable } from '../src/reporting/table.js';
import { renderDashboard } from '../src/reporting/dashboard.js';
import { ReaClient } from '../src/rea_integration/rea-client.js';
import { loadConfig } from '../src/core/config.js';
import { writeJson } from '../src/core/util.js';
import { initRepo, tempDir, FAKE_REA } from './helpers.js';

test('runImplementer runs in the worktree, passes the proposal and commits changes', async () => {
  const { dir, git } = initRepo();
  const proposal = join(tempDir(), 'cycle.json');
  writeFileSync(proposal, '{"id":"c"}');
  const r = await runImplementer({ command: 'cat "$ERA_PROPOSAL_FILE" > got.json && echo "$ERA_CYCLE_ID" >> got.json', worktree: dir, proposalFile: proposal, instructionsFile: proposal, timeoutMs: 10_000, cycleId: 'c1' });
  assert.equal(r.ok, true);
  assert.ok(r.commit);
  assert.equal(readFileSync(join(dir, 'got.json'), 'utf8'), '{"id":"c"}c1\n');
  assert.match(git('log', '-1', '--format=%s'), /experiment c1: implementer changes/);
});

test('runImplementer reports failures and timeouts', async () => {
  const { dir } = initRepo();
  const failed = await runImplementer({ command: 'exit 3', worktree: dir, proposalFile: '', instructionsFile: '', timeoutMs: 10_000, cycleId: 'c2' });
  assert.equal(failed.ok, false);
  assert.equal(failed.exit_code, 3);
  assert.equal(failed.commit, null);
  const slow = await runImplementer({ command: 'sleep 5', worktree: dir, proposalFile: '', instructionsFile: '', timeoutMs: 200, cycleId: 'c3' });
  assert.equal(slow.timed_out, true);
});

const aggregate = { accuracy_f1: 0.9, precision: 1, completeness_recall: 0.8, total_median_wall_ms: 1000, total_median_cpu_s: 1.5, max_rss_bytes: 2 * 1024 * 1024, error_rate: 0, reliability: 1, rea_runs: 4 };

test('benchmark table and cycle report render measured values', () => {
  const table = renderBenchmarkTable([{ label: 'era-v1', repetitions: 3, aggregate, cases: [{ id: 'x', f1: 0.9 }] }], '6.4.0');
  assert.match(table, /ERA Benchmark Results \(rea-agents 6\.4\.0, 3 repetitions per case\)/);
  assert.match(table, /Accuracy \(F1\)\s+0\.900/);
  assert.match(table, /Peak memory \(MB RSS\)\s+2\.0/);
  const md = renderCycleReport({
    cycle_id: 'c', status: 'rejected', base_version: 'era-v1', base_commit: 'abcdef0123456789', branch: 'experiment/c',
    proposal: { finding: { id: 'F-1', title: 't' }, area: 'reliability', hypothesis: 'h', target: { metric: 'finding_resolved', finding_id: 'F-1' } },
    evaluation: { summary: 'rejected: x', target: { observed: 'still present' }, guards: [{ name: 'g', ok: false, detail: 'd' }], baseline: { aggregate }, candidate: { aggregate }, baselineTests: { passed: 1 }, candidateTests: { passed: 2 } },
  });
  assert.match(md, /Status: \*\*rejected\*\*/);
  assert.match(md, /\| g \| FAIL \| d \|/);
  assert.match(md, /\| tests passed \| 1 \| 2 \|/);
});

test('loadCycle rejects unknown cycles', () => {
  assert.throws(() => loadCycle(tempDir(), 'nope'), /Unknown cycle/);
});

test('dashboard renders local state without a server', async () => {
  const { dir } = initRepo();
  const config = loadConfig(dir, {});
  writeJson(join(config.stateDirAbs, 'cycles', 'c1', 'cycle.json'), { cycle_id: 'c1', status: 'accepted', version: 'era-v2', proposal: { finding: { title: 'Finding <b>' }, area: 'reliability' }, evaluation: { summary: 'accepted' } });
  const rea = new ReaClient({ command: FAKE_REA, stateDir: config.stateDirAbs, measureResources: false });
  const html = await renderDashboard({ config, rea });
  assert.match(html, /<title>ERA Dashboard<\/title>/);
  assert.match(html, /Finding &lt;b&gt;/);
  assert.match(html, /era-v1/);
});

test('interrupt guard terminates child process groups and raises InterruptedError', async () => {
  const { EventEmitter } = await import('node:events');
  const { createInterruptGuard, InterruptedError } = await import('../src/orchestration/interrupt.js');
  const { runProcess } = await import('../src/core/process.js');
  const proc = new EventEmitter();
  const guard = createInterruptGuard(proc);
  const pending = runProcess(process.execPath, ['-e', 'setInterval(()=>{}, 1000)'], { timeoutMs: 30_000 });
  await new Promise((r) => setTimeout(r, 200));
  assert.doesNotThrow(() => guard.check());
  proc.emit('SIGINT', 'SIGINT');
  assert.equal((await pending).signal, 'SIGTERM');
  assert.throws(() => guard.check(), InterruptedError);
  guard.dispose();
  assert.equal(proc.listenerCount('SIGINT'), 0);
});
