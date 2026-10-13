// ERA Improvement Lab commands: self-analyze, improve <subcommand>, agents.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { selfAnalyze, planPasses } from '../self_analysis/self-analyze.js';
import { proposeCycle, implementCycle, evaluateCycle, abandonCycle, approveCycle, declineCycle, rebaseCycle, recoverState, loadCycle, renderCycleReport } from '../orchestration/cycle.js';
import * as vm from '../orchestration/versions.js';
import { createCodingAgent, selectedAgentId, CODING_AGENT_IDS } from '../agents/coding-agents.js';
import { createReasoningProvider, REASONING_PROVIDER_IDS } from '../agents/reasoning.js';
import { effectiveLimits, effectiveBudget, SafetyError } from '../safety/policy.js';
import { createInterruptGuard } from '../orchestration/interrupt.js';

const print = (value, asJson) => process.stdout.write(asJson ? `${JSON.stringify(value, null, 2)}\n` : `${value}\n`);

export async function requireRepo(cwd) {
  const root = await vm.repoRoot(cwd);
  if (!root || resolve(root) !== resolve(cwd)) throw new Error('Self-improvement commands must run from the root of an ERA git checkout.');
  return root;
}

async function approverName(root, flags) {
  if (flags.by) return String(flags.by);
  const name = (await vm.git(root, ['config', 'user.name'], { allowFail: true })).stdout;
  const email = (await vm.git(root, ['config', 'user.email'], { allowFail: true })).stdout;
  return [name, email && `<${email}>`].filter(Boolean).join(' ') || 'unknown';
}

// Integration into the stable branch needs an explicit human decision: an
// interactive "yes", or --yes when no terminal is attached.
export async function confirm(question, flags) {
  if (flags.yes) return true;
  if (!process.stdin.isTTY) throw new SafetyError('Approval needs confirmation: run in a terminal or pass --yes (only on behalf of a maintainer who reviewed the change).');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim());
  } finally {
    rl.close();
  }
}

async function selfAnalyzeCmd(ctx, { flags }) {
  if (flags.plan) {
    // Contract used by the supervisor: grouping only, no engine, no writes.
    return print({ passes: planPasses(resolve(String(flags.plan))).map(({ focus, placeholders, bytes }) => ({ focus, placeholders, bytes })) }, true), 0;
  }
  const root = await requireRepo(ctx.config.cwd);
  const report = await selfAnalyze({ eraRoot: root, rea: ctx.rea, stateDir: ctx.config.stateDirAbs });
  if (flags.json) return print(report, true), 0;
  print(readFileSync(report.report_path, 'utf8'));
  print(`Report: ${report.report_path}`);
  return 0;
}

function agentFor(ctx, flags) {
  if (flags.implementer) ctx.config.improvement.implementerCommand = flags.implementer;
  const id = flags.agent ?? (flags.implementer ? 'command' : selectedAgentId(ctx.config));
  return createCodingAgent(id, ctx.config);
}

async function implement(ctx, base, cycleId, flags) {
  const agent = agentFor(ctx, flags);
  if (agent.id === 'manual') throw new Error('The manual agent has nothing to run: edit and commit in the worktree, then `era improve evaluate`.');
  const probe = await agent.probe();
  if (!probe.available) throw new Error(`Coding agent "${agent.id}" is not available: ${probe.detail}`);
  const cycle = loadCycle(ctx.config.stateDirAbs, cycleId);
  if (cycle.status !== 'proposed') throw new Error(`Cycle ${cycleId} is ${cycle.status}; only proposed cycles can be implemented.`);
  const log = ctx.log.child({ correlation_id: cycleId });
  log.info('agent.started', { agent: agent.id, agent_version: probe.version ?? null });
  const result = await implementCycle({ config: ctx.config, cycle, agent });
  log.info('agent.finished', { agent: agent.id, ok: result.ok, exit_code: result.exit_code ?? null, duration_ms: result.duration_ms ?? null, cost_usd: result.cost_usd ?? null, commit: result.commit ?? null });
  return result;
}

