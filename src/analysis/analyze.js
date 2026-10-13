// Analysis Orchestrator (Analysis Mode): classify a target, choose the REA
// workflow, execute REA, extract facts and write a report.
import { copyFileSync, mkdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { detectTarget } from './detect.js';
import { extractFacts, groupFacts } from './facts.js';
import { renderAnalysisReport } from './report.js';
import { assertTargetPath } from '../safety/policy.js';
import { newId, writeJson, writeText } from '../core/util.js';

export function planWorkflow(kind, path, { runtime = false, runtimeArgs = [], scenarioPath = null } = {}) {
  switch (kind) {
    case 'javascript-app':
    case 'javascript-file':
    case 'asar':
      return [{ subcommand: 'analyze-javascript-application', args: [path], label: 'javascript-application-graph' }];
    case 'archive':
      return [{ subcommand: 'inspect-artifact', args: [path], label: 'artifact-inventory' }];
    case 'mach-o': {
      const steps = [{ subcommand: 'inspect-macho', args: [path], label: 'mach-o-structure' }];
      if (runtime) steps.push({ subcommand: 'capture-process', args: [scenarioPath], label: 'process-capture', scenario: { executable: path, arguments: runtimeArgs } });
      return steps;
    }
    default:
      return [];
  }
}

// Exported code symbols worth decompiling (the Mach-O header symbol is data).
export function decompileCandidates(machoEvidence, limit) {
  return (machoEvidence?.normalized_result?.exports?.items ?? [])
    .map((e) => e.name)
    .filter((n) => n && n !== '__mh_execute_header')
    .slice(0, limit);
}

function summarizeEvidence(evidence) {
  const nr = evidence?.normalized_result ?? {};
  const sem = nr.semantic_graph;
  const fn = evidence?.operation === 'analyze_function' ? { name: nr.procedure?.name, address: nr.procedure?.address, signature: nr.procedure?.signature ?? null, pseudocode: nr.pseudocode ?? null } : null;
  return {
    ...(fn ? { function: fn } : {}),
    evidence_id: evidence?.evidence_id ?? null,
    operation: evidence?.operation ?? null,
    provider: evidence?.provider?.name ?? null,
    subject_sha256: evidence?.subject?.digest?.sha256 ?? null,
    coverage: nr.graph?.coverage?.status ?? nr.coverage?.status ?? null,
    unknowns: sem ? sem.unknowns?.length ?? 0 : null,
    statistics: nr.statistics ?? null,
    limitations: [...new Set([...(evidence?.limitations ?? []), ...(nr.limitations ?? [])])],
  };
}

export async function analyzeTarget(target, { rea, stateDir, runtime = false, runtimeArgs = [], runtimeTimeoutMs = 30_000, decompile = false, maxDecompiledFunctions = 8 }) {
  const path = resolve(target);
  assertTargetPath(path);
  const detection = detectTarget(path);
  if (!detection.supported) {
    const err = new Error(`Unsupported target kind "${detection.kind}": ${detection.reason}`);
    err.code = 'unsupported_target';
    throw err;
  }
  if (runtime && detection.kind !== 'mach-o') {
    throw new Error('--runtime is only supported for native Mach-O executables in this release.');
  }
  const analysisId = newId('analysis');
  const dir = join(stateDir, 'analyses', analysisId);
  mkdirSync(dir, { recursive: true });
  const scenarioPath = join(dir, 'process-scenario.json');
  // REA's JavaScript analyzer accepts only a directory or .asar: stage single files.
  let reaInput = path;
  if (detection.kind === 'javascript-file') {
    reaInput = join(dir, 'staged');
    mkdirSync(reaInput, { recursive: true });
    copyFileSync(path, join(reaInput, basename(path)));
  }
  const steps = planWorkflow(detection.kind, reaInput, { runtime, runtimeArgs, scenarioPath });

  const runs = [];
  const evidence = [];
  const facts = new Set();
  const execute = async (step) => {
    if (step.scenario) {
      writeJson(scenarioPath, { ...step.scenario, working_directory: dir, timeout_ms: runtimeTimeoutMs, idle_timeout_ms: runtimeTimeoutMs, finalization_ms: 500 });
    }
    const { record, result } = await rea.run(step.subcommand, step.args, { inputPath: reaInput, label: step.label });
    runs.push(record);
    if (record.status === 'succeeded' && result) {
      evidence.push(summarizeEvidence(result));
      for (const f of extractFacts(result)) facts.add(f);
    }
    return { record, result };
  };
  for (const step of steps) {
    const { result } = await execute(step);
    // Native decompilation needs a deep provider (Hopper, Ghidra or IDA); one
    // shared snapshot lets successive functions reuse the provider analysis.
    if (decompile && step.subcommand === 'inspect-macho' && result) {
      const snapshot = join(dir, 'provider.snapshot');
      for (const symbol of decompileCandidates(result, maxDecompiledFunctions)) {
        await execute({ subcommand: 'function', args: [path, symbol, '--snapshot', snapshot], label: `decompile:${symbol}` });
      }
    }
  }

  const analysis = {
    analysis_id: analysisId,
    created_at: new Date().toISOString(),
    target: { path, kind: detection.kind, detection: detection.reason, ...(reaInput !== path ? { staged_as: reaInput } : {}) },
    decompilation: detection.kind === 'mach-o' ? (decompile ? 'enabled' : 'skipped (no deep analysis provider available, or --no-decompile)') : 'not applicable',
    engine: runs[0]?.engine ?? null,
    status: runs.length > 0 && runs.every((r) => r.status === 'succeeded') ? 'succeeded' : runs.some((r) => r.status === 'succeeded') ? 'partial' : 'failed',
    runs,
    evidence,
    facts: [...facts].sort(),
    fact_groups: groupFacts([...facts].sort()),
    report_path: join(dir, 'report.md'),
  };
  writeJson(join(dir, 'analysis.json'), analysis);
  writeText(analysis.report_path, renderAnalysisReport(analysis));
  return analysis;
}
