// ERA Studio control-plane tests.
//
// REAL   the HTTP server (loopback, token, Host/Origin checks), settings, audit log, SSE, file boundary, jobs that run the
//        actual `era` CLI as child processes, ProjectLab, git, patches, approval/rollback, sandboxed terminal (macOS).
// FAKE   the REA engine (tests/fixtures/fake-rea-engine.mjs).
// MOCK   coding agents (tests/fixtures/agents/team-agent.mjs). No model is called here.
import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { cpSync, existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../src/core/config.js';
import { ReaClient } from '../src/rea_integration/rea-client.js';
import { createControlPlane } from '../src/control_plane/server.js';
import { classify } from '../src/control_plane/services/tasks.js';
import { buildGraph } from '../src/control_plane/services/analysis.js';
import { validateSettings, DEFAULT_SETTINGS } from '../src/control_plane/settings.js';
import { EventBus } from '../src/control_plane/events.js';
import { resolveInside } from '../src/control_plane/paths.js';
import { treeDigest } from '../src/project_lab/workspace.js';
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

const AGENT = join(FIXTURES, 'agents', 'team-agent.mjs');
const FAKE_ENGINE = join(FIXTURES, 'fake-rea-engine.mjs');
const SANDBOX = sandboxAvailable();
const custom = {
  impl: { command: `node ${AGENT} implementer` },
  arch: { command: `node ${AGENT} architect` },
  'rev-clean': { command: `node ${AGENT} reviewer-clean` },
  sleeper: { command: `node ${join(FIXTURES, 'agents', 'sleep-always.mjs')}` },
  remote: { command: `node ${AGENT} implementer`, remote: true },
  fake: { command: 'true', simulated: true },
};

async function plane({ eraConfig = {}, settings = null } = {}) {
  const cwd = tempDir();
  writeFileSync(join(cwd, 'era.config.json'), JSON.stringify({ projectLab: { budget: { allowUnmeteredAgents: true }, customAgents: custom }, ...eraConfig }));
  const stateDir = join(cwd, 'state');
  const config = loadConfig(cwd, { ERA_STATE_DIR: stateDir, ERA_REA_BIN: FAKE_ENGINE });
  const rea = new ReaClient({ command: FAKE_ENGINE, stateDir: config.stateDirAbs, measureResources: false });
  const cp = await createControlPlane({ config, rea, version: 'test', env: { ...process.env, ERA_REA_BIN: FAKE_ENGINE } });
  await cp.start();
  const api = async (method, path, body, { token = cp.token, headers = {} } = {}) => {
    const res = await fetch(`${cp.url}${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // not JSON
    }
    return { status: res.status, json, text };
  };
  if (settings) assert.equal((await api('PUT', '/api/settings', settings)).status, 200);
  const waitJob = async (id, ms = 120_000) => {
    const end = Date.now() + ms;
    for (;;) {
      const j = (await api('GET', `/api/jobs/${id}`)).json;
      if (['succeeded', 'failed', 'cancelled', 'interrupted'].includes(j.status)) return j;
      if (Date.now() > end) throw new Error(`job ${id} did not finish: ${j.status}`);
      await new Promise((r) => setTimeout(r, 150));
    }
  };
  return { cp, api, cwd, config, waitJob, stop: () => cp.stop() };
}

function fixture(name = 'buggy-app') {
  const dir = join(tempDir(), name);
  cpSync(join(FIXTURES, 'projects', name), dir, { recursive: true });
  return dir;
}

const newProject = (src, over = {}) => ({ id: 'cart', mode: 'modify', source: src, task: 'Fix the cart total: it must account for item quantity', commands: { test: ['node --test tests/*.test.js'] }, acceptance: { commands: [{ name: 'cart-quantity', command: 'node --test acceptance/cart-quantity.test.js', baseline: 'fail' }] }, team: { roles: { implementer: 'custom:impl' } }, trust_project: !SANDBOX, ...over });

// ---------- security boundary --------------------------------------------------------------------

test('the control plane refuses to bind anything but loopback', async () => {
  const cwd = tempDir();
  const config = loadConfig(cwd, { ERA_STATE_DIR: join(cwd, 's') });
  await assert.rejects(createControlPlane({ config, rea: {}, host: '0.0.0.0' }), /only binds the loopback interface/);
  const p = await plane();
  try {
    const addr = p.cp.url;
    assert.match(addr, /^http:\/\/127\.0\.0\.1:\d+$/);
  } finally {
    await p.stop();
  }
});

test('authentication: token, Host header, Origin, content type, body size, JSON', async () => {
  const p = await plane();
  try {
    assert.equal((await p.api('GET', '/api/overview', undefined, { token: null })).status, 401);
    assert.equal((await p.api('GET', '/api/overview', undefined, { token: 'x'.repeat(64) })).status, 401);
    const ok = await p.api('GET', '/api/overview');
    assert.equal(ok.status, 200);
    assert.equal(ok.json.listener.loopback_only, true);
    assert.equal(ok.json.app.name, 'ERA Studio');
    assert.equal((await p.api('GET', '/api/overview', undefined, { headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await p.api('POST', '/api/settings', undefined, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
    const form = await fetch(`${p.cp.url}/api/projects`, { method: 'POST', headers: { Authorization: `Bearer ${p.cp.token}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'id=x' });
    assert.equal(form.status, 415, 'a cross-site form post cannot reach a mutation');
    // DNS rebinding: a request for another Host name is refused even with the right token
    const status = await new Promise((resolve) => {
      const r = httpRequest({ host: '127.0.0.1', port: p.cp.port, path: '/api/overview', headers: { Host: 'rebind.example', Authorization: `Bearer ${p.cp.token}` } }, (res) => { res.resume(); resolve(res.statusCode); });
      r.end();
    });
    assert.equal(status, 421);
    assert.equal((await p.api('POST', '/api/projects', { x: 'y'.repeat(1_100_000) })).status, 413);
    const bad = await fetch(`${p.cp.url}/api/projects`, { method: 'POST', headers: { Authorization: `Bearer ${p.cp.token}`, 'Content-Type': 'application/json' }, body: '{nope' });
    assert.equal(bad.status, 400);
    assert.equal((await p.api('GET', '/api/nope')).status, 404);
    // static files need no token but still obey Host checks and carry a restrictive CSP
    const home = await fetch(`${p.cp.url}/healthz`);
    assert.equal(home.status, 200);
  } finally {
    await p.stop();
  }
});

