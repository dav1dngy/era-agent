// Improvement Lab for the control plane. The lab's logic is not re-implemented: state is read from its own
// files (cycles, ledger, versions) and every action is the existing `era improve …` / `era rollback` command
// run as a job. Approval keeps the lab's own binding to the evaluated commit/tree/patch.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readLedger } from '../../orchestration/ledger.js';
import { listSelfAnalyses } from '../../self_analysis/self-analyze.js';
import { loadCycle, renderCycleReport } from '../../orchestration/cycle.js';
import * as vm from '../../orchestration/versions.js';
import { agentCapabilities } from '../../agents/coding-agents.js';
import { bad, conflict, denied, missing } from '../errors.js';

const CYCLE_ID = /^cycle-[0-9T]+-[0-9a-f]+$/;
const VERSION = /^era-v[0-9]+$/;

export function improvementService(ctx) {
  const { jobs, audit, settings } = ctx;
  const stateDir = () => ctx.config.stateDirAbs;

  // The ERA checkout the lab works on: configured, or the checkout this Studio runs from.
  async function checkout() {
    const configured = settings().workspaces.improvementCheckout;
    const candidates = [configured, ctx.config.cwd].filter(Boolean).map((p) => resolve(p));
    for (const dir of candidates) {
      try {
        const root = await vm.repoRoot(dir);
        if (!root || resolve(root) !== dir) continue;
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
        if (pkg.name === 'era-agent') return { available: true, root: dir, branch: await vm.currentBranch(dir), clean: await vm.isClean(dir), reason: null };
      } catch {
        // try the next candidate
      }
    }
    return { available: false, root: null, branch: null, clean: null, reason: 'No ERA git checkout is configured. Set Settings → Workspaces → ERA checkout to a clone of the repository (the Improvement Lab changes ERA itself and needs one).' };
  }

  const cycleSummary = (c) => ({ cycle_id: c.cycle_id, status: c.status, title: c.proposal?.finding?.title ?? null, hypothesis: c.proposal?.hypothesis ?? null, area: c.proposal?.area ?? null, created_at: c.created_at ?? null, summary: c.evaluation?.summary ?? null, accepted: c.evaluation?.accepted ?? null, version: c.version ?? null, branch: c.branch, agent: c.implementation?.agent ?? null });

  function cycles() {
    const dir = join(stateDir(), 'cycles');
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((n) => CYCLE_ID.test(n)).sort().reverse().map((n) => {
      try {
        return cycleSummary(loadCycle(stateDir(), n));
      } catch {
        return null;
      }
    }).filter(Boolean);
  }

  async function overview() {
    const co = await checkout();
    const versions = co.available ? await vm.listVersions(co.root) : [];
    const events = readLedger(stateDir());
    const rollbacks = events.filter((e) => e.type === 'rollback');
    const list = cycles();
    return { checkout: co, current_version: co.available ? await vm.currentVersion(co.root) : null, versions, cycles: list, awaiting_approval: list.filter((c) => c.status === 'awaiting-approval'), self_analyses: listSelfAnalyses(stateDir()).slice(0, 20), rollbacks, ledger: events.slice(-100), limits: { maxCycles: ctx.config.improvement?.maxCycles ?? ctx.config.limits?.maxCycles ?? null } };
  }

  function cycle(id) {
    if (!CYCLE_ID.test(id)) throw bad('Invalid cycle id.');
    let c;
    try {
      c = loadCycle(stateDir(), id);
    } catch {
      throw missing(`Unknown cycle "${id}".`);
    }
    const patchFile = join(stateDir(), 'cycles', id, 'change.patch');
    return { cycle: c, summary: cycleSummary(c), report: renderCycleReport(c), patch: existsSync(patchFile) ? readFileSync(patchFile, 'utf8') : '', candidate_ref: c.evaluation?.candidate_ref ?? null, benchmark: c.evaluation?.comparison ?? c.evaluation?.benchmark ?? null, guards: c.evaluation?.guards ?? [] };
  }

  async function start(kind, label, args) {
    const co = await checkout();
    if (!co.available) throw conflict(co.reason);
    const job = jobs.start({ kind: `improve.${kind}`, label, args, cwd: co.root });
    audit.record(`improvement.${kind}`, { job_id: job.id, args });
    return job;
  }

  const user = () => process.env.USER ?? 'unknown';

  return {
    overview,
    cycles,
    cycle,
    checkout,
    selfAnalyze: () => start('self-analyze', 'self-analysis', ['self-analyze', '--json']),
    propose: (body = {}) => start('propose', 'propose experiment', ['improve', 'propose', ...(body.finding ? ['--finding', String(body.finding)] : [])]),
    async implement(id, body = {}) {
      if (!CYCLE_ID.test(id)) throw bad('Invalid cycle id.');
      const agent = String(body.agent ?? '');
      if (!/^[a-z0-9][a-z0-9:_-]{0,40}$/.test(agent) || agent === 'manual') throw bad('Choose an automated coding agent.');
      let caps;
      try {
        caps = agentCapabilities(agent, ctx.config);
      } catch (err) {
        throw bad(err.message);
      }
      // The lab sends ERA's own source to the agent. For a remote provider that is a transmission the user must confirm.
      if (caps.remote && body.confirm_remote !== true) throw denied(`${agent} sends ERA's source code to a remote service. Confirm the transmission explicitly (confirm_remote).`);
      return start('implement', `implement ${id}`, ['improve', 'implement', id, '--agent', agent]);
    },
    evaluate(id, body = {}) {
      if (!CYCLE_ID.test(id)) throw bad('Invalid cycle id.');
      return start('evaluate', `evaluate ${id}`, ['improve', 'evaluate', id, ...(body.repetitions ? ['--repetitions', String(Number(body.repetitions))] : [])]);
    },
    rebase: (id) => (CYCLE_ID.test(id) ? start('rebase', `rebase ${id}`, ['improve', 'rebase', id]) : Promise.reject(bad('Invalid cycle id.'))),
    cancel: (id) => (CYCLE_ID.test(id) ? start('cancel', `cancel ${id}`, ['improve', 'cancel', id]) : Promise.reject(bad('Invalid cycle id.'))),
    decline: (id, body = {}) => (CYCLE_ID.test(id) ? start('decline', `decline ${id}`, ['improve', 'decline', id, '--yes', '--by', `ERA Studio (${user()})`, '--reason', String(body.reason ?? 'declined in ERA Studio').slice(0, 300)]) : Promise.reject(bad('Invalid cycle id.'))),
    // Integration into the stable branch: explicit confirmation AND the exact evaluated candidate.
    async approve(id, body = {}) {
      if (!CYCLE_ID.test(id)) throw bad('Invalid cycle id.');
      if (body.confirm !== true) throw bad('Approval needs "confirm": true.');
      const c = cycle(id);
      if (c.cycle.status !== 'awaiting-approval') throw conflict(`Cycle ${id} is ${c.cycle.status}; only cycles awaiting approval can be approved.`);
      const ref = c.candidate_ref;
      if (!ref || body.candidate_commit !== ref.commit || body.patch_sha256 !== ref.patch_sha256) throw conflict('The approval does not match the evaluated candidate (commit or patch hash differs). Reload the experiment and approve again.');
      audit.record('improvement.approval_requested', { cycle_id: id, candidate: ref.commit, patch_sha256: ref.patch_sha256 });
      return start('approve', `approve ${id}`, ['improve', 'approve', id, '--yes', '--by', `ERA Studio (${user()})`]);
    },
    async rollback(body = {}) {
      if (body.confirm !== true) throw bad('Rollback needs "confirm": true.');
      if (!VERSION.test(String(body.version ?? ''))) throw bad('version must look like era-v3.');
      return start('rollback', `rollback to ${body.version}`, ['rollback', body.version]);
    },
  };
}
