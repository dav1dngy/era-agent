// Rebuild screens: prerequisite checklist, reference picker (program/folder or screenshots), configuration form,
// behavior editor, and the screenshot-vs-rendering comparison. Every status shown comes from the control plane.
import { html, useEffect, useRef, useState } from '../html.js';
import { ApiError, get, getBlob, getText, patch, uploadImage } from '../api.js';
import { Badge, Btn, Callout, Md } from '../ui.js';
import { navigate, toast } from '../store.js';
import { behaviorsFromRows, checklistSummary, formFromProject, rebuildPayload } from '../rebuild-model.js';

const ICON = { pass: '✓', warn: '!', fail: '✕', info: 'i' };

export function Checklist({ checks, onRecheck }) {
  const sum = checklistSummary(checks);
  return html`<div class="checklist" role="region" aria-label="Prerequisites">
    <div class="row"><b>Before you start</b><${Badge} status=${sum.tone === 'bad' ? 'failed' : sum.tone === 'warn' ? 'waiting' : 'ready'} label=${sum.text} />${onRecheck ? html`<${Btn} size="sm" class="right" onClick=${onRecheck}>Check again<//>` : null}<a href="#/help/rebuild" class=${onRecheck ? '' : 'right'}>What do these mean?</a></div>
    <ul>${checks.map((c) => html`<li class=${`check-${c.status}`}><span class="check-icon" aria-hidden="true">${ICON[c.status] ?? '·'}</span>
      <span class="sr-only">${c.status}: </span>
      <div><b>${c.label}</b> <span class="muted">${c.message}</span>${c.fix && c.status !== 'pass' ? html`<div class="check-fix">→ ${c.fix}${/Settings → Execution/.test(c.fix) ? html` <a href="#/settings/execution">Open Execution settings</a>` : ''}${/Settings → Permissions/.test(c.fix) ? html` <a href="#/settings/permissions">Open Permissions</a>` : ''}</div>` : null}</div></li>`)}</ul>
  </div>`;
}

export function AuthImage({ src, alt, class: cls = '' }) {
  const [url, setUrl] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let dead = false;
    let made = null;
    setUrl(null);
    setErr(null);
    getBlob(src).then((b) => { if (!dead) { made = URL.createObjectURL(b); setUrl(made); } }).catch((e) => !dead && setErr(e.message));
    return () => { dead = true; if (made) URL.revokeObjectURL(made); };
  }, [src]);
  if (err) return html`<div class="muted" role="img" aria-label=${alt}>Image unavailable: ${err}</div>`;
  return url ? html`<img class=${cls} src=${url} alt=${alt} />` : html`<div class="shot-placeholder" aria-busy="true"></div>`;
}

// Reference chooser: a program/file/folder path, or one or more screenshots (uploaded in a browser, picked natively in the desktop app).
export function ReferencePicker({ value, onChange }) {
  const [kind, setKind] = useState(/(^|\/)set-[0-9a-f]{8}$/.test(value ?? '') || /\.(png|jpe?g|webp)$/i.test(value ?? '') ? 'screenshot' : 'program');
  const [uploaded, setUploaded] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const fileInput = useRef();
  const upload = async (files) => {
    setBusy(true);
    setErr(null);
    try {
      let set = null;
      const got = [];
      for (const f of files) {
        const r = await uploadImage(f, set);
        set = r.set;
        got.push(r);
      }
      setUploaded((u) => [...(set && u[0]?.set === set ? u : []), ...got]);
      onChange(got.at(-1).reference_path);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return html`<div class="col" style="gap:var(--space-2)">
    <div class="seg" role="group" aria-label="Reference type"><button aria-pressed=${kind === 'program'} onClick=${() => setKind('program')}>Program, app or folder</button><button aria-pressed=${kind === 'screenshot'} onClick=${() => setKind('screenshot')}>Screenshot(s) of a page</button></div>
    ${kind === 'program' ? html`<span class="row"><input type="text" class="grow" aria-label="Reference path" value=${value} placeholder="/path/to/the/authorized/reference" onInput=${(e) => onChange(e.target.value)} />${window.eraDesktop?.pickPath ? html`<${Btn} size="sm" onClick=${async () => { const p = await window.eraDesktop.pickPath(); if (p) onChange(p); }}>Browse…<//>` : null}</span>
      <span class="faint" style="font-size:var(--fs-xs)">ERA analyzes it with REA (Mach-O programs, JavaScript apps, archives) and can run it in a sandbox to record its behavior.</span>`
    : html`<div class="col" style="gap:var(--space-2)">
      <span class="row"><${Btn} onClick=${() => fileInput.current?.click()} disabled=${busy}>${busy ? 'Uploading…' : 'Choose screenshot files…'}<//>
        <input ref=${fileInput} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange=${(e) => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) upload(fs); }} />
        ${window.eraDesktop?.pickPath ? html`<${Btn} size="sm" onClick=${async () => { const p = await window.eraDesktop.pickPath(); if (p) onChange(p); }}>Pick from disk…<//>` : null}</span>
      <input type="text" aria-label="Screenshot path" value=${value} placeholder="…or paste the path of a screenshot file or a folder that contains only screenshots" onInput=${(e) => onChange(e.target.value)} />
      ${uploaded.length ? html`<div class="shots">${uploaded.map((u) => html`<figure><${AuthImage} src=${`/api/uploads/${u.set}/${u.file}`} alt=${`Uploaded screenshot ${u.file}`} /><figcaption>${u.width}×${u.height} · ${(u.bytes / 1024).toFixed(0)} KB</figcaption></figure>`)}</div>` : null}
      <span class="faint" style="font-size:var(--fs-xs)">PNG, JPEG or WebP, up to 6 files of 12 MB. Image metadata (location, camera, comments) is removed before a coding agent sees them, and the agent receives the image itself, not just a description. Anything visible in the screenshot is sent to the agent's provider if you authorize one.</span>
      ${err ? html`<span class="error-text">${err}</span>` : null}</div>`}
  </div>`;
}

