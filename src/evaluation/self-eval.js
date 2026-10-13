// Supervised REA self-analysis (protected path).
//
// The stable supervisor owns every REA execution and every piece of evidence.
// From the code under evaluation it accepts only a pass *plan* (which files are
// analyzed together), produced by that code's `era self-analyze --plan` under
// candidate isolation. The supervisor then:
//   1. stages the exact files of the evaluated commit from git objects,
//   2. checks that every bin/src/tests JavaScript file is a focus file of
//      exactly one pass (no omissions, no inventions; placeholders are fixed text),
//   3. checks the REA run budget before dispatch,
//   4. runs REA itself (records under the stable state directory),
//   5. captures the code's `era --help` under the candidate sandbox,
//   6. applies the stable rules. Missing or failed evidence is never "absence":
//      the result is marked invalid instead.
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runProcess } from '../core/process.js';
import { newId, writeJson } from '../core/util.js';
import { runRules, graphView } from '../self_analysis/rules.js';
import { planPasses, stagePass, PLACEHOLDER } from '../self_analysis/self-analyze.js';
import { wrapCandidate } from '../safety/candidate-sandbox.js';
import { SANDBOX_EXEC } from '../safety/sandbox.js';
import { candidateProfile, protectedStatePaths } from '../safety/candidate-sandbox.js';

const JS = /\.(m|c)?js$/;

