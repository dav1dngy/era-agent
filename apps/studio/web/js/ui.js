// Shared components. Status vocabulary maps backend states to labels/colours in one place.
import { html, useEffect, useRef, useState } from './html.js';
import { closeModal, state } from './store.js';

export const STATUS = {
  succeeded: ['ok', 'Succeeded'], complete: ['ok', 'Complete'], applied: ['ok', 'Applied'], ready: ['ok', 'Ready'], done: ['ok', 'Done'], approved: ['ok', 'Approved'], integrated: ['ok', 'Integrated'],
  running: ['info', 'Running'], queued: ['neutral', 'Queued'], live: ['ok', 'Live'], connecting: ['warn', 'Connecting'],
  'awaiting-approval': ['warn', 'Awaiting approval'], 'awaiting-plan': ['warn', 'Plan ready for review'], 'awaiting-implementation': ['warn', 'Waiting for you'], waiting: ['warn', 'Waiting'], proposed: ['neutral', 'Proposed'], pending: ['neutral', 'Pending'],
  failed: ['bad', 'Failed'], rejected: ['bad', 'Rejected'], unavailable: ['bad', 'Unavailable'], offline: ['bad', 'Offline'], stalled: ['bad', 'Stalled'], 'not-signed-in': ['warn', 'Not signed in'],
  cancelled: ['neutral', 'Cancelled'], interrupted: ['warn', 'Interrupted'], 'rolled-back': ['neutral', 'Rolled back'], created: ['neutral', 'Created'], none: ['neutral', 'None'],
  simulated: ['warn', 'Simulated'], manual: ['neutral', 'Manual'], skipped: ['neutral', 'Skipped'], inconclusive: ['warn', 'Inconclusive'], declined: ['neutral', 'Declined'],
};
export const Badge = ({ status, label }) => {
  const [kind, text] = STATUS[status] ?? ['neutral', status ?? 'Unknown'];
  return html`<span class=${`badge ${kind}`}>${label ?? text}</span>`;
};

export const Btn = ({ kind = '', size = '', class: extra = '', children, ...rest }) => html`<button type="button" ...${rest} class=${`btn ${kind} ${size} ${extra}`.replace(/\s+/g, ' ').trim()}>${children}</button>`;
export const Spinner = () => html`<span class="spinner" role="status" aria-label="Working"></span>`;
export const Empty = ({ title, children }) => html`<div class="empty"><div style="font-weight:600;color:var(--text)">${title}</div><div>${children}</div></div>`;
export const Callout = ({ kind = '', title, children }) => html`<div class=${`callout ${kind}`} role=${kind === 'bad' ? 'alert' : 'note'}>${title ? html`<b>${title}</b>` : null}<div>${children}</div></div>`;
export const Section = ({ title, actions, children, body = true }) => html`<section class="panel"><header><h3>${title}</h3><div class="row right">${actions}</div></header>${body ? html`<div class="body">${children}</div>` : children}</section>`;

export function Modal({ title, children, footer, onClose = closeModal, wide }) {
  const ref = useRef();
  useEffect(() => {
    const prev = document.activeElement;
    ref.current?.querySelector('[data-autofocus], button, input, textarea, select')?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const f = [...ref.current.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled);
        if (!f.length) return;
        const first = f[0];
        const last = f.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, []);
  return html`<div class="scrim" onMouseDown=${(e) => e.target === e.currentTarget && onClose()}>
    <div class="modal" role="dialog" aria-modal="true" aria-label=${title} ref=${ref} style=${wide ? 'width:min(860px,94vw)' : ''}>
      <header><h2>${title}</h2></header><div class="body">${children}</div>${footer ? html`<footer>${footer}</footer>` : null}
    </div></div>`;
}

export const when = (iso) => {
  if (!iso) return '—';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
};
export const duration = (ms) => (ms === null || ms === undefined ? '—' : ms < 1000 ? `${ms} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`);
export const short = (s, n = 12) => (s ? String(s).slice(0, n) : '—');
export const baseName = (p) => String(p ?? '').split('/').filter(Boolean).pop() ?? '';

// A small, safe Markdown renderer (headings, lists, tables, code, inline code/bold): builds nodes, never injects HTML.
export function Md({ text }) {
  const lines = String(text ?? '').split('\n');
  const out = [];
  let i = 0;
  const inline = (s) => {
    const parts = [];
    const re = /(`[^`]+`|\*\*[^*]+\*\*)/g;
    let last = 0;
    let m;
    while ((m = re.exec(s))) {
      if (m.index > last) parts.push(s.slice(last, m.index));
      parts.push(m[0].startsWith('`') ? html`<code>${m[0].slice(1, -1)}</code>` : html`<b>${m[0].slice(2, -2)}</b>`);
      last = m.index + m[0].length;
    }
    parts.push(s.slice(last));
    return parts;
  };
  while (i < lines.length) {
    const l = lines[i];
    if (l.startsWith('```')) {
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++]);
      i++;
      out.push(html`<pre>${buf.join('\n')}</pre>`);
    } else if (/^#{1,4} /.test(l)) {
      const n = /^#+/.exec(l)[0].length;
      out.push(n === 1 ? html`<h1>${inline(l.slice(2))}</h1>` : n === 2 ? html`<h2>${inline(l.slice(3))}</h2>` : html`<h3>${inline(l.replace(/^#+ /, ''))}</h3>`);
      i++;
    } else if (/^\s*[-*] /.test(l)) {
      const items = [];
      while (i < lines.length && /^\s*[-*] /.test(lines[i])) items.push(html`<li>${inline(lines[i++].replace(/^\s*[-*] /, ''))}</li>`);
      out.push(html`<ul>${items}</ul>`);
    } else if (l.startsWith('|') && lines[i + 1]?.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++].split('|').slice(1, -1).map((c) => c.trim()));
      const body = rows.filter((r, k) => !(k === 1 && r.every((c) => /^:?-+:?$/.test(c))));
      out.push(html`<table><thead><tr>${body[0].map((c) => html`<th>${inline(c)}</th>`)}</tr></thead><tbody>${body.slice(1).map((r) => html`<tr>${r.map((c) => html`<td>${inline(c)}</td>`)}</tr>`)}</tbody></table>`);
    } else if (!l.trim()) i++;
    else {
      out.push(html`<p>${inline(l)}</p>`);
      i++;
    }
  }
  return html`<div class="md">${out}</div>`;
}

export function useInterval(fn, ms, deps = []) {
  useEffect(() => {
    const t = setInterval(fn, ms);
    return () => clearInterval(t);
  }, deps);
}

export function useAsync(fn, deps = []) {
  const [s, setS] = useState({ loading: true, data: null, error: null });
  const reload = () => {
    setS((x) => ({ ...x, loading: true }));
    return fn().then((data) => setS({ loading: false, data, error: null })).catch((error) => setS({ loading: false, data: null, error }));
  };
  useEffect(() => {
    let live = true;
    fn().then((data) => live && setS({ loading: false, data, error: null })).catch((error) => live && setS({ loading: false, data: null, error }));
    return () => { live = false; };
  }, deps);
  return { ...s, reload };
}

export const isDesktop = () => !!window.eraDesktop;
export const getState = () => state;