export function BehaviorEditor({ rows, onChange, screenshot }) {
  const set = (i, patchRow) => onChange(rows.map((r, k) => (k === i ? { ...r, ...patchRow } : r)));
  return html`<div class="col" style="gap:var(--space-2)">
    ${rows.map((r, i) => html`<div class="panel" style="padding:var(--space-3)"><div class="row wrap">
      <input type="text" aria-label="Behavior name" placeholder="name (e.g. greets alice)" value=${r.name} onInput=${(e) => set(i, { name: e.target.value })} style="width:180px" />
      <input type="text" aria-label="Arguments" placeholder="arguments: alice &quot;two words&quot;" value=${r.args} onInput=${(e) => set(i, { args: e.target.value })} class="grow" />
      <${Btn} size="sm" kind="danger" onClick=${() => onChange(rows.filter((_, k) => k !== i))} aria-label="Remove behavior">Remove<//></div>
      <div class="row wrap" style="margin-top:var(--space-2)">
        ${screenshot ? null : html`<label class="check"><input type="checkbox" checked=${r.capture} onChange=${(e) => set(i, { capture: e.target.checked })} /><span>Record the expected output by running the reference</span></label>`}
        ${r.capture ? null : html`<textarea class="field grow" rows="2" aria-label="Expected output" placeholder="Expected output (exactly)" value=${r.stdout} onInput=${(e) => set(i, { stdout: e.target.value })}></textarea><label class="row"><span class="muted">exit code</span><input type="number" min="0" max="255" value=${r.exit_code} onInput=${(e) => set(i, { exit_code: e.target.value })} style="width:70px" aria-label="Expected exit code" /></label>`}
      </div></div>`)}
    <div><${Btn} size="sm" onClick=${() => onChange([...rows, { name: '', args: '', stdin: '', stdout: '', exit_code: 0, capture: false }])}>Add expected behavior<//></div>
  </div>`;
}

