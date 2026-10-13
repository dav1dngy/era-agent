import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { directLocalImports, planPasses, stagePass, stagePasses, PLACEHOLDER } from '../src/self_analysis/self-analyze.js';
import { tempDir } from './helpers.js';

function universe() {
  const root = tempDir();
  const write = (f, text) => {
    mkdirSync(join(root, f, '..'), { recursive: true });
    writeFileSync(join(root, f), text);
  };
  write('package.json', '{"name":"x","type":"module"}');
  write('bin/cli.mjs', "import '../src/a.js';\n");
  write('src/a.js', `import { b } from './b.js';\nexport const lazy = () => import('./c.js');\n${'// pad\n'.repeat(40)}`);
  write('src/b.js', "export * from './c.js';\nexport const b = require('./missing.js');\n");
  write('src/c.js', 'export const c = 1;\n');
  write('tests/a.test.js', "import { b } from '../src/b.js';\n");
  return root;
}

test('directLocalImports finds static, dynamic, re-export and require specifiers that exist', () => {
  const root = universe();
  assert.deepEqual(directLocalImports(root, 'src/a.js'), ['src/b.js', 'src/c.js']);
  assert.deepEqual(directLocalImports(root, 'src/b.js'), ['src/c.js']);
  assert.deepEqual(directLocalImports(root, 'bin/cli.mjs'), ['src/a.js']);
});

test('planPasses gives every file exactly one pass within the byte budget, with placeholders for other passes', () => {
  const root = universe();
  const passes = planPasses(root, 300);
  const focus = passes.flatMap((p) => p.focus);
  assert.deepEqual(focus.sort(), ['bin/cli.mjs', 'src/a.js', 'src/b.js', 'src/c.js', 'tests/a.test.js']);
  assert.equal(new Set(focus).size, focus.length, 'no file is analyzed twice');
  assert.ok(passes.length > 1);
  for (const p of passes) {
    assert.ok(p.focus.length === 1 || p.bytes <= 300, `pass over budget: ${p.bytes}`);
    for (const ph of p.placeholders) assert.ok(!p.focus.includes(ph));
  }
  const withA = passes.find((p) => p.focus.includes('src/a.js'));
  for (const dep of ['src/b.js', 'src/c.js']) assert.ok(withA.focus.includes(dep) || withA.placeholders.includes(dep), dep);
  assert.equal(planPasses(root, 1e9).length, 1);
});

test('stagePass writes focus files verbatim and placeholders without code', () => {
  const root = universe();
  const dest = stagePass(root, join(tempDir(), 'p'), { focus: ['src/a.js'], placeholders: ['src/b.js', 'src/c.js'] });
  assert.equal(readFileSync(join(dest, 'src/a.js'), 'utf8'), readFileSync(join(root, 'src/a.js'), 'utf8'));
  assert.equal(readFileSync(join(dest, 'src/b.js'), 'utf8'), PLACEHOLDER);
  assert.ok(existsSync(join(dest, 'package.json')));
  assert.ok(!existsSync(join(dest, 'tests')));
});

test('stagePasses stages the packed artifact plus JavaScript tests only', () => {
  const root = universe();
  const pkg = join(root, 'pkg');
  mkdirSync(join(pkg, 'src'), { recursive: true });
  writeFileSync(join(pkg, 'src', 'm.js'), 'export const m = 1;\n');
  mkdirSync(join(root, 'tests', 'fixtures'), { recursive: true });
  writeFileSync(join(root, 'tests', 'fixtures', 'data.json'), '{}');
  writeFileSync(join(root, 'tests', 'fixtures', 'tool.mjs'), '');
  const passes = stagePasses(pkg, root, join(tempDir(), 'work'));
  const all = passes.flatMap((p) => p.focus).sort();
  assert.deepEqual(all, ['src/m.js', 'tests/a.test.js', 'tests/fixtures/tool.mjs']);
  assert.ok(passes.every((p) => existsSync(p.dir)));
});
