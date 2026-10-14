import { html, useEffect, useState } from '../html.js';
import { get } from '../api.js';
import { Badge, Btn, duration, when } from '../ui.js';
import { navigate, useStore } from '../store.js';

export function ContextPanel() {
  const s = useStore();
  const p = s.projects.find((x) => x.id === s.currentProject);
  const [agents, setAgents] = useState(null);
  const [detail, setDetail] = useState(null);
  useEffect(() => { get('/api/agents').then(setAgents).catch(() => {}); }, []);
  useEffect(() => { if (p?.latest_run) get(`/api/projects/${p.id}/runs/latest`).then(setDetail).catch(() => setDetail(null)); else setDetail(null); }, [p?.id, p?.latest_run?.run_id, p?.status]);
  const pending = s.projects.filter((x) => x.status === 'awaiting-approval');
  const jobs = Object.values(s.jobs).filter((j) => ['queued', 'running'].includes(j.status));
  const roles = p ? p.team?.roles ?? { implementer: p.agent } : null;
  return html`<div class="col" style="gap:var(--space-5)">
    <section><h4>Pending approvals</h4>${pending.length ? pending.map((x) => html`<div class="row" style="padding:4px 0"><b class="truncate grow">${x.id}</b><${Btn} size="sm" kind="primary" onClick=${() => navigate(['projects', x.id, 'review'])}>Review<//></div>`) : html`<span class="muted">None.</span>`}</section>
    <section><h4>Execution</h4>${jobs.length ? jobs.map((j) => html`<div style="padding:4px 0"><div class="row"><${Badge} status=${j.status} /><span class="truncate">${j.label}</span></div><div class="faint" style="font-size:var(--fs-xs)">${when(j.started_at ?? j.created_at)}</div></div>`) : html`<span class="muted">Idle.</span>`}</section>
    ${p ? html`<section><h4>Current task</h4><div class="muted" style="margin-bottom:4px">${p.id} · ${p.mode}</div><div>${p.task || html`<span class="faint">No task text.</span>`}</div></section>
      <section><h4>Agents on this project</h4>${roles ? Object.entries(roles).filter(([, a]) => a).map(([r, a]) => { const prov = agents?.providers.find((x) => x.id === a); return html`<div class="row" style="padding:2px 0"><span class="muted" style="width:90px">${r}</span><b>${a}</b>${prov ? html`<${Badge} status=${prov.state} />` : null}</div>`; }) : null}</section>
      <section><h4>File changes</h4>${detail?.finalize?.files?.length ? detail.finalize.files.map((f) => html`<div class="row"><span class=${`status-${f.status} mono`}>${f.status}</span><span class="truncate" title=${f.path}>${f.path}</span></div>`) : html`<span class="muted">No changes yet.</span>`}</section>
      <section><h4>Evidence</h4>${detail?.run.results?.analysis ? html`<span class="muted">See the run's analysis in the Overview and Findings tabs.</span>` : detail?.run.results?.findings ? html`<span>${detail.run.results.findings.findings.length} finding(s)</span>` : html`<span class="muted">None yet.</span>`}</section>`
    : html`<section><h4>Project</h4><span class="muted">Select a project to see its agents, changes and evidence here.</span></section>`}
    <section><h4>Last run time</h4><span class="muted">${p?.latest_run ? `${duration(Date.now() - new Date(p.latest_run.created_at).getTime())} ago` : '—'}</span></section>
  </div>`;
}
