# ERA Studio self-improvement (Phase 3B)

Date: 2026-10-14. Branch `feature/era-v0.2.0`. Machine: Apple M1, 8 CPU, 8 GB, macOS 27.0.1, Node 24.20.0, Electron 44.7.1,
REA 6.4.0. All numbers below come from `experiments/studio-baseline/measure.mjs` and the Improvement Lab reports stored under
`experiments/`; nothing is estimated. Verified results and unverified hypotheses are kept apart (sections 5 and 8).

## 1. Original architecture (as verified)

Studio is a thin client (Preact + htm, Monaco, xterm; Electron shell) of a loopback control plane (`src/control_plane/`) that
supervises ERA CLI jobs and calls REA as a subprocess. The Electron main process fixes `PATH` through a login shell, imports ERA's
modules, starts the control plane, opens one window and quits through `controlPlane.stop()`. The web UI boots with five API calls
and then polls `/api/overview` every 15 s. `ReaClient.status()` is what the overview and tools endpoints use to report REA
and its providers. Desktop launch was verified in this phase (every `--smoke` run in the four Electron measurement series reported ok; 14/14 desktop scenario groups pass).

## 2. Actual REA analysis

Real REA (`rea-agents` 6.4.0, command `rea analyze-javascript-application <dir> --format json`, via `era analyze`):

| Target | Result | Evidence |
|---|---|---|
| `apps/studio/electron` | succeeded, 3.0 s, 4 files, coverage **partial**, 830 unknowns, 2,530 semantic nodes | `experiments/studio-rea/electron.analysis.json`, `electron.findings.json` |
| `apps/studio/web` | succeeded, 6.1 s, 26 relevant files (24 parsed), coverage **partial**, 4,482 unknowns | `web.analysis.json`, `web.findings.json` |

`experiments/studio-rea/extract-findings.mjs` post-processes REA's semantic graph. What REA established, compared with the source:

- Electron main: imports `child_process`, `electron`, `fs`, `path`, `url`; 5 timers (four in `visual-compare.cjs`, one 45 s smoke
  timeout in `main.cjs:145`); 12 listeners; 16 awaited tasks. The startup chain in `main.cjs` (awaits at lines 60-69 and 173-184)
  is strictly serial, matching the source. One unresolved import (`main.cjs -> ../scripts/test-ui.cjs`) is a test-only path outside the analyzed folder.
- Web: only `htm`, `preact`, `preact/hooks` externally; two vendor imports (`/vendor/xterm.mjs`, `addon-fit.mjs`) unresolved because the control plane serves
  them at runtime; **a `setInterval` of 15,000 ms at `js/main.js:102`**, the overview poll.
- Limits: REA found structure, timers and call sites. It does **not** measure latency, so the cost of each poll came from the baseline
  measurements and reading `ReaClient.status()`, not from REA.

The Improvement Lab's own REA self-analysis (packed CLI artifact, `src/` and `bin/`, 22 passes) produced the ranked findings used below.
It does not cover `apps/studio/` (not in the npm tarball).

## 3. Baseline and identified weaknesses

`experiments/studio-baseline/` (commit `eb41634`, `--n 10`; baseline taken **on battery** with Claude and Codex desktop apps running):

| Measurement | Baseline |
|---|---|
| Control plane: process start to listening | median 112 ms |
| Control plane: start to first successful `/api/overview` | median 1,675 ms |
| `/api/overview`, `/api/tools` warm median | **891 ms, 905 ms** (every other endpoint 1.6-2.4 ms; `/api/improvement` 64 ms) |
| 8 concurrent `/api/overview` x 3 rounds | median **3,895 ms** wall |
| Control plane idle memory / CPU | 68 MB RSS, 0 % |
| Electron `--smoke` wall | median 4,065 ms (on AC later: 4,336 ms, see section 5) |
| Electron running (5 processes) | 414-444 MB RSS, 0.2 % CPU idle |
| `zsh -ilc` PATH probe in `fixPath` | median 781 ms (serial, before the window) |
| `rea doctor` / `era analyze` of one file | 894 ms / 2,617 ms |

Not measured: agent-orchestration overhead (no real coding agent was run), UI frame rate or input latency (no profiler run), time to first paint.

Weaknesses found: (a) `ReaClient.status()` spawns `rea providers` on every call with no cache or de-duplication, and two endpoints plus Studio's 15 s poll
use it; during one harness run, parallel requests produced a visible load average above 90; (b) `JobManager.shutdown()` always sleeps 1.5 s when a job is running;
(c) `fixPath` costs ~0.8 s serially (unverified fix, section 8); (d) test-coverage gaps in control-plane modules (REA findings `F-4159faffc3` for `system.js`, `F-84ffe6219c` for `jobs.js`).

## 4. How the Improvement Lab was used (and its limits)

- The Lab requires a branch literally named `main` and merges accepted cycles into it. Because this repository's `main` must not be touched,
  the Lab ran in a **throwaway local clone** with its own `main` (no remote); real `main`, tags and remote were never modified.
