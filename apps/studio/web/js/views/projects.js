import { html, useEffect, useState } from '../html.js';
import { ApiError, del, download, get, post, put } from '../api.js';
import { Badge, Btn, Callout, Empty, Md, Section, Spinner, baseName, duration, useAsync, when } from '../ui.js';
import { navigate, openModal, closeModal, set, toast, useStore } from '../store.js';
import { buildPipeline, groupFindings, humanStep, progressPercent, simpleStatus } from '../model.js';
import { jobLog } from '../main.js';
import { Checklist, RebuildSetup } from './rebuild.js';
import { Icon } from '../icons.js';

export function Pipeline({ stages, compact = false }) {
  if (!stages.length) return html`<div class="muted">No run yet.</div>`;
  return html`<div class="pipeline" role="list" aria-label="Workflow stages">${stages.map((st) => html`<div class="stage" role="listitem" data-state=${st.state} data-stage=${st.key}>
    <span class="dot" aria-hidden="true"></span>
    <div><div class="row"><b>${st.label}</b><${Badge} status=${st.state} />${st.agent ? html`<span class="muted">${st.agent}</span>` : null}</div>
      ${compact ? null : html`<div class="meta">${st.started_at ? `started ${when(st.started_at)}` : 'not started'}${st.duration_ms !== null ? ` · ${duration(st.duration_ms)}` : ''}</div>`}
      ${st.error ? html`<div class="error-text">${st.error}</div>` : null}
      ${!compact && st.artifacts.length ? html`<div class="meta">Artifacts: ${st.artifacts.map((a) => html`<code style="margin-right:6px">${a}</code>`)}</div>` : null}</div>
    <span></span></div>`)}</div>`;
}

function useProject(id) {
  const s = useStore();
  const q = useAsync(() => get(`/api/projects/${id}`), [id, s.projects.find((p) => p.id === id)?.status, s.progress[id]?.step, s.progress[id]?.status]);
  return q;
}

