// Benchmark, status, history, rollback and dashboard commands.
import { join, resolve } from 'node:path';
import { readLedger, decidedCycles, pendingCycles, awaitingApproval, appendLedger } from '../orchestration/ledger.js';
import * as vm from '../orchestration/versions.js';
import { runBenchmark, runReaBaseline } from '../evaluation/benchmark.js';
import { renderBenchmarkTable, renderOverheadTable } from '../reporting/table.js';
import { renderDashboard } from '../reporting/dashboard.js';
import { selectedAgentId } from '../agents/coding-agents.js';
import { effectiveLimits } from '../safety/policy.js';
import { sandboxAvailable } from '../safety/sandbox.js';
import { writeJson, writeText } from '../core/util.js';
import { requireRepo } from './lab.js';

const print = (value, asJson) => process.stdout.write(asJson ? `${JSON.stringify(value, null, 2)}\n` : `${value}\n`);

async function benchmark(ctx, { flags }) {
  const root = (await vm.repoRoot(ctx.config.cwd)) ?? ctx.config.cwd;
  const datasetsDir = join(root, 'benchmarks', 'datasets');
  const repetitions = Number(flags.repetitions ?? ctx.config.benchmark.repetitions);
  const engine = await ctx.rea.version();
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
  const reaBaseline = flags['rea-baseline'] ? await runReaBaseline({ datasetsDir, repetitions, reaCommand: ctx.rea.command, decompile: !!(await ctx.rea.status()).decompiler_available }) : null;
  const out = flags.out ? resolve(flags.out) : join(ctx.config.stateDirAbs, 'benchmarks', `benchmark-${Date.now()}.json`);
  const payload = { engine, created_at: new Date().toISOString(), results, ...(reaBaseline ? { rea_baseline: reaBaseline } : {}) };
  writeJson(out, payload);
  ctx.log.info('benchmark.finished', { file: out, labels: results.map((r) => r.label), aggregates: results.map((r) => r.aggregate), rea_baseline: reaBaseline?.aggregate ?? null });
  if (flags.json) return print({ ...payload, file: out }, true), 0;
  print(renderBenchmarkTable(results, engine));
  if (reaBaseline) print(`\n${renderOverheadTable(results.at(-1), reaBaseline)}`);
  print(`Results: ${out}`);
  return 0;
}

async function status(ctx, { flags }) {
  const root = await vm.repoRoot(ctx.config.cwd);
  const rea = await ctx.rea.status();
  const events = readLedger(ctx.config.stateDirAbs);
  const limits = effectiveLimits(ctx.config.limits, ctx.config.improvement);
  const s = {
    era: { package_version: ctx.version, version_tag: root ? await vm.currentVersion(root) : null, branch: root ? await vm.currentBranch(root) : null, clean: root ? await vm.isClean(root) : null },
    mode: pendingCycles(events).length ? 'improvement lab (experiment in progress)' : awaitingApproval(events).length ? 'improvement lab (awaiting approval)' : 'idle',
    rea,
    cycles: {
      decided: decidedCycles(events).length,
      limit: limits.maxCycles,
      pending: pendingCycles(events).map((e) => e.cycle_id),
      awaiting_approval: awaitingApproval(events).map((e) => e.cycle_id),
      integrated: events.filter((e) => e.type === 'cycle-approved' || (e.type === 'cycle-decided' && e.version)).length,
    },
    coding_agent: selectedAgentId(ctx.config),
    reasoning_provider: ctx.config.reasoning?.provider ?? 'none',
    runtime_sandbox: sandboxAvailable() ? 'macos-sandbox-exec' : 'unavailable',
    log_file: ctx.log.file,
  };
  if (flags.json) return print(s, true), 0;
  const providers = (rea.providers ?? []).map((p) => `${p.id}=${p.status}`).join(', ');
  print(`ERA ${s.era.package_version} (${s.era.version_tag ?? 'untagged'}, branch ${s.era.branch ?? 'n/a'}${s.era.clean === false ? ', dirty' : ''})
Mode: ${s.mode}
REA: ${rea.available ? `rea-agents ${rea.version} via ${rea.source} (${rea.command})` : `unavailable: ${rea.error}`}
Native providers: ${providers || 'n/a'}
Cycles: ${s.cycles.decided}/${s.cycles.limit} decided, ${s.cycles.integrated} integrated, in progress: ${s.cycles.pending.join(', ') || 'none'}, awaiting approval: ${s.cycles.awaiting_approval.join(', ') || 'none'}
Coding agent: ${s.coding_agent}; reasoning provider: ${s.reasoning_provider}; runtime sandbox: ${s.runtime_sandbox}
Log: ${s.log_file ?? 'disabled'}`);
  return 0;
}

function describe(e) {
  switch (e.type) {
    case 'cycle-decided':
      return `${e.status ? e.status.toUpperCase() : e.accepted ? 'ACCEPTED' : 'REJECTED'} ${e.finding_id} ${e.version ?? ''} — ${e.summary}`;
    case 'cycle-proposed':
      return `${e.finding_id} (${e.area}) on ${e.branch}`;
    case 'cycle-approved':
      return `by ${e.approver} -> ${e.version}`;
    case 'cycle-declined':
      return `by ${e.approver}: ${e.reason}`;
    case 'implementer-finished':
      return `${e.agent} ${e.ok ? 'ok' : 'failed'}${typeof e.cost_usd === 'number' ? ` $${e.cost_usd.toFixed(4)}` : ''}`;
    case 'rollback':
      return `${e.to} -> ${e.version}`;
    case 'state-recovered':
      return e.actions.join('; ');
    default:
      return e.reason ?? e.signal ?? e.error ?? '';
  }
}

async function history(ctx, { flags }) {
  const events = readLedger(ctx.config.stateDirAbs);
  const root = await vm.repoRoot(ctx.config.cwd);
  const versions = root ? await vm.listVersions(root) : [];
  if (flags.json) return print({ events, versions }, true), 0;
  const lines = ['Versions:'];
  for (const v of versions) lines.push(`  ${v.tag}  ${v.commit}  ${v.date}  ${v.subject}`);
  lines.push('', 'Events:');
  for (const e of events) lines.push(`  ${e.at}  ${e.type.padEnd(22)} ${e.cycle_id ?? ''} ${describe(e)}`);
  print(lines.join('\n'));
  return 0;
}

async function rollback(ctx, { positional }) {
  const root = await requireRepo(ctx.config.cwd);
  const target = positional[0];
  if (!target) throw new Error('Usage: era rollback <version>');
  const { commit, unchanged } = await vm.rollbackTo(root, target);
  if (unchanged) return print(`Working tree already matches ${target}; nothing to roll back.`), 0;
  const tag = await vm.nextVersionTag(root);
  await vm.tagVersion(root, tag, `${tag}: rollback to ${target}`);
  appendLedger(ctx.config.stateDirAbs, { type: 'rollback', to: target, version: tag, commit });
  ctx.log.info('rollback', { to: target, version: tag, commit });
  print(`Restored ${target} as ${tag} (${commit.slice(0, 12)}).`);
  return 0;
}

async function dashboard(ctx, { flags }) {
  const out = flags.out ? resolve(flags.out) : join(ctx.config.stateDirAbs, 'dashboard.html');
  writeText(out, await renderDashboard({ config: ctx.config, rea: ctx.rea }));
  print(`Dashboard: ${out}`);
  return 0;
}

export async function run(command, ctx, args) {
  const handlers = { benchmark, status, history, rollback, dashboard };
  return handlers[command](ctx, args);
}
