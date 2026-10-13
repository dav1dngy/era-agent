import { html, useEffect, useState } from '../html.js';
import { ApiError, get, post } from '../api.js';
import { Badge, Btn, Callout, baseName, when } from '../ui.js';
import { navigate, openModal, set, state, toast, useStore } from '../store.js';
import { TASK_EXAMPLES } from '../model.js';

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
  useEffect(() => { setPlan(null); }, [text, mode, projectId, folder, reference, destination, authorization, teamChoice, custom]);

  const needsRebuild = (mode ?? plan?.mode) === 'REBUILD' || /rebuild|reconstruct|re-?implement/i.test(text);
  const isAnalyze = (mode ?? plan?.mode) === 'ANALYZE';

  const request = () => {
    const team = teamChoice === 'auto' ? undefined : teamChoice === 'custom' ? { roles: Object.fromEntries(Object.entries(custom).map(([k, v]) => [k, v || null])) } : { preset: teamChoice };
    return { text, mode, project_id: projectId || undefined, folder: folder || undefined, target: isAnalyze ? folder || undefined : undefined, reference: reference || undefined, destination: destination || undefined, authorization: authorization || undefined, team };
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

  return html`<div class="home">
    <div><h1>What would you like to build, analyze, or improve?</h1><div class="tagline" style="margin-top:6px">Reverse. Analyze. Build. Verify. Evolve.</div></div>
    <div class="composer">
      <textarea aria-label="Describe your task" placeholder="Describe what you want ERA to do…" value=${text} onInput=${(e) => setText(e.target.value)} onKeyDown=${(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') doPlan(); }}></textarea>
      <div class="chips" role="group" aria-label="Task type">
        ${MODES.map((m) => html`<button class="chip" aria-pressed=${mode === m} onClick=${() => setMode(mode === m ? null : m)} title=${mode === m ? 'Click to let ERA detect the type' : `Force ${m}`}>${m}</button>`)}
        <span class="faint" style="align-self:center;font-size:var(--fs-xs)">${mode ? 'type chosen by you' : text ? 'ERA detects the type from your text; the plan shows it' : ''}</span>
      </div>
      <div class="composer-bar">
        <select aria-label="Project" value=${projectId} onChange=${(e) => { setProjectId(e.target.value); const p = s.projects.find((x) => x.id === e.target.value); if (p) setFolder(p.source ?? ''); }}>
          <option value="">New project from a folder…</option>
          ${s.projects.map((p) => html`<option value=${p.id}>${p.id} (${p.mode})</option>`)}
        </select>
        <select aria-label="Agent team" value=${teamChoice} onChange=${(e) => setTeamChoice(e.target.value)} title="Which coding agents work on this task">
          ${TEAMS.map(([v, l]) => { const t = teams?.presets.find((p) => p.name === v); const rec = v === 'auto' ? teams?.recommended : null; return html`<option value=${v}>${l}${t ? (t.ready ? ' ✓' : ' — not ready') : rec ? (rec.preset ? ` (${rec.preset})` : ' — none ready') : ''}</option>`; })}
        </select>
        <${Btn} kind="primary" class="right" disabled=${busy || (!text.trim() && !mode)} onClick=${doPlan}>${busy && !plan ? 'Planning…' : 'Plan task'} <kbd>⌘↵</kbd><//>
      </div>
      ${teamChoice === 'custom' ? html`<div class="row wrap">${['architect', 'implementer', 'reviewer'].map((r) => html`<label class="row"><span class="muted">${r}</span><select aria-label=${r} value=${custom[r]} onChange=${(e) => setCustom({ ...custom, [r]: e.target.value })}><option value="">none</option>${providers.map((p) => html`<option value=${p.id} disabled=${p.state !== 'ready' && p.state !== 'simulated'}>${p.id} (${p.state})</option>`)}</select></label>`)}</div>` : null}
      ${!projectId ? html`<${PathField} label=${isAnalyze ? 'File or folder to analyze' : 'Project folder'} value=${folder} onInput=${setFolder} placeholder="/path/to/your/project" hint=${isAnalyze ? 'Supported: Mach-O binaries, JavaScript apps and folders, archives. Unsupported targets are reported clearly.' : 'ERA works on an isolated copy; your folder is never changed without your approval.'} />` : html`<div class="muted">Using project <b>${projectId}</b> · ${baseName(folder)}</div>`}
      ${needsRebuild ? html`<div class="col">
        <${PathField} label="Authorized reference (application or file)" value=${reference} onInput=${setReference} placeholder="/path/to/reference" />
        <${PathField} label="New project destination (empty folder)" value=${destination} onInput=${setDestination} placeholder="/path/to/new-project" />
        <label class="col" style="gap:4px"><span class="muted">Why are you authorized to analyze this reference? (required)</span><textarea class="field" rows="2" value=${authorization} onInput=${(e) => setAuthorization(e.target.value)} aria-label="Authorization statement"></textarea></label>
      </div>` : null}
    </div>

    ${error ? html`<${Callout} kind="bad" title="Cannot continue">${error}<//>` : null}

    ${plan ? html`<section class="panel" aria-label="Task plan"><header><h3>Plan</h3><${Badge} status=${plan.blockers.length ? 'failed' : 'ready'} label=${plan.blockers.length ? 'Needs input' : 'Ready'} /><span class="muted right">${plan.mode} · ${plan.classification}</span></header>
      <div class="body col">
        ${plan.blockers.map((b) => html`<${Callout} kind="bad">${b}<//>`)}
        <div><h4>Steps</h4><ol style="margin:6px 0 0;padding-left:18px">${plan.stages.map((st) => html`<li>${st.label}</li>`)}</ol></div>
        ${plan.project ? html`<div class="kv"><dt>Project</dt><dd>${plan.project.exists ? 'existing' : 'new'}: <code>${plan.project.id}</code></dd><dt>Source</dt><dd class="mono">${plan.project.source}</dd></div>` : null}
        ${plan.team ? html`<div class="kv"><dt>Agent team</dt><dd>${plan.team.preset ?? 'custom'} <span class="muted">· ${plan.team_note}</span></dd></div>` : html`<div class="muted">${plan.team_note}</div>`}
        ${plan.warnings.map((w) => html`<${Callout} kind="warn">${w}<//>`)}
        ${plan.remote_providers.length ? html`<fieldset style="border:1px solid var(--border);border-radius:var(--radius);padding:var(--space-3)"><legend class="muted">Authorize sending your source code</legend>
          ${plan.remote_providers.map((id) => html`<label class="check"><input type="checkbox" checked=${!!consent[id]} onChange=${(e) => setConsent({ ...consent, [id]: e.target.checked })} /><span>I authorize ERA to send this project's source code to <b>${id}</b>. Credential files, agent instruction files and secret-looking content are withheld or blocked automatically.</span></label>`)}</fieldset>` : null}
        <div class="row"><${Btn} kind="primary" disabled=${busy || plan.blockers.length > 0 || !allConsented} onClick=${doStart}>${busy ? 'Starting…' : 'Start task'}<//><${Btn} onClick=${() => setPlan(null)}>Edit<//>${plan.blockers.length === 0 && !allConsented ? html`<span class="muted">Tick the authorization above to start.</span>` : null}</div>
      </div></section>` : null}

    ${!plan && !text ? html`<div class="examples" aria-label="Examples">${TASK_EXAMPLES.map((ex) => html`<button class="example" onClick=${() => { setText(ex.text); setMode(null); }}><b>${ex.mode}</b>${ex.text}</button>`)}</div>` : null}

    ${recent.length ? html`<section><h4 style="margin-bottom:var(--space-2)">Recent tasks</h4><div class="col" style="gap:var(--space-2)">${recent.map((t) => html`<div class="panel" style="padding:var(--space-3);cursor:pointer" onClick=${() => navigate(t.mode === 'ANALYZE' ? ['analysis'] : t.mode === 'IMPROVE' ? ['improvement'] : ['projects', t.project_id])}>
      <div class="row"><b>${t.mode}</b><span class="truncate muted grow">${t.text}</span><${Badge} status=${t.status === 'running' ? 'running' : t.status === 'complete' ? 'complete' : t.status} /><span class="faint">${when(t.created_at)}</span></div>
      <div class="row" style="margin-top:6px">${t.stages.map((st) => html`<${Badge} status=${st.status} label=${`${st.label}`} />`)}</div></div>`)}</div></section>` : null}
    ${advanced ? null : html`<p class="faint" style="text-align:center;font-size:var(--fs-xs)">Simple mode. Switch to Advanced (top right) for the full workbench, terminal and evidence views.</p>`}
  </div>`;
}
export { openModal };