// The configuration of one rebuild, editable for an existing project. "Save" persists reference, destination, commands and acceptance.
export function RebuildSetup({ project, onSaved }) {
  const [f, setF] = useState(() => formFromProject(project));
  const [dirty, setDirty] = useState(false);
  const [checks, setChecks] = useState(null);
  const [msg, setMsg] = useState(null);
  const recheck = () => get(`/api/projects/${project.id}/preflight?op=rebuild`).then((r) => setChecks(r.checks)).catch((e) => setMsg(e.message));
  useEffect(() => { setF(formFromProject(project)); setDirty(false); recheck(); }, [project.id, project.updated_at]);
  const upd = (k) => (v) => { setF((x) => ({ ...x, [k]: typeof v === 'string' ? v : v.target.value })); setDirty(true); };
  const save = async () => {
    try {
      const body = rebuildPayload(f);
      await patch(`/api/projects/${project.id}`, body);
      setMsg('Saved.');
      setDirty(false);
      onSaved?.();
      recheck();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : String(e));
    }
  };
  const screenshot = checks?.some((c) => c.id === 'images' || (c.id === 'reference' && /screenshot/.test(c.message))) ?? false;
  return html`<div class="col">
    ${checks ? html`<${Checklist} checks=${checks} onRecheck=${recheck} />` : null}
    <section class="panel"><header><h3>What to rebuild</h3></header><div class="body col">
      <label class="col" style="gap:4px"><span class="muted">Task</span><textarea class="field" rows="2" value=${f.task} onInput=${upd('task')} aria-label="Task"></textarea></label>
      <div class="col" style="gap:4px"><span class="muted">Authorized reference</span><${ReferencePicker} value=${f.reference} onChange=${upd('reference')} /></div>
      <label class="col" style="gap:4px"><span class="muted">New project destination (an empty or new folder; nothing is written there until you approve)</span><input type="text" value=${f.destination} onInput=${upd('destination')} aria-label="Destination" placeholder="/path/to/new-project" /></label>
      <label class="col" style="gap:4px"><span class="muted">Why are you authorized to analyze this reference?</span><textarea class="field" rows="2" value=${f.authorization} onInput=${upd('authorization')} aria-label="Authorization"></textarea></label>
    </div></section>
    <section class="panel"><header><h3>How will ERA know it worked?</h3></header><div class="body col">
      <p class="muted">${screenshot ? 'A screenshot is verified visually (automatic when a renderer is installed): the generated page is rendered offline in a sandbox and compared with it. You can add checks of your own below.' : 'Choose at least one: expected behaviors, acceptance commands, or the new project’s own tests. Without one, any output would count as success.'}</p>
      ${screenshot ? html`<label class="col" style="gap:4px"><span class="muted">Required visual similarity (0.5–0.99, default 0.75)</span><input type="number" min="0.5" max="0.99" step="0.01" value=${f.visualThreshold} placeholder="0.75" onInput=${upd('visualThreshold')} style="width:120px" aria-label="Visual similarity threshold" /></label>` : html`
        <div class="col" style="gap:4px"><b>Expected behaviors</b><span class="muted">Run the new program with some arguments and compare what it prints.</span><${BehaviorEditor} rows=${f.behaviors} onChange=${(rows) => { setF((x) => ({ ...x, behaviors: rows })); setDirty(true); }} /></div>
        <label class="col" style="gap:4px"><span class="muted">Command that starts the new program (the behavior arguments are appended), e.g. <code>node app.js</code></span><input type="text" value=${f.run} onInput=${upd('run')} aria-label="Run command" /></label>`}
      <label class="col" style="gap:4px"><span class="muted">Acceptance commands that must succeed (one per line; run in the new project)</span><textarea class="field" rows="2" value=${f.accept} onInput=${upd('accept')} aria-label="Acceptance commands"></textarea></label>
      <label class="col" style="gap:4px"><span class="muted">The new project's own test commands (one per line), e.g. <code>npm test</code></span><textarea class="field" rows="2" value=${f.test} onInput=${upd('test')} aria-label="Test commands"></textarea></label>
      <label class="col" style="gap:4px"><span class="muted">Requirements in words (shown to the agent and in the report; not executed)</span><textarea class="field" rows="2" value=${f.criteria} onInput=${upd('criteria')} aria-label="Criteria"></textarea></label>
    </div></section>
    <div class="row"><${Btn} kind="primary" disabled=${!dirty} onClick=${save}>Save changes<//>${dirty ? html`<${Btn} onClick=${() => { setF(formFromProject(project)); setDirty(false); setMsg(null); }}>Revert<//>` : null}<span class=${msg === 'Saved.' ? 'muted' : 'error-text'} role="status">${msg}</span></div>
  </div>`;
}

const pct = (x) => `${Math.round(x * 100)}%`;
const bar = (label, v) => html`<div class="row" style="gap:var(--space-2)"><span class="muted" style="width:90px">${label}</span><div class="meter"><div style=${`width:${pct(v)}`}></div></div><span class="mono" style="width:44px">${pct(v)}</span></div>`;

export function VisualCompare({ projectId, runId, visual, images }) {
  if (!visual) return html`<${Callout} kind="warn">No visual comparison was made for this run. ${images ? 'No renderer was installed, so only your own commands decided.' : ''}<//>`;
  const base = `/api/projects/${projectId}/runs/${runId}/artifact?path=`;
  return html`<div class="col">
    <div class="row wrap"><${Badge} status=${visual.passed ? 'ready' : 'failed'} label=${visual.passed ? 'Similar enough' : 'Not similar enough'} /><b>Score ${visual.score}</b><span class="muted">required ${visual.threshold} · renderer: ${visual.renderer}</span></div>
    <div class="compare">
      <figure><figcaption>Reference screenshot</figcaption><${AuthImage} src=${`${base}${encodeURIComponent(visual.reference)}`} alt="Reference screenshot" /></figure>
      <figure><figcaption>Rendered result</figcaption><${AuthImage} src=${`${base}${encodeURIComponent(visual.rendered)}`} alt="Rendered result" /></figure>
    </div>
    <div class="col" style="gap:4px;max-width:520px">${bar('Layout', visual.metrics.layout)}${bar('Edges / structure', visual.metrics.edges)}${bar('Color', visual.metrics.color)}${bar('Brightness', visual.metrics.luminance)}</div>
    <div class="muted" style="font-size:var(--fs-xs)">The score is a heuristic (layout, edges, color and brightness of downscaled images), not a pixel-exact match. Rendered offline in a sandbox; ${visual.blocked_requests.length} network request(s) were blocked${visual.console_errors.length ? `; ${visual.console_errors.length} console error(s)` : ''}.</div>
  </div>`;
}

