import { html, useEffect, useState } from '../html.js';
import { ApiError, get, post } from '../api.js';
import { Badge, Btn, Callout, Empty, Md, Section, Spinner, when } from '../ui.js';
import { closeModal, navigate, openModal, toast, useStore } from '../store.js';
import { PatchView } from './review.js';

const act = async (path, body = {}) => {
  try { const r = await post(path, body); toast(`${r.job?.label ?? 'Action'} started`, 'ok'); return r; } catch (e) { toast(e instanceof ApiError ? e.message : String(e), 'bad', 9000); return null; }
};

function CycleDetail({ id, onChange, checkout }) {
  const s = useStore();
  const [d, setD] = useState(null);
  const [agent, setAgent] = useState('');
  const [providers, setProviders] = useState([]);
  useEffect(() => { setD(null); get(`/api/improvement/cycles/${id}`).then(setD).catch((e) => setD({ error: e.message })); get('/api/agents').then((r) => setProviders(r.providers.filter((p) => p.capabilities.automated))).catch(() => {}); }, [id, Object.values(s.jobs).filter((j) => j.kind?.startsWith('improve')).map((j) => j.status).join()]);
  if (!d) return html`<${Spinner} />`;
  if (d.error) return html`<${Callout} kind="bad">${d.error}<//>`;
  const c = d.cycle;
  const sum = d.summary;
  const busy = Object.values(s.jobs).some((j) => j.kind?.startsWith('improve') && ['queued', 'running'].includes(j.status));
  const chosen = providers.find((p) => p.id === agent);
  const ref = d.candidate_ref;
  const approve = () => openModal({ title: `Integrate ${id}?`, wide: true, body: html`<div class="col"><${Callout} kind="warn">This changes ERA itself: the evaluated experiment is merged into the stable branch as a new version. It can be rolled back.<//>
    <dl class="kv"><dt>Experiment</dt><dd>${sum.title}</dd><dt>Evaluated candidate</dt><dd class="mono">${ref?.commit}</dd><dt>Patch sha256</dt><dd class="mono">${ref?.patch_sha256}</dd><dt>Decision</dt><dd>${sum.summary}</dd></dl><p class="muted">ERA refuses if the branch changed after evaluation, the stable branch moved, or a protected path was touched.</p></div>`,
    footer: html`<${Btn} onClick=${closeModal}>Cancel<//><${Btn} kind="primary" data-autofocus="true" onClick=${async () => { closeModal(); await act(`/api/improvement/cycles/${id}/approve`, { confirm: true, candidate_commit: ref.commit, patch_sha256: ref.patch_sha256 }); onChange(); }}>Approve and integrate<//>` });
  return html`<div class="col">
    <div class="row wrap"><h2>${sum.title ?? id}</h2><${Badge} status=${c.status} /><span class="muted mono">${id}</span></div>
    <p class="muted">${sum.hypothesis}</p>
    <div class="row wrap">
      ${c.status === 'proposed' ? html`<select aria-label="Coding agent" value=${agent} onChange=${(e) => setAgent(e.target.value)}><option value="">Choose a coding agent…</option>${providers.map((p) => html`<option value=${p.id} disabled=${!['ready', 'simulated'].includes(p.state)}>${p.id} (${p.state})</option>`)}</select>
        <${Btn} kind="primary" disabled=${!agent || busy || !checkout.available} onClick=${() => {
          if (chosen?.capabilities.remote) openModal({ title: 'Send ERA source code to a remote provider?', body: html`<p>${agent} sends ERA's own source code to an external service for this experiment.</p>`, footer: html`<${Btn} onClick=${closeModal}>Cancel<//><${Btn} kind="primary" onClick=${async () => { closeModal(); await act(`/api/improvement/cycles/${id}/implement`, { agent, confirm_remote: true }); onChange(); }}>I authorize this<//>` });
          else act(`/api/improvement/cycles/${id}/implement`, { agent }).then(onChange);
        }}>Implement with agent<//>` : null}
      ${['proposed', 'implemented', 'inconclusive'].includes(c.status) || c.status === 'proposed' ? html`<${Btn} disabled=${busy} onClick=${() => act(`/api/improvement/cycles/${id}/evaluate`).then(onChange)}>Evaluate<//>` : null}
      ${c.status === 'awaiting-approval' ? html`<${Btn} kind="primary" disabled=${busy || !ref} onClick=${approve}>Approve…<//><${Btn} onClick=${() => act(`/api/improvement/cycles/${id}/decline`, { reason: 'declined in ERA Studio' }).then(onChange)}>Decline<//><${Btn} disabled=${busy} onClick=${() => act(`/api/improvement/cycles/${id}/rebase`).then(onChange)}>Rebase<//>` : null}
      ${!['integrated', 'declined', 'cancelled', 'abandoned', 'rejected'].includes(c.status) ? html`<${Btn} kind="danger" disabled=${busy} onClick=${() => act(`/api/improvement/cycles/${id}/cancel`).then(onChange)}>Cancel experiment<//>` : null}
    </div>
    ${c.status === 'proposed' ? html`<${Callout}>Manual alternative: edit the worktree <code class="mono">${c.worktree}</code> yourself, then Evaluate.<//>` : null}
    ${sum.summary ? html`<${Callout} kind=${sum.accepted ? 'ok' : 'warn'} title=${sum.accepted ? 'Accepted by the evaluator' : 'Evaluation result'}>${sum.summary}<//>` : null}
    ${d.guards.length ? html`<${Section} title="Guards"><div class="col">${d.guards.map((g) => html`<div class="row"><${Badge} status=${g.ok ? 'ok' : 'failed'} label=${g.ok ? 'pass' : 'fail'} /><b>${g.name}</b><span class="muted">${g.detail ?? ''}</span></div>`)}</div><//>` : null}
    ${d.benchmark ? html`<${Section} title="Benchmark comparison"><pre class="mono">${JSON.stringify(d.benchmark, null, 2).slice(0, 4000)}</pre><//>` : null}
    ${d.patch ? html`<${Section} title="Generated diff"><${PatchView} patch=${d.patch} /><//>` : null}
    <${Section} title="Report"><${Md} text=${d.report} /><//>
  </div>`;
}

export function ImprovementView({ route }) {
  const s = useStore();
  const [o, setO] = useState(null);
  const [err, setErr] = useState(null);
  const sel = route.path[1] ?? null;
  const load = () => get('/api/improvement').then((r) => { setO(r); setErr(null); }).catch((e) => setErr(e.message));
  const jobSig = Object.values(s.jobs).filter((j) => j.kind?.startsWith('improve') || j.kind === 'project.x').map((j) => `${j.id}${j.status}`).join();
  useEffect(() => { load(); }, [jobSig]);
  if (err) return html`<div class="page"><${Callout} kind="bad">${err}<//></div>`;
  if (!o) return html`<div class="page"><${Spinner} /></div>`;
  const co = o.checkout;
  const busy = Object.values(s.jobs).some((j) => j.kind?.startsWith('improve') && ['queued', 'running'].includes(j.status));
  return html`<div class="page wide">
    <div class="page-head"><div class="grow"><h1>Improvement Lab</h1><p>ERA analyzes itself with REA, proposes a hypothesis, tests it in a sandbox against benchmarks, and integrates only what you approve. Studio only drives the existing lab; its safety controls are unchanged.</p></div>
      <${Btn} disabled=${!co.available || busy} onClick=${() => act('/api/improvement/self-analyze').then(load)}>Run self-analysis<//><${Btn} kind="primary" disabled=${!co.available || busy} onClick=${() => act('/api/improvement/propose').then(load)}>Propose experiment<//></div>
    ${!co.available ? html`<${Callout} kind="warn" title="No ERA checkout configured">${co.reason}<div style="margin-top:8px"><${Btn} size="sm" onClick=${() => navigate(['settings', 'workspaces'])}>Open Workspaces settings<//></div><//>` : html`<div class="row wrap"><span class="muted">Checkout <code>${co.root}</code> · branch ${co.branch} · ${co.clean ? 'clean' : 'has uncommitted changes'}</span><${Badge} status="ready" label=${`Current version ${o.current_version ?? '?'}`} /></div>`}
    <div style="display:grid;grid-template-columns:minmax(340px,420px) 1fr;gap:var(--space-5);align-items:start">
      <div class="col">
        <${Section} title=${`Experiments (${o.cycles.length})`} body=${false}>${o.cycles.length ? o.cycles.map((c) => html`<button class="tree-item" aria-selected=${sel === c.cycle_id} style="height:auto;padding:8px 12px;flex-direction:column;align-items:flex-start;gap:2px" onClick=${() => navigate(['improvement', c.cycle_id])}><span class="row"><${Badge} status=${c.status} /><b class="truncate">${c.title ?? c.cycle_id}</b></span><span class="faint mono" style="font-size:var(--fs-xs)">${c.cycle_id}${c.version ? ` → ${c.version}` : ''}</span></button>`) : html`<div class="body muted">No experiments yet. Run a self-analysis, then propose one.</div>`}<//>
        <${Section} title="Versions" body=${false}>${o.versions.length ? html`<table class="table"><tbody>${[...o.versions].reverse().slice(0, 12).map((v, i) => html`<tr><td><b>${v.tag}</b>${i === 0 ? html` <span class="badge ok plain">current</span>` : null}</td><td class="muted">${v.date?.slice(0, 10)}</td><td class="truncate" style="max-width:150px" title=${v.subject}>${v.subject}</td><td>${i > 0 && co.available ? html`<${Btn} size="sm" disabled=${busy} onClick=${() => openModal({ title: `Roll back to ${v.tag}?`, body: html`<p>Restores the content of ${v.tag} as a NEW version (history is kept; the working tree must be clean). This is how ERA reverts an accepted improvement.</p>`, footer: html`<${Btn} onClick=${closeModal}>Cancel<//><${Btn} kind="danger" onClick=${async () => { closeModal(); await act('/api/improvement/rollback', { version: v.tag, confirm: true }); load(); }}>Roll back<//>` })}>Roll back<//>` : null}</td></tr>`)}</tbody></table>` : html`<div class="body muted">No version tags found.</div>`}<//>
        <${Section} title="Self-analyses" body=${false}>${o.self_analyses.length ? html`<div>${o.self_analyses.slice(0, 6).map((a) => html`<div style="padding:6px 12px;border-bottom:1px solid var(--border)"><span class="mono">${a.id}</span> <span class="muted">${a.findings === null ? '' : `${a.findings} finding${a.findings === 1 ? '' : 's'}`}${a.rea_runs === null ? '' : ` · ${a.rea_runs} REA runs`} ${a.created_at ? when(a.created_at) : ''}</span></div>`)}</div>` : html`<div class="body muted">None yet.</div>`}<//>
        <${Section} title="Rollback history" body=${false}>${o.rollbacks.length ? html`<table class="table"><tbody>${o.rollbacks.map((r) => html`<tr><td>${r.at?.slice(0, 16)}</td><td>${r.to} → ${r.version}</td></tr>`)}</tbody></table>` : html`<div class="body muted">No rollbacks recorded.</div>`}<//>
      </div>
      <div>${sel ? html`<${CycleDetail} id=${sel} onChange=${load} checkout=${co} />` : o.awaiting_approval.length ? html`<${Callout} kind="warn" title="Waiting for your decision">${o.awaiting_approval.map((c) => html`<div><a href=${`#/improvement/${c.cycle_id}`}>${c.title}</a></div>`)}<//>` : html`<${Empty} title="Select an experiment">Experiments show their hypothesis, guards, benchmark comparison, diff and report here.<//>`}</div>
    </div></div>`;
}
export { Empty };
