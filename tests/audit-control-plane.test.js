// Control-plane regression tests for the findings of the independent audit (docs/ERA_V020_INDEPENDENT_AUDIT.md).
//
// REAL   the HTTP control plane (loopback, token), git, the macOS sandbox where available, real child processes.
// FAKE   the REA engine (tests/fixtures/fake-rea-engine.mjs). No coding agent is involved.
import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../src/core/config.js';
import { ReaClient } from '../src/rea_integration/rea-client.js';
import { createControlPlane } from '../src/control_plane/server.js';
import { hasExecutableGitConfig } from '../src/control_plane/services/workbench.js';
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
const SANDBOX = sandboxAvailable();
const sandboxOnly = SANDBOX ? false : 'needs the macOS sandbox';

async function plane() {
  const cwd = tempDir();
  writeFileSync(join(cwd, 'era.config.json'), JSON.stringify({}));
  const config = loadConfig(cwd, { ERA_STATE_DIR: join(cwd, 'state'), ERA_REA_BIN: FAKE_ENGINE });
  const rea = new ReaClient({ command: FAKE_ENGINE, stateDir: config.stateDirAbs, measureResources: false });
  const cp = await createControlPlane({ config, rea, version: 'test', env: { ...process.env, ERA_REA_BIN: FAKE_ENGINE } });
  await cp.start();
  const api = async (method, path, body) => {
    const res = await fetch(`${cp.url}${path}`, { method, headers: { Authorization: `Bearer ${cp.token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // not JSON
    }
    return { status: res.status, json, text };
  };
  return { cp, api, cwd, config, stop: () => cp.stop() };
}

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid', GIT_CONFIG_GLOBAL: '/dev/null' };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' });

function repo(files = { 'data.txt': 'one\n', 'other.txt': 'two\n' }) {
  const dir = join(tempDir(), 'repo');
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'initial');
  return dir;
}

// ---------------------------------------------------------------------------------------------------------------------
// H04: `git status` in the Studio Git panel ran repository-configured commands (clean filters) with the user's privileges.
// Audit reproduction: the filter appended to a file outside the project three times for one HTTP request.

async function projectWith(p, dir, id = 'untrusted') {
  const r = await p.api('POST', '/api/projects', { id, mode: 'review', source: dir, task: 'inspect', trust_project: !SANDBOX });
  assert.equal(r.status, 200, r.text);
}

test('H04: a clean filter in the repository does not run when the Git panel reads status', { skip: sandboxOnly }, async () => {
  const dir = repo();
  git(dir, 'update-index', '--really-refresh');
  const marker = join(tempDir(), 'FILTER_RAN');
  writeFileSync(join(dir, '.gitattributes'), 'data.txt filter=audit\n');
  git(dir, 'config', 'filter.audit.clean', `sh -c 'echo ran >> "${marker}"; cat'`);
  git(dir, 'config', 'filter.audit.required', 'false');
  // Same size, different time: git can only tell whether the file changed by running the (clean) filter over its content.
  await new Promise((r) => setTimeout(r, 1100));
  writeFileSync(join(dir, 'data.txt'), 'two\n');
  const p = await plane();
  try {
    await projectWith(p, dir);
    const r = await p.api('GET', '/api/projects/untrusted/git?root=source');
    assert.equal(r.status, 200, r.text);
    assert.equal(existsSync(marker), false, 'the repository-controlled command must not have run');
    // git is still useful: the modified file is reported
    assert.ok(r.json.files.some((f) => f.path === 'data.txt'), JSON.stringify(r.json));
    assert.equal(r.json.branch.startsWith('main'), true);
  } finally {
    await p.stop();
  }
});

test('H04: a diff driver or textconv configured in the repository does not run either', { skip: sandboxOnly }, async () => {
  const dir = repo({ 'doc.bin': 'a\n' });
  const marker = join(tempDir(), 'TEXTCONV_RAN');
  writeFileSync(join(dir, '.gitattributes'), 'doc.bin diff=audit\n');
  git(dir, 'config', 'diff.audit.textconv', `sh -c 'echo ran >> "${marker}"; cat "$1"' --`);
  writeFileSync(join(dir, 'doc.bin'), 'b\n');
  const p = await plane();
  try {
    await projectWith(p, dir);
    const d = await p.api('GET', '/api/projects/untrusted/git/diff?root=source&path=doc.bin');
    assert.equal(d.status, 200, d.text);
    assert.equal(d.json.modified, 'b\n');
    assert.equal(existsSync(marker), false);
  } finally {
    await p.stop();
  }
});

test('H04: the Git panel still works normally for an ordinary repository', { skip: sandboxOnly }, async () => {
  const dir = repo();
  writeFileSync(join(dir, 'new.txt'), 'x\n');
  const p = await plane();
  try {
    await projectWith(p, dir, 'plain');
    const r = await p.api('GET', '/api/projects/plain/git?root=source');
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.repository, true);
    assert.deepEqual(r.json.files.map((f) => f.path), ['new.txt']);
    assert.equal(r.json.commits[0].subject, 'initial');
  } finally {
    await p.stop();
  }
});

test('H04: repositories that configure programs git would run are recognized (the basis of the no-sandbox refusal)', () => {
  const plain = repo();
  assert.equal(hasExecutableGitConfig(plain), false);
  for (const [key, value] of [['filter.x.clean', 'cat'], ['filter.x.process', 'cat'], ['diff.x.textconv', 'cat'], ['core.fsmonitor', 'true'], ['core.sshCommand', 'ssh'], ['core.pager', 'less'], ['include.path', '../evil']]) {
    const dir = repo();
    git(dir, 'config', key, value);
    assert.equal(hasExecutableGitConfig(dir), true, `${key} must be recognized`);
  }
  const attr = repo();
  writeFileSync(join(attr, '.git', 'info', 'attributes'), '*.txt filter=x\n');
  assert.equal(hasExecutableGitConfig(attr), true, 'attributes that select a filter are recognized');
  assert.equal(hasExecutableGitConfig(tempDir()), false, 'a directory without a repository has nothing to execute');
});

// ---------------------------------------------------------------------------------------------------------------------
// M01: an unauthenticated request with a malformed target (`GET http://[`) raised ERR_INVALID_URL outside the handler's
// try block and terminated the control plane (exit 1) with supervised jobs running.

import { createConnection } from 'node:net';

const rawRequest = (port, requestLine, extra = '') =>
  new Promise((resolve, reject) => {
    const sock = createConnection({ host: '127.0.0.1', port }, () => sock.write(`${requestLine}\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n${extra}\r\n`));
    let out = '';
    sock.on('data', (d) => (out += d));
    sock.on('close', () => resolve(out));
    sock.on('error', reject);
    setTimeout(() => {
      sock.destroy();
      resolve(out);
    }, 5000);
  });

test('M01: malformed request targets get 400 and the control plane keeps serving', async () => {
  const p = await plane();
  try {
    for (const target of ['http://[', 'http://', '//', 'http://%zz/', 'http://exa mple/']) {
      const out = await rawRequest(p.cp.port, `GET ${target} HTTP/1.1`);
      assert.match(out, /^HTTP\/1\.1 (400|404)\b/, `target ${JSON.stringify(target)} answered: ${out.split('\r\n')[0]}`);
    }
    const health = await fetch(`${p.cp.url}/healthz`);
    assert.equal(health.status, 200, 'the same process still answers');
    assert.equal((await p.api('GET', '/api/overview')).status, 200);
  } finally {
    await p.stop();
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// M02: terminals kept their access after the permission, the allowed roots or the run state that justified them changed.
// M03: the terminal of an isolated working copy could not read the working copy (the profile denied ERA's whole state
// directory, which contains it).

const until = async (fn, ms = 15_000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 100));
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readIf = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : null);

async function openTerminal(p, body) {
  const t = await p.api('POST', '/api/terminals', body);
  assert.equal(t.status, 200, t.text);
  return t.json;
}
const send = (p, id, data) => p.api('POST', `/api/terminals/${id}/input`, { data });

test('M02: revoking Terminal or Direct edit stops a running shell and its background commands', { skip: sandboxOnly }, async () => {
  const dir = repo();
  const p = await plane();
  try {
    assert.equal((await p.api('PUT', '/api/settings', { permissions: { terminal: true, directEdit: true } })).status, 200);
    await projectWith(p, dir);
    const t = await openTerminal(p, { project_id: 'untrusted', root: 'source' });
    assert.equal((await send(p, t.id, 'echo first > first.txt\n')).status, 200);
    await until(() => readIf(join(dir, 'first.txt')));
    assert.equal((await send(p, t.id, '(while true; do echo tick >> bg.txt; sleep 0.1; done) &\n')).status, 200);
    await until(() => readIf(join(dir, 'bg.txt')));

    assert.equal((await p.api('PUT', '/api/settings', { permissions: { terminal: false, directEdit: false } })).status, 200);
    const refused = await send(p, t.id, 'echo second > second.txt\n');
    assert.ok([403, 409].includes(refused.status), `input after revocation must be refused (got ${refused.status})`);
    await sleep(500);
    const size = readIf(join(dir, 'bg.txt')).length;
    await sleep(1000);
    assert.equal(readIf(join(dir, 'bg.txt')).length, size, 'the background command must have been stopped');
    assert.equal(existsSync(join(dir, 'second.txt')), false);
  } finally {
    await p.stop();
  }
});

test('M02: removing the project from the allowed roots revokes an open source terminal', { skip: sandboxOnly }, async () => {
  const dir = repo();
  const p = await plane();
  try {
    assert.equal((await p.api('PUT', '/api/settings', { permissions: { terminal: true, directEdit: true } })).status, 200);
    await projectWith(p, dir);
    const t = await openTerminal(p, { project_id: 'untrusted', root: 'source' });
    assert.equal((await send(p, t.id, 'echo ok > ok.txt\n')).status, 200);
    await until(() => readIf(join(dir, 'ok.txt')));
    assert.equal((await p.api('PUT', '/api/settings', { workspaces: { allowedRoots: [tempDir()] } })).status, 200);
    const refused = await send(p, t.id, 'echo late > late.txt\n');
    assert.ok([403, 409].includes(refused.status), `got ${refused.status}`);
    await sleep(300);
    assert.equal(existsSync(join(dir, 'late.txt')), false);
  } finally {
    await p.stop();
  }
});

async function awaitingWorkspace(p, dir) {
  const r = await p.api('POST', '/api/projects', { id: 'ws', mode: 'modify', source: dir, task: 'Change readme', agent: 'manual', trust_project: !SANDBOX });
  assert.equal(r.status, 200, r.text);
  const started = await p.api('POST', '/api/projects/ws/ops/modify', {});
  assert.equal(started.status, 200, started.text);
  await until(async () => {
    const j = (await p.api('GET', `/api/jobs/${started.json.job.id}`)).json;
    return ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(j.status);
  }, 60_000);
  const st = (await p.api('GET', '/api/projects/ws')).json;
  assert.equal(st.latest_run?.status, 'awaiting-implementation', JSON.stringify(st.latest_run));
}

test('M03: the terminal of an isolated working copy can read, build and write inside it', { skip: sandboxOnly }, async () => {
  const dir = repo({ 'readme.txt': 'WORKSPACE_FIXTURE\n', 'tool.sh': 'echo built-ok\n' });
  const p = await plane();
  try {
    assert.equal((await p.api('PUT', '/api/settings', { permissions: { terminal: true } })).status, 200);
    await awaitingWorkspace(p, dir);
    const t = await openTerminal(p, { project_id: 'ws', root: 'workspace' });
    assert.equal(t.sandboxed, true);
    await send(p, t.id, `cat readme.txt > read-out.txt 2> read-err.txt; sh tool.sh > build-out.txt 2>> read-err.txt; echo edited >> readme.txt; ls .. > sibling-list.txt 2> sibling-err.txt; cat ${join(p.config.stateDirAbs, 'ledger.jsonl')} > ledger-out.txt 2> ledger-err.txt\n`);
    const ws = t.cwd;
    await until(() => readIf(join(ws, 'build-out.txt')) !== null && existsSync(join(ws, 'ledger-err.txt')));
    await sleep(300);
    assert.equal(readIf(join(ws, 'read-out.txt')), 'WORKSPACE_FIXTURE\n', `read failed: ${readIf(join(ws, 'read-err.txt'))}`);
    assert.equal(readIf(join(ws, 'build-out.txt')), 'built-ok\n');
    assert.match(readIf(join(ws, 'readme.txt')), /edited/);
    // other project state and ERA's ledger stay unreadable
    assert.equal(readIf(join(ws, 'ledger-out.txt')) ?? '', '');
    assert.equal((readIf(join(ws, 'sibling-list.txt')) ?? '').includes('ws'), false, 'the directory of other working copies must not be listable');
  } finally {
    await p.stop();
  }
});

test('M02: a working-copy terminal is closed when its run stops being editable', { skip: sandboxOnly }, async () => {
  const dir = repo({ 'readme.txt': 'x\n' });
  const p = await plane();
  try {
    assert.equal((await p.api('PUT', '/api/settings', { permissions: { terminal: true } })).status, 200);
    await awaitingWorkspace(p, dir);
    const t = await openTerminal(p, { project_id: 'ws', root: 'workspace' });
    await send(p, t.id, '(while true; do echo tick >> bg.txt; sleep 0.1; done) &\n');
    await until(() => readIf(join(t.cwd, 'bg.txt')));
    assert.equal((await p.api('POST', '/api/projects/ws/cancel', {})).status, 200);
    await until(async () => (await send(p, t.id, 'true\n')).status !== 200, 10_000);
    const size = (readIf(join(t.cwd, 'bg.txt')) ?? '').length;
    await sleep(600);
    assert.equal((readIf(join(t.cwd, 'bg.txt')) ?? '').length, size, 'the background command must have stopped with the run state change');
  } finally {
    await p.stop();
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Found while preparing the release screenshots: the Improvement Lab page listed self-analyses as quoted ids with "Invalid Date" because the
// API returned bare ids (oldest first, limited to 20) while the page expects records.

test('the improvement overview lists self-analyses newest first with their date and counts', async () => {
  const p = await plane();
  try {
    for (const [id, created, findings, runs] of [['self-20261001T100000-aaaaaa', '2026-10-01T10:00:00.000Z', 3, 5], ['self-20261002T100000-bbbbbb', '2026-10-02T10:00:00.000Z', 1, 7]]) {
      const dir = join(p.config.stateDirAbs, 'self-analyses', id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'self-analysis.json'), JSON.stringify({ self_analysis_id: id, created_at: created, findings: Array.from({ length: findings }, (_, i) => ({ id: `F-${i}` })), runs: Array.from({ length: runs }, () => ({})) }));
    }
    mkdirSync(join(p.config.stateDirAbs, 'self-analyses', 'self-20261003T100000-cccccc'), { recursive: true }); // unreadable record: still listed, without invented numbers
    const o = (await p.api('GET', '/api/improvement')).json;
    assert.deepEqual(o.self_analyses.map((a) => a.id), ['self-20261003T100000-cccccc', 'self-20261002T100000-bbbbbb', 'self-20261001T100000-aaaaaa']);
    assert.deepEqual(o.self_analyses[1], { id: 'self-20261002T100000-bbbbbb', created_at: '2026-10-02T10:00:00.000Z', findings: 1, rea_runs: 7 });
    assert.deepEqual(o.self_analyses[0], { id: 'self-20261003T100000-cccccc', created_at: null, findings: null, rea_runs: null });
  } finally {
    await p.stop();
  }
});
