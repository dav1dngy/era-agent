import { html, useEffect, useRef, useState } from '../html.js';
import { ApiError, del, get, post, streamTerminal } from '../api.js';
import { Badge, Btn, Callout, Spinner } from '../ui.js';
import { navigate, set, toast, useStore } from '../store.js';
import { jobLog } from '../main.js';

const TABS = [['logs', 'Execution logs'], ['terminal', 'Terminal'], ['tests', 'Build & tests'], ['problems', 'Problems']];

function Logs() {
  const s = useStore();
  const jobs = Object.values(s.jobs).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const [sel, setSel] = useState(null);
  const job = jobs.find((j) => j.id === sel) ?? jobs[0];
  const [initial, setInitial] = useState([]);
  useEffect(() => { if (job) get(`/api/jobs/${job.id}`).then((j) => setInitial(j.log_tail.map((t) => ({ text: t.replace(/^! /, ''), err: t.startsWith('! ') })))).catch(() => {}); }, [job?.id]);
  void s.logTick;
  if (!job) return html`<div class="log faint">No jobs yet. Start a task to see its real output here.</div>`;
  const live = jobLog(job.id);
  const lines = live.length ? live : initial;
  return html`<div class="row" style="padding:4px var(--space-3);border-bottom:1px solid var(--border)"><select aria-label="Job" value=${job.id} onChange=${(e) => setSel(e.target.value)}>${jobs.slice(0, 20).map((j) => html`<option value=${j.id}>${j.label} — ${j.status}</option>`)}</select><${Badge} status=${job.status} />${job.error ? html`<span class="error-text truncate">${job.error.split('\n')[0]}</span>` : null}</div>
    <div class="log" role="log" aria-label="Execution log" tabindex="0">${lines.length ? lines.slice(-400).map((l) => html`<div class=${l.err ? 'err' : ''}>${l.text}</div>`) : html`<span class="faint">No output.</span>`}</div>`;
}

