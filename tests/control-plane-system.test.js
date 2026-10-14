// Studio backend: the system service (overview/tools) and the REA status probe it depends on.
// REAL   systemService and ReaClient, spawning a real child process per probe.
// FAKE   the REA executable: a tiny script that answers --version and `providers` and logs every call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ReaClient } from '../src/rea_integration/rea-client.js';
import { systemService } from '../src/control_plane/services/system.js';
import { tempDir } from './helpers.js';

function fakeRea({ failProviders = false } = {}) {
  const dir = tempDir('era-sys-');
  const log = join(dir, 'calls.log');
  const bin = join(dir, 'rea');
  const providers = JSON.stringify({ analysis_provider_candidates: [{ provider: { id: 'p', name: 'P' }, availability: { status: 'available' } }] });
  writeFileSync(bin, `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
const a = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, a[0] + '\\n');
if (a[0] === '--version') console.log('9.9.9');
else if (a[0] === 'providers') { await new Promise((r) => setTimeout(r, 150)); if (${failProviders}) { console.error('boom'); process.exit(3); } console.log(${JSON.stringify(providers)}); }
`);
  chmodSync(bin, 0o755);
  const calls = (name) => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter((l) => l === name).length : 0);
  return { dir, bin, calls };
}

function ctxFor(rea, dir) {
  return {
    rea,
    version: '0.0.0-test',
    host: '127.0.0.1',
    port: 1234,
    config: { stateDirAbs: dir },
    lab: { list: () => [{ status: 'awaiting-approval' }, { status: 'done' }] },
    jobs: { list: () => [{ status: 'running' }, { status: 'succeeded' }] },
    settings: () => ({ mode: 'simple', permissions: { trustedExecution: false }, advanced: { diagnostics: true } }),
    audit: { tail: () => [] },
  };
}

test('overview reports REA, projects and jobs from backend state', async () => {
  const f = fakeRea();
  const rea = new ReaClient({ command: f.bin, stateDir: f.dir, measureResources: false });
  const o = await systemService(ctxFor(rea, f.dir)).overview();
  assert.equal(o.app.name, 'ERA Studio');
  assert.equal(o.rea.available, true);
  assert.equal(o.rea.version, '9.9.9');
  assert.equal(o.rea.decompiler_available, true);
  assert.deepEqual(o.counts, { projects: 2, awaiting_approval: 1, running_jobs: 1 });
  assert.deepEqual(o.listener, { host: '127.0.0.1', port: 1234, loopback_only: true });
});

test('concurrent and repeated overview/tools calls share one REA providers probe', async () => {
  const f = fakeRea();
  const rea = new ReaClient({ command: f.bin, stateDir: f.dir, measureResources: false });
  const sys = systemService(ctxFor(rea, f.dir));
  await Promise.all([...Array.from({ length: 8 }, () => sys.overview()), ...Array.from({ length: 4 }, () => sys.tools())]);
  assert.equal(f.calls('providers'), 1, 'twelve concurrent calls, one probe');
  await sys.overview();
  await sys.tools();
  assert.equal(f.calls('providers'), 1, 'within the TTL nothing is spawned again');
  assert.equal(f.calls('--version'), 1, 'the version is cached for the life of the client');
});

test('status is probed again after the TTL, on demand with fresh, and a failed probe is not cached', async () => {
  const f = fakeRea();
  const rea = new ReaClient({ command: f.bin, stateDir: f.dir, measureResources: false, statusTtlMs: 40 });
  await rea.status();
  await rea.status();
  assert.equal(f.calls('providers'), 1, 'a second call inside the TTL reuses the first probe');
  await new Promise((r) => setTimeout(r, 80));
  await rea.status();
  assert.equal(f.calls('providers'), 2, 'expired entry is refreshed');
  await rea.status({ fresh: true });
  assert.equal(f.calls('providers'), 3, 'fresh bypasses the cache');

  const bad = fakeRea({ failProviders: true });
  const broken = new ReaClient({ command: bad.bin, stateDir: bad.dir, measureResources: false });
  const first = await broken.status();
  assert.notEqual(first.probe_status, 'succeeded');
  await broken.status();
  assert.equal(bad.calls('providers'), 2, 'a failed probe is retried, not remembered');
});

test('tools lists the MCP entry and the permission settings', async () => {
  const f = fakeRea();
  const rea = new ReaClient({ command: f.bin, stateDir: f.dir, measureResources: false });
  const t = await systemService(ctxFor(rea, f.dir)).tools();
  assert.equal(t.mcp.launch, 'era rea mcp');
  assert.equal(t.rea.available, true);
  assert.deepEqual(t.permissions, { trustedExecution: false });
});
