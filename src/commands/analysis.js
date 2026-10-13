// Analysis Mode commands: analyze, inspect, explain, and the REA passthrough.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { analyzeTarget } from '../analysis/analyze.js';
import { detectTarget } from '../analysis/detect.js';
import { createReasoningProvider, assertEgressAllowed, reasoningPrompt } from '../agents/reasoning.js';
import { assertTargetPath } from '../safety/policy.js';
import { writeText } from '../core/util.js';

const print = (value, asJson) => process.stdout.write(asJson ? `${JSON.stringify(value, null, 2)}\n` : `${value}\n`);

async function analyze(ctx, { positional, flags }) {
  let decompile = false;
  if (!flags['no-decompile']) decompile = !!(await ctx.rea.status()).decompiler_available;
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
  return { file, analysis: JSON.parse(readFileSync(file, 'utf8')) };
}

async function explain(ctx, { positional, flags }) {
  const { file, analysis } = resolveAnalysis(ctx.config.stateDirAbs, positional[0]);
  const providerId = flags.provider ?? ctx.config.reasoning?.provider ?? 'none';
  const provider = createReasoningProvider(providerId, ctx.config);
  assertEgressAllowed(provider, { config: ctx.config, allowRemoteFlag: !!flags['allow-remote'] });
  const report = existsSync(analysis.report_path) ? readFileSync(analysis.report_path, 'utf8') : '';
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

export async function run(command, ctx, args) {
  if (command === 'analyze') return analyze(ctx, args);
  if (command === 'inspect') return inspect(ctx, args);
  if (command === 'explain') return explain(ctx, args);
  throw new Error(`unknown analysis command ${command}`);
}
