// Optional plan-review gate: the run pauses after the plan (and the architect's design) and writes no code until the user
// explicitly approves the plan. REAL: ProjectLab, git, project tests, the CLI as a job through the control plane.
// MOCK: coding agents (tests/fixtures/agents/team-agent.mjs), not AI.
import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../src/core/config.js';
import { ReaClient } from '../src/rea_integration/rea-client.js';
import { createProjectLab } from '../src/project_lab/lab.js';
import { createControlPlane } from '../src/control_plane/server.js';
import { sandboxAvailable } from '../src/safety/sandbox.js';
import { FIXTURES, tempDir } from './helpers.js';

const NESTED = (process.env.ERA_E2E_NESTED || process.env.ERA_SKIP_E2E) && 'nested evaluation or ERA_SKIP_E2E';
const test = (name, fn) => nodeTest(name, { skip: NESTED || false }, fn);
delete process.env.CI;
delete process.env.GITHUB_ACTIONS;
const SANDBOX = sandboxAvailable();
const FAKE_ENGINE = join(FIXTURES, 'fake-rea-engine.mjs');
const AGENT = join(FIXTURES, 'agents', 'team-agent.mjs');
const fixture = () => { const d = join(tempDir(), 'buggy-app'); cpSync(join(FIXTURES, 'projects', 'buggy-app'), d, { recursive: true }); return d; };
const def = (src, over = {}) => ({ id: 'cart', mode: 'modify', source: src, task: 'Fix the cart total: it must account for item quantity', commands: { test: ['node --test tests/*.test.js'] }, acceptance: { commands: [{ name: 'q', command: 'node --test acceptance/cart-quantity.test.js', baseline: 'fail' }] }, team: { roles: { architect: 'custom:arch', implementer: 'custom:impl' } }, review_plan: true, trust_project: !SANDBOX, ...over });
const customAgents = { arch: { command: `node ${AGENT} architect` }, impl: { command: `node ${AGENT} implementer` } };

function newLab() {
  const cwd = tempDir();
  const config = loadConfig(cwd, { ERA_STATE_DIR: join(cwd, 'state') });
  config.projectLab = { ...config.projectLab, customAgents, budget: { ...config.projectLab.budget, allowUnmeteredAgents: true } };
  return createProjectLab({ config, rea: new ReaClient({ command: FAKE_ENGINE, stateDir: config.stateDirAbs, measureResources: false }) });
}
const started = (lab) => lab.store.events('cart').filter((e) => e.type === 'implementer-started').map((e) => `${e.role}:${e.phase}`);

test('the run pauses after the plan and the design, writes no code, and resumes only on an explicit approval', async () => {
  const lab = newLab();
  const src = fixture();
  lab.create(def(src));
  const { run } = await lab.modify('cart');
  assert.equal(run.status, 'awaiting-plan');
  assert.deepEqual(started(lab), ['architect:architecture'], 'the architect ran; the implementer did not');
  assert.ok(existsSync(join(lab.store.runDir('cart', run.run_id), 'plan.md')));
  assert.match(readFileSync(join(lab.store.runDir('cart', run.run_id), 'plan.md'), 'utf8'), /Architecture design/);
  assert.equal(readFileSync(join(lab.store.workDir('cart', run.run_id), 'src', 'cart.js'), 'utf8').includes('item.price * (item.quantity'), false, 'the working copy still has the bug: no code was written');
  assert.match(lab.status('cart').next, /--approve-plan/);
  // a plain resume must not approve the plan by accident
  await assert.rejects(lab.resume('cart'), /waiting for you to review its plan/);
  await assert.rejects(lab.modify('cart'), /already has an open run/);
  // explicit approval continues from the next step and does not repeat the architect
  const done = await lab.resume('cart', { approvePlan: true });
  assert.equal(done.run.status, 'awaiting-approval', done.run.error ?? JSON.stringify(done.run.results.finalize?.reasons));
  assert.deepEqual(started(lab), ['architect:architecture', 'implementer:implement']);
  assert.equal(typeof done.run.plan_approved.at, 'string');
  assert.ok(lab.store.events('cart').some((e) => e.type === 'plan-approved' && e.run_id === run.run_id), 'the approval is in the ledger');
});

