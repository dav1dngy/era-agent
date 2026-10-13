# Release-readiness report: ERA v0.1.0

Date: 2026-10-13. Stable version: **era-v4** (`b3f6c24`) plus documentation and
evidence commits on `main`. Host: macOS 27.0.1 arm64, Node 24.20.0, REA
(`rea-agents`) 6.4.0, Hopper 6.6.0-demo.

**Verdict: not yet releasable.** One blocker remains: the independent code
review (section 8). Everything else in this report has been verified on this
host. Nothing has been pushed or published.

## 1. Implemented functionality

| Area | Delivered |
|---|---|
| Analysis Mode | `era analyze` (JS directory, single JS file, Mach-O, Hopper decompilation of exported functions, ZIP, sandboxed runtime capture), `era inspect`, `era explain` (local by default) |
| REA access | every REA command through `era rea …`, including the MCP server (`era rea mcp`) and agent setup (`era rea setup`) |
| Improvement Lab | REA self-analysis (byte-bounded passes), planner, worktree experiments, coding-agent adapters (`manual`, `command`, `claude-code`, `codex`), tests, ground-truth benchmarks, protected evaluator, `awaiting-approval` gate, `approve`, `decline`, `rebase`, `cancel`, `recover`, `rollback` |
| Controls | iteration, time, REA-run and API-cost limits with hard caps; single-writer lock; process-group kill; parent-death and deadline watchdog; CI refusal |
| Observability | JSONL logs with execution and correlation IDs and secret redaction; cycle ledger; static dashboard |
| Release tooling | ESLint, secret and privacy scan (`scripts/check.mjs`), clean-install test, third-party notice generator, SHA-pinned CI, CodeQL, release-validation workflow (SBOM and provenance; never publishes) |

## 2. Verified REA compatibility

* REA 6.4.0 is the latest upstream release. ERA pins it and does not modify it.
* `era rea inspect-macho` and `rea inspect-macho` produce the same Evidence ID.
* A real MCP JSON-RPC session through `era rea mcp` works: `initialize`,
  `tools/list` (170 tools) and `tools/call analyze_javascript_application`.
  `era rea mcp doctor` passes.
* REA operations exercised with real execution: `inspect-macho`, `function`
  (Hopper), `analyze-javascript-application`, `inspect-artifact`,
  `capture-process` (including under the sandbox), `providers`, `mcp`.
* Clean install from a packed tarball resolves the `rea-agents` dependency
  (not a global REA).

## 3. Improvement experiment results

| # | Cycle | Change | Decision |
|---|---|---|---|
| 1 | `cycle-20261013T095936-14e2b8` | CommonJS export inference | rejected (REA findings 7 → 9); main untouched |
| 2 | `cycle-20261013T101435-e55c7f` | size-balanced REA passes | accepted → era-v2 (auto-merged; before the approval gate existed) |
| 3 | `cycle-20261013T103029-c10c1f` | retry of #1 | accepted → era-v3 (auto-merged) |
| 4 | `cycle-20261013T112629-18505d` | byte-bounded REA passes with placeholders | first evaluation accepted (native benchmark invalid, see below); **rejected** on re-evaluation (Hopper-flaky test) |
| 5 | `cycle-20261013T150739-02fd6c` | retry of #4 after the test fix | accepted; **approved by the maintainer → era-v4** |

Benchmarks (3 repetitions, quiet host): accuracy F1 0.956 (era-v1) → 0.987
(era-v3 and later); error rate 0; reliability 1.0. ERA adds about 1.7 s per
analysis compared with running the same REA commands directly. Details are in
README "Benchmarks" and `benchmarks/results/`.

## 4. Test results

Full suite on the rewritten `main` (`node --test tests/*.test.js`, real REA available):
**108 tests: 107 passed, 0 failed, 1 skipped** (the "no sandbox" refusal test runs
only on platforms without `sandbox-exec`).

| Check | Result |
|---|---|
| Real-REA integration, MCP session, sandbox capture | pass |
| Fake-engine end-to-end Improvement Lab (approval, rejection, rebase, rollback, interruption, crash recovery) | pass |
| `npm run lint` (ESLint 10) | clean |
| `node scripts/check.mjs` (syntax, secrets, personal paths; 263 tracked files) | pass |
| `scripts/clean-install-test.sh` | pass |
| Rollback on a clone of the rewritten history (era-v4 → era-v3 → era-v4, identical trees) | pass |

