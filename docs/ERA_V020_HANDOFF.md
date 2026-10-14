# ERA v0.2.0 development handoff

## Current status (read this first; updated after the audit remediation)

- **Branch** `feature/era-v0.2.0` (`git log -1` is the current checkpoint). The remote branch of the same name is at `52dcf82`, so everything
  after Phase 3A, including Phase 3B, the audit and the remediation, exists only locally until someone decides to publish it. Tags
  `v0.2.0-dev.0` and `v0.2.0-dev.1` exist; `main` (v0.1.0) is untouched.
- **Rule: do not merge into `main`, push, tag, publish or create a release without an explicit instruction from the user, each time.**
- **Done:** Phase 3A (Studio); Phase 3B (measured Studio baseline, real REA analysis of the Studio bundle, two Lab-accepted improvements, one
  rejected; [ERA_STUDIO_SELF_IMPROVEMENT.md](ERA_STUDIO_SELF_IMPROVEMENT.md)); an independent audit
  ([ERA_V020_INDEPENDENT_AUDIT.md](ERA_V020_INDEPENDENT_AUDIT.md): NOT READY, 5 HIGH, 8 MEDIUM, 3 LOW); and its remediation
  ([ERA_V020_REMEDIATION.md](ERA_V020_REMEDIATION.md): all HIGH and MEDIUM findings fixed with regression tests; L01 partial).
- **Evidence for the current revision** (test counts, platform, real vs mocked): [SUPPORT_AND_VALIDATION.md](SUPPORT_AND_VALIDATION.md).
  Everything below the "Phase 3A record" heading is the 2026-10-14 record of that earlier checkpoint and is kept for history; where it
  differs from the pages above, the pages above win.
- **Not release-ready.** Remaining blockers are listed in section 5 of the remediation document: independent re-review of the fixes, a hosted CI run
  of the desktop job, signing and notarization (if a distributed app is intended), real Claude Code and `claude+codex` validation with
  explicit authorization, clean-machine installation, five missing captures and an accessibility pass.
- **Improvement Lab:** needs a branch named `main` (it merges accepted cycles there), is blind to `apps/studio/`, and is now at its REA-run hard cap
  (50 per cycle: the self-analysis needs 25 runs per side). Run it in a throwaway clone with its own `main`, as Phase 3B and the remediation did.
- **Next:** Phase 4 (enterprise engineering and security) once the blockers above are owned; do not start it by weakening a regression test.
- **Environment:** Ghidra needs a JDK 21 on `PATH` and `GHIDRA_INSTALL_DIR` (set in `~/.zshrc` on the development machine). Keep the machine
  awake during Hopper-backed runs (`caffeinate`). Check `git status` and running sessions before editing; another session may be working.

## Phase 3A record (historical, 2026-10-14)

Written for a new Claude Code session at the end of Phase 3A. It records what was verified at commit `52dcf82ffc246fc85731af8505d33dcda767f187`
("Add screenshot-rebuild validation evidence and provider-validation notes"). Numbers below are from that checkpoint, not the current one.

## Architecture

ERA is a Node (ESM, Node >= 22.19) CLI with one runtime dependency: `rea-agents@6.4.0`, run as a subprocess (never vendored).

| Area | Path | Role |
|---|---|---|
| CLI | `bin/era.mjs`, `src/cli.js`, `src/commands/*` | `analyze`, `inspect`, `explain`, `improve`, `project`, `studio`, `status`, `agents`, `rea` passthrough |
| REA client | `src/rea_integration/rea-client.js` | resolves `rea` (config, `ERA_REA_BIN`, `node_modules/.bin`, PATH), runs it |
| Analysis | `src/analysis/` | detect target type, run REA workflows, record facts, write reports |
| Improvement Lab | `src/improvement/`, `src/orchestration/`, `src/evaluation/`, `src/safety/`, `src/self_analysis/` | propose, implement, evaluate, approve, roll back changes to ERA itself, on worktrees |
| Project Lab | `src/project_lab/` | review, modify, rebuild of user projects in sandboxed working copies; preflight, exposure filters, run ledger |
| Multi-agent | `src/agents/{coding-agents,team,reasoning}.js`, `src/project_lab/team.js` | architect/implementer/reviewer roles; adapters for `claude-code`, `codex`, `command`, `manual` |
| Control plane | `src/control_plane/` (`server.js`, `services/*`, `jobs.js`, `auth.js`) | loopback HTTP API with a per-launch bearer token, jobs, PTY terminal |
| Studio | `apps/studio/web/` (Preact + htm, Monaco, xterm), `apps/studio/electron/` | thin client of the control plane; Electron shell, browser mode via `era studio serve` |
| Tests | `tests/*.test.js` (32 files), `apps/studio/scripts/test-*.cjs` | node:test suite; Electron scenario tests |

