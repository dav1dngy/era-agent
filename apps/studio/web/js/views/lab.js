import { html } from '../html.js';
import { Badge, Btn, Empty, Section, when } from '../ui.js';
import { navigate, openModal, useStore } from '../store.js';

const MODES = [['review', 'Review', 'Read-only review with REA and agent evidence: findings by severity with file and line.'], ['modify', 'Modify', 'Isolated change with baseline, plan, tests, regression detection and a diff you approve.'], ['rebuild', 'Rebuild', 'Authorized reference → REA evidence → specification → independent new project → behavioral comparison.']];

export function LabView() {
  const s = useStore();
  const byOp = (op) => s.projects.filter((p) => p.latest_run?.op === op);
  return html`<div class="page">
    <div class="page-head"><div class="grow"><h1>Project Lab</h1><p>Work on external projects you are authorized to work on. Originals are never changed without approval; every operation runs on an isolated copy.</p></div><${Btn} kind="primary" onClick=${() => navigate('home')}>New task<//></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:var(--space-5)">
      ${MODES.map(([op, label, text]) => html`<${Section} title=${label}><div class="col"><p class="muted">${text}</p>
        ${byOp(op).length ? byOp(op).map((p) => html`<div class="row"><a href=${`#/projects/${p.id}`}><b>${p.id}</b></a><${Badge} status=${p.active_job ? 'running' : p.status} /><span class="faint right">${when(p.latest_run.updated_at ?? p.latest_run.created_at)}</span></div>`) : html`<span class="faint">No ${op} runs yet.</span>`}</div><//>`)}
    </div>
    ${s.projects.length === 0 ? html`<${Empty} title="No projects">Start from New Task: describe what you want and choose a folder.<//>` : null}
  </div>`;
}
export { openModal };
