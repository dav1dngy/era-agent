import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { testGroups, stagePasses } from '../src/self_analysis/self-analyze.js';
import { tempDir } from './helpers.js';

function fakeRepo() {
  const root = tempDir();
  mkdirSync(join(root, 'tests', 'fixtures'), { recursive: true });
  const sizes = { 'a.test.js': 400, 'b.test.js': 300, 'c.test.js': 200, 'd.test.js': 100, 'helpers.js': 10 };
  for (const [f, n] of Object.entries(sizes)) writeFileSync(join(root, 'tests', f), 'x'.repeat(n));
  writeFileSync(join(root, 'tests', 'fixtures', 'x.json'), '{}');
  const pkg = join(root, 'pkg');
  mkdirSync(join(pkg, 'src'), { recursive: true });
  writeFileSync(join(pkg, 'src', 'm.js'), '');
  return { root, pkg };
}

test('testGroups balances test files by size and keeps support files shared', () => {
  const { root } = fakeRepo();
  const { support, groups } = testGroups(join(root, 'tests'), 3);
  assert.deepEqual(support, ['fixtures', 'helpers.js']);
  // 400 -> g1, 300 -> g2, 200 -> g2 (lighter), 100 -> g1 (lighter): totals 500/500.
  assert.deepEqual(groups, [['a.test.js', 'd.test.js'], ['b.test.js', 'c.test.js']]);
  assert.deepEqual(testGroups(join(root, 'tests'), 1).groups, [['a.test.js'], ['b.test.js'], ['c.test.js'], ['d.test.js']]);
  assert.deepEqual(testGroups(join(root, 'missing')), { support: [], groups: [] });
});

test('stagePasses copies the package, support files and one group per pass', () => {
  const { root, pkg } = fakeRepo();
  const passes = stagePasses(pkg, root, join(root, 'work'), 3);
  assert.equal(passes.length, 2);
  for (const p of passes) {
    assert.ok(existsSync(join(p.dir, 'src', 'm.js')));
    assert.ok(existsSync(join(p.dir, 'tests', 'helpers.js')));
    assert.ok(existsSync(join(p.dir, 'tests', 'fixtures', 'x.json')));
  }
  assert.deepEqual(passes.map((p) => p.tests), [['a.test.js', 'd.test.js'], ['b.test.js', 'c.test.js']]);
  assert.ok(existsSync(join(passes[0].dir, 'tests', 'd.test.js')));
  assert.ok(!existsSync(join(passes[1].dir, 'tests', 'a.test.js')));
});
