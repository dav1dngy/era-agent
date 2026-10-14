# ERA Studio security and review handoff

This is a local, single-user development application. These controls are implemented
and tested; they do not establish enterprise compliance or replace an independent audit.

## Implemented controls

- HTTP binds loopback, uses a random per-launch bearer token and checks Host/Origin.
  Mutations require JSON; no cross-origin permission is granted. Electron attaches
  authentication only to requests from its own application contents to its own origin.
  Browser mode retains the token in session storage after removing it from the fragment.
- Renderer Node integration is off, context isolation and sandbox are on, and webviews,
  foreign navigation/redirects and extra windows are blocked. Permissions are denied.
  IPC accepts only the main frame of the application's own WebContents. The bridge
  exposes a native picker and version query plus platform/authentication metadata.
- Web assets are served locally from an allowlist. CSP permits the exact import-map
  hash rather than arbitrary inline scripts. Reports are rendered as text/constructed
  elements rather than arbitrary HTML. Monaco uses local workers.
- Allowed workspace directories resolve through the real filesystem. Symlink escapes,
  `.git`/`.era` paths and configured protected-file edits are rejected. Changes to
  workspace policy also apply to existing projects' file/operation access.
- Original-file editing and terminal use default off. A project-scoped terminal has
  no network on macOS. Running/applied working copies refuse terminal access.
  Manual Direct edit deliberately authorizes original writes independently of generated
  patch approval. Terminal/coding-agent execution is not safe merely because it is in Git.
- Generated changes require explicit confirmation bound to the evaluated artifact.
  Stale original/workspace content refuses approval. Rollback validates current state.
  Unavailable, unauthenticated and simulated providers have distinct visible states.
- Inline assistance checks provider consent, excludes credential/instruction files as
  required by the existing exposure policy, scans secret-looking content, redacts prompt
  text, takes a private copy and verifies no modifications. It shares the project lock
  and reserves/reports spend in the project ledger, including conservative unfinished
  reservations. Unmetered providers require the existing explicit configuration opt-in.
- Native build staging never copies `.era`, unrelated files, credentials or repository
  history. Existing REA attribution, package licenses and Electron notices remain included.

## Limits and release blockers

For the `v0.2.0-dev.0` development prerelease, the Studio production dependency
audit reports two low-severity findings involving Monaco's transitive DOMPurify
dependency: [GHSA-p98j-92pf-mc4p](https://github.com/advisories/GHSA-p98j-92pf-mc4p)
and [GHSA-6688-9rhm-gjv2](https://github.com/advisories/GHSA-6688-9rhm-gjv2).
These remain open; no breaking dependency update was applied for this checkpoint.
The separate root production dependency audit reported zero vulnerabilities.
Audit severity is not an independent assessment of exploitability in Studio.

This listener is not a multi-user service. A process with the user's OS privileges
can access their local files and may recover the token. There is no RBAC, SSO,
remote hosting or OS-admin threat protection. Studio does not store provider credentials;
external CLI providers own their credential handling and subscriptions.

The macOS sandbox limits writes and credential/state reads; it is not a guarantee
against every hostile compiler, kernel exploit or provider process. Configured agent
commands are user-trusted executables and may need their own credential/network access.
Secret scanning is heuristic, and authorized provider transmission includes eligible
project context, not just a selected line. Cost caps depend on provider-reported dollar
usage; tokens alone cannot establish dollar spend. Do not claim a Codex dollar cap.

Pending work before broad distribution: independent adversarial security audit;
Developer ID signing/notarization and Gatekeeper validation; clean-machine prerequisite
validation; Windows/Linux confinement design; formal accessibility review. Native Hopper
function decompilation had one observed timeout and remains provider-dependent. Claude
Code integration was not newly validated during this continuation. Retention only
prunes terminal Studio job records at startup; it preserves audit/project evidence.

Workspace restrictions are a local policy rather than an OS-wide filesystem sandbox.
Filesystem checks and reads/writes are not atomic against a hostile same-user process
concurrently replacing directory entries; review this race boundary in the next audit.
Do not run simultaneous Studio instances against the same state directory.