export function ProjectsView() {
  const s = useStore();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const query = search.trim().toLocaleLowerCase();
  const running = s.projects.filter((p) => p.active_job).length;
  const awaiting = s.projects.filter((p) => p.status === 'awaiting-approval').length;
  const projects = s.projects.filter((p) => (filter === 'all' || (filter === 'running' ? p.active_job : p.status === 'awaiting-approval')) && (!query || [p.id, p.task, p.source, p.reference, p.mode].some((value) => String(value ?? '').toLocaleLowerCase().includes(query))));
  const create = () => openModal({ title: 'New project', wide: true, body: html`<${CreateProject} />` });
  const open = (id, route = 'projects', tab) => { set({ currentProject: id }); navigate([route, id, ...(tab ? [tab] : [])]); };
  return html`<div class="page projects-page">
    <header class="projects-heading">
      <div><div class="projects-eyebrow">Your workspace</div><h1>Projects</h1><p>A place for every idea. Pick up a project and keep building.</p></div>
      <div class="projects-heading-actions"><${Btn} onClick=${() => openModal({ title: 'Clone repository', body: html`<${CloneRepository} />` })}><${Icon} name="code" size=${16} />Clone repository<//><${Btn} kind="primary" onClick=${create}><${Icon} name="plus" size=${16} />New project<//></div>
    </header>
    <div class="projects-summary" aria-label="Project summary">
      <div class="projects-summary-item"><span class="projects-summary-icon"><${Icon} name="projects" size=${19} /></span><div><span class="projects-summary-label">Total projects</span><strong>${s.projects.length}</strong></div></div>
      <div class="projects-summary-item"><span class="projects-summary-icon"><${Icon} name="clock" size=${19} /></span><div><span class="projects-summary-label">Running now</span><strong>${running}</strong></div></div>
      <div class="projects-summary-item"><span class="projects-summary-icon"><${Icon} name="check" size=${19} /></span><div><span class="projects-summary-label">Awaiting approval</span><strong>${awaiting}</strong></div></div>
    </div>
    <div class="projects-toolbar">
      <div class="projects-filters" role="group" aria-label="Filter projects">
        ${[['all', 'All projects', s.projects.length], ['running', 'Running', running], ['approval', 'To review', awaiting]].map(([value, label, count]) => html`<button type="button" aria-pressed=${filter === value} onClick=${() => setFilter(value)}>${label}<span>${count}</span></button>`)}
      </div>
      <label class="projects-search"><${Icon} name="search" size=${16} /><input type="search" aria-label="Search projects" placeholder="Search projects…" value=${search} onInput=${(e) => setSearch(e.target.value)} /></label>
    </div>
    ${s.projects.length === 0 ? html`<section class="projects-empty"><span class="projects-empty-icon"><${Icon} name="folder" size=${28} /></span><h2>Your next project starts here</h2><p>Add a local folder or clone a repository. Keep the source, workflow and review together in one place.</p><${Btn} kind="primary" onClick=${create}><${Icon} name="plus" size=${16} />New project<//></section>` : projects.length === 0 ? html`<section class="projects-empty"><span class="projects-empty-icon"><${Icon} name="search" size=${28} /></span><h2>No projects found</h2><p>Try another search or show all projects.</p><${Btn} onClick=${() => { setSearch(''); setFilter('all'); }}>Clear filters<//></section>` : html`
      <div class="projects-grid" role="list" aria-label="Projects">${projects.map((p) => {
        const target = p.source ?? p.reference ?? p.destination;
        const mode = { review: 'Review', modify: 'Modify', rebuild: 'Rebuild' }[p.mode] ?? p.mode;
        return html`<article class="project-card" role="listitem" key=${p.id}>
          <div class="project-card-top"><span class="project-card-icon"><${Icon} name=${p.mode === 'modify' ? 'code' : 'folder'} size=${23} /></span><${Badge} status=${p.active_job ? 'running' : p.status} /></div>
          <div class="project-card-main"><h2><button type="button" onClick=${() => open(p.id)}>${p.id}</button></h2><p class="project-card-description">${p.task || (p.mode === 'review' ? 'Explore the code, understand the findings and plan what comes next.' : p.mode === 'rebuild' ? 'Build a new project from an authorized reference.' : 'Make changes in an isolated working copy and review the result.')}</p></div>
          <div class="project-card-target" title=${target || 'No target folder'}><${Icon} name="folder" size=${14} /><span>${baseName(target) || 'No target folder'}</span><span class="project-card-mode">${mode}</span></div>
          <div class="project-card-run"><${Icon} name="clock" size=${14} /><span>${p.latest_run ? `${p.latest_run.op} · ${when(p.latest_run.updated_at ?? p.latest_run.created_at)}` : 'No runs yet'}</span></div>
          <footer class="project-card-actions">${s.settings?.mode === 'advanced' ? html`<${Btn} kind="ghost" size="sm" onClick=${() => open(p.id, 'workbench')}><${Icon} name="code" size=${15} />Workbench<//>` : html`<span class="project-card-footnote">${mode} workspace</span>`}${p.status === 'awaiting-approval' ? html`<${Btn} kind="primary" size="sm" onClick=${() => open(p.id, 'projects', 'review')}>Review & approve<${Icon} name="arrowUpRight" size=${15} /><//>` : html`<${Btn} size="sm" onClick=${() => open(p.id)}>Open project<${Icon} name="arrowUpRight" size=${15} /><//>`}</footer>
        </article>`;
      })}</div>`}
    <p class="projects-footnote"><${Icon} name="check" size=${14} />Agent changes stay in an isolated working copy until you approve them.</p>
  </div>`;
}

function CloneRepository() {
  const s = useStore();
  const [url, setUrl] = useState('');
  const [destination, setDestination] = useState(s.settings.workspaces.defaultLocation ?? '');
  const [authorized, setAuthorized] = useState(false);
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const current = job ? s.jobs[job.id] ?? job : null;
  const clone = async () => {
    try { const r = await post('/api/projects/clone', { url, destination, authorized }); setJob(r.job); setError(null); }
    catch (e) { setError(e.message); }
  };
  const register = async () => {
    try { const { project } = await post('/api/projects', { source: job.destination, mode: 'review' }); closeModal(); navigate(['projects', project.id]); }
    catch (e) { setError(e.message); }
  };
  return html`<div class="col"><label class="col">Repository URL<input type="url" value=${url} onInput=${(e) => setUrl(e.target.value)} placeholder="https://host/owner/repository.git" /></label>
    <label class="col">Parent folder<input value=${destination} onInput=${(e) => setDestination(e.target.value)} placeholder="/absolute/path" /></label>
    ${window.eraDesktop?.pickPath ? html`<${Btn} onClick=${async () => { const p = await window.eraDesktop.pickPath(); if (p) setDestination(p); }}>Browse…<//>` : null}
    <label class="check"><input type="checkbox" checked=${authorized} onChange=${(e) => setAuthorized(e.target.checked)} />I am authorized to work on this repository.</label>
    <span class="muted">Uses your existing Git authentication. The destination must not exist.</span>
    ${current ? html`<${Badge} status=${current.status} /><span class="error-text">${current.error ?? ''}</span>` : null}
    ${error ? html`<${Callout} kind="bad">${error}<//>` : null}
    <div class="row"><${Btn} onClick=${closeModal}>Close<//>${current?.status === 'succeeded' ? html`<${Btn} kind="primary" onClick=${register}>Open cloned project<//>` : html`<${Btn} kind="primary" disabled=${!url || !destination || !authorized || ['running', 'queued'].includes(current?.status)} onClick=${clone}>Clone<//>`}</div></div>`;
}

function CreateProject() {
  const s = useStore();
  const [f, setF] = useState({ id: '', mode: 'review', source: s.settings?.workspaces.defaultLocation ?? '', reference: '', destination: '', task: '', authorization: '', preset: 'none', test: '', accept: '', acceptFail: '', consent: [] });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const set1 = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const lines = (t) => t.split('\n').map((x) => x.trim()).filter(Boolean);
  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const body = { id: f.id || undefined, mode: f.mode, source: f.source || undefined, reference: f.reference || undefined, destination: f.destination || undefined, task: f.task, authorization: f.authorization || undefined, commands: { test: lines(f.test) }, acceptance: { commands: [...lines(f.accept).map((command) => ({ command })), ...lines(f.acceptFail).map((command) => ({ command, baseline: 'fail' }))] }, ...(f.preset !== 'none' ? { team: { preset: f.preset } } : {}), exposure: { remote_consent: f.consent } };
      const { project } = await post('/api/projects', body);
      set({ currentProject: project.id });
      closeModal();
      navigate(['projects', project.id]);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const remote = f.preset === 'none' ? [] : f.preset === 'claude-only' ? ['claude-code'] : f.preset === 'codex-only' ? ['codex'] : ['claude-code', 'codex'];
  return html`<div class="col">
    <div class="field-row"><label for="np-id">Project id</label><div><input id="np-id" type="text" value=${f.id} onInput=${set1('id')} placeholder="my-app (lowercase, digits, - _)" data-autofocus /></div></div>
    <div class="field-row"><label for="np-mode">Default mode</label><div><select id="np-mode" value=${f.mode} onChange=${set1('mode')}><option value="review">Review (read-only)</option><option value="modify">Modify</option><option value="rebuild">Rebuild from a reference</option></select></div></div>
    <div class="field-row"><label for="np-src">${f.mode === 'rebuild' ? 'Reference (authorized)' : 'Project folder'}</label><div class="col" style="gap:4px"><input id="np-src" type="text" value=${f.mode === 'rebuild' ? f.reference : f.source} onInput=${set1(f.mode === 'rebuild' ? 'reference' : 'source')} placeholder="/absolute/path" />${window.eraDesktop?.pickPath ? html`<${Btn} size="sm" onClick=${async () => { const p = await window.eraDesktop.pickPath(); if (p) setF({ ...f, [f.mode === 'rebuild' ? 'reference' : 'source']: p }); }}>Browse…<//>` : null}</div></div>
    ${f.mode === 'rebuild' ? html`<div class="field-row"><label for="np-dest">New project destination</label><div><input id="np-dest" type="text" value=${f.destination} onInput=${set1('destination')} placeholder="/absolute/path/to/empty-folder" /></div></div>
      <div class="field-row"><label for="np-auth">Authorization</label><div><textarea id="np-auth" class="field" rows="2" value=${f.authorization} onInput=${set1('authorization')} placeholder="Why you are allowed to analyze this reference"></textarea></div></div>` : null}
    <div class="field-row"><label for="np-task">Task</label><div><textarea id="np-task" class="field" rows="2" value=${f.task} onInput=${set1('task')} placeholder=${f.mode === 'review' ? 'Optional focus for the review' : 'What should change?'}></textarea></div></div>
    <div class="field-row"><label for="np-team">Agent team</label><div class="col" style="gap:4px"><select id="np-team" value=${f.preset} onChange=${set1('preset')}><option value="none">No coding agent (manual / analysis only)</option><option value="claude-only">Claude Only</option><option value="codex-only">Codex Only</option><option value="claude+codex">Claude + Codex</option></select>
      ${remote.map((id) => html`<label class="check"><input type="checkbox" checked=${f.consent.includes(id)} onChange=${(e) => setF({ ...f, consent: e.target.checked ? [...f.consent, id] : f.consent.filter((x) => x !== id) })} /><span>Authorize sending this project's source code to <b>${id}</b></span></label>`)}</div></div>
    <details><summary class="muted" style="cursor:pointer">Build, test and acceptance commands</summary>
      <div class="col" style="margin-top:var(--space-3)">
        <label class="col" style="gap:4px"><span class="muted">Test commands (one per line)</span><textarea class="field" rows="2" value=${f.test} onInput=${set1('test')} placeholder="npm test --silent"></textarea></label>
        <label class="col" style="gap:4px"><span class="muted">Acceptance commands that must pass</span><textarea class="field" rows="2" value=${f.accept} onInput=${set1('accept')}></textarea></label>
        <label class="col" style="gap:4px"><span class="muted">Acceptance commands that must FAIL now (they reproduce the problem)</span><textarea class="field" rows="2" value=${f.acceptFail} onInput=${set1('acceptFail')}></textarea></label>
      </div></details>
    ${err ? html`<${Callout} kind="bad">${err}<//>` : null}
    <div class="row" style="justify-content:flex-end"><${Btn} onClick=${closeModal}>Cancel<//><${Btn} kind="primary" disabled=${busy} onClick=${submit}>Create project<//></div>
  </div>`;
}

// The backend's "next" text names CLI commands; the UI says the same thing in its own terms.
const hint = (status) => ({ 'awaiting-approval': 'Next: review the change and approve or reject it.', interrupted: 'Next: resume the interrupted run.', failed: 'Next: read the error above, fix the cause, then resume.', 'awaiting-implementation': 'Next: edit the working copy in the workbench, then resume.', rejected: 'Next: see why it was rejected, adjust the task or acceptance criteria and run again.', applied: 'The change is applied. You can roll it back from Changes & approval.' })[status.latest_run?.status] ?? null;

// What would stop (or weaken) the project's default operation, from the control plane's own checks.
function PreflightPanel({ project, busy }) {
  const [pf, setPf] = useState(null);
  const load = () => get(`/api/projects/${project.id}/preflight?op=${project.mode}`).then(setPf).catch(() => setPf(null));
  useEffect(() => { load(); }, [project.id, project.updated_at, busy]);
  if (!pf) return null;
  const problems = pf.checks.some((c) => c.status === 'fail' || c.status === 'warn');
  return problems ? html`<${Checklist} checks=${pf.checks} onRecheck=${load} />` : html`<details class="checklist-ok"><summary class="muted" style="cursor:pointer">Prerequisites: all ${pf.checks.length} checks passed</summary><${Checklist} checks=${pf.checks} onRecheck=${load} /></details>`;
}

function RunControls({ project, status, onChange }) {
  const job = status.active_job;
  const [task, setTask] = useState(project.task ?? '');
  const busy = !!job;
  const start = async (op) => {
    try {
      if (op !== 'review' && task !== project.task) await api_patch(project.id, { task });
      const { job: j } = await post(`/api/projects/${project.id}/ops/${op}`, {});
      toast(`${op} started`, 'ok');
      onChange(j);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403 && /not authorized/.test(err.message)) {
        const ids = (/to ([\w:\-, ]+?) is not authorized/.exec(err.message)?.[1] ?? '').split(',').map((x) => x.trim()).filter(Boolean);
        openModal({ title: 'Authorize sending source code', body: html`<${ConsentBody} project=${project} providers=${ids} op=${op} onDone=${onChange} />` });
      } else if (err instanceof ApiError && err.status === 409 && err.detail?.checks) {
        openModal({ title: `Cannot start ${op} yet`, wide: true, body: html`<${Checklist} checks=${err.detail.checks} />`, footer: html`<${Btn} onClick=${closeModal}>Close<//><${Btn} kind="primary" onClick=${() => { closeModal(); navigate(['projects', project.id, 'config']); }}>Open configuration<//>` });
      } else toast(err.message, 'bad', 9000);
    }
  };
  const latest = status.latest_run;
  const resumable = latest && ['interrupted', 'failed', 'awaiting-implementation'].includes(latest.status) && !busy;
  return html`<div class="col">
    <label class="col" style="gap:4px"><span class="muted">Task</span><textarea class="field" rows="2" value=${task} onInput=${(e) => setTask(e.target.value)} aria-label="Task" disabled=${busy}></textarea></label>
    <div class="row wrap">
      <${Btn} disabled=${busy || !project.source} onClick=${() => start('review')}>Run review<//>
      <${Btn} kind="primary" disabled=${busy || !project.source || !task.trim()} onClick=${() => start('modify')}>Run modify<//>
      <${Btn} disabled=${busy} onClick=${() => start('rebuild')}>Run rebuild<//>
      ${resumable ? html`<${Btn} onClick=${async () => { try { const { job: j } = await post(`/api/projects/${project.id}/ops/resume`, {}); onChange(j); } catch (e) { toast(e.message, 'bad'); } }}>Resume<//>` : null}
      ${busy ? html`<${Btn} kind="danger" onClick=${async () => { await post(`/api/projects/${project.id}/cancel`, {}); toast('Cancellation requested'); }}>Cancel run<//>` : null}
    </div>
    ${hint(status) ? html`<span class="muted">${hint(status)}</span>` : null}
  </div>`;
}
const api_patch = (id, body) => import('../api.js').then((m) => m.api('PATCH', `/api/projects/${id}`, body));

function ConsentBody({ project, providers, op, onDone }) {
  const [ok, setOk] = useState({});
  return html`<div class="col"><p>${op} will send this project's source code to an external AI service. Credential files and agent instruction files are withheld, and files containing secret-looking text block the run.</p>
    ${providers.map((id) => html`<label class="check"><input type="checkbox" checked=${!!ok[id]} onChange=${(e) => setOk({ ...ok, [id]: e.target.checked })} /><span>I authorize sending <b>${project.id}</b> to <b>${id}</b></span></label>`)}
    <div class="row" style="justify-content:flex-end"><${Btn} onClick=${closeModal}>Cancel<//><${Btn} kind="primary" disabled=${!providers.every((id) => ok[id])} onClick=${async () => { try { const { job } = await post(`/api/projects/${project.id}/ops/${op}`, { allow_remote: providers }); closeModal(); onDone(job); } catch (e) { toast(e.message, 'bad', 9000); } }}>Authorize and start<//></div></div>`;
}

