import { html, useEffect, useState } from '../html.js';
import { ApiError, download, get, post } from '../api.js';
import { Badge, Btn, Callout, Empty, Md, Section, Spinner, duration, short, when } from '../ui.js';
import { navigate, toast, useStore } from '../store.js';
import { layoutGraph } from '../model.js';
import { jobLog } from '../main.js';

function GraphView({ graph }) {
  const [hover, setHover] = useState(null);
  if (!graph.nodes.length || !graph.edges.length) return html`<${Empty} title="Nothing to draw">${graph.note ?? 'No relationships in the evidence.'}<//>`;
  const { positions, edges } = layoutGraph(graph, { width: 900, height: 460 });
  return html`<div><svg class="graph" viewBox="0 0 900 460" role="img" aria-label=${`Relationship graph: ${graph.nodes.length} nodes, ${edges.length} edges, from REA evidence`}>
    ${edges.map((e) => { const a = positions.get(e.from); const b = positions.get(e.to); return html`<line x1=${a.x} y1=${a.y} x2=${b.x} y2=${b.y} style=${hover && (hover === e.from || hover === e.to) ? 'stroke:var(--accent);stroke-width:1.6' : ''}><title>${e.from} ${e.kind} ${e.to}</title></line>`; })}
    ${graph.nodes.filter((n) => positions.has(n.id)).map((n) => { const p = positions.get(n.id); return html`<g tabindex="0" onMouseEnter=${() => setHover(n.id)} onMouseLeave=${() => setHover(null)} onFocus=${() => setHover(n.id)} onBlur=${() => setHover(null)}><circle class=${`n-${n.kind}`} cx=${p.x} cy=${p.y} r="5"><title>${n.kind}: ${n.label}</title></circle><text x=${p.x + 8} y=${p.y + 3}>${n.label.length > 34 ? `…${n.label.slice(-33)}` : n.label}</text></g>`; })}
  </svg><div class="muted" style="font-size:var(--fs-xs)">${graph.nodes.length} nodes · ${edges.length} edges, all taken from REA evidence${graph.truncated ? ' (truncated at 300 nodes)' : ''}. ${['module', 'function', 'external', 'dependency', 'entry'].map((k) => html`<span class="badge neutral plain" style="margin-left:4px"><svg width="8" height="8"><circle cx="4" cy="4" r="4" class=${`n-${k}`} style="fill:currentColor" /></svg>${k}</span>`)}</div></div>`;
}

