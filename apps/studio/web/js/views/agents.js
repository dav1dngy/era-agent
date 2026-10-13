import { html, useEffect, useState } from '../html.js';
import { get, post } from '../api.js';
import { Badge, Btn, Callout, Empty, Section, Spinner, duration, useInterval, when } from '../ui.js';
import { navigate, toast, useStore } from '../store.js';
import { saveSettings } from '../main.js';

const TEAM_LABEL = { 'claude-only': 'Claude Only', 'codex-only': 'Codex Only', 'claude+codex': 'Claude + Codex', custom: 'Custom Agent Configuration' };
const ROLE_LABEL = { architect: 'Architecture & planning', implementer: 'Implementation', reviewer: 'Independent review' };

export function AgentsView() {
  const s = useStore();
  const [agents, setAgents] = useState(null);
  const [teams, setTeams] = useState(null);
  const [act, setAct] = useState(null);
  const load = (fresh = false) => Promise.all([get(`/api/agents${fresh ? '?fresh=1' : ''}`).then(setAgents), get('/api/agents/teams').then(setTeams), get('/api/agents/activity').then(setAct)]).catch((e) => toast(e.message, 'bad'));
  useEffect(() => { load(); }, []);
  useInterval(() => get('/api/agents/activity').then(setAct).catch(() => {}), 3000);
  const cfg = s.settings.agents;
  if (!agents || !teams) return html`<div class="page"><${Spinner} /></div>`;
  const eligible = (role) => agents.providers.filter((p) => p.capabilities.automated && (role === 'implementer' ? p.capabilities.write : p.capabilities.readOnlyMode !== 'none'));
  const setPreset = (p) => saveSettings({ agents: { preset: p, ...(p !== 'custom' ? { roles: { architect: null, implementer: null, reviewer: null } } : {}) } }).catch((e) => toast(e.message, 'bad'));
  const active = (act?.activity ?? []).filter((a) => a.status === 'running');
  const waiting = (act?.activity ?? []).filter((a) => a.status === 'waiting');
  const failed = (act?.activity ?? []).filter((a) => a.status === 'failed' || a.status === 'stalled').slice(0, 8);
  const done = (act?.activity ?? []).filter((a) => a.status === 'done').slice(0, 10);
  const jobs = Object.values(s.jobs).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 8);
  return html`<div class="page wide">
    <div class="page-head"><div class="grow"><h1>Agent Command Center</h1><p>What is installed, signed in and doing work. Everything here is read from the adapters and from run records: no agent is shown as connected unless its CLI answered.</p></div><${Btn} onClick=${() => load(true)}>Re-check providers<//></div>

    <${Section} title="Providers" body=${false}><table class="table" aria-label="Providers"><thead><tr><th>Provider</th><th>State</th><th>Installed</th><th>Signed in</th><th>Capabilities</th><th>Data</th><th>Cost</th></tr></thead><tbody>
      ${agents.providers.map((p) => html`<tr><td><b>${p.id}</b><div class="muted" style="font-size:var(--fs-xs)">${p.version ?? p.description}</div></td>
        <td><${Badge} status=${p.state} />${p.state === 'not-signed-in' || p.state === 'unavailable' ? html`<div class="muted" style="font-size:var(--fs-xs)">${p.detail}</div>` : null}</td>
        <td>${p.installed ? 'yes' : 'no'}</td><td>${p.authenticated === null ? html`<span class="faint">n/a</span>` : p.authenticated ? 'yes' : 'no'}</td>
        <td><div class="row wrap" style="gap:4px">${['read', 'write', 'execute'].filter((c) => p.capabilities[c]).map((c) => html`<span class="badge neutral plain">${c}</span>`)}<span class="badge neutral plain">read-only: ${p.capabilities.readOnlyMode}</span></div></td>
        <td>${p.capabilities.remote ? html`<span class="badge warn plain">sends code to a remote service</span>` : html`<span class="badge ok plain">local</span>`}</td>
        <td>${p.metered ? 'metered ($)' : p.capabilities.automated ? 'tokens only' : '—'}</td></tr>`)}</tbody></table><//>

    <${Section} title="Team" actions=${html`<span class="muted">Used as the default for new tasks</span>`}>
      <div class="col">
        <div class="row wrap" role="radiogroup" aria-label="Agent team">${[...teams.presets.map((p) => p.name)].map((name) => { const p = teams.presets.find((x) => x.name === name); return html`<label class="check panel" style="padding:var(--space-3);min-width:210px"><input type="radio" name="team" checked=${cfg.preset === name} onChange=${() => setPreset(name)} /><span><b>${TEAM_LABEL[name] ?? name}</b><div class="muted" style="font-size:var(--fs-xs)">${p.roles ? `architect ${p.roles.architect} · implementer ${p.roles.implementer} · reviewer ${p.roles.reviewer}` : 'choose each role'}</div>${p.roles ? (p.ready ? html`<${Badge} status="ready" />` : html`<div class="muted" style="font-size:var(--fs-xs)">Not ready: ${p.not_ready.map((n) => `${n.id} (${n.state})`).join(', ')}</div>`) : null}</span></label>`; })}</div>
        ${cfg.preset === 'custom' ? html`<div class="row wrap">${Object.keys(ROLE_LABEL).map((r) => html`<label class="col" style="gap:4px"><span class="muted">${ROLE_LABEL[r]}</span><select aria-label=${ROLE_LABEL[r]} value=${cfg.roles[r] ?? ''} onChange=${(e) => saveSettings({ agents: { roles: { ...cfg.roles, [r]: e.target.value || null } } }).catch((er) => toast(er.message, 'bad'))}><option value="">none</option>${eligible(r).map((p) => html`<option value=${p.id}>${p.id} (${p.state})</option>`)}</select></label>`)}</div>` : null}
        <div class="row wrap"><span class="muted">Reverse engineering: <b>REA</b> (always) · Orchestration, tests and approvals: <b>ERA</b> · Review rounds</span>
          <select aria-label="Correction rounds" value=${cfg.review.rounds} onChange=${(e) => saveSettings({ agents: { review: { rounds: Number(e.target.value) } } })}>${[0, 1, 2, 3].map((n) => html`<option value=${n}>${n} correction round${n === 1 ? '' : 's'}</option>`)}</select>
          <select aria-label="Blocking severity" value=${cfg.review.block_on} onChange=${(e) => saveSettings({ agents: { review: { block_on: e.target.value } } })}>${['critical', 'high', 'medium', 'none'].map((n) => html`<option value=${n}>blocks on ${n}</option>`)}</select></div>
        ${teams.recommended.preset ? html`<span class="muted">Recommended now: <b>${TEAM_LABEL[teams.recommended.preset]}</b>. ${teams.recommended.reason}</span>` : html`<${Callout} kind="warn">${teams.recommended.reason}<//>`}
      </div><//>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:var(--space-5)">
      <${Section} title=${`Active (${active.length})`}>${active.length ? active.map((a) => html`<div class="row" style="padding:4px 0"><${Spinner} /><b>${a.agent ?? a.role}</b><span class="muted">${a.step}</span><a class="right" href=${`#/projects/${a.project_id}`}>${a.project_id}</a></div>`) : html`<span class="muted">No agent is working right now.</span>`}<//>
      <${Section} title=${`Waiting on you (${waiting.length})`}>${waiting.length ? waiting.map((a) => html`<div class="row" style="padding:4px 0"><${Badge} status="waiting" label="Approval" /><span>${a.project_id}</span><${Btn} size="sm" kind="primary" class="right" onClick=${() => navigate(['projects', a.project_id, 'review'])}>Review<//></div>`) : html`<span class="muted">No pending approvals.</span>`}<//>
      <${Section} title="Errors">${failed.length ? failed.map((a) => html`<div style="padding:4px 0"><${Badge} status=${a.status} /> <b>${a.step}</b> <span class="muted">${a.project_id}</span>${a.error ? html`<div class="error-text">${a.error}</div>` : null}</div>`) : html`<span class="muted">No failed steps in recent runs.</span>`}<//>
      <${Section} title="Completed recently">${done.length ? done.map((a) => html`<div class="row" style="padding:2px 0"><${Badge} status="done" /><span>${a.step}</span><span class="muted">${a.agent ?? a.role}</span><span class="faint right">${duration(a.duration_ms)}</span></div>`) : html`<span class="muted">Nothing yet.</span>`}<//>
    </div>

    <${Section} title="Usage and cost" body=${false}>${act?.usage.length ? html`<table class="table"><thead><tr><th>Agent</th><th>Calls</th><th>OK / failed</th><th>Time</th><th>Input tokens</th><th>Output tokens</th><th>Cost</th></tr></thead><tbody>${act.usage.map((u) => html`<tr><td><b>${u.agent}</b></td><td>${u.calls}</td><td>${u.ok} / ${u.failed}</td><td>${duration(u.duration_ms)}</td><td>${u.input_tokens || '—'}</td><td>${u.output_tokens || '—'}</td><td>${u.cost_reported ? `$${u.cost_usd.toFixed(4)}` : html`<span class="muted">not reported by this provider</span>`}</td></tr>`)}</tbody></table>` : html`<div class="body muted">No agent calls recorded yet.</div>`}<//>

    <${Section} title="Jobs" body=${false}>${jobs.length ? html`<table class="table"><thead><tr><th>Job</th><th>Status</th><th>Started</th><th></th></tr></thead><tbody>${jobs.map((j) => html`<tr><td>${j.label}</td><td><${Badge} status=${j.status} /></td><td class="muted">${when(j.started_at ?? j.created_at)}</td><td>${['queued', 'running'].includes(j.status) ? html`<${Btn} size="sm" kind="danger" onClick=${() => post(`/api/jobs/${j.id}/cancel`, {}).catch((e) => toast(e.message, 'bad'))}>Cancel<//>` : null}</td></tr>`)}</tbody></table>` : html`<div class="body muted">No jobs yet.</div>`}<//>
  </div>`;
}
export { Empty };
