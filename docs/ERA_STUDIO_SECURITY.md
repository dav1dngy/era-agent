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
- **Spending policy:** agents that report no dollar cost (Codex) are refused until you turn on
  *Settings → Execution → Agents without a dollar cost* (default off, audited as `policy.unmetered_agents`).
  Studio jobs never inherit `ERA_ALLOW_UNMETERED_AGENTS` from the environment; the setting is the single switch. The
  prerequisite checklist states when a run has no dollar cap.
- **Screenshot uploads** are accepted only as PNG/JPEG/WebP by content, size-limited, stored privately, and served back
  by exact name pattern. Metadata is removed before any agent sees an image. Run artifacts are served only for
  `reference-images/*`, `visual-attempt-N/rendered.png`, `plan.md`, `SPEC.md` and the architect's design.
- **Visual renderer:** generated sites are rendered in a separate Electron process under ERA's macOS sandbox profile (no
  network, confined writes), with an in-memory session that cancels every request except files in the site folder. Chromium's
  own sandbox cannot be nested inside that profile and is disabled for that process only; the profile is the confinement.
- Native build staging never copies `.era`, unrelated files, credentials or repository
  history. Existing REA attribution, package licenses and Electron notices remain included.

## Limits and release blockers

For the `v0.2.0-dev.1` development prerelease, the Studio production dependency
audit reports two low-severity findings involving Monaco's transitive DOMPurify
dependency: [GHSA-p98j-92pf-mc4p](https://github.com/advisories/GHSA-p98j-92pf-mc4p)
and [GHSA-6688-9rhm-gjv2](https://github.com/advisories/GHSA-6688-9rhm-gjv2).
These remain open; no breaking dependency update was applied for this checkpoint. They cannot be fixed by an npm
override: Monaco's prebuilt bundle contains its own DOMPurify 3.4.15, and no newer Monaco exists. `tests/studio-dependencies.test.js`
records why they are not reachable here (both need DOMPurify's `IN_PLACE` mode, which Monaco never requests; and Studio's CSP has no
`unsafe-inline` for scripts, so injected inline handlers do not run, verified in a live page) and fails if a Monaco upgrade changes that.
The separate root production dependency audit reported zero vulnerabilities.
Audit severity is not an independent assessment of exploitability in Studio.

This listener is not a multi-user service. A process with the user's OS privileges
can access their local files and may recover the token. There is no RBAC, SSO,
remote hosting or OS-admin threat protection. Studio does not store provider credentials;
external CLI providers own their credential handling and subscriptions.

The macOS sandbox denies network and writes outside the working copy, denies signalling processes outside the sandbox, and (after the
v0.2.0 audit) denies reads of the home directory and the shared temporary folders except for the toolchains on `PATH`, ERA's own code,
the working copy and named inputs; locations outside those, such as external volumes, remain readable. It is not a guarantee
against every hostile compiler, kernel exploit or provider process. Configured agent
commands are user-trusted executables and may need their own credential/network access.
Secret scanning is heuristic, and authorized provider transmission includes eligible
project context, not just a selected line. Cost caps depend on provider-reported dollar
usage; tokens alone cannot establish dollar spend. Do not claim a Codex dollar cap.

Provider CLIs (Codex, Claude Code) run under their own sandboxes, which permit **reading files anywhere your user can**.
In a real validation run Codex found a reference screenshot elsewhere on disk by the file name listed in the specification and
viewed it. A provider agent can therefore also read other projects' files in ERA's state directory; ERA cannot prevent that
(it can only withhold credential and instruction files from the working copy it creates). Treat authorizing a remote provider as
authorizing it to see what your account can see.

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

## Controls added after the independent v0.2.0 audit

Each is covered by a regression test that fails on the previous code (`tests/audit-remediation.test.js`, `tests/audit-control-plane.test.js`);
details and evidence are in [ERA_V020_REMEDIATION.md](ERA_V020_REMEDIATION.md).

* **Verification binds to the final diff.** Protected-path, file-count and diff-size guards are applied to the working copy after the
  build, test and acceptance commands ran; the verified patch hash is what approval applies.
* **Rebuild rollback needs a complete manifest.** It deletes the destination only when no path (including `.git`, `build`, `dist`,
  `node_modules`) was added, removed or changed since approval.
* **Exposure is enforced per agent invocation.** Credential files and instruction files regenerated by commands are removed from the
  directory an agent will see, secret-looking content stops the run, and each invocation is recorded.
* **The Git panel does not execute repository configuration.** git runs with a scrubbed environment, no user or system configuration,
  inside the sandbox (no network, no writes); without a sandbox, repositories that configure programs git would run are refused unless
  Trusted execution is on.
* **Terminals follow the policy for their whole life.** Revoking Terminal or Direct edit, changing the allowed folders, or a run leaving
  its editable state kills the terminal's process group (processes that deliberately detach into a new session are not covered).
* **Malformed requests cannot stop the control plane.** They are answered with 400.

