import { html, useEffect, useState } from '../html.js';
import { ApiError, get, post } from '../api.js';
import { Badge, Btn, Callout, baseName, when } from '../ui.js';
import { navigate, openModal, set, state, toast, useStore } from '../store.js';
import { TASK_EXAMPLES } from '../model.js';
import { behaviorsFromRows } from '../rebuild-model.js';
import { BehaviorEditor, Checklist, ReferencePicker } from './rebuild.js';
import { Icon } from '../icons.js';

const MODES = ['ANALYZE', 'REVIEW', 'MODIFY', 'REBUILD', 'IMPROVE'];
const TEAMS = [['auto', 'Recommended'], ['claude-only', 'Claude Only'], ['codex-only', 'Codex Only'], ['claude+codex', 'Claude + Codex'], ['custom', 'Custom']];

const pick = async () => (window.eraDesktop?.pickPath ? window.eraDesktop.pickPath() : null);

function PathField({ label, value, onInput, placeholder, hint }) {
  return html`<label class="col" style="gap:4px"><span class="muted">${label}</span>
    <span class="row"><input type="text" class="grow" value=${value} placeholder=${placeholder} onInput=${(e) => onInput(e.target.value)} aria-label=${label} />
    ${window.eraDesktop?.pickPath ? html`<${Btn} size="sm" onClick=${async () => { const p = await pick(); if (p) onInput(p); }}>Browse…<//>` : null}</span>
    ${hint ? html`<span class="faint" style="font-size:var(--fs-xs)">${hint}</span>` : null}</label>`;
}

export function Home() {
  const s = useStore();
  const [text, setText] = useState('');
  const [mode, setMode] = useState(null);
  const [projectId, setProjectId] = useState('');
  const [folder, setFolder] = useState('');
  const [reference, setReference] = useState('');
  const [destination, setDestination] = useState('');
  const [authorization, setAuthorization] = useState('');
  const [runCmd, setRunCmd] = useState('');
  const [testCmds, setTestCmds] = useState('');
  const [acceptCmds, setAcceptCmds] = useState('');
  const [behaviorRows, setBehaviorRows] = useState([]);
  const [teamChoice, setTeamChoice] = useState('auto');
  const [custom, setCustom] = useState({ architect: '', implementer: '', reviewer: '' });
  const [plan, setPlan] = useState(null);
  const [consent, setConsent] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [teams, setTeams] = useState(null);
  const [providers, setProviders] = useState([]);
  const advanced = s.settings?.mode === 'advanced';

  useEffect(() => {
    const pf = state.prefill;
    if (pf) { setText(pf.text ?? ''); if (pf.project_id) { setProjectId(pf.project_id); setFolder(state.projects.find((p) => p.id === pf.project_id)?.source ?? ''); } set({ prefill: null }); }
  }, []);
  useEffect(() => { get('/api/agents/teams').then(setTeams).catch(() => {}); get('/api/agents').then((r) => setProviders(r.providers.filter((p) => p.capabilities.automated))).catch(() => {}); }, []);
  useEffect(() => { setPlan(null); }, [text, mode, projectId, folder, reference, destination, authorization, runCmd, testCmds, acceptCmds, behaviorRows, teamChoice, custom]);

  const needsRebuild = (mode ?? plan?.mode) === 'REBUILD' || /rebuild|reconstruct|re-?implement/i.test(text);
  const isAnalyze = (mode ?? plan?.mode) === 'ANALYZE';

  const request = () => {
    const team = teamChoice === 'auto' ? undefined : teamChoice === 'custom' ? { roles: Object.fromEntries(Object.entries(custom).map(([k, v]) => [k, v || null])) } : { preset: teamChoice };
    const rebuildish = needsRebuild;
    // Only what the user filled in is sent, so editing one field never wipes the saved configuration of an existing project.
    return { text, mode, project_id: projectId || undefined, folder: folder || undefined, target: isAnalyze ? folder || undefined : undefined, reference: reference || undefined, destination: destination || undefined, authorization: authorization || undefined, run_command: rebuildish && runCmd.trim() ? runCmd.trim() : undefined, test_commands: rebuildish && testCmds.trim() ? testCmds : undefined, accept_commands: rebuildish && acceptCmds.trim() ? acceptCmds : undefined, behaviors: rebuildish && behaviorRows.length ? behaviorsFromRows(behaviorRows) : undefined, team };
  };

  const doPlan = async () => {
    setBusy(true);
    setError(null);
    try {
      const p = await post('/api/tasks/plan', request());
      setPlan(p);
      setConsent(Object.fromEntries(p.remote_providers.map((id) => [id, false])));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const doStart = async () => {
    setBusy(true);
    setError(null);
    try {
      const { task } = await post('/api/tasks', { ...request(), confirm: true, consent_remote: Object.entries(consent).filter(([, v]) => v).map(([k]) => k), new_project_id: plan.project?.exists ? undefined : plan.project?.id });
      toast(`Started: ${task.mode.toLowerCase()} task`, 'ok');
      set({ currentProject: task.project_id ?? s.currentProject });
      navigate(task.mode === 'ANALYZE' ? ['analysis'] : task.mode === 'IMPROVE' ? ['improvement'] : ['projects', task.project_id]);
    } catch (err) {
      setError(err instanceof ApiError ? `${err.message}${err.detail?.blockers ? ` — ${err.detail.blockers.join(' ')}` : ''}` : String(err));
    } finally {
      setBusy(false);
    }
  };

  const allConsented = plan && plan.remote_providers.every((id) => consent[id]);
  const recent = s.tasks.slice(0, 4);
  const recentProjects = [...s.projects].sort((a, b) => new Date(b.latest_run?.updated_at ?? b.updated_at ?? b.created_at ?? 0) - new Date(a.latest_run?.updated_at ?? a.updated_at ?? a.created_at ?? 0)).slice(0, 2);
  const runningJobs = Object.values(s.jobs).filter((j) => j.status === 'running').length;
  const awaitingApproval = s.projects.filter((p) => p.status === 'awaiting-approval').length;
  const openProject = (id) => { set({ currentProject: id }); navigate(['projects', id]); };
  const focusTask = () => document.querySelector('[aria-label="Describe your task"]')?.focus();
  const modeIcons = { ANALYZE: 'analysis', REVIEW: 'shield', MODIFY: 'code', REBUILD: 'lab', IMPROVE: 'improvement' };

  return html`<div class="home dashboard">
    <header class="dashboard-welcome">
      <div><p class="dashboard-eyebrow">YOUR WORKSPACE</p><h1>Pick up where you left off.</h1><p class="dashboard-subtitle">Analyze, build and review. All in one workspace.</p></div>
      <${Btn} kind="primary" onClick=${focusTask}><${Icon} name="plus" size=${16} /> New task<//>
    </header>
    <div class="dashboard-layout">
    <div class="dashboard-main">
      <section class="dashboard-projects" aria-label="Recent projects">
        <div class="dashboard-section-head"><h2>Recent projects <span>${s.projects.length}</span></h2><button class="dashboard-text-link" onClick=${() => navigate('projects')}>View all <${Icon} name="arrowRight" size=${14} /></button></div>
        ${recentProjects.length ? html`<div class="dashboard-project-grid">${recentProjects.map((p) => html`<button class="dashboard-project-card" onClick=${() => openProject(p.id)}>
          <span class="dashboard-project-top"><span class="dashboard-project-icon"><${Icon} name="folder" size=${20} /></span><${Icon} name="arrowUpRight" size=${17} /></span>
          <strong class="truncate">${p.id}</strong><span class="dashboard-project-path truncate">${baseName(p.source ?? p.reference) || 'Project workspace'}</span>
          <span class="dashboard-project-meta"><span>${p.mode}</span><${Badge} status=${p.active_job ? 'running' : p.status} /></span>
        </button>`)}</div>` : html`<div class="dashboard-empty-project"><span class="dashboard-project-icon"><${Icon} name="folder" size=${21} /></span><div><h3>A home for your next project</h3><p>Start with a folder, or bring an existing repository.</p></div><button class="dashboard-text-link" onClick=${() => navigate('projects')}>Add project <${Icon} name="plus" size=${15} /></button></div>`}
      </section>
      <section class="dashboard-task" aria-label="New task">
        <div class="dashboard-section-head"><h2>What are we working on?</h2><span class="dashboard-section-hint">Plan first. Build with confidence.</span></div>
    <div class="composer home-composer">
      <textarea class="home-task-input" aria-label="Describe your task" placeholder="Describe your idea, a problem to solve, or code to explore…" value=${text} onInput=${(e) => setText(e.target.value)} onKeyDown=${(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') doPlan(); }}></textarea>
      <div class="chips" role="group" aria-label="Task type">
        ${MODES.map((m) => html`<button class="chip" aria-label=${m} aria-pressed=${mode === m} onClick=${() => setMode(mode === m ? null : m)} title=${mode === m ? 'Click to let ERA detect the type' : `Force ${m}`}>${m[0] + m.slice(1).toLowerCase()}</button>`)}
        <span class="faint" style="align-self:center;font-size:var(--fs-xs)">${mode ? 'type chosen by you' : text ? 'ERA detects the type from your text; the plan shows it' : ''}</span>
      </div>
      <div class="composer-bar">
        <select aria-label="Project" value=${projectId} onChange=${(e) => { setProjectId(e.target.value); const p = s.projects.find((x) => x.id === e.target.value); if (p) { setFolder(p.source ?? ''); setReference(p.reference ?? ''); setDestination(p.destination ?? ''); setAuthorization(p.authorization ?? ''); } }}>
          <option value="">New project from a folder…</option>
          ${s.projects.map((p) => html`<option value=${p.id}>${p.id} (${p.mode})</option>`)}
        </select>
        <select aria-label="Agent team" value=${teamChoice} onChange=${(e) => setTeamChoice(e.target.value)} title="Which coding agents work on this task">
          ${TEAMS.map(([v, l]) => { const t = teams?.presets.find((p) => p.name === v); const rec = v === 'auto' ? teams?.recommended : null; return html`<option value=${v}>${l}${t ? (t.ready ? ' ✓' : ' — not ready') : rec ? (rec.preset ? ` (${rec.preset})` : ' — none ready') : ''}</option>`; })}
        </select>
        <${Btn} kind="primary" class="right" disabled=${busy || (!text.trim() && !mode)} onClick=${doPlan}>${busy && !plan ? 'Planning…' : 'Plan task'} <kbd>⌘↵</kbd><//>
      </div>
      ${teamChoice === 'custom' ? html`<div class="row wrap">${['architect', 'implementer', 'reviewer'].map((r) => html`<label class="row"><span class="muted">${r}</span><select aria-label=${r} value=${custom[r]} onChange=${(e) => setCustom({ ...custom, [r]: e.target.value })}><option value="">none</option>${providers.map((p) => html`<option value=${p.id} disabled=${p.state !== 'ready' && p.state !== 'simulated'}>${p.id} (${p.state})</option>`)}</select></label>`)}</div>` : null}
      ${!projectId && !needsRebuild ? html`<${PathField} label=${isAnalyze ? 'File or folder to analyze' : 'Project folder'} value=${folder} onInput=${setFolder} placeholder="/path/to/your/project" hint=${isAnalyze ? 'Supported: Mach-O binaries, JavaScript apps and folders, archives. Unsupported targets are reported clearly.' : 'ERA works on an isolated copy; your folder is never changed without your approval.'} />` : projectId ? html`<div class="muted">Using project <b>${projectId}</b> · ${baseName(folder || reference)}</div>` : null}
      ${needsRebuild ? html`<div class="col rebuild-fields">
        <div class="col" style="gap:4px"><span class="muted">Authorized reference</span><${ReferencePicker} value=${reference} onChange=${setReference} /></div>
        <${PathField} label="New project destination (an empty or new folder; nothing is written there until you approve)" value=${destination} onInput=${setDestination} placeholder="/path/to/new-project" />
        <label class="col" style="gap:4px"><span class="muted">Why are you authorized to analyze this reference? (required)</span><textarea class="field" rows="2" value=${authorization} onInput=${(e) => setAuthorization(e.target.value)} aria-label="Authorization statement" placeholder="For example: I designed and own this page."></textarea></label>
        <details><summary class="muted" style="cursor:pointer">How will ERA know it worked? (optional extra checks)</summary><div class="col" style="margin-top:var(--space-3)">
          <p class="muted">Screenshots are compared visually automatically when a renderer is installed. For programs, add expected behaviors or commands; without any check ERA refuses to start, because any output would count as success.</p>
          <${BehaviorEditor} rows=${behaviorRows} onChange=${setBehaviorRows} screenshot=${/(^|\/)set-[0-9a-f]{8}$|\.(png|jpe?g|webp)$/i.test(reference)} />
          <label class="col" style="gap:4px"><span class="muted">Command that starts the new program (the behavior arguments are appended)</span><input type="text" value=${runCmd} onInput=${(e) => setRunCmd(e.target.value)} aria-label="Run command" placeholder="node app.js" /></label>
          <label class="col" style="gap:4px"><span class="muted">Acceptance commands that must succeed (one per line)</span><textarea class="field" rows="2" value=${acceptCmds} onInput=${(e) => setAcceptCmds(e.target.value)} aria-label="Acceptance commands"></textarea></label>
          <label class="col" style="gap:4px"><span class="muted">The new project's own test commands (one per line)</span><textarea class="field" rows="2" value=${testCmds} onInput=${(e) => setTestCmds(e.target.value)} aria-label="Test commands"></textarea></label>
        </div></details>
      </div>` : null}
    </div>

    ${error ? html`<${Callout} kind="bad" title="Cannot continue">${error}<//>` : null}

    ${plan ? html`<section class="panel" aria-label="Task plan"><header><h3>Plan</h3><${Badge} status=${plan.blockers.length ? 'failed' : 'ready'} label=${plan.blockers.length ? 'Needs input' : 'Ready'} /><span class="muted right">${plan.mode} · ${plan.classification}</span></header>
      <div class="body col">
        ${plan.checks?.length ? html`<${Checklist} checks=${plan.checks} />` : plan.blockers.map((x) => html`<${Callout} kind="bad">${x}<//>`)}
        ${plan.checks?.length ? plan.blockers.filter((x) => !plan.checks.some((c) => x.startsWith(c.message))).map((x) => html`<${Callout} kind="bad">${x}<//>`) : null}
        <div><h4>Steps</h4><ol style="margin:6px 0 0;padding-left:18px">${plan.stages.map((st) => html`<li>${st.label}</li>`)}</ol></div>
        ${plan.project ? html`<div class="kv"><dt>Project</dt><dd>${plan.project.exists ? 'existing' : 'new'}: <code>${plan.project.id}</code></dd>${plan.project.source ? html`<dt>Source</dt><dd class="mono">${plan.project.source}</dd>` : null}${plan.project.reference ? html`<dt>Reference</dt><dd class="mono">${plan.project.reference}</dd>` : null}${plan.project.destination ? html`<dt>New project</dt><dd class="mono">${plan.project.destination}</dd>` : null}</div>` : null}
        ${plan.team ? html`<div class="kv"><dt>Agent team</dt><dd>${plan.team.preset ?? 'custom'} <span class="muted">· ${plan.team_note}</span></dd></div>` : html`<div class="muted">${plan.team_note}</div>`}
        ${plan.warnings.map((w) => html`<${Callout} kind="warn">${w}<//>`)}
        ${plan.remote_providers.length ? html`<fieldset style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--space-3)"><legend class="muted">Authorize sending your source code</legend>
          ${plan.remote_providers.map((id) => html`<label class="check"><input type="checkbox" checked=${!!consent[id]} onChange=${(e) => setConsent({ ...consent, [id]: e.target.checked })} /><span>I authorize ERA to send this project's source code to <b>${id}</b>. Credential files, agent instruction files and secret-looking content are withheld or blocked automatically.</span></label>`)}</fieldset>` : null}
        <div class="row"><${Btn} kind="primary" disabled=${busy || plan.blockers.length > 0 || !allConsented} onClick=${doStart}>${busy ? 'Starting…' : 'Start task'}<//><${Btn} onClick=${() => setPlan(null)}>Edit<//>${plan.blockers.length === 0 && !allConsented ? html`<span class="muted">Tick the authorization above to start.</span>` : null}</div>
      </div></section>` : null}

    ${!plan && !text ? html`<div class="dashboard-examples" aria-label="Examples"><span class="dashboard-example-label">A place to start</span><div>${TASK_EXAMPLES.map((ex) => html`<button class="dashboard-example" aria-label=${`${ex.mode} ${ex.text}`} title=${ex.text} onClick=${() => { setText(ex.text); setMode(null); focusTask(); }}><${Icon} name=${modeIcons[ex.mode] ?? 'code'} size=${15} /><span>${ex.mode[0] + ex.mode.slice(1).toLowerCase()}</span><${Icon} name="arrowUpRight" size=${13} /></button>`)}</div></div>` : null}
      </section>
      <div class="dashboard-note"><${Icon} name="shield" size=${14} /><span>Your workspace, your control. Task changes need your approval before they are applied.</span></div>
    </div>
    <aside class="dashboard-aside" aria-label="Workspace overview">
      <section class="dashboard-overview">
        <div class="dashboard-aside-head"><span class="dashboard-eyebrow">WORKSPACE OVERVIEW</span><${Icon} name="activity" size=${17} /></div>
        <div class="dashboard-summary"><div><strong>${s.projects.length}</strong><span>Projects</span></div><div><strong>${runningJobs}</strong><span>Running</span></div><div><strong>${awaitingApproval}</strong><span>To review</span></div></div>
        <div class="dashboard-system-row"><span>Control plane</span><${Badge} status=${s.conn} /></div>
        <div class="dashboard-system-row"><span>REA engine</span><${Badge} status=${s.overview?.rea?.available ? 'ready' : s.overview ? 'unavailable' : 'connecting'} /></div>
        <button class="dashboard-overview-link" onClick=${() => navigate('tools')}>Manage tools <${Icon} name="arrowUpRight" size=${14} /></button>
      </section>
      <section class="dashboard-agents">
        <div class="dashboard-section-head"><h2>Your agents</h2><button class="dashboard-icon-link" aria-label="Manage agents" onClick=${() => navigate('agents')}><${Icon} name="arrowUpRight" size=${16} /></button></div>
        ${providers.length ? html`<div class="dashboard-provider-list">${providers.map((p) => html`<button class="dashboard-provider" onClick=${() => navigate('agents')}><span class="dashboard-provider-symbol"><${Icon} name="terminal" size=${16} /></span><span class="grow truncate">${p.name ?? p.id}</span><${Badge} status=${p.state} /></button>`)}</div>` : html`<p class="dashboard-quiet-text">Connect your coding agents in the Agent Command Center.</p>`}
      </section>
      <section class="dashboard-activity" aria-label="Recent tasks">
        <div class="dashboard-section-head"><h2>Recent activity</h2><${Icon} name="clock" size=${16} /></div>
        ${recent.length ? html`<div class="dashboard-activity-list">${recent.map((t) => html`<button class="dashboard-activity-item" onClick=${() => navigate(t.mode === 'ANALYZE' ? ['analysis'] : t.mode === 'IMPROVE' ? ['improvement'] : ['projects', t.project_id])}><span class="dashboard-activity-icon"><${Icon} name=${modeIcons[t.mode] ?? 'activity'} size=${16} /></span><span class="dashboard-activity-copy"><strong>${t.mode[0] + t.mode.slice(1).toLowerCase()}</strong><span class="truncate">${t.text}</span><span class="dashboard-activity-meta"><${Badge} status=${t.status} /><span>${when(t.created_at)}</span></span></span></button>`)}</div>` : html`<div class="dashboard-quiet-activity"><span class="dashboard-activity-icon"><${Icon} name="clock" size=${18} /></span><p>A fresh start.<br/><span>Your tasks will appear here.</span></p></div>`}
      </section>
      <div class="dashboard-mode-note"><${Icon} name="command" size=${15} /><p>${advanced ? 'Advanced mode' : 'Simple mode'}<span>${advanced ? 'Your full workbench is ready.' : 'Switch to Advanced for the full workbench.'}</span></p></div>
    </aside>
    </div>
  </div>`;
}
export { openModal };
