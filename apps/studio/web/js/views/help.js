// Help: a concise, offline guide to the workflows that need explanation. It ships with the app (no network), is reachable from the
// sidebar, the command palette, the Help menu and context links (#/help/<topic>), and points to the versioned documentation.
import { html } from '../html.js';
import { Callout, Section } from '../ui.js';
import { navigate, useStore } from '../store.js';

const DOCS = 'https://github.com/dav1dngy/era-agent/tree/feature/era-v0.2.0/docs';
const ext = (path, label) => html`<a href=${`${DOCS}/${path}`} target="_blank" rel="noreferrer">${label}</a>`;

const TOPICS = [
  ['start', 'Getting started'],
  ['costs', 'Providers, cost and consent'],
  ['rebuild', 'Rebuild prerequisites'],
  ['approval', 'Approval and rollback'],
  ['security', 'Security boundaries'],
  ['troubleshooting', 'Troubleshooting'],
];

const Start = () => html`<${Section} title="Getting started">
  <div class="col">
    <p>ERA Studio is a local workbench. It analyzes software with the REA engine and lets a coding agent change or rebuild a project in an <b>isolated copy</b>. Your original files change only after you approve a verified diff, and you can roll an approved change back.</p>
    <ol>
      <li><b>Requirements.</b> Node.js 22.19+ (or 24.11+), Git, and Python 3 for the terminal. REA is included. Native decompilers (Ghidra, Hopper, IDA) and coding agents (Codex, Claude Code) are separate installations.</li>
      <li><b>Create a project.</b> Projects → New project: choose Review (read-only analysis), Modify (change your code) or Rebuild (reconstruct behavior of an authorized reference).</li>
      <li><b>Describe the check.</b> Add test commands and acceptance checks. A change is accepted only when they pass and nothing that passed before fails.</li>
      <li><b>Review and approve.</b> The Changes page shows the exact diff, the checks and the risks.</li>
    </ol>
    <${Callout} title="Native decompilers">Ghidra needs a JDK 21 on your PATH and <code>GHIDRA_INSTALL_DIR</code>. The desktop app imports your shell's PATH but not other variables; start Studio from a terminal (<code>era studio app</code>) if you rely on them. Check <i>Tools → Run REA doctor</i>.<//>
    <p>${ext('ERA_STUDIO.md', 'Studio guide')} · ${ext('installation.md', 'Installation')}</p>
  </div><//>`;

const Costs = () => html`<${Section} title="Providers, cost and consent">
  <div class="col">
    <p>Remote coding agents (Codex, Claude Code) send project content to a provider. ERA asks for <b>consent per project and per provider</b>; credential-like files and agent instruction files are withheld, and this is re-checked before every agent run. Secret-looking content stops a run unless you allow it.</p>
    <p><b>Spending caps</b> work for agents that report dollar costs (Claude Code). Codex reports tokens only, so ERA cannot enforce a dollar cap and refuses to run it until you enable <i>Settings → Execution → Allow agents without a dollar cap</i>. That setting is off by default and is never enabled silently.</p>
    <p><b>Sign-in.</b> ERA never stores provider credentials. Sign in with the provider's own CLI (for example <code>claude auth login</code>); Settings → AI Providers shows each provider's state, and simulated or unavailable providers are labeled.</p>
    <${Callout} kind="warn" title="What consent does not limit">A provider's command-line tool can read any file your account can read, not only the project. Authorizing a provider authorizes that exposure.<//>
    <p>${ext('provider-configuration.md', 'Provider configuration')} · ${ext('multi-agent.md', 'Multi-agent engineering')}</p>
  </div><//>`;

const Rebuild = () => html`<${Section} title="Rebuild prerequisites">
  <div class="col">
    <p>Rebuild reconstructs <i>stated behavior</i> of a reference you are authorized to analyze; it does not prove equivalence. Before a run, ERA checks everything that could stop or weaken it and shows the whole list with a fix for each item:</p>
    <ul>
      <li>a coding agent is installed and signed in, and supports images if you give screenshots;</li>
      <li>a spending cap exists, or unmetered agents are explicitly allowed;</li>
      <li>consent for each remote provider, and your authorization statement for the reference;</li>
      <li>acceptance checks or behaviors to compare (nothing is accepted without them);</li>
      <li>an <b>empty</b> destination folder outside the project;</li>
      <li>a sandbox for running commands (macOS), or Trusted execution if you accept running them unconfined;</li>
      <li>for screenshots, an offline renderer for the visual comparison.</li>
    </ul>
    <p>${ext('project-lab.md', 'Project Lab')} · ${ext('screenshot-rebuild.md', 'Screenshot rebuild')}</p>
  </div><//>`;