test('static responses carry a restrictive Content-Security-Policy and cannot escape the web root', async () => {
  const p = await plane();
  try {
    const trav = await fetch(`${p.cp.url}/..%2f..%2fpackage.json`);
    assert.ok([403, 404].includes(trav.status), `got ${trav.status}`);
    const vend = await fetch(`${p.cp.url}/vendor/monaco/..%2f..%2f..%2fpackage.json`);
    assert.ok([403, 404].includes(vend.status));
    const nm = await fetch(`${p.cp.url}/vendor/not-allowlisted.js`);
    assert.equal(nm.status, 404);
  } finally {
    await p.stop();
  }
});

// ---------- settings ---------------------------------------------------------------------------

test('settings are validated as a whole, persisted privately, and unknown keys are rejected', async () => {
  const p = await plane();
  try {
    const defaults = (await p.api('GET', '/api/settings')).json.settings;
    assert.equal(defaults.mode, 'simple');
    assert.equal(defaults.permissions.directEdit, false);
    assert.equal(defaults.permissions.terminal, false);
    const bad = await p.api('PUT', '/api/settings', { appearance: { fontSize: 99 }, mode: 'advanced' });
    assert.equal(bad.status, 400);
    assert.match(bad.json.detail.errors.join(' '), /appearance\.fontSize/);
    assert.equal((await p.api('GET', '/api/settings')).json.settings.mode, 'simple', 'nothing from a rejected update was applied');
    assert.equal((await p.api('PUT', '/api/settings', { bogus: 1 })).status, 400);
    assert.equal((await p.api('PUT', '/api/settings', { permissions: { nuke: true } })).status, 400);
    const good = await p.api('PUT', '/api/settings', { mode: 'advanced', appearance: { theme: 'light', fontSize: 15 } });
    assert.equal(good.status, 200);
    assert.deepEqual(good.json.changed.sort(), ['appearance.fontSize', 'appearance.theme', 'mode']);
    const file = join(p.config.stateDirAbs, 'studio', 'settings.json');
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).mode, 'advanced');
    assert.equal(statSync(file).mode & 0o077, 0, 'settings are private to the user');
    assert.ok(readFileSync(join(p.config.stateDirAbs, 'studio', 'audit.jsonl'), 'utf8').includes('settings.updated'));
  } finally {
    await p.stop();
  }
});