Key decisions are in `docs/ADR_ERA_STUDIO_PLATFORM.md` (Electron shell + loopback control plane, Studio holds no business
logic), `docs/ERA_STUDIO_ARCHITECTURE.md`, and `docs/architecture.md`. In short:

- Studio never talks to REA or agents directly; everything goes through the authenticated control plane.
- ERA never stores provider credentials; it asks the CLI for status and passes an allowlisted environment.
- Protected paths (`src/safety/`, `src/evaluation/`, `src/self_analysis/rules.js`, `benchmarks/datasets/`,
  `benchmarks/acceptance.json`) must never be changed by an automated improvement cycle (see CONTRIBUTING.md).
- Remote providers need per-project, per-provider consent (`--allow-remote`); unmetered agents (Codex reports tokens, not
  dollars) are refused unless `projectLab.budget.allowUnmeteredAgents` is set explicitly.
- Approval and merge are always a human step; nothing is merged or published automatically.

## Install and start

```bash
cd era-agent
npm install                       # root (REA dependency)
npm install --prefix apps/studio  # Studio deps incl. Electron (downloads Electron)
node bin/era.mjs status           # branch, REA resolution, providers
# Ghidra needs: export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH" GHIDRA_INSTALL_DIR=/opt/homebrew/opt/ghidra/libexec
node bin/era.mjs agents           # coding agents / reasoning providers / teams
node bin/era.mjs studio serve --open   # browser mode; prints a URL with a one-time token (keep private)
node bin/era.mjs studio                # Electron desktop (or: cd apps/studio && npm start)
npm test && npm run lint && npm run check
cd apps/studio && npm run test:desktop   # Electron scenarios (opens windows, ~1-2 min)
```

## Real test results (this session, on `52dcf82`)

| Check | Result |
|---|---|
| `npm test` | **296 tests: 295 pass, 0 fail, 1 skipped** (181.5 s). The skip is the missing-sandbox path; macOS has a sandbox. |
| `npm run lint` | passes (exit 0) |
| `npm run check` | "checks passed (407 tracked files)" |
| `npm run test:desktop` (Electron 44.7.1) | **14/14 scenario groups PASS**; REA real, coding agent simulated |
| `era studio serve` | listens on 127.0.0.1; `/` returns 200; `/api/status` without token returns 401 |
| REA backend | `era status`: rea-agents 6.4.0 via local dependency; Hopper available, IDA unavailable; Ghidra 12.1.4 is installed (Homebrew) but only visible to REA when `GHIDRA_INSTALL_DIR` and a JDK on PATH are set, see Install and start; `era analyze apps/studio/web/js/api.js` completed and wrote a report |

Not run this session: `npm run test:package`, `clean-install-test`, the benchmark suite, the live provider validation scripts.

Caveat: an earlier `npm test` run, taken while another session was still editing, had 3 failures
(`multi-agent` team-flags test expecting an old consent message, `project-lab` "refuses to run in CI" hitting "Unknown project"
first, and `e2e-lab` "accepted experiment waits for approval" returning `rejected`). The first two tests were updated in the other
session's commits and the full suite then passed; the e2e-lab failure did not reproduce but was never diagnosed. Treat
`tests/e2e-lab.test.js` as possibly sensitive to concurrent load or edits to the checkout.

## Completed functionality (verified by tests or the runs above)

- Studio: authenticated desktop/browser client; dashboard with project cards and search; navigation, command search, dark/light
  themes; Project Lab review, modify and rebuild views; Plan & design view with optional plan-review gate; Monaco editor and diff;
  terminal; analysis from the UI; Improvement Lab history view; agents/settings including the explicit unmetered-spend setting.
- Rebuild preflight checklist (`era project check`, `GET /api/projects/:id/preflight`), saved project configuration.
- Screenshot-to-website rebuild: validated images, offline sandboxed render, visual scoring (`docs/screenshot-rebuild.md`).
- Real-Codex evidence: with image 0.9271 similarity vs. 0.1048 blind control, one run each, one synthetic page
  (`docs/provider-validation.md`, `experiments/screenshot-rebuild/`).

## Incomplete functionality

- Claude Code is installed (2.1.260) but **signed out**; none of its roles or its image path are validated. Needs
  `claude auth login`, then `node scripts/validate-providers.mjs claude-code`.
- No `claude+codex` multi-provider run has been done with real agents; real runs covered Codex-only tasks that were tiny.
- No cost enforcement against a real metered agent.
- Studio has no debugger, language-server manager, extension marketplace or collaboration features.
- Native decompilation and runtime capture can time out and yield partial evidence.
- Unsigned, un-notarized macOS arm64 build only; no Intel/Windows/Linux desktop validation, no formal accessibility testing,
  no independent security review, no clean-machine install test.
- Stale doc: `docs/release-notes-v0.2.0-dev.1.md` still lists screenshot rebuild and rebuild setup as not implemented; those
  limitations were fixed after the release (see CHANGELOG "Unreleased").
