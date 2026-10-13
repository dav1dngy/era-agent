// ERA command-line interface.
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { loadConfig } from './core/config.js';
import { writeJson, writeText } from './core/util.js';
import { ReaClient } from './rea_integration/rea-client.js';
import { analyzeTarget } from './analysis/analyze.js';
import { detectTarget } from './analysis/detect.js';
import { selfAnalyze } from './self_analysis/self-analyze.js';
import { proposeCycle, implementCycle, evaluateCycle, abandonCycle } from './orchestration/cycle.js';
import { readLedger, decidedCycles, pendingCycles, appendLedger } from './orchestration/ledger.js';
import * as vm from './orchestration/versions.js';
import { runBenchmark } from './evaluation/benchmark.js';
import { renderBenchmarkTable } from './reporting/table.js';
import { renderDashboard } from './reporting/dashboard.js';
import { assertTargetPath, effectiveLimits, SafetyError } from './safety/policy.js';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')).version;

export const HELP = `ERA ${VERSION} — Evolve & Reverse Engineer Anything

Usage: era <command> [options]

Analysis mode (uses the REA engine):
  analyze <target>            Reverse engineer a target and write a report
      --runtime [--arg A]...  Also execute a Mach-O target under REA process capture
      --no-decompile          Skip native decompilation even if a provider is available
      --json                  Print the analysis record as JSON
  inspect <target>            Classify a target and show the REA workflow ERA would run
  rea <rea-args...>           Run any original REA CLI command unchanged (e.g. era rea doctor)

Self-improvement mode:
  self-analyze                Pack ERA, analyze it with REA, report findings
  improve [--cycles N]        Run bounded improvement cycles (propose, implement, evaluate)
  improve propose [--finding ID]  Run REA self-analysis and open one experiment worktree
                              (--finding selects a specific REA-derived candidate)
  improve evaluate <cycle>    Test, benchmark and accept/reject an experiment
  improve abandon <cycle>     Discard a pending experiment
  benchmark [--versions a,b]  Benchmark the current checkout or tagged versions
      [--repetitions N] [--json] [--out file]
  status                      Show ERA version, REA engine status and pending work
  history                     Show improvement cycles, decisions and rollbacks
  rollback <version>          Restore an earlier tagged version as a new commit
  dashboard [--out file]      Write a static HTML dashboard

Options: --help, --version
`;

export function parseArgs(argv) {
  const positional = [];
  const flags = { arg: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (key === 'arg') flags.arg.push(argv[++i]);
      else if (['cycles', 'repetitions', 'out', 'versions', 'implementer', 'finding'].includes(key) && next !== undefined) flags[key] = argv[++i];
      else flags[key] = true;
    } else positional.push(a);
  }
  return { positional, flags };
}

function print(value, asJson) {
  process.stdout.write(asJson ? `${JSON.stringify(value, null, 2)}\n` : `${value}\n`);
}

async function requireRepo(cwd) {
  const root = await vm.repoRoot(cwd);
  if (!root || resolve(root) !== resolve(cwd)) {
    throw new Error('Self-improvement commands must run from the root of an ERA git checkout.');
  }
  return root;
}

async function cmdAnalyze(ctx, { positional, flags }) {
  let decompile = false;
  if (!flags['no-decompile']) {
    const status = await ctx.rea.status();
    decompile = !!status.decompiler_available;
  }
  const analysis = await analyzeTarget(positional[0], {
    rea: ctx.rea,
    stateDir: ctx.config.stateDirAbs,
    runtime: !!flags.runtime,
    runtimeArgs: flags.arg,
    decompile,
    maxDecompiledFunctions: ctx.config.analysis.maxDecompiledFunctions,
  });
  const code = analysis.status === 'succeeded' ? 0 : 1;
  if (flags.json) return print(analysis, true), code;
  print(readFileSync(analysis.report_path, 'utf8'));
  print(`Report: ${analysis.report_path}`);
  return code;
}

async function cmdInspect(ctx, { positional, flags }) {
  const path = resolve(positional[0] ?? '');
  assertTargetPath(path);
  const detection = detectTarget(path);
  const status = await ctx.rea.status();
  const info = { target: path, ...detection, rea: { available: status.available, version: status.version ?? null, decompiler_available: status.decompiler_available ?? false } };
  if (flags.json) return print(info, true);
  print(`Target: ${path}\nKind: ${detection.kind} (${detection.reason})\nSupported by ERA analyze: ${detection.supported ? 'yes' : 'no'}\nREA: ${status.available ? status.version : `unavailable (${status.error})`}\nNative decompiler provider: ${status.decompiler_available ? 'available' : 'not configured (see `era rea doctor`)'}`);
  return 0;
}

function cmdRea(ctx, argv) {
  return new Promise((resolvePromise) => {
    const child = spawn(ctx.rea.command, argv, { stdio: 'inherit' });
    child.on('error', (err) => {
      process.stderr.write(`era: failed to start REA (${ctx.rea.command}): ${err.message}\n`);
      resolvePromise(127);
    });
    child.on('close', (code) => resolvePromise(code ?? 1));
  });
}