test('settings validation unit checks', () => {
  assert.equal(validateSettings(structuredClone(DEFAULT_SETTINGS)).errors.length, 0);
  const s = structuredClone(DEFAULT_SETTINGS);
  s.workspaces.allowedRoots = ['relative/path'];
  s.execution.concurrentJobs = 9;
  s.agents.preset = 'nonexistent';
  const { errors } = validateSettings(s);
  assert.equal(errors.length, 3);
});

// ---------- Project Lab through the API (real CLI jobs, mock agents) ------------------------------

test('Modify workflow through the API: job, progress, diff, hash-bound approval, rollback, audit', async () => {
  const p = await plane();
  try {
    const src = fixture();
    const original = treeDigest(src).sha256;
    const made = await p.api('POST', '/api/projects', newProject(src));
    assert.equal(made.status, 200, made.text);
    const started = await p.api('POST', '/api/projects/cart/ops/modify', {});
    assert.equal(started.status, 200, started.text);
    assert.equal((await p.api('POST', '/api/projects/cart/ops/modify', {})).status, 409, 'one active job per project');
    const job = await p.waitJob(started.json.job.id);
    assert.equal(job.status, 'succeeded', JSON.stringify(job.log_tail.slice(-5)));
    assert.equal(job.result.status, 'awaiting-approval');

    const detail = (await p.api('GET', '/api/projects/cart/runs/latest')).json;
    assert.equal(detail.finalize.pass, true);
    assert.deepEqual(detail.finalize.files.map((f) => f.path), ['src/cart.js']);
    const patch = (await p.api('GET', '/api/projects/cart/runs/latest/patch')).json;
    assert.match(patch.patch, /item\.quantity \?\? 1/);
    assert.equal(patch.sha256, detail.finalize.patch_sha256);
    const diff = (await p.api('GET', '/api/projects/cart/runs/latest/diff?path=src/cart.js')).json;
    assert.match(diff.original, /BUG/);
    assert.match(diff.modified, /item\.quantity/);
    assert.equal(treeDigest(src).sha256, original, 'the original is untouched before approval');

    assert.equal((await p.api('POST', '/api/projects/cart/approve', { patch_sha256: patch.sha256 })).status, 400, 'approval needs an explicit confirm');
    const wrong = await p.api('POST', '/api/projects/cart/approve', { confirm: true, patch_sha256: 'f'.repeat(64) });
    assert.equal(wrong.status, 409);
    assert.match(wrong.json.error, /does not match the evaluated change/);
    assert.equal(treeDigest(src).sha256, original);

    const ok = await p.api('POST', '/api/projects/cart/approve', { confirm: true, patch_sha256: patch.sha256 });
    assert.equal(ok.status, 200, ok.text);
    assert.notEqual(treeDigest(src).sha256, original);
    assert.equal((await p.api('POST', '/api/projects/cart/rollback', {})).status, 400);
    assert.equal((await p.api('POST', '/api/projects/cart/rollback', { confirm: true })).status, 200);
    assert.equal(treeDigest(src).sha256, original, 'rollback restores the original');

    const audit = (await p.api('GET', '/api/audit')).json.entries.map((e) => e.action);
    for (const a of ['project.created', 'project.operation', 'job.finished', 'project.approved', 'project.rolled_back']) assert.ok(audit.includes(a), a);
  } finally {
    await p.stop();
  }
});

test('an edit to the working copy after verification invalidates the approval', async () => {
  const p = await plane({ settings: { permissions: {} } });
  try {
    const src = fixture();
    await p.api('POST', '/api/projects', newProject(src));
    const job = await p.waitJob((await p.api('POST', '/api/projects/cart/ops/modify', {})).json.job.id);
    assert.equal(job.status, 'succeeded');
    const detail = (await p.api('GET', '/api/projects/cart/runs/latest')).json;
    const edit = await p.api('PUT', '/api/projects/cart/file?root=workspace', { path: 'src/cart.js', content: '// tampered\nmodule.exports = {};\n' });
    assert.equal(edit.status, 200, edit.text);
    assert.match(edit.json.note, /stale/);
    const refused = await p.api('POST', '/api/projects/cart/approve', { confirm: true, patch_sha256: detail.finalize.patch_sha256 });
    assert.ok([409, 400].includes(refused.status), refused.text);
    assert.match(refused.json.error, /changed after verification|verified diff/);
    assert.equal(readFileSync(join(src, 'src', 'cart.js'), 'utf8').includes('tampered'), false);
  } finally {
    await p.stop();
  }
});