test('without review_plan nothing pauses, and a run waiting for plan approval can be cancelled', async () => {
  const lab = newLab();
  const src = fixture();
  lab.create(def(src, { review_plan: false }));
  assert.equal((await lab.modify('cart')).run.status, 'awaiting-approval');
  const lab2 = newLab();
  lab2.create(def(fixture()));
  const { run } = await lab2.modify('cart');
  assert.equal(run.status, 'awaiting-plan');
  await lab2.cancel('cart');
  assert.equal(lab2.store.loadRun('cart', run.run_id).status, 'cancelled');
  assert.equal(existsSync(lab2.store.workDir('cart', run.run_id)), false);
});

async function plane() {
  const cwd = tempDir();
  writeFileSync(join(cwd, 'era.config.json'), JSON.stringify({ projectLab: { customAgents } }));
  const config = loadConfig(cwd, { ERA_STATE_DIR: join(cwd, 'state'), ERA_REA_BIN: FAKE_ENGINE });
  const cp = await createControlPlane({ config, rea: new ReaClient({ command: FAKE_ENGINE, stateDir: config.stateDirAbs, measureResources: false }), version: 'test', env: { ...process.env, ERA_REA_BIN: FAKE_ENGINE } });
  await cp.start();
  const api = async (method, path, body) => {
    const res = await fetch(`${cp.url}${path}`, { method, headers: { Authorization: `Bearer ${cp.token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* text */ }
    return { status: res.status, json, text };
  };
  const wait = async (id) => { for (let i = 0; i < 400; i++) { const j = (await api('GET', `/api/jobs/${id}`)).json; if (['succeeded', 'failed', 'cancelled'].includes(j.status)) return j; await new Promise((r) => setTimeout(r, 150)); } throw new Error('job timeout'); };
  return { cp, api, wait };
}

test('through the control plane: plan visible, approval is an explicit API call, cost policy still applies', async () => {
  const p = await plane();
  try {
    await p.api('PUT', '/api/settings', { execution: { allowUnmeteredAgents: true } });
    const src = fixture();
    assert.equal((await p.api('POST', '/api/projects', def(src))).status, 200);
    const job = await p.wait((await p.api('POST', '/api/projects/cart/ops/modify', {})).json.job.id);
    assert.equal(job.status, 'succeeded', 'a run waiting for plan approval is a normal outcome, not a failure');
    const st = (await p.api('GET', '/api/projects/cart')).json;
    assert.equal(st.latest_run.status, 'awaiting-plan');
    assert.equal(st.project.review_plan, true);
    const art = (path) => p.api('GET', `/api/projects/cart/runs/latest/artifact?path=${encodeURIComponent(path)}`);
    const plan = await art('plan.md');
    assert.equal(plan.status, 200);
    assert.match(plan.text, /Implementation plan/);
    assert.match((await art('handoffs/design.md')).text, /Produced by the architecture agent/);
    assert.equal((await art('../project.json')).status, 403);
    assert.equal((await art('run.json')).status, 403);
    // a plain resume is refused by the lab and surfaces as a failed job, not as an approval
    const plain = await p.wait((await p.api('POST', '/api/projects/cart/ops/resume', {})).json.job.id);
    assert.equal(plain.status, 'failed');
    assert.match(plain.error, /waiting for you to review its plan/);
    const ok = await p.wait((await p.api('POST', '/api/projects/cart/ops/resume', { approve_plan: true })).json.job.id);
    assert.equal(ok.status, 'succeeded', JSON.stringify(ok.log_tail?.slice(-3)));
    assert.equal((await p.api('GET', '/api/projects/cart')).json.latest_run.status, 'awaiting-approval');
  } finally {
    await p.cp.stop();
  }
});
