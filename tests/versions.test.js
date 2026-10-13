import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vm from '../src/orchestration/versions.js';
import { appendLedger, readLedger, pendingCycles, decidedCycles } from '../src/orchestration/ledger.js';
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
