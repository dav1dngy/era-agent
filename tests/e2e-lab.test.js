// End-to-end Improvement Lab tests on a temporary copy of this repository.
// They use the FAKE engine (tests/fixtures/fake-rea-engine.mjs), not REA: they
// verify ERA's orchestration (worktrees, tests, benchmarks, decisions, approval,
// rollback, interruption, recovery), not reverse-engineering results.
// Skipped inside nested evaluations (ERA_E2E_NESTED) and with ERA_SKIP_E2E.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { FIXTURES, ROOT, tempDir } from './helpers.js';
import { sandboxAvailable } from '../src/safety/sandbox.js';

// Without a sandbox (Linux CI), evaluating requires declaring the candidate trusted.
const SANDBOX = sandboxAvailable();
const TRUST = SANDBOX ? [] : ['--trust-candidate'];

const skip = (process.env.ERA_E2E_NESTED || process.env.ERA_SKIP_E2E) && 'nested evaluation or ERA_SKIP_E2E';
const ENGINE = join(FIXTURES, 'fake-rea-engine.mjs');
const findingId = (rule, subject) => `F-${createHash('sha256').update(`${rule}|${subject}`).digest('hex').slice(0, 10)}`;

function makeLab() {
  const dir = tempDir('era-e2e-');
  const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  for (const f of files) {
    if (!existsSync(join(ROOT, f)) || f.startsWith('experiments/')) continue;
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    cpSync(join(ROOT, f), join(dir, f));
  }
  // Test-environment configuration of the copied baseline (fake engine timings are noisy).
  writeFileSync(join(dir, 'era.config.json'), JSON.stringify({ limits: { maxCycles: 10, maxReaRunsPerCycle: 50 }, benchmark: { repetitions: 1 }, improvement: { budget: { allowUnmeteredAgents: true } } }));
  const acceptance = JSON.parse(readFileSync(join(dir, 'benchmarks', 'acceptance.json'), 'utf8'));
  writeFileSync(join(dir, 'benchmarks', 'acceptance.json'), JSON.stringify({ ...acceptance, maxTimeRegressionPct: 1000, maxMemoryRegressionPct: 1000 }));
  // Trusting candidate code does not authorize unsandboxed runtime capture.
  // Keep these fake-engine orchestration tests portable without relaxing the
  // production runtime policy; macOS still exercises every benchmark case.
  if (!SANDBOX) {
    const manifestPath = join(dir, 'benchmarks', 'datasets', 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, cases: manifest.cases.filter((c) => !c.runtime) }));
  }
  // An untested, unreachable module gives the planner a deterministic finding.
  writeFileSync(join(dir, 'src', 'e2e-untested.js'), 'export function answer() {\n  return 42;\n}\n');
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'ERA E2E');
  git('config', 'user.email', 'e2e@localhost');
  git('add', '-A');
  git('commit', '-q', '-m', 'lab baseline');
  git('tag', '-a', 'era-v1', '-m', 'era-v1: e2e baseline');
  const env = { ...process.env, ERA_REA_BIN: ENGINE, ERA_E2E_NESTED: '1', ERA_SKIP_REA: '1', ERA_STATE_DIR: '', ERA_CORRELATION_ID: '', CI: '', GITHUB_ACTIONS: '' };
  const era = (args, extraEnv = {}) => {
    try {
      return { status: 0, stdout: execFileSync(process.execPath, [join(dir, 'bin', 'era.mjs'), ...args], { cwd: dir, encoding: 'utf8', env: { ...env, ...extraEnv }, timeout: 600_000 }) };
    } catch (err) {
      return { status: err.status, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') };
    }
  };
  const ledger = () => readFileSync(join(dir, '.era', 'ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const cycle = (id) => JSON.parse(readFileSync(join(dir, '.era', 'cycles', id, 'cycle.json'), 'utf8'));
  const proposedId = (out) => /Proposed (cycle-\S+):/.exec(out)[1];
  return { dir, git, era, env, ledger, cycle, proposedId };
}

test('accepted experiment waits for approval, integrates on approval, and can be rolled back', { skip, timeout: 900_000 }, () => {
  const lab = makeLab();
  const base = lab.git('rev-parse', 'HEAD');
  const target = findingId('untested-module', 'src/e2e-untested.js');
  const p = lab.era(['improve', 'propose', '--finding', target]);
  assert.equal(p.status, 0, p.stderr);
  const id = lab.proposedId(p.stdout);
  const wt = lab.cycle(id).worktree;
  // The specifier is assembled at runtime so the fake engine's regex scan of
  // this file does not mistake it for an import.
  const spec = ['..', 'src', 'e2e-untested.js'].join('/');
  writeFileSync(join(wt, 'tests', 'e2e-added.test.js'), `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { answer } from '${spec}';\n\ntest('answer', () => assert.equal(answer(), 42));\n`);
  const e = lab.era(['improve', 'evaluate', id, ...TRUST]);
  assert.equal(e.status, 0, e.stderr);
  const decided = lab.cycle(id);
  // On failure say WHY: the failed guards and the candidate's failing tests (a bare "rejected" hides a load-related cause).
  const why = () => JSON.stringify({ summary: decided.evaluation?.summary, guards: (decided.evaluation?.guards ?? []).filter((g) => !g.ok), candidate_tests: (({ ok, exit_code, timed_out, passed, failed, failures, wall_ms }) => ({ ok, exit_code, timed_out, passed, failed, failures, wall_ms }))(decided.evaluation?.candidateTests ?? {}), evaluate_output: String(e.stdout ?? '').slice(-400) });
  assert.equal(decided.status, 'awaiting-approval', why());
  assert.equal(lab.git('rev-parse', 'HEAD'), base, 'stable branch untouched before approval');
  assert.ok(existsSync(join(lab.dir, '.era', 'cycles', id, 'change.patch')));
  assert.match(lab.era(['improve', 'show', id]).stdout, /awaiting-approval/);

  const refused = lab.era(['improve', 'approve', id]);
  assert.notEqual(refused.status, 0, 'non-interactive approval needs --yes');
  assert.equal(lab.git('rev-parse', 'HEAD'), base);

  // main moves on: the old evidence no longer describes the merge result.
  writeFileSync(join(lab.dir, 'NOTES.md'), 'maintainer change\n');
  lab.git('add', 'NOTES.md');
  lab.git('commit', '-q', '-m', 'maintainer change');
  const stale = lab.era(['improve', 'approve', id, '--yes']);
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /era improve rebase/);
  assert.equal(lab.era(['improve', 'rebase', id]).status, 0);
  assert.equal(lab.cycle(id).status, 'proposed');
  assert.equal(lab.era(['improve', 'evaluate', id, ...TRUST]).status, 0);
  const reeval = lab.cycle(id);
  assert.equal(reeval.status, 'awaiting-approval', JSON.stringify({ summary: reeval.evaluation?.summary, failed_guards: (reeval.evaluation?.guards ?? []).filter((g) => !g.ok), candidate_failures: reeval.evaluation?.candidateTests?.failures }));

  const a = lab.era(['improve', 'approve', id, '--yes', '--by', 'Maintainer <m@example.test>']);
  assert.equal(a.status, 0, a.stderr);
  assert.equal(lab.git('describe', '--tags', '--abbrev=0'), 'era-v2');
  assert.ok(existsSync(join(lab.dir, 'tests', 'e2e-added.test.js')));
  assert.ok(existsSync(join(lab.dir, 'NOTES.md')));
  assert.match(lab.git('log', '-1', '--format=%B'), /Approved-by: Maintainer <m@example.test>/);
  assert.ok(lab.ledger().some((ev) => ev.type === 'cycle-approved' && ev.cycle_id === id && ev.approver === 'Maintainer <m@example.test>'));

  const r = lab.era(['rollback', 'era-v1']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(lab.git('diff', '--stat', 'era-v1', 'HEAD'), '');
  assert.equal(existsSync(join(lab.dir, 'tests', 'e2e-added.test.js')), false);
});

test('a failed experiment is rejected and leaves the stable branch unchanged', { skip, timeout: 900_000 }, () => {
  const lab = makeLab();
  const base = lab.git('rev-parse', 'HEAD');
  const p = lab.era(['improve', 'propose', '--finding', findingId('untested-module', 'src/e2e-untested.js')]);
  const id = lab.proposedId(p.stdout);
  // A "command" coding agent that edits a protected evaluator path.
  const impl = lab.era(['improve', 'implement', id, '--agent', 'command', '--implementer', 'echo "// loosen" >> src/safety/policy.js']);
  assert.equal(impl.status, 0, impl.stderr);
  const e = lab.era(['improve', 'evaluate', id, ...TRUST]);
  assert.equal(e.status, 0, e.stderr);
  const c = lab.cycle(id);
  assert.equal(c.status, 'rejected');
  assert.ok(c.evaluation.guards.some((g) => g.name === 'protected paths unchanged' && !g.ok));
  assert.equal(lab.git('rev-parse', 'HEAD'), base);
  assert.ok(lab.git('branch', '--list', `experiment/${id}`), 'branch kept for diagnostics');
  assert.notEqual(lab.era(['improve', 'approve', id, '--yes']).status, 0, 'rejected cycles cannot be approved');
  assert.ok(lab.ledger().some((ev) => ev.type === 'implementer-finished' && ev.agent === 'command'));
});

test('interrupting an evaluation records no decision and recovery restores state after a crash', { skip, timeout: 900_000 }, async () => {
  const lab = makeLab();
  const p = lab.era(['improve', 'propose', '--finding', findingId('untested-module', 'src/e2e-untested.js')]);
  const id = lab.proposedId(p.stdout);
  writeFileSync(join(lab.cycle(id).worktree, 'note.txt'), 'change\n');

  const run = (signal) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [join(lab.dir, 'bin', 'era.mjs'), 'improve', 'evaluate', id, ...TRUST], { cwd: lab.dir, env: { ...lab.env, FAKE_REA_SLEEP_MS: '4000' } });
      let stderr = '';
      child.stderr.on('data', (d) => (stderr += d));
      const timer = setTimeout(() => child.kill(signal), 6000);
      child.on('exit', (code, sig) => {
        clearTimeout(timer);
        resolve({ code, sig, stderr });
      });
    });

  const interrupted = await run('SIGINT');
  assert.equal(interrupted.code, 130, interrupted.stderr);
  assert.equal(lab.cycle(id).status, 'proposed', 'no decision recorded');
  assert.ok(lab.ledger().some((ev) => ev.type === 'cycle-interrupted' && ev.cycle_id === id));
  assert.equal(existsSync(join(lab.dir, '.era', 'improve.lock')), false, 'lock released');

  const crashed = await run('SIGKILL');
  assert.equal(crashed.sig, 'SIGKILL');
  assert.equal(lab.cycle(id).status, 'evaluating');
  assert.ok(existsSync(join(lab.dir, '.era', 'improve.lock')), 'a crash leaves a stale lock');
  const rec = lab.era(['improve', 'recover']);
  assert.equal(rec.status, 0, rec.stderr);
  assert.match(rec.stdout, /removed stale improvement lock/);
  assert.match(rec.stdout, /evaluating -> proposed/);
  assert.equal(lab.cycle(id).status, 'proposed');
  assert.equal(lab.era(['improve', 'cancel', id]).status, 0);
  assert.equal(lab.cycle(id).status, 'abandoned');
});
