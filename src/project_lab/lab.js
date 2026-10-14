// ERA Project Lab: analyze, review, modify, repair, extend and reconstruct
// selected functionality of AUTHORIZED EXTERNAL software projects.
//
// This class is the single programmatic surface of Project Lab. The CLI
// (src/commands/project.js) is a thin layer over it, and a future ERA Studio
// can call it (or read its JSON state and JSONL ledger) without going through
// the CLI. It never touches ERA's own implementation: it only ever reads the
// original project, works in isolated copies, and writes to the original only on
// explicit approval of a verified, reviewable diff.
import { cpSync, existsSync, lstatSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createCodingAgent } from '../agents/coding-agents.js';
import { InterruptedError, createInterruptGuard } from '../orchestration/interrupt.js';
import { spentUsd } from '../orchestration/cycle.js';
import { SafetyError, acquireLock, assertNotCI, lockHolder } from '../safety/policy.js';
import { assertRemoteConsent, rolesOf } from '../agents/team.js';
import { nullLogger } from '../core/log.js';
import { RunContext, Pause } from './context.js';
import { preflight } from './preflight.js';
import { assertExternalPath, assertReady, normalizeProject } from './schema.js';
import { ProjectStore } from './store.js';
import { runModify } from './modify.js';
import { runRebuild } from './rebuild.js';
import { runReview } from './review.js';
import { renderRun } from './report.js';
import { applyPatch, fullManifest, manifestDiff, manifestSha256, removeWorkspace, treeDigest, workspaceChanges } from './workspace.js';

const FLOWS = { review: runReview, modify: runModify, rebuild: runRebuild };
const RESUMABLE = ['interrupted', 'failed', 'awaiting-implementation'];
const PLAN_WAIT = 'awaiting-plan';
const CANCELLABLE = ['running', 'interrupted', 'failed', 'awaiting-implementation', PLAN_WAIT, 'awaiting-approval', 'rejected'];

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
};

export class ProjectLab {
  constructor({ config, rea, log = nullLogger, createAgent = createCodingAgent }) {
    this.config = config;
    this.rea = rea;
    this.log = log;
    this.createAgent = createAgent;
    this.store = new ProjectStore(config.stateDirAbs);
  }

  // ---- project management
  create(input) {
    const merged = { ...input };
    if (this.store.exists(merged.id)) throw new Error(`Project "${merged.id}" already exists. Use \`era project show ${merged.id}\`, or choose another id.`);
    const project = normalizeProject({ agent: this.config.projectLab?.agent ?? null, ...merged }, { config: this.config });
    this.store.save(project);
    this.store.log(project.id, { type: 'project-created', mode: project.mode });
    this.log.info('project.created', { project_id: project.id, mode: project.mode });
    return project;
  }

  update(id, patch) {
    const existing = this.store.load(id);
    if (this.latestRunning(id)) throw new Error(`Project "${id}" has a running operation; wait for it or cancel it first.`);
    const project = normalizeProject({ ...patch, id }, { existing, config: this.config });
    this.store.save(project);
    return project;
  }

  list() {
    return this.store.list().map((p) => ({ id: p.id, mode: p.mode, status: p.status, source: p.source, reference: p.reference, destination: p.destination, approval: p.approval.status, updated_at: p.updated_at }));
  }

  get(id) {
    return this.store.load(id);
  }

  remove(id) {
    const project = this.store.load(id);
    if (this.latestRunning(id)) throw new Error(`Project "${id}" has a running operation.`);
    this.store.remove(project.id);
    return { removed: id };
  }

  latestRunning(id) {
    const holder = lockHolder(this.store.dir(id));
    if (!holder) return null;
    return this.store.latestRun(id, (r) => r.status === 'running');
  }