function AnalysisDetail({ id }) {
  const [a, setA] = useState(null);
  const [tab, setTab] = useState('report');
  const [q, setQ] = useState('');
  useEffect(() => { setA(null); get(`/api/analyses/${id}`).then(setA).catch((e) => setA({ error: e.message })); }, [id]);
  if (!a) return html`<${Spinner} />`;
  if (a.error) return html`<${Callout} kind="bad">${a.error}<//>`;
  const groups = Object.entries(a.fact_groups);
  return html`<div class="col">
    <div class="row wrap"><b>${a.target.path.split('/').pop()}</b><${Badge} status=${a.status === 'succeeded' ? 'succeeded' : 'failed'} label=${a.status} /><span class="badge neutral plain">${a.target.kind}</span><span class="muted">REA ${a.engine.version} · ${a.runs.length} REA run(s) · ${a.facts.length} facts</span>
      <span class="right row"><${Btn} size="sm" onClick=${() => download(`${id}.md`, a.report, 'text/markdown')}>Export report<//><${Btn} size="sm" onClick=${() => download(`${id}.json`, JSON.stringify({ analysis_id: id, target: a.target, engine: a.engine, status: a.status, runs: a.runs, facts: a.facts }, null, 2), 'application/json')}>Export JSON<//></span></div>
    <div class="tabs" role="tablist" style="border:0;border-bottom:1px solid var(--border);background:transparent">${[['report', 'Report'], ['facts', 'Facts'], ['evidence', 'Evidence'], ['graph', 'Structure']].map(([k, l]) => html`<button class="tab" role="tab" aria-selected=${tab === k} onClick=${() => setTab(k)}>${l}</button>`)}</div>
    ${tab === 'report' ? html`<${Md} text=${a.report} />` : null}
    ${tab === 'facts' ? html`<div class="col"><input type="search" placeholder="Filter facts" aria-label="Filter facts" value=${q} onInput=${(e) => setQ(e.target.value)} />${groups.map(([cat, items]) => { const shown = items.filter((x) => x.toLowerCase().includes(q.toLowerCase())); return shown.length ? html`<${Section} title=${`${cat} (${shown.length}/${items.length})`}><div class="mono" style="max-height:240px;overflow:auto">${shown.slice(0, 300).map((x) => html`<div class="truncate" title=${x}>${x}</div>`)}${shown.length > 300 ? html`<div class="muted">… ${shown.length - 300} more (use the filter or export)</div>` : null}</div><//>` : null; })}</div>` : null}
    ${tab === 'evidence' ? html`<div class="col"><table class="table"><thead><tr><th>REA operation</th><th>Status</th><th>Time</th><th>Evidence ID</th></tr></thead><tbody>${a.runs.map((r) => html`<tr><td>${r.label}</td><td><${Badge} status=${r.status === 'succeeded' ? 'succeeded' : 'failed'} label=${r.status} />${r.errors.length ? html`<div class="error-text">${r.errors[0]}</div>` : null}</td><td>${duration(r.duration_ms)}</td><td class="mono">${short(r.evidence_id, 22)}</td></tr>`)}</tbody></table>
      ${a.evidence.map((e) => html`<div class="panel" style="padding:var(--space-3)"><b>${e.operation}</b> <span class="muted">${e.provider}</span>${e.coverage ? html`<div class="muted">coverage: ${typeof e.coverage === 'string' ? e.coverage : JSON.stringify(e.coverage)}</div>` : null}${e.limitations.length ? html`<div class="muted">Limitations: ${e.limitations.join('; ')}</div>` : null}${e.function ? html`<details><summary>${e.function.name} @ ${e.function.address}</summary><pre class="mono">${e.function.pseudocode}</pre></details>` : null}</div>`)}</div>` : null}
    ${tab === 'graph' ? html`<${GraphView} graph=${a.graph} />` : null}
  </div>`;
}

