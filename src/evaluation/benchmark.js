// Benchmark Engine (protected path). Runs `era analyze` from the checkout under
// test as a subprocess, under identical conditions, and scores its facts with
// the evaluator's own scoring code and ground truth.
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { runProcess } from '../core/process.js';
import { median } from '../core/util.js';
import { scoreFacts } from './score.js';

export function loadManifest(datasetsDir) {
  const manifest = JSON.parse(readFileSync(join(datasetsDir, 'manifest.json'), 'utf8'));
  return manifest.cases.map((c) => ({
    ...c,
    targetPath: resolve(datasetsDir, c.target),
    truth: JSON.parse(readFileSync(resolve(datasetsDir, c.truth), 'utf8')).facts,
  }));
}

async function runCase(codeRoot, c, env, timeoutMs) {
  const args = [join(codeRoot, 'bin', 'era.mjs'), 'analyze', c.targetPath, '--json'];
  if (c.runtime) args.push('--runtime', ...(c.runtime_args ?? []).flatMap((a) => ['--arg', a]));
  const r = await runProcess(process.execPath, args, { cwd: codeRoot, env, timeoutMs, measureResources: true });
  let analysis = null;
  try {
    analysis = JSON.parse(r.stdout);
  } catch {
    analysis = null;
  }
  const ok = r.exitCode === 0 && analysis?.status === 'succeeded';
  const facts = analysis?.facts ?? [];
  return {
    ok,
    wall_ms: Math.round(r.durationMs),
    cpu_s: r.resources ? r.resources.user_s + r.resources.sys_s : null,
    max_rss_bytes: r.resources?.max_rss_bytes ?? null,
    rea_runs: analysis?.runs?.length ?? 0,
    facts,
    score: scoreFacts(facts, c.truth),
    error: ok ? null : (r.stderr.trim().split('\n').pop() || `exit ${r.exitCode}`),
  };
}

export async function runBenchmark({ codeRoot, datasetsDir, repetitions = 3, reaCommand = null, timeoutMs = 600_000, label = null }) {
  const cases = loadManifest(datasetsDir);
  const stateDir = mkdtempSync(join(tmpdir(), 'era-bench-'));
  const env = { ...process.env, ERA_STATE_DIR: stateDir };
  if (reaCommand) env.ERA_REA_BIN = reaCommand;
  const results = [];
  try {
    for (const c of cases) {
      const reps = [];
      for (let i = 0; i < repetitions; i++) reps.push(await runCase(codeRoot, c, env, timeoutMs));
      const okReps = reps.filter((r) => r.ok);
      const signature = (r) => JSON.stringify(r.facts);
      const stable = okReps.length === reps.length && okReps.every((r) => signature(r) === signature(okReps[0]));
      results.push({
        id: c.id,
        kind: c.kind,
        repetitions,
        succeeded: okReps.length,
        error_rate: (reps.length - okReps.length) / reps.length,
        deterministic: stable,
        median_wall_ms: median(reps.map((r) => r.wall_ms)),
        median_cpu_s: median(reps.map((r) => r.cpu_s).filter((v) => v !== null)),
        max_rss_bytes: Math.max(0, ...reps.map((r) => r.max_rss_bytes ?? 0)),
        rea_runs: median(reps.map((r) => r.rea_runs)),
        precision: okReps[0]?.score.precision ?? 0,
        recall: okReps[0]?.score.recall ?? 0,
        f1: okReps[0]?.score.f1 ?? 0,
        per_category: okReps[0]?.score.per_category ?? {},
        missing: okReps[0]?.score.missing ?? c.truth,
        unexpected: okReps[0]?.score.unexpected ?? [],
        errors: reps.map((r) => r.error).filter(Boolean),
      });
    }
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
  const mean = (k) => results.reduce((s, r) => s + r[k], 0) / results.length;
  const totalReps = results.reduce((s, r) => s + r.repetitions, 0);
  return {
    label,
    code_root: codeRoot,
    created_at: new Date().toISOString(),
    repetitions,
    cases: results,
    aggregate: {
      accuracy_f1: mean('f1'),
      precision: mean('precision'),
      completeness_recall: mean('recall'),
      total_median_wall_ms: results.reduce((s, r) => s + (r.median_wall_ms ?? 0), 0),
      total_median_cpu_s: results.reduce((s, r) => s + (r.median_cpu_s ?? 0), 0),
      max_rss_bytes: Math.max(0, ...results.map((r) => r.max_rss_bytes)),
      error_rate: results.reduce((s, r) => s + r.error_rate * r.repetitions, 0) / totalReps,
      reliability: results.filter((r) => r.deterministic).length / results.length,
      rea_runs: results.reduce((s, r) => s + r.rea_runs, 0),
    },
  };
}
