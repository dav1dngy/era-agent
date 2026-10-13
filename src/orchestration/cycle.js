// Recursive Improvement Controller: propose -> implement -> evaluate -> decide,
// bounded by the Safety Controller and recorded in the ledger.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildProposal, rankCandidates, renderInstructions } from '../improvement/planner.js';
import { runImplementer } from '../improvement/modification.js';
import { runBenchmark } from '../evaluation/benchmark.js';
import { runTests } from '../evaluation/tests.js';
import { evaluateSelf } from '../evaluation/self-eval.js';
import { decide, loadAcceptance } from '../evaluation/decision.js';
import { PROTECTED_PATHS, protectedChanges, assertCycleAllowed, assertNotCI, acquireLock, effectiveLimits, SafetyError } from '../safety/policy.js';
import { appendLedger, readLedger, decidedCycles, pendingCycles } from './ledger.js';
import * as vm from './versions.js';
import { newId, writeJson, writeText } from '../core/util.js';
import { renderRunTable } from '../analysis/report.js';

function cycleDir(stateDir, id) {
  return join(stateDir, 'cycles', id);
}

export function loadCycle(stateDir, id) {
  const file = join(cycleDir(stateDir, id), 'cycle.json');
  if (!existsSync(file)) throw new Error(`Unknown cycle "${id}".`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

function saveCycle(stateDir, cycle) {
  writeJson(join(cycleDir(stateDir, cycle.cycle_id), 'cycle.json'), cycle);
}

// Per-cycle budget for REA analysis runs (self-analyses). Benchmark runs are
// bounded separately by dataset size x repetitions.
function reaBudget(limits) {
  let used = 0;
  return {
    add(self) {
      used += self.metrics.rea_runs;
      if (used > limits.maxReaRunsPerCycle) throw new SafetyError(`REA run budget exceeded (${used}/${limits.maxReaRunsPerCycle} per cycle).`);
    },
    used: () => used,
  };
}

const selfSummary = (s) => ({ id: s.self_analysis_id, metrics: s.metrics, findings: s.findings, missing_modules: s.missing_modules, runs: s.runs, report: s.report });

export async function proposeCycle({ root, config, rea }) {
  assertNotCI();
  const limits = effectiveLimits(config.limits, config.improvement);
  const stateDir = config.stateDirAbs;
  const events = readLedger(stateDir);
  if (pendingCycles(events).length > 0) {
    throw new SafetyError(`A cycle is already pending (${pendingCycles(events)[0].cycle_id}); evaluate or abandon it first.`);
  }
  assertCycleAllowed(decidedCycles(events).length, limits);
  await vm.assertStable(root);
  const release = acquireLock(stateDir, 'propose');
  try {
    const budget = reaBudget(limits);
    const acceptance = loadAcceptance(root);
    const baseCommit = await vm.headCommit(root);
    const baseVersion = await vm.currentVersion(root);
    const cycleId = newId('cycle');

    const baselineSelf = await evaluateSelf({ codeRoot: root, stateDir, reaCommand: rea.command });
    budget.add(baselineSelf);
    const baselineBench = await runBenchmark({ codeRoot: root, datasetsDir: join(root, 'benchmarks', 'datasets'), repetitions: 1, reaCommand: rea.command, label: 'planning' });

    const attempted = new Set(decidedCycles(events).map((e) => e.finding_id));
    const ranked = rankCandidates(baselineSelf.findings, baselineBench, attempted);
    if (ranked.length === 0) {
      appendLedger(stateDir, { type: 'no-candidates', base_commit: baseCommit, self_analysis_id: baselineSelf.self_analysis_id });
      return { cycle_id: null, message: 'No unattempted improvement candidates found.', self: baselineSelf };
    }
    const proposal = buildProposal(ranked[0], acceptance);
    const worktree = join(stateDir, 'worktrees', cycleId);
    const { branch } = await vm.createExperimentWorktree(root, { id: cycleId, path: worktree, baseCommit });
    const dir = cycleDir(stateDir, cycleId);
    const instructionsFile = join(dir, 'instructions.md');
    writeText(instructionsFile, renderInstructions(proposal, { worktree, protectedPaths: PROTECTED_PATHS }));

    const cycle = {
      cycle_id: cycleId,
      status: 'proposed',
      created_at: new Date().toISOString(),
      base_commit: baseCommit,
      base_version: baseVersion,
      branch,
      worktree,
      proposal,
      alternatives: ranked.slice(1, 6).map((c) => ({ id: c.id, area: c.area, title: c.title })),
      baseline_self_analysis: selfSummary(baselineSelf),
      planning_benchmark: baselineBench.aggregate,
      instructions_file: instructionsFile,
    };
    saveCycle(stateDir, cycle);
    appendLedger(stateDir, { type: 'cycle-proposed', cycle_id: cycleId, finding_id: proposal.finding.id, area: proposal.area, base_commit: baseCommit, branch });
    return cycle;
  } finally {
    release();
  }
}

export async function implementCycle({ config, cycle }) {
  const command = config.improvement.implementerCommand;
  if (!command) return null;
  const limits = effectiveLimits(config.limits, config.improvement);
  const result = await runImplementer({
    command,
    worktree: cycle.worktree,
    proposalFile: join(cycleDir(config.stateDirAbs, cycle.cycle_id), 'cycle.json'),
    instructionsFile: cycle.instructions_file,
    timeoutMs: limits.implementerTimeoutMs,
    cycleId: cycle.cycle_id,
  });
  cycle.implementer = result;
  saveCycle(config.stateDirAbs, cycle);
  return result;
}

export async function evaluateCycle({ root, config, rea, cycleId, repetitions }) {
  assertNotCI();
  const stateDir = config.stateDirAbs;
  const limits = effectiveLimits(config.limits, config.improvement);
  const cycle = loadCycle(stateDir, cycleId);
  if (cycle.status !== 'proposed') throw new Error(`Cycle ${cycleId} is already ${cycle.status}.`);
  await vm.assertStable(root);
  if ((await vm.headCommit(root)) !== cycle.base_commit) throw new SafetyError('The stable branch moved since this cycle was proposed; abandon and re-propose.');
  const release = acquireLock(stateDir, `evaluate ${cycleId}`);
  try {
    const budget = reaBudget(limits);
    budget.add(cycle.baseline_self_analysis);
    await vm.commitAll(cycle.worktree, `experiment ${cycleId}: uncommitted changes`);
    const ahead = await vm.commitsAhead(root, cycle.base_commit, cycle.branch);
    const changed = await vm.changedFiles(root, cycle.base_commit, cycle.branch);
    const reps = repetitions ?? config.benchmark.repetitions;
    const datasetsDir = join(root, 'benchmarks', 'datasets');
    const acceptance = loadAcceptance(root);

    let evaluation;
    if (ahead === 0 || changed.length === 0) {
      evaluation = { accepted: false, summary: 'rejected: experiment branch has no changes', guards: [], target: { met: false, observed: 'no changes' } };
    } else {
      const baselineTests = await runTests(root);
      const candidateTests = await runTests(cycle.worktree);
      const baseline = await runBenchmark({ codeRoot: root, datasetsDir, repetitions: reps, reaCommand: rea.command, label: cycle.base_version ?? 'baseline' });
      const candidate = await runBenchmark({ codeRoot: cycle.worktree, datasetsDir, repetitions: reps, reaCommand: rea.command, label: cycle.branch });
      const candidateSelf = await evaluateSelf({ codeRoot: cycle.worktree, stateDir, reaCommand: rea.command });
      budget.add(candidateSelf);
      const ctx = {
        baseline,
        candidate,
        baselineTests,
        candidateTests,
        baselineSelf: cycle.baseline_self_analysis,
        candidateSelf,
        protectedChanged: protectedChanges(changed),
        proposal: cycle.proposal,
      };
      evaluation = { ...decide(ctx, acceptance), baselineTests, candidateTests, baseline, candidate, candidate_self_analysis: selfSummary(candidateSelf) };
    }
    evaluation.changed_files = changed;
    evaluation.diffstat = changed.length ? await vm.diffStat(root, cycle.base_commit, cycle.branch) : '';

    if (evaluation.accepted) {
      const tag = await vm.nextVersionTag(root);
      const merge = await vm.promote(root, cycle.branch, `era: accept ${cycleId} (${cycle.proposal.finding.id}) as ${tag}`);
      await vm.tagVersion(root, tag, `${tag}: ${cycle.proposal.hypothesis.slice(0, 200)}`);
      cycle.status = 'accepted';
      cycle.version = tag;
      cycle.merge_commit = merge;
    } else {
      cycle.status = 'rejected';
    }
    await vm.removeWorktree(root, cycle.worktree);
    cycle.evaluation = evaluation;
    cycle.decided_at = new Date().toISOString();
    saveCycle(stateDir, cycle);
    writeText(join(cycleDir(stateDir, cycleId), 'report.md'), renderCycleReport(cycle));
    appendLedger(stateDir, {
      type: 'cycle-decided',
      cycle_id: cycleId,
      finding_id: cycle.proposal.finding.id,
      accepted: evaluation.accepted,
      version: cycle.version ?? null,
      summary: evaluation.summary,
      branch: cycle.branch,
    });
    return cycle;
  } finally {
    release();
  }
}

export async function abandonCycle({ root, config, cycleId, reason = 'abandoned by user' }) {
  const cycle = loadCycle(config.stateDirAbs, cycleId);
  if (cycle.status !== 'proposed') throw new Error(`Cycle ${cycleId} is already ${cycle.status}.`);
  await vm.removeWorktree(root, cycle.worktree);
  cycle.status = 'abandoned';
  cycle.abandon_reason = reason;
  saveCycle(config.stateDirAbs, cycle);
  appendLedger(config.stateDirAbs, { type: 'cycle-abandoned', cycle_id: cycleId, reason });
  return cycle;
}

const fmt = (v, digits = 4) => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(digits)) : String(v ?? '—'));