function LogView({ jobId }) {
  const s = useStore();
  const [initial, setInitial] = useState([]);
  useEffect(() => { if (jobId) get(`/api/jobs/${jobId}`).then((j) => setInitial(j.log_tail.map((t) => ({ text: t.replace(/^! /, ''), err: t.startsWith('! ') })))).catch(() => {}); }, [jobId]);
  const live = jobLog(jobId);
  const lines = live.length ? live : initial;
  void s.logTick;
  return html`<div class="log" role="log" aria-label="Execution log" tabindex="0">${lines.length ? lines.slice(-200).map((l) => html`<div class=${l.err ? 'err' : ''}>${l.text}</div>`) : html`<span class="faint">No output yet.</span>`}</div>`;
}

export function ProjectView({ route }) {
  const id = route.path[1];
  const tab = route.path[2] ?? 'overview';
  const s = useStore();
  const advanced = s.settings?.mode === 'advanced';
  const q = useProject(id);
  const [detail, setDetail] = useState(null);
  const latest = q.data?.latest_run;
  useEffect(() => { set({ currentProject: id }); }, [id]);
  useEffect(() => {
    if (!latest) { setDetail(null); return; }
    get(`/api/projects/${id}/runs/latest`).then(setDetail).catch(() => setDetail(null));
  }, [id, latest?.run_id, latest?.status, latest?.current_step]);
  if (q.error) return html`<div class="page"><${Callout} kind="bad" title="Project not found">${q.error.message}<//></div>`;
  if (!q.data) return html`<div class="page"><${Spinner} /></div>`;
  const { project } = q.data;
  const job = q.data.active_job ?? (latest ? Object.values(s.jobs).filter((j) => j.project_id === id).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0] : null);
  const roles = project.team?.roles ?? { architect: null, implementer: project.agent, reviewer: null };
  const stages = buildPipeline({ run: latest ? { ...latest, steps: detail?.run.steps ?? latest.steps } : null, roles, status: q.data.active_job ? 'running' : latest?.status, handoffs: detail?.run.handoffs ?? [] });
  const summary = simpleStatus({ project: { latest_run: latest, status: project.status }, job: q.data.active_job });
  const tabs = [['overview', 'Overview'], ['findings', 'Findings'], ['review', 'Changes & approval'], ['config', 'Configuration'], ['history', 'History']];
  const findings = detail?.run.results.findings?.findings ?? null;
  return html`<div class="page">
    <div class="page-head"><div class="grow"><h1>${project.id}</h1><p class="mono truncate" title=${project.source ?? project.reference}>${project.source ?? project.reference}</p></div>
      <${Badge} status=${q.data.active_job ? 'running' : project.status} />${advanced ? html`<${Btn} onClick=${() => navigate(['workbench', id])}>Open in workbench<//>` : null}</div>
    <div class="tabs" role="tablist" style="border:0;border-bottom:1px solid var(--border);background:transparent">${tabs.map(([k, l]) => html`<button class="tab" role="tab" aria-selected=${tab === k} onClick=${() => navigate(['projects', id, ...(k === 'overview' ? [] : [k])])}>${l}${k === 'review' && project.status === 'awaiting-approval' ? html` <span class="badge warn plain">1</span>` : ''}</button>`)}</div>

    ${tab === 'overview' ? html`
      <div class=${`callout ${summary.tone === 'bad' ? 'bad' : summary.tone === 'ok' ? 'ok' : summary.tone === 'warn' ? 'warn' : ''}`}><b>${summary.text}</b>${latest?.error ? html`<div class="error-text">${latest.error}</div>` : null}${latest?.pause_message ? html`<div>${latest.pause_message}</div>` : null}
        ${project.status === 'awaiting-approval' ? html`<div style="margin-top:8px"><${Btn} kind="primary" onClick=${() => navigate(['projects', id, 'review'])}>Review and approve<//></div>` : null}</div>
      ${['modify', 'rebuild'].includes(project.mode) ? html`<${PreflightPanel} project=${project} busy=${!!q.data.active_job} />` : null}
      <${Section} title="Run"><${RunControls} project=${project} status=${q.data} onChange=${() => q.reload()} /><//>
      ${advanced ? html`
        <${Section} title="Workflow" actions=${html`<span class="muted">${progressPercent(stages)}% of stages complete</span>`}><${Pipeline} stages=${stages} /><//>
        ${job ? html`<${Section} title=${`Job: ${job.label}`} actions=${html`<${Badge} status=${job.status} />`} body=${false}><${LogView} jobId=${job.id} /><//>` : null}`
      : html`<${Section} title="Progress"><div class="col"><div style="height:6px;background:var(--surface-3);border-radius:3px;overflow:hidden"><div style=${`height:100%;width:${progressPercent(stages)}%;background:var(--accent);transition:width .3s`}></div></div>
        <div class="muted">${job && ['queued', 'running'].includes(job.status) ? `Now: ${humanStep(q.data.latest_run?.current_step)}` : summary.text}</div>
        <div class="row wrap">${stages.filter((x) => x.role !== 'user' || x.key === 'approval').map((x) => html`<${Badge} status=${x.state} label=${x.label} />`)}</div></div><//>`}
      ${latest ? html`<${Section} title="Attempts and results">${latest.attempts?.length ? html`<table class="table"><thead><tr><th>Attempt</th><th>Agent</th><th>Result</th></tr></thead><tbody>${latest.attempts.map((a) => html`<tr><td>${a.n}</td><td>${a.agent}</td><td>${a.pass ? html`<${Badge} status="ok" label="Passed verification" />` : html`<span class="error-text">${a.reasons?.join(' ') ?? 'Failed'}</span>`}</td></tr>`)}</tbody></table>` : html`<span class="muted">No attempts recorded.</span>`}<//>` : null}` : null}

    ${tab === 'findings' ? html`<${Findings} findings=${findings} detail=${detail} project=${project} />` : null}
    ${tab === 'review' ? html`<${ReviewCenterLazy} id=${id} />` : null}
    ${tab === 'config' ? html`${project.mode === 'rebuild' || project.reference ? html`<${RebuildSetup} project=${project} onSaved=${() => q.reload()} />` : null}<${Config} project=${project} onSaved=${() => q.reload()} />` : null}
    ${tab === 'history' ? html`<${History} runs=${q.data.runs} id=${id} spend=${q.data.spend} />` : null}
  </div>`;
}

