import { html, useEffect, useRef, useState } from '../html.js';
import { ApiError, download, get, post } from '../api.js';
import { Badge, Btn, Callout, Empty, Md, Section, Spinner, duration, short } from '../ui.js';
import { closeModal, openModal, toast, useStore } from '../store.js';
import { approvalState, groupFindings } from '../model.js';
import { languageFor, loadMonaco, monacoTheme } from '../monaco.js';
import { BehaviorResults, VisualCompare } from './rebuild.js';

export function DiffView({ original, modified, path }) {
  const host = useRef();
  const [err, setErr] = useState(null);
  useEffect(() => {
    let editor;
    let dead = false;
    loadMonaco().then((m) => {
      if (dead || !host.current) return;
      const lang = languageFor(path);
      editor = m.editor.createDiffEditor(host.current, { readOnly: true, renderSideBySide: true, useInlineViewWhenSpaceIsLimited: false, automaticLayout: true, theme: monacoTheme(), fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-mono'), fontSize: 12, minimap: { enabled: false }, scrollBeyondLastLine: false, originalEditable: false });
      editor.setModel({ original: m.editor.createModel(original ?? '', lang), modified: m.editor.createModel(modified ?? '', lang) });
    }).catch((e) => setErr(e.message));
    return () => {
      dead = true;
      if (editor) {
        const mod = editor.getModel();
        editor.dispose();
        mod?.original.dispose();
        mod?.modified.dispose();
      }
    };
  }, [original, modified, path]);
  return err ? html`<${Callout} kind="bad">${err}<//>` : html`<div ref=${host} style="height:100%;min-height:340px;border:1px solid var(--border);border-radius:var(--radius)" aria-label=${`Diff of ${path}`} role="region"></div>`;
}

export function PatchView({ patch }) {
  if (!patch) return html`<span class="muted">No diff.</span>`;
  return html`<pre class="mono" style="border:1px solid var(--border);border-radius:var(--radius);overflow:auto;max-height:520px" tabindex="0" aria-label="Unified diff">${patch.split('\n').map((l) => html`<div style=${`padding:0 8px;background:${l.startsWith('+') && !l.startsWith('+++') ? 'var(--diff-add)' : l.startsWith('-') && !l.startsWith('---') ? 'var(--diff-del)' : 'transparent'};${l.startsWith('@@') ? 'color:var(--accent)' : ''}`}>${l || ' '}</div>`)}</pre>`;
}

const cmdRow = (r) => html`<tr><td class="mono">${r.command}</td><td>${r.ok ? html`<${Badge} status="ok" label="pass" />` : html`<${Badge} status="failed" label=${r.timed_out ? 'timed out' : `exit ${r.exit_code}`} />`}</td><td class="muted">${duration(r.duration_ms)}</td></tr>`;

export function ReviewCenter({ id }) {
  const s = useStore();
  const [data, setData] = useState(null);
  const [file, setFile] = useState(null);
  const [diff, setDiff] = useState(null);
  const [tab, setTab] = useState('verification');
  useEffect(() => { if (data?.finalize?.visual || data?.finalize?.screenshot) setTab('visual'); else if (data?.run.op === 'rebuild') setTab('behaviors'); }, [data?.run.run_id]);
  const [error, setError] = useState(null);
  const load = () => get(`/api/projects/${id}/runs/latest`).then((d) => { setData(d); setError(null); setFile((f) => f ?? d.finalize?.files?.[0]?.path ?? null); }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [id, s.projects.find((p) => p.id === id)?.status]);
  useEffect(() => {
    if (!file || !data) return;
    setDiff(null);
    get(`/api/projects/${id}/runs/latest/diff?path=${encodeURIComponent(file)}`).then(setDiff).catch((e) => setDiff({ error: e.message }));
  }, [file, data?.run.run_id, data?.finalize?.patch_sha256]);

  if (error) return html`<${Empty} title="Nothing to review">${error}<//>`;
  if (!data) return html`<${Spinner} />`;
  const { run, finalize: fin } = data;
  if (!fin) return html`<${Empty} title="No verified change in the latest run">The latest run is a ${run.op} run (${run.status}). ${run.op === 'review' ? 'Review runs change nothing and need no approval.' : 'Start a modification to produce a reviewable diff.'}<//>`;
  const approval = approvalState({ run, finalize: fin });
  const v = fin.verification;
  const risks = [
    ...(fin.warnings ?? []).filter((w) => /test files were/.test(w)).map((w) => `Existing tests were touched: ${w}`),
    ...(fin.files.length > 15 ? [`${fin.files.length} files changed`] : []),
    ...(data.run.exposure?.remote_providers?.length ? [`Source code was available to: ${data.run.exposure.remote_providers.join(', ')}`] : []),
    ...(fin.review?.unresolved?.length ? [`${fin.review.unresolved.length} unresolved review finding(s)`] : []),
  ];

  const approve = () => openModal({
    title: 'Approve this change?',
    body: html`<div class="col"><div class="kv"><dt>Applies to</dt><dd class="mono">${run.op === 'modify' ? s.projects.find((p) => p.id === id)?.source : s.projects.find((p) => p.id === id)?.destination}</dd><dt>Files</dt><dd>${fin.files.length} (${fin.files.map((f) => f.status).join('')})</dd><dt>Evaluated artifact</dt><dd class="mono">sha256 ${short(fin.patch_sha256, 24)}…</dd><dt>Verification</dt><dd>${fin.pass ? 'build, tests and acceptance passed' : 'did not pass'}</dd></div>
      ${risks.length ? html`<${Callout} kind="warn" title="High-risk aspects">${risks.map((r) => html`<div>• ${r}</div>`)}<//>` : null}
      <p class="muted">Approval applies exactly this verified diff. If anything changed since verification, ERA refuses and nothing is applied. You can roll it back afterwards.</p></div>`,
    footer: html`<${Btn} onClick=${closeModal}>Cancel<//><${Btn} kind="primary" data-autofocus="true" onClick=${async () => {
      try {
        const fresh = await get(`/api/projects/${id}/runs/latest`);
        if (fresh.finalize?.patch_sha256 !== fin.patch_sha256) { closeModal(); toast('The change was updated while you were reviewing. Review it again before approving.', 'bad', 9000); load(); return; }
        await post(`/api/projects/${id}/approve`, { confirm: true, run_id: run.run_id, patch_sha256: fin.patch_sha256 });
        closeModal();
        toast('Approved and applied. You can roll it back from this page.', 'ok');
        load();
      } catch (e) { closeModal(); toast(e instanceof ApiError ? e.message : String(e), 'bad', 10000); load(); }
    }}>Approve and apply<//>`,
  });
  const reject = () => openModal({ title: 'Reject this change?', body: html`<p>The isolated working copy is discarded and nothing is applied. The record of this run stays in the history.</p>`, footer: html`<${Btn} onClick=${closeModal}>Keep reviewing<//><${Btn} kind="danger" onClick=${async () => { try { await post(`/api/projects/${id}/reject`, { confirm: true }); closeModal(); toast('Change rejected', 'ok'); load(); } catch (e) { closeModal(); toast(e.message, 'bad'); } }}>Reject change<//>` });
  const rollback = () => openModal({ title: 'Roll back the applied change?', body: html`<p>The same diff is reversed in your project. ERA refuses if you edited those files since.</p>`, footer: html`<${Btn} onClick=${closeModal}>Cancel<//><${Btn} kind="danger" onClick=${async () => { try { await post(`/api/projects/${id}/rollback`, { confirm: true }); closeModal(); toast('Rolled back', 'ok'); load(); } catch (e) { closeModal(); toast(e.message, 'bad', 9000); } }}>Roll back<//>` });

  return html`<div class="col">
    <div class="row wrap"><${Badge} status=${run.status} /><span class="muted">Run ${run.run_id} · ${fin.files.length} file(s) · verified artifact <code>${short(fin.patch_sha256, 12)}</code></span>
      <span class="right row">
        ${run.status === 'applied' ? html`<${Btn} kind="danger" onClick=${rollback}>Roll back<//>` : html`<${Btn} kind="danger" disabled=${!['awaiting-approval', 'rejected'].includes(run.status)} onClick=${reject}>Reject<//><${Btn} kind="primary" disabled=${!approval.allowed} onClick=${approve} title=${approval.reason ?? ''}>Approve<//>`}
      </span></div>
    ${!approval.allowed && run.status !== 'applied' ? html`<${Callout} kind=${fin.pass ? '' : 'bad'}>${approval.reason}${fin.reasons?.length ? html`<ul>${fin.reasons.map((r) => html`<li>${r}</li>`)}</ul>` : null}<//>` : null}
    ${risks.length && approval.allowed ? html`<${Callout} kind="warn" title="Review carefully">${risks.map((r) => html`<div>• ${r}</div>`)}<//>` : null}
    <div style="display:grid;grid-template-columns:240px 1fr;gap:var(--space-4);align-items:start">
      <div class="diff-list" role="listbox" aria-label="Changed files">${fin.files.map((f) => html`<button role="option" aria-selected=${file === f.path} onClick=${() => setFile(f.path)}><span class=${`status-${f.status} mono`}>${f.status}</span><span class="truncate" title=${f.path}>${f.path}</span></button>`)}</div>
      <div style="height:420px">${!diff ? html`<${Spinner} />` : diff.error ? html`<${Callout} kind="bad">${diff.error}<//>` : html`<${DiffView} original=${diff.original} modified=${diff.modified} path=${diff.path} />`}</div>
    </div>
    <div class="tabs" role="tablist" style="border:0;border-bottom:1px solid var(--border);background:transparent">${[...(fin.visual || fin.screenshot ? [['visual', 'Visual comparison']] : []), ...(run.op === 'rebuild' && !fin.screenshot ? [['behaviors', 'Behaviors']] : []), ['verification', 'Build & tests'], ['review', 'Agent review'], ['security', 'Security & limits'], ['limits', 'Remaining limitations'], ['report', 'Full report']].map(([k, l]) => html`<button class="tab" role="tab" aria-selected=${tab === k} onClick=${() => setTab(k)}>${l}</button>`)}</div>
    ${tab === 'visual' ? html`<${VisualCompare} projectId=${id} runId=${run.run_id} visual=${fin.visual} images=${fin.screenshot} />` : null}
    ${tab === 'behaviors' ? html`<${BehaviorResults} behaviors=${fin.behaviors} />` : null}
    ${tab === 'verification' ? html`<div class="col">
      ${v ? html`<table class="table"><thead><tr><th>Command</th><th>Result</th><th>Time</th></tr></thead><tbody>${[...v.build, ...v.test, ...v.acceptance].map(cmdRow)}</tbody></table>` : html`<span class="muted">No verification recorded.</span>`}
      ${v?.tests ? html`<div class="muted">${v.tests.passed.length} test(s) passing, ${v.tests.failed.length} failing, ${v.tests.skipped.length} skipped (${v.tests.formats.join(', ')}).</div>` : html`<div class="muted">Test output could not be itemized; regressions were judged by exit code.</div>`}</div>` : null}
    ${tab === 'review' ? html`<${AgentReview} review=${fin.review} team=${fin.team} />` : null}
    ${tab === 'security' ? html`<dl class="kv">
      <dt>Original project</dt><dd>${run.source_digest ? html`unchanged until approval (digest <code>${short(run.source_digest, 12)}</code>)` : '—'}</dd>
      <dt>Remote providers</dt><dd>${data.run.exposure?.remote_providers?.length ? data.run.exposure.remote_providers.join(', ') : 'none'}</dd>
      <dt>Withheld from agents</dt><dd>${data.run.exposure?.withheld_files?.length ? data.run.exposure.withheld_files.join('; ') : 'nothing needed withholding'}</dd>
      <dt>Secret-looking content</dt><dd>${data.run.exposure?.secret_content_files?.length ? data.run.exposure.secret_content_files.join('; ') : 'none found'}</dd>
      <dt>Hand-offs</dt><dd>${data.run.handoffs.length ? data.run.handoffs.map((h) => `${h.from}→${h.to}: ${h.artifact}`).join(' · ') : 'single agent'}</dd></dl>` : null}
    ${tab === 'limits' ? html`<div class="col">${(fin.warnings ?? []).length ? fin.warnings.map((w) => html`<${Callout} kind="warn">${w}<//>`) : html`<span class="muted">No warnings recorded.</span>`}
      <${Callout}>ERA verifies only what the project's own tests and your acceptance commands check. Passing them does not prove the change is correct or complete: review the diff.<//></div>` : null}
    ${tab === 'report' ? html`<div><div class="row" style="margin-bottom:8px"><${Btn} size="sm" onClick=${() => download(`${id}-${run.run_id}.md`, data.report, 'text/markdown')}>Export report<//></div><${Md} text=${data.report} /></div>` : null}
  </div>`;
}

function AgentReview({ review, team }) {
  if (!review) return html`<${Empty} title="No independent review">This run had no review agent. Configure a team with a reviewer (Settings → Agent roles).<//>`;
  return html`<div class="col"><div class="muted">Reviewer <b>${review.reviewer}</b>${team?.independence ? ` · ${team.independence}` : ''} · blocking threshold ${review.block_on} · ${review.corrections} correction round(s)</div>
    ${review.rounds.map((r) => html`<${Section} title=${`Round ${r.round}`} actions=${html`<span class="muted">${r.accepted.length} accepted · ${r.rejected.length} unverifiable · ${r.blocking.length} blocking</span>`}>
      ${r.accepted.length ? groupFindings(r.accepted).map(([sev, list]) => list.map((f) => html`<div style="margin-bottom:8px"><b class=${`sev-${sev}`}>[${sev}] ${f.title}</b> <span class="mono muted">${f.locations[0]?.file}${f.locations[0]?.line ? `:${f.locations[0].line}` : ''}</span>${f.verified === false ? html` <span class="badge warn plain">quote not found</span>` : null}<div class="muted">${f.evidence}</div></div>`)) : html`<span class="muted">No findings.</span>`}<//>`)}
    ${review.unresolved.length ? html`<${Callout} kind="bad" title="Unresolved blocking findings">${review.unresolved.map((f) => html`<div>• ${f.title}</div>`)}<//>` : html`<${Callout} kind="ok">No unresolved blocking findings.<//>`}</div>`;
}