export function AnalysisView({ route }) {
  const s = useStore();
  const selected = route.path[1] ?? null;
  const [target, setTarget] = useState('');
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState(null);
  const [opts, setOpts] = useState({ runtime: false, no_decompile: false });
  const [list, setList] = useState([]);
  const [jobId, setJobId] = useState(null);
  const job = jobId ? s.jobs[jobId] : null;
  const reload = () => get('/api/analyses').then((r) => setList(r.analyses)).catch(() => {});
  useEffect(() => { reload(); }, [job?.status]);
  const inspect = async () => {
    setErr(null);
    try { setInfo(await post('/api/analysis/detect', { target })); } catch (e) { setInfo(null); setErr(e.message); }
  };
  const start = async () => {
    try { const { job: j } = await post('/api/analysis', { target, ...opts }); setJobId(j.id); toast('Analysis started', 'ok'); } catch (e) { setErr(e instanceof ApiError ? e.message : String(e)); }
  };
  const lines = job ? jobLog(job.id) : [];
  void s.logTick;
  useEffect(() => { if (job && job.status === 'succeeded' && job.result?.analysis_id) navigate(['analysis', job.result.analysis_id]); }, [job?.status]);
  return html`<div class="page wide">
    <div class="page-head"><div class="grow"><h1>Analysis</h1><p>Reverse-engineering analysis with the original REA engine. ERA reports what REA can and cannot examine; it does not claim universal compatibility.</p></div></div>
    <div style="display:grid;grid-template-columns:minmax(360px,440px) 1fr;gap:var(--space-5);align-items:start">
      <div class="col">
        <${Section} title="Target"><div class="col">
          <span class="row"><input type="text" class="grow" aria-label="Analysis target path" placeholder="/path/to/binary, app, folder or archive" value=${target} onInput=${(e) => setTarget(e.target.value)} />${window.eraDesktop?.pickPath ? html`<${Btn} size="sm" onClick=${async () => { const p = await window.eraDesktop.pickPath(); if (p) setTarget(p); }}>Browse…<//>` : null}</span>
          <div class="row"><${Btn} onClick=${inspect} disabled=${!target}>Inspect target<//></div>
          ${err ? html`<${Callout} kind="bad">${err}<//>` : null}
          ${info ? html`<div class="col"><dl class="kv"><dt>Detected</dt><dd><b>${info.kind}</b> — ${info.reason}</dd><dt>Supported</dt><dd>${info.supported ? html`<${Badge} status="ready" label="Supported" />` : html`<${Badge} status="unavailable" label="Not supported" />`}</dd><dt>REA engine</dt><dd>${info.rea.available ? `version ${info.rea.version}` : html`<span class="error-text">unavailable: ${info.rea.error}</span>`}</dd><dt>Native decompiler</dt><dd>${info.rea.decompiler_available ? 'available' : 'not configured (decompilation will be skipped; run era rea doctor)'}</dd></dl>
            ${!info.supported ? html`<${Callout} kind="warn">ERA cannot analyze this kind of target. Supported targets: Mach-O binaries, JavaScript applications/folders, and archives.<//>` : null}
            <label class="check"><input type="checkbox" checked=${opts.runtime} disabled=${!s.settings.permissions.runtimeCapture} onChange=${(e) => setOpts({ ...opts, runtime: e.target.checked })} /><span>Capture runtime behavior (runs the target in ERA's sandbox)${s.settings.permissions.runtimeCapture ? '' : html` <span class="muted">— off: enable Settings → Permissions → Runtime capture</span>`}</span></label>
            <label class="check"><input type="checkbox" checked=${opts.no_decompile} onChange=${(e) => setOpts({ ...opts, no_decompile: e.target.checked })} /><span>Skip decompilation</span></label>
            <${Btn} kind="primary" disabled=${!info.supported || !info.rea.available || (job && ['queued', 'running'].includes(job.status))} onClick=${start}>Start analysis<//></div>` : null}</div><//>
        ${job ? html`<${Section} title=${job.label} actions=${html`<${Badge} status=${job.status} />${['running', 'queued'].includes(job.status) ? html`<${Btn} size="sm" onClick=${() => post(`/api/jobs/${job.id}/cancel`).catch((e) => toast(e.message, 'bad'))}>Cancel<//>` : null}`} body=${false}><div class="log" style="max-height:220px" role="log">${lines.length ? lines.slice(-60).map((l) => html`<div class=${l.err ? 'err' : ''}>${l.text}</div>`) : html`<span class="faint">Waiting for output…</span>`}</div>${job.error ? html`<div class="body error-text">${job.error}</div>` : null}<//>` : null}
        <${Section} title="History" body=${false}>${list.length ? html`<div>${list.map((x) => html`<button class="tree-item" aria-selected=${selected === x.analysis_id} style="height:auto;padding:8px 12px;align-items:flex-start;flex-direction:column;gap:2px" onClick=${() => navigate(['analysis', x.analysis_id])}><span><b>${x.target.path.split('/').pop()}</b> <span class="badge neutral plain">${x.target.kind}</span> <${Badge} status=${x.status === 'succeeded' ? 'succeeded' : 'failed'} label=${x.status} /></span><span class="faint" style="font-size:var(--fs-xs)">${x.facts} facts · ${x.rea_runs} REA runs · ${when(x.at)}</span></button>`)}</div>` : html`<div class="body muted">No analyses yet.</div>`}<//>
      </div>
      <div>${selected ? html`<${AnalysisDetail} id=${selected} />` : html`<${Empty} title="Select an analysis">Inspect a target and start an analysis, or pick one from the history.<//>`}</div>
    </div></div>`;
}
