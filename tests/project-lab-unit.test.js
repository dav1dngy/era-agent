// Unit tests for ERA Project Lab building blocks (no engine, no agents).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeProject, assertExternalPath, assertReady, normalizeAcceptance } from '../src/project_lab/schema.js';
import { ProjectStore } from '../src/project_lab/store.js';
import { copyProject, globToRegExp, initBaseline, protectedViolations, treeDigest, workspaceChanges, walkFiles } from '../src/project_lab/workspace.js';
import { parseTestOutput, regressions } from '../src/project_lab/runner.js';
import { detectProject } from '../src/project_lab/detect.js';
import { extractJsonArray, makeFinding, prioritize, staticFindings, validateAgentFindings } from '../src/project_lab/evidence.js';
import { evaluateChange, relevantFiles } from '../src/project_lab/modify.js';
import { compareBehavior, shQuote, verbatimOverlap, assertRebuildCriteria } from '../src/project_lab/rebuild.js';
import { SafetyError } from '../src/safety/policy.js';
import { FIXTURES, ROOT, tempDir } from './helpers.js';

const write = (dir, rel, text) => {
  mkdirSync(join(dir, rel, '..'), { recursive: true });
  writeFileSync(join(dir, rel), text);
};

test('normalizeProject validates ids, modes and applies safe defaults', () => {
  const src = tempDir();
  const p = normalizeProject({ id: 'demo', source: src, task: 'x' });
  assert.equal(p.mode, 'review');
  assert.equal(p.limits.maxAttempts, 2);
  assert.equal(p.approval.status, 'none');
  assert.equal(p.trust_project, false);
  assert.throws(() => normalizeProject({ id: 'Bad Id', source: src }), /invalid/);
  assert.throws(() => normalizeProject({ id: 'x'.repeat(80), source: src }), /invalid/);
  assert.throws(() => normalizeProject({ id: 'demo', source: src, mode: 'delete' }), /mode must be one of/);
  assert.throws(() => normalizeProject({ id: 'demo', source: join(src, 'missing') }), /does not exist/);
});

test('limits are validated and capped by hard limits', () => {
  const src = tempDir();
  assert.throws(() => normalizeProject({ id: 'a', source: src, limits: { maxAttempts: 0 } }), /maxAttempts/);
  assert.throws(() => normalizeProject({ id: 'a', source: src, limits: { maxAttempts: 99 } }), /maxAttempts/);
  assert.throws(() => normalizeProject({ id: 'a', source: src, limits: { maxCostUsd: 1e6 } }), /maxCostUsd/);
  assert.throws(() => normalizeProject({ id: 'a', source: src, limits: { commandTimeoutMs: 1e12 } }), /commandTimeoutMs/);
  assert.equal(normalizeProject({ id: 'a', source: src, limits: { maxAttempts: 4 } }).limits.maxAttempts, 4);
});

