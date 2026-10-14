// Rebuild usability: prerequisite checks, reliable planning, saved configuration, explicit spend policy.
// REAL: ProjectLab, preflight, the control-plane HTTP server, jobs that run the real CLI, settings, audit.
// MOCK: coding agents are scripts or injected doubles (no model is called).
import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { loadConfig } from '../src/core/config.js';
import { ReaClient } from '../src/rea_integration/rea-client.js';
import { createProjectLab } from '../src/project_lab/lab.js';
import { createControlPlane } from '../src/control_plane/server.js';
import { sandboxAvailable } from '../src/safety/sandbox.js';
import { makePng } from './image-fixtures.js';
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
const SANDBOX = sandboxAvailable();
const double = ({ id = 'fake', metered = true, available = true, authenticated = null, caps = {} } = {}) => ({ id, metered, description: id, async probe() { return { available, version: '1.0', detail: available ? 'ok' : 'not found' }; }, ...(authenticated === null ? {} : { async auth() { return { authenticated, detail: authenticated ? 'signed in' : 'not signed in' }; } }), async implement() { return { ok: true, exit_code: 0, duration_ms: 1, output: '' }; }, caps });

function labWith(agents, { allowUnmetered = false, customAgents = {} } = {}) {
  const cwd = tempDir();
  const config = loadConfig(cwd, { ERA_STATE_DIR: join(cwd, 'state') });
  config.projectLab = { ...config.projectLab, customAgents, budget: { ...config.projectLab.budget, allowUnmeteredAgents: allowUnmetered } };
  return createProjectLab({ config, rea: new ReaClient({ command: FAKE_ENGINE, stateDir: config.stateDirAbs, measureResources: false }), createAgent: (id) => agents[id] ?? double({ id }) });
}

// The schema stores real paths (/private/var/... on macOS), also for folders that do not exist yet.
const real = (p) => join(realpathSync(dirname(p)), basename(p));
const refFile = () => { const f = join(tempDir(), 'app.js'); writeFileSync(f, 'console.log(1)\n'); return f; };
const status = (pf, id) => pf.checks.find((c) => c.id === id)?.status;
const base = (over = {}) => ({ id: 'rb', mode: 'rebuild', reference: refFile(), destination: join(tempDir(), 'out'), task: 'Rebuild the feature', authorization: 'I wrote this reference.', agent: 'fake', commands: { run: 'node app.js', test: [] }, acceptance: { behaviors: [{ name: 'hello', args: [], expect: { stdout: 'x\n', exit_code: 0 } }] }, trust_project: !SANDBOX, ...over });

test('preflight lists every missing prerequisite at once, with a fix for each', async () => {
  const lab = labWith({ fake: double() });
  lab.create({ id: 'rb', mode: 'rebuild', source: tempDir(), reference: refFile(), task: '', agent: 'fake', trust_project: !SANDBOX });
  const pf = await lab.preflight('rb', 'rebuild');
  assert.equal(pf.ok, false);
  for (const id of ['destination', 'task', 'authorization', 'acceptance']) {
    assert.equal(status(pf, id), 'fail', id);
    assert.ok(pf.checks.find((c) => c.id === id).fix, `${id} has a fix`);
  }
  assert.ok(pf.blockers.length >= 4, 'all blockers are reported together, not one at a time');
});

test('a complete, valid rebuild configuration passes preflight', async () => {
  const lab = labWith({ fake: double() });
  lab.create(base());
  const pf = await lab.preflight('rb', 'rebuild');
  assert.equal(pf.ok, true, JSON.stringify(pf.blockers));
  assert.equal(status(pf, 'acceptance'), 'pass');
  assert.equal(status(pf, 'destination'), 'pass');
});

test('destination must be empty; behaviors need a run command; behaviors cannot be captured from a folder', async () => {
  const dest = join(tempDir(), 'dest');
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, 'x'), '1');
  assert.throws(() => labWith({ fake: double() }).create(base({ destination: dest })), /destination must be empty/, 'creation already refuses a non-empty destination');

  const lab = labWith({ fake: double() });
  lab.create(base());
  const d = lab.get('rb').destination;
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'later.txt'), '1'); // the destination gets filled AFTER the project was created
  assert.equal(status(await lab.preflight('rb', 'rebuild'), 'destination'), 'fail');

  const lab2 = labWith({ fake: double() });
  lab2.create(base({ commands: { run: null } }));
  assert.equal(status(await lab2.preflight('rb', 'rebuild'), 'run-command'), 'fail');

  const lab3 = labWith({ fake: double() });
  const refDir = tempDir();
  writeFileSync(join(refDir, 'a.js'), '1');
  lab3.create(base({ reference: refDir, acceptance: { behaviors: [{ name: 'c', args: [], capture: 'reference' }] } }));
  assert.equal(status(await lab3.preflight('rb', 'rebuild'), 'capture'), 'fail');
});