  status(id) {
    const project = this.store.load(id);
    const runs = this.store.listRuns(id);
    const latest = runs.at(-1) ?? null;
    const holder = lockHolder(this.store.dir(id));
    const events = this.store.events(id);
    const staleRunning = latest?.status === 'running' && !holder;
    return {
      project: { id: project.id, mode: project.mode, status: project.status, task: project.task, source: project.source, reference: project.reference, destination: project.destination, agent: project.agent ?? this.config.projectLab?.agent ?? 'manual', team: project.team, remote_consent: project.exposure?.remote_consent ?? [], approval: project.approval },
      running: !!holder,
      latest_run: latest && { run_id: latest.run_id, op: latest.op, status: staleRunning ? 'interrupted' : latest.status, current_step: latest.current_step ?? null, steps: Object.fromEntries(Object.entries(latest.steps).map(([k, v]) => [k, v.status])), attempts: latest.attempts, error: latest.error ?? null, pause_message: latest.pause_message ?? null, workspace: this.store.workDir(id, latest.run_id), updated_at: latest.updated_at },
      runs: runs.map((r) => ({ run_id: r.run_id, op: r.op, status: r.status === 'running' && !holder ? 'interrupted' : r.status, created_at: r.created_at })),
      spend: { agent_usd: spentUsd(events), limit_usd: project.limits.maxCostUsdTotal },
      next: this.nextAction(project, latest, staleRunning),
    };
  }

  nextAction(project, run, stale) {
    if (!run) return `era project ${project.mode} ${project.id}`;
    const status = stale ? 'interrupted' : run.status;
    const map = {
      running: 'wait for it to finish, or `era project cancel`',
      interrupted: `era project resume ${project.id}`,
      failed: `fix the problem shown by \`era project show ${project.id}\`, then \`era project resume ${project.id}\``,
      'awaiting-implementation': `edit the working copy, then \`era project resume ${project.id}\``,
      [PLAN_WAIT]: `read the plan, then \`era project resume ${project.id} --approve-plan\` (or cancel)`,
      'awaiting-approval': `review \`era project show ${project.id}\`, then \`era project approve ${project.id}\``,
      rejected: `\`era project show ${project.id}\` for the reasons; \`era project resume ${project.id}\` (manual edits) or \`era project cancel ${project.id}\``,
      complete: `era project show ${project.id}`,
      applied: `era project rollback ${project.id} to undo`,
    };
    return map[status] ?? null;
  }

  show(id, { runId = null } = {}) {
    const project = this.store.load(id);
    const run = runId ? this.store.loadRun(id, runId) : this.store.latestRun(id);
    if (!run) throw new Error(`Project "${id}" has no runs yet. Start one with \`era project ${project.mode} ${id}\`.`);
    return { project, run, report: renderRun(project, run) };
  }

  // ---- operations
  async review(id, opts = {}) {
    return this.start(id, 'review', opts);
  }

  async modify(id, opts = {}) {
    return this.start(id, 'modify', opts);
  }

  async rebuild(id, opts = {}) {
    return this.start(id, 'rebuild', opts);
  }

  async start(id, op, { trust = false, agent = null, allowRemote = [] } = {}) {
    assertNotCI();
    let project = this.store.load(id);
    if (agent) project = this.store.save({ ...project, agent, team: project.team ? { ...project.team, roles: { ...project.team.roles, implementer: agent } } : null });
    if (allowRemote.length) {
      // Consent is a recorded decision of the user, never inferred.
      project = this.update(id, { exposure: { remote_consent: [...new Set([...(project.exposure?.remote_consent ?? []), ...allowRemote])] } });
      this.store.log(id, { type: 'remote-consent', providers: allowRemote, at: new Date().toISOString() });
    }
    assertRemoteConsent(rolesOf(project), project.exposure?.remote_consent ?? [], this.config);
    // Re-validate paths at every start: the project may have moved since creation.
    for (const key of ['source', 'reference', 'destination']) if (project[key]) assertExternalPath(project[key], key);
    assertReady(project, op);
    if (project.source && !existsSync(project.source)) throw new Error(`The source path no longer exists: ${project.source}`);
    if (project.reference && !existsSync(project.reference)) throw new Error(`The reference path no longer exists: ${project.reference}`);
    const open = this.store.listRuns(id).filter((r) => ['running', 'awaiting-implementation', PLAN_WAIT, 'awaiting-approval'].includes(r.status) && !(r.status === 'running' && !lockHolder(this.store.dir(id))));
    if (open.length) throw new Error(`Project "${id}" already has an open run (${open[0].run_id}, ${open[0].status}). ${this.nextAction(project, open[0], false)}`);
    const run = this.store.newRun(project, op);
    run.agent = project.agent ?? this.config.projectLab?.agent ?? 'manual';
    run.team = project.team ? { preset: project.team.preset, roles: { ...project.team.roles } } : null;
    run.trust_project = trust;
    run.task = project.task;
    return this.execute(project, run);
  }

