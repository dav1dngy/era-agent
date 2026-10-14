# ERA v0.2.0 development handoff (end of Phase 3A)

Written 2026-10-14 for a new Claude Code session. It records what was verified at the commit below, not what earlier docs
claim. Next phase: **Phase 3B, REA-driven ERA Studio self-improvement** (not started).

## Repository state

- Branch `feature/era-v0.2.0`; commit at verification time: `52dcf82ffc246fc85731af8505d33dcda767f187`
  ("Add screenshot-rebuild validation evidence and provider-validation notes"). The checkpoint commit that adds this file
  follows it (`git log -2`).
- The branch tracks `origin/feature/era-v0.2.0` and was up to date with it when checked. Tags `v0.2.0-dev.0` and
  `v0.2.0-dev.1` already exist (development prereleases from before this handoff). `main` is untouched.
- **Rule: do not merge into `main`, push tags, or create a release without an explicit instruction from the user.**
- Working tree was clean at verification, apart from this file. Another Claude session was committing to this branch
  while the handoff began; check `git status` and `ps` for concurrent sessions before editing.

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
cd /Users/david/dev/era-agent
npm install                       # root (REA dependency)
npm install --prefix apps/studio  # Studio deps incl. Electron (downloads Electron)
node bin/era.mjs status           # branch, REA resolution, providers
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
| REA backend | `era status`: rea-agents 6.4.0 via local dependency; Hopper available, Ghidra/IDA unavailable; `era analyze apps/studio/web/js/api.js` completed and wrote a report |

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

## Starting a new session

Read `CLAUDE.md`, this file, then run `git status`, `git log -3`, `node bin/era.mjs status`. Run the full test suite before and
after changes. Keep checkpoints on `feature/era-v0.2.0`; no merge, tag, push or release without being asked.