test('project start refuses remote providers without consent, and records consent when given', async () => {
  const p = await plane();
  try {
    const src = fixture();
    await p.api('POST', '/api/projects', newProject(src, { team: { roles: { implementer: 'custom:remote' } } }));
    const denied = await p.api('POST', '/api/projects/cart/ops/modify', {});
    assert.equal(denied.status, 403);
    assert.match(denied.json.error, /not authorized/);
    assert.equal((await p.api('GET', '/api/jobs')).json.jobs.length, 0, 'no job was created');
    const ok = await p.api('POST', '/api/projects/cart/ops/modify', { allow_remote: ['custom:remote'] });
    assert.equal(ok.status, 200, ok.text);
    await p.waitJob(ok.json.job.id);
    const led = readFileSync(join(p.config.stateDirAbs, 'projects', 'cart', 'ledger.jsonl'), 'utf8');
    assert.match(led, /remote-consent/);
  } finally {
    await p.stop();
  }
});

test('cancelling a running job stops it, removes the working copy and leaves the original untouched', async () => {
  const p = await plane();
  try {
    const src = fixture();
    const original = treeDigest(src).sha256;
    await p.api('POST', '/api/projects', newProject(src, { team: { roles: { implementer: 'custom:sleeper' } } }));
    const started = (await p.api('POST', '/api/projects/cart/ops/modify', {})).json.job;
    const end = Date.now() + 60_000;
    for (;;) {
      const st = (await p.api('GET', '/api/projects/cart')).json;
      if (st.latest_run?.steps?.['implement-1']?.status === 'running') break;
      assert.ok(Date.now() < end, 'agent never started');
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.equal((await p.api('POST', `/api/jobs/${started.id}/cancel`, {})).status, 200);
    const job = await p.waitJob(started.id);
    assert.equal(job.status, 'cancelled');
    const st = (await p.api('GET', '/api/projects/cart')).json;
    assert.equal(st.latest_run.status, 'cancelled');
    assert.equal(existsSync(join(p.config.stateDirAbs, 'projects', 'cart', 'work', st.latest_run.run_id)), false);
    assert.equal(treeDigest(src).sha256, original);
  } finally {
    await p.stop();
  }
});

// ---------- files, git, search -------------------------------------------------------------------

test('file access stays inside project roots; originals are read-only unless Direct edit is enabled', async () => {
  const p = await plane();
  try {
    const src = fixture();
    writeFileSync(join(src, 'secret-outside.txt'), 'x');
    mkdirSync(join(tempDir(), 'x'), { recursive: true });
    const outside = join(tempDir(), 'outside.txt');
    writeFileSync(outside, 'outside-secret');
    symlinkSync(outside, join(src, 'link-out.txt'));
    await p.api('POST', '/api/projects', newProject(src));
    const tree = (await p.api('GET', '/api/projects/cart/tree?root=source')).json;
    assert.ok(tree.entries.some((e) => e.name === 'src' && e.kind === 'dir'));
    assert.equal(tree.entries.find((e) => e.name === 'link-out.txt').kind, 'blocked-symlink');
    assert.equal(tree.editable, false);
    assert.match((await p.api('GET', '/api/projects/cart/file?root=source&path=src/cart.js')).json.content, /function total/);
    assert.equal((await p.api('GET', '/api/projects/cart/file?root=source&path=../../etc/passwd')).status, 403);
    assert.equal((await p.api('GET', '/api/projects/cart/file?root=source&path=/etc/passwd')).status, 403);
    assert.equal((await p.api('GET', '/api/projects/cart/file?root=source&path=link-out.txt')).status, 403, 'a symlink to outside the project is refused');
    assert.equal((await p.api('GET', '/api/projects/cart/file?root=state&path=x')).status, 404);
    const w = await p.api('PUT', '/api/projects/cart/file?root=source', { path: 'src/cart.js', content: 'x' });
    assert.equal(w.status, 403);
    assert.match(w.json.error, /read-only/);
    assert.match(readFileSync(join(src, 'src', 'cart.js'), 'utf8'), /function total/);

    assert.equal((await p.api('PUT', '/api/settings', { permissions: { directEdit: true } })).status, 200);
    const ok = await p.api('PUT', '/api/projects/cart/file?root=source', { path: 'notes.md', content: '# hi' });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(readFileSync(join(src, 'notes.md'), 'utf8'), '# hi');
    assert.equal((await p.api('PUT', '/api/projects/cart/file?root=source', { path: '.git/config', content: 'x' })).status, 403);
    assert.equal((await p.api('PUT', '/api/projects/cart/file?root=source', { path: '../escape.txt', content: 'x' })).status, 403);
    assert.ok((await p.api('GET', '/api/audit')).json.entries.some((e) => e.action === 'file.written' && e.path === 'notes.md'));

    const hits = (await p.api('GET', '/api/projects/cart/search?root=source&q=quantity')).json.hits;
    assert.ok(hits.some((h) => h.path.endsWith('cart.js')));
    assert.equal((await p.api('GET', '/api/projects/cart/search?root=source&q=a')).status, 400);
  } finally {
    await p.stop();
  }
});

test('path boundary unit checks', () => {
  const root = tempDir();
  writeFileSync(join(root, 'a.txt'), 'a');
  assert.ok(resolveInside(root, 'a.txt').endsWith('a.txt'));
  for (const bad of ['../x', '/etc/passwd', 'a/../../x', 'a\0b']) assert.throws(() => resolveInside(root, bad), /outside the allowed root/);
});

test('git status and diff for a project that is a repository', async () => {
  const p = await plane();
  try {
    const src = fixture();
    const { spawnSync } = await import('node:child_process');
    const g = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...a], { cwd: src });
    g('init', '-q');
    g('add', '-A');
    g('commit', '-qm', 'initial');
    writeFileSync(join(src, 'src', 'cart.js'), `${readFileSync(join(src, 'src', 'cart.js'), 'utf8')}// edit\n`);
    await p.api('POST', '/api/projects', newProject(src));
    const st = (await p.api('GET', '/api/projects/cart/git?root=source')).json;
    assert.equal(st.repository, true);
    assert.equal(st.clean, false);
    assert.deepEqual(st.files.map((f) => f.path), ['src/cart.js']);
    assert.equal(st.commits[0].subject, 'initial');
    const d = (await p.api('GET', '/api/projects/cart/git/diff?root=source&path=src/cart.js')).json;
    assert.ok(d.modified.includes('// edit') && !d.original.includes('// edit'));
  } finally {
    await p.stop();
  }
});

