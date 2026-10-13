import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ReaClient, resolveReaCommand } from '../src/rea_integration/rea-client.js';
import { FAKE_REA, tempDir } from './helpers.js';

const client = (mode, extra = {}) => new ReaClient({ command: FAKE_REA, stateDir: tempDir(), measureResources: false, env: { ...process.env, FAKE_REA_MODE: mode }, ...extra });

test('resolveReaCommand prefers config, then ERA_REA_BIN', () => {
  assert.deepEqual(resolveReaCommand('/x/rea', {}), { command: '/x/rea', source: 'config' });
  assert.deepEqual(resolveReaCommand(null, { ERA_REA_BIN: '/y/rea' }), { command: '/y/rea', source: 'env:ERA_REA_BIN' });
});

test('successful run is recorded with command, engine version, input and progress', async () => {
  const rea = client('ok');
  const { record, result } = await rea.run('inspect-macho', [FAKE_REA], { inputPath: FAKE_REA, label: 't' });
  assert.equal(record.status, 'succeeded');
  assert.equal(record.engine.version, '9.9.9-fake');
  assert.deepEqual(record.command.slice(1), ['inspect-macho', FAKE_REA, '--format', 'json']);
  assert.equal(record.evidence_id, 'ev_fake');
  assert.equal(record.input.kind, 'file');
  assert.equal(record.input.sha256.length, 64);
  assert.equal(record.progress_events, 1);
  assert.deepEqual(record.warnings, []);
  assert.deepEqual(result.args.slice(0, 1), ['inspect-macho']);
  const dir = join(rea.stateDir, 'runs', record.run_id);
  assert.ok(existsSync(join(dir, 'record.json')));
  assert.equal(JSON.parse(readFileSync(join(dir, 'output.json'), 'utf8')).evidence_id, 'ev_fake');
  assert.equal(rea.runCount, 1);
});

test('REA error envelopes become failed runs with the error code', async () => {
  const { record } = await client('error').run('function', ['x', 'main']);
  assert.equal(record.status, 'failed');
  assert.equal(record.exit_code, 1);
  assert.match(record.errors[0], /provider_unavailable/);
});

test('non-JSON output fails clearly', async () => {
  const { record, result } = await client('garbage').run('inspect-macho', []);
  assert.equal(record.status, 'failed');
  assert.equal(result, null);
  assert.match(record.errors.join(), /not valid JSON/);
});

test('timeouts are enforced and recorded', async () => {
  const { record } = await client('hang', { timeoutMs: 300 }).run('inspect-macho', []);
  assert.equal(record.status, 'timeout');
  assert.match(record.errors.join(), /timeout/);
});

test('non-progress stderr lines are kept as warnings', async () => {
  const { record } = await client('warn').run('inspect-macho', []);
  assert.equal(record.status, 'succeeded');
  assert.deepEqual(record.warnings, ['deprecation: something']);
});

test('missing REA binary is reported, not thrown', async () => {
  const rea = new ReaClient({ command: '/nonexistent/rea', stateDir: tempDir(), measureResources: false });
  assert.equal(await rea.version(), null);
  const status = await rea.status();
  assert.equal(status.available, false);
  const { record } = await rea.run('inspect-macho', []);
  assert.equal(record.status, 'failed');
  assert.match(record.errors[0], /failed to start REA/);
});