test('agent problems are reported before the run: not installed, not signed in, no spending cap, no consent', async () => {
  const gone = labWith({ fake: double({ available: false }) });
  gone.create(base());
  assert.match((await gone.preflight('rb', 'rebuild')).checks.find((c) => c.id === 'agent:fake').message, /not installed or not runnable/);

  const out = labWith({ fake: double({ authenticated: false }) });
  out.create(base());
  const pfOut = await out.preflight('rb', 'rebuild');
  assert.match(pfOut.checks.find((c) => c.id === 'agent:fake').message, /not signed in/);
  assert.ok(pfOut.checks.find((c) => c.id === 'agent:fake').fix);

  // spend policy: an agent that cannot report dollars is a BLOCKER until the user allows it, and is never allowed silently
  const un = labWith({ fake: double({ metered: false }) });
  un.create(base());
  const pfUn = await un.preflight('rb', 'rebuild', { studio: true });
  assert.equal(status(pfUn, 'spend:fake'), 'fail');
  assert.match(pfUn.checks.find((c) => c.id === 'spend:fake').fix, /Settings → Execution/);
  const cliFix = (await un.preflight('rb', 'rebuild')).checks.find((c) => c.id === 'spend:fake').fix;
  assert.match(cliFix, /allowUnmeteredAgents/);
  const allowed = labWith({ fake: double({ metered: false }) }, { allowUnmetered: true });
  allowed.create(base());
  assert.equal(status(await allowed.preflight('rb', 'rebuild'), 'spend:fake'), 'warn', 'allowed explicitly: still flagged as running without a dollar cap');

  const remote = labWith({}, { customAgents: { r: { command: 'true', remote: true } } });
  remote.create(base({ agent: 'custom:r' }));
  assert.equal(status(await remote.preflight('rb', 'rebuild'), 'consent'), 'fail');
  assert.equal(status(await remote.preflight('rb', 'rebuild', { allowRemote: ['custom:r'] }), 'consent'), 'pass');
});

test('screenshot rebuild: agent must be able to see images; without a renderer something else must verify', async () => {
  process.env.ERA_RENDERER_DISABLE = '1';
  try {
    const shot = join(tempDir(), 's.png');
    writeFileSync(shot, makePng(800, 600));
    const blind = labWith({ fake: double() }, { customAgents: {} });
    blind.create(base({ reference: shot, acceptance: {} }));
    const pf = await blind.preflight('rb', 'rebuild');
    assert.equal(pf.screenshot, true);
    assert.equal(status(pf, 'agent-images'), 'fail');
    assert.equal(status(pf, 'renderer'), 'fail');
    blind.update('rb', { acceptance: { commands: [{ command: 'test -f index.html' }] } });
    assert.equal(status(await blind.preflight('rb', 'rebuild'), 'renderer'), 'warn');
    const notImage = join(tempDir(), 'bad.png');
    writeFileSync(notImage, 'this is not a png');
    const bad = labWith({ fake: double() });
    bad.create(base({ reference: notImage }));
    const pfBad = await bad.preflight('rb', 'rebuild');
    assert.equal(pfBad.screenshot, true, 'a .png that is not an image is still a screenshot attempt...');
    assert.match(pfBad.checks.find((c) => c.id === 'images').message, /not a PNG, JPEG or WebP/, '...and is reported clearly, never fed to an agent');
    assert.equal(pfBad.ok, false);
    const tiny = join(tempDir(), 't.png');
    writeFileSync(tiny, makePng(20, 20));
    const t = labWith({ fake: double() });
    t.create(base({ reference: tiny }));
    assert.match((await t.preflight('rb', 'rebuild')).checks.find((c) => c.id === 'images').message, /at least 64px/);
  } finally {
    delete process.env.ERA_RENDERER_DISABLE;
  }
});

// ---------------------------------------------------------------- through the control plane

