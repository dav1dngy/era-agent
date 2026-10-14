// Regression tests for the findings of the independent audit (docs/ERA_V020_INDEPENDENT_AUDIT.md), one section per finding.
// Each test reproduces the failure the audit demonstrated with a synthetic fixture and asserts the corrected behavior.
//
// REAL    Project Lab workflows, git, patches, the project's own commands, the macOS sandbox where available.
// FAKE    the REA engine (tests/fixtures/fake-rea-engine.mjs).
// MOCK    coding agents: tiny scripts (tests/fixtures/audit/write-files.mjs). No model is called.
import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../src/core/config.js';
import { ReaClient } from '../src/rea_integration/rea-client.js';
import { createProjectLab } from '../src/project_lab/lab.js';
import { sandboxAvailable } from '../src/safety/sandbox.js';
import { FIXTURES, tempDir } from './helpers.js';

const NESTED = (process.env.ERA_E2E_NESTED || process.env.ERA_SKIP_E2E) && 'nested evaluation or ERA_SKIP_E2E';
const test = (name, a, b) => {
  const opts = typeof a === 'function' ? {} : a;
  const fn = typeof a === 'function' ? a : b;
  return nodeTest(name, { ...opts, skip: opts.skip || NESTED || false }, fn);
};
delete process.env.CI;
delete process.env.GITHUB_ACTIONS;

const FAKE_ENGINE = join(FIXTURES, 'fake-rea-engine.mjs');
const WRITE = join(FIXTURES, 'audit', 'write-files.mjs');
const SANDBOX = sandboxAvailable();
const write = (...specs) => `node ${WRITE} ${specs.join(' ')}`;

function newLab({ createAgent } = {}) {
  const config = loadConfig(tempDir(), { ERA_STATE_DIR: tempDir() });
  config.projectLab = { ...config.projectLab, budget: { ...config.projectLab.budget, allowUnmeteredAgents: true } };
  const client = new ReaClient({ command: FAKE_ENGINE, stateDir: config.stateDirAbs, measureResources: false });
  return createProjectLab({ config, rea: client, createAgent });
}

