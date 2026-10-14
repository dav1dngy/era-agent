import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vm from '../src/orchestration/versions.js';
import { appendLedger, readLedger, pendingCycles, decidedCycles, awaitingApproval } from '../src/orchestration/ledger.js';
import { initRepo, tempDir } from './helpers.js';

test('experiment worktree, promotion and tagging', async () => {
  const { dir, git } = initRepo();
  assert.equal(await vm.currentVersion(dir), 'era-v1');
  assert.equal(await vm.nextVersionTag(dir), 'era-v2');
  const base = await vm.headCommit(dir);
  const wt = join(dir, '.era', 'worktrees', 'c1');
  const { branch } = await vm.createExperimentWorktree(dir, { id: 'c1', path: wt, baseCommit: base });
  git('-C', wt, 'config', 'user.name', 'ERA Test');
  writeFileSync(join(wt, 'file.txt'), 'v2\n');
  assert.ok(await vm.commitAll(wt, 'change'));
  assert.equal(await vm.commitAll(wt, 'nothing'), null);
  assert.equal(await vm.commitsAhead(dir, base, branch), 1);
  assert.deepEqual(await vm.changedFiles(dir, base, branch), ['file.txt']);
  await vm.promote(dir, branch, 'accept');
  await vm.tagVersion(dir, 'era-v2', 'era-v2: change');
  await vm.removeWorktree(dir, wt);
  assert.equal(readFileSync(join(dir, 'file.txt'), 'utf8'), 'v2\n');
  assert.deepEqual((await vm.listVersions(dir)).map((v) => v.tag), ['era-v1', 'era-v2']);
  assert.equal(await vm.currentVersion(dir), 'era-v2');
});

