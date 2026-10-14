# ERA Studio v0.2.0 development

ERA Studio is a local desktop and browser client of ERA. It reuses the original
REA engine, Project Lab, configurable coding agents and Improvement Lab. This is
an unsigned development build, not a production release or enterprise certification.
The `v0.2.0-dev.0` GitHub prerelease publishes this development checkpoint without
merging it into stable `main` or publishing a new npm registry version.

## Install and launch

Requirements: macOS (validated on Apple Silicon), Node.js 22.19+, 24.11+ or 26+ as
specified in the root package, npm, Git and Python 3 for the terminal. Native
function decompilation additionally needs a REA-compatible provider such as Hopper.
Sign in to any coding-agent CLI you intend to use; Studio does not store credentials.

From an authorized checkout of `feature/era-v0.2.0`:

```sh
npm ci
npm ci --prefix apps/studio
node bin/era.mjs studio doctor
node bin/era.mjs studio app
# Alternatively, the same interface in a browser:
node bin/era.mjs studio serve --open
```

No Claude host application is required. The desktop shell detects a supported Node
on the inherited/login-shell PATH, rather than accidentally using an old system Node.
The CLI remains usable without installing `apps/studio` dependencies.
The browser URL carries a per-launch access token; keep it private.

## First project and task

Use **New Task** to describe the task, choose a project folder or existing project,
select a mode and inspect **Plan task**. Classification is deterministic keyword
routing, not an LLM conversation. You can override the mode. Read the plan and
explicitly authorize any named remote providers before starting.

**Projects → New project** opens an existing local folder and records its task,
agent preset, test commands and acceptance commands. An empty project ID is generated
from the folder name. **Clone repository** clones an authorized HTTPS/SSH repository
into a new folder using your existing Git authentication, then lets you register it.
Configuration edits support task, team, build/test commands and attempt limits.
For custom roles, configure the Agent Command Center first. History opens each
run's own report. Artifacts and source stay on the local machine unless an authorized
remote provider is involved.

## Workflows

- **Analyze:** inspect a target, review supported capabilities, then start REA.
  History exposes reports, facts, evidence and relationship graphs built from actual
  REA facts. Export Markdown or JSON. Cancel stops the analysis job. Runtime capture
  is off by default and supported only for native Mach-O targets. Skip decompilation
  when you need structure/imports without a native provider call.
- **Review:** checks an isolated copy, gathers REA/static evidence and optional agent
  findings without applying changes to the source. View findings and export the report.
- **Modify:** specify a task, tests and acceptance checks; ERA implements in an isolated
  copy, verifies it, and stops for human approval. Inspect the real Monaco diff and
  test results. Approval is bound to the evaluated artifact. Canceling the approval
  dialog does nothing; Reject discards the proposed working copy. Rollback reverses
  an applied patch only if integrity checks still pass.
- **Rebuild:** select an authorized reference, empty destination, authorization and
  task. Configure acceptance commands when creating the project. Structured reference
  behavior capture and advanced acceptance definitions remain available through the
  existing CLI/project configuration; there is no dedicated behavior editor in Studio.
  REA evidence supports an independent implementation; this is not full source recovery.
  At least one acceptance check or test command must be configured; Studio does not
  generate these automatically. Screenshot-to-website reconstruction is not implemented:
  choosing a JPEG reference does not pass its image content to the coding agent.
  The New Task Rebuild dialog also has incomplete project setup: starting without
  a project folder can fail, and it does not save new reference/destination values
  for an existing project. Use the CLI/project configuration for these values.
- **Improve:** configure an ERA Git checkout under Workspaces. View real version and
  experiment history, self-analyze, propose, implement, evaluate, inspect guards/diffs,
  approve or decline, rebase and roll back through the existing Improvement Lab.
  The checkout must satisfy that lab's clean-tree and security requirements.

## Simple and Advanced modes

Simple mode emphasizes task input, results and approvals. Advanced adds the workbench,
analysis/tools navigation, pipeline, context and bottom panels. Switching modes keeps
project context; the setting persists. Startup can reopen the last project in this
browser profile. Precision Dark, Executive Light, system theme, accent, font size,
editor font and density are configurable.

The graphite interface uses a narrow, expandable icon sidebar, recent project cards,
workspace/provider status and a task composer. The Projects library has text search
and Running / To review filters. Search in the header opens the command palette.
Layout direction was informed by the user's [IDE design reference by Soumajit Das](https://dribbble.com/shots/27778747-Cloud-based-IDE-with-Edu-platform-integrated);
ERA uses original icons/styles and actual project state, without copying its assets
or adding unsupported education/account statistics.

