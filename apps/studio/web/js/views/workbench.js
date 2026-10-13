import { html, useEffect, useRef, useState } from '../html.js';
import { ApiError, get, post, put } from '../api.js';
import { Badge, Btn, Callout, Empty, Modal, Spinner, baseName } from '../ui.js';
import { closeModal, navigate, openModal, set, state, toast, useStore } from '../store.js';
import { DiffView } from './review.js';
import { languageFor, loadMonaco, monacoTheme } from '../monaco.js';

const ROOTS = [['source', 'Original'], ['workspace', 'Working copy'], ['reference', 'Reference'], ['destination', 'Destination']];

function Tree({ id, root, dir = '', depth = 0, onOpen, selected }) {
  const [entries, setEntries] = useState(null);
  const [open, setOpen] = useState({});
  const [err, setErr] = useState(null);
  useEffect(() => { setEntries(null); get(`/api/projects/${id}/tree?root=${root}&path=${encodeURIComponent(dir)}`).then((r) => setEntries(r.entries)).catch((e) => setErr(e.message)); }, [id, root, dir]);
  if (err) return html`<div class="error-text" style="padding:4px 12px">${err}</div>`;
  if (!entries) return html`<div style=${`padding-left:${12 + depth * 12}px`} class="faint">…</div>`;
  return html`<div role=${depth ? 'group' : 'tree'} aria-label=${depth ? undefined : 'Files'}>${entries.map((e) => {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    return html`<div>
      <button class="tree-item" role="treeitem" aria-selected=${selected === rel} aria-expanded=${e.kind === 'dir' ? !!open[rel] : undefined} style=${`padding-left:${8 + depth * 12}px`} title=${e.kind === 'blocked-symlink' ? 'Symlink leaves the project: blocked' : rel}
        onClick=${() => (e.kind === 'dir' ? setOpen({ ...open, [rel]: !open[rel] }) : e.kind === 'file' ? onOpen(rel) : null)} disabled=${e.kind === 'blocked-symlink'}>
        <span aria-hidden="true" class="faint">${e.kind === 'dir' ? (open[rel] ? '▾' : '▸') : e.kind === 'blocked-symlink' ? '⛔' : '·'}</span><span class="truncate">${e.name}</span></button>
      ${e.kind === 'dir' && open[rel] ? html`<${Tree} id=${id} root=${root} dir=${rel} depth=${depth + 1} onOpen=${onOpen} selected=${selected} />` : null}</div>`;
  })}</div>`;
}

function SearchPane({ id, root, onOpen }) {
  const [q, setQ] = useState('');
  const [r, setR] = useState(null);
  const [err, setErr] = useState(null);
  const run = async (e) => { e?.preventDefault(); setErr(null); try { setR(await get(`/api/projects/${id}/search?root=${root}&q=${encodeURIComponent(q)}`)); } catch (er) { setR(null); setErr(er.message); } };
  return html`<div class="col" style="padding:var(--space-2)"><form class="row" onSubmit=${run}><input type="search" class="grow" aria-label="Search in project" placeholder="Search text" value=${q} onInput=${(e) => setQ(e.target.value)} /><${Btn} size="sm" type="submit">Go<//></form>
    ${err ? html`<span class="error-text">${err}</span>` : null}${r ? html`<div class="muted">${r.hits.length}${r.truncated ? '+' : ''} match(es)</div>${r.hits.map((h) => html`<button class="tree-item" style="height:auto;flex-direction:column;align-items:flex-start;padding:4px 8px" onClick=${() => onOpen(h.path, h.line)}><span class="mono">${h.path}:${h.line}</span><span class="muted truncate" style="max-width:100%">${h.text}</span></button>`)}` : null}</div>`;
}