- No `CLAUDE.md` existed before this handoff; one was added.

## Known bugs and risks

- No open defect is confirmed from this session's runs. Unconfirmed: the intermittent `e2e-lab` rejection above.
- Studio production dependency audit: two low-severity advisories (GHSA-p98j-92pf-mc4p, GHSA-6688-9rhm-gjv2) via Monaco's
  bundled DOMPurify. They cannot be fixed by an override; `tests/studio-dependencies.test.js` documents why they are unreachable
  and fails if a Monaco upgrade changes that.
- `era doctor` is not a CLI command (it only exists inside the Studio command module); `era agents`/`era status` are the checks.
- Several memory/doc statements about "nothing pushed" are out of date: the branch and dev tags are on origin.

## Security limitations (see `docs/ERA_STUDIO_SECURITY.md`)

- The control plane is a loopback, single-user service. Any process running as the same OS user can reach local files and may
  recover the token; no RBAC, SSO or remote hosting.
- The macOS sandbox limits project commands (no network, confined writes); it is not a guarantee against kernel exploits or
  hostile providers. Linux has no ERA sandbox (detection only); project commands there need `--trust-project`.
- **Provider CLIs can read any file the user can**, including other projects in ERA's state directory. This was observed: Codex
  found a reference screenshot on disk by name. Authorizing a remote provider authorizes exposure of project context.
- Secret scanning is heuristic. Cost caps depend on provider-reported dollars; Codex reports tokens only, so no Codex dollar cap.
- Approval is a local acknowledgement, not an authenticated identity.

## Integration status

- **REA**: real and working (6.4.0 via local dependency). Verified by tests, the desktop scenarios, and a live `era analyze`.
  `docs/rea-integration.md` lists which workflows are verified (ASAR is not).
- **Project Lab**: review, modify and rebuild work end to end with real REA and sandboxed project tests; the desktop tests use a
  simulated coding agent. Single project operation at a time. See `docs/project-lab.md`, `docs/project-lab-testing.md`.
- **Multi-Agent**: roles, consent, exposure filters and review loop implemented and tested with fake CLIs. Real Codex-only runs
  validated; real Claude Code never validated (see `docs/multi-agent.md`, `docs/multi-agent-testing.md`).
- **Improvement Lab**: propose, implement, evaluate, approve (merge `--no-ff` plus `era-vN` tag) and rollback implemented and
  covered by e2e tests; 5 cycles recorded in this checkout (3 integrated). Studio can display history; driving cycles from
  Studio is limited. See `docs/improvement-lab.md`.

## Remaining development tasks

1. Phase 3B: REA-driven Studio self-improvement. Use the Improvement Lab on `apps/studio/` code, with REA evidence of the
   shipped Studio bundle as the verification source. Design the cycle so protected paths stay out of scope, and decide
   whether Studio code is part of the evaluated target (it is not covered by the benchmark datasets today).
2. Sign in to Claude Code and run the provider validation; then a real `claude+codex` team run.
3. Refresh `docs/release-notes-v0.2.0-dev.1.md` or write a new dev.2 note; keep CHANGELOG "Unreleased" accurate.
4. Diagnose the `e2e-lab` intermittent rejection under load.
5. Package/notarize and test on a clean machine; accessibility pass; independent security review.

## Follow-up verification (2026-10-14, commit 122a1d9)

- `npm test` rerun: 296 tests, 295 pass, 0 fail, 1 skipped (193 s); matches the table above.
- `tests/e2e-lab.test.js` run as 6 concurrent processes (heavy load): 6/6 passed (3 tests each). The intermittent rejection
  did **not** reproduce, so it remains undiagnosed; the test already prints the failed guards and candidate failures if it recurs.
- Ghidra 12.1.4 verified healthy in `rea doctor` once a JDK 21 is on PATH and `GHIDRA_INSTALL_DIR` is set.

## Phase 3B result (2026-10-14)

Done and documented in `docs/ERA_STUDIO_SELF_IMPROVEMENT.md`: Studio baseline, real REA analysis of the Studio bundle, two Lab-accepted
improvements (E1 REA status cache, E2 job shutdown) applied as checkpoints, one rejected (E3). The Lab ran in a throwaway clone
(it requires a branch named `main`); no cycle was approved, merged, pushed or tagged. Final suite: 307 tests, 306 pass, 1 skipped; desktop 14/14.
Next: Phase 4 (enterprise engineering and security). Known gap: the Lab cannot evaluate `apps/studio/` code.

## Starting a new session

Read `CLAUDE.md`, this file, then run `git status`, `git log -3`, `node bin/era.mjs status`. Run the full test suite before and
after changes. Keep checkpoints on `feature/era-v0.2.0`; no merge, tag, push or release without being asked.