async function improve(ctx, { positional, flags }) {
  const root = await requireRepo(ctx.config.cwd);
  const sub = positional[0] ?? 'run';
  const id = positional[1];
  const base = { root, config: ctx.config, rea: ctx.rea };
  const stateDir = ctx.config.stateDirAbs;
  const log = ctx.log.child({ correlation_id: id ?? undefined });
  switch (sub) {
    case 'propose': {
      const cycle = await proposeCycle({ ...base, findingId: flags.finding ?? null });
      if (!cycle.cycle_id) return print(cycle.message), 0;
      ctx.log.info('cycle.proposed', { correlation_id: cycle.cycle_id, finding_id: cycle.proposal.finding.id, area: cycle.proposal.area, target: cycle.proposal.target, rea_runs: cycle.baseline_self_analysis.runs.length });
      print(`Proposed ${cycle.cycle_id}: ${cycle.proposal.finding.title}\nHypothesis: ${cycle.proposal.hypothesis}\nWorktree: ${cycle.worktree}\nInstructions: ${cycle.instructions_file}\nNext: implement (manually or \`era improve implement ${cycle.cycle_id} --agent <id>\`), then \`era improve evaluate ${cycle.cycle_id}\`.`);
      return 0;
    }
    case 'implement': {
      const r = await implement(ctx, base, id, flags);
      print(`${id}: agent ${r.agent} ${r.ok ? 'finished' : 'failed'} (exit ${r.exit_code}${r.timed_out ? ', timed out' : ''}${r.cost_usd !== null && r.cost_usd !== undefined ? `, $${r.cost_usd.toFixed(4)}` : ', cost not reported'})${r.commit ? `, commit ${r.commit.slice(0, 12)}` : ', no changes'}`);
      return r.ok ? 0 : 1;
    }
    case 'evaluate': {
      const cycle = await evaluateCycle({ ...base, cycleId: id, repetitions: flags.repetitions ? Number(flags.repetitions) : undefined, trustCandidate: !!flags['trust-candidate'] });
      log.info('cycle.decided', { status: cycle.status, accepted: cycle.evaluation.accepted, summary: cycle.evaluation.summary, guards_failed: (cycle.evaluation.guards ?? []).filter((g) => !g.ok).map((g) => g.name) });
      const next = cycle.status === 'inconclusive' ? `\nInconclusive: fix the measurement problem and run \`era improve evaluate ${id}\` again.` : cycle.status === 'awaiting-approval' ? `\nAwaiting maintainer approval: review \`era improve show ${id}\`, then \`era improve approve ${id}\` or \`era improve decline ${id}\`.` : '';
      print(`${id}: ${cycle.evaluation.summary}${next}\nReport: ${join(stateDir, 'cycles', id, 'report.md')}`);
      return 0;
    }
    case 'show': {
      const cycle = loadCycle(stateDir, id);
      print(renderCycleReport(cycle));
      const patch = join(stateDir, 'cycles', id, 'change.patch');
      if (existsSync(patch)) print(`Patch: ${patch}`);
      return 0;
    }
    case 'approve': {
      const cycle = loadCycle(stateDir, id);
      const approver = await approverName(root, flags);
      if (!(await confirm(`Integrate ${id} (${cycle.proposal.finding.title}) into ${vm.STABLE_BRANCH} as ${approver}?`, flags))) return print('Not approved; nothing changed.'), 1;
      const done = await approveCycle({ ...base, cycleId: id, approver });
      log.info('cycle.approved', { approver, version: done.version, merge_commit: done.merge_commit });
      print(`${id}: integrated as ${done.version} (${done.merge_commit.slice(0, 12)}), approved by ${approver}.`);
      return 0;
    }
    case 'decline': {
      const approver = await approverName(root, flags);
      await declineCycle({ config: ctx.config, cycleId: id, approver, reason: flags.reason ?? 'declined by maintainer' });
      log.info('cycle.declined', { approver });
      print(`${id}: declined; ${vm.STABLE_BRANCH} unchanged (branch kept for reference).`);
      return 0;
    }
    case 'cancel':
    case 'abandon': {
      await abandonCycle({ ...base, cycleId: id, reason: flags.reason ?? 'cancelled by user' });
      log.info('cycle.cancelled', {});
      print(`${id}: cancelled`);
      return 0;
    }
    case 'rebase': {
      const { cycle, changed } = await rebaseCycle({ ...base, cycleId: id });
      log.info('cycle.rebased', { changed, base_commit: cycle.base_commit });
      print(changed ? `${id}: merged ${vm.STABLE_BRANCH} (${cycle.base_commit.slice(0, 12)}) into ${cycle.branch}; baseline re-analyzed with REA. Next: era improve evaluate ${id}` : `${id}: already based on the current ${vm.STABLE_BRANCH}.`);
      return 0;
    }
    case 'recover': {
      const actions = await recoverState(base);
      ctx.log.info('state.recovered', { actions });
      print(actions.length ? actions.map((a) => `- ${a}`).join('\n') : 'Nothing to recover.');
      return 0;
    }
    case 'run':
      return loop(ctx, base, flags);
    default:
      throw new Error(`Unknown improve subcommand "${sub}".`);
  }
}

