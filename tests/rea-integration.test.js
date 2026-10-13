// Compatibility and integration tests against the real REA engine.
// Skipped when REA is unavailable or ERA_SKIP_REA is set.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { DATASETS, REA_BIN, ROOT, reaAvailable, runEra, tempDir } from './helpers.js';
import { evaluateSelf } from '../src/evaluation/self-eval.js';

const skip = !reaAvailable() && 'REA engine not available';
const rea = REA_BIN;

test('era rea passthrough reports the same engine version as rea', { skip }, () => {
  const direct = spawnSync(rea, ['--version'], { encoding: 'utf8' }).stdout.trim();
  assert.equal(runEra(['rea', '--version']).stdout.trim(), direct);
});

test('era rea passthrough produces the same Evidence as calling REA directly', { skip }, () => {
  const target = join(DATASETS, 'native-hello', 'hello');
  const direct = JSON.parse(spawnSync(rea, ['inspect-macho', target, '--format', 'json'], { encoding: 'utf8' }).stdout);
  const via = JSON.parse(runEra(['rea', 'inspect-macho', target, '--format', 'json']).stdout);
  assert.equal(via.evidence_id, direct.evidence_id);
  assert.equal(via.subject.digest.sha256, direct.subject.digest.sha256);
});

test('era analyze reverse engineers a JavaScript application through REA', { skip }, () => {
  const r = runEra(['analyze', join(DATASETS, 'js-app'), '--json'], { env: { ERA_STATE_DIR: tempDir() } });
  assert.equal(r.status, 0, r.stderr);
  const a = JSON.parse(r.stdout);
  assert.equal(a.runs[0].command[1], 'analyze-javascript-application');
  assert.equal(a.runs[0].status, 'succeeded');
  assert.match(a.runs[0].evidence_id, /^ev_[0-9a-f]{64}$/);
  assert.ok(a.facts.includes('import:src/main.js->src/net.js'));
});

test('era analyze inspects a Mach-O through REA', { skip }, () => {
  const r = runEra(['analyze', join(DATASETS, 'native-hello', 'hello'), '--json'], { env: { ERA_STATE_DIR: tempDir() } });
  assert.equal(r.status, 0, r.stderr);
  const a = JSON.parse(r.stdout);
  assert.equal(a.runs[0].operation, 'inspect_macho');
  assert.ok(a.facts.includes('export:_greet'));
});

test('REA self-analysis of this checkout covers every source module', { skip }, async () => {
  const self = await evaluateSelf({ codeRoot: ROOT, stateDir: tempDir(), reaCommand: REA_BIN });
  assert.deepEqual(self.missing_modules, []);
  assert.ok(self.runs.filter((r) => r.operation === 'analyze_javascript_application').length >= 1);
  assert.equal(self.runs.filter((r) => r.operation === 'capture_process_scenario').length, 1);
  assert.ok(self.runs.every((r) => r.status === 'succeeded'), JSON.stringify(self.runs.map((r) => r.errors)));
  assert.ok(self.metrics.startup_ms > 0);
});

test('era analyze stages a single JavaScript file for REA', { skip }, () => {
  const r = runEra(['analyze', join(DATASETS, 'esm-app', 'lib', 'format.mjs'), '--json'], { env: { ERA_STATE_DIR: tempDir() } });
  assert.equal(r.status, 0, r.stderr);
  const a = JSON.parse(r.stdout);
  assert.ok(a.target.staged_as);
  assert.ok(a.facts.includes('export:format.mjs#formatReport'), a.facts.join());
});