  async resume(id, { trust = false, approvePlan = false } = {}) {
    assertNotCI();
    const project = this.store.load(id);
    const holder = lockHolder(this.store.dir(id));
    const waiting = this.store.latestRun(id, (r) => r.status === PLAN_WAIT);
    if (waiting && !approvePlan) throw new Error(`Run ${waiting.run_id} is waiting for you to review its plan. Read it, then resume with --approve-plan (or cancel the run).`);
    const run = this.store.latestRun(id, (r) => RESUMABLE.includes(r.status) || (approvePlan && r.status === PLAN_WAIT) || (r.status === 'running' && !holder) || r.status === 'rejected');
    if (!run) throw new Error(`Project "${id}" has nothing to resume. ${this.nextAction(project, this.store.latestRun(id), false) ?? ''}`.trim());
    if (holder) throw new SafetyError(`Project "${id}" is busy (pid ${holder.pid}, ${holder.owner}).`);
    if (run.status === 'rejected' && this.runAgent(run) !== 'manual') throw new Error(`Run ${run.run_id} was rejected after ${run.attempts.length} attempt(s) by the configured agent. Review \`era project show ${id}\`, adjust the task or acceptance criteria, and start a new run.`);
    if (run.status === 'rejected') {
      // Manual mode: the human keeps editing the working copy.
      const last = run.attempts.at(-1)?.n ?? 1;
      for (const k of [`implement-${last}`, `verify-${last}`, 'finalize']) {
        delete run.steps[k];
        delete run.results[k];
      }
      run.attempts = run.attempts.filter((a) => a.n !== last);
    }
    run.trust_project = trust || run.trust_project;
    // Approving the plan is an explicit act, recorded; resuming never approves it implicitly.
    if (approvePlan && run.status === PLAN_WAIT) {
      run.plan_approved = { at: new Date().toISOString(), by: process.env.USER ?? 'unknown' };
      this.store.log(id, { type: 'plan-approved', run_id: run.run_id, by: run.plan_approved.by });
    }
    run.status = 'running';
    delete run.error;
    return this.execute(project, run);
  }

  // Everything that would block (or weaken) an operation, as a checklist. Read-only: nothing is started or changed.
  async preflight(id, op, { trust = false, studio = false, allowRemote = [] } = {}) {
    const stored = this.store.load(id);
    // Consent offered with this very request counts (it is recorded when the operation starts).
    const project = allowRemote.length ? { ...stored, exposure: { ...stored.exposure, remote_consent: [...new Set([...(stored.exposure?.remote_consent ?? []), ...allowRemote])] } } : stored;
    return preflight({ project, op, config: this.config, rea: this.rea, createAgent: this.createAgent, trust, studio });
  }

  // Preflight for a project that does not exist yet (or with edits not saved yet): what WOULD be checked if it were created.
  async preflightDraft(input, { existingId = null, op, trust = false, studio = false, allowRemote = [] } = {}) {
    let project;
    try {
      const existing = existingId ? this.store.load(existingId) : null;
      project = normalizeProject({ ...input, id: existingId ?? input.id ?? 'draft' }, { existing, config: this.config });
    } catch (err) {
      return { op, ok: false, screenshot: false, checks: [{ id: 'config', label: 'Configuration', status: 'fail', message: err.message, fix: 'Correct the value named in the message.' }], blockers: [err.message], warnings: [] };
    }
    if (allowRemote.length) project = { ...project, exposure: { ...project.exposure, remote_consent: [...new Set([...(project.exposure?.remote_consent ?? []), ...allowRemote])] } };
    return preflight({ project, op, config: this.config, rea: this.rea, createAgent: this.createAgent, trust, studio });
  }

