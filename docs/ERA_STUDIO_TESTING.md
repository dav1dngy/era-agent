# ERA Studio validation and development handoff

> **Historical record.** This page records the checks of the 2026-10-14 `v0.2.0-dev.1` checkpoint. For the current revision,
> its test counts and what is real, mocked or unverified, read [SUPPORT_AND_VALIDATION.md](SUPPORT_AND_VALIDATION.md).

Validation date: 2026-10-14 (Europe/Berlin). Platform: macOS arm64,
Node 24.20.0, Electron 44.7.1 (embedded Node 24.21.0), REA 6.4.0.
Development branch: `feature/era-v0.2.0`. The checks below were recorded before
publication. The `v0.2.0-dev.1` development prerelease publishes that checkpoint
without merging it into stable `main`; see `release-notes-v0.2.0-dev.1.md` for
the separate release-preparation checks and outstanding validation.

## Measured checkpoint results

UI refresh follow-up (2026-10-14): **14/14 Electron scenario groups passed**, including
live project cards/search, expanded navigation, command search and 1024×768 layout
checks, alongside the original workflow scenarios. Dark/light, projects, editor,
diff and narrow-window screenshots were visually inspected. **4/4 UI model/IPC tests**,
ESLint and tracked-file checks passed. The macOS arm64 package was rebuilt and its
isolated launch/shutdown smoke check passed. Coding agents remained simulated during
tests; authentication and billing configuration were not changed. The full-suite
numbers below describe the preceding backend checkpoint, not a new full-suite run.

- Full regression suite: **251 tests, 250 passed, 0 failed, 1 skipped** (162.8 s).
  The skipped test exercises a missing-sandbox path; macOS has the required sandbox.
- Final focused control-plane, UI model/IPC and multi-agent rerun: **58/58 passed**
  after the synthetic credential fixture cleanup (24.3 s).
- Actual Electron desktop: **12/12 scenario groups passed**, including normal app
  shutdown after the tests. REA is real; the coding agent is a simulated fixture.
- Packaged macOS arm64 app: launch and normal shutdown passed from a temporary
  directory outside the checkout. Renderer Node access is unavailable, the local
  API is authenticated, and the bundled REA dependency is reachable.
- Clean npm tarball installation: passed version/help/status and genuine JavaScript
  analysis (15 facts), resolving REA from the installed dependency.
- ESLint, tracked-file syntax/secret checks and Git whitespace checks passed.
  Synthetic secret-test values are constructed at runtime so the repository scanner
  remains strict without mistaking the test source for embedded credentials.

A diagnostic benchmark used the existing `runBenchmark` engine with one repetition
and a **30,000 ms per-case deadline**, without changing datasets or acceptance rules.
This bounded run is not a release benchmark or a measurement of repeated-run reliability.

| Case | Result | F1 | Wall time |
|---|---|---:|---:|
| JavaScript CommonJS | Succeeded | 1.0000 | 4,926 ms |
| JavaScript ESM | Succeeded | 0.9655 | 4,526 ms |
| Native Mach-O | Succeeded | 0.9677 | 18,065 ms |
| Native Mach-O with runtime | 30 s deadline; terminated | 0 (no completed result) | 30,010 ms |
| ZIP archive | Succeeded | 1.0000 | 2,389 ms |

The native runtime timeout is an incomplete diagnostic, not evidence of a regression
or a successful analysis. The separate native static run succeeded on retry; it does
not erase the earlier function timeout. Raw local results are in
`apps/studio/out/validation/benchmark.json` alongside the desktop/package reports.

## Reproduce

```sh
npm ci
npm ci --prefix apps/studio
npm test
npm run lint
npm run check
node --test tests/control-plane.test.js tests/studio-ui-model.test.js
npm run test:desktop --prefix apps/studio
npm run package --prefix apps/studio
npm run test:package --prefix apps/studio
bash scripts/clean-install-test.sh
```

