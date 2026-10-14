// Natural-language tasks → authorized, structured workflows.
// Classification is deterministic (keywords) and always shown to the user, who can override the mode.
// Nothing runs from the sentence itself: the control plane builds a plan, lists what it needs the user to
// authorize (remote providers, authorization statements, missing inputs), and starts only after an explicit confirm.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { newId } from '../../core/util.js';
import { remoteProviders, rolesOf } from '../../agents/team.js';
import { insideAllowedRoots } from '../settings.js';
import { bad, denied } from '../errors.js';

export const MODES = ['ANALYZE', 'REVIEW', 'MODIFY', 'REBUILD', 'IMPROVE'];
const RX = {
  improve: /\bself[- ]?improv|\b(improve|evolve|optimi[sz]e)\b[^.]*\b(era|itself)\b|\bera'?s own\b/i,
  rebuild: /\b(rebuild|reconstruct|re-?implement|recreate|reproduce)\b|\bclone\b/i,
  modify: /\b(fix|implement|add|create|refactor|change|update|modify|repair|patch|resolve|remove|rename|migrate|extend)\b/i,
  review: /\b(review|audit|assess)\b|\b(find|identify|detect|list|look for)\b[^.]{0,30}\b(bugs?|issues?|problems?|vulnerabilit\w+|flaws?)\b|\bsecurity\b|\bcode quality\b/i,
  analyze: /\b(analy[sz]e|explain|how does|reverse|decompile|inspect|understand|what does)\b/i,
};

export function classify(text, explicit = null) {
  if (explicit) {
    if (!MODES.includes(explicit)) throw bad(`mode must be one of ${MODES.join(', ')}.`);
    return { mode: explicit, how: 'chosen by you', stages: explicit === 'MODIFY' ? ['modify'] : [explicit.toLowerCase()] };
  }
  const t = String(text);
  if (RX.improve.test(t)) return { mode: 'IMPROVE', how: 'keywords: improve ERA itself', stages: ['improve'] };
  if (RX.rebuild.test(t)) return { mode: 'REBUILD', how: 'keywords: rebuild/reconstruct', stages: ['rebuild'] };
  const mod = RX.modify.test(t);
  const rev = RX.review.test(t);
  if (mod && rev) return { mode: 'MODIFY', how: 'keywords: find problems and fix them (review first, then modify)', stages: ['review', 'modify'] };
  if (mod) return { mode: 'MODIFY', how: 'keywords: change/fix/implement', stages: ['modify'] };
  if (rev) return { mode: 'REVIEW', how: 'keywords: review/find problems', stages: ['review'] };
  if (RX.analyze.test(t)) return { mode: 'ANALYZE', how: 'keywords: analyze/explain', stages: ['analysis'] };
  return { mode: 'ANALYZE', how: 'no recognizable action; defaulting to the read-only analysis', stages: ['analysis'] };
}

const slug = (s) => (String(s).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'project');