  runAgent(run) {
    return run.agent ?? 'manual';
  }

  async execute(project, run) {
    const dir = this.store.dir(project.id);
    const release = acquireLock(dir, `${run.op} ${run.run_id}`);
    const guard = createInterruptGuard();
    const c = new RunContext({ lab: this, project, run, guard });
    run.pid = process.pid;
    run.status = 'running';
    c.save();
    project.status = 'running';
    this.store.save(project);
    this.store.log(project.id, { type: 'run-started', run_id: run.run_id, op: run.op, agent: run.agent });
    this.log.info('project.run.start', { project_id: project.id, run_id: run.run_id, op: run.op });
    try {
      await FLOWS[run.op](c);
      if (run.op === 'review') run.status = 'complete';
      else run.status = run.results.finalize?.pass ? 'awaiting-approval' : 'rejected';
      delete run.pause_message;
    } catch (err) {
      if (err instanceof Pause) {
        run.status = err.status;
        run.pause_message = err.message;
      } else if (err instanceof InterruptedError) {
        run.status = existsSync(join(c.runDir, 'cancel.flag')) ? 'cancelled' : 'interrupted';
      } else {
        run.status = 'failed';
        run.error = err.message;
        this.log.error('project.run.error', { project_id: project.id, run_id: run.run_id, error: err.message, error_name: err.name });
      }
    } finally {
      this.checkIntegrity(project, run, c);
      if (run.status === 'cancelled') {
        removeWorkspace(c.workspace);
        c.dropSnapshots();
      }
      try {
        writeFileSync(join(c.runDir, 'report.md'), renderRun(project, run));
      } catch {
        // the report is a convenience; run.json is authoritative
      }
      project.status = run.status;
      project.approval = run.status === 'awaiting-approval' ? { status: 'pending', by: null, at: null } : project.approval.status === 'pending' ? { status: 'none', by: null, at: null } : project.approval;
      this.store.save(project);
      c.save();
      this.store.log(project.id, { type: 'run-finished', run_id: run.run_id, op: run.op, status: run.status });
      this.log.info('project.run.end', { project_id: project.id, run_id: run.run_id, status: run.status, attempts: run.attempts.length });
      guard.dispose();
      release();
    }
    return { project, run, report: renderRun(project, run) };
  }

  // The original project must be byte-identical to when the run began.
  checkIntegrity(project, run, c) {
    if (!project.source || !run.source_digest) return;
    const now = treeDigest(project.source).sha256;
    if (now === run.source_digest) return;
    run.isolation_violation = { expected: run.source_digest, actual: now, at: new Date().toISOString() };
    run.status = 'failed';
    run.error = 'ISOLATION VIOLATION: the original project changed while this run was in progress. ERA itself writes nothing to it, so something else did (a coding agent writing outside its working copy, a project command, or a concurrent edit). The run was stopped and nothing will be applied.';
    this.store.log(project.id, { type: 'isolation-violation', run_id: run.run_id });
    this.log.error('project.isolation_violation', { project_id: project.id, run_id: run.run_id });
    c.save();
  }

