# ERA v0.2.0-dev.0 — Studio development preview

This prerelease publishes the current `feature/era-v0.2.0` checkpoint. It does not
replace stable v0.1.0 or merge into `main`. ERA Studio is an unsigned, local,
single-user development application, not a production or enterprise-certified IDE.

## Changes since v0.1.0

- **ERA Studio:** Electron desktop and browser interfaces, graphite dashboard,
  searchable project cards, dark/light themes and Simple/Advanced modes.
- **Workbench:** Monaco editing and side-by-side diffs, project-scoped terminal,
  Git clone/status/diffs, task history and settings.
- **Project Lab:** Review, Modify and Rebuild for authorized external projects,
  isolated working copies, verification, explicit approval and rollback.
- **Configurable agents:** Architect, implementer and reviewer roles with provider
  consent, authentication checks, bounded attempts and recorded handoffs.
- **Control plane:** Authenticated loopback API, live events, supervised jobs and
  integration with the existing REA and Improvement Lab engines.
- Workspace restrictions, protected-file handling, unsaved-change prompts,
  subprocess cleanup and provider isolation fixes.

## Downloads and requirements

- **macOS Apple Silicon:** Extract the Studio archive and copy `ERA Studio.app` to
  Applications. The app is **not Developer ID signed or notarized**; clean-machine
  Gatekeeper installation remains unverified. Do not disable Gatekeeper globally.
- **CLI:** Install the attached npm tarball with
  `npm install -g ./era-agent-0.2.0-dev.0.tgz`. This tarball contains the CLI/core,
  not the Studio interface. No npm registry publication is part of this release.
- Studio requires Node.js `^22.19.0`, `^24.11.0` or `>=26`, Git and Python 3 for the
  terminal. Coding-agent CLIs and native decompilation providers are separate
  installations. Source-checkout instructions support desktop and browser use.

## Validation scope

**Recorded development evidence:** the backend checkpoint passed 250 of 251 tests,
with one expected sandbox-path skip and zero failures. The UI refresh passed
14/14 actual Electron scenario groups and 4/4 UI model/IPC tests. Packaged macOS
launch/shutdown and clean CLI installation passed. Desktop checks used **real REA
and simulated coding agents**. Earlier real Codex validation is documented separately;
Claude Code and mixed-provider execution remain unvalidated.

**Fresh local release preparation:** ESLint and tracked-file syntax/secret checks
passed. The root production dependency audit reported zero vulnerabilities;
registry verification reported 212 verified signatures and 48 verified attestations.
The 102 tracked application files in `src`, `bin`, Studio `web` and `electron`
matched the packaged app byte for byte. A fresh packaged-app smoke check passed:
real REA was reachable, renderer Node access was unavailable and main-process
authentication injection worked. These checks do not replace clean-machine
installation, independent security review or the recorded desktop scenarios.

Studio's production dependency audit reports **two low-severity findings** involving
Monaco's transitive DOMPurify dependency:
[GHSA-p98j-92pf-mc4p](https://github.com/advisories/GHSA-p98j-92pf-mc4p) and
[GHSA-6688-9rhm-gjv2](https://github.com/advisories/GHSA-6688-9rhm-gjv2).
They remain open in this preview; no breaking dependency update was applied.
The root audit and CLI SBOM do not cover the separate Studio dependency tree.
The separate Studio SBOM covers its npm runtime UI dependencies; it does not include
the bundled Electron 44.7.1 runtime. The CLI SBOM is produced by tag validation.

[GitHub Actions](https://github.com/dav1dngy/era-agent/actions) records CI and release
workflow results separately. The local evidence above does not claim completion of
those workflows. A CLI workflow attestation does not attest a locally built Studio
archive. Stable-release criteria, including repeated benchmarks and a direct REA
baseline, are not all fulfilled by this development preview.

## Known limitations

- **Screenshot-to-website Rebuild is not implemented.** Selecting a JPEG reference
  does not pass its image content to the coding agent.
- Rebuild requires configured acceptance checks or test commands. Studio does not
  generate these automatically or provide a complete behavior-definition editor.
- The New Task Rebuild dialog has incomplete project setup: starting without a
  project folder can fail, and new reference/destination values are not saved for
  an existing project. Configure these through the CLI/project configuration.
- Codex reports tokens, not dollar cost. ERA requires explicit unmetered-provider
  opt-in and cannot enforce a reliable Codex dollar budget. Billing follows the
  external CLI's authentication and provider account.
- Native decompilation/runtime capture can time out and produce partial evidence.
- Independent security review, signing/notarization, clean-machine installation,
  formal accessibility testing and Intel/Windows/Linux desktop validation remain outstanding.
- No debugger, external language-server manager, extension marketplace or enterprise
  identity/collaboration features are implemented.

See the [Studio guide](https://github.com/dav1dngy/era-agent/blob/v0.2.0-dev.0/docs/ERA_STUDIO.md),
[validation evidence](https://github.com/dav1dngy/era-agent/blob/v0.2.0-dev.0/docs/ERA_STUDIO_TESTING.md),
[security boundaries](https://github.com/dav1dngy/era-agent/blob/v0.2.0-dev.0/docs/ERA_STUDIO_SECURITY.md)
and [provider validation](https://github.com/dav1dngy/era-agent/blob/v0.2.0-dev.0/docs/provider-validation.md).
