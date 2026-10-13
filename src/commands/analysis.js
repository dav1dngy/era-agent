// Analysis Mode commands: analyze, inspect, explain, and the REA passthrough.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { analyzeTarget } from '../analysis/analyze.js';
import { detectTarget } from '../analysis/detect.js';
import { groupFacts, extractFacts } from '../analysis/facts.js';
import { renderAnalysisReport } from '../analysis/report.js';
import { createReasoningProvider, assertEgressAllowed, reasoningPrompt } from '../agents/reasoning.js';
import { assertTargetPath } from '../safety/policy.js';
import { writeText } from '../core/util.js';

const print = (value, asJson) => process.stdout.write(asJson ? `${JSON.stringify(value, null, 2)}\n` : `${value}\n`);

async function analyze(ctx, { positional, flags }) {
  // Only native targets can be decompiled: skip the provider probe otherwise.
  let decompile = false;
  const target = positional[0] ? resolve(positional[0]) : null;
  const native = target && existsSync(target) && statSync(target).isFile() && detectTarget(target).kind === 'mach-o';
  if (native && !flags['no-decompile']) decompile = !!(await ctx.rea.status()).decompiler_available;
  const analysis = await analyzeTarget(positional[0], {
    rea: ctx.rea,
    stateDir: ctx.config.stateDirAbs,
    runtime: !!flags.runtime,
    runtimeArgs: flags.arg,
    unsandboxed: !!flags.unsandboxed,
    decompile,
    maxDecompiledFunctions: ctx.config.analysis.maxDecompiledFunctions,
  });
  ctx.log.info('analysis.finished', { correlation_id: analysis.analysis_id, analysis_id: analysis.analysis_id, target_kind: analysis.target.kind, status: analysis.status, rea_runs: analysis.runs.length, facts: analysis.facts.length, sandbox: analysis.runtime_sandbox?.mechanism ?? null });
  const code = analysis.status === 'succeeded' ? 0 : 1;
  if (flags.json) return print(analysis, true), code;
  print(readFileSync(analysis.report_path, 'utf8'));
  print(`Report: ${analysis.report_path}`);
  return code;
}

async function inspect(ctx, { positional, flags }) {
  const path = resolve(positional[0] ?? '');
  assertTargetPath(path);
  const detection = detectTarget(path);
  const status = await ctx.rea.status();
  const info = { target: path, ...detection, rea: { available: status.available, version: status.version ?? null, decompiler_available: status.decompiler_available ?? false } };
  if (flags.json) return print(info, true), 0;
  print(`Target: ${path}\nKind: ${detection.kind} (${detection.reason})\nSupported by ERA analyze: ${detection.supported ? 'yes' : 'no'}\nREA: ${status.available ? status.version : `unavailable (${status.error})`}\nNative decompiler provider: ${status.decompiler_available ? 'available' : 'not configured (see `era rea doctor`)'}`);
  return 0;
}

export function resolveAnalysis(stateDir, ref) {
  const candidates = [ref, join(ref ?? '', 'analysis.json'), join(stateDir, 'analyses', ref ?? '', 'analysis.json')];
  const file = candidates.find((c) => c && existsSync(c) && c.endsWith('.json'));
  if (!file) throw new Error(`No analysis found for "${ref}". Pass an analysis ID from \`era analyze\` or a path to analysis.json.`);
  return { file, analysis: validateAnalysis(JSON.parse(readFileSync(file, 'utf8'))) };
}

const isStr = (v) => typeof v === 'string';