export function tasksService(ctx) {
  const { jobs, audit, bus, projects, analysis, improvement, agents } = ctx;
  const dir = join(ctx.config.stateDirAbs, 'studio', 'tasks');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tasks = new Map();
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    try {
      const t = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      tasks.set(t.id, t);
    } catch {
      // ignore unreadable records
    }
  }
  const save = (t) => {
    const file = join(dir, `${t.id}.json`);
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(t, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, file);
    bus.publish('task.updated', { task: summary(t) });
  };
  const summary = (t) => ({ ...t });

  const uniqueId = (base) => {
    let id = slug(base);
    for (let n = 2; ctx.lab.store.exists(id); n++) id = `${slug(base)}-${n}`;
    return id;
  };

  // team: explicit {preset, roles} from the request, else the user's defaults in Settings, else the recommendation.
  async function resolveTeam(input, needsAgent) {
    if (!needsAgent) return { team: null, preset: null, remote: [], note: 'No coding agent is needed for this step.' };
    const s = ctx.settings().agents;
    const choice = input.team ?? (s.preset === 'custom' ? { roles: s.roles, review: s.review } : { preset: s.preset, review: s.review });
    const rec = await agents.recommend();
    const team = choice.roles || choice.preset ? { ...choice, review: choice.review ?? s.review } : rec.preset ? { preset: rec.preset, review: s.review } : null;
    if (!team) return { team: null, preset: null, remote: [], note: rec.reason, blocker: 'No coding agent team is ready.' };
    return { team, preset: team.preset ?? 'custom', remote: [], note: input.team ? 'Team chosen by you.' : 'Team from your Settings (or the first ready team).' };
  }

  const lines = (v) => (Array.isArray(v) ? v : String(v ?? '').split('\n')).map((x) => (typeof x === 'string' ? x.trim() : x)).filter(Boolean);

  // The part of a project definition the user supplied in this request. Anything not supplied keeps its stored value.
  function definition(input, modeKey, text, existing = null) {
    const def = { mode: modeKey, task: text };
    if (input.folder && modeKey !== 'rebuild') def.source = resolve(String(input.folder));
    if (input.reference) def.reference = resolve(String(input.reference));
    if (input.destination) def.destination = resolve(String(input.destination));
    if (input.authorization) def.authorization = String(input.authorization);
    if (input.review_plan !== undefined) def.review_plan = input.review_plan === true;
    const commands = {};
    if (input.run_command) commands.run = String(input.run_command);
    if (input.test_commands) commands.test = lines(input.test_commands);
    if (Object.keys(commands).length) def.commands = commands;
    const has = ['accept_commands', 'accept_fail_commands', 'criteria', 'behaviors', 'visual'].some((k) => input[k] !== undefined);
    if (has) {
      const base = existing?.acceptance ?? { criteria: [], commands: [], behaviors: [], visual: null };
      def.acceptance = {
        criteria: input.criteria !== undefined ? lines(input.criteria) : base.criteria,
        commands: input.accept_commands !== undefined || input.accept_fail_commands !== undefined ? [...lines(input.accept_commands).map((command) => ({ command })), ...lines(input.accept_fail_commands).map((command) => ({ command, baseline: 'fail' }))] : base.commands,
        behaviors: input.behaviors !== undefined ? input.behaviors : base.behaviors,
        visual: input.visual !== undefined ? input.visual : base.visual,
      };
    }
    return def;
  }

  async function plan(input = {}) {
    const text = String(input.text ?? '').trim();
    if (!text && !input.mode) throw bad('Describe the task first.');
    const c = classify(text, input.mode ?? null);
    const blockers = [];
    const warnings = [];
    const stages = c.stages.map((op) => ({ op, label: { analysis: 'REA analysis', review: 'Project review', modify: 'Isolated modification and verification', rebuild: 'Reconstruction from the authorized reference', improve: 'Improvement Lab experiment' }[op] ?? op }));
    const needsProject = ['review', 'modify', 'rebuild'].some((o) => c.stages.includes(o));
    const needsAgent = c.stages.some((o) => ['modify', 'rebuild'].includes(o)) || (c.stages.includes('review') && input.team);
    let project = null;
    let existing = null;
    let source = input.folder ? resolve(String(input.folder)) : null;
    let checks = [];

    if (input.project_id) {
      try {
        existing = ctx.lab.get(String(input.project_id));
        project = { exists: true, id: existing.id, source: existing.source, reference: existing.reference, destination: existing.destination };
        source = input.folder ? source : existing.source;
      } catch {
        blockers.push(`Unknown project "${input.project_id}".`);
      }
    }
    const t = await resolveTeam(input, needsAgent);
    if (t.blocker) blockers.push(t.blocker);

    if (c.mode === 'ANALYZE') {
      const target = input.target ?? input.folder;
      if (!target) blockers.push('Choose the file or folder to analyze.');
      else if (!existsSync(resolve(String(target)))) blockers.push(`Does not exist: ${target}`);
      else if (!insideAllowedRoots(resolve(String(target)), ctx.settings())) blockers.push('The target is outside the allowed workspace roots.');
    } else if (c.mode === 'IMPROVE') {
      const co = await improvement.checkout();
      if (!co.available) blockers.push(co.reason);
    } else if (needsProject) {
      const settings = ctx.settings();
      const modeKey = c.mode === 'REBUILD' ? 'rebuild' : c.mode === 'REVIEW' ? 'review' : 'modify';
      const mainOp = c.stages.includes('rebuild') ? 'rebuild' : c.stages.includes('modify') ? 'modify' : 'review';
      const anchor = c.mode === 'REBUILD' ? (input.reference ?? existing?.reference) : source;
      for (const [label, p] of [['The project folder', modeKey === 'rebuild' ? null : source], ['The reference', input.reference], ['The destination', input.destination]]) {
        if (p && !insideAllowedRoots(resolve(String(p)), settings)) blockers.push(`${label} is outside the allowed workspace roots (Settings → Workspaces).`);
      }
      if (!project) {
        let base = anchor ? basename(String(anchor)).replace(/\.[A-Za-z0-9]{1,5}$/, '') : 'project';
        // A generic file name ("rendered.png", "set-1a2b3c4d") says nothing about the project: name it from the task instead.
        if (/^(rendered|screenshot|screen|image|img|shot|shots|capture|reference|untitled|set-[0-9a-f]{8})/i.test(base)) base = text.split(/\s+/).slice(0, 4).join(' ');
        project = { exists: false, id: uniqueId(input.new_project_id ?? base), source: modeKey === 'rebuild' ? null : source, reference: input.reference ? resolve(String(input.reference)) : null, destination: input.destination ? resolve(String(input.destination)) : null };
      } else if (input.reference) project.reference = resolve(String(input.reference));
      if (input.destination && project.exists) project.destination = resolve(String(input.destination));
      // Everything that would stop this run, as one checklist, before anything is created or started.
      const def = definition(input, modeKey, text, existing);
      if (t.team) def.team = t.team;
      const consentIn = Array.isArray(input.consent_remote) ? input.consent_remote : [];
      const pf = await ctx.lab.preflightDraft(def, { existingId: existing?.id ?? null, op: mainOp, studio: true, trust: settings.permissions.trustedExecution, allowRemote: consentIn });
      checks = pf.checks;
      // Consent is collected in the UI right after the plan, so a missing consent is not a blocker here (start() enforces it).
      for (const ch of pf.checks) {
        if (ch.id === 'consent' && ch.status === 'fail') {
          ch.status = 'warn';
          ch.message = 'Waiting for your authorization below.';
          delete ch.fix;
          continue;
        }
        if (ch.status === 'fail') blockers.push(ch.fix ? `${ch.message} ${ch.fix}` : ch.message);
        if (ch.status === 'warn') warnings.push(ch.message);
      }
    }

    let remote = [];
    if (t.team) {
      try {
        const roles = t.team.roles ?? null;
        const table = (await agents.presets()).find((p) => p.name === t.team.preset);
        remote = table ? table.remote : roles ? remoteProviders(roles, ctx.config) : [];
      } catch {
        remote = [];
      }
    }
    if (existing) remote = remoteProviders(rolesOf(existing), ctx.config);
    if (remote.length) warnings.push(`Source code will be sent to: ${remote.join(', ')}. Your explicit consent is required.`);
    if (c.stages.length > 1) warnings.push('Review runs first; the modification starts automatically only if the review completes.');
    return { text, mode: c.mode, classification: c.how, stages, project, team: t.team, team_note: t.note, remote_providers: remote, consent_required: remote.length > 0, blockers, warnings, checks, input: sanitizeInput(input) };
  }

  const sanitizeInput = (i) => ({ text: String(i.text ?? ''), mode: i.mode ?? null, folder: i.folder ?? null, target: i.target ?? null, reference: i.reference ?? null, destination: i.destination ?? null, project_id: i.project_id ?? null, authorization: i.authorization ?? null, run_command: i.run_command ?? null });

  async function start(input = {}) {
    if (input.confirm !== true) throw bad('Starting a task needs "confirm": true (the user reviewed the plan).');
    const p = await plan(input);
    if (p.blockers.length) throw bad(`The task is not ready: ${p.blockers.join(' ')}`, { blockers: p.blockers });
    const consent = Array.isArray(input.consent_remote) ? input.consent_remote : [];
    const missing = p.remote_providers.filter((id) => !consent.includes(id));
    if (missing.length) throw denied(`Authorize sending the source code to ${missing.join(', ')} before starting.`);
    const task = { id: newId('task'), text: p.text, mode: p.mode, classification: p.classification, project_id: null, status: 'running', stages: p.stages.map((s) => ({ ...s, job_id: null, status: 'pending' })), created_at: new Date().toISOString(), consent_remote: consent, error: null, input: p.input };

    if (p.mode === 'ANALYZE') {
      const job = await analysis.start({ target: input.target ?? input.folder });
      task.stages[0] = { ...task.stages[0], job_id: job.id, status: 'running' };
    } else if (p.mode === 'IMPROVE') {
      const job = await improvement.selfAnalyze();
      task.stages[0] = { ...task.stages[0], job_id: job.id, status: 'running' };
      task.stages.push({ op: 'propose', label: 'Propose an experiment', job_id: null, status: 'pending' });
    } else {
      const modeKey = p.mode === 'REBUILD' ? 'rebuild' : p.mode === 'REVIEW' ? 'review' : 'modify';
      const existingProject = p.project?.exists ? ctx.lab.get(p.project.id) : null;
      const def = definition(input, modeKey, p.text, existingProject);
      if (p.team) def.team = p.team;
      let id;
      if (!existingProject) {
        id = p.project.id;
        projects.create({ id, ...def, exposure: { remote_consent: consent } });
      } else {
        // Changes to reference, destination, commands and acceptance made in this request are SAVED to the existing project.
        id = existingProject.id;
        projects.update(id, { ...def, ...(consent.length ? { exposure: { remote_consent: [...new Set([...(existingProject.exposure?.remote_consent ?? []), ...consent])] } } : {}) });
      }
      task.project_id = id;
      const first = p.stages[0].op;
      const job = await projects.startOp(id, first, { allow_remote: consent });
      task.stages[0] = { ...task.stages[0], job_id: job.id, status: 'running' };
    }
    tasks.set(task.id, task);
    save(task);
    audit.record('task.started', { task_id: task.id, mode: task.mode, project_id: task.project_id, stages: task.stages.map((s) => s.op), remote: consent });
    return task;
  }

  // Chain stages when a job ends. State is persisted, so a restart shows where a task stopped.
  jobs.onFinish((job) => {
    const task = [...tasks.values()].find((t) => t.status === 'running' && t.stages.some((s) => s.job_id === job.id));
    if (!task) return;
    const i = task.stages.findIndex((s) => s.job_id === job.id);
    task.stages[i].status = job.status;
    const next = task.stages[i + 1];
    if (job.status === 'succeeded' && next) {
      try {
        if (next.op === 'modify') {
          projects.startOp(task.project_id, 'modify', { allow_remote: task.consent_remote }).then((jj) => {
            next.job_id = jj.id;
            next.status = 'running';
            save(task);
          }).catch((err) => {
            next.status = 'failed';
            task.status = 'failed';
            task.error = err.message;
            save(task);
          });
        } else if (next.op === 'propose') {
          improvement.propose().then((jj) => {
            next.job_id = jj.id;
            next.status = 'running';
            save(task);
          }).catch((err) => {
            next.status = 'failed';
            task.status = 'failed';
            task.error = err.message;
            save(task);
          });
        }
      } catch (err) {
        next.status = 'failed';
        task.status = 'failed';
        task.error = err.message;
      }
    } else if (job.status !== 'succeeded') {
      task.status = job.status === 'cancelled' ? 'cancelled' : 'failed';
      task.error = job.error ?? `${task.stages[i].label} ${job.status}`;
    } else {
      task.status = 'complete';
    }
    save(task);
  });

  const list = () => [...tasks.values()].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 100).map(summary);
  const get = (id) => tasks.get(id) ?? null;
  return { classify, plan, start, list, get, statSync };
}
