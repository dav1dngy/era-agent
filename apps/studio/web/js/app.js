import { html, useEffect, useMemo, useRef, useState } from './html.js';
import { get } from './api.js';
import { Badge, Modal } from './ui.js';
import { closeModal, navigate, set, state, useStore } from './store.js';
import { applySettings, saveSettings } from './main.js';
import { Views } from './views/index.js';
import { BottomPanel } from './views/bottom.js';
import { ContextPanel } from './views/context.js';

const NAV = [
  { id: 'home', label: 'New Task', icon: '+', adv: false },
  { id: 'projects', label: 'Projects', icon: '▤', adv: false },
  { id: 'analysis', label: 'Analysis', icon: '◎', adv: true },
  { id: 'lab', label: 'Project Lab', icon: '⚗', adv: true },
  { id: 'improvement', label: 'Improvement Lab', icon: '↻', adv: true },
  { id: 'agents', label: 'Agent Command Center', icon: '◈', adv: false },
  { id: 'tools', label: 'Tools', icon: '⚙', adv: true },
  { id: 'settings', label: 'Settings', icon: '☰', adv: false },
];

function Sidebar() {
  const s = useStore();
  const advanced = s.settings?.mode === 'advanced';
  const current = s.route.path[0];
  const pending = s.projects.filter((p) => p.status === 'awaiting-approval').length;
  return html`<nav class="sidebar" aria-label="Main">
    ${NAV.filter((n) => advanced || !n.adv).map((n) => html`<button class="nav-item" aria-current=${current === n.id || (n.id === 'projects' && current === 'workbench') ? 'page' : undefined} onClick=${() => navigate(n.id)} title=${n.label}>
      <span class="ico" aria-hidden="true">${n.icon}</span><span class="label">${n.label}</span>
      ${n.id === 'projects' && pending ? html`<span class="badge warn plain right" style="margin-left:auto" title="Awaiting your approval">${pending}</span>` : null}</button>`)}
    <div class="sidebar-foot"><button class="nav-item" onClick=${() => set({ palette: true })} title="Command palette"><span class="ico" aria-hidden="true">⌘</span><span class="label">Commands <kbd>⌘K</kbd></span></button></div>
  </nav>`;
}

function Topbar() {
  const s = useStore();
  const mode = s.settings?.mode ?? 'simple';
  const project = s.projects.find((p) => p.id === s.currentProject);
  const toggleMode = (m) => saveSettings({ mode: m }).catch(() => {});
  return html`<header class="topbar">
    <button class="btn ghost icon" aria-label="Toggle sidebar" onClick=${() => set({ sidebarCollapsed: !state.sidebarCollapsed })}>☰</button>
    <div class="brand">ERA <small>Studio</small></div>
    <select aria-label="Current project" value=${s.currentProject ?? ''} onChange=${(e) => { set({ currentProject: e.target.value || null }); if (e.target.value) navigate(['projects', e.target.value]); }} style="max-width:240px">
      <option value="">${s.projects.length ? 'No project selected' : 'No projects yet'}</option>
      ${s.projects.map((p) => html`<option value=${p.id}>${p.id} · ${p.mode}</option>`)}
    </select>
    ${project ? html`<${Badge} status=${project.status} />` : null}
    <div class="right row">
      <span class="muted" title=${`Event stream: ${s.conn}`}><${Badge} status=${s.conn === 'live' ? 'live' : s.conn === 'offline' ? 'offline' : 'connecting'} /></span>
      <div class="seg" role="group" aria-label="Presentation mode">
        <button aria-pressed=${mode === 'simple'} onClick=${() => toggleMode('simple')}>Simple</button>
        <button aria-pressed=${mode === 'advanced'} onClick=${() => toggleMode('advanced')}>Advanced</button>
      </div>
      <button class="btn ghost icon" aria-label="Switch theme" title="Switch theme" onClick=${() => saveSettings({ appearance: { theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' } })}>◐</button>
    </div>
  </header>`;
}

function Statusbar() {
  const s = useStore();
  const o = s.overview;
  const running = Object.values(s.jobs).filter((j) => j.status === 'running' || j.status === 'queued').length;
  return html`<footer class="statusbar" role="contentinfo">
    <span>ERA ${o?.app.version ?? ''}</span>
    <span>REA ${o?.rea.available ? o.rea.version : 'unavailable'}</span>
    <span>${o?.sandbox.available ? 'sandbox: macOS' : 'no sandbox'}</span>
    <span>${running ? `${running} job${running > 1 ? 's' : ''} running` : 'idle'}</span>
    <span class="right">loopback ${o?.listener.port ?? ''} · ${s.settings?.mode ?? ''} mode</span>
  </footer>`;
}

