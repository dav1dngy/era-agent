# Validation report: v0.1.0 release candidate

Date: 2026-10-13. Host: macOS 27.0.1 arm64, Node 24.20.0, REA 6.4.0, Hopper
6.6.0-demo. Each item states its evidence. "Partial" and "not verified" are
explicit.

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | Actual REA execution | ✅ | `experiments/baseline/` (unedited REA output), run records under `experiments/cycles/*/rea-runs/`, `tests/rea-integration.test.js` |
| 2 | Normal Analysis Mode | ✅ | `era analyze` on JS directory, single JS file, Mach-O (+ Hopper decompilation), ZIP, sandboxed runtime; integration tests and `examples/sample-analysis-report.md` |
| 3 | CLI and MCP compatibility | ✅ | `era rea` passthrough yields identical Evidence IDs; real JSON-RPC session (`initialize`, `tools/list`, `tools/call`) and `era rea mcp doctor` in `tests/mcp.test.js`; CLI contract tests in `tests/cli.test.js` |
| 4 | At least one genuine Improvement Lab experiment | ✅ | 4 real experiments with REA self-analysis (`experiments/cycles/1-4`); experiment 4 under the round-2 rules, awaiting approval |
| 5 | Rollback after a failed experiment | ✅ | cycle 1 (real REA) rejected, `main` unchanged, branch kept; rollback era-v3 → era-v2 → era-v3 verified on a clone; fake-engine e2e: rejection, approve → rollback |
| 6 | Stable-version protection | ✅ | no merge without `era improve approve`; stale-base approval refused; CI refusal; protected evaluator paths (e2e protected-path rejection) |
| 7 | Critical automated tests | ⚠️ partial | 106 tests: 104 pass, 1 platform skip, **1 failing on `main`** (REA self-analysis coverage, fixed by experiment 4 pending approval). Candidate branch: 104/104 pass, 1 skip |
| 8 | Authentic benchmark evidence | ✅ | `benchmarks/results/*.json` (quiet host, 3 repetitions); ground truth hand-written and checked with nm/otool/strings |
| 9 | Security controls | ✅ for implemented controls | sandbox probe denied network and outside writes under real REA capture (`tests/sandbox.test.js`); redaction, egress authorization, budgets, locks, watchdog tests. No independent security assessment |
| 10 | Clean-environment installation | ✅ | `scripts/clean-install-test.sh` passed: packed tarball → empty project → npm install → `era status` / `era analyze`, REA resolved from the installed dependency |
| 11 | Documentation accuracy | ✅ reviewed | claims limited to the verified items above; open findings and unverified paths listed in README "Limitations" |
| 12 | Upstream attribution and license | ✅ | REA MIT notice in `THIRD_PARTY_NOTICES.md` (text matches the installed package); no REA code copied or modified; dependency licenses all permissive |

## Not verified or incomplete

* **Real headless coding agents.** `claude-code` and `codex` adapters were tested
  only against fake CLIs. Real experiments used Claude Code interactively (`manual`).
* **CI workflows** were written and linted locally but have not run on GitHub
  (the repository is not published). Action SHAs were resolved from the GitHub API.
* **Experiment 4 re-evaluation:** its first evaluation had invalid native
  benchmark evidence (orphaned Hopper session, since fixed). It needs
  `era improve rebase` + `evaluate` on the final `main` before approval.
* **Linux:** unit and fake-engine tests are designed to run there (CI job
  `unit-linux`) but were not executed on Linux in this round.
* **Type checking** is not implemented.
* **Performance finding not addressed:** ERA adds about 1.7 s per analysis over
  direct REA (the provider probe).

## Pre-publication checks

* Secret scan of the full history: 4 matches, all the synthetic test string
  `sk-ant-SYNTHETIC_TEST_KEY` (commit `162db37`, removed in
  `f71f7de`). No real credentials found.
* Commit author email in every commit: `77665890+dav1dngy@users.noreply.github.com` (the local git
  configuration). It becomes public on push.
* Evidence and report files contain absolute local paths (`~/...`).
* `dav1dngy/era-agent` does not exist on GitHub (HTTP 404); nothing would be overwritten.
* Nothing has been pushed or published.