The fakes used in tests are labelled in docs/testing.md and do not count as REA executions.

## 5. Security and privacy findings

| Check | Result |
|---|---|
| Secret scan of the full git history (GitHub, Anthropic, OpenAI-style, AWS, Slack, private keys, bearer tokens) | **0 matches** after the rewrite. A synthetic test key that previously matched was replaced in every historical commit |
| Personal email in commit/tag metadata | **none**: all 21 commits and 4 annotated tags use `77665890+dav1dngy@users.noreply.github.com` |
| Personal absolute paths (`/Users/<name>/…`, temp directories) in tracked files and history | **0**: replaced with `<era-repo>`, `<node-prefix>`, `<tmp>` and `~`. `scripts/check.mjs` now fails on any `/Users/<name>/` or `/home/<name>/` path |
| Author name | "David Nguyen" remains in commit metadata (not requested to change) |
| `npm audit --omit=dev` | 0 vulnerabilities |
| `npm audit signatures` | 212/212 packages with verified registry signatures, 48 with attestations |
| Dependency licenses | MIT 116, ISC 11, BSD-3-Clause 7, Apache-2.0 7, BlueOak-1.0.0 5, BSD-2-Clause 1, MIT AND Zlib 1, MIT AND BSD-3-Clause 1 (all permissive) |
| Sandbox | probe binary under real REA capture: network and writes outside scratch denied |
| ESLint | clean |

### History rewrite

The history was rewritten once with `git filter-branch` before any publication:
author/committer email to the GitHub no-reply address; path anonymization in
every commit; synthetic key neutralized; commit hashes inside commit messages
remapped. Tags were re-created with the no-reply tagger. Every commit hash
referenced in docs, exported experiment records and ERA's local `.era/` state was
updated with the old→new mapping (24 commits). A pre-rewrite backup bundle is
kept **outside the repository** in `~/dev/era-agent-backups/`. Do not publish it:
it contains the original email and paths.

**Evidence integrity note.** Anonymized evidence files (`tests/fixtures/evidence/`,
`experiments/`) still carry REA's original Evidence IDs and SHA-256 digests.
Those identify the original, unredacted REA outputs, so recomputing a digest
over an anonymized file will not match. `experiments/cycles/*/rea-outputs.json`
records the digest of each raw output kept locally in `.era/runs/`.

## 6. License and attribution

* REA is MIT, © 2026 morluto. Its license text appears verbatim in
  `THIRD_PARTY_NOTICES.md` (checked against the installed package).
* No REA source is copied, vendored or modified (checked: the only file name
  shared with REA's `dist/`, `cli.js`, has different content). All of `src/` is ERA's.
* REA's bundled third-party components are referenced
  (`node_modules/rea-agents/licenses/`, `third_party/`).
* ERA itself is MIT (`LICENSE`).

## 7. Known limitations

* The `claude-code` and `codex` coding-agent adapters and the remote reasoning
  providers were tested only against fake CLIs.
* GitHub Actions workflows have not run on GitHub yet. The Linux test job has not
  been executed.
* No type checking. Native analysis covers Mach-O only. Hopper is
  nondeterministic (the watchdog contains hangs). `sandbox-exec` is deprecated by Apple.
* Open REA self-analysis findings in era-v4: `untested-module` for
  `src/commands/*`, `spawn-without-error-listener` in two test files,
  `high-fan-out` in two modules. Benchmark gaps: `js-esm-app` (an REA limitation)
  and `native-macho` (dyld counted as a linked library).
* About 1.7 s of ERA overhead per analysis (the provider probe).
* Five small authored benchmark fixtures; results do not generalize.

## 8. Outstanding release blockers

| Blocker | Owner |
|---|---|
| **Independent code review** of the release candidate (required before release). Not performed: the author of this code cannot review it independently | maintainer / an independent reviewer (for example `/code-review ultra` or a human reviewer) |
| Maintainer approval to create `dav1dngy/era-agent`, push, and create the v0.1.0 release | maintainer |

Recommended after publication: confirm the CI workflows pass on GitHub before
creating the release.
