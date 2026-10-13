// Projects and Project Lab (review / modify / rebuild) for the control plane. All behavior comes from
// ProjectLab and the CLI; this file validates requests, enforces Studio permissions and shapes responses.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { SafetyError } from '../../safety/policy.js';
import { assertRemoteConsent, rolesOf } from '../../agents/team.js';
import { protectedViolations } from '../../project_lab/workspace.js';
import { assertExternalPath, assertReady } from '../../project_lab/schema.js';
import { insideAllowedRoots } from '../settings.js';
import { HttpError, bad, conflict, denied, missing } from '../errors.js';
import { PathError, listDir, readText, resolveInside } from '../paths.js';

const OPS = ['review', 'modify', 'rebuild'];
const FILE_STATUS = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed' };

export function projectsService(ctx) {
  const { lab, jobs, audit, bus } = ctx;
  const user = () => process.env.USER ?? 'unknown';

  const loadProject = (id) => {
    try {
      const project = lab.get(id);
      for (const key of ['source', 'reference', 'destination']) {
        if (project[key] && !insideAllowedRoots(project[key], ctx.settings())) throw denied(`${key} is outside the allowed workspace roots.`);
      }
      return project;
    } catch (err) {
      if (err.status === 403) throw err;
      throw missing(`Unknown project "${id}".`);
    }
  };

  // Project data safe to show: paths are the user's own, nothing secret is stored in a project.
  const view = (p) => ({ id: p.id, mode: p.mode, status: p.status, task: p.task, source: p.source, reference: p.reference, destination: p.destination, agent: p.agent, team: p.team, exposure: p.exposure, commands: p.commands, acceptance: p.acceptance, protected: p.protected, limits: p.limits, authorization: p.authorization, approval: p.approval, created_at: p.created_at, updated_at: p.updated_at });

  const runSummary = (r) => r && { run_id: r.run_id, op: r.op, status: r.status, current_step: r.current_step ?? null, steps: Object.fromEntries(Object.entries(r.steps ?? {}).map(([k, v]) => [k, { status: v.status, started_at: v.started_at ?? null, finished_at: v.finished_at ?? null, duration_ms: v.duration_ms ?? null }])), attempts: r.attempts ?? [], error: r.error ?? null, pause_message: r.pause_message ?? null, team: r.team ?? null, created_at: r.created_at, updated_at: r.updated_at };

  function status(id) {
    const s = lab.status(id);
    const project = loadProject(id);
    const job = jobs.active(id);
    // lab.status corrects the status of runs whose process died (running → interrupted); keep that, with full step records.
    const fixed = new Map(s.runs.map((r) => [r.run_id, r.status]));
    const runs = lab.store.listRuns(id).map((r) => ({ ...runSummary(r), status: fixed.get(r.run_id) ?? r.status }));
    const latest = runs.at(-1) ?? null;
    return { project: view(project), running: s.running, active_job: job ? jobs.summary(job) : null, latest_run: latest && { ...latest, workspace: s.latest_run?.workspace ?? null }, runs, spend: s.spend, next: s.next };
  }

  function list() {
    return lab.list().map((p) => {
      const job = jobs.active(p.id);
      const latest = lab.store.latestRun(p.id);
      const full = loadProject(p.id);
      return { ...p, task: full.task, agent: full.agent, team: full.team, active_job: job ? jobs.summary(job) : null, latest_run: runSummary(latest) };
    });
  }

  function create(input) {
    if (!input || typeof input !== 'object') throw bad('Project definition must be an object.');
    const settings = ctx.settings();
    if (!input.id) {
      const base = basename(input.source || input.destination || input.reference || 'project').toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 45) || 'project';
      let id = base;
      let n = 2;
      while (lab.store.exists(id)) id = `${base}-${n++}`;
      input = { ...input, id };
    }
    for (const key of ['source', 'reference', 'destination']) {
      if (input[key] && !insideAllowedRoots(input[key], settings)) throw denied(`${key} is outside the allowed workspace roots (Settings → Workspaces).`);
    }
    const limits = { commandTimeoutMs: settings.execution.commandTimeoutMs, agentTimeoutMs: settings.execution.agentTimeoutMs, maxAttempts: settings.execution.maxAttempts, maxCostUsd: settings.execution.maxCostUsd, maxCostUsdTotal: settings.execution.maxCostUsdTotal, ...(input.limits ?? {}) };
    // A source folder named by a browser is only ever a path on this machine that the user chose; ERA's own tree is refused by the schema.
    let project;
    try {
      project = lab.create({ ...input, limits, ...(input.exposure ? {} : { exposure: { remote_consent: [] } }) });
    } catch (err) {
      if (err instanceof SafetyError) throw denied(err.message);
      throw bad(err.message);
    }
    audit.record('project.created', { project_id: project.id, mode: project.mode, source: project.source });
    bus.publish('project.updated', { project_id: project.id });
    return view(project);
  }

  function update(id, patch) {
    loadProject(id);
    for (const key of ['source', 'reference', 'destination']) {
      if (patch[key] && !insideAllowedRoots(patch[key], ctx.settings())) throw denied(`${key} is outside the allowed workspace roots.`);
    }
    try {
      const p = lab.update(id, patch);
      audit.record('project.updated', { project_id: id, keys: Object.keys(patch) });
      bus.publish('project.updated', { project_id: id });
      return view(p);
    } catch (err) {
      throw err instanceof SafetyError ? denied(err.message) : bad(err.message);
    }
  }

  function remove(id) {
    loadProject(id);
    if (jobs.active(id)) throw conflict('The project has an active job.');
    try {
      lab.remove(id);
    } catch (err) {
      throw conflict(err.message);
    }
    audit.record('project.removed', { project_id: id });
    bus.publish('project.updated', { project_id: id });
    return { removed: id };
  }

  // Starts review|modify|rebuild|resume as a supervised CLI job.
  function startOp(id, op, opts = {}) {
    const project = loadProject(id);
    const settings = ctx.settings();
    if (![...OPS, 'resume'].includes(op)) throw bad(`Unknown operation "${op}".`);
    if (op !== 'resume') {
      try {
        assertReady(project, op);
      } catch (err) {
        throw bad(err.message);
      }
    }
    // Remote providers need the consent stored on the project (given explicitly in the UI), checked before a job exists.
    const consent = [...new Set([...(project.exposure?.remote_consent ?? []), ...(Array.isArray(opts.allow_remote) ? opts.allow_remote : [])])];
    try {
      assertRemoteConsent(rolesOf(project), consent, ctx.config);
    } catch (err) {
      throw denied(err.message);
    }
    if (opts.trust && !settings.permissions.trustedExecution) throw denied('Running project commands outside the sandbox needs Settings → Permissions → Trusted execution.');
    const args = ['project', op, id, '--json'];
    if (Array.isArray(opts.allow_remote) && opts.allow_remote.length) args.push('--allow-remote', opts.allow_remote.join(','));
    if (opts.trust) args.push('--trust-project');
    if (opts.agent) args.push('--agent', String(opts.agent));
    let job;
    try {
      job = jobs.start({ kind: `project.${op}`, label: `${op} ${id}`, project_id: id, args, poll: () => slimStatus(id), cancel: () => lab.cancel(id).then(() => undefined) });
    } catch (err) {
      if (err.status === 409) throw conflict(err.message);
      throw err;
    }
    audit.record('project.operation', { project_id: id, op, job_id: job.id, remote: consent });
    return job;
  }

  const slimStatus = (id) => {
    const s = lab.status(id);
    return { status: s.latest_run?.status ?? null, step: s.latest_run?.current_step ?? null, steps: s.latest_run?.steps ?? {}, attempts: s.latest_run?.attempts?.length ?? 0 };
  };

  async function cancel(id) {
    loadProject(id);
    const job = jobs.active(id);
    if (job) return jobs.cancel(job.id);
    try {
      const r = await lab.cancel(id);
      audit.record('project.cancelled', { project_id: id, run_id: r.run_id });
      bus.publish('project.updated', { project_id: id });
      return r;
    } catch (err) {
      throw bad(err.message);
    }
  }

  function runDetail(id, runId = null) {
    loadProject(id);
    let shown;
    try {
      shown = lab.show(id, { runId });
    } catch (err) {
      throw missing(err.message);
    }
    const { run } = shown;
    const fin = run.results?.finalize ?? null;
    const events = lab.store.events(id).filter((e) => e.run_id === run.run_id || e.cycle_id === run.run_id);
    return {
      run: { ...runSummary(run), results: slimResults(run.results ?? {}), handoffs: run.handoffs ?? [], exposure: run.exposure ?? null, source_digest: run.source_digest ?? null, applied: run.applied ?? null, rollback: run.rollback ?? null },
      report: shown.report,
      finalize: fin && { pass: fin.pass, reasons: fin.reasons, warnings: fin.warnings, files: fin.files, stat: fin.stat, patch_sha256: fin.patch_sha256, attempts: fin.attempts, team: fin.team ?? null, review: fin.review ?? null, verification: fin.verification ?? null, behaviors: fin.behaviors ?? null },
      events,
    };
  }

  // Large command outputs stay out of the list payloads; the report carries what a human needs.
  const slimResults = (results) => {
    const out = {};
    for (const [k, v] of Object.entries(results)) {
      if (k === 'findings') out[k] = v;
      else if (k === 'architecture') out[k] = { agent: v.agent, parsed: v.parsed, cost_usd: v.cost_usd, duration_ms: v.duration_ms, summary: v.design?.summary ?? '', files: v.design?.files ?? [] };
      else if (['baseline', 'finalize', 'analysis', 'plan'].includes(k) || /^(implement|verify|review|correct|reverify)-/.test(k)) out[k] = '(see detail endpoints)';
      else out[k] = v;
    }
    return out;
  };

  function patchText(id, runId) {
    const d = lab.show(id, { runId });
    const fin = d.run.results?.finalize;
    if (!fin?.patch_file || !existsSync(fin.patch_file)) return { patch: '', sha256: fin?.patch_sha256 ?? null };
    return { patch: readFileSync(fin.patch_file, 'utf8'), sha256: fin.patch_sha256 };
  }

  // Original vs modified text for one changed file (Monaco diff editor).
  function fileDiff(id, runId, path) {
    const project = loadProject(id);
    const run = lab.show(id, { runId }).run;
    const fin = run.results?.finalize;
    const entry = fin?.files?.find((f) => f.path === path);
    if (!entry) throw missing('That file is not part of the change.');
    const read = (root, rel) => {
      try {
        const t = readText(root, rel);
        return t.binary ? '(binary file)' : t.content;
      } catch (err) {
        if (err instanceof PathError && err.status === 404) return '';
        throw err;
      }
    };
    const workspace = lab.store.workDir(id, run.run_id);
    const root = run.op === 'modify' ? project.source : null;
    return { path, status: FILE_STATUS[entry.status] ?? entry.status, original: root ? read(root, path) : '', modified: existsSync(workspace) ? read(workspace, path) : '(working copy no longer exists)' };
  }

  async function approve(id, body = {}) {
    const project = loadProject(id);
    if (body.confirm !== true) throw bad('Approval needs "confirm": true (an explicit user decision).');
    const run = lab.store.latestRun(id, (r) => r.status === 'awaiting-approval');
    if (!run) throw conflict('No run is awaiting approval.');
    if (body.run_id && body.run_id !== run.run_id) throw conflict(`Run ${body.run_id} is not the run awaiting approval (${run.run_id}).`);
    const fin = run.results?.finalize;
    if (!fin?.pass) throw conflict('This run did not pass verification and cannot be approved.');
    // The approval is for ONE evaluated artifact: the SHA-256 the user saw must be the one verified now.
    if (body.patch_sha256 !== fin.patch_sha256) throw conflict('The approval does not match the evaluated change (artifact hash differs). Reload the review and approve again.');
    try {
      const done = await lab.approve(id, { by: `ERA Studio (${user()})`, runId: run.run_id });
      audit.record('project.approved', { project_id: id, run_id: run.run_id, patch_sha256: fin.patch_sha256, op: run.op, target: run.op === 'modify' ? project.source : project.destination });
      bus.publish('project.updated', { project_id: id });
      return done;
    } catch (err) {
      audit.record('project.approval_refused', { project_id: id, run_id: run.run_id, reason: err.message });
      throw err instanceof SafetyError ? conflict(err.message) : bad(err.message);
    }
  }

  async function reject(id, body = {}) {
    loadProject(id);
    if (body.confirm !== true) throw bad('Rejecting needs "confirm": true.');
    const r = await cancel(id);
    audit.record('project.rejected', { project_id: id, reason: body.reason ?? null });
    return r;
  }

  async function rollback(id, body = {}) {
    loadProject(id);
    if (body.confirm !== true) throw bad('Rollback needs "confirm": true.');
    try {
      const r = await lab.rollback(id);
      audit.record('project.rolled_back', { project_id: id, run_id: r.run_id });
      bus.publish('project.updated', { project_id: id });
      return r;
    } catch (err) {
      throw conflict(err.message);
    }
  }

  // ---- workbench file access (roots: source, reference, destination, working copy of a run)
  function rootFor(id, which, runId = null) {
    const project = loadProject(id);
    if (which === 'workspace') {
      const run = runId ? lab.store.loadRun(id, runId) : lab.store.latestRun(id);
      if (!run) throw missing('No run yet.');
      const dir = lab.store.workDir(id, run.run_id);
      if (!existsSync(dir)) throw missing('The working copy of that run no longer exists.');
      return { root: dir, editable: ['awaiting-implementation', 'awaiting-approval', 'rejected', 'failed', 'interrupted'].includes(run.status), kind: 'workspace', run_id: run.run_id };
    }
    const root = project[which];
    if (!['source', 'reference', 'destination'].includes(which) || !root || !existsSync(root)) throw missing(`This project has no ${which} directory.`);
    return { root, editable: which === 'source' && ctx.settings().permissions.directEdit, kind: which };
  }

  function tree(id, which, rel = '', runId = null) {
    const r = rootFor(id, which, runId);
    try {
      return { root: which, editable: r.editable, path: rel, entries: listDir(r.root, rel) };
    } catch (err) {
      throw err instanceof PathError ? new HttpError(err.status, err.message) : err;
    }
  }

  function readFile(id, which, rel, runId = null) {
    const r = rootFor(id, which, runId);
    try {
      return { root: which, path: rel, editable: r.editable, ...readText(r.root, rel) };
    } catch (err) {
      throw err instanceof PathError ? new HttpError(err.status, err.message) : err;
    }
  }

  function writeFile(id, which, rel, content, runId = null) {
    const r = rootFor(id, which, runId);
    if (typeof content !== 'string' || content.length > 2_000_000) throw bad('content must be a string up to 2 MB.');
    if (!r.editable) throw denied(which === 'source' ? 'Original project files are read-only. Enable Settings → Permissions → Direct edit, or edit the isolated working copy.' : 'This directory is read-only.');
    if (/^(\.git|\.era)(\/|$)/.test(rel)) throw denied('That path is protected.');
    try {
      const file = resolveInside(r.root, rel);
      const canonical = relative(realpathSync(r.root), existsSync(file) ? realpathSync(file) : file);
      if (protectedViolations([canonical], loadProject(id).protected).length) throw denied('That path is protected by the project configuration.');
      mkdirSync(dirname(file), { recursive: true });
      const tmp = `${file}.era-${process.pid}.tmp`;
      writeFileSync(tmp, content);
      renameSync(tmp, file);
    } catch (err) {
      throw err instanceof PathError ? new HttpError(err.status, err.message) : err;
    }
    const sha = createHash('sha256').update(content).digest('hex');
    audit.record('file.written', { project_id: id, root: which, path: rel, sha256: sha, run_id: r.run_id ?? null });
    return { saved: true, sha256: sha, note: which === 'workspace' ? 'The verified diff may now be stale. Resume an interrupted/manual run to verify it; a changed run awaiting approval must be rejected and started again.' : null };
  }


  // Connect an authorized Git repository: a plain `git clone` into an allowed location, run as a job.
  // Credentials are never prompted for or stored (GIT_TERMINAL_PROMPT=0): public repositories and repositories
  // reachable through the user's own Git credential helper or SSH agent only.
  function clone(body = {}) {
    const url = String(body.url ?? '');
    if (!/^(https:\/\/[\w.-]+\/[\w./~%+-]+|ssh:\/\/[\w.@-]+\/[\w./~%+-]+|[\w.-]+@[\w.-]+:[\w./~%+-]+)$/.test(url) || url.startsWith('-')) throw bad('Use an https://, ssh:// or git@host:path repository URL.');
    if (body.authorized !== true) throw bad('Confirm that you are authorized to work on this repository ("authorized": true).');
    const settings = ctx.settings();
    const parent = body.destination ? resolve(String(body.destination)) : settings.workspaces.defaultLocation;
    if (!parent) throw bad('Choose a destination folder (or set Settings → Workspaces → Default project location).');
    const name = String(body.name ?? basename(url).replace(/\.git$/, '')).replace(/[^\w.-]/g, '-');
    if (!name || name === '.' || name === '..') throw bad('Choose a repository folder name.');
    const dest = resolve(parent, name);
    assertExternalPath(dest, 'Clone destination');
    if (!insideAllowedRoots(dest, settings)) throw denied('The destination is outside the allowed workspace roots.');
    if (existsSync(dest)) throw conflict(`${dest} already exists.`);
    const job = jobs.start({ kind: 'git.clone', label: `clone ${name}`, args: [], exec: { command: 'git', args: ['-c', 'protocol.file.allow=never', '-c', 'core.hooksPath=/dev/null', 'clone', '--no-tags', '--depth', '50', '--', url, dest] }, env: { GIT_TERMINAL_PROMPT: '0' }, cwd: ctx.config.cwd });
    audit.record('project.clone', { job_id: job.id, url: url.replace(/\/\/[^@/]*@/, '//'), destination: dest });
    return { ...job, destination: dest };
  }

  return { clone, rootFor, list, status, create, update, remove, startOp, cancel, runDetail, patchText, fileDiff, approve, reject, rollback, tree, readFile, writeFile, view };
}