The root suite includes existing CLI, Analysis Mode, REA/MCP, sandbox, Project Lab,
agent, evaluation, versions/rollback and Improvement Lab regression tests. The UI
model tests do not need Electron or browser dependencies. Control-plane tests use
real HTTP, CLI subprocesses, filesystem/Git, target tests and sandboxed terminal,
but a fake REA executable and scripted coding agents. Those tests establish policy
and orchestration, not model quality.

The desktop runner creates disposable external fixtures, disables real remote
provider commands, starts a hidden actual Electron window and interacts with real
rendered controls. It uses the installed **real REA CLI**, actual Monaco and project
tests. Its coding agent is explicitly marked **Simulated**. No user project is
approved, and no paid provider request is made. Screenshots and machine-readable
results are kept locally under ignored `apps/studio/out/validation`.

## Required scenario evidence

| Scenario | Evidence and scope |
|---|---|
| Desktop launch | Development and packaged `.app` smoke checks: shell loaded, main-process authentication, renderer Node unavailable, loopback backend and REA reachable |
| Open existing project | Actual fixture folder registered, project view opened, selected project preserved through Simple/Advanced mode changes |
| Genuine analysis | REA JavaScript analysis launched with rendered Inspect/Start controls; job succeeds with stored evidence/facts |
| Project Lab Review | UI starts Review, real REA produces evidence and source digest remains unchanged |
| Authorized Modify | UI starts isolated Modify with simulated implementer; actual fixture tests and acceptance commands pass; original remains unchanged |
| Code differences | Real Monaco diff editor receives distinct original/modified models and computes nonempty line changes |
| Test results | UI shows verified commands and itemized passing tests from the actual run |
| Approval/rejection | Desktop cancels approval without applying, then explicitly approves the fixture and verifies changed source; API tests also cover rejection/stale approval |
| Improvement Lab | UI opens real checkout history; existing regression suite tests its evaluate/approve/rollback engine separately |
| Mode switching | UI toggles Simple/Advanced, server persists mode and selected project is preserved |
| Provider states | UI shows actual unavailable CLI entries and explicitly simulated fixture; API distinguishes unauthenticated state |
| Authorization | External requests without token fail; renderer file write is refused; API tests exercise Origin/Host, workspace roots, symlinks, protected files, consent and stale hashes |

Additional checks cover shared component HTML escaping, styling, light/dark renders,
IPC foreign sender/subframe refusal, shutdown of queued/running work, diagnostic
permissions, clone validation, inline assistance prompt/credential exclusions and
cumulative cost accounting. Visual screenshots were inspected locally; no formal
accessibility compliance claim is made.

## Native analysis interrupted in the previous session

The original `hello` native run completed with **partial** analysis: Mach-O structure
and `_main` decompilation succeeded, `_greet` hit the REA timeout. The overall Studio
job correctly failed. Provider-dependent partial evidence is not reported as a full
success. Runtime capture was disabled. The original state/artifacts were preserved.

## Provider evidence and remaining scope

Real Codex integration and a small multi-agent task had been validated before Studio;
see `provider-validation.md` and `experiments/provider-validation/`. This continuation
has not rerun those paid providers. Claude Code was not freshly authenticated or
validated, and combined Claude/Codex execution is not newly proven here.

Desktop Rebuild UI, remote Git credentials, native dialogs, inline assistance with a
real AI provider, Intel/Windows/Linux, signing/notarization, clean-machine Gatekeeper
installation and formal accessibility remain unverified. Backend Rebuild/agent/core
regressions have their own existing tests; they do not replace those desktop tests.
There is no full new Improvement Lab integration into the stable branch: that action
would violate the instruction not to merge.

## Handoff

Implemented: local desktop/browser presentation, control-plane integration, real job
and evidence views, Project Lab, configurable providers, IDE components, permissioned
manual actions, history, package build, documentation and reproducible tests.

Next development phase: independent ERA Enterprise Engineering & Security Review.
Review the explicit limitations in `ERA_STUDIO_SECURITY.md`, especially signing,
concurrent filesystem races, provider isolation and platform support. No production
readiness, complete decompiler reliability or arbitrary-language/debugger support is
claimed by this checkpoint.
