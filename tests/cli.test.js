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