function CommandPalette() {
  const s = useStore();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef();
  const cmds = useMemo(() => {
    const list = [
      ['New task', () => navigate('home')], ['Projects', () => navigate('projects')], ['Agent Command Center', () => navigate('agents')], ['Settings', () => navigate('settings')],
      ['Analysis workspace', () => navigate('analysis')], ['Project Lab', () => navigate('lab')], ['Improvement Lab', () => navigate('improvement')], ['Tools & MCP', () => navigate('tools')],
      ['Switch to Simple mode', () => saveSettings({ mode: 'simple' })], ['Switch to Advanced mode', () => saveSettings({ mode: 'advanced' })],
      ['Toggle theme', () => saveSettings({ appearance: { theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' } })],
      ['Toggle bottom panel', () => set({ bottomOpen: !state.bottomOpen })], ['Toggle sidebar', () => set({ sidebarCollapsed: !state.sidebarCollapsed })],
      ...s.projects.flatMap((p) => [[`Open project ${p.id}`, () => navigate(['projects', p.id])], [`Open ${p.id} in the workbench`, () => navigate(['workbench', p.id])], ...(p.status === 'awaiting-approval' ? [[`Review & approve ${p.id}`, () => navigate(['projects', p.id, 'review'])]] : [])]),
    ];
    return list;
  }, [s.projects]);
  const shown = cmds.filter(([n]) => n.toLowerCase().includes(q.toLowerCase())).slice(0, 12);
  useEffect(() => input.current?.focus(), []);
  const run = (c) => { set({ palette: false }); c?.[1](); };
  return html`<div class="scrim" onMouseDown=${(e) => e.target === e.currentTarget && set({ palette: false })}>
    <div class="modal palette" role="dialog" aria-modal="true" aria-label="Command palette">
      <input ref=${input} type="text" placeholder="Type a command…" aria-label="Command" value=${q} onInput=${(e) => { setQ(e.target.value); setSel(0); }}
        onKeyDown=${(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setSel((x) => Math.min(shown.length - 1, x + 1)); } else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((x) => Math.max(0, x - 1)); } else if (e.key === 'Enter') run(shown[sel]); else if (e.key === 'Escape') set({ palette: false }); }} />
      <ul role="listbox">${shown.map((c, i) => html`<li role="option" aria-selected=${i === sel} onMouseEnter=${() => setSel(i)} onClick=${() => run(c)}>${c[0]}</li>`)}${shown.length ? null : html`<li class="muted">No matching command</li>`}</ul>
    </div></div>`;
}

export function App() {
  const s = useStore();
  const [bottomH, setBottomH] = useState(260);
  const advanced = s.settings?.mode === 'advanced';
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); set({ palette: !state.palette }); }
      else if (mod && e.key === 'b') { e.preventDefault(); set({ sidebarCollapsed: !state.sidebarCollapsed }); }
      else if (mod && e.key === 'j') { e.preventDefault(); set({ bottomOpen: !state.bottomOpen }); }
      else if (mod && e.key === ',') { e.preventDefault(); navigate('settings'); }
      else if (mod && e.shiftKey && e.key.toLowerCase() === 'm') { e.preventDefault(); saveSettings({ mode: state.settings?.mode === 'advanced' ? 'simple' : 'advanced' }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { if (s.settings) applySettings(s.settings); }, [s.settings?.appearance?.theme]);

  if (s.error) return html`<div class="home"><h1>ERA Studio</h1><div class="callout bad" role="alert"><b>Cannot start</b><div>${s.error}</div></div></div>`;
  if (!s.ready) return html`<div class="home" aria-busy="true"><h1>ERA Studio</h1><p class="muted" style="text-align:center">Connecting to the ERA control plane…</p></div>`;

  const View = Views[s.route.path[0]] ?? Views.home;
  const showBottom = advanced && s.bottomOpen;
  const showContext = advanced && s.contextOpen && !['settings', 'workbench', 'agents', 'tools'].includes(s.route.path[0]);
  return html`<div class="shell">
    <${Topbar} />
    <div class=${`frame ${s.sidebarCollapsed ? 'collapsed' : ''}`}>
      <${Sidebar} />
      <div class="main-col" style=${showBottom ? `grid-template-rows: 1fr ${bottomH}px` : ''}>
        <main class="workspace" id="main" tabindex="-1" aria-live="polite"><${View} key=${`${s.route.path[0]}:${s.route.path[1] ?? ''}`} route=${s.route} /></main>
        ${showBottom ? html`<div style="position:relative"><div class="resizer" role="separator" aria-label="Resize bottom panel" aria-orientation="horizontal" aria-valuemin="120" aria-valuemax="640" aria-valuenow=${bottomH} tabindex="0" onKeyDown=${(e) => { if (['ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); setBottomH((h) => Math.max(120, Math.min(640, h + (e.key === 'ArrowUp' ? 20 : -20)))); } }} onMouseDown=${(e) => { const y0 = e.clientY; const h0 = bottomH; const mv = (ev) => setBottomH(Math.max(120, Math.min(640, h0 - (ev.clientY - y0)))); const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); }; window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up); }}></div><${BottomPanel} height=${bottomH} /></div>` : null}
      </div>
      <aside class=${`context-panel ${showContext ? '' : 'hidden'}`} aria-label="Context"><${ContextPanel} /></aside>
    </div>
    <${Statusbar} />
    ${s.palette ? html`<${CommandPalette} />` : null}
    ${s.modal ? html`<${Modal} ...${s.modal} onClose=${closeModal}>${s.modal.body}<//>` : null}
    <div class="toasts" role="status" aria-live="polite">${s.toasts.map((t) => html`<div class=${`toast ${t.kind}`}>${t.message}</div>`)}</div>
  </div>`;
}
export { get };
