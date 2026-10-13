// Recursive Improvement Controller: propose -> implement -> evaluate -> decide,
// bounded by the Safety Controller and recorded in the ledger.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildProposal, rankCandidates, renderInstructions } from '../improvement/planner.js';
import { runCodingAgent } from '../improvement/modification.js';
import { runBenchmark, runSupervisedBenchmark } from '../evaluation/benchmark.js';
import { runTests } from '../evaluation/tests.js';
import { evaluateSelf } from '../evaluation/self-eval.js';
import { decide, loadAcceptance } from '../evaluation/decision.js';
import { PROTECTED_PATHS, protectedChanges, assertCycleAllowed, assertNotCI, acquireLock, clearStaleLock, effectiveLimits, effectiveBudget, authorizeAgentRun, SafetyError } from '../safety/policy.js';
import { appendLedger, readLedger, decidedCycles, pendingCycles } from './ledger.js';
import * as vm from './versions.js';
import { newId, writeJson, writeText } from '../core/util.js';
import { createInterruptGuard, InterruptedError } from './interrupt.js';
import { candidateIsolation, protectedStatePaths } from '../safety/candidate-sandbox.js';
import { sandboxAvailable } from '../safety/sandbox.js';
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
function reaBudget(limits, alreadyUsed = 0) {
  let used = alreadyUsed;
  return {
    // Reserved before dispatch: a self-analysis that would exceed the budget never starts.
    reserve(n) {
      if (used + n > limits.maxReaRunsPerCycle) throw new SafetyError(`REA run budget exceeded: ${used} used + ${n} requested > ${limits.maxReaRunsPerCycle} per cycle.`);
      used += n;
    },
    used: () => used,
  };
}

// Stable code is trusted; it is still sandboxed when a sandbox exists.
const stableIsolation = () => (sandboxAvailable() ? candidateIsolation() : { mode: 'trusted', mechanism: 'none', note: 'stable code' });

export function validRepetitions(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 20) throw new Error(`benchmark repetitions must be an integer from 1 to 20 (got ${value}).`);
  return n;
}

const selfSummary = (s) => ({ id: s.self_analysis_id, commit: s.commit ?? null, valid: s.valid ?? true, invalid: s.invalid ?? null, plan_source: s.plan_source ?? null, metrics: s.metrics, findings: s.findings, missing_modules: s.missing_modules, runs: s.runs, report: s.report });