// The implementation plan, the architect's design (if an architecture agent ran) and, for rebuilds, the specification.
export function PlanView({ projectId, runId = 'latest', op }) {
  const [docs, setDocs] = useState(null);
  useEffect(() => {
    let dead = false;
    const base = `/api/projects/${projectId}/runs/${runId}/artifact?path=`;
    const want = op === 'rebuild' ? [['SPEC.md', 'Specification']] : [['plan.md', 'Implementation plan'], ['handoffs/design.md', 'Architecture design (from the architecture agent)']];
    Promise.all(want.map(([path, title]) => getText(`${base}${encodeURIComponent(path)}`).then((text) => ({ title, text })).catch(() => null))).then((r) => !dead && setDocs(r.filter(Boolean)));
    return () => { dead = true; };
  }, [projectId, runId, op]);
  if (!docs) return html`<span class="muted">Loading…</span>`;
  if (!docs.length) return html`<span class="muted">No plan has been written for this run yet.</span>`;
  return html`<div class="col">${docs.map((d) => html`<section class="panel"><header><h3>${d.title}</h3></header><div class="body"><${Md} text=${d.text} /></div></section>`)}</div>`;
}

export function BehaviorResults({ behaviors }) {
  if (!behaviors?.length) return html`<span class="muted">No behaviors were specified for this run.</span>`;
  return html`<table class="table"><thead><tr><th>Behavior</th><th>Result</th><th>Expected</th><th>Actual</th></tr></thead><tbody>${behaviors.map((b) => html`<tr><td>${b.name}<div class="faint mono">${b.args.join(' ')}</div></td><td><${Badge} status=${b.match ? 'ready' : 'failed'} label=${b.match ? 'match' : 'differs'} />${b.reasons?.length ? html`<div class="error-text">${b.reasons.join(', ')}</div>` : null}</td><td class="mono"><pre>${JSON.stringify(b.expected.stdout)}\nexit ${b.expected.exit_code}</pre></td><td class="mono"><pre>${JSON.stringify(b.actual.stdout)}\nexit ${b.actual.exit_code}</pre></td></tr>`)}</tbody></table>`;
}
export { behaviorsFromRows, navigate, toast };
