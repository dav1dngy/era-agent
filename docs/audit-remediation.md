# Audit remediation status

Remediation of [ERA_INDEPENDENT_AUDIT.md](ERA_INDEPENDENT_AUDIT.md) (audited revision
`5ce907f`). Every "fixed" row names the change and the test that checks the
audit's fix-verification criterion. **This status was produced by the ERA
author, not by an independent reviewer.** A re-review of the corrected trust
boundaries is still required before release.

| ID | Sev. | Finding | Status | Change | Verifying tests |
|---|---|---|---|---|---|
| F01 | HIGH | Approval not bound to the evaluated commit | **fixed** | Evaluation records the candidate commit, tree and patch digest. A candidate that changes during evaluation is rejected. Approval refuses any branch movement, re-checks protected paths and merges exactly the evaluated commit (`Candidate:` trailer) | `versions.test.js`: approval refuses a moved branch, leaves stable HEAD and tags unchanged, then integrates exactly the evaluated tree |
| F02 | HIGH | Candidate-supplied self-analysis evidence trusted | **fixed** for self-analysis; **mitigated** for benchmark facts | The supervisor runs every REA execution. The candidate supplies only a pass plan, validated against the evaluated commit (all files exactly once, committed bytes staged from git objects, fixed placeholders). Failed or missing evidence (including runtime capture) is invalid. Failed candidate commands are never trusted. Lab benchmarks run REA under the supervisor; the candidate only converts that Evidence into facts, without read access to ground truth | `candidate-isolation.test.js` (forged/omitting plan, failed command, supervisor-owned run records), `rea-integration.test.js` (supervised self-analysis) |
| F03 | HIGH | Candidate code runs with host authority | **fixed on macOS**; fail-closed elsewhere | Candidate tests, fact extraction, planning and CLI capture run under a `sandbox-exec` profile: no network, writes only to the candidate checkout and private temp, no reads of stable ERA state or credential stores, secret-free environment. Baseline runs under identical conditions. Protected-path changes are rejected before any candidate code runs. Without a sandbox, evaluation refuses unless `--trust-candidate` | `candidate-isolation.test.js` (hostile candidate: outside write, local TCP endpoint, protected read, secret env all denied; fail-closed), `e2e-lab.test.js` |
| F04 | HIGH | Imported analysis discloses unrelated files | **fixed** | `era explain` validates the record and rebuilds the report from it. No path inside an analysis is ever read | `cli.test.js` (canary file referenced by `report_path` and `output_file` never reaches the provider) |
| F05 | HIGH | Invalid benchmarks and test erosion accepted | **fixed** | Failed benchmark cases (either side), an empty baseline test inventory, timeouts or unmeasurable self-analysis make the result **inconclusive**. Every baseline-passing test must still pass in the candidate; repairing a failing baseline test is allowed | `evaluation.test.js` (equal failures inconclusive, deletion/skip rejected, repair accepted, TAP inventory) |
| F06 | MED | Single-writer and crash recovery incomplete | **fixed** | O_EXCL lock with ownership token on every mutator, re-validation under the lock, recovery refuses a live holder, atomic state writes, journaled integration completed or undone idempotently | `safety.test.js` (4 racing processes → 1 owner; live-holder recovery refused), `versions.test.js` (crash before/after merge) |
| F07 | MED | Execution and cost limits not enforced end to end | **fixed** | `commandTimeoutMs` reaches tests, benchmarks and self-analysis. REA runs reserved before dispatch. Cumulative per-cycle and total spend. Missing, negative, non-finite or interrupted costs charged at the full reserved budget. CI refusal on implement. Repetitions validated (1–20) | `agents.test.js` (spend accounting, missing cost) |
| F08 | MED | Prompts and exports bypass redaction | **fixed** | Redaction of agent prompts, agent output tails, run-record errors and warnings, ledger and exports; state directory 0700. Raw REA evidence stays private in `.era/runs/` | `observability.test.js` (synthetic key in ledger, prompt, output tail; 0700 state) |
| F09 | MED | Benchmark evidence discarded, provenance incomplete | **partially fixed** | Per-repetition samples (facts, timings, evidence IDs) and provenance (commit, tree, exact describe, dirty, dataset digest, engine, providers, Node, platform). Aggregates can be recomputed from the result JSON plus the truth files. **Raw REA outputs are not published** (cycle 5 alone is 198 MB); exports carry their SHA-256 digests | `evaluation.test.js` (provenance) |
| F10 | MED | Linux test asserts a macOS path | **fixed** | Asserts the canonical scratch path | `sandbox.test.js`. Not run on a Linux runner yet |
| F11 | MED | Release packaging lacks `dist/` | **fixed** | `mkdir -p dist` before `npm pack` | workflow change only. Not run on GitHub yet |
| F12 | MED | Wrong CommonJS export inference | **fixed** | Names inferred only where source text establishes the key (renamed, shorthand, quoted); `module.exports = fn` yields no named export; per-fact `fact_provenance` and "(inferred)" in reports | `rea-integration.test.js` (real REA, renamed/default fixture), `analysis.test.js` |
| F13 | MED | Node range exceeds REA's | **fixed** | `engines.node` = `^22.19.0 \|\| ^24.11.0 \|\| >=26.0.0` | metadata. Other Node versions not executed |
| F14 | MED | Output limits and containment narrower than claimed | **fixed** (output); **documented** (containment) | Output quota, backpressure and stream-error handling. Docs now say process-group containment does not cover deliberately detached descendants, `era rea …` passthrough or GUI providers | `core.test.js` (output flood, failing sink) |
| F15 | LOW | Docs overstate or mislabel evidence | **fixed** | README, CHANGELOG, release-readiness, SECURITY, Lab docs, baseline/examples labels | review |
| P2 | — | Unnecessary provider probe | **fixed** | Probe only for Mach-O targets | quick measurement in the commit message (not a formal benchmark) |