const Approval = () => html`<${Section} title="Approval and rollback">
  <div class="col">
    <p><b>What approval applies.</b> Exactly the final, verified diff. Checks and protected-file rules are applied to the working copy <i>after</i> your build and test commands ran; if anything changed since verification, ERA refuses and applies nothing. Approval is your confirmation on this machine, not an authenticated identity.</p>
    <p><b>Roll back a Modify.</b> ERA reverses the same patch. If you edited those files since, the reversal is refused rather than guessed.</p>
    <p><b>Roll back a Rebuild.</b> The destination is deleted only if it still matches, file for file, what ERA wrote, including hidden and generated folders such as <code>.git</code> or <code>build</code>. If you added, removed or changed anything there, rollback is refused and nothing is deleted; remove the folder yourself once you are sure.</p>
    <p>${ext('ERA_STUDIO_SECURITY.md', 'Security')}</p>
  </div><//>`;

const Security = () => html`<${Section} title="Security boundaries">
  <div class="col">
    <ul>
      <li>The control plane listens on <b>127.0.0.1 only</b> and requires a per-launch token. It is a single-user tool, not a multi-user service.</li>
      <li>On macOS, project commands and terminals run in a sandbox: no network, writes only to their working copy, no signalling of your other programs, and the home directory and shared temp folders are unreadable except for the tools and the working copy they need. Linux has no ERA sandbox; commands there need Trusted execution.</li>
      <li>The Git panel runs git without your configuration or environment, inside the sandbox, so a repository cannot run its own programs just because you opened it. Without a sandbox, repositories that configure such programs are not inspected unless you enable Trusted execution.</li>
      <li>Terminals are closed immediately when you revoke the Terminal or Direct-edit permission, change the allowed folders, or a run stops being editable.</li>
      <li>Coding-agent CLIs are limited only by their own isolation (see Providers).</li>
    </ul>
    <p>${ext('ERA_STUDIO_SECURITY.md', 'Security model and limits')}</p>
  </div><//>`;

const Troubleshooting = () => html`<${Section} title="Troubleshooting">
  <div class="col">
    <dl class="kv">
      <dt>"access token was rejected"</dt><dd>Restart <code>era studio serve</code> and open the new URL; the token changes each launch.</dd>
      <dt>REA unavailable</dt><dd>Tools → Run REA doctor, or <code>era status</code>. Reinstall dependencies with <code>npm install</code>.</dd>
      <dt>Ghidra shows unavailable</dt><dd>Set <code>GHIDRA_INSTALL_DIR</code> and put a JDK 21 on PATH, then start Studio from that shell.</dd>
      <dt>Native analysis hangs</dt><dd>Hopper is a desktop app and stalls if the Mac sleeps or a dialog is open. Keep the Mac awake and close the dialog.</dd>
      <dt>A run is stuck or interrupted</dt><dd>Open the project and resume or cancel the run. Project Lab keeps a lock so two runs never edit the same project.</dd>
      <dt>An agent was not started</dt><dd>Read the message: missing consent, no dollar cap, not signed in, or secret-looking content that appeared in the working copy.</dd>
      <dt>Something looks wrong</dt><dd>Execution logs (bottom panel in Advanced mode) and the audit log in Settings → Advanced show what ran.</dd>
    </dl>
    <p>${ext('installation.md', 'Installation and recovery')} · ${ext('testing.md', 'Testing')}</p>
  </div><//>`;

const BODY = { start: Start, costs: Costs, rebuild: Rebuild, approval: Approval, security: Security, troubleshooting: Troubleshooting };

export function HelpView({ route }) {
  useStore();
  const topic = BODY[route.path[1]] ? route.path[1] : 'start';
  const Body = BODY[topic];
  return html`<div class="page">
    <div class="page-head"><div class="grow"><h1>Help</h1><p>An offline guide to setup, cost and consent, Rebuild, approval and rollback, and troubleshooting. This page works without a network connection.</p></div></div>
    <div class="row" role="tablist" aria-label="Help topics" style="flex-wrap:wrap;gap:var(--space-2);margin-bottom:var(--space-3)">${TOPICS.map(([id, label]) => html`<button type="button" role="tab" class=${`btn ${topic === id ? 'primary' : ''}`} aria-selected=${topic === id} onClick=${() => navigate(['help', id])}>${label}</button>`)}</div>
    <${Body} />
  </div>`;
}
