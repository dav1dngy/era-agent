// Self-analysis evaluation (protected path). Runs a checkout's own
// `era self-analyze --json` (its artifact preparation and REA invocations),
// then re-derives findings from the produced REA Evidence with the stable
// rules and verifies that REA covered every source module of that checkout.
import { existsSync, readFileSync } from 'node:fs';
import { runProcess } from '../core/process.js';
import { runRules, graphView } from '../self_analysis/rules.js';

export async function listSourceModules(codeRoot) {
  const r = await runProcess('git', ['ls-files', 'src', 'bin'], { cwd: codeRoot, timeoutMs: 60_000 });
  return r.stdout.split('\n').filter((f) => /\.(m|c)?js$/.test(f)).sort();
}

export function startupMs(capture) {
  const m = capture?.normalized_result?.manifest;
  const ms = m ? Date.parse(m.completed_at) - Date.parse(m.started_at) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

export async function evaluateSelf({ codeRoot, stateDir, reaCommand, timeoutMs = 900_000 }) {
  const env = { ...process.env, ERA_STATE_DIR: stateDir };
  if (reaCommand) env.ERA_REA_BIN = reaCommand;
  const r = await runProcess(process.execPath, [`${codeRoot}/bin/era.mjs`, 'self-analyze', '--json'], { cwd: codeRoot, env, timeoutMs, watchdog: true });
  let report;
  try {
    report = JSON.parse(r.stdout);
  } catch {
    throw new Error(`self-analysis of ${codeRoot} produced no JSON report (exit ${r.exitCode}): ${r.stderr.trim().split('\n').pop()}`);
  }
  const load = (run) => (run.status === 'succeeded' && run.output_file && existsSync(run.output_file) ? JSON.parse(readFileSync(run.output_file, 'utf8')) : null);
  const runs = report.runs ?? [];
  const jsEvidence = runs.filter((x) => x.operation === 'analyze_javascript_application').map(load).filter(Boolean);
  const capture = runs.filter((x) => x.operation === 'capture_process_scenario').map(load).find(Boolean) ?? null;
  if (jsEvidence.length === 0) throw new Error(`self-analysis of ${codeRoot} produced no successful REA JavaScript analysis`);

  const findings = runRules(jsEvidence, capture);
  const recovered = new Set(graphView(jsEvidence).modules);
  const expected = await listSourceModules(codeRoot);
  return {
    self_analysis_id: report.self_analysis_id,
    report: report.report_path ?? null,
    runs,
    findings,
    missing_modules: expected.filter((m) => !recovered.has(m)),
    metrics: {
      modules: recovered.size,
      expected_modules: expected.length,
      startup_ms: startupMs(capture),
      findings: findings.length,
      rea_runs: runs.length,
    },
  };
}