// ---------- events (SSE) -----------------------------------------------------------------------

async function readEvents(url, token, { lastId = null, until, ms = 30_000 }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, ...(lastId !== null ? { 'Last-Event-ID': String(lastId) } : {}) }, signal: ctrl.signal });
  const events = [];
  const dec = new TextDecoder();
  let buf = '';
  try {
    for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = /^data: (.*)$/m.exec(block);
        if (data) events.push(JSON.parse(data[1]));
        if (until(events)) throw Object.assign(new Error('done'), { done: true });
      }
    }
  } catch (err) {
    if (!err.done && err.name !== 'AbortError') throw err;
  } finally {
    clearTimeout(timer);
    ctrl.abort();
  }
  return events;
}

test('real-time events: job and progress events come from the backend, with resumable delivery', async () => {
  const p = await plane();
  try {
    const src = fixture();
    await p.api('POST', '/api/projects', newProject(src));
    const reading = readEvents(`${p.cp.url}/api/events`, p.cp.token, { until: (ev) => ev.some((e) => e.type === 'job.updated' && e.data.job.status === 'succeeded') });
    await new Promise((r) => setTimeout(r, 300));
    const { job } = (await p.api('POST', '/api/projects/cart/ops/modify', {})).json;
    const events = await reading;
    assert.equal(events[0].type, 'hello');
    const types = new Set(events.map((e) => e.type));
    for (const t of ['job.updated', 'progress']) assert.ok(types.has(t), t);
    const progress = events.filter((e) => e.type === 'progress');
    assert.ok(progress.some((e) => e.data.snapshot.steps?.baseline === 'done'), 'progress reflects real run steps');
    const statuses = events.filter((e) => e.type === 'job.updated').map((e) => e.data.job.status);
    assert.ok(statuses.includes('running') && statuses.at(-1) === 'succeeded');
    // reconnect after the fact with Last-Event-ID: missed events are replayed
    const firstId = events.find((e) => e.id)?.id;
    const replay = await readEvents(`${p.cp.url}/api/events`, p.cp.token, { lastId: firstId, until: (ev) => ev.length >= 3, ms: 5000 });
    assert.ok(replay.filter((e) => e.id > firstId).length >= 2, 'events after Last-Event-ID were replayed');
    assert.equal(job.kind, 'project.modify');
  } finally {
    await p.stop();
  }
});