async function cmdSelfAnalyze(ctx, { flags }) {
  const root = await requireRepo(ctx.config.cwd);
  const report = await selfAnalyze({ eraRoot: root, rea: ctx.rea, stateDir: ctx.config.stateDirAbs });
  if (flags.json) return print(report, true);
  print(readFileSync(report.report_path, 'utf8'));
  print(`Report: ${report.report_path}`);
  return 0;
}

async function cmdImprove(ctx, { positional, flags }) {
  const root = await requireRepo(ctx.config.cwd);
  const sub = positional[0] ?? 'run';
  const base = { root, config: ctx.config, rea: ctx.rea };
  if (flags.implementer) ctx.config.improvement.implementerCommand = flags.implementer;
  if (sub === 'propose') {
    const cycle = await proposeCycle({ ...base, findingId: flags.finding ?? null });
    if (!cycle.cycle_id) return print(cycle.message), 0;
    print(`Proposed ${cycle.cycle_id}: ${cycle.proposal.finding.title}\nHypothesis: ${cycle.proposal.hypothesis}\nWorktree: ${cycle.worktree}\nInstructions: ${cycle.instructions_file}\nNext: implement and commit in the worktree, then run \`era improve evaluate ${cycle.cycle_id}\`.`);
    return 0;
  }
  if (sub === 'evaluate') {
    const cycle = await evaluateCycle({ ...base, cycleId: positional[1], repetitions: flags.repetitions ? Number(flags.repetitions) : undefined });
    print(`${cycle.cycle_id}: ${cycle.evaluation.summary}${cycle.version ? ` (now ${cycle.version})` : ''}\nReport: ${join(ctx.config.stateDirAbs, 'cycles', cycle.cycle_id, 'report.md')}`);
    return 0;
  }
  if (sub === 'abandon') {
    const cycle = await abandonCycle({ ...base, cycleId: positional[1] });
    print(`${cycle.cycle_id}: abandoned`);
    return 0;
  }
  if (sub !== 'run') throw new Error(`Unknown improve subcommand "${sub}".`);
  const limits = effectiveLimits(ctx.config.limits, ctx.config.improvement);
  const requested = Math.min(Number(flags.cycles ?? limits.maxCycles), limits.maxCycles);
  if (!ctx.config.improvement.implementerCommand) {
    const cycle = await proposeCycle(base);
    if (!cycle.cycle_id) return print(cycle.message), 0;
    print(`No implementer configured (improvement.implementerCommand or --implementer); manual mode.\nProposed ${cycle.cycle_id}: ${cycle.proposal.hypothesis}\nWorktree: ${cycle.worktree}\nThen run: era improve evaluate ${cycle.cycle_id}`);
    return 0;
  }
  for (let i = 0; i < requested; i++) {
    const cycle = await proposeCycle(base);
    if (!cycle.cycle_id) {
      print(cycle.message);
      break;
    }
    print(`[${i + 1}/${requested}] ${cycle.cycle_id}: ${cycle.proposal.finding.title}`);
    const impl = await implementCycle({ config: ctx.config, cycle });
    if (!impl.ok) {
      await abandonCycle({ ...base, cycleId: cycle.cycle_id, reason: `implementer failed (exit ${impl.exit_code}${impl.timed_out ? ', timed out' : ''})` });
      print('  implementer failed; cycle abandoned');
      break;
    }
    const decided = await evaluateCycle({ ...base, cycleId: cycle.cycle_id });
    print(`  ${decided.evaluation.summary}${decided.version ? ` → ${decided.version}` : ''}`);
  }
  return 0;
}

async function cmdBenchmark(ctx, { flags }) {
  const root = (await vm.repoRoot(ctx.config.cwd)) ?? ctx.config.cwd;
  const datasetsDir = join(root, 'benchmarks', 'datasets');
  const repetitions = Number(flags.repetitions ?? ctx.config.benchmark.repetitions);
  const results = [];
  if (flags.versions) {
    for (const tag of String(flags.versions).split(',')) {
      const path = join(ctx.config.stateDirAbs, 'bench-worktrees', tag);
      await vm.removeWorktree(root, path);
      await vm.git(root, ['worktree', 'add', '--detach', path, tag]);
      try {
        results.push(await runBenchmark({ codeRoot: path, datasetsDir, repetitions, reaCommand: ctx.rea.command, label: tag }));
      } finally {
        await vm.removeWorktree(root, path);
      }
    }
  } else {
    results.push(await runBenchmark({ codeRoot: root, datasetsDir, repetitions, reaCommand: ctx.rea.command, label: (await vm.currentVersion(root).catch(() => null)) ?? 'working-tree' }));
  }
  const out = flags.out ? resolve(flags.out) : join(ctx.config.stateDirAbs, 'benchmarks', `benchmark-${Date.now()}.json`);
  writeJson(out, { engine: await ctx.rea.version(), results });
  if (flags.json) return print({ engine: await ctx.rea.version(), results, file: out }, true);
  print(renderBenchmarkTable(results, await ctx.rea.version()));
  print(`Results: ${out}`);
  return 0;
}

