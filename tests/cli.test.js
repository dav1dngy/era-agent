import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from '../src/cli.js';
import { runEra, tempDir, FAKE_REA } from './helpers.js';

test('parseArgs separates positionals, flags, valued flags and repeated --arg', () => {
  assert.deepEqual(parseArgs(['x', '--json', '--cycles', '2', '--arg', 'a', '--arg', 'b']), { positional: ['x'], flags: { arg: ['a', 'b'], json: true, cycles: '2' } });
});

test('help and version', () => {
  const help = runEra(['--help']);
  assert.equal(help.status, 0);
  for (const cmd of ['analyze', 'inspect', 'self-analyze', 'improve', 'benchmark', 'status', 'history', 'rollback', 'rea']) assert.match(help.stdout, new RegExp(`\\b${cmd}\\b`));
  assert.match(runEra(['--version']).stdout, /^\d+\.\d+\.\d+/);
});

test('unknown commands exit 2 with a useful message', () => {
  const r = runEra(['frobnicate']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown command "frobnicate"/);
});

test('analyze rejects missing and unsupported targets', () => {
  const dir = tempDir();
  writeFileSync(join(dir, 'blob.bin'), 'nothing to see');
  const missing = runEra(['analyze', join(dir, 'nope')], { cwd: dir, env: { ERA_REA_BIN: FAKE_REA } });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /safety: Target does not exist/);
  const unsupported = runEra(['analyze', join(dir, 'blob.bin')], { cwd: dir, env: { ERA_REA_BIN: FAKE_REA } });
  assert.equal(unsupported.status, 3);
  assert.match(unsupported.stderr, /Unsupported target kind "unknown"/);
});

test('self-improvement commands require an ERA git checkout', () => {
  const dir = tempDir();
  const r = runEra(['improve', 'propose'], { cwd: dir, env: { ERA_REA_BIN: FAKE_REA } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /root of an ERA git checkout/);
});

test('era rea passes arguments through to the REA CLI', () => {
  const r = runEra(['rea', '--version'], { env: { ERA_REA_BIN: FAKE_REA } });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '9.9.9-fake');
});

test('help documents the Improvement Lab approval workflow and providers', () => {
  const help = runEra(['--help']).stdout;
  for (const s of ['improve approve', 'improve decline', 'improve recover', 'improve implement', 'explain', 'agents', '--rea-baseline', '--unsandboxed', 'ERA_LOG_LEVEL']) assert.ok(help.includes(s), s);
});

test('explain refuses remote providers without authorization and reports unknown analyses', () => {
  const dir = tempDir();
  const missing = runEra(['explain', 'nope'], { cwd: dir, env: { ERA_REA_BIN: FAKE_REA } });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /No analysis found/);
  const analysis = join(dir, 'analysis.json');
  writeFileSync(analysis, JSON.stringify({ analysis_id: 'a', target: { path: '/x', kind: 'javascript-app' }, status: 'succeeded', runs: [], evidence: [], facts: [], fact_groups: {}, report_path: '/nonexistent' }));
  const remote = runEra(['explain', analysis, '--provider', 'claude-code'], { cwd: dir, env: { ERA_REA_BIN: FAKE_REA } });
  assert.equal(remote.status, 1);
  assert.match(remote.stderr, /safety: .*--allow-remote/);
  const local = runEra(['explain', analysis], { cwd: dir, env: { ERA_REA_BIN: FAKE_REA } });
  assert.equal(local.status, 0, local.stderr);
  assert.match(local.stdout, /Explanation \(local, deterministic\)/);
});

test('runtime capture without a sandbox needs --unsandboxed', { skip: process.platform === 'darwin' && 'macOS has a sandbox' }, () => {
  const r = runEra(['analyze', join(process.cwd(), 'benchmarks', 'datasets', 'native-hello', 'hello'), '--runtime'], { env: { ERA_REA_BIN: FAKE_REA } });
  assert.match(r.stderr, /no sandbox is available/);
});

test('explain never sends files referenced by an imported analysis to a provider (audit F04)', () => {
  const dir = tempDir();
  const secret = join(tempDir(), 'private.txt');
  writeFileSync(secret, 'PRIVATE-CANARY-7731 do not disclose');
  const crafted = join(dir, 'analysis.json');
  writeFileSync(crafted, JSON.stringify({ analysis_id: 'x', target: { path: '/x', kind: 'javascript-app' }, status: 'succeeded', runs: [{ output_file: secret }], evidence: [], facts: ['module:a.js'], report_path: secret }));
  writeFileSync(join(dir, 'era.config.json'), JSON.stringify({ reasoning: { command: { run: 'cat', remote: false } } }));
  const r = runEra(['explain', crafted, '--provider', 'command'], { cwd: dir, env: { ERA_REA_BIN: FAKE_REA } });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!r.stdout.includes('PRIVATE-CANARY-7731'), 'outside file content reached the provider');
  assert.match(r.stdout, /module:a\.js|a\.js/);
  const invalid = join(dir, 'bad.json');
  writeFileSync(invalid, JSON.stringify({ report_path: secret }));
  assert.match(runEra(['explain', invalid], { cwd: dir, env: { ERA_REA_BIN: FAKE_REA } }).stderr, /Not a valid ERA analysis record/);
});