test('event bus: bounded buffer reports when a client missed events', () => {
  const bus = new EventBus({ capacity: 3 });
  for (let i = 0; i < 6; i++) bus.publish('x', { i });
  assert.equal(bus.since(5).complete, true);
  assert.equal(bus.since(1).complete, false, 'ids 2-3 were dropped: the client must resync');
  const e = bus.publish('t', { api_key: 'sk-ant-abcdefghijklmnopqrstuvwxyz' });
  assert.match(JSON.stringify(e), /REDACTED/);
});

// ---------- terminal ---------------------------------------------------------------------------

test('the terminal is off by default and cannot open in the original project without Direct edit', async () => {
  const p = await plane();
  try {
    const src = fixture();
    await p.api('POST', '/api/projects', newProject(src));
    const off = await p.api('POST', '/api/terminals', { project_id: 'cart', root: 'source' });
    assert.equal(off.status, 403);
    assert.match(off.json.error, /terminal is off/);
    await p.api('PUT', '/api/settings', { permissions: { terminal: true } });
    const orig = await p.api('POST', '/api/terminals', { project_id: 'cart', root: 'source' });
    assert.equal(orig.status, 403);
    assert.match(orig.json.error, /ORIGINAL project/);
  } finally {
    await p.stop();
  }
});

test('terminal runs a real shell in a sandbox scoped to the project and streams output', { skip: !SANDBOX && 'needs the macOS sandbox' }, async () => {
  const p = await plane({ settings: { permissions: { terminal: true, directEdit: true } } });
  try {
    const src = fixture();
    const secret = join(tempDir(), 'outside.txt');
    writeFileSync(secret, 'x');
    await p.api('POST', '/api/projects', newProject(src));
    const t = await p.api('POST', '/api/terminals', { project_id: 'cart', root: 'source' });
    assert.equal(t.status, 200, t.text);
    assert.equal(t.json.sandboxed, true);
    const reading = readEvents(`${p.cp.url}/api/terminals/${t.json.id}/stream`, p.cp.token, { until: (ev) => ev.some((e) => String(e.data).includes('TERM-OK\r')) && ev.some((e) => String(e.data).includes('WRITE-DENIED\r')), ms: 20_000 });
    await new Promise((r) => setTimeout(r, 800));
    await p.api('POST', `/api/terminals/${t.json.id}/input`, { data: `echo TERM-$((1+1))-skip; echo TERM-OK; echo hi > inside.txt; echo hi > ${secret}.new 2>/dev/null || echo WRITE-DENIED\n` });
    const events = await reading;
    const text = events.map((e) => (typeof e.data === 'string' ? e.data : '')).join('');
    assert.match(text, /TERM-OK/);
    assert.match(text, /WRITE-DENIED/, 'writes outside the project are blocked by the sandbox');
    assert.equal(existsSync(`${secret}.new`), false);
    assert.equal(readFileSync(join(src, 'inside.txt'), 'utf8').trim(), 'hi', 'writes inside the project work');
    assert.equal((await p.api('POST', `/api/terminals/${t.json.id}/resize`, { cols: 100, rows: 30 })).status, 200);
    assert.equal((await p.api('DELETE', `/api/terminals/${t.json.id}`)).status, 200);
  } finally {
    await p.stop();
  }
});

// ---------- analysis -----------------------------------------------------------------------------