test('rollback restores an earlier tree as a new commit, including deletions', async () => {
  const { dir, git } = initRepo();
  writeFileSync(join(dir, 'file.txt'), 'v2\n');
  writeFileSync(join(dir, 'added.txt'), 'new\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'v2');
  git('tag', '-a', 'era-v2', '-m', 'era-v2');
  const before = git('rev-list', '--count', 'HEAD');
  const r = await vm.rollbackTo(dir, 'era-v1');
  assert.ok(r.commit);
  assert.equal(readFileSync(join(dir, 'file.txt'), 'utf8'), 'v1\n');
  assert.equal(git('ls-files'), '.gitignore\nfile.txt');
  assert.equal(Number(git('rev-list', '--count', 'HEAD')), Number(before) + 1, 'history is preserved');
  assert.equal((await vm.rollbackTo(dir, 'era-v1')).unchanged, true);
  await assert.rejects(vm.rollbackTo(dir, 'era-v99'), /Unknown version/);
});

test('assertStable refuses dirty trees and non-stable branches', async () => {
  const { dir, git } = initRepo();
  writeFileSync(join(dir, 'file.txt'), 'dirty\n');
  await assert.rejects(vm.assertStable(dir), /uncommitted/);
  git('checkout', '-q', '--', 'file.txt');
  git('checkout', '-q', '-b', 'feature');
  await assert.rejects(vm.assertStable(dir), /stable branch/);
});

test('ledger tracks pending and decided cycles', () => {
  const dir = tempDir();
  appendLedger(dir, { type: 'cycle-proposed', cycle_id: 'a' });
  appendLedger(dir, { type: 'cycle-proposed', cycle_id: 'b' });
  appendLedger(dir, { type: 'cycle-decided', cycle_id: 'a', accepted: true });
  const events = readLedger(dir);
  assert.deepEqual(pendingCycles(events).map((e) => e.cycle_id), ['b']);
  assert.equal(decidedCycles(events).length, 1);
  assert.deepEqual(readLedger(join(dir, 'missing')), []);
});

test('ledger state follows the latest event per cycle (rebase and re-evaluation)', () => {
  const dir = tempDir();
  appendLedger(dir, { type: 'cycle-proposed', cycle_id: 'c' });
  appendLedger(dir, { type: 'cycle-decided', cycle_id: 'c', status: 'awaiting-approval' });
  assert.deepEqual(awaitingApproval(readLedger(dir)).map((e) => e.cycle_id), ['c']);
  appendLedger(dir, { type: 'cycle-rebased', cycle_id: 'c' });
  assert.deepEqual(pendingCycles(readLedger(dir)).map((e) => e.cycle_id), ['c']);
  assert.equal(awaitingApproval(readLedger(dir)).length, 0);
  appendLedger(dir, { type: 'cycle-decided', cycle_id: 'c', status: 'awaiting-approval' });
  appendLedger(dir, { type: 'cycle-approved', cycle_id: 'c' });
  const events = readLedger(dir);
  assert.equal(decidedCycles(events).length, 1, 'a re-evaluated cycle counts once');
  assert.equal(pendingCycles(events).length, 0);
  assert.equal(awaitingApproval(events).length, 0);
});

test('approval refuses a branch that moved after evaluation and integrates only the evaluated commit', async (t) => {
  // This test approves only its disposable repository. Exercise artifact identity
  // independently of the host's CI policy, which has its own refusal tests.
  const ciEnv = { CI: process.env.CI, GITHUB_ACTIONS: process.env.GITHUB_ACTIONS };
  t.after(() => {
    for (const [key, value] of Object.entries(ciEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  delete process.env.CI;
  delete process.env.GITHUB_ACTIONS;
  const { approveCycle } = await import('../src/orchestration/cycle.js');
  const { loadConfig } = await import('../src/core/config.js');
  const { writeJson } = await import('../src/core/util.js');
  const { dir, git } = initRepo();
  const base = await vm.headCommit(dir);
  git('checkout', '-q', '-b', 'experiment/c1');
  writeFileSync(join(dir, 'file.txt'), 'evaluated\n');
  git('commit', '-qam', 'evaluated change');
  const evaluatedRef = await vm.candidateIdentity(dir, base, 'experiment/c1');
  writeFileSync(join(dir, 'file.txt'), 'unevaluated\n');
  git('commit', '-qam', 'later change');
  git('checkout', '-q', 'main');
  const config = loadConfig(dir, {});
  writeJson(join(config.stateDirAbs, 'cycles', 'c1', 'cycle.json'), { cycle_id: 'c1', status: 'awaiting-approval', base_commit: base, branch: 'experiment/c1', worktree: join(dir, '.era', 'wt'), proposal: { finding: { id: 'F-1' }, hypothesis: 'h' }, evaluation: { candidate_ref: evaluatedRef } });
  await assert.rejects(approveCycle({ root: dir, config, cycleId: 'c1', approver: 't' }), /changed after evaluation/);
  assert.equal(await vm.headCommit(dir), base, 'stable branch untouched');
  assert.deepEqual((await vm.listVersions(dir)).map((v) => v.tag), ['era-v1'], 'no tag created');
  // Restore the branch to the evaluated commit: approval now integrates exactly that tree.
  git('branch', '-f', 'experiment/c1', evaluatedRef.commit);
  const done = await approveCycle({ root: dir, config, cycleId: 'c1', approver: 't' });
  assert.equal(done.status, 'integrated');
  assert.equal(readFileSync(join(dir, 'file.txt'), 'utf8'), 'evaluated\n');
});

test('a crash during integration is completed idempotently by recovery (audit F06)', async () => {
  const { recoverState } = await import('../src/orchestration/cycle.js');
  const { loadConfig } = await import('../src/core/config.js');
  const { writeJson } = await import('../src/core/util.js');
  const { dir, git } = initRepo();
  const base = await vm.headCommit(dir);
  git('checkout', '-q', '-b', 'experiment/c2');
  writeFileSync(join(dir, 'file.txt'), 'candidate\n');
  git('commit', '-qam', 'candidate');
  const cand = await vm.headCommit(dir);
  git('checkout', '-q', 'main');
  const config = loadConfig(dir, {});
  const cycleFile = join(config.stateDirAbs, 'cycles', 'c2', 'cycle.json');
  const record = (status, extra = {}) => writeJson(cycleFile, { cycle_id: 'c2', status, base_commit: base, branch: 'experiment/c2', worktree: join(dir, 'nowhere'), proposal: { finding: { id: 'F' }, hypothesis: 'h' }, integrating: { tag: 'era-v2', commit: cand, approver: 'm', at: 'now' }, ...extra });
  // Crash before the merge: recovery returns the cycle to awaiting-approval.
  record('integrating');
  assert.match((await recoverState({ root: dir, config })).join(), /back to awaiting-approval/);
  // Crash after the merge, before the tag and state update: recovery completes it once.
  record('integrating');
  git('merge', '--no-ff', '-q', '-m', 'integrate', cand);
  assert.match((await recoverState({ root: dir, config })).join(), /completed interrupted integration as era-v2/);
  assert.deepEqual((await vm.listVersions(dir)).map((v) => v.tag), ['era-v1', 'era-v2']);
  assert.deepEqual(await recoverState({ root: dir, config }), [], 'idempotent');
});
