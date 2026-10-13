// Benchmark Engine (protected path). Runs `era analyze` from the checkout under
// test as a subprocess, under identical conditions, and scores its facts with
// the evaluator's own scoring code and ground truth.
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { runProcess } from '../core/process.js';
import { median } from '../core/util.js';
import { scoreFacts } from './score.js';
import { planWorkflow, decompileCandidates } from '../analysis/analyze.js';
import { sandboxCommand, sandboxAvailable } from '../safety/sandbox.js';

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
  const r = await runProcess(process.execPath, args, { cwd: codeRoot, env, timeoutMs, measureResources: true, watchdog: true });
  let analysis;
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
    error: ok ? null : [r.timedOut ? 'timed out' : null, r.signal ? `signal ${r.signal}` : null, r.stderr.trim().split('\n').pop() || `exit ${r.exitCode}`].filter(Boolean).join('; '),
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

// Executes, per case, the same REA command sequence ERA issues (including the
// runtime sandbox wrapper and per-function decompilation), directly and without
// ERA, to measure ERA's orchestration overhead under identical conditions.
export async function runReaBaseline({ datasetsDir, repetitions = 3, reaCommand = 'rea', decompile = false, maxDecompiledFunctions = 8, timeoutMs = 600_000 }) {
  const cases = loadManifest(datasetsDir);
  const work = mkdtempSync(join(tmpdir(), 'era-rea-baseline-'));
  const results = [];
  try {
    for (const c of cases) {
      const walls = [];
      let failures = 0;
      for (let i = 0; i < repetitions; i++) {
        const dir = mkdtempSync(join(work, `${c.id}-`));
        const scenarioPath = join(dir, 'scenario.json');
        const steps = planWorkflow(c.kind, c.targetPath, { runtime: !!c.runtime, runtimeArgs: c.runtime_args ?? [], scenarioPath });
        const started = process.hrtime.bigint();
        for (const step of steps) {
          if (step.scenario) {
            const scratch = join(dir, 'scratch');
            const wrapped = sandboxAvailable() ? sandboxCommand(step.scenario.executable, step.scenario.arguments, { writableDirs: [scratch] }) : step.scenario;
            writeFileSync(scenarioPath, JSON.stringify({ executable: wrapped.executable, arguments: wrapped.arguments, working_directory: scratch, filesystem_observation_paths: [scratch], timeout_ms: 30000, idle_timeout_ms: 30000, finalization_ms: 500 }));
          }
          const r = await runProcess(reaCommand, [step.subcommand, ...step.args, '--format', 'json'], { timeoutMs });
          if (r.exitCode !== 0) failures++;
          if (decompile && step.subcommand === 'inspect-macho' && r.exitCode === 0) {
            for (const sym of decompileCandidates(JSON.parse(r.stdout), maxDecompiledFunctions)) {
              const f = await runProcess(reaCommand, ['function', c.targetPath, sym, '--snapshot', join(dir, 'provider.snapshot'), '--format', 'json'], { timeoutMs });
              if (f.exitCode !== 0) failures++;
            }
          }
        }
        walls.push(Number(process.hrtime.bigint() - started) / 1e6);
      }
      results.push({ id: c.id, repetitions, median_wall_ms: median(walls), failures });
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return { created_at: new Date().toISOString(), repetitions, cases: results, aggregate: { total_median_wall_ms: results.reduce((s, r) => s + r.median_wall_ms, 0), failures: results.reduce((s, r) => s + r.failures, 0) } };
}

// Supervised comparative benchmark (Improvement Lab). The stable supervisor runs
// every REA workflow once per case and repetition (stable analyzeTarget, trusted
// engine), then each code version under comparison only converts that same
// Evidence into facts (`era extract`) under candidate isolation, without access
// to the ground truth. Baseline and candidate therefore see identical engine
// output; timings separate engine time from ERA extraction time.
export async function runSupervisedBenchmark({ datasetsDir, extractors, repetitions = 3, rea, isolation, decompile = false, timeoutMs = 600_000, provenance = {} }) {
  const { analyzeTarget } = await import('../analysis/analyze.js');
  const { wrapCandidate } = await import('../safety/candidate-sandbox.js');
  const cases = loadManifest(datasetsDir);
  const work = mkdtempSync(join(tmpdir(), 'era-supervised-bench-'));
  const truthDirs = [join(datasetsDir, 'truth'), ...extractors.map((x) => join(x.codeRoot, 'benchmarks', 'datasets', 'truth'))];
  const samples = Object.fromEntries(extractors.map((x) => [x.label, []]));
  try {
    for (const c of cases) {
      for (let rep = 0; rep < repetitions; rep++) {
        const started = process.hrtime.bigint();
        let analysis = null;
        let engineError = null;
        try {
          analysis = await analyzeTarget(c.targetPath, { rea, stateDir: join(work, 'state'), runtime: !!c.runtime, runtimeArgs: c.runtime_args ?? [], decompile });
        } catch (err) {
          engineError = err.message;
        }
        const engineMs = Number(process.hrtime.bigint() - started) / 1e6;
        const engineOk = analysis?.status === 'succeeded';
        const evidenceFiles = (analysis?.runs ?? []).filter((r) => r.status === 'succeeded' && r.output_file).map((r) => r.output_file);
        const manifest = join(work, `${c.id}-${rep}.json`);
        writeFileSync(manifest, JSON.stringify({ target: { path: c.targetPath, kind: c.kind }, evidence_files: evidenceFiles, source_root: analysis?.target?.staged_as ?? c.targetPath }));
        for (const x of extractors) {
          const tmp = mkdtempSync(join(work, 'tmp-'));
          const cmd = wrapCandidate(isolation, process.execPath, [join(x.codeRoot, 'bin', 'era.mjs'), 'extract', '--manifest', manifest, '--json'], { writable: [], denyRead: truthDirs, tmp, extraEnv: { ERA_LOG: 'off' } });
          const r = await runProcess(cmd.command, cmd.args, { cwd: tmp, env: cmd.env, timeoutMs, measureResources: true, watchdog: true });
          let facts = null;
          try {
            facts = r.exitCode === 0 ? JSON.parse(r.stdout).facts : null;
          } catch {
            facts = null;
          }
          const ok = engineOk && Array.isArray(facts);
          samples[x.label].push({
            case: c.id,
            repetition: rep,
            ok,
            engine_ok: engineOk,
            engine_ms: Math.round(engineMs),
            extract_ms: Math.round(r.durationMs),
            wall_ms: Math.round(engineMs + r.durationMs),
            cpu_s: r.resources ? r.resources.user_s + r.resources.sys_s : null,
            max_rss_bytes: r.resources?.max_rss_bytes ?? null,
            rea_runs: analysis?.runs?.length ?? 0,
            evidence_ids: (analysis?.runs ?? []).map((run) => run.evidence_id).filter(Boolean),
            facts: facts ?? [],
            error: ok ? null : engineError ?? (engineOk ? `extract exit ${r.exitCode}: ${r.stderr.trim().split('\n').pop()}` : `engine: ${analysis?.runs?.flatMap((run) => run.errors).join('; ') || 'failed'}`),
          });
        }
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return extractors.map((x) => summarize(x.label, cases, samples[x.label], repetitions, { ...provenance, mode: 'supervised', isolation: isolation.mechanism }));
}

function summarize(label, cases, samples, repetitions, provenance) {
  const results = cases.map((c) => {
    const reps = samples.filter((s) => s.case === c.id);
    const okReps = reps.filter((s) => s.ok);
    const signature = (s) => JSON.stringify(s.facts);
    const score = okReps[0] ? scoreFacts(okReps[0].facts, c.truth) : null;
    return {
      id: c.id,
      kind: c.kind,
      repetitions,
      succeeded: okReps.length,
      error_rate: (reps.length - okReps.length) / reps.length,
      deterministic: okReps.length === reps.length && okReps.every((s) => signature(s) === signature(okReps[0])),
      median_wall_ms: median(reps.map((s) => s.wall_ms)),
      median_engine_ms: median(reps.map((s) => s.engine_ms)),
      median_extract_ms: median(reps.map((s) => s.extract_ms)),
      median_cpu_s: median(reps.map((s) => s.cpu_s).filter((v) => v !== null)),
      max_rss_bytes: Math.max(0, ...reps.map((s) => s.max_rss_bytes ?? 0)),
      rea_runs: median(reps.map((s) => s.rea_runs)),
      precision: score?.precision ?? 0,
      recall: score?.recall ?? 0,
      f1: score?.f1 ?? 0,
      per_category: score?.per_category ?? {},
      missing: score?.missing ?? c.truth,
      unexpected: score?.unexpected ?? [],
      errors: reps.map((s) => s.error).filter(Boolean),
    };
  });
  const mean = (k) => results.reduce((s, r) => s + r[k], 0) / results.length;
  const totalReps = results.reduce((s, r) => s + r.repetitions, 0);
  return {
    label,
    created_at: new Date().toISOString(),
    repetitions,
    provenance,
    cases: results,
    samples,
    aggregate: {
      accuracy_f1: mean('f1'),
      precision: mean('precision'),
      completeness_recall: mean('recall'),
      total_median_wall_ms: results.reduce((s, r) => s + (r.median_wall_ms ?? 0), 0),
      total_median_extract_ms: results.reduce((s, r) => s + (r.median_extract_ms ?? 0), 0),
      total_median_cpu_s: results.reduce((s, r) => s + (r.median_cpu_s ?? 0), 0),
      max_rss_bytes: Math.max(0, ...results.map((r) => r.max_rss_bytes)),
      error_rate: results.reduce((s, r) => s + r.error_rate * r.repetitions, 0) / totalReps,
      reliability: results.filter((r) => r.deterministic).length / results.length,
      rea_runs: results.reduce((s, r) => s + r.rea_runs, 0),
    },
  };
}