async function cmdStatus(ctx, { flags }) {
  const root = await vm.repoRoot(ctx.config.cwd);
  const rea = await ctx.rea.status();
  const events = readLedger(ctx.config.stateDirAbs);
  const limits = effectiveLimits(ctx.config.limits, ctx.config.improvement);
  const status = {
    era: { package_version: VERSION, version_tag: root ? await vm.currentVersion(root) : null, branch: root ? await vm.currentBranch(root) : null, clean: root ? await vm.isClean(root) : null },
    mode: pendingCycles(events).length ? 'self-improvement (experiment pending)' : 'idle',
    rea,
    cycles: { decided: decidedCycles(events).length, accepted: decidedCycles(events).filter((e) => e.accepted).length, pending: pendingCycles(events).map((e) => e.cycle_id), limit: limits.maxCycles },
    implementer: ctx.config.improvement.implementerCommand ? 'configured' : 'manual',
  };
  if (flags.json) return print(status, true);
  const providers = (rea.providers ?? []).map((p) => `${p.id}=${p.status}`).join(', ');
  print(`ERA ${status.era.package_version} (${status.era.version_tag ?? 'untagged'}, branch ${status.era.branch ?? 'n/a'}${status.era.clean === false ? ', dirty' : ''})
Mode: ${status.mode}
REA: ${rea.available ? `rea-agents ${rea.version} via ${rea.source} (${rea.command})` : `unavailable: ${rea.error}`}
Native providers: ${providers || 'n/a'}
Cycles: ${status.cycles.decided}/${status.cycles.limit} decided, ${status.cycles.accepted} accepted, pending: ${status.cycles.pending.join(', ') || 'none'}
Implementer: ${status.implementer}`);
  return 0;
}

async function cmdHistory(ctx, { flags }) {
  const events = readLedger(ctx.config.stateDirAbs);
  const root = await vm.repoRoot(ctx.config.cwd);
  const versions = root ? await vm.listVersions(root) : [];
  if (flags.json) return print({ events, versions }, true);
  const lines = ['Versions:'];
  for (const v of versions) lines.push(`  ${v.tag}  ${v.commit}  ${v.date}  ${v.subject}`);
  lines.push('', 'Events:');
  for (const e of events) {
    const detail = e.type === 'cycle-decided' ? `${e.accepted ? 'ACCEPTED' : 'REJECTED'} ${e.finding_id} ${e.version ?? ''} — ${e.summary}` : e.type === 'cycle-proposed' ? `${e.finding_id} (${e.area}) on ${e.branch}` : e.type === 'rollback' ? `${e.to} -> ${e.version}` : e.reason ?? '';
    lines.push(`  ${e.at}  ${e.type.padEnd(16)} ${e.cycle_id ?? ''} ${detail}`);
  }
  print(lines.join('\n'));
  return 0;
}

async function cmdRollback(ctx, { positional }) {
  const root = await requireRepo(ctx.config.cwd);
  const target = positional[0];
  if (!target) throw new Error('Usage: era rollback <version>');
  const { commit, unchanged } = await vm.rollbackTo(root, target);
  if (unchanged) return print(`Working tree already matches ${target}; nothing to roll back.`), 0;
  const tag = await vm.nextVersionTag(root);
  await vm.tagVersion(root, tag, `${tag}: rollback to ${target}`);
  appendLedger(ctx.config.stateDirAbs, { type: 'rollback', to: target, version: tag, commit });
  print(`Restored ${target} as ${tag} (${commit.slice(0, 12)}).`);
  return 0;
}

async function cmdDashboard(ctx, { flags }) {
  const out = flags.out ? resolve(flags.out) : join(ctx.config.stateDirAbs, 'dashboard.html');
  writeText(out, await renderDashboard({ config: ctx.config, rea: ctx.rea }));
  print(`Dashboard: ${out}`);
  return 0;
}

const COMMANDS = {
  analyze: cmdAnalyze,
  inspect: cmdInspect,
  'self-analyze': cmdSelfAnalyze,
  improve: cmdImprove,
  benchmark: cmdBenchmark,
  status: cmdStatus,
  history: cmdHistory,
  rollback: cmdRollback,
  dashboard: cmdDashboard,
};

export async function main(argv) {
  const [command, ...rest] = argv;
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(HELP);
    return 0;
  }
  if (command === '--version' || command === 'version') {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  const config = loadConfig(process.cwd());
  const ctx = { config, rea: ReaClient.fromConfig(config) };
  if (command === 'rea') return cmdRea(ctx, rest);
  const handler = COMMANDS[command];
  if (!handler) {
    process.stderr.write(`era: unknown command "${command}". Run \`era --help\`.\n`);
    return 2;
  }
  const args = parseArgs(rest);
  if (args.flags.help) {
    process.stdout.write(HELP);
    return 0;
  }
  try {
    return (await handler(ctx, args)) ?? 0;
  } catch (err) {
    const prefix = err instanceof SafetyError ? 'era: safety: ' : 'era: ';
    process.stderr.write(`${prefix}${err.message}\n`);
    return err.code === 'unsupported_target' ? 3 : 1;
  }
}