function GitPane({ id, root, onOpen }) {
  const [g, setG] = useState(null);
  useEffect(() => { get(`/api/projects/${id}/git?root=${root}`).then(setG).catch((e) => setG({ error: e.message })); }, [id, root]);
  if (!g) return html`<${Spinner} />`;
  if (g.error) return html`<div class="error-text" style="padding:8px">${g.error}</div>`;
  if (!g.repository) return html`<div class="muted" style="padding:8px">${g.note}</div>`;
  return html`<div class="col" style="padding:var(--space-2)"><div class="row"><b>${g.branch}</b>${g.clean ? html`<${Badge} status="ok" label="clean" />` : html`<${Badge} status="warn" label=${`${g.files.length} change(s)`} />`}</div>
    ${g.files.map((f) => html`<button class="tree-item" onClick=${() => onOpen(f.path, null, true)}><span class="mono" style="width:22px">${f.index}${f.worktree}</span><span class="truncate">${f.path}</span></button>`)}
    <h4 style="margin-top:8px">Recent commits</h4>${g.commits.map((c) => html`<div class="row" title=${`${c.author} ${c.date}`}><code>${c.hash}</code><span class="truncate muted">${c.subject}</span></div>`)}</div>`;
}

function AiBar({ project, file, selection, root, onAnswer }) {
  const [busy, setBusy] = useState(false);
  const ask = async (action) => {
    setBusy(true);
    try {
      const r = await post(`/api/projects/${project}/assist`, { action, path: file, root, selection: selection.text, line: selection.line });
      onAnswer({ action, ...r });
    } catch (e) {
      if (e instanceof ApiError && e.status === 403 && /not authorized|consent/i.test(e.message)) {
        openModal({ title: 'Send this code to a remote provider?', body: html`<p>${e.message}</p><p>The selected text and the eligible project snapshot are sent. Credential files and agent instruction files are withheld.</p>`, footer: html`<${Btn} onClick=${closeModal}>Cancel<//><${Btn} kind="primary" onClick=${async () => { closeModal(); try { onAnswer({ action, ...(await post(`/api/projects/${project}/assist`, { action, path: file, root, selection: selection.text, line: selection.line, consent_remote: [e.detail?.provider].filter(Boolean) })) }); } catch (er) { toast(er.message, 'bad', 8000); } }}>Authorize and ask<//>` });
      } else toast(e.message, 'bad', 9000);
    } finally { setBusy(false); }
  };
  const task = (verb) => { set({ prefill: { text: `${verb} in ${file}:\n\n${selection.text.slice(0, 1500)}`, project_id: project } }); navigate('home'); };
  const disabled = !selection.text || busy;
  return html`<div class="row wrap" style="padding:4px var(--space-3);border-bottom:1px solid var(--border);background:var(--surface-1)">
    <span class="muted">AI on selection:</span>
    <${Btn} size="sm" disabled=${disabled} onClick=${() => ask('explain')}>Explain<//><${Btn} size="sm" disabled=${disabled} onClick=${() => ask('review')}>Review<//><${Btn} size="sm" disabled=${disabled} onClick=${() => ask('bugs')}>Find bugs<//>
    <${Btn} size="sm" disabled=${!selection.text} onClick=${() => task('Suggest and implement a refactoring')} title="Creates an isolated, verified modification task">Refactor…<//><${Btn} size="sm" disabled=${!selection.text} onClick=${() => task('Implement this feature')} title="Creates an isolated, verified modification task">Implement…<//>
    ${busy ? html`<${Spinner} />` : null}<span class="faint" style="font-size:var(--fs-xs)">${selection.text ? `${selection.text.length} chars selected` : 'select code first'}</span></div>`;
}