async function git(cwd, args) {
  const r = await runProcess('git', args, { cwd, timeoutMs: 120_000 });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.trim()}`);
  return r.stdout;
}

export async function listSourceModules(codeRoot, commit = 'HEAD') {
  const out = await git(codeRoot, ['ls-tree', '-r', '--name-only', commit, '--', 'src', 'bin']);
  return out.split('\n').filter((f) => JS.test(f)).sort();
}

export function startupMs(capture) {
  const m = capture?.normalized_result?.manifest;
  const ms = m ? Date.parse(m.completed_at) - Date.parse(m.started_at) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

// Writes the committed bytes of `files` (and package.json) into `dest`.
async function stageCommit(codeRoot, commit, files, dest) {
  for (const f of [...files, 'package.json']) {
    const r = await runProcess('git', ['show', `${commit}:${f}`], { cwd: codeRoot, timeoutMs: 60_000 });
    if (r.exitCode !== 0) continue;
    mkdirSync(dirname(join(dest, f)), { recursive: true });
    writeFileSync(join(dest, f), r.stdout);
  }
}

export function validatePlan(plan, expected) {
  if (!plan || !Array.isArray(plan.passes) || plan.passes.length === 0) return 'plan has no passes';
  const seen = new Map();
  const known = new Set(expected);
  for (const [i, p] of plan.passes.entries()) {
    if (!Array.isArray(p.focus) || !Array.isArray(p.placeholders ?? [])) return `pass ${i + 1} is malformed`;
    for (const f of p.focus) {
      if (!known.has(f)) return `pass ${i + 1} names a file that is not in the evaluated commit: ${f}`;
      if (seen.has(f)) return `${f} is a focus file in passes ${seen.get(f)} and ${i + 1}`;
      seen.set(f, i + 1);
    }
    for (const ph of p.placeholders ?? []) {
      if (!known.has(ph)) return `pass ${i + 1} has a placeholder outside the commit: ${ph}`;
      if (p.focus.includes(ph)) return `pass ${i + 1} uses ${ph} as focus and placeholder`;
    }
  }
  const missing = expected.filter((f) => !seen.has(f));
  return missing.length ? `plan omits ${missing.length} file(s): ${missing.slice(0, 5).join(', ')}` : null;
}

export async function evaluateSelf({ codeRoot, commit = 'HEAD', stateDir, rea, isolation, budget = null, timeoutMs = 900_000 }) {
  const id = newId('self');
  // Private working directory outside the stable state (which candidate code may not read).
  const work = realpathSync(mkdtempSync(join(tmpdir(), 'era-supervised-')));
  const universe = join(work, 'universe');
  const tmp = join(work, 'tmp');
  mkdirSync(tmp, { recursive: true });
  const all = (await git(codeRoot, ['ls-tree', '-r', '--name-only', commit, '--', 'bin', 'src', 'tests'])).split('\n').filter((f) => JS.test(f)).sort();
  await stageCommit(codeRoot, commit, all, universe);
  const result = { self_analysis_id: id, commit, runs: [], findings: [], missing_modules: [], valid: true, invalid: null, plan_source: null, metrics: {} };
  const invalid = (kind, reason) => Object.assign(result, { valid: false, invalid: { kind, reason } });

  // 1. Plan from the code under evaluation (isolated), else the stable planner.
  const cmd = wrapCandidate(isolation, process.execPath, [join(codeRoot, 'bin', 'era.mjs'), 'self-analyze', '--plan', universe, '--json'], { writable: [], denyRead: protectedStatePaths(stateDir), tmp });
  const planRun = await runProcess(cmd.command, cmd.args, { cwd: tmp, env: cmd.env, timeoutMs: 120_000, watchdog: true });
  let plan;
  try {
    plan = planRun.exitCode === 0 ? JSON.parse(planRun.stdout) : null;
  } catch {
    plan = null;
  }
  if (plan) result.plan_source = 'evaluated-code';
  else {
    plan = { passes: planPasses(universe).map(({ focus, placeholders }) => ({ focus, placeholders })) };
    result.plan_source = 'stable-fallback';
  }
  const problem = validatePlan(plan, all);
  if (problem) return invalid('candidate', `self-analysis plan invalid: ${problem}`), result;

  // 2. Budget is reserved before any REA run is dispatched.
  if (budget) budget.reserve(plan.passes.length + 1);

  // 3. Supervisor-run REA passes over supervisor-staged files.
  const evidence = [];
  const focusCovered = new Set();
  for (const [i, p] of plan.passes.entries()) {
    const dir = stagePass(universe, join(work, `pass-${i + 1}`), { focus: p.focus, placeholders: p.placeholders ?? [] });
    for (const ph of p.placeholders ?? []) if (readFileSync(join(dir, ph), 'utf8') !== PLACEHOLDER) return invalid('infrastructure', 'placeholder staging failed'), result;
    const { record, result: ev } = await rea.run('analyze-javascript-application', [dir], { inputPath: dir, label: `supervised-self:pass-${i + 1}/${plan.passes.length}`, timeoutMs });
    result.runs.push(record);
    if (record.status !== 'succeeded' || !ev) return invalid('infrastructure', `REA pass ${i + 1} ${record.status}: ${record.errors.join('; ')}`), result;
    evidence.push(ev);
    const g = graphView(ev);
    const recovered = new Set(g.modules);
    for (const f of p.focus) if (recovered.has(f) && !g.incomplete.has(f)) focusCovered.add(f);
  }

  // 4. Runtime capture of the evaluated CLI, isolated, with a scrubbed environment.
  const runtimeDir = join(work, 'runtime');
  await stageCommit(codeRoot, commit, all, runtimeDir);
  const scratch = join(work, 'runtime-scratch');
  mkdirSync(scratch, { recursive: true });
  const helpArgs = [process.execPath, join(runtimeDir, 'bin', 'era.mjs'), '--help'];
  const sandboxed = isolation.mode === 'sandbox' ? [SANDBOX_EXEC, '-p', candidateProfile({ writable: [scratch], denyRead: protectedStatePaths(stateDir) }), ...helpArgs] : helpArgs;
  const scenario = join(work, 'help-scenario.json');
  writeJson(scenario, {
    executable: '/usr/bin/env',
    arguments: ['-i', `PATH=${dirname(process.execPath)}:/usr/bin:/bin`, `HOME=${scratch}`, `TMPDIR=${scratch}`, 'ERA_IN_CANDIDATE_SANDBOX=1', 'ERA_LOG=off', ...sandboxed],
    working_directory: scratch,
    filesystem_observation_paths: [runtimeDir],
    timeout_ms: 30_000,
    idle_timeout_ms: 30_000,
    finalization_ms: 500,
  });
  const cap = await rea.run('capture-process', [scenario], { inputPath: join(runtimeDir, 'bin', 'era.mjs'), label: 'supervised-self:runtime-help', timeoutMs });
  result.runs.push(cap.record);
  if (cap.record.status !== 'succeeded' || !cap.result) return invalid('infrastructure', `REA runtime capture ${cap.record.status}`), result;

  // 5. Stable rules over supervisor-owned Evidence.
  result.findings = runRules(evidence, cap.result);
  const expected = await listSourceModules(codeRoot, commit);
  result.missing_modules = expected.filter((m) => !focusCovered.has(m));
  result.metrics = { modules: focusCovered.size, expected_modules: expected.length, startup_ms: startupMs(cap.result), findings: result.findings.length, rea_runs: result.runs.length, passes: plan.passes.length, plan_source: result.plan_source };
  writeJson(join(stateDir, 'self-analyses', id, 'self-analysis.json'), { ...result, runs: result.runs.map((r) => ({ run_id: r.run_id, label: r.label, status: r.status, evidence_id: r.evidence_id })) });
  rmSync(work, { recursive: true, force: true });
  if (!existsSync(join(stateDir, 'self-analyses', id, 'report.md'))) writeFileSync(join(stateDir, 'self-analyses', id, 'report.md'), `# Supervised self-analysis ${id}\n\nCommit ${commit}; ${result.findings.length} findings; plan from ${result.plan_source}.\n`);
  result.report = join(stateDir, 'self-analyses', id, 'report.md');
  return result;
}