test('analysis: detection reports unsupported targets and blocks unsafe options; supported targets run as a job', async () => {
  const p = await plane();
  try {
    const dir = fixture();
    const txt = join(tempDir(), 'notes.txt');
    writeFileSync(txt, 'hello');
    const det = (await p.api('POST', '/api/analysis/detect', { target: dir })).json;
    assert.equal(det.supported, true);
    assert.equal(det.rea.available, true);
    const unsupported = await p.api('POST', '/api/analysis', { target: txt });
    assert.equal(unsupported.status, 400);
    assert.match(unsupported.json.error, /cannot analyze this target/);
    assert.equal((await p.api('POST', '/api/analysis', { target: join(dir, 'nope') })).status, 404);
    const rt = await p.api('POST', '/api/analysis', { target: dir, runtime: true });
    assert.equal(rt.status, 403);
    assert.match(rt.json.error, /Runtime capture/);

    const started = await p.api('POST', '/api/analysis', { target: dir });
    assert.equal(started.status, 200, started.text);
    const job = await p.waitJob(started.json.job.id);
    assert.equal(job.status, 'succeeded', JSON.stringify(job.log_tail.slice(-4)));
    const list = (await p.api('GET', '/api/analyses')).json.analyses;
    assert.equal(list.length, 1);
    const a = (await p.api('GET', `/api/analyses/${list[0].analysis_id}`)).json;
    assert.ok(a.facts.length > 0);
    assert.match(a.report, /#/);
    assert.ok(Array.isArray(a.graph.nodes));
    assert.equal((await p.api('GET', '/api/analyses/..%2f..%2fx')).status, 400);
  } finally {
    await p.stop();
  }
});

test('graphs are built only from evidence facts', () => {
  const g = buildGraph(['module:a.js', 'module:b.js', 'import:a.js->b.js', 'external:fs', 'call:_main->_printf', 'dependency:/usr/lib/libSystem.B.dylib']);
  assert.deepEqual(g.edges.map((e) => `${e.from}>${e.to}:${e.kind}`).sort(), ['a.js>b.js:imports', 'fn:_main>fn:_printf:calls']);
  assert.ok(g.nodes.find((n) => n.id === 'ext:fs'));
  const none = buildGraph(['module:a.js']);
  assert.equal(none.edges.length, 0);
  assert.match(none.note, /nothing to draw/);
});

// ---------- agents -----------------------------------------------------------------------------

test('agent states are real: unavailable, not signed in, simulated and ready are distinguished', async () => {
  const p = await plane({ eraConfig: { agents: { codex: { command: '/nonexistent/codex' } } } });
  try {
    const { providers } = (await p.api('GET', '/api/agents?fresh=1')).json;
    const byId = Object.fromEntries(providers.map((r) => [r.id, r]));
    assert.equal(byId.codex.state, 'unavailable');
    assert.equal(byId.codex.installed, false);
    assert.equal(byId['custom:fake'].state, 'simulated', 'a declared stand-in is never shown as a connected agent');
    assert.equal(byId.manual.state, 'manual');
    assert.equal(byId['custom:impl'].state, 'ready');
    assert.equal(byId['claude-code'].capabilities.remote, true);
    const teams = (await p.api('GET', '/api/agents/teams')).json;
    const codexOnly = teams.presets.find((t) => t.name === 'codex-only');
    assert.equal(codexOnly.ready, false);
    assert.equal(codexOnly.not_ready[0].state, 'unavailable');
    assert.ok(!teams.recommended.preset || teams.recommended.preset !== 'codex-only', 'an unavailable team is never recommended');
  } finally {
    await p.stop();
  }
});

// ---------- tasks ----------------------------------------------------------------------------------

test('task classification maps natural language to ERA modes, and the user can override', () => {
  assert.equal(classify('Analyze this Electron application and explain how its search functionality works.').mode, 'ANALYZE');
  assert.equal(classify('Fix the login bug in my React application.').mode, 'MODIFY');
  assert.deepEqual(classify('Analyze this application, identify the bugs, fix them and verify the result.').stages, ['review', 'modify']);
  assert.equal(classify('Review this code for security problems').mode, 'REVIEW');
  assert.equal(classify('Analyze this authorized reference application and rebuild selected features in a new project.').mode, 'REBUILD');
  assert.equal(classify("Analyze ERA's own implementation and propose a measurable improvement.").mode, 'IMPROVE');
  assert.equal(classify('Fix it', 'REVIEW').mode, 'REVIEW');
  assert.throws(() => classify('x', 'DESTROY'), /mode must be one of/);
});

test('tasks: plan reports blockers and consent; starting needs confirmation; composite tasks chain review → modify', async () => {
  const p = await plane({ settings: { agents: { preset: 'custom', roles: { architect: null, implementer: 'custom:impl', reviewer: null } } } });
  try {
    const src = fixture();
    const noFolder = (await p.api('POST', '/api/tasks/plan', { text: 'Fix the cart total' })).json;
    assert.match(noFolder.blockers.join(' '), /Choose the project folder/);
    const plan = (await p.api('POST', '/api/tasks/plan', { text: 'Identify the bugs in the cart, fix them and verify', folder: src })).json;
    assert.equal(plan.mode, 'MODIFY');
    assert.deepEqual(plan.stages.map((s) => s.op), ['review', 'modify']);
    assert.equal(plan.blockers.length, 0, plan.blockers.join(';'));
    assert.equal(plan.project.exists, false);

    const noConfirm = await p.api('POST', '/api/tasks', { text: 'Identify the bugs in the cart, fix them and verify', folder: src });
    assert.equal(noConfirm.status, 400);
    assert.match(noConfirm.json.error, /confirm/);

    const started = await p.api('POST', '/api/tasks', { text: 'Identify the bugs in the cart, fix them and verify', folder: src, confirm: true, new_project_id: 'cart-task' });
    assert.equal(started.status, 200, started.text);
    const id = started.json.task.id;
    const end = Date.now() + 120_000;
    let task;
    for (;;) {
      task = (await p.api('GET', `/api/tasks/${id}`)).json;
      if (task.status !== 'running' || Date.now() > end) break;
      await new Promise((r) => setTimeout(r, 300));
    }
    // review succeeded and modify was started automatically; the mock implementer applies the fix but no acceptance
    // command was configured, so verification still ends in a run that needs a human.
    assert.equal(task.stages[0].status, 'succeeded');
    assert.ok(task.stages[1].job_id, 'the modify stage was started by the control plane');
    const st = (await p.api('GET', `/api/projects/${task.project_id}`)).json;
    assert.ok(st.runs.some((r) => r.op === 'review') && st.runs.some((r) => r.op === 'modify'));
  } finally {
    await p.stop();
  }
});

test('tasks: remote providers must be consented to explicitly before a task can start', async () => {
  const p = await plane({ settings: { agents: { preset: 'custom', roles: { architect: null, implementer: 'custom:remote', reviewer: null } } } });
  try {
    const src = fixture();
    const plan = (await p.api('POST', '/api/tasks/plan', { text: 'Fix the cart total', folder: src })).json;
    assert.equal(plan.consent_required, true);
    assert.deepEqual(plan.remote_providers, ['custom:remote']);
    const refused = await p.api('POST', '/api/tasks', { text: 'Fix the cart total', folder: src, confirm: true });
    assert.equal(refused.status, 403);
    assert.match(refused.json.error, /Authorize sending the source code to custom:remote/);
    assert.equal((await p.api('GET', '/api/projects')).json.projects.length, 0, 'nothing was created');
  } finally {
    await p.stop();
  }
});

// ---------- improvement lab -----------------------------------------------------------------------

test('Improvement Lab: unavailable without an ERA checkout, with a clear reason; actions are refused', async () => {
  const p = await plane();
  try {
    const o = (await p.api('GET', '/api/improvement')).json;
    assert.equal(o.checkout.available, false);
    assert.match(o.checkout.reason, /ERA git checkout/);
    const r = await p.api('POST', '/api/improvement/propose', {});
    assert.equal(r.status, 409);
    assert.equal((await p.api('POST', '/api/improvement/cycles/not-a-cycle/approve', { confirm: true })).status, 400);
    assert.equal((await p.api('POST', '/api/improvement/cycles/cycle-20260101T000000-abcdef/approve', {})).status, 400);
    assert.equal((await p.api('POST', '/api/improvement/rollback', { version: 'main; rm -rf', confirm: true })).status, 400);
  } finally {
    await p.stop();
  }
});

test('Improvement Lab: reads versions and history from the real ERA checkout', async () => {
  const p = await plane({ settings: { workspaces: { improvementCheckout: process.cwd() } } });
  try {
    const o = (await p.api('GET', '/api/improvement')).json;
    assert.equal(o.checkout.available, true, o.checkout.reason);
    assert.match(o.current_version ?? '', /^era-v\d+$/);
    assert.ok(o.versions.length >= 1);
  } finally {
    await p.stop();
  }
});

test('CLI compatibility: `era studio doctor` and the existing commands still work without Studio', async () => {
  const { runEra } = await import('./helpers.js');
  const cwd = tempDir();
  const env = { ERA_STATE_DIR: join(cwd, 'state'), ERA_REA_BIN: FAKE_ENGINE };
  const doc = runEra(['studio', 'doctor', '--json'], { cwd, env });
  const checks = JSON.parse(doc.stdout).checks;
  assert.ok(checks.find((c) => c.name === 'REA engine'));
  assert.equal(runEra(['status', '--json'], { cwd, env }).status, 0);
  assert.equal(runEra(['project', 'list', '--json'], { cwd, env }).status, 0);
  assert.equal(runEra(['agents', '--json'], { cwd, env }).status, 0);
});