function Terminal() {
  const s = useStore();
  const [term, setTerm] = useState(null);
  const [root, setRoot] = useState('workspace');
  const [err, setErr] = useState(null);
  const host = useRef();
  const project = s.currentProject;
  const open = async () => {
    setErr(null);
    try { setTerm(await post('/api/terminals', { project_id: project, root })); } catch (e) { setErr(e instanceof ApiError ? e.message : String(e)); }
  };
  useEffect(() => {
    if (!term || !host.current) return undefined;
    let stop = () => {};
    let ro;
    let xt;
    (async () => {
      const [{ Terminal: XTerm }, { FitAddon }] = await Promise.all([import('/vendor/xterm.mjs'), import('/vendor/addon-fit.mjs')]);
      xt = new XTerm({ fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-mono'), fontSize: 12, cursorBlink: true, theme: document.documentElement.dataset.theme === 'light' ? { background: '#ffffff', foreground: '#17191c', cursor: '#17191c' } : { background: '#0f1012', foreground: '#e7e8ea' }, allowProposedApi: false });
      const fit = new FitAddon();
      xt.loadAddon(fit);
      xt.open(host.current);
      const refit = () => { try { fit.fit(); post(`/api/terminals/${term.id}/resize`, { cols: xt.cols, rows: xt.rows }).catch(() => {}); } catch { /* not visible yet */ } };
      refit();
      ro = new ResizeObserver(refit);
      ro.observe(host.current);
      xt.onData((d) => post(`/api/terminals/${term.id}/input`, { data: d }).catch(() => {}));
      stop = streamTerminal(term.id, (m) => { if (m.type === 'data') xt.write(m.data); else if (m.type === 'exit') xt.write(`\r\n[shell exited ${m.code ?? ''}]\r\n`); });
    })().catch((e) => setErr(e.message));
    return () => { stop(); ro?.disconnect(); xt?.dispose(); };
  }, [term?.id]);
  useEffect(() => () => { if (term) del(`/api/terminals/${term.id}`).catch(() => {}); }, [term?.id]);
  if (!project) return html`<div class="log faint">Select a project first.</div>`;
  if (!s.settings.permissions.terminal) return html`<div class="log"><${Callout} kind="warn" title="The terminal is off">A terminal runs commands. Enable it under Settings → Permissions. It runs in ERA's sandbox, scoped to one project directory, with no network.<//><div style="margin-top:8px"><${Btn} onClick=${() => navigate(['settings', 'permissions'])}>Open permissions<//></div></div>`;
  if (!term) return html`<div class="log col"><div class="row"><span class="muted">Directory</span><select aria-label="Terminal directory" value=${root} onChange=${(e) => setRoot(e.target.value)}><option value="workspace">Isolated working copy (latest run)</option><option value="source" disabled=${!s.settings.permissions.directEdit}>Original project${s.settings.permissions.directEdit ? '' : ' (needs Direct edit)'}</option></select><${Btn} kind="primary" onClick=${open}>Open terminal<//></div>${err ? html`<span class="error-text">${err}</span>` : null}</div>`;
  return html`<div style="display:flex;flex-direction:column;flex:1;min-height:0"><div class="row" style="padding:2px var(--space-3);border-bottom:1px solid var(--border)"><span class="badge ok plain">${term.sandboxed ? 'sandboxed · no network' : 'NOT sandboxed'}</span><span class="muted truncate">${term.cwd}</span><${Btn} size="sm" class="right" onClick=${() => { del(`/api/terminals/${term.id}`).catch(() => {}); setTerm(null); }}>Close<//></div><div class="term-host" ref=${host} aria-label="Terminal"></div>${err ? html`<span class="error-text">${err}</span>` : null}</div>`;
}

function Tests() {
  const s = useStore();
  const [d, setD] = useState(null);
  useEffect(() => { if (s.currentProject) get(`/api/projects/${s.currentProject}/runs/latest`).then(setD).catch(() => setD(null)); else setD(null); }, [s.currentProject, s.projects.find((p) => p.id === s.currentProject)?.status]);
  if (!d) return html`<div class="log faint">No run for the current project.</div>`;
  const fin = d.finalize;
  return html`<div class="log"><div class="muted">Run ${d.run.run_id} · ${d.run.op} · ${d.run.status}</div>${fin?.verification ? [...fin.verification.build, ...fin.verification.test, ...fin.verification.acceptance].map((r) => html`<div class=${r.ok ? '' : 'err'}>${r.ok ? '✓' : '✗'} ${r.kind}: ${r.command} → ${r.timed_out ? 'timed out' : `exit ${r.exit_code}`}</div>`) : html`<span class="faint">No verification results in this run yet.</span>`}${fin?.verification?.tests ? html`<div class="muted" style="margin-top:6px">${fin.verification.tests.passed.length} passing · ${fin.verification.tests.failed.length} failing</div>` : null}</div>`;
}

function Problems() {
  const s = useStore();
  const [d, setD] = useState(null);
  useEffect(() => { if (s.currentProject) get(`/api/projects/${s.currentProject}/runs/latest`).then(setD).catch(() => setD(null)); }, [s.currentProject, s.projects.find((p) => p.id === s.currentProject)?.status]);
  const f = [...(d?.run.results.findings?.findings ?? []), ...(d?.finalize?.review?.rounds.at(-1)?.accepted ?? [])];
  if (!d) return html`<div class="log faint">No run for the current project.</div>`;
  return html`<div class="log">${f.length ? f.map((x) => html`<div><span class=${`sev-${x.severity}`}>[${x.severity}]</span> ${x.title} <a class="mono" href=${`#/workbench/${s.currentProject}?file=${encodeURIComponent(x.locations[0]?.file ?? '')}&line=${x.locations[0]?.line ?? ''}&root=workspace`}>${x.locations[0]?.file}${x.locations[0]?.line ? `:${x.locations[0].line}` : ''}</a></div>`) : html`<span class="faint">No problems reported by the latest run.</span>`}</div>`;
}

export function BottomPanel() {
  const s = useStore();
  return html`<section class="bottom-panel" aria-label="Panel" style="height:100%">
    <div class="tabs" role="tablist">${TABS.map(([k, l]) => html`<button class="tab" role="tab" aria-selected=${s.bottomTab === k} onClick=${() => set({ bottomTab: k })}>${l}</button>`)}<span class="right row" style="padding:0 8px"><${Btn} size="sm" class="ghost" aria-label="Close panel" onClick=${() => set({ bottomOpen: false })}>×<//></span></div>
    <div style="display:flex;flex-direction:column;flex:1;min-height:0;overflow:auto">${s.bottomTab === 'logs' ? html`<${Logs} />` : s.bottomTab === 'terminal' ? html`<${Terminal} key=${s.currentProject} />` : s.bottomTab === 'tests' ? html`<${Tests} />` : html`<${Problems} />`}</div></section>`;
}
export { Spinner, toast };
