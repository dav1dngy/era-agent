// Adversarial tests for Improvement Lab trust boundaries (audit F02/F03).
// Candidate code here is a synthetic hostile script; the engine in the
// supervised self-analysis test is the FAKE engine (tests/fixtures/fake-rea-engine.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runProcess } from '../src/core/process.js';
import { candidateIsolation, wrapCandidate, candidateEnv, protectedStatePaths } from '../src/safety/candidate-sandbox.js';
import { sandboxAvailable } from '../src/safety/sandbox.js';
import { evaluateSelf, validatePlan } from '../src/evaluation/self-eval.js';
import { ReaClient } from '../src/rea_integration/rea-client.js';
import { SafetyError } from '../src/safety/policy.js';
import { FIXTURES, tempDir } from './helpers.js';

const noSandbox = !sandboxAvailable() && 'no sandbox on this platform';

test('a hostile candidate cannot write outside, reach the network, read protected files or see secrets', { skip: noSandbox }, async () => {
  const stable = tempDir();
  const sentinel = join(stable, 'sentinel.txt');
  const credential = join(stable, 'credentials.txt');
  writeFileSync(credential, 'CANARY-CREDENTIAL');
  const own = tempDir();
  const server = createServer((s) => s.end('pong')).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  const script = `
    const fs = require('fs'); const net = require('net'); const out = {};
    try { fs.writeFileSync(${JSON.stringify(sentinel)}, 'x'); out.write = 'allowed'; } catch { out.write = 'denied'; }
    try { fs.writeFileSync(${JSON.stringify(join(own, 'ok.txt'))}, 'x'); out.own = 'allowed'; } catch { out.own = 'denied'; }
    try { fs.readFileSync(${JSON.stringify(credential)}, 'utf8'); out.read = 'allowed'; } catch { out.read = 'denied'; }
    out.secret = process.env.ERA_TEST_API_KEY ?? null;
    const s = net.connect(${port}, '127.0.0.1');
    s.on('data', () => { out.net = 'allowed'; finish(); }); s.on('error', () => { out.net = 'denied'; finish(); });
    function finish() { console.log(JSON.stringify(out)); process.exit(0); }`;
  const tmp = tempDir();
  const cmd = wrapCandidate(candidateIsolation(), process.execPath, ['-e', script], { writable: [own], denyRead: [credential], tmp, env: { ...process.env, ERA_TEST_API_KEY: 'sk-test-secret' } });
  const r = await runProcess(cmd.command, cmd.args, { env: cmd.env, timeoutMs: 20_000 });
  server.close();
  const out = JSON.parse(r.stdout.trim());
  assert.deepEqual(out, { write: 'denied', own: 'allowed', read: 'denied', secret: null, net: 'denied' });
  assert.equal(existsSync(sentinel), false);
});

test('candidate environments drop secret-looking variables', () => {
  const env = candidateEnv({ PATH: '/bin', GITHUB_TOKEN: 'x', ANTHROPIC_API_KEY: 'y', MY_PASSWORD: 'z', SSH_AUTH_SOCK: 's', HOME: '/h' }, { tmp: '/t' });
  assert.deepEqual(Object.keys(env).sort(), ['ERA_IN_CANDIDATE_SANDBOX', 'HOME', 'PATH', 'TMPDIR', 'npm_config_cache']);
});

test('isolation fails closed without a sandbox unless the candidate is declared trusted', () => {
  process.env.ERA_IN_CANDIDATE_SANDBOX = '1';
  try {
    assert.throws(() => candidateIsolation(), SafetyError);
    assert.equal(candidateIsolation({ trust: true }).mode, 'trusted');
  } finally {
    delete process.env.ERA_IN_CANDIDATE_SANDBOX;
  }
});

test('protected state paths exclude worktrees but cover evidence and ledger', () => {
  const p = protectedStatePaths('/s');
  assert.ok(p.includes('/s/runs') && p.includes('/s/ledger.jsonl') && p.includes('/s/cycles'));
  assert.ok(!p.some((x) => x.includes('worktrees')));
});

test('validatePlan rejects omitted, invented, duplicated and conflicting files', () => {
  const expected = ['bin/a.mjs', 'src/b.js'];
  assert.equal(validatePlan({ passes: [{ focus: ['bin/a.mjs', 'src/b.js'], placeholders: [] }] }, expected), null);
  assert.match(validatePlan({ passes: [{ focus: ['bin/a.mjs'], placeholders: [] }] }, expected), /omits 1 file/);
  assert.match(validatePlan({ passes: [{ focus: ['bin/a.mjs', 'src/b.js', 'src/fake.js'] }] }, expected), /not in the evaluated commit/);
  assert.match(validatePlan({ passes: [{ focus: ['bin/a.mjs', 'src/b.js'] }, { focus: ['src/b.js'] }] }, expected), /passes 1 and 2/);
  assert.match(validatePlan({ passes: [{ focus: ['bin/a.mjs', 'src/b.js'], placeholders: ['src/b.js'] }] }, expected), /focus and placeholder/);
  assert.match(validatePlan({ passes: [] }, expected), /no passes/);
});

function candidateRepo(planScript) {
  const dir = tempDir();
  mkdirSync(join(dir, 'bin'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'package.json'), '{"name":"c","type":"module"}');
  writeFileSync(join(dir, 'src', 'a.js'), "export const a = 1;\n");
  writeFileSync(join(dir, 'src', 'b.js'), "import { a } from './a.js';\nexport const b = a;\n");
  // The candidate's own CLI: a forged self-analysis plan / report.
  writeFileSync(join(dir, 'bin', 'era.mjs'), planScript);
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'c');
  return dir;
}

const fakeRea = (stateDir) => new ReaClient({ command: join(FIXTURES, 'fake-rea-engine.mjs'), stateDir, measureResources: false });

test('a candidate plan that omits a file is invalid; the supervisor never uses candidate evidence', { skip: noSandbox }, async () => {
  const dir = candidateRepo(`console.log(JSON.stringify({ passes: [{ focus: ['src/a.js'], placeholders: [] }], findings: [], runs: [{ status: 'succeeded', output_file: '/etc/hosts' }] }));`);
  const stateDir = tempDir();
  const s = await evaluateSelf({ codeRoot: dir, stateDir, rea: fakeRea(stateDir), isolation: candidateIsolation() });
  assert.equal(s.valid, false);
  assert.equal(s.invalid.kind, 'candidate');
  assert.match(s.invalid.reason, /omits/);
  assert.equal(s.runs.length, 0, 'no engine run was attributed to the candidate');
});

test('a candidate whose plan command fails falls back to the stable planner, and all evidence is supervisor-run', { skip: noSandbox }, async () => {
  const dir = candidateRepo(`console.log(JSON.stringify({ passes: [{ focus: ['bin/era.mjs', 'src/a.js', 'src/b.js'] }] })); process.exit(7);`);
  const stateDir = tempDir();
  const s = await evaluateSelf({ codeRoot: dir, stateDir, rea: fakeRea(stateDir), isolation: candidateIsolation() });
  assert.equal(s.valid, true, JSON.stringify(s.invalid));
  assert.equal(s.plan_source, 'stable-fallback', 'output of a failed candidate command is not trusted');
  assert.ok(s.runs.length >= 2 && s.runs.every((r) => existsSync(join(stateDir, 'runs', r.run_id, 'record.json'))), 'records exist in the supervisor state');
  assert.deepEqual(s.missing_modules, []);
});
