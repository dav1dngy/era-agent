// Pure view-model functions (no DOM, no framework): unit-tested in tests/studio-ui-model.test.js.
// They only reshape data the control plane returned; nothing here invents progress.

const STEP_LABEL = [
  [/^detect$/, 'Detect project', 'era', 'ERA'],
  [/^workspace$/, 'Isolated working copy', 'era', 'ERA'],
  [/^baseline$/, 'Baseline build and tests', 'era', 'ERA'],
  [/^analysis$/, 'REA and static analysis', 'rea', 'REA'],
  [/^architecture$/, 'Architecture and planning', 'architect'],
  [/^plan$/, 'Implementation plan', 'era', 'ERA'],
  [/^implement-(\d+)$/, (m) => `Implementation (attempt ${m[1]})`, 'implementer'],
  [/^verify-(\d+)$/, (m) => `Automated tests (attempt ${m[1]})`, 'era', 'ERA'],
  [/^review-(\d+)$/, (m) => `Independent review (round ${m[1]})`, 'reviewer'],
  [/^correct-(\d+)$/, (m) => `Correction (round ${m[1]})`, 'implementer'],
  [/^reverify-(\d+)$/, (m) => `Tests after correction ${m[1]}`, 'era', 'ERA'],
  [/^agent-review$/, 'Agent review', 'reviewer'],
  [/^findings$/, 'Findings', 'era', 'ERA'],
  [/^spec$|^evidence$|^reference$/, (m) => ({ spec: 'Specification', evidence: 'REA evidence', reference: 'Reference identity' })[m[0]], 'rea'],
  [/^finalize$/, 'Decision', 'era', 'ERA'],
];

const roleAgent = (roles, role) => (role === 'era' ? 'ERA' : role === 'rea' ? 'REA' : roles?.[role] ?? null);

// run: summary with steps {name: {status, started_at, finished_at, duration_ms, error}}; roles: {architect, implementer, reviewer}.
export function buildPipeline({ run, roles = {}, status = null, handoffs = [] }) {
  if (!run) return [];
  const stages = [{ key: 'request', label: 'Request', role: 'user', agent: 'You', state: 'done', started_at: run.created_at, finished_at: run.created_at, duration_ms: null, error: null, artifacts: [] }];
  const names = Object.entries(run.steps ?? {}).sort((a, b) => ((a[1].started_at ?? '') < (b[1].started_at ?? '') ? -1 : 1));
  for (const [name, st] of names) {
    const def = STEP_LABEL.find(([re]) => re.test(name));
    const m = def?.[0].exec(name);
    const label = def ? (typeof def[1] === 'function' ? def[1](m) : def[1]) : name;
    const role = def?.[2] ?? 'era';
    const state = { done: 'done', running: 'running', failed: 'failed', paused: 'waiting' }[st.status] ?? 'pending';
    stages.push({ key: name, label, role, agent: roleAgent(roles, role), state, started_at: st.started_at ?? null, finished_at: st.finished_at ?? null, duration_ms: st.duration_ms ?? null, error: st.error ?? null, artifacts: handoffs.filter((h) => artifactStage(h.artifact) === name).map((h) => h.artifact) });
  }
  // Configured-but-not-yet-started roles are shown as pending (they are part of the plan, not progress).
  const have = (re) => names.some(([n]) => re.test(n));
  const active = ['running'].includes(status ?? run.status);
  if (roles.architect && !have(/^architecture$/) && run.op === 'modify') stages.push({ key: 'architecture', label: 'Architecture and planning', role: 'architect', agent: roles.architect, state: 'pending', started_at: null, finished_at: null, duration_ms: null, error: null, artifacts: [] });
  if (roles.reviewer && !have(/^review-\d+$/) && run.op === 'modify' && !['rejected', 'failed', 'cancelled'].includes(run.status)) stages.push({ key: 'review-1', label: 'Independent review (round 1)', role: 'reviewer', agent: roles.reviewer, state: 'pending', started_at: null, finished_at: null, duration_ms: null, error: null, artifacts: [] });
  if (run.op !== 'review') {
    const s = status ?? run.status;
    const approval = s === 'awaiting-approval' ? 'waiting' : s === 'applied' ? 'done' : ['rejected', 'failed', 'cancelled', 'rolled-back'].includes(s) ? 'skipped' : 'pending';
    stages.push({ key: 'approval', label: 'Human approval', role: 'user', agent: 'You', state: approval, started_at: null, finished_at: null, duration_ms: null, error: null, artifacts: [] });
  }
  return stages.map((st) => (active || st.state !== 'running' ? st : { ...st, state: st.state === 'running' ? 'stalled' : st.state }));
}