function Findings({ findings, detail, project }) {
  if (!detail) return html`<${Empty} title="No run yet">Run a review to see findings.<//>`;
  if (!findings) return html`<${Empty} title="No findings in the latest run">The latest run is a ${detail.run.op} run. Run a review to produce prioritized findings with evidence and locations.<//>`;
  const groups = groupFindings(findings);
  return html`<div class="col">
    <div class="row"><span class="muted">${findings.length} finding(s)${detail.run.results.findings?.source_unmodified ? ' · the original project was not modified' : ''}</span><${Btn} class="right" size="sm" onClick=${() => download(`${project.id}-review.md`, detail.report, 'text/markdown')}>Export report<//></div>
    ${groups.length === 0 ? html`<${Callout} kind="ok">No findings.<//>` : groups.map(([sev, list]) => html`<${Section} title=${`${sev[0].toUpperCase()}${sev.slice(1)} (${list.length})`}>
      <div class="col">${list.map((f) => html`<div style="border-bottom:1px solid var(--border);padding-bottom:var(--space-3)"><div class="row"><b class=${`sev-${f.severity}`}>${f.title}</b><span class="badge neutral plain">${f.category}</span><span class="badge neutral plain">${f.source}</span></div>
        <div class="mono muted">${f.locations.map((l) => html`<a href=${`#/workbench/${project.id}?file=${encodeURIComponent(l.file)}&line=${l.line ?? ''}&root=workspace`}>${l.file}${l.line ? `:${l.line}` : ''}</a> `)}</div>
        ${f.detail ? html`<p>${f.detail}</p>` : null}${f.evidence ? html`<pre class="muted" style="margin-top:4px">${f.evidence}</pre>` : null}${f.recommendation ? html`<p><b>Recommendation:</b> ${f.recommendation}</p>` : null}</div>`)}</div><//>`)}</div>`;
}

