import { html, useEffect, useState } from '../html.js';
import { get, post } from '../api.js';
import { Badge, Btn, Callout, Section, Spinner } from '../ui.js';
import { navigate, set, toast } from '../store.js';

export function ToolsView() {
  const [t, setT] = useState(null);
  useEffect(() => { get('/api/tools').then(setT).catch((e) => toast(e.message, 'bad')); }, []);
  if (!t) return html`<div class="page"><${Spinner} /></div>`;
  return html`<div class="page">
    <div class="page-head"><div class="grow"><h1>Tools</h1><p>The reverse-engineering engine and MCP integration ERA relies on.</p></div></div>
    <${Section} title="REA (original reverse-engineering engine)" actions=${html`<${Badge} status=${t.rea.available ? 'ready' : 'unavailable'} />`}>
      <dl class="kv"><dt>Version</dt><dd>${t.rea.version ?? '—'}</dd><dt>Command</dt><dd class="mono">${t.rea.command}</dd><dt>Native decompiler provider</dt><dd>${t.rea.decompiler_available ? 'available' : 'not configured'}</dd>${t.rea.error ? html`<dt>Problem</dt><dd class="error-text">${t.rea.error}</dd>` : null}</dl>
      <div class="row" style="margin-top:var(--space-3)"><${Btn} onClick=${async () => { try { await post('/api/tools/rea-doctor', {}); toast('REA doctor started: see Execution logs', 'ok'); set({ bottomOpen: true, bottomTab: 'logs' }); } catch (e) { toast(e.message, 'bad'); } }}>Run REA doctor<//></div><//>
    <${Section} title="MCP"><div class="col"><p>${t.mcp.note}</p><div class="mono">${t.mcp.launch}</div><div class="mono">${t.mcp.doctor}</div><${Callout}>To use ERA's analysis from Claude Code or another MCP client, register <code>era rea mcp</code> as an MCP server in that client. Studio does not manage external client configuration.<//></div><//>
    <${Section} title="Tool permissions"><dl class="kv">${Object.entries(t.permissions).map(([k, v]) => html`<dt>${k}</dt><dd><${Badge} status=${v ? 'ready' : 'none'} label=${v ? 'allowed' : 'off'} /></dd>`)}</dl><div style="margin-top:8px"><${Btn} onClick=${() => navigate(['settings', 'permissions'])}>Change permissions<//></div><//>
  </div>`;
}