function artifactStage(artifact) {
  if (/architect-brief|design\.md/.test(artifact)) return 'architecture';
  const m = /review-(?:input-)?(\d+)/.exec(artifact);
  return m ? `review-${m[1]}` : null;
}

export const progressPercent = (stages) => {
  const real = stages.filter((s) => s.state !== 'skipped');
  return real.length ? Math.round((real.filter((s) => s.state === 'done').length / real.length) * 100) : 0;
};

// Simple-mode summary line: derived only from the run and job states.
export function simpleStatus({ project, job }) {
  const s = project?.latest_run?.status ?? project?.status;
  if (job && ['queued', 'running'].includes(job.status)) return { tone: 'info', text: job.status === 'queued' ? 'Queued' : `Working: ${humanStep(project?.latest_run?.current_step)}` };
  const table = { 'awaiting-plan': ['warn', 'Plan ready: read it, then approve it to start'], 'awaiting-approval': ['warn', 'Ready for your review'], rejected: ['bad', 'The change did not pass verification'], failed: ['bad', 'The run failed'], complete: ['ok', 'Review complete'], applied: ['ok', 'Applied to your project'], cancelled: ['neutral', 'Cancelled'], interrupted: ['warn', 'Interrupted — you can resume it'], 'awaiting-implementation': ['warn', 'Waiting for you to edit the working copy'], 'rolled-back': ['neutral', 'Rolled back'] };
  const [tone, text] = table[s] ?? ['neutral', s ? String(s) : 'No runs yet'];
  return { tone, text };
}
export const humanStep = (name) => (name ? (STEP_LABEL.map(([re, l]) => { const m = re.exec(name); return m ? (typeof l === 'function' ? l(m) : l) : null; }).find(Boolean) ?? name) : 'starting');

// Deterministic layered layout for evidence graphs (no physics, so it is testable and stable).
export function layoutGraph(graph, { width = 900, height = 460 } = {}) {
  const order = ['entry', 'module', 'function', 'external', 'dependency'];
  const columns = order.map((kind) => graph.nodes.filter((n) => n.kind === kind)).filter((c) => c.length);
  const pos = new Map();
  columns.forEach((col, ci) => {
    const x = columns.length === 1 ? width / 2 : 70 + (ci * (width - 140)) / (columns.length - 1);
    col.forEach((n, ri) => pos.set(n.id, { x, y: 24 + ((ri + 0.5) * (height - 48)) / col.length }));
  });
  return { positions: pos, edges: graph.edges.filter((e) => pos.has(e.from) && pos.has(e.to)) };
}

// Approval eligibility: derived from the run only. Mirrors (never replaces) the server-side checks.
export function approvalState({ run, finalize }) {
  if (!run || !finalize) return { allowed: false, reason: 'There is no verified change yet.' };
  if (run.status === 'applied') return { allowed: false, reason: 'Already applied.' };
  if (run.status !== 'awaiting-approval') return { allowed: false, reason: `This run is ${run.status}; only a run awaiting approval can be approved.` };
  if (!finalize.pass) return { allowed: false, reason: 'The change did not pass verification.' };
  return { allowed: true, reason: null };
}

export const severityRank = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
export const groupFindings = (findings) => Object.entries(findings.reduce((acc, f) => ((acc[f.severity] ??= []).push(f), acc), {})).sort((a, b) => severityRank[a[0]] - severityRank[b[0]]);

export const TASK_EXAMPLES = [
  { mode: 'ANALYZE', text: 'Analyze this Electron application and explain how its search functionality works.' },
  { mode: 'MODIFY', text: 'Fix the login bug in my React application.' },
  { mode: 'REBUILD', text: 'Analyze this authorized reference application and implement selected features in a new project.' },
  { mode: 'IMPROVE', text: "Analyze ERA's own implementation and propose a measurable improvement." },
];