export function renderCycleReport(cycle) {
  const e = cycle.evaluation ?? {};
  const out = [`# ERA improvement cycle ${cycle.cycle_id}`, ''];
  out.push(`- Status: **${cycle.status}**${cycle.version ? ` → ${cycle.version}` : ''}`);
  out.push(`- Base: ${cycle.base_version ?? 'untagged'} (\`${cycle.base_commit.slice(0, 12)}\`), branch \`${cycle.branch}\``);
  out.push(`- Finding: ${cycle.proposal.finding.id} — ${cycle.proposal.finding.title} (${cycle.proposal.area})`);
  out.push(`- Hypothesis: ${cycle.proposal.hypothesis}`);
  out.push(`- Target: \`${JSON.stringify(cycle.proposal.target)}\` → ${e.target?.observed ?? 'not evaluated'}`);
  out.push(`- Decision: ${e.summary ?? 'pending'}`, '');
  if (e.guards?.length) {
    out.push('## Guards', '', '| Guard | Result | Detail |', '|---|---|---|');
    for (const g of e.guards) out.push(`| ${g.name} | ${g.ok ? 'pass' : 'FAIL'} | ${g.detail} |`);
    out.push('');
  }
  if (e.baseline && e.candidate) {
    out.push('## Benchmark comparison', '', '| Metric | Baseline | Candidate |', '|---|---|---|');
    for (const k of Object.keys(e.baseline.aggregate)) out.push(`| ${k} | ${fmt(e.baseline.aggregate[k])} | ${fmt(e.candidate.aggregate[k])} |`);
    out.push(`| tests passed | ${e.baselineTests?.passed} | ${e.candidateTests?.passed} |`, '');
  }
  if (cycle.baseline_self_analysis) {
    out.push('## REA self-analysis', '');
    out.push(`- Baseline: ${cycle.baseline_self_analysis.id} — ${cycle.baseline_self_analysis.findings.length} findings, startup ${cycle.baseline_self_analysis.metrics.startup_ms} ms`, '', renderRunTable(cycle.baseline_self_analysis.runs), '');
    if (e.candidate_self_analysis) {
      out.push(`- Candidate: ${e.candidate_self_analysis.id} — ${e.candidate_self_analysis.findings.length} findings, startup ${e.candidate_self_analysis.metrics.startup_ms} ms`, '');
      out.push(renderRunTable(e.candidate_self_analysis.runs), '');
    }
  }
  if (e.diffstat) out.push('## Change', '', '```', e.diffstat, '```', '');
  return out.join('\n');
}