The workbench uses Monaco for files and side-by-side diffs, with tabs, search, Git
status/diffs/history and AI actions on selected text. Explain/Review/Find bugs use a
read-only snapshot and provider consent. Refactor/Implement create an isolated Modify
task. Original files are read-only until Direct edit is explicitly enabled. Manual
edits to a verified working copy invalidate approval; interrupted/manual runs can be
resumed, but a changed run awaiting approval must be rejected and started afresh.
Save needed edits separately before rejecting a working copy.

Terminal access is separately off by default. On macOS it uses a project-scoped
sandboxed PTY with no network. It cannot open in a running/applied working copy.
Enabling Direct edit also allows a terminal in the original project. This explicitly
authorizes manual writes; generated changes still require approval.

Shortcuts: Cmd/Ctrl+K command palette, +B sidebar, +J bottom panel, +, settings,
+Shift+M mode, +S save. The bottom separator supports dragging and arrow keys;
explorer/context widths use resize handles. Unsaved editor changes require a discard
choice when closing a tab, changing routes or closing the window.

## Packaging and installation

```sh
npm run package --prefix apps/studio
open 'apps/studio/out/ERA Studio-darwin-arm64/ERA Studio.app'
```

The build stages allowlisted sources and locked production dependencies, then creates
an unpacked `.app` under `apps/studio/out/`. It excludes Git history, `.era`, projects,
credentials and development dependencies. Copy the `.app` to Applications if desired.
`ERA_PACKAGE_ARCH=x64` requests Intel packaging, which has not been validated here.
The application still needs Node/Git/Python and optional external providers installed.

Packaged state defaults to the app's Application Support directory; development
launches share the CLI's selected state directory. `ERA_STUDIO_CWD` and `ERA_STATE_DIR`
can select another local workspace/state directory. Set the Improvement Lab checkout
explicitly for the packaged app. No automatic updater is installed.

This build has **no Developer ID signing or notarization**. Distribution requires an
Apple Developer ID identity, hardened-runtime/entitlement review, signing the final
bundle, notarizing and stapling it, and a clean-machine Gatekeeper test. Do not disable
Gatekeeper globally. These local build commands do not push, merge or publish; the
development prerelease is created separately and does not replace stable v0.1.0.

## Troubleshooting and limits

- REA unavailable: run `studio doctor`; install a supported Node and `npm ci`.
- Native decompilation can time out. The interrupted development session timed out
  on `_greet`; structure and `_main` evidence survived in a partial report. Use Skip
  decompilation, inspect provider diagnostics, or retry separately. A partial report
  is not a successful complete analysis.
- Provider unavailable/not signed in: use its own CLI login. Existing real Codex
  evidence is documented in `provider-validation.md`; this Studio continuation used
  a simulated agent for repeatable UI tests, not a fresh paid model run.
- Codex billing follows the CLI's authentication: ChatGPT sign-in uses the account's
  plan allowance and any eligible additional credits; API-key sign-in uses separately
  billed API usage. Studio creates no extra free quota. Check `codex login status`
  before using it. Codex does not report dollar cost to ERA, so dollar enforcement is
  unavailable and the existing explicit unmetered-provider opt-in remains required.
  See [OpenAI authentication](https://learn.chatgpt.com/docs/auth) and
  [pricing and limits](https://learn.chatgpt.com/docs/pricing).
- An unexpected exit marks jobs interrupted on restart. Project locks prevent
  resuming over a surviving process; inspect it before retrying. In-flight inline AI
  assistance is a bounded request, not a resumable job.
- No debugger adapter, external language-server manager, extension marketplace,
  hosted collaboration, RBAC/SSO or arbitrary MCP connection manager is implemented.
  Tools reports the existing REA MCP integration. Monaco supplies bundled language support.
- Interface text is English; selecting another language does not translate it yet.
  Run/audit evidence is retained; only finished Studio job records follow the configured
  startup retention policy. There is no automatic evidence deletion or credential store.
- Native `.app` builds, sandbox, UI and terminal have been validated on macOS arm64;
  Windows/Linux and Intel remain unverified. Accessibility has basic keyboard/focus
  support, not a formal audit. See the testing and security documents before release.