export async function proposeCycle({ root, config, rea, findingId = null }) {
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

    const baselineSelf = await evaluateSelf({ codeRoot: root, commit: baseCommit, stateDir, rea, isolation: stableIsolation(), budget, timeoutMs: limits.commandTimeoutMs });
    if (!baselineSelf.valid) throw new Error(`Baseline REA self-analysis is invalid: ${baselineSelf.invalid.reason}`);
    const baselineBench = await runBenchmark({ codeRoot: root, datasetsDir: join(root, 'benchmarks', 'datasets'), repetitions: 1, reaCommand: rea.command, label: 'planning' });

    const attempted = new Set(decidedCycles(events).map((e) => e.finding_id));
    let ranked = rankCandidates(baselineSelf.findings, baselineBench, attempted);
    if (findingId) {
      // Operator selection among the REA-derived candidates (may retry an attempted one).
      const all = rankCandidates(baselineSelf.findings, baselineBench);
      const chosen = all.find((c) => c.id === findingId);
      if (!chosen) throw new Error(`Finding ${findingId} is not among the current REA-derived candidates:\n${all.map((c) => `  ${c.id}  ${c.area}  ${c.title}`).join('\n')}`);
      ranked = [chosen, ...ranked.filter((c) => c.id !== findingId)];
    }
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
      selected_by: findingId ? 'operator' : 'planner',
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

// Spending recorded in the ledger. A run that started but reported no valid cost
// (missing, negative or non-finite; interrupted) is charged its full reserved budget.
export function spentUsd(events, cycleId = null) {
  const finished = new Map(events.filter((e) => e.type === 'implementer-finished').map((e) => [e.run_id ?? `${e.cycle_id}:${e.at}`, e]));
  let total = 0;
  for (const start of events.filter((e) => e.type === 'implementer-started' && (!cycleId || e.cycle_id === cycleId))) {
    const end = start.run_id ? finished.get(start.run_id) : events.find((e) => e.type === 'implementer-finished' && e.cycle_id === start.cycle_id && e.at >= start.at);
    const cost = end?.cost_usd;
    total += typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : start.budget_usd ?? 0;
  }
  return total;
}

export async function implementCycle({ config, cycle, agent }) {
  assertNotCI();
  const stateDir = config.stateDirAbs;
  const limits = effectiveLimits(config.limits, config.improvement);
  const budget = effectiveBudget(config.improvement.budget);
  const events = readLedger(stateDir);
  // Caps apply cumulatively: per cycle across repeated runs, and in total.
  const perCycleLeft = budget.maxCostUsdPerCycle - spentUsd(events, cycle.cycle_id);
  if (agent.metered && perCycleLeft <= 0) throw new SafetyError(`Per-cycle coding-agent budget exhausted for ${cycle.cycle_id} ($${budget.maxCostUsdPerCycle.toFixed(2)}).`);
  const budgetUsd = Math.min(authorizeAgentRun({ agent, budget, spentUsd: spentUsd(events) }), perCycleLeft);
  const runId = newId('agent');
  appendLedger(stateDir, { type: 'implementer-started', run_id: runId, cycle_id: cycle.cycle_id, agent: agent.id, budget_usd: agent.metered ? budgetUsd : null });
  const result = await runCodingAgent({
    agent,
    task: {
      worktree: cycle.worktree,
      proposalFile: join(cycleDir(stateDir, cycle.cycle_id), 'cycle.json'),
      instructionsFile: cycle.instructions_file,
      timeoutMs: limits.implementerTimeoutMs,
      cycleId: cycle.cycle_id,
      budgetUsd: agent.metered ? budgetUsd : null,
    },
  });
  appendLedger(stateDir, { type: 'implementer-finished', run_id: runId, cycle_id: cycle.cycle_id, agent: agent.id, ok: result.ok, cost_usd: result.cost_usd ?? null, cost_reported: !!result.cost_reported, duration_ms: result.duration_ms ?? null, commit: result.commit ?? null });
  cycle.implementer = result;
  saveCycle(stateDir, cycle);
  return result;
}

export async function evaluateCycle({ root, config, rea, cycleId, repetitions, guard = null, trustCandidate = false }) {
  assertNotCI();
  const stateDir = config.stateDirAbs;
  const limits = effectiveLimits(config.limits, config.improvement);
  const cycle = loadCycle(stateDir, cycleId);
  if (!['proposed', 'inconclusive'].includes(cycle.status)) throw new Error(`Cycle ${cycleId} is already ${cycle.status}.`);
  await vm.assertStable(root);
  if ((await vm.headCommit(root)) !== cycle.base_commit) throw new SafetyError(`The stable branch moved since this cycle was proposed; run \`era improve rebase ${cycleId}\` first.`);
  // Fails closed (before any state change) when candidate code cannot be isolated.
  const isolation = candidateIsolation({ trust: trustCandidate });
  const release = acquireLock(stateDir, `evaluate ${cycleId}`);
  const interrupt = guard ?? createInterruptGuard();
  cycle.status = 'evaluating';
  cycle.evaluation_started_at = new Date().toISOString();
  saveCycle(stateDir, cycle);
  try {
    const budget = reaBudget(limits);
    await vm.commitAll(cycle.worktree, `experiment ${cycleId}: uncommitted changes`);
    // The evaluation is bound to this exact candidate commit/tree/patch.
    const candidateRef = await vm.candidateIdentity(root, cycle.base_commit, cycle.branch);
    const ahead = await vm.commitsAhead(root, cycle.base_commit, candidateRef.commit);
    const changed = await vm.changedFiles(root, cycle.base_commit, candidateRef.commit);
    const reps = validRepetitions(repetitions ?? config.benchmark.repetitions);
    const datasetsDir = join(root, 'benchmarks', 'datasets');
    const acceptance = loadAcceptance(root);
    const protectedChanged = protectedChanges(changed);

    let evaluation;
    if (ahead === 0 || changed.length === 0) {
      evaluation = { accepted: false, summary: 'rejected: experiment branch has no changes', guards: [], target: { met: false, observed: 'no changes' } };
    } else if (protectedChanged.length) {
      // Rejected before any candidate code runs.
      evaluation = { accepted: false, summary: `rejected: protected paths changed (${protectedChanged.join(', ')}); candidate code was not executed`, guards: [{ name: 'protected paths unchanged', ok: false, detail: protectedChanged.join(', ') }], target: { met: false, observed: 'not evaluated' } };
    } else {
      const step = async (fn) => {
        interrupt.check();
        const value = await fn();
        interrupt.check();
        return value;
      };
      const timeoutMs = limits.commandTimeoutMs;
      const sandboxed = isolation.mode === 'sandbox';
      // Baseline and candidate suites run under identical conditions.
      const testOpts = { timeoutMs, ...(sandboxed ? { isolation, denyRead: protectedStatePaths(stateDir) } : {}) };
      const baselineTests = await step(() => runTests(root, testOpts));
      const candidateTests = await step(() => runTests(cycle.worktree, testOpts));
      const provenance = { base_commit: cycle.base_commit, candidate_commit: candidateRef.commit, candidate_tree: candidateRef.tree, rea_version: await rea.version() };
      let baseline;
      let candidate;
      if (sandboxed) {
        // Supervisor-run REA; each version only extracts facts from the same Evidence.
        const decompile = !!(await rea.status()).decompiler_available;
        [baseline, candidate] = await step(() => runSupervisedBenchmark({ datasetsDir, extractors: [{ label: cycle.base_version ?? 'baseline', codeRoot: root }, { label: cycle.branch, codeRoot: cycle.worktree }], repetitions: reps, rea, isolation, decompile, timeoutMs, provenance }));
      } else {
        // Trusted mode (declared by the maintainer): versions run their own REA workflows.
        baseline = await step(() => runBenchmark({ codeRoot: root, datasetsDir, repetitions: reps, reaCommand: rea.command, label: cycle.base_version ?? 'baseline', timeoutMs }));
        candidate = await step(() => runBenchmark({ codeRoot: cycle.worktree, datasetsDir, repetitions: reps, reaCommand: rea.command, label: cycle.branch, timeoutMs }));
      }
      const baselineSelf = await step(() => evaluateSelf({ codeRoot: root, commit: cycle.base_commit, stateDir, rea, isolation: stableIsolation(), budget, timeoutMs }));
      const candidateSelf = await step(() => evaluateSelf({ codeRoot: cycle.worktree, commit: candidateRef.commit, stateDir, rea, isolation, budget, timeoutMs }));
      const ctx = {
        baseline,
        candidate,
        baselineTests,
        candidateTests,
        baselineSelf,
        candidateSelf,
        protectedChanged,
        proposal: cycle.proposal,
      };
      evaluation = { ...decide(ctx, acceptance), isolation, baselineTests, candidateTests, baseline, candidate, baseline_self_analysis: selfSummary(baselineSelf), candidate_self_analysis: selfSummary(candidateSelf) };
      // The candidate must not have changed while it was being evaluated.
      const after = await vm.candidateIdentity(root, cycle.base_commit, cycle.branch);
      const dirty = await vm.trackedChanges(cycle.worktree);
      if (after.commit !== candidateRef.commit || dirty.length) {
        evaluation = { ...evaluation, accepted: false, summary: `rejected: the candidate changed during evaluation (${after.commit !== candidateRef.commit ? 'branch moved' : `modified: ${dirty.slice(0, 5).join(', ')}`})` };
      }
    }
    interrupt.check();
    evaluation.candidate_ref = candidateRef;
    evaluation.changed_files = changed;
    evaluation.diffstat = changed.length ? await vm.diffStat(root, cycle.base_commit, cycle.branch) : '';

    // Accepted experiments are never merged here: they wait for a maintainer's
    // explicit `era improve approve`. The stable branch is untouched either way.
    // Inconclusive evaluations keep the worktree so they can be re-evaluated.
    cycle.status = evaluation.accepted ? 'awaiting-approval' : evaluation.inconclusive ? 'inconclusive' : 'rejected';
    if (!evaluation.inconclusive) await vm.removeWorktree(root, cycle.worktree);
    cycle.evaluation = evaluation;
    cycle.decided_at = new Date().toISOString();
    const dir = cycleDir(stateDir, cycleId);
    if (changed.length) writeText(join(dir, 'change.patch'), await vm.diffPatch(root, cycle.base_commit, candidateRef.commit));
    saveCycle(stateDir, cycle);
    writeText(join(dir, 'report.md'), renderCycleReport(cycle));
    appendLedger(stateDir, {
      type: 'cycle-decided',
      cycle_id: cycleId,
      finding_id: cycle.proposal.finding.id,
      accepted: evaluation.accepted,
      status: cycle.status,
      summary: evaluation.summary,
      branch: cycle.branch,
    });
    return cycle;
  } catch (err) {
    // Interrupted or failed evaluations record no decision; the cycle can be re-evaluated.
    const current = loadCycle(stateDir, cycleId);
    if (current.status === 'evaluating') {
      current.status = 'proposed';
      saveCycle(stateDir, current);
    }
    appendLedger(stateDir, err instanceof InterruptedError ? { type: 'cycle-interrupted', cycle_id: cycleId, signal: err.signal } : { type: 'cycle-evaluation-failed', cycle_id: cycleId, error: err.message });
    throw err;
  } finally {
    if (!guard) interrupt.dispose();
    release();
  }
}

// Merges the current stable HEAD into an experiment branch and re-captures the
// baseline REA self-analysis, so the experiment is evaluated (and approved)
// against the code it would actually be merged into. Earlier evaluations are kept.
export async function rebaseCycle({ root, config, rea, cycleId }) {
  assertNotCI();
  const stateDir = config.stateDirAbs;
  const cycle = loadCycle(stateDir, cycleId);
  if (!['proposed', 'awaiting-approval'].includes(cycle.status)) throw new Error(`Cycle ${cycleId} is ${cycle.status}; only proposed or awaiting-approval cycles can be rebased.`);
  await vm.assertStable(root);
  const head = await vm.headCommit(root);
  if (head === cycle.base_commit) return { cycle, changed: false };
  const release = acquireLock(stateDir, `rebase ${cycleId}`);
  try {
    if (!existsSync(cycle.worktree)) await vm.git(root, ['worktree', 'add', cycle.worktree, cycle.branch]);
    const merge = await vm.git(cycle.worktree, ['merge', '--no-ff', '-m', `experiment ${cycleId}: merge ${vm.STABLE_BRANCH} ${head.slice(0, 12)}`, head], { allowFail: true });
    if (merge.code !== 0) {
      await vm.git(cycle.worktree, ['merge', '--abort'], { allowFail: true });
      throw new Error(`Merging ${vm.STABLE_BRANCH} into ${cycle.branch} conflicts; resolve manually in ${cycle.worktree} or decline the cycle.\n${merge.stdout || merge.stderr}`);
    }
    const baselineSelf = await evaluateSelf({ codeRoot: root, commit: head, stateDir, rea, isolation: stableIsolation(), timeoutMs: effectiveLimits(config.limits, config.improvement).commandTimeoutMs });
    if (!baselineSelf.valid) throw new Error(`Baseline REA self-analysis is invalid: ${baselineSelf.invalid.reason}`);
    cycle.previous = [...(cycle.previous ?? []), { base_commit: cycle.base_commit, status: cycle.status, evaluation_summary: cycle.evaluation?.summary ?? null, decided_at: cycle.decided_at ?? null }];
    Object.assign(cycle, { base_commit: head, base_version: await vm.currentVersion(root), status: 'proposed', baseline_self_analysis: selfSummary(baselineSelf), evaluation: undefined, decided_at: undefined });
    saveCycle(stateDir, cycle);
    appendLedger(stateDir, { type: 'cycle-rebased', cycle_id: cycleId, from: cycle.previous.at(-1).base_commit, to: head });
    return { cycle, changed: true };
  } finally {
    release();
  }
}

export async function approveCycle({ root, config, cycleId, approver }) {
  assertNotCI();
  const stateDir = config.stateDirAbs;
  const cycle = loadCycle(stateDir, cycleId);
  if (cycle.status !== 'awaiting-approval') throw new Error(`Cycle ${cycleId} is ${cycle.status}; only cycles awaiting approval can be approved.`);
  await vm.assertStable(root);
  if ((await vm.headCommit(root)) !== cycle.base_commit) {
    throw new SafetyError(`The stable branch moved since ${cycleId} was evaluated; its evidence no longer describes the merge result. Run \`era improve rebase ${cycleId}\` and evaluate it again.`);
  }
  const release = acquireLock(stateDir, `approve ${cycleId}`);
  try {
    // Integrate exactly the evaluated candidate: same commit, tree and patch,
    // and still no protected-path change.
    const evaluated = cycle.evaluation?.candidate_ref;
    if (!evaluated?.commit) throw new SafetyError(`Cycle ${cycleId} has no recorded candidate commit; evaluate it again.`);
    const current = await vm.candidateIdentity(root, cycle.base_commit, cycle.branch);
    if (current.commit !== evaluated.commit || current.tree !== evaluated.tree || current.patch_sha256 !== evaluated.patch_sha256) {
      throw new SafetyError(`The experiment branch ${cycle.branch} changed after evaluation (evaluated ${evaluated.commit.slice(0, 12)}, now ${current.commit.slice(0, 12)}); unevaluated changes cannot be approved. Evaluate it again.`);
    }
    const protectedNow = protectedChanges(await vm.changedFiles(root, cycle.base_commit, evaluated.commit));
    if (protectedNow.length) throw new SafetyError(`Protected paths changed: ${protectedNow.join(', ')}.`);
    const tag = await vm.nextVersionTag(root);
    const merge = await vm.promote(root, evaluated.commit, `era: integrate ${cycleId} (${cycle.proposal.finding.id}) as ${tag}\n\nCandidate: ${evaluated.commit}\nApproved-by: ${approver}`);
    await vm.tagVersion(root, tag, `${tag}: ${cycle.proposal.hypothesis.slice(0, 200)}`);
    Object.assign(cycle, { status: 'integrated', version: tag, merge_commit: merge, approved_by: approver, approved_at: new Date().toISOString() });
    saveCycle(stateDir, cycle);
    writeText(join(cycleDir(stateDir, cycleId), 'report.md'), renderCycleReport(cycle));
    appendLedger(stateDir, { type: 'cycle-approved', cycle_id: cycleId, approver, version: tag, merge_commit: merge });
    return cycle;
  } finally {
    release();
  }
}

export async function declineCycle({ config, cycleId, approver, reason = 'declined by maintainer' }) {
  const cycle = loadCycle(config.stateDirAbs, cycleId);
  if (cycle.status !== 'awaiting-approval') throw new Error(`Cycle ${cycleId} is ${cycle.status}; only cycles awaiting approval can be declined.`);
  Object.assign(cycle, { status: 'declined', declined_by: approver, decline_reason: reason });
  saveCycle(config.stateDirAbs, cycle);
  appendLedger(config.stateDirAbs, { type: 'cycle-declined', cycle_id: cycleId, approver, reason });
  return cycle;
}

export async function abandonCycle({ root, config, cycleId, reason = 'abandoned by user' }) {
  const cycle = loadCycle(config.stateDirAbs, cycleId);
  if (!['proposed', 'inconclusive'].includes(cycle.status)) throw new Error(`Cycle ${cycleId} is already ${cycle.status}.`);
  await vm.removeWorktree(root, cycle.worktree);
  cycle.status = 'abandoned';
  cycle.abandon_reason = reason;
  saveCycle(config.stateDirAbs, cycle);
  appendLedger(config.stateDirAbs, { type: 'cycle-abandoned', cycle_id: cycleId, reason });
  return cycle;
}

// Restores a consistent state after a crash or kill -9: stale locks, cycles
// stuck in "evaluating", missing experiment worktrees and leftover benchmark
// worktrees.
export async function recoverState({ root, config }) {
  const stateDir = config.stateDirAbs;
  const actions = [];
  if (clearStaleLock(stateDir)) actions.push('removed stale improvement lock');
  await vm.git(root, ['worktree', 'prune'], { allowFail: true });
  const cyclesDir = join(stateDir, 'cycles');
  for (const id of existsSync(cyclesDir) ? readdirSync(cyclesDir) : []) {
    let cycle;
    try {
      cycle = loadCycle(stateDir, id);
    } catch {
      continue;
    }
    if (cycle.status === 'evaluating') {
      cycle.status = 'proposed';
      saveCycle(stateDir, cycle);
      appendLedger(stateDir, { type: 'cycle-recovered', cycle_id: id, from: 'evaluating' });
      actions.push(`${id}: evaluating -> proposed`);
    }
    if (cycle.status === 'proposed' && !existsSync(cycle.worktree)) {
      await vm.git(root, ['worktree', 'add', cycle.worktree, cycle.branch]);
      actions.push(`${id}: recreated worktree from ${cycle.branch}`);
    }
  }
  const benchDir = join(stateDir, 'bench-worktrees');
  for (const d of existsSync(benchDir) ? readdirSync(benchDir) : []) {
    await vm.removeWorktree(root, join(benchDir, d));
    actions.push(`removed leftover benchmark worktree ${d}`);
  }
  if (actions.length) appendLedger(stateDir, { type: 'state-recovered', actions });
  return actions;
}

const fmt = (v, digits = 4) => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(digits)) : String(v ?? '—'));

export function renderCycleReport(cycle) {
  const e = cycle.evaluation ?? {};
  const out = [`# ERA improvement cycle ${cycle.cycle_id}`, ''];
  out.push(`- Status: **${cycle.status}**${cycle.version ? ` → ${cycle.version}` : ''}${cycle.approved_by ? ` (approved by ${cycle.approved_by})` : ''}`);
  if (cycle.status === 'awaiting-approval') out.push(`- Review: \`git diff ${cycle.base_commit.slice(0, 12)}...${cycle.branch}\` or \`change.patch\`; then \`era improve approve ${cycle.cycle_id}\` or \`era improve decline ${cycle.cycle_id}\``);
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