async function plane({ settings = null } = {}) {
  const cwd = tempDir();
  writeFileSync(join(cwd, 'era.config.json'), JSON.stringify({ projectLab: { customAgents: { impl: { command: `node ${join(FIXTURES, 'agents', 'team-agent.mjs')} implementer` }, un: { command: 'true', capabilities: {} } } } }));
  const config = loadConfig(cwd, { ERA_STATE_DIR: join(cwd, 'state'), ERA_REA_BIN: FAKE_ENGINE });
  const rea = new ReaClient({ command: FAKE_ENGINE, stateDir: config.stateDirAbs, measureResources: false });
  const cp = await createControlPlane({ config, rea, version: 'test', env: { ...process.env, ERA_REA_BIN: FAKE_ENGINE } });
  await cp.start();
  const api = async (method, path, body) => {
    const res = await fetch(`${cp.url}${path}`, { method, headers: { Authorization: `Bearer ${cp.token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json };
  };
  if (settings) assert.equal((await api('PUT', '/api/settings', settings)).status, 200);
  return { cp, api, stop: () => cp.stop() };
}
// custom:impl is a script without a dollar cost: the user explicitly allows that here (it is never the default).
const withImpl = { agents: { preset: 'custom', roles: { architect: null, implementer: 'custom:impl', reviewer: null } }, execution: { allowUnmeteredAgents: true } };

test('planning a REBUILD no longer crashes: it creates a project definition, reports what is missing, and checks before starting', async () => {
  const p = await plane({ settings: withImpl });
  try {
    const ref = refFile();
    const dest = join(tempDir(), 'new-project');
    const none = (await p.api('POST', '/api/tasks/plan', { text: 'Rebuild the reference as a new project', mode: 'REBUILD' })).json;
    assert.equal(none.mode, 'REBUILD');
    assert.ok(none.project, 'a (new) project is part of the plan even before the folders are chosen');
    assert.ok(none.blockers.join(' ').includes('No reference is set'));
    assert.ok(none.blockers.join(' ').includes('destination'));
    assert.ok(none.checks.length > 0);

    const ready = (await p.api('POST', '/api/tasks/plan', { text: 'Rebuild the reference as a new project', mode: 'REBUILD', reference: ref, destination: dest, authorization: 'I wrote it', run_command: 'node app.js', accept_commands: ['test -f app.js'] })).json;
    assert.deepEqual(ready.blockers, [], ready.blockers.join(' | '));
    assert.equal(ready.project.exists, false);
    assert.equal(ready.checks.find((c) => c.id === 'acceptance').status, 'pass');
    // starting needs the confirmation, then really creates and starts it
    const started = await p.api('POST', '/api/tasks', { text: 'Rebuild the reference as a new project', mode: 'REBUILD', reference: ref, destination: dest, authorization: 'I wrote it', run_command: 'node app.js', accept_commands: ['test -f app.js'], confirm: true });
    assert.equal(started.status, 200, JSON.stringify(started.json));
    const proj = (await p.api('GET', `/api/projects/${started.json.task.project_id}`)).json.project;
    assert.equal(proj.mode, 'rebuild');
    assert.equal(proj.reference, realpathSync(ref));
    assert.equal(proj.destination, real(dest));
    assert.equal(proj.commands.run, 'node app.js');
    assert.equal(proj.acceptance.commands[0].command, 'test -f app.js');
  } finally {
    await p.stop();
  }
});

test('reference, destination, commands and acceptance edited for an EXISTING project are saved when the task starts', async () => {
  const p = await plane({ settings: withImpl });
  try {
    const first = refFile();
    const created = await p.api('POST', '/api/projects', { id: 'rb', mode: 'rebuild', reference: first, destination: join(tempDir(), 'one'), task: 'old', authorization: 'mine', team: { roles: { implementer: 'custom:impl' } }, trust_project: !SANDBOX });
    assert.equal(created.status, 200, JSON.stringify(created.json));
    const second = refFile();
    const dest2 = join(tempDir(), 'two');
    const plan = (await p.api('POST', '/api/tasks/plan', { text: 'Rebuild the reference as a new project', mode: 'REBUILD', project_id: 'rb', reference: second, destination: dest2, run_command: 'node a.js', test_commands: 'node --test', criteria: ['Prints a greeting'] })).json;
    assert.equal(plan.project.exists, true);
    assert.equal(realpathSync(plan.project.reference), realpathSync(second));
    const started = await p.api('POST', '/api/tasks', { text: 'Rebuild the reference as a new project', mode: 'REBUILD', project_id: 'rb', reference: second, destination: dest2, run_command: 'node a.js', test_commands: 'node --test', criteria: ['Prints a greeting'], confirm: true });
    assert.equal(started.status, 200, JSON.stringify(started.json));
    const after = (await p.api('GET', '/api/projects/rb')).json.project;
    assert.equal(after.reference, realpathSync(second), 'the new reference was saved');
    assert.equal(after.destination, real(dest2), 'the new destination was saved');
    assert.equal(after.commands.run, 'node a.js');
    assert.deepEqual(after.commands.test, ['node --test']);
    assert.deepEqual(after.acceptance.criteria, ['Prints a greeting']);
    assert.equal(after.authorization, 'mine', 'values that were not edited are kept');
  } finally {
    await p.stop();
  }
});

test('starting a rebuild is blocked by preflight with the whole checklist, before any job exists', async () => {
  const p = await plane({ settings: withImpl });
  try {
    await p.api('POST', '/api/projects', { id: 'rb', mode: 'rebuild', reference: refFile(), destination: join(tempDir(), 'x'), task: 'Rebuild', team: { roles: { implementer: 'custom:impl' } }, trust_project: !SANDBOX });
    const pre = (await p.api('GET', '/api/projects/rb/preflight?op=rebuild')).json;
    assert.equal(pre.ok, false);
    assert.equal(pre.checks.find((c) => c.id === 'authorization').status, 'fail');
    assert.equal(pre.checks.find((c) => c.id === 'acceptance').status, 'fail');
    const start = await p.api('POST', '/api/projects/rb/ops/rebuild', {});
    assert.equal(start.status, 409);
    assert.match(start.json.error, /Cannot start rebuild/);
    assert.ok(start.json.detail.checks.some((c) => c.id === 'authorization' && c.status === 'fail'));
    assert.equal((await p.api('GET', '/api/jobs')).json.jobs.length, 0, 'no job was created');
    // fixing the configuration makes the same call pass the gate
    const fixed = await p.api('PATCH', '/api/projects/rb', { authorization: 'I own it', commands: { run: 'node app.js' }, acceptance: { behaviors: [{ name: 'x', args: [], expect: { stdout: '1\n', exit_code: 0 } }] } });
    assert.equal(fixed.status, 200, JSON.stringify(fixed.json));
    assert.equal((await p.api('GET', '/api/projects/rb/preflight?op=rebuild')).json.ok, true);
  } finally {
    await p.stop();
  }
});

test('agents without a dollar cost are NEVER enabled silently: default off, explicit setting, audited, not inherited from the environment', async () => {
  const saved = process.env.ERA_ALLOW_UNMETERED_AGENTS;
  process.env.ERA_ALLOW_UNMETERED_AGENTS = '1'; // a leaked variable in the parent environment must not enable it inside Studio jobs
  const p = await plane();
  try {
    const runJob = async () => {
      const job = p.cp.ctx.jobs.start({ kind: 't', label: 'budget', args: ['agents', '--json'] });
      for (let i = 0; i < 200; i++) {
        const j = p.cp.ctx.jobs.get(job.id);
        if (['succeeded', 'failed'].includes(j.status)) return j;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error('job did not finish');
    };
    assert.equal((await p.api('GET', '/api/settings')).json.settings.execution.allowUnmeteredAgents, false);
    const off = await runJob();
    assert.equal(off.result.budget.allowUnmeteredAgents, false, 'Studio jobs ignore an inherited ERA_ALLOW_UNMETERED_AGENTS while the setting is off');

    assert.equal((await p.api('PUT', '/api/settings', { execution: { allowUnmeteredAgents: 'yes' } })).status, 400);
    assert.equal((await p.api('PUT', '/api/settings', { execution: { allowUnmeteredAgents: true } })).status, 200);
    const on = await runJob();
    assert.equal(on.result.budget.allowUnmeteredAgents, true);
    assert.equal(p.cp.ctx.config.projectLab.budget.allowUnmeteredAgents, true, 'in-process services follow the same policy');
    const actions = (await p.api('GET', '/api/audit')).json.entries.map((e) => e.action);
    assert.ok(actions.includes('policy.unmetered_agents'), 'enabling it is recorded in the audit log');

    assert.equal((await p.api('PUT', '/api/settings', { execution: { allowUnmeteredAgents: false } })).status, 200);
    assert.equal(p.cp.ctx.config.projectLab.budget.allowUnmeteredAgents, false);
    assert.equal((await runJob()).result.budget.allowUnmeteredAgents, false);
  } finally {
    if (saved === undefined) delete process.env.ERA_ALLOW_UNMETERED_AGENTS;
    else process.env.ERA_ALLOW_UNMETERED_AGENTS = saved;
    await p.stop();
  }
});

test('the CLI honors ERA_ALLOW_UNMETERED_AGENTS only when it is exactly "1" and says where the permission came from', () => {
  const on = loadConfig(tempDir(), { ERA_ALLOW_UNMETERED_AGENTS: '1' });
  assert.equal(on.projectLab.budget.allowUnmeteredAgents, true);
  assert.equal(on.projectLab.budget.allowUnmeteredSource, 'ERA_ALLOW_UNMETERED_AGENTS');
  for (const v of ['true', 'yes', '0', '', undefined]) assert.equal(loadConfig(tempDir(), { ERA_ALLOW_UNMETERED_AGENTS: v }).projectLab.budget.allowUnmeteredAgents, false, String(v));
});

// ---------------------------------------------------------------- uploads and artifacts

import { findRenderer, renderAndCompare } from '../src/project_lab/visual.js';
import { candidateIsolation } from '../src/safety/candidate-sandbox.js';

const rawApi = (p) => async (method, path, { body, type, token = p.cp.token } = {}) => {
  const res = await fetch(`${p.cp.url}${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(type ? { 'Content-Type': type } : {}) }, body });
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null;
  try { json = JSON.parse(buf.toString('utf8')); } catch { /* binary */ }
  return { status: res.status, json, buf, type: res.headers.get('content-type') };
};

test('screenshot uploads: validated by content, grouped into a set, served back, token required', async () => {
  const p = await plane();
  try {
    const raw = rawApi(p);
    const png = makePng(640, 480);
    const first = await raw('POST', '/api/uploads?name=my%20shot.png', { body: png, type: 'image/png' });
    assert.equal(first.status, 200, JSON.stringify(first.json));
    assert.deepEqual([first.json.width, first.json.height, first.json.type, first.json.count], [640, 480, 'png', 1]);
    assert.match(first.json.set, /^[0-9a-f]{8}$/);
    const second = await raw('POST', `/api/uploads?set=${first.json.set}`, { body: makePng(800, 600), type: 'image/png' });
    assert.equal(second.json.count, 2);
    assert.equal(second.json.reference_path, first.json.reference_path, 'both belong to one reference folder');
    const back = await raw('GET', `/api/uploads/${first.json.set}/${first.json.file}`);
    assert.equal(back.status, 200);
    assert.equal(back.type, 'image/png');
    assert.ok(back.buf.equals(png));
    // the stored folder works as a project reference, and it is not inside ERA's own installation
    assert.equal((await p.api('POST', '/api/projects', { id: 'shots', mode: 'rebuild', reference: first.json.reference_path, destination: join(tempDir(), 'n'), task: 'x', authorization: 'mine' })).status, 200);
    // refusals
    assert.equal((await raw('POST', '/api/uploads', { body: png, type: 'text/plain' })).status, 415);
    assert.equal((await raw('POST', '/api/uploads', { body: Buffer.from('definitely not a picture'), type: 'image/png' })).status, 400, 'content decides, not the declared type');
    assert.equal((await raw('POST', '/api/uploads', { body: makePng(20, 20), type: 'image/png' })).status, 400);
    assert.equal((await raw('POST', '/api/uploads', { body: png, type: 'image/png', token: null })).status, 401);
    assert.equal((await raw('POST', '/api/uploads?set=../../etc', { body: png, type: 'image/png' })).status, 400);
    assert.equal((await raw('GET', `/api/uploads/${first.json.set}/..%2f..%2fpackage.json`)).status, 400);
    assert.equal((await raw('GET', '/api/uploads/00000000/shot-01.png')).status, 404);
    const big = await raw('POST', '/api/uploads', { body: Buffer.alloc(14 * 1024 * 1024), type: 'image/png' });
    assert.equal(big.status, 413);
  } finally {
    await p.stop();
  }
});

const RENDERER = findRenderer();
test('a screenshot rebuild through the control plane: upload → preflight → job → visual result → artifacts', { skip: !RENDERER && 'no Electron renderer installed (npm install in apps/studio)' }, async () => {
  const p = await plane({ settings: { agents: { preset: 'custom', roles: { architect: null, implementer: 'custom:shot', reviewer: null } }, execution: { allowUnmeteredAgents: true } } });
  try {
    const raw = rawApi(p);
    // a real "screenshot": the renderer's capture of the reference page
    const work = tempDir();
    const dummy = join(work, 'd.png');
    writeFileSync(dummy, makePng(1280, 720));
    const sites = join(FIXTURES, 'screenshot');
    const ref = await renderAndCompare({ renderer: RENDERER, htmlPath: join(sites, 'page-a', 'index.html'), referencePath: dummy, outDir: join(work, 'ref'), width: 1280, height: 720, isolation: SANDBOX ? candidateIsolation() : { mode: 'trusted', mechanism: 'none' } });
    assert.equal(ref.ok, true, ref.error);
    const { readFileSync } = await import('node:fs');
    const up = await raw('POST', '/api/uploads?name=landing.png', { body: readFileSync(join(work, 'ref', 'rendered.png')), type: 'image/png' });
    assert.equal(up.status, 200, JSON.stringify(up.json));

    // register the agent that plays the implementer (a script; images arrive in ERA_REFERENCE_IMAGES)
    const cfgFile = join(p.cp.ctx.config.cwd, 'era.config.json');
    writeFileSync(cfgFile, JSON.stringify({ projectLab: { customAgents: { shot: { command: `node ${join(FIXTURES, 'agents', 'screenshot-agent.mjs')} faithful ${sites}`, capabilities: { images: 'env' } } } } }));
    p.cp.ctx.config.projectLab.customAgents = { shot: { command: `node ${join(FIXTURES, 'agents', 'screenshot-agent.mjs')} faithful ${sites}`, capabilities: { images: 'env' } } };

    const made = await p.api('POST', '/api/projects', { id: 'landing', mode: 'rebuild', reference: up.json.reference_path, destination: join(tempDir(), 'site'), task: 'Recreate this landing page as a static website', authorization: 'I designed this page.', team: { roles: { implementer: 'custom:shot' } }, trust_project: !SANDBOX });
    assert.equal(made.status, 200, JSON.stringify(made.json));
    const pre = (await p.api('GET', '/api/projects/landing/preflight?op=rebuild')).json;
    assert.equal(pre.ok, true, JSON.stringify(pre.blockers));
    assert.equal(pre.screenshot, true);
    assert.equal(pre.checks.find((c) => c.id === 'renderer').status, 'pass');
    const started = await p.api('POST', '/api/projects/landing/ops/rebuild', {});
    assert.equal(started.status, 200, JSON.stringify(started.json));
    let job;
    for (let i = 0; i < 600; i++) {
      job = (await p.api('GET', `/api/jobs/${started.json.job.id}`)).json;
      if (['succeeded', 'failed', 'cancelled'].includes(job.status)) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.equal(job.status, 'succeeded', JSON.stringify(job.log_tail?.slice(-4)));
    const detail = (await p.api('GET', '/api/projects/landing/runs/latest')).json;
    assert.equal(detail.finalize.pass, true, JSON.stringify(detail.finalize.reasons));
    assert.ok(detail.finalize.visual.score >= 0.75);
    assert.equal(detail.finalize.screenshot.images.length, 1);
    // the UI can show reference and rendering through the artifact route, and nothing else
    const a = `/api/projects/landing/runs/latest/artifact?path=`;
    const refImg = await raw('GET', `${a}reference-images%2Freference-1.png`);
    const outImg = await raw('GET', `${a}${encodeURIComponent(detail.finalize.visual.rendered)}`);
    assert.equal(refImg.status, 200);
    assert.equal(outImg.status, 200);
    assert.equal(refImg.type, 'image/png');
    assert.deepEqual([...outImg.buf.subarray(1, 4)], [0x50, 0x4e, 0x47]);
    for (const bad of ['project.json', '..%2Frun.json', 'reference-images%2F..%2F..%2Fproject.json', 'run.json', 'visual-attempt-1%2Fresult.json']) assert.equal((await raw('GET', `${a}${bad}`)).status, 403, bad);
  } finally {
    await p.stop();
  }
});