// Imported analyses are untrusted: keep only the fields ERA renders, and never
// follow file paths they contain (report_path, output_file, ...).
export function validateAnalysis(a) {
  if (!a || typeof a !== 'object' || !a.target || !isStr(a.target.path) || !isStr(a.target.kind) || !Array.isArray(a.facts) || !a.facts.every(isStr)) {
    throw new Error('Not a valid ERA analysis record (target.path, target.kind and facts[] are required).');
  }
  const runs = Array.isArray(a.runs) ? a.runs : [];
  const evidence = Array.isArray(a.evidence) ? a.evidence : [];
  return {
    analysis_id: isStr(a.analysis_id) ? a.analysis_id : 'imported',
    target: { path: a.target.path, kind: a.target.kind, detection: isStr(a.target.detection) ? a.target.detection : '' },
    engine: { version: isStr(a.engine?.version) ? a.engine.version : 'unknown' },
    status: isStr(a.status) ? a.status : 'unknown',
    runs: runs.map((r) => ({ label: String(r.label ?? ''), command: Array.isArray(r.command) ? r.command.map(String).slice(0, 3) : ['rea'], status: String(r.status ?? ''), duration_ms: Number(r.duration_ms) || 0, evidence_id: isStr(r.evidence_id) ? r.evidence_id : null, errors: Array.isArray(r.errors) ? r.errors.map(String) : [] })),
    evidence: evidence.map((e) => ({ operation: String(e.operation ?? ''), provider: String(e.provider ?? ''), coverage: e.coverage ?? null, unknowns: Number.isFinite(e.unknowns) ? e.unknowns : null, limitations: Array.isArray(e.limitations) ? e.limitations.map(String) : [], ...(e.function?.pseudocode ? { function: { name: String(e.function.name), address: String(e.function.address), signature: e.function.signature ? String(e.function.signature) : null, pseudocode: String(e.function.pseudocode) } } : {}) })),
    facts: a.facts,
    fact_provenance: a.fact_provenance && typeof a.fact_provenance === 'object' ? Object.fromEntries(Object.entries(a.fact_provenance).filter(([k, v]) => isStr(k) && isStr(v))) : {},
    fact_groups: groupFacts(a.facts),
  };
}

async function explain(ctx, { positional, flags }) {
  const { file, analysis } = resolveAnalysis(ctx.config.stateDirAbs, positional[0]);
  const providerId = flags.provider ?? ctx.config.reasoning?.provider ?? 'none';
  const provider = createReasoningProvider(providerId, ctx.config);
  assertEgressAllowed(provider, { config: ctx.config, allowRemoteFlag: !!flags['allow-remote'] });
  // The report is rebuilt from the validated record; no file named in it is read.
  const report = renderAnalysisReport(analysis);
  const started = Date.now();
  const { text } = await provider.explain({ analysis, report, prompt: reasoningPrompt(analysis, report) });
  const out = join(file, '..', `explanation-${provider.id}.md`);
  writeText(out, text.endsWith('\n') ? text : `${text}\n`);
  ctx.log.info('reasoning.explained', { correlation_id: analysis.analysis_id, provider: provider.id, remote: provider.remote, duration_ms: Date.now() - started });
  print(text);
  print(`Explanation: ${out}`);
  return 0;
}

export function cmdRea(ctx, argv) {
  return new Promise((resolvePromise) => {
    const child = spawn(ctx.rea.command, argv, { stdio: 'inherit' });
    child.on('error', (err) => {
      process.stderr.write(`era: failed to start REA (${ctx.rea.command}): ${err.message}\n`);
      resolvePromise(127);
    });
    child.on('close', (code) => resolvePromise(code ?? 1));
  });
}

// Contract used by the Improvement Lab supervisor: compute facts from REA
// Evidence that the supervisor produced. Runs no engine and writes nothing.
// Manifest: { target: { path, kind }, evidence_files: [path, ...] }
async function extract(ctx, { flags }) {
  if (!flags.manifest) throw new Error('Usage: era extract --manifest <file.json>');
  const manifest = JSON.parse(readFileSync(String(flags.manifest), 'utf8'));
  const facts = new Set();
  const provenance = new Map();
  for (const file of manifest.evidence_files ?? []) {
    for (const f of extractFacts(JSON.parse(readFileSync(file, 'utf8')), { sourceRoot: manifest.source_root ?? null, provenance })) facts.add(f);
  }
  const sorted = [...facts].sort();
  print({ target: manifest.target, facts: sorted, fact_provenance: Object.fromEntries(provenance), fact_groups: groupFacts(sorted) }, true);
  return 0;
}

export async function run(command, ctx, args) {
  if (command === 'extract') return extract(ctx, args);
  if (command === 'analyze') return analyze(ctx, args);
  if (command === 'inspect') return inspect(ctx, args);
  if (command === 'explain') return explain(ctx, args);
  throw new Error(`unknown analysis command ${command}`);
}