- Accepted cycles stop at *awaiting approval*. **I did not run `era improve approve`** (a maintainer step). The evaluated `change.patch` of each accepted cycle was applied
  by hand to this branch as an ordinary checkpoint commit; the cycles' ledger therefore lives in the clone, and `report.md`, `change.patch`, `cycle.json` are archived in `experiments/studio-improvement/`.
- The Lab's acceptance metrics (protected, unchanged) see only the packed CLI. Studio-only code (`apps/studio/`) can never satisfy a target, so only control-plane backend changes were Lab-eligible.
- Two setup problems surfaced and are fixed or documented: `limits.maxReaRunsPerCycle` 40 was too small for ERA's current size (baseline + candidate self-analysis needs 46 runs;
  raised to 48, hard cap 50, committed in `era.config.json`); Hopper-backed benchmark cases are unreliable when the machine sleeps (two inconclusive runs, then success under `caffeinate`).

## 5. Implemented modifications and benchmark comparisons

| Id | Change | Lab result | Verified effect |
|---|---|---|---|
| E1 | `ReaClient.status()` caches a successful probe for 30 s, shares one in-flight probe, never caches failures; `tests/control-plane-system.test.js` | cycle `20261014T124035-5b4783` **accepted** (all 11 guards pass, target `F-4159faffc3` resolved, findings 37 -> 36, 170 tests pass). A first attempt was **rejected** because I had copied `apps/studio/node_modules` into the baseline only (a skipped test); environments were equalized and the cycle re-run | `/api/overview` warm 891 -> 2.2 ms; `/api/tools` 905 -> 1.7 ms; 8 concurrent overview calls 3,895 -> 3.1 ms. Start to first API ok 1,675 -> 1,609 ms (unchanged within noise: the first call still pays one probe). Electron `--smoke` median (same machine state, AC, n=10) **4,336 -> 3,103 ms** |
| E2 | `JobManager.shutdown()` waits until the jobs have exited (upper bound unchanged at 1.5 s, then SIGKILL); `tests/control-plane-jobs.test.js` (7 tests) | cycle `20261014T125204-f7ba8a` **accepted** on the third evaluation (two inconclusive: Hopper bridge timeout; 173 tests pass, target `F-84ffe6219c` resolved) | shutdown with a cooperative running job 1,503 -> 29 ms (new test; the same test fails on the old code). End-to-end quit time was not measured |

Both new test files were checked to fail on the previous code (E1: 2 of 4 fail; E2: the shutdown test fails with 1,503 ms).
The 4,336 -> 3,103 ms smoke improvement is attributable to E1 (concurrent startup requests used to spawn parallel REA probes); I did not isolate it further.

## 6. Test results

On the final tree: `npm test` **307 tests, 306 pass, 0 fail, 1 skipped** (160 s; the skip is the missing-sandbox path); `npm run lint` clean; `npm run check` passed (430 tracked files);
`npm run test:desktop` **14/14 PASS** (REA real, coding agent simulated). The suite covers Studio, ERA Core, REA integration, Project Lab, Improvement Lab (including approval and rollback),
multi-agent, CLI and MCP. Not run: `test:package`, clean-install, benchmark suite outside Lab evaluations, live provider validation.

## 7. Rejected improvements

- **E3 (not through the Lab)**: overlap module loading with `fixPath` and prewarm the REA probe in `apps/studio/electron/main.cjs`. Smoke median 3,103 -> 3,099 ms: no effect shown, **reverted**
  (`experiments/studio-improvement/E3-electron-startup-rejected.md`, patch kept). It was not Lab-eligible (Studio shell code is outside the Lab's evaluation scope).
- E1 first attempt (above), a measurement-environment rejection, not a code rejection.

## 8. Unverified hypotheses and remaining limitations

Hypotheses (no experiment run): cache the resolved login-shell `PATH` on disk to remove ~0.8 s of `fixPath`; pause the 15 s overview poll while the window is hidden;
`Job` stdout accumulation (`(stdout + text).slice(-2_000_000)`) is quadratic for large outputs (not measured); the test `a stale lock is taken over by exactly one of many racing processes`
failed once in a candidate run under load (not reproduced; the earlier `e2e-lab` flake also remains undiagnosed).

Limitations: n=10 per measurement, a shared machine and a baseline taken on battery; Electron measured through `--smoke`, not user-perceived paint; the REA analysis is partial coverage
and does not measure time; the Lab ran in a clone and its approval/tag step was not exercised on this repository; only two of the three allowed experiments were accepted.

## 9. Recommended next steps

1. Review E1/E2 (`git show 74b1f93 43d3536`) and decide whether to keep them; nothing was merged to `main`, pushed, tagged or released.
2. Phase 4 (enterprise engineering and security): the Lab cannot evaluate Studio code today. Extending its REA self-analysis to `apps/studio/` and giving it a Studio-aware benchmark
   needs a deliberate, human-reviewed change to protected paths (`src/evaluation/`, `benchmarks/acceptance.json`); it was not attempted here.
3. Make the Lab usable on a feature branch (the hard-coded `main`), and make Hopper benchmark cases robust to sleeping machines.
4. Add a UI-side profile (first paint, input latency) and a real-agent orchestration measurement before further Studio performance work.
