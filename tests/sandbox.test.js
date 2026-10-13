// Runtime sandbox tests. The first test exercises sandbox-exec directly; the
// second runs a real REA process capture through `era analyze --runtime`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { sandboxAvailable, sandboxCommand, sandboxProfile } from '../src/safety/sandbox.js';
import { FIXTURES, reaAvailable, runEra, tempDir } from './helpers.js';

const noSandbox = !sandboxAvailable() && 'macOS sandbox-exec not available';
const noClang = spawnSync('clang', ['--version']).status !== 0 && 'clang not available';

function buildProbe() {
  const out = join(tempDir(), 'probe');
  const r = spawnSync('clang', ['-o', out, join(FIXTURES, 'sandbox-probe', 'probe.c')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return out;
}

test('profile denies network and writes outside the scratch directories', () => {
  const scratch = tempDir();
  const p = sandboxProfile({ writableDirs: [scratch] });
  assert.match(p, /\(deny network\*\)/);
  assert.match(p, /\(deny file-write\*\)/);
  // Platform-neutral: the canonical (symlink-resolved) scratch path is allowed.
  assert.ok(p.includes(`(allow file-write* (subpath "${realpathSync(scratch)}")`), p);
});

test('sandboxed probe can write only to scratch and has no network', { skip: noSandbox || noClang }, () => {
  const probe = buildProbe();
  const scratch = tempDir();
  const outside = join(tempDir(), 'outside.txt');
  const cmd = sandboxCommand(probe, [outside], { writableDirs: [scratch] });
  const r = spawnSync(cmd.executable, cmd.arguments, { cwd: scratch, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /scratch-write: allowed/);
  assert.match(r.stdout, /outside-write: denied/);
  assert.match(r.stdout, /network: denied/);
  assert.equal(existsSync(outside), false);
  const unsandboxed = spawnSync(probe, [outside], { cwd: scratch, encoding: 'utf8' });
  assert.match(unsandboxed.stdout, /outside-write: allowed/, 'the probe really attempts the write');
});

test('era analyze --runtime captures a sandboxed target through REA', { skip: noSandbox || noClang || (!reaAvailable() && 'REA engine not available') }, () => {
  const probe = buildProbe();
  const outside = join(tempDir(), 'outside.txt');
  const state = tempDir();
  const r = runEra(['analyze', probe, '--runtime', '--arg', outside, '--no-decompile', '--json'], { env: { ERA_STATE_DIR: state } });
  assert.equal(r.status, 0, r.stderr);
  const a = JSON.parse(r.stdout);
  assert.equal(a.runtime_sandbox.mechanism, 'macos-sandbox-exec');
  assert.ok(a.facts.includes('exit:0'));
  const capture = a.runs.find((x) => x.operation === 'capture_process_scenario');
  assert.equal(capture.status, 'succeeded');
  const evidence = readFileSync(capture.output_file, 'utf8');
  assert.match(evidence, /outside-write: denied/);
  assert.match(evidence, /network: denied/);
  assert.equal(existsSync(outside), false);
});