function Config({ project, onSaved }) {
  const [task, setTask] = useState(project.task ?? '');
  const [msg, setMsg] = useState(null);
  const [config, setConfig] = useState({ tests: project.commands.test.join('\n'), build: project.commands.build.join('\n'), preset: project.team ? (['codex-only', 'claude-only', 'claude+codex'].includes(project.team.preset) ? project.team.preset : 'custom') : 'none', attempts: project.limits.maxAttempts });
  const lines = (v) => v.split('\n').map((x) => x.trim()).filter(Boolean);
  return html`<div class="col">
    <${Section} title="Project"><dl class="kv"><dt>Mode</dt><dd>${project.mode}</dd><dt>Source</dt><dd class="mono">${project.source ?? '—'}</dd><dt>Reference</dt><dd class="mono">${project.reference ?? '—'}</dd><dt>Destination</dt><dd class="mono">${project.destination ?? '—'}</dd><dt>Agent</dt><dd>${project.agent ?? 'manual'}${project.team ? ` (team: ${project.team.preset})` : ''}</dd>
      <dt>Team roles</dt><dd>${project.team ? Object.entries(project.team.roles).map(([r, a]) => `${r}: ${a ?? '—'}`).join(' · ') : 'single agent'}</dd>
      <dt>Remote consent</dt><dd>${project.exposure.remote_consent.join(', ') || 'none: no source code leaves this machine'}</dd><dt>Test commands</dt><dd class="mono">${project.commands.test.join('; ') || 'detected automatically'}</dd><dt>Acceptance</dt><dd class="mono">${project.acceptance.commands.map((a) => `${a.command}${a.baseline === 'fail' ? ' (must fail now)' : ''}`).join('; ') || '—'}</dd><dt>Protected</dt><dd class="mono">${['.git/**', '.era/**', ...project.protected].join(', ')}</dd></dl><//>
    <${Section} title="Limits"><dl class="kv"><dt>Command timeout</dt><dd>${duration(project.limits.commandTimeoutMs)}</dd><dt>Agent timeout</dt><dd>${duration(project.limits.agentTimeoutMs)}</dd><dt>Attempts</dt><dd>${project.limits.maxAttempts}</dd><dt>Cost per run / total</dt><dd>$${project.limits.maxCostUsd} / $${project.limits.maxCostUsdTotal}</dd></dl><//>
    <${Section} title="Workflow configuration"><div class="col">
      <label class="col">Agent team<select value=${config.preset} onChange=${(e) => setConfig({ ...config, preset: e.target.value })}>${['none', 'codex-only', 'claude-only', 'claude+codex', 'custom'].map((p) => html`<option value=${p}>${p === 'none' ? 'Manual / no team' : p}</option>`)}</select></label>
      <span class="muted">Custom uses the roles saved in the Agent Command Center. Remote providers still require explicit project consent.</span>
      <label class="col">Build commands (one per line)<textarea class="field" value=${config.build} onInput=${(e) => setConfig({ ...config, build: e.target.value })}></textarea></label>
      <label class="col">Test commands (one per line)<textarea class="field" value=${config.tests} onInput=${(e) => setConfig({ ...config, tests: e.target.value })}></textarea></label>
      <label class="col">Maximum implementation attempts<input type="number" min="1" max="5" value=${config.attempts} onInput=${(e) => setConfig({ ...config, attempts: Number(e.target.value) })} /></label>
      <${Btn} onClick=${async () => { try { const settings = (await get('/api/settings')).settings; const team = config.preset === 'none' ? null : config.preset === 'custom' ? { roles: settings.agents.roles, review: settings.agents.review } : { preset: config.preset }; await api_patch(project.id, { team, ...(config.preset === 'none' ? { agent: 'manual' } : {}), commands: { ...project.commands, test: lines(config.tests), build: lines(config.build) }, limits: { ...project.limits, maxAttempts: config.attempts } }); setMsg('Configuration saved'); onSaved(); } catch (e) { setMsg(e.message); } }}>Save configuration<//>
    </div><//>
    <${Section} title="Edit task"><div class="col"><textarea class="field" rows="3" value=${task} onInput=${(e) => setTask(e.target.value)} aria-label="Task"></textarea><div class="row"><${Btn} onClick=${async () => { try { await api_patch(project.id, { task }); setMsg('Saved'); onSaved(); } catch (e) { setMsg(e.message); } }}>Save task<//><span class="muted">${msg}</span></div></div><//>
    <${Section} title="Danger zone"><${Btn} kind="danger" onClick=${() => openModal({ title: `Remove project ${project.id}?`, body: html`<p>This removes ERA's records for the project (runs, ledger, working copies). Your folder is not touched.</p>`, footer: html`<${Btn} onClick=${closeModal}>Cancel<//><${Btn} kind="danger" onClick=${async () => { try { await del(`/api/projects/${project.id}`); closeModal(); navigate('projects'); } catch (e) { toast(e.message, 'bad'); } }}>Remove<//>` })}>Remove project<//><//>
  </div>`;
}

function History({ runs, id, spend }) {
  return html`<div class="col"><div class="muted">Agent spend: $${spend.agent_usd.toFixed(4)} of $${spend.limit_usd} (only dollar-metered agents are counted).</div>
    ${runs.length ? html`<table class="table"><thead><tr><th>Run</th><th>Operation</th><th>Status</th><th>Started</th><th></th></tr></thead><tbody>${[...runs].reverse().map((r) => html`<tr><td class="mono">${r.run_id}</td><td>${r.op}</td><td><${Badge} status=${r.status} /></td><td class="muted">${when(r.created_at)}</td><td><${Btn} size="sm" onClick=${async () => { try { const d = await get(`/api/projects/${id}/runs/${r.run_id}`); openModal({ title: `${r.op} · ${r.run_id}`, wide: true, body: html`<${Md} text=${d.report} />` }); } catch (e) { toast(e.message, 'bad'); } }}>Inspect report<//></td></tr>`)}</tbody></table>` : html`<${Empty} title="No runs">Start a review or modification from the Overview tab.<//>`}</div>`;
}

import { ReviewCenter } from './review.js';
const ReviewCenterLazy = ReviewCenter;
export { Md, put };