export function WorkbenchView({ route }) {
  const id = route.path[1];
  const s = useStore();
  const [root, setRoot] = useState(route.query.root ?? 'source');
  const [side, setSide] = useState('files');
  const [tabs, setTabs] = useState([]);
  const [active, setActive] = useState(null);
  const [roots, setRoots] = useState([]);
  const [selection, setSelection] = useState({ text: '', line: null });
  const [answer, setAnswer] = useState(null);
  const host = useRef();
  const editor = useRef();
  const models = useRef(new Map());
  const [mon, setMon] = useState(null);
  const [err, setErr] = useState(null);
  const project = s.projects.find((p) => p.id === id);

  useEffect(() => { set({ currentProject: id }); }, [id]);
  useEffect(() => {
    const avail = [];
    for (const [k] of ROOTS) avail.push(k);
    setRoots(avail);
  }, [id]);
  useEffect(() => {
    let dead = false;
    loadMonaco().then((m) => {
      if (dead || !host.current) return;
      setMon(m);
      editor.current = m.editor.create(host.current, { model: null, theme: monacoTheme(), automaticLayout: true, fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-mono'), fontSize: 13, minimap: { enabled: true }, scrollBeyondLastLine: false });
      editor.current.onDidChangeCursorSelection(() => { const sel = editor.current.getSelection(); const m2 = editor.current.getModel(); setSelection({ text: m2 && sel && !sel.isEmpty() ? m2.getValueInRange(sel) : '', line: sel?.startLineNumber ?? null }); });
    }).catch((e) => setErr(e.message));
    return () => { dead = true; editor.current?.dispose(); for (const mod of models.current.values()) mod.model.dispose(); models.current.clear(); set({ editorDirty: false }); };
  }, []);
  useEffect(() => { const obs = new MutationObserver(() => mon && mon.editor.setTheme(monacoTheme())); obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }); return () => obs.disconnect(); }, [mon]);

  const keyOf = (r, path) => `${r}:${path}`;
  const open = async (path, line = null, fromGit = false, requestedRoot = root) => {
    if (!mon) return;
    const r = requestedRoot;
    const key = keyOf(r, path);
    if (!models.current.has(key)) {
      try {
        const f = await get(`/api/projects/${id}/file?root=${r}&path=${encodeURIComponent(path)}`);
        if (f.binary) { toast('Binary files are not shown.', 'info'); return; }
        const model = mon.editor.createModel(f.content, languageFor(path));
        models.current.set(key, { model, saved: f.content, editable: f.editable, root: r, path });
        model.onDidChangeContent(() => { setTabs((t) => [...t]); set({ editorDirty: [...models.current.values()].some((e) => e.model.getValue() !== e.saved) }); });
      } catch (e) { toast(e.message, 'bad'); return; }
    }
    setTabs((t) => (t.includes(key) ? t : [...t, key]));
    setActive(key);
    const entry = models.current.get(key);
    editor.current.setModel(entry.model);
    editor.current.updateOptions({ readOnly: !entry.editable });
    if (line) { editor.current.revealLineInCenter(Number(line)); editor.current.setPosition({ lineNumber: Number(line), column: 1 }); }
    if (fromGit) {
      try { const diff = await get(`/api/projects/${id}/git/diff?root=${r}&path=${encodeURIComponent(path)}`); openModal({ title: `Git diff: ${path}`, wide: true, body: html`<${DiffView} ...${diff} />` }); } catch (e) { toast(e.message, 'bad'); }
    }
  };
  useEffect(() => { if (route.query.file && mon) { if (route.query.root && route.query.root !== root) setRoot(route.query.root); open(route.query.file, route.query.line, false, route.query.root ?? root); } }, [mon, route.query.file]);

  const close = (key) => { if (dirty(key) && !window.confirm('Discard unsaved changes in this file?')) return; setTabs((t) => t.filter((x) => x !== key)); const e = models.current.get(key); if (e) { e.model.dispose(); models.current.delete(key); } if (active === key) { const rest = tabs.filter((x) => x !== key); setActive(rest.at(-1) ?? null); if (rest.at(-1)) editor.current.setModel(models.current.get(rest.at(-1)).model); else editor.current.setModel(null); } set({ editorDirty: [...models.current.values()].some((e) => e.model.getValue() !== e.saved) }); };
  const entry = active ? models.current.get(active) : null;
  const dirty = (k) => { const e = models.current.get(k); return e && e.model.getValue() !== e.saved; };
  const save = async () => {
    if (!entry) return;
    try { const content = entry.model.getValue(); const r = await put(`/api/projects/${id}/file?root=${entry.root}`, { path: entry.path, content }); entry.saved = content; set({ editorDirty: [...models.current.values()].some((e) => e.model.getValue() !== e.saved) }); setTabs((t) => [...t]); toast(r.note ?? 'Saved', r.note ? 'info' : 'ok', r.note ? 7000 : 2500); } catch (e) { toast(e.message, 'bad', 8000); }
  };
  useEffect(() => { const k = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(); } }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); });

  if (!project) return html`<div class="page"><${Empty} title="Project not found">Open a project from the Projects page.<//></div>`;
  return html`<div class="workbench" style="height:100%">
    <div class="explorer" aria-label="Explorer">
      <div class="col" style="padding:var(--space-2);gap:var(--space-2);border-bottom:1px solid var(--border)">
        <div class="row"><b class="truncate grow">${id}</b><${Btn} size="sm" class="ghost" onClick=${() => navigate(['projects', id])}>Back<//></div>
        <select aria-label="Directory" value=${root} onChange=${(e) => { setRoot(e.target.value); }}>${roots.map((k) => html`<option value=${k}>${ROOTS.find(([x]) => x === k)[1]}${k === 'source' && !s.settings.permissions.directEdit ? ' (read-only)' : ''}</option>`)}</select>
        <div class="seg" role="group" aria-label="Explorer view">${[['files', 'Files'], ['search', 'Search'], ['git', 'Git']].map(([k, l]) => html`<button aria-pressed=${side === k} onClick=${() => setSide(k)}>${l}</button>`)}</div></div>
      <div style="overflow:auto;flex:1">${side === 'files' ? html`<${Tree} key=${`${id}${root}`} id=${id} root=${root} onOpen=${open} selected=${entry?.path} />` : side === 'search' ? html`<${SearchPane} id=${id} root=${root} onOpen=${open} />` : html`<${GitPane} id=${id} root=${root} onOpen=${open} />`}</div>
    </div>
    <div class="editor-area">
      <div class="tabs" role="tablist" aria-label="Open files">${tabs.map((k) => { const e = models.current.get(k); return html`<button class="tab" role="tab" aria-selected=${active === k} onClick=${() => { setActive(k); editor.current.setModel(e.model); editor.current.updateOptions({ readOnly: !e.editable }); }} title=${`${e.root}:${e.path}`}>${baseName(e.path)}${dirty(k) ? ' ●' : ''}${e.editable ? '' : html` <span class="faint">(read-only)</span>`}<span class="x" role="button" aria-label=${`Close ${baseName(e.path)}`} onClick=${(ev) => { ev.stopPropagation(); close(k); }}>×</span></button>`; })}
        <span class="right row" style="padding:0 8px"><${Btn} size="sm" disabled=${!entry?.editable || !dirty(active)} onClick=${save}>Save <kbd>⌘S</kbd><//><${Btn} size="sm" onClick=${() => set({ bottomOpen: true, bottomTab: 'terminal' })}>Terminal<//></span></div>
      ${entry ? html`<${AiBar} project=${id} file=${entry.path} root=${entry.root} selection=${selection} onAnswer=${setAnswer} />` : null}
      ${err ? html`<${Callout} kind="bad">${err}<//>` : null}
      <div class="editor-host" style=${answer ? 'flex:1 1 55%' : ''}><div ref=${host}></div>${!tabs.length && !err ? html`<div class="empty" style="position:absolute;inset:auto;left:50%;top:40%;transform:translate(-50%,-50%);border:0">Open a file from the explorer.<br/>${s.settings.permissions.directEdit ? 'Direct edit is enabled.' : 'Original files are read-only; the working copy of a run is editable.'}</div>` : null}</div>
      ${answer ? html`<div class="panel" style="margin:var(--space-2);max-height:40%;overflow:auto"><header><b>${answer.action}</b><span class="muted">by ${answer.agent} · ${answer.duration_ms ? `${(answer.duration_ms / 1000).toFixed(1)} s` : ''}${answer.cost_usd !== null && answer.cost_usd !== undefined ? ` · $${answer.cost_usd.toFixed(4)}` : ''}</span><${Btn} size="sm" class="right" onClick=${() => setAnswer(null)}>Close<//></header><div class="body"><pre>${answer.output}</pre></div></div>` : null}
    </div></div>`;
}
export { Modal, state };