  // ---- cancel
  async cancel(id) {
    const project = this.store.load(id);
    const run = this.store.latestRun(id, (r) => CANCELLABLE.includes(r.status));
    if (!run) throw new Error(`Project "${id}" has no run to cancel.`);
    const dir = this.store.runDir(id, run.run_id);
    const holder = lockHolder(this.store.dir(id));
    if (run.status === 'running' && holder) {
      writeFileSync(join(dir, 'cancel.flag'), new Date().toISOString());
      try {
        process.kill(holder.pid, 'SIGTERM');
      } catch {
        // already gone
      }
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 250));
        if (!lockHolder(this.store.dir(id))) break;
      }
      if (lockHolder(this.store.dir(id)) && alive(holder.pid)) {
        try {
          process.kill(holder.pid, 'SIGKILL');
        } catch {
          // already gone
        }
      }
    }
    const fresh = this.store.loadRun(id, run.run_id);
    fresh.status = 'cancelled';
    fresh.cancelled_at = new Date().toISOString();
    this.store.saveRun(fresh);
    removeWorkspace(this.store.workDir(id, run.run_id));
    for (const extra of ['.tmp', '.roles', '.roles.tmp']) rmSync(this.store.workDir(id, run.run_id) + extra, { recursive: true, force: true });
    project.status = 'cancelled';
    project.approval = project.approval.status === 'pending' ? { status: 'withdrawn', by: null, at: new Date().toISOString() } : project.approval;
    this.store.save(project);
    this.store.log(id, { type: 'run-cancelled', run_id: run.run_id });
    return { run_id: run.run_id, status: 'cancelled' };
  }

  // ---- approval and rollback
  async approve(id, { by = 'unknown', runId = null } = {}) {
    assertNotCI();
    const project = this.store.load(id);
    const run = runId ? this.store.loadRun(id, runId) : this.store.latestRun(id, (r) => r.status === 'awaiting-approval');
    if (!run) throw new Error(`Project "${id}" has no run awaiting approval. ${this.nextAction(project, this.store.latestRun(id), false) ?? ''}`.trim());
    if (run.status !== 'awaiting-approval') throw new Error(`Run ${run.run_id} is ${run.status}; only runs awaiting approval can be approved.`);
    if (run.op === 'review') throw new Error('Review runs change nothing and need no approval.');
    const release = acquireLock(this.store.dir(id), `approve ${run.run_id}`);
    try {
      const fin = run.results.finalize;
      if (!fin?.pass) throw new SafetyError(`Run ${run.run_id} did not pass verification; it cannot be approved.`);
      const workspace = this.store.workDir(id, run.run_id);
      if (!existsSync(workspace)) throw new Error('The working copy no longer exists; run the operation again.');
      // Approve exactly what was verified: the working copy must still produce the evaluated diff.
      const now = await workspaceChanges(workspace, fin.baseline_commit);
      const { createHash } = await import('node:crypto');
      if (createHash('sha256').update(now.patch).digest('hex') !== fin.patch_sha256) throw new SafetyError('The working copy changed after verification, so the verified diff is no longer what would be applied. Run `era project resume` to verify again.');
      let applied;
      if (run.op === 'modify') applied = await this.applyModify(project, run, fin);
      else applied = this.applyRebuild(project, run, workspace);
      run.status = 'applied';
      run.applied = { ...applied, by, at: new Date().toISOString() };
      this.store.saveRun(run);
      project.approval = { status: 'approved', by, at: run.applied.at };
      project.status = 'applied';
      this.store.save(project);
      this.store.log(id, { type: 'project-approved', run_id: run.run_id, by, op: run.op });
      this.log.info('project.approved', { project_id: id, run_id: run.run_id, by });
      return { run_id: run.run_id, op: run.op, applied: run.applied };
    } finally {
      release();
    }
  }

  async applyModify(project, run, fin) {
    const before = treeDigest(project.source).sha256;
    if (before !== run.source_digest) throw new SafetyError('The original project changed since this run started, so the verified diff may no longer apply cleanly or mean the same thing. Re-run `era project modify` against the current project.');
    const check = await applyPatch(project.source, fin.patch_file, { check: true });
    if (check.code !== 0) throw new Error(`The diff does not apply cleanly to the original project: ${check.stderr.trim().slice(0, 300)}`);
    const r = await applyPatch(project.source, fin.patch_file);
    if (r.code !== 0) throw new Error(`Applying the diff failed: ${r.stderr.trim().slice(0, 300)}`);
    return { kind: 'patch', patch_file: fin.patch_file, files: fin.files.map((f) => f.path), source_digest_before: before, source_digest_after: treeDigest(project.source).sha256 };
  }

  applyRebuild(project, run, workspace) {
    const dest = assertExternalPath(project.destination, 'destination');
    if (existsSync(dest) && readdirSync(dest).length > 0) throw new SafetyError(`The destination is no longer empty: ${dest}. Choose an empty destination.`);
    cpSync(workspace, dest, { recursive: true, filter: (p) => basename(p) !== '.git' && !lstatSync(p).isSymbolicLink() });
    // Record exactly what was written, nothing excluded: rollback may delete only a destination that still matches it.
    const manifest = fullManifest(dest);
    const manifestFile = join(this.store.runDir(project.id, run.run_id), 'destination-manifest.json');
    writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    return { kind: 'directory', destination: dest, destination_digest: treeDigest(dest).sha256, files: treeDigest(dest).files, manifest_file: manifestFile, manifest_sha256: manifestSha256(manifest), manifest_entries: manifest.length };
  }

  // Throws unless the destination is byte-for-byte what approval wrote: no file added, removed or changed anywhere,
  // including .git, build, dist and node_modules (later work lives there too).
  assertDestinationUnchanged(dest, applied) {
    const names = (d) => [...d.added.map((p) => `added ${p}`), ...d.removed.map((p) => `removed ${p}`), ...d.modified.map((p) => `modified ${p}`)];
    const refuse = (detail) => new Error(`The destination was modified after it was generated; refusing to delete it (${detail}). Remove it manually if you are sure.`);
    if (!existsSync(dest)) throw refuse('it no longer exists');
    if (!applied.manifest_file || !existsSync(applied.manifest_file)) {
      // Runs approved before the manifest existed: the old digest skips .git/build/dist/node_modules, so it can only be
      // trusted when none of those directories has any content that could belong to later work.
      if (treeDigest(dest).sha256 !== applied.destination_digest) throw refuse('its contents changed');
      const hidden = fullManifest(dest).filter((e) => /(^|\/)(\.git|build|dist|node_modules|\.era|coverage|target)(\/|$)/.test(e.path));
      if (hidden.length) throw refuse(`this run has no complete manifest and the destination contains ${hidden.slice(0, 5).map((e) => e.path).join(', ')}`);
      return;
    }
    const raw = readFileSync(applied.manifest_file, 'utf8');
    const expected = JSON.parse(raw);
    if (manifestSha256(expected) !== applied.manifest_sha256) throw refuse('the recorded manifest was altered');
    const diff = manifestDiff(expected, fullManifest(dest));
    if (!diff.same) throw refuse(names(diff).slice(0, 10).join(', ') + (names(diff).length > 10 ? ', …' : ''));
  }

  async rollback(id) {
    const project = this.store.load(id);
    const run = this.store.latestRun(id, (r) => r.status === 'applied');
    if (!run) throw new Error(`Project "${id}" has no applied change to roll back.`);
    const release = acquireLock(this.store.dir(id), `rollback ${run.run_id}`);
    try {
      if (run.op === 'modify') {
        const patch = run.applied.patch_file;
        const check = await applyPatch(project.source, patch, { reverse: true, check: true });
        if (check.code !== 0) throw new Error(`The change cannot be reversed cleanly (files were edited since it was applied): ${check.stderr.trim().slice(0, 300)}`);
        const r = await applyPatch(project.source, patch, { reverse: true });
        if (r.code !== 0) throw new Error(`Reversing the change failed: ${r.stderr.trim().slice(0, 300)}`);
        run.rollback = { at: new Date().toISOString(), source_digest: treeDigest(project.source).sha256, restored: treeDigest(project.source).sha256 === run.applied.source_digest_before };
      } else {
        const dest = project.destination;
        this.assertDestinationUnchanged(dest, run.applied);
        rmSync(dest, { recursive: true, force: true });
        run.rollback = { at: new Date().toISOString(), removed: dest, restored: true };
      }
      run.status = 'rolled-back';
      this.store.saveRun(run);
      project.status = 'rolled-back';
      project.approval = { status: 'none', by: null, at: null };
      this.store.save(project);
      this.store.log(id, { type: 'project-rolled-back', run_id: run.run_id });
      return { run_id: run.run_id, op: run.op, restored: run.rollback.restored };
    } finally {
      release();
    }
  }
}

export function createProjectLab(deps) {
  return new ProjectLab(deps);
}