test('Project Lab refuses to treat ERA itself as a project (isolation from ERA)', () => {
  assert.throws(() => normalizeProject({ id: 'self', source: ROOT }), SafetyError);
  assert.throws(() => normalizeProject({ id: 'self', source: join(ROOT, 'src') }), /inside ERA's own installation/);
  assert.throws(() => assertExternalPath(join(ROOT, 'docs'), 'x'), SafetyError);
  assert.throws(() => assertExternalPath(join(ROOT, '..'), 'x'), /contains ERA's own installation/);
  assert.doesNotThrow(() => assertExternalPath(tempDir(), 'x'));
  // a symlink into ERA is resolved before the check
  const link = join(tempDir(), 'sneaky');
  symlinkSync(join(ROOT, 'src'), link);
  assert.throws(() => assertExternalPath(link, 'source'), SafetyError);
  const dest = join(tempDir(), 'out');
  assert.throws(() => normalizeProject({ id: 'a', source: tempDir(), destination: join(ROOT, 'generated') }), SafetyError);
  assert.doesNotThrow(() => normalizeProject({ id: 'a', source: tempDir(), destination: dest }));
});

test('destination must be empty and must not overlap the source or reference', () => {
  const src = tempDir();
  const ref = tempDir();
  const full = tempDir();
  writeFileSync(join(full, 'x'), '1');
  assert.throws(() => normalizeProject({ id: 'a', source: src, destination: full }), /empty/);
  assert.throws(() => normalizeProject({ id: 'a', source: src, destination: join(src, 'inner') }), /overlap/);
  assert.throws(() => normalizeProject({ id: 'a', reference: ref, destination: join(ref, 'inner') }), /overlap/);
  assert.doesNotThrow(() => normalizeProject({ id: 'a', reference: ref, destination: join(tempDir(), 'fresh') }));
});

test('operation requirements are explicit, and rebuild needs an authorization statement', () => {
  const p = normalizeProject({ id: 'a', source: tempDir() });
  assert.doesNotThrow(() => assertReady(p, 'review'));
  assert.throws(() => assertReady(p, 'modify'), /task description is required/);
  const r = normalizeProject({ id: 'b', reference: tempDir(), destination: join(tempDir(), 'o'), task: 'x' });
  assert.throws(() => assertReady(r, 'rebuild'), /authorization statement is required/);
  assert.doesNotThrow(() => assertReady({ ...r, authorization: 'my own program' }, 'rebuild'));
  assert.throws(() => assertReady(normalizeProject({ id: 'c' }), 'review'), /source path is required/);
});

test('protected patterns and acceptance definitions are validated', () => {
  const src = tempDir();
  assert.throws(() => normalizeProject({ id: 'a', source: src, protected: ['../x'] }), /must not contain/);
  assert.throws(() => normalizeProject({ id: 'a', source: src, protected: ['/etc/passwd'] }), /relative/);
  assert.throws(() => normalizeAcceptance({ commands: [{ command: '' }] }), /non-empty command/);
  assert.throws(() => normalizeAcceptance({ commands: [{ command: 'x', baseline: 'maybe' }] }), /baseline/);
  assert.throws(() => normalizeAcceptance({ behaviors: [{ name: 'b' }] }), /expect/);
  const a = normalizeAcceptance({ commands: ['npm test'], behaviors: [{ args: ['x'], capture: 'reference' }, { expect: { stdout: 'ok\n' } }], criteria: 'works' });
  assert.equal(a.commands[0].baseline, 'any');
  assert.equal(a.behaviors[0].capture, 'reference');
  assert.deepEqual(a.criteria, ['works']);
});

test('store keeps independent state per project and writes atomically', () => {
  const stateDir = tempDir();
  const store = new ProjectStore(stateDir);
  const a = normalizeProject({ id: 'one', source: tempDir() });
  const b = normalizeProject({ id: 'two', source: tempDir() });
  store.save(a);
  store.save(b);
  assert.deepEqual(store.list().map((p) => p.id), ['one', 'two']);
  const run = store.newRun(a, 'review');
  assert.equal(store.loadRun('one', run.run_id).project_id, 'one');
  assert.equal(store.listRuns('two').length, 0);
  // two runs created within the same second keep their creation order
  const second = store.newRun(a, 'modify');
  const third = store.newRun(a, 'review');
  assert.deepEqual(store.listRuns('one').map((r) => r.run_id).slice(-2), [second.run_id, third.run_id]);
  assert.equal(store.latestRun('one').run_id, third.run_id);
  store.log('one', { type: 'x' });
  assert.equal(store.events('two').length, 0);
  assert.throws(() => store.load('three'), /Unknown project/);
  assert.throws(() => store.dir('../escape'), /Invalid project id/);
  writeFileSync(join(store.dir('two'), 'project.json'), '{broken');
  assert.throws(() => store.load('two'), /corrupt/);
});

test('copyProject skips generated dirs, never follows symlinks out, and enforces limits', async () => {
  const src = tempDir();
  write(src, 'a.js', 'x');
  write(src, 'node_modules/dep/i.js', 'big');
  write(src, '.git/config', 'secret');
  write(src, 'sub/b.txt', 'y');
  const outside = join(tempDir(), 'outside.txt');
  writeFileSync(outside, 'private');
  symlinkSync(outside, join(src, 'leak'));
  symlinkSync('sub/b.txt', join(src, 'inner-link'));
  const dest = join(tempDir(), 'copy');
  const r = copyProject(src, dest, { maxBytes: 1e6, maxFiles: 100 });
  assert.deepEqual(walkFiles(dest).map((f) => f.rel).sort(), ['a.js', 'inner-link', 'sub/b.txt']);
  assert.ok(!existsSync(join(dest, 'node_modules')) && !existsSync(join(dest, '.git')));
  assert.deepEqual(r.skipped.map((s) => s.path), ['leak']);
  assert.throws(() => copyProject(src, join(tempDir(), 'c'), { maxBytes: 1, maxFiles: 100 }), /limit/);
  assert.throws(() => copyProject(src, join(tempDir(), 'c'), { maxBytes: 1e6, maxFiles: 1 }), /limit/);
});

test('treeDigest changes with content and ignores generated directories', () => {
  const d = tempDir();
  write(d, 'a.txt', '1');
  const one = treeDigest(d).sha256;
  write(d, 'node_modules/x.js', 'ignored');
  assert.equal(treeDigest(d).sha256, one);
  write(d, 'a.txt', '2');
  assert.notEqual(treeDigest(d).sha256, one);
});

test('workspace git stays inside the working copy and yields an exact diff', async () => {
  const ws = tempDir();
  write(ws, 'a.txt', 'one\n');
  write(ws, 'b.txt', 'keep\n');
  const base = await initBaseline(ws);
  write(ws, 'a.txt', 'two\n');
  write(ws, 'c.txt', 'new\n');
  const changes = await workspaceChanges(ws, base);
  assert.deepEqual(changes.files.map((f) => `${f.status} ${f.path}`).sort(), ['A c.txt', 'M a.txt']);
  assert.match(changes.patch, /\+two/);
  // an enclosing repository must never be used: a plain subdirectory without .git is rejected
  const plain = join(ws, 'plain');
  mkdirSync(plain);
  await assert.rejects(workspaceChanges(plain, base), /not its own repository|failed/);
});

test('glob protection supports ** and * and always protects .git and .era', () => {
  assert.ok(globToRegExp('tests/**').test('tests/a/b.js'));
  assert.ok(globToRegExp('**/*.lock').test('x/y/package.lock'));
  assert.ok(globToRegExp('src/*.js').test('src/a.js'));
  assert.ok(!globToRegExp('src/*.js').test('src/a/b.js'));
  assert.deepEqual(protectedViolations(['src/a.js', 'tests/x.js', '.git/config', '.era/x'], ['tests/**']), ['tests/x.js', '.git/config', '.era/x']);
});

test('test output parsers read TAP, spec, pytest, go and cargo formats', () => {
  const tap = parseTestOutput('ok 1 - alpha\nnot ok 2 - beta\nok 3 - gamma # SKIP later\n    ok 1 - nested\n');
  assert.deepEqual(tap, { format: 'tap', passed: ['alpha'], failed: ['beta'], skipped: ['gamma'] });
  const spec = parseTestOutput('✔ first (1.2ms)\n✖ second (0.5ms)\n  ✔ third\n\nfailing tests:\n✖ second (0.5ms)\n');
  assert.deepEqual([spec.format, spec.passed, spec.failed], ['spec', ['first', 'third'], ['second']]);
  assert.deepEqual(parseTestOutput('tests/a.py::test_x PASSED\ntests/a.py::test_y FAILED\n').failed, ['tests/a.py::test_y']);
  assert.deepEqual(parseTestOutput('--- PASS: TestA (0.00s)\n--- FAIL: TestB (0.00s)\n').passed, ['TestA']);
  assert.deepEqual(parseTestOutput('test util::ok ... ok\ntest util::bad ... FAILED\n').failed, ['util::bad']);
  assert.equal(parseTestOutput('nothing to see here'), null);
});

test('regressions compares baseline and new test inventories', () => {
  const base = { passed: ['a', 'b'], failed: ['c'], skipped: [] };
  const r = regressions(base, { passed: ['a', 'c', 'd'], failed: ['e'], skipped: [] });
  assert.deepEqual(r, { comparable: true, regressed: ['b'], fixed: ['c'], newly_failing: ['e'] });
  assert.equal(regressions(null, base).comparable, false);
});

test('detectProject finds languages, frameworks, test tools and commands', async () => {
  const d = tempDir();
  write(d, 'package.json', JSON.stringify({ scripts: { test: 'node --test tests/*.test.js', build: 'tsc' }, dependencies: { express: '4' }, devDependencies: { vitest: '1' } }));
  write(d, 'src/a.js', 'x');
  write(d, 'src/b.ts', 'x');
  write(d, 'tests/a.test.js', 'x');
  const det = await detectProject(d);
  assert.equal(det.primary_language === 'JavaScript' || det.primary_language === 'TypeScript', true);
  assert.deepEqual(det.frameworks, ['Express']);
  assert.ok(det.test_frameworks.includes('Vitest') && det.test_frameworks.includes('node:test'));
  assert.deepEqual(det.test.map((t) => t.command), ['npm test --silent']);
  assert.deepEqual(det.build.map((t) => t.command), ['npm run --silent build']);
  assert.equal(det.test_file_count, 1);
  assert.equal(det.javascript_files, 3);
  const py = tempDir();
  write(py, 'requirements.txt', 'flask\npytest\n');
  write(py, 'app.py', 'x');
  const detPy = await detectProject(py);
  assert.deepEqual(detPy.frameworks, ['Flask']);
  assert.equal(detPy.test[0].command, 'python3 -m pytest -v');
});

test('static findings carry locations and evidence, redact secrets, and flag missing tests', async () => {
  const d = tempDir();
  // Assembled at runtime so this repository's own secret scan stays clean.
  const fakeToken = ['gh', 'p_', 'a'.repeat(36)].join('');
  write(d, 'src/app.js', `const token = '${fakeToken}';\nconst r = eval(userInput);\n// TODO fix\n`);
  write(d, 'src/big.js', `${'x\n'.repeat(1600)}`);
  const det = await detectProject(d);
  const findings = staticFindings(d, det);
  const secret = findings.find((f) => /GitHub token/.test(f.title));
  assert.equal(secret.severity, 'high');
  assert.deepEqual(secret.locations, [{ file: 'src/app.js', line: 1 }]);
  assert.ok(!JSON.stringify(findings).includes(fakeToken), 'the secret value never appears in a finding');
  assert.ok(findings.some((f) => /Dynamic code evaluation/.test(f.title) && f.confidence === 'low'));
  assert.ok(findings.some((f) => /TODO\/FIXME/.test(f.title)));
  assert.ok(findings.some((f) => /Very large source file/.test(f.title)));
  assert.ok(findings.some((f) => /No automated tests/.test(f.title)));
});

test('prioritize orders by severity, then confidence', () => {
  const f = (severity, confidence, title) => makeFinding({ source: 'x', severity, category: 'security', title, confidence });
  const sorted = prioritize([f('low', 'high', 'c'), f('critical', 'low', 'b'), f('high', 'high', 'a'), f('high', 'low', 'd')]);
  assert.deepEqual(sorted.map((x) => x.title), ['b', 'a', 'd', 'c']);
});

test('agent findings are accepted only when they point at real files, lines and snippets', () => {
  const d = tempDir();
  write(d, 'src/a.js', 'line one\nconst answer = compute(42);\nline three\n');
  const raw = [
    { title: 'ok', severity: 'high', category: 'correctness', file: 'src/a.js', line: 2, snippet: 'const answer =   compute(42);', evidence: 'compute is never defined' },
    { title: 'unverified snippet', severity: 'low', category: 'correctness', file: 'src/a.js', line: 1, snippet: 'nope nope', evidence: 'quoted code is not present' },
    { title: 'no file', severity: 'low', file: 'src/zzz.js', evidence: 'this file does not exist at all' },
    { title: 'bad line', severity: 'low', file: 'src/a.js', line: 50, evidence: 'line beyond the end of the file' },
    { title: 'bad severity', severity: 'extreme', file: 'src/a.js', evidence: 'invalid severity value here' },
    { title: 'escape', severity: 'high', file: '../outside.js', evidence: 'path escapes the project root' },
    { title: 'no evidence', severity: 'high', file: 'src/a.js' },
    { severity: 'high', file: 'src/a.js', evidence: 'missing title altogether' },
    'not an object',
  ];
  const { accepted, rejected } = validateAgentFindings(raw, d);
  assert.deepEqual(accepted.map((f) => [f.title, f.verified, f.confidence]), [['ok', true, 'medium'], ['unverified snippet', false, 'low']]);
  assert.equal(rejected.length, 7);
  assert.match(rejected.map((r) => r.reason).join('|'), /not a file in the project/);
  assert.match(rejected.map((r) => r.reason).join('|'), /outside/);
  assert.equal(validateAgentFindings(null, d).accepted.length, 0);
});

test('extractJsonArray finds fenced or bare JSON and tolerates prose', () => {
  assert.deepEqual(extractJsonArray('Findings:\n```json\n[{"a":1}]\n```\nthanks'), [{ a: 1 }]);
  assert.deepEqual(extractJsonArray('[1,2,3]'), [1, 2, 3]);
  assert.deepEqual(extractJsonArray('text [x] and ```json\n[{"b":2}]\n```'), [{ b: 2 }]);
  assert.equal(extractJsonArray('no json here'), null);
});

const verification = (o = {}) => ({ build: [], test: [], acceptance: [], build_ok: true, test_ok: true, tests: null, ...o });
const changes = (files, patch = 'x') => ({ files: files.map((f) => (typeof f === 'string' ? { status: 'M', path: f } : f)), patch, stat: '' });
const proj = (over = {}) => normalizeProject({ id: 'p', source: tempDir(), ...over });

test('evaluateChange accepts only verified, regression-free, in-scope changes', () => {
  const p = proj();
  const ok = { ok: true, command: 'c' };
  const base = verification({ test: [ok], tests: { passed: ['a', 'b'], failed: [], skipped: [] } });
  const after = verification({ test: [ok], tests: { passed: ['a', 'b', 'c'], failed: [], skipped: [] }, acceptance: [ok] });
  assert.equal(evaluateChange({ project: p, baseline: base, after, changes: changes(['src/x.js']) }).pass, true);
  const empty = evaluateChange({ project: p, baseline: base, after, changes: changes([]) });
  assert.deepEqual([empty.pass, empty.reasons[0]], [false, 'No files were changed.']);
  const lost = verification({ test: [ok], tests: { passed: ['a'], failed: [], skipped: [] } });
  assert.match(evaluateChange({ project: p, baseline: base, after: lost, changes: changes(['src/x.js']) }).reasons.join(), /no longer pass \(or no longer exist\): b/);
  const newFail = verification({ test: [{ ok: false, command: 'c', exit_code: 1 }], test_ok: false, tests: { passed: ['a', 'b'], failed: ['z'], skipped: [] } });
  const r = evaluateChange({ project: p, baseline: base, after: newFail, changes: changes(['src/x.js']) });
  assert.match(r.reasons.join(), /New failing tests: z/);
  assert.match(r.reasons.join(), /passed at baseline and fails now/);
  const acc = verification({ test: [ok], tests: base.tests, acceptance: [{ ok: false, command: 'acc', exit_code: 1 }], acceptance_ok: false });
  assert.match(evaluateChange({ project: p, baseline: base, after: acc, changes: changes(['src/x.js']) }).reasons.join(), /Acceptance command failed: `acc`/);
});

test('evaluateChange rejects protected, oversized and build-breaking changes and warns about edited tests', () => {
  const p = proj({ protected: ['tests/**'], limits: { maxChangedFiles: 2 } });
  const ok = { ok: true, command: 'c' };
  const base = verification({ build: [ok], test: [ok] });
  const after = verification({ build: [ok], test: [ok] });
  const prot = evaluateChange({ project: p, baseline: base, after, changes: changes(['tests/a.test.js']) });
  assert.match(prot.reasons.join(), /Protected files were changed: tests\/a.test.js/);
  const many = evaluateChange({ project: p, baseline: base, after, changes: changes(['a', 'b', 'c']) });
  assert.match(many.reasons.join(), /3 files changed \(limit 2\)/);
  const brokenBuild = verification({ build: [{ ok: false, command: 'b' }], build_ok: false, test: [ok] });
  assert.match(evaluateChange({ project: proj(), baseline: base, after: brokenBuild, changes: changes(['a']) }).reasons.join(), /build passed at baseline and fails now/);
  const touched = evaluateChange({ project: proj(), baseline: base, after, changes: changes([{ status: 'D', path: 'tests/x.test.js' }, 'src/y.js']) });
  assert.equal(touched.pass, true);
  assert.match(touched.warnings.join(), /deleted or modified: D tests\/x\.test\.js/);
  const big = evaluateChange({ project: proj({ limits: { maxDiffBytes: 5 } }), baseline: base, after, changes: changes(['a'], 'x'.repeat(50)) });
  assert.match(big.reasons.join(), /diff is 50 bytes/);
});

test('tests that disappear from the output are a regression, not a pass', () => {
  const ok = { ok: true, command: 't' };
  const base = verification({ test: [ok], tests: { passed: ['a', 'b'], failed: [], skipped: [] } });
  const after = verification({ test: [ok], tests: null });
  const r = evaluateChange({ project: proj(), baseline: base, after, changes: changes(['src/x.js']) });
  assert.equal(r.pass, false);
  assert.match(r.reasons.join(), /listed 2 passing test\(s\), but the test output after the change lists none/);
  // projects whose output was never itemizable are judged by exit code as before
  assert.equal(evaluateChange({ project: proj(), baseline: verification({ test: [ok] }), after, changes: changes(['src/x.js']) }).pass, true);
});

test('a test failing at baseline that cannot be itemized never lets a still-failing run pass', () => {
  const base = verification({ test: [{ ok: false, command: 't' }], test_ok: false });
  const after = verification({ test: [{ ok: false, command: 't' }], test_ok: false });
  const r = evaluateChange({ project: proj(), baseline: base, after, changes: changes(['a']) });
  assert.equal(r.pass, false);
  assert.match(r.reasons.join(), /cannot be itemized/);
});

test('relevantFiles points at files named in the task or in failing output', () => {
  const files = ['src/cart.js', 'src/catalog.js', 'tests/cart.test.js', 'README.md'];
  const hits = relevantFiles(files, 'Fix the total in src/cart.js and check README.md', ['at total (src/catalog.js:12:3)\n']);
  assert.deepEqual(hits.map((h) => h.file).sort(), ['README.md', 'src/cart.js', 'src/catalog.js']);
});

test('behavior comparison normalizes line endings and trailing whitespace only', () => {
  assert.equal(compareBehavior({ stdout: 'a\n', exit_code: 0 }, { stdout: 'a\r\n\n', exit_code: 0 }).match, true);
  const bad = compareBehavior({ stdout: 'a', exit_code: 0 }, { stdout: 'b', exit_code: 2 });
  assert.deepEqual([bad.match, bad.reasons], [false, ['exit code 2 (expected 0)', 'stdout differs']]);
  assert.equal(shQuote("it's"), "'it'\\''s'");
});

test('rebuild refuses to start without an acceptance check, and flags verbatim copying', () => {
  assert.throws(() => assertRebuildCriteria(proj()), /at least one acceptance check/);
  assert.throws(() => assertRebuildCriteria(proj({ acceptance: { behaviors: [{ args: [], expect: { stdout: 'x' } }] } })), /commands.run/);
  assert.doesNotThrow(() => assertRebuildCriteria(proj({ commands: { run: 'node x.js' }, acceptance: { behaviors: [{ args: [], expect: { stdout: 'x' } }] } })));
  const ref = tempDir();
  const ws = tempDir();
  const long = '  const something = computeTheVeryImportantThing(inputValue, anotherArgument);';
  write(ref, 'a.js', `${long}\nshort\n`);
  write(ws, 'b.js', `${long}\nunrelated code goes here\n`);
  assert.equal(verbatimOverlap(ref, ws).length, 1);
  assert.equal(verbatimOverlap(ref, tempDir()).length, 0);
});

test('the documented example configurations are valid project definitions', async () => {
  const { readFileSync } = await import('node:fs');
  for (const name of ['modify-project.json', 'rebuild-project.json']) {
    const raw = JSON.parse(readFileSync(join(ROOT, 'examples', 'project-lab', name), 'utf8'));
    const filled = { ...raw, ...(raw.source ? { source: tempDir() } : {}), ...(raw.reference ? { reference: tempDir() } : {}), ...(raw.destination ? { destination: join(tempDir(), 'new') } : {}) };
    const p = normalizeProject(filled);
    assert.equal(p.id, raw.id, name);
    assert.doesNotThrow(() => assertReady(p, raw.mode), name);
  }
});

test('fixture projects exist and are external to the lab code', () => {
  for (const name of ['buggy-app', 'catalog-app']) assert.ok(existsSync(join(FIXTURES, 'projects', name, 'package.json')));
});
