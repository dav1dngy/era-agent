import { html, useEffect, useState } from '../html.js';
import { ApiError, get } from '../api.js';
import { Badge, Btn, Callout, Spinner } from '../ui.js';
import { navigate, toast, useStore } from '../store.js';
import { saveSettings } from '../main.js';

const SECTIONS = [['general', 'General'], ['appearance', 'Appearance'], ['providers', 'AI Providers'], ['roles', 'Agent Roles'], ['tools', 'MCP & Tools'], ['workspaces', 'Workspaces'], ['permissions', 'Permissions'], ['privacy', 'Privacy & Security'], ['execution', 'Execution'], ['advanced', 'Advanced']];

const Row = ({ label, hint, children, id }) => html`<div class="field-row"><div><label for=${id}>${label}</label>${hint ? html`<div class="hint">${hint}</div>` : null}</div><div>${children}</div></div>`;

function useForm(section, initial) {
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState([]);
  useEffect(() => { setDraft(initial); setErrors([]); }, [JSON.stringify(initial)]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const save = async () => {
    try { await saveSettings({ [section]: draft }); setErrors([]); toast('Settings saved', 'ok'); } catch (e) { setErrors(e instanceof ApiError ? e.detail?.errors ?? [e.message] : [String(e)]); }
  };
  return { draft, setDraft, errors, dirty, save, reset: () => { setDraft(initial); setErrors([]); } };
}

const Bar = ({ f }) => html`<div class="row" style="padding-top:var(--space-4)"><${Btn} kind="primary" disabled=${!f.dirty} onClick=${f.save}>Save changes<//><${Btn} disabled=${!f.dirty} onClick=${f.reset}>Revert<//>${f.errors.length ? html`<div class="error-text" role="alert">${f.errors.map((e) => html`<div>${e}</div>`)}</div>` : null}</div>`;

function General({ s }) {
  const f = useForm('general', s.general);
  return html`<div><${Row} id="g-lang" label="Language" hint="The interface is currently English only; the setting is stored for future translations."><select id="g-lang" value=${f.draft.language} onChange=${(e) => f.setDraft({ ...f.draft, language: e.target.value })}><option value="en">English</option><option value="de">Deutsch (not yet translated)</option></select><//>
    <${Row} id="g-start" label="Startup behavior"><select id="g-start" value=${f.draft.startup} onChange=${(e) => f.setDraft({ ...f.draft, startup: e.target.value })}><option value="home">Open the New Task workspace</option><option value="last-project">Reopen the last project</option></select><//>
    <${Row} id="g-upd" label="Updates" hint="ERA Studio does not check for updates or contact any server by itself. Update by pulling the repository."><select id="g-upd" value="manual" disabled><option>Manual</option></select><//><${Bar} f=${f} /></div>`;
}

function Appearance({ s }) {
  const f = useForm('appearance', s.appearance);
  const d = f.draft;
  const set = (k, v) => f.setDraft({ ...d, [k]: v });
  // Live preview: apply immediately; Revert restores.
  useEffect(() => { document.documentElement.style.setProperty('--fs-base', `${d.fontSize}px`); }, [d.fontSize]);
  return html`<div><${Row} id="a-theme" label="Theme" hint="Precision Dark (primary) or Executive Light"><div class="seg" role="group" aria-label="Theme">${['dark', 'light', 'system'].map((t) => html`<button aria-pressed=${d.theme === t} onClick=${() => set('theme', t)}>${t[0].toUpperCase() + t.slice(1)}</button>`)}</div><//>
    <${Row} id="a-acc" label="Accent color"><div class="row">${['blue', 'teal', 'violet', 'amber'].map((a) => html`<button class="chip" aria-pressed=${d.accent === a} onClick=${() => set('accent', a)}>${a}</button>`)}</div><//>
    <${Row} id="a-fs" label=${`Font size (${d.fontSize}px)`}><input id="a-fs" type="range" min="11" max="20" value=${d.fontSize} onInput=${(e) => set('fontSize', Number(e.target.value))} /><//>
    <${Row} id="a-font" label="Editor font" hint="A font-family list, e.g. JetBrains Mono, Menlo, monospace"><input id="a-font" type="text" style="width:100%" value=${d.editorFont} onInput=${(e) => set('editorFont', e.target.value)} /><//>
    <${Row} id="a-den" label="Interface density"><select id="a-den" value=${d.density} onChange=${(e) => set('density', e.target.value)}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select><//><${Bar} f=${f} /></div>`;
}

function Providers() {
  const [a, setA] = useState(null);
  useEffect(() => { get('/api/agents').then(setA).catch(() => {}); }, []);
  if (!a) return html`<${Spinner} />`;
  return html`<div class="col"><${Callout}>ERA never stores provider credentials. Each CLI keeps its own sign-in; ERA only asks whether it is signed in. To sign in, run <code>claude auth login</code> or <code>codex login</code> in a terminal. <a href="#/docs/getting-started?h=3-cost-consent-and-privacy">Cost, consent and what a provider can read</a>. Custom command agents are declared in <code>era.config.json</code> under <code>projectLab.customAgents</code>.<//>
    ${a.providers.map((p) => html`<div class="panel" style="padding:var(--space-3)"><div class="row"><b>${p.id}</b><${Badge} status=${p.state} /><span class="muted">${p.version ?? ''}</span></div><div class="muted" style="margin-top:4px">${p.description}</div><div class="muted">${p.capabilities.remote ? 'Sends project content to a remote service — requires your consent per project.' : 'Runs locally.'} ${p.metered ? 'Dollar cost is reported and capped.' : p.capabilities.automated ? 'Reports token usage only; ERA cannot cap its dollar cost.' : ''}</div></div>`)}</div>`;
}

function Roles({ s }) {
  return html`<div class="col"><${Callout}>Roles are configured in the <a href="#/agents">Agent Command Center</a>. Current default: <b>${s.agents.preset}</b>${s.agents.preset === 'custom' ? ` (architect ${s.agents.roles.architect ?? '—'}, implementer ${s.agents.roles.implementer ?? '—'}, reviewer ${s.agents.roles.reviewer ?? '—'})` : ''}, ${s.agents.review.rounds} correction round(s), blocking on ${s.agents.review.block_on}.<//>
    <dl class="kv"><dt>Reverse engineering</dt><dd>REA (fixed: the original engine)</dd><dt>Architecture & planning</dt><dd>${s.agents.preset === 'custom' ? s.agents.roles.architect ?? 'none' : 'from the team preset'}</dd><dt>Implementation</dt><dd>${s.agents.preset === 'custom' ? s.agents.roles.implementer ?? 'none' : 'from the team preset'}</dd><dt>Independent review</dt><dd>${s.agents.preset === 'custom' ? s.agents.roles.reviewer ?? 'none' : 'from the team preset'}</dd><dt>Orchestration, tests, approvals</dt><dd>ERA (fixed)</dd></dl></div>`;
}

function Tools() {
  const [t, setT] = useState(null);
  useEffect(() => { get('/api/tools').then(setT).catch(() => {}); }, []);
  if (!t) return html`<${Spinner} />`;
  return html`<div class="col"><dl class="kv"><dt>REA</dt><dd><${Badge} status=${t.rea.available ? 'ready' : 'unavailable'} /> ${t.rea.available ? `version ${t.rea.version}` : t.rea.error}</dd><dt>Command</dt><dd class="mono">${t.rea.command}</dd><dt>Native decompiler</dt><dd>${t.rea.decompiler_available ? 'available' : 'not configured (run era rea doctor)'}</dd><dt>MCP</dt><dd>${t.mcp.note}<div class="mono">${t.mcp.launch} · ${t.mcp.doctor}</div></dd></dl>
    <h4>Tool permissions</h4><dl class="kv">${Object.entries(t.permissions).map(([k, v]) => html`<dt>${k}</dt><dd>${v ? 'allowed' : 'off'}</dd>`)}</dl><span class="muted">Change these under Permissions.</span></div>`;
}

function Workspaces({ s }) {
  const f = useForm('workspaces', s.workspaces);
  const d = f.draft;
  return html`<div><${Row} id="w-def" label="Default project location" hint="Where new folders are suggested."><input id="w-def" type="text" style="width:100%" value=${d.defaultLocation ?? ''} placeholder="/absolute/path" onInput=${(e) => f.setDraft({ ...d, defaultLocation: e.target.value || null })} /><//>
    <${Row} id="w-roots" label="Allowed project directories" hint="One absolute path per line. When set, projects, analysis targets and rebuild destinations must be inside one of them."><textarea id="w-roots" class="field" rows="3" value=${d.allowedRoots.join('\n')} onInput=${(e) => f.setDraft({ ...d, allowedRoots: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) })}></textarea><//>
    <${Row} id="w-co" label="ERA checkout (Improvement Lab)" hint="A git clone of ERA that the Improvement Lab may change. Required for experiments."><input id="w-co" type="text" style="width:100%" value=${d.improvementCheckout ?? ''} placeholder="/path/to/era-agent" onInput=${(e) => f.setDraft({ ...d, improvementCheckout: e.target.value || null })} /><//>
    <${Row} label="Working copies and artifacts" hint="Isolated copies, run records, reports and logs live in ERA's state directory, never inside your projects."><code>${s.__state ?? 'see the status bar / diagnostics'}</code><//><${Bar} f=${f} /></div>`;
}

function Permissions({ s }) {
  const f = useForm('permissions', s.permissions);
  const d = f.draft;
  const T = ({ k, label, hint, risk }) => html`<${Row} label=${label} hint=${hint}><label class="check"><input type="checkbox" checked=${d[k]} onChange=${(e) => f.setDraft({ ...d, [k]: e.target.checked })} /><span>${d[k] ? 'Allowed' : 'Off'}${risk ? html` <span class="badge warn plain">${risk}</span>` : ''}</span></label><//>`;
  return html`<div><${Callout} kind="warn">Applying generated changes or integrating an ERA improvement always requires approval. Direct edit separately authorizes manual edits and terminal writes to original files.<//>
    <${T} k="directEdit" label="Direct edit of original files" hint="Off: the editor can only change isolated working copies; originals are read-only." risk="bypasses isolation" />
    <${T} k="terminal" label="Terminal" hint="A shell in a sandbox scoped to one project directory: no network, writes only inside the project." risk="runs commands" />
    <${T} k="runtimeCapture" label="Runtime capture during analysis" hint="Lets REA run the analyzed program (sandboxed) to capture behavior." risk="executes the target" />
    <${T} k="trustedExecution" label="Trusted execution (no sandbox)" hint="Run project commands without ERA's sandbox. Only for code you trust; needed where no sandbox exists." risk="unconfined" />
    <${Bar} f=${f} /></div>`;
}

function Privacy({ s }) {
  const f = useForm('privacy', s.privacy);
  const d = f.draft;
  return html`<div><${Callout}>Local-first: ERA runs on this machine. Source code leaves it only when you authorize a remote provider (Claude Code, Codex, …) for a project. Credential files and agent instruction files are withheld from agent copies; secret-looking content blocks remote sending.<//>
    <${Row} id="p-log" label="Log retention (days)" hint="Finished Studio job records older than this are removed at startup; project evidence and audit logs are retained."><input id="p-log" type="number" min="1" max="3650" value=${d.logRetentionDays} onInput=${(e) => f.setDraft({ ...d, logRetentionDays: Number(e.target.value) })} /><//>
    <${Row} label="Credential storage" hint="Studio stores no credentials and no API keys."><span>None stored by ERA Studio.</span><//>
    <${Row} label="Cloud data transmission"><span>${s.privacy.defaultRemoteConsent.length ? `Default consent: ${s.privacy.defaultRemoteConsent.join(', ')}` : 'No provider is pre-authorized. You are asked per project.'}</span><//><${Bar} f=${f} /></div>`;
}

function Execution({ s }) {
  const f = useForm('execution', s.execution);
  const d = f.draft;
  const N = (k, label, hint, min, max, step = 1) => html`<${Row} id=${`e-${k}`} label=${label} hint=${hint}><input id=${`e-${k}`} type="number" min=${min} max=${max} step=${step} value=${d[k]} onInput=${(e) => f.setDraft({ ...d, [k]: Number(e.target.value) })} /><//>`;
  return html`<div>${N('concurrentJobs', 'Concurrent jobs', 'Jobs running at once (one per project).', 1, 4)}${N('commandTimeoutMs', 'Command timeout (ms)', 'Per build/test/acceptance command.', 1000, 3600000, 1000)}${N('agentTimeoutMs', 'Agent timeout (ms)', 'Per coding-agent call.', 1000, 14400000, 1000)}${N('maxAttempts', 'Retry limit', 'Agent attempts per run (1–5).', 1, 5)}${N('maxCostUsd', 'Cost limit per run (USD)', 'A ceiling, not a charge: ERA stops the run when an agent that reports a dollar cost (Claude Code) reaches it. Agents without a dollar cost (Codex) are not capped by it.', 0, 100, 0.5)}${N('maxCostUsdTotal', 'Cost limit per project (USD)', 'A ceiling, not a charge: the sum over all runs of the project. Nothing is billed by ERA; any charge comes from your agent provider.', 0, 1000, 1)}
    <${Row} label="Agents without a dollar cost" hint="Some agents (for example Codex) report token usage but no dollar cost, so ERA cannot enforce a dollar spending cap on them. They are refused until you allow them here. Time limits and attempt limits still apply; your provider's own plan limits are the real cap."><label class="check"><input type="checkbox" checked=${d.allowUnmeteredAgents} onChange=${(e) => f.setDraft({ ...d, allowUnmeteredAgents: e.target.checked })} /><span>${d.allowUnmeteredAgents ? 'Allowed: these agents run without a dollar cap' : 'Not allowed (default)'} <span class="badge warn plain">no dollar cap</span></span></label><//>
    <${Row} label="Execution isolation" hint="Project commands run in ERA's sandbox where one exists."><span>${s.permissions.trustedExecution ? 'Trusted (no sandbox) — enabled under Permissions' : 'Sandbox (default)'}</span><//>
    <div class="muted" style="padding-top:8px">These are defaults for new projects; each project can set its own limits. Hard limits in ERA cap every value.</div><${Bar} f=${f} /></div>`;
}

function Advanced({ s }) {
  const f = useForm('advanced', s.advanced);
  const d = f.draft;
  const [diag, setDiag] = useState(null);
  return html`<div>${[['diagnostics', 'Diagnostics', 'Show audit and job details in the Diagnostics panel.'], ['devTools', 'Developer tools', 'Allow opening the browser developer tools in the desktop app (restart required).'], ['experimental', 'Experimental features', 'Currently none are gated behind this switch.']].map(([k, l, h]) => html`<${Row} label=${l} hint=${h}><label class="check"><input type="checkbox" checked=${d[k]} onChange=${(e) => f.setDraft({ ...d, [k]: e.target.checked })} /><span>${d[k] ? 'On' : 'Off'}</span></label><//>`)}<${Bar} f=${f} />
    <div class="row" style="margin-top:var(--space-4)"><${Btn} onClick=${() => get('/api/diagnostics').then(setDiag)}>Load diagnostics<//></div>
    ${diag ? html`<div class="col" style="margin-top:var(--space-3)"><dl class="kv"><dt>State directory</dt><dd class="mono">${diag.state_dir}</dd><dt>Logs</dt><dd class="mono">${diag.log_dir}</dd></dl><h4>Audit log (latest)</h4><pre class="mono muted" style="max-height:260px;overflow:auto">${diag.audit_tail.slice(-40).map((e) => `${e.at}  ${e.action}  ${JSON.stringify(Object.fromEntries(Object.entries(e).filter(([k]) => !['at', 'action'].includes(k))))}`).join('\n')}</pre></div>` : null}</div>`;
}

export function SettingsView({ route }) {
  const s = useStore();
  const sec = route.path[1] ?? 'general';
  const st = s.settings;
  const body = { general: html`<${General} s=${st} />`, appearance: html`<${Appearance} s=${st} />`, providers: html`<${Providers} />`, roles: html`<${Roles} s=${st} />`, tools: html`<${Tools} />`, workspaces: html`<${Workspaces} s=${{ ...st, __state: s.overview?.state_dir }} />`, permissions: html`<${Permissions} s=${st} />`, privacy: html`<${Privacy} s=${st} />`, execution: html`<${Execution} s=${st} />`, advanced: html`<${Advanced} s=${st} />` }[sec];
  return html`<div class="page"><div class="page-head"><h1>Settings</h1></div>
    <div class="settings-layout"><nav class="settings-nav" aria-label="Settings categories">${SECTIONS.map(([k, l]) => html`<button class="nav-item" aria-current=${sec === k ? 'page' : undefined} onClick=${() => navigate(['settings', k])}><span class="label">${l}</span></button>`)}</nav>
      <div><h2 style="margin-bottom:var(--space-3)">${SECTIONS.find(([k]) => k === sec)?.[1]}</h2>${body}</div></div></div>`;
}