## Remaining limitations (accepted scope, not defects)

* Benchmark **facts** are still computed by the candidate's extraction code
  (that is what the benchmark measures). The sandbox prevents reading ground
  truth, but a hostile candidate could hard-code answers. Mitigation: the
  supervisor runs REA, the patch is reviewed before approval, and benchmark
  answers that do not follow from Evidence are visible in the diff.
* Lab benchmarks evaluate ERA's interpretation of REA Evidence, not changes
  to ERA's REA *workflow*, which the supervisor runs. Workflow changes need
  `--trust-candidate` mode (the candidate runs its own REA) and trusted code.
* The macOS sandbox does not restrict file reads beyond the denied paths. REA
  runs unsandboxed as trusted code. There is no isolation on Linux
  (fail-closed).
* Approval is a local acknowledgement (TTY or `--yes`), not authenticated identity.
* No measured line/branch coverage; no Linux CI run yet; headless agents are
  verified only against fakes.

## Validation after remediation (macOS 27 arm64, Node 24.20.0, REA 6.4.0, Hopper 6.6.0-demo)

| Check | Result |
|---|---|
| `npm test` (real REA available) | **133 tests: 132 passed, 0 failed, 1 skipped** (the no-sandbox refusal test, which runs only where sandbox-exec is unavailable) |
| `ERA_SKIP_REA=1 npm test` (approximation of the Linux lane on macOS) | 133 tests: 122 passed, 0 failed, 11 skipped |
| Real-REA integration (`rea-integration.test.js`) | 7/7 including supervised self-analysis and the CommonJS renamed-key fixture |
| Real MCP session, sandbox capture, adversarial isolation tests | pass |
| `npm run lint`, `node scripts/check.mjs` (237 files) | pass |
| `npm audit --omit=dev` / `npm audit signatures` | 0 vulnerabilities / 212 verified signatures |
| `scripts/clean-install-test.sh` | pass |

Not executed: Linux runner, GitHub Actions, live headless coding agents,
alternate Node versions, a fresh multi-version benchmark after remediation.