function plainProject(files = { 'protected.txt': 'original\n', 'readme.txt': 'hello\n' }) {
  const dir = join(tempDir(), 'proj');
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

// ---------------------------------------------------------------------------------------------------------------------
// H01: verification must judge, and approval must bind, the FINAL working copy, including files the project's own
// build/test commands change. Audit reproduction: a test command rewrote a protected file after the agent had added
// candidate.txt; the stale file list passed and approval wrote the protected file into the original project.

const modifyProject = (src, over = {}) => ({
  id: 'audit',
  mode: 'modify',
  source: src,
  task: 'Add candidate.txt',
  agent: 'command',
  agent_command: write('candidate.txt=new'),
  protected: ['protected.txt'],
  trust_project: !SANDBOX,
  ...over,
});

test('H01 modify: a protected file changed by a verification command makes the run unapprovable', async () => {
  const lab = newLab();
  const src = plainProject();
  lab.create(modifyProject(src, { commands: { test: [write('--when=candidate.txt', 'protected.txt=CHANGED_DURING_TEST')] } }));
  const { run } = await lab.modify('audit');
  const fin = run.results.finalize;
  assert.equal(fin.pass, false, 'the final diff touches a protected file');
  assert.match(fin.reasons.join(' '), /Protected files were changed: protected\.txt/);
  assert.notEqual(run.status, 'awaiting-approval');
  await assert.rejects(lab.approve('audit', { by: 'tester' }), /no run awaiting approval|did not pass|only runs awaiting approval/);
  assert.equal(readFileSync(join(src, 'protected.txt'), 'utf8'), 'original\n', 'the original protected file is untouched');
  assert.equal(existsSync(join(src, 'candidate.txt')), false);
});

test('H01 modify: files created by verification commands count against the changed-file limit', async () => {
  const lab = newLab();
  const src = plainProject();
  lab.create(modifyProject(src, { protected: [], limits: { maxChangedFiles: 2 }, commands: { test: [write('--when=candidate.txt', 'gen/a.txt=1', 'gen/b.txt=2', 'gen/c.txt=3')] } }));
  const { run } = await lab.modify('audit');
  assert.equal(run.results.finalize.pass, false);
  assert.match(run.results.finalize.reasons.join(' '), /4 files changed \(limit 2\)/);
});

test('H01 modify: a harmless change made by a verification command is reported but does not block a valid candidate', async () => {
  const lab = newLab();
  const src = plainProject();
  lab.create(modifyProject(src, { protected: ['protected.txt'], commands: { test: [write('--when=candidate.txt', 'generated/report.txt=ok')] } }));
  const { run } = await lab.modify('audit');
  const fin = run.results.finalize;
  assert.equal(fin.pass, true, fin.reasons.join('; '));
  assert.ok(fin.files.some((f) => f.path === 'generated/report.txt'));
  assert.match(fin.warnings.join(' '), /commands changed the working copy: .*generated\/report\.txt/);
  const applied = await lab.approve('audit', { by: 'tester' });
  assert.equal(applied.applied.kind, 'patch');
  assert.equal(readFileSync(join(src, 'candidate.txt'), 'utf8'), 'new');
});

test('H01 rebuild: SPEC.md changed by a verification command makes the rebuild unapprovable', async () => {
  const lab = newLab();
  const ref = tempDir();
  writeFileSync(join(ref, 'app.js'), "process.stdout.write('ok\\n');\n");
  lab.create({
    id: 'rb',
    mode: 'rebuild',
    reference: ref,
    destination: join(tempDir(), 'out'),
    task: 'Reimplement app',
    authorization: 'fixture',
    agent: 'command',
    agent_command: write("app.js=\"process.stdout.write('ok\\n')\"", 'candidate.txt=1'),
    commands: { run: 'node app.js', test: [write('--when=candidate.txt', 'SPEC.md=tampered')] },
    acceptance: { behaviors: [{ name: 'prints ok', args: [], expect: { stdout: 'ok\n', exit_code: 0 } }] },
    limits: { maxAttempts: 1 },
    trust_project: !SANDBOX,
  });
  const { run } = await lab.rebuild('rb');
  assert.equal(run.results.finalize.pass, false, JSON.stringify(run.results.finalize.reasons));
  assert.match(run.results.finalize.reasons.join(' '), /Protected files were changed: SPEC\.md/);
  assert.notEqual(run.status, 'awaiting-approval');
});

// ---------------------------------------------------------------------------------------------------------------------
// H02: Rebuild rollback deleted the whole destination after a digest that ignores .git/build/dist/node_modules matched,
// so work done after approval in those directories was destroyed. Rollback now needs a complete manifest match.

const OK_APP = "app.js=\"process.stdout.write('ok\\n')\"";
async function approvedRebuild({ agentFiles = [OK_APP] } = {}) {
  const lab = newLab();
  const ref = tempDir();
  writeFileSync(join(ref, 'app.js'), "process.stdout.write('ok\\n');\n");
  const destination = join(tempDir(), 'out');
  lab.create({
    id: 'rb',
    mode: 'rebuild',
    reference: ref,
    destination,
    task: 'Reimplement app',
    authorization: 'fixture',
    agent: 'command',
    agent_command: write(...agentFiles),
    commands: { run: 'node app.js' },
    acceptance: { behaviors: [{ name: 'prints ok', args: [], expect: { stdout: 'ok\n', exit_code: 0 } }] },
    limits: { maxAttempts: 1 },
    trust_project: !SANDBOX,
  });
  const { run } = await lab.rebuild('rb');
  assert.equal(run.status, 'awaiting-approval', JSON.stringify(run.results?.finalize?.reasons ?? run.error));
  await lab.approve('rb', { by: 'tester' });
  return { lab, destination };
}

test('H02: an untouched Rebuild destination is rolled back and removed', async () => {
  const { lab, destination } = await approvedRebuild();
  assert.ok(existsSync(join(destination, 'app.js')));
  const r = await lab.rollback('rb');
  assert.equal(r.restored, true);
  assert.equal(existsSync(destination), false);
});

test('H02: later work in .git and build survives, and rollback is refused', async () => {
  const { lab, destination } = await approvedRebuild();
  mkdirSync(join(destination, '.git'), { recursive: true });
  writeFileSync(join(destination, '.git', 'audit-unpublished-history'), 'precious');
  mkdirSync(join(destination, 'build'), { recursive: true });
  writeFileSync(join(destination, 'build', 'user-data'), 'precious');
  await assert.rejects(lab.rollback('rb'), /refusing to delete it[\s\S]*added \.git|added build/);
  assert.equal(readFileSync(join(destination, '.git', 'audit-unpublished-history'), 'utf8'), 'precious');
  assert.equal(readFileSync(join(destination, 'build', 'user-data'), 'utf8'), 'precious');
  assert.ok(existsSync(join(destination, 'app.js')), 'nothing was deleted');
  assert.equal(lab.get('rb').status, 'applied', 'the project still counts as applied');
});

test('H02: a file inside an excluded directory that existed at approval is protected too', async () => {
  const { lab, destination } = await approvedRebuild({ agentFiles: [OK_APP, 'build/generated.txt=from-agent'] });
  assert.equal(readFileSync(join(destination, 'build', 'generated.txt'), 'utf8'), 'from-agent');
  writeFileSync(join(destination, 'build', 'generated.txt'), 'edited by the user');
  await assert.rejects(lab.rollback('rb'), /modified build\/generated\.txt/);
  assert.equal(readFileSync(join(destination, 'build', 'generated.txt'), 'utf8'), 'edited by the user');
});

test('H02: a removed or edited ordinary file also refuses the rollback', async () => {
  const { lab, destination } = await approvedRebuild();
  writeFileSync(join(destination, 'app.js'), 'changed');
  await assert.rejects(lab.rollback('rb'), /modified app\.js/);
  writeFileSync(join(destination, 'extra.txt'), 'new');
  await assert.rejects(lab.rollback('rb'), /added extra\.txt/);
});

test('H02: runs approved before manifests existed refuse when excluded directories hold content', async () => {
  const { lab, destination } = await approvedRebuild();
  const run = lab.store.loadRun('rb', lab.get('rb').latest_run_id ?? lab.store.latestRun('rb', (r) => r.status === 'applied').run_id);
  delete run.applied.manifest_file;
  delete run.applied.manifest_sha256;
  lab.store.saveRun(run);
  mkdirSync(join(destination, 'node_modules'), { recursive: true });
  writeFileSync(join(destination, 'node_modules', 'later.txt'), 'x');
  await assert.rejects(lab.rollback('rb'), /no complete manifest/);
  assert.ok(existsSync(join(destination, 'node_modules', 'later.txt')));
});