// Bounded unattended loop. Accepted experiments still stop at awaiting-approval.
async function loop(ctx, base, flags) {
  const limits = effectiveLimits(ctx.config.limits, ctx.config.improvement);
  const requested = Math.min(Number(flags.cycles ?? limits.maxCycles), limits.maxCycles);
  const agent = agentFor(ctx, flags);
  if (agent.id === 'manual') {
    const cycle = await proposeCycle(base);
    if (!cycle.cycle_id) return print(cycle.message), 0;
    print(`Manual mode (no coding agent selected; use --agent claude-code|codex|command).\nProposed ${cycle.cycle_id}: ${cycle.proposal.hypothesis}\nWorktree: ${cycle.worktree}\nThen run: era improve evaluate ${cycle.cycle_id}`);
    return 0;
  }
  const guard = createInterruptGuard();
  try {
    for (let i = 0; i < requested; i++) {
      guard.check();
      const cycle = await proposeCycle(base);
      if (!cycle.cycle_id) {
        print(cycle.message);
        break;
      }
      print(`[${i + 1}/${requested}] ${cycle.cycle_id}: ${cycle.proposal.finding.title}`);
      const impl = await implement(ctx, base, cycle.cycle_id, flags);
      guard.check();
      if (!impl.ok) {
        await abandonCycle({ ...base, cycleId: cycle.cycle_id, reason: `implementer failed (exit ${impl.exit_code}${impl.timed_out ? ', timed out' : ''})` });
        print('  coding agent failed; cycle abandoned');
        break;
      }
      const decided = await evaluateCycle({ ...base, cycleId: cycle.cycle_id, guard, trustCandidate: !!flags['trust-candidate'] });
      print(`  ${decided.evaluation.summary}${decided.status === 'awaiting-approval' ? ' (awaiting approval)' : ''}`);
    }
  } finally {
    guard.dispose();
  }
  return 0;
}

async function agents(ctx, { flags }) {
  const rows = [];
  for (const id of CODING_AGENT_IDS) {
    const a = createCodingAgent(id, ctx.config);
    rows.push({ role: 'coding-agent', id, metered: a.metered, ...(await a.probe()), description: a.description });
  }
  for (const id of REASONING_PROVIDER_IDS) {
    const p = createReasoningProvider(id, ctx.config);
    rows.push({ role: 'reasoning-provider', id, remote: p.remote, ...(await p.probe()), description: p.description });
  }
  const rea = await ctx.rea.status();
  rows.push({ role: 'reverse-engineering-engine', id: 'rea', available: rea.available, version: rea.version ?? null, detail: rea.command, description: 'Original REA engine (all reverse-engineering operations)' });
  const budget = effectiveBudget(ctx.config.improvement.budget);
  if (flags.json) return print({ selected: { coding_agent: selectedAgentId(ctx.config), reasoning_provider: ctx.config.reasoning?.provider ?? 'none' }, budget, rows }, true), 0;
  print(`Selected coding agent: ${selectedAgentId(ctx.config)}; reasoning provider: ${ctx.config.reasoning?.provider ?? 'none'}; remote reasoning ${ctx.config.reasoning?.allowRemote ? 'allowed by config (still needs --allow-remote)' : 'disabled'}`);
  print(`Agent budget: $${budget.maxCostUsdPerCycle}/cycle, $${budget.maxCostUsdTotal} total, unmetered agents ${budget.allowUnmeteredAgents ? 'allowed' : 'refused'}`);
  for (const r of rows) print(`  ${r.role.padEnd(26)} ${r.id.padEnd(12)} ${r.available ? 'available  ' : 'unavailable'} ${r.version ?? r.detail ?? ''}`);
  return 0;
}

export async function run(command, ctx, args) {
  if (command === 'self-analyze') return selfAnalyzeCmd(ctx, args);
  if (command === 'improve') return improve(ctx, args);
  if (command === 'agents') return agents(ctx, args);
  throw new Error(`unknown lab command ${command}`);
}
