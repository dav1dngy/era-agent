# Self-improvement

"Self-improvement" in ERA means **controlled changes to ERA's own source code**,
proposed from REA analysis of ERA, implemented in an isolated git worktree,
and accepted only when predefined, evidence-based criteria pass. ERA does not
modify, fine-tune or retrain any foundation model.

## The cycle

```
era-vN (main, clean)
  │  era improve propose
  ├─► REA self-analysis of era-vN  (npm pack → N × analyze-javascript-application
  │                                  + capture-process of `era --help`)
  ├─► planning benchmark (1 repetition)
  ├─► planner: rank REA findings + benchmark accuracy gaps → one hypothesis + target metric
  ├─► git worktree add -b experiment/<cycle> .era/worktrees/<cycle>
  │
  │  implementer (Claude Code, or `improvement.implementerCommand`) edits and commits in the worktree
  │
  │  era improve evaluate <cycle>          (runs in the stable checkout)
  ├─► tests: baseline and candidate (`node --test`)
  ├─► benchmark: baseline and candidate code, same datasets/evaluator/REA, N repetitions
  ├─► REA self-analysis of the candidate (candidate's own pipeline, stable rules)
  ├─► decision against benchmarks/acceptance.json
  ├─ accepted → git merge --no-ff into main, tag era-v(N+1)
  └─ rejected → main untouched, branch kept for diagnostics, worktree removed
```

### Findings

Rules in `src/self_analysis/rules.js` (protected) read REA Evidence:

| Rule | Area (priority) | Evidence |
|---|---|---|
| `incomplete-analysis-coverage` | analysis-accuracy (1) | REA `unknown` nodes with `analysis_failure` (e.g. `resource_constraint`) |
| `unresolved-local-import` | reliability (2) | REA `imports` edges with a relative specifier and no `resolved_path` |
| `cli-help-failure`, `slow-startup` | reliability (2), performance (3) | REA `capture_process_scenario` exit status and manifest timing |
| `high-fan-out` | orchestration (5) | more than 8 local imports in REA's application graph |
| `unreachable-module` | code-quality (6) | no static import path from `bin/` (suppressed under incomplete coverage) |
| `spawn-without-error-listener` | error-handling (7) | `child_process` import without an `error` event node in REA's semantic graph |
| `help-writes-files` | resource-efficiency (8) | changed entries in REA's filesystem effects |
| `untested-module` | test-coverage (10) | no `tests/` → module edge (suppressed under incomplete coverage) |

Benchmark accuracy gaps (`B-<case>`) are added with priority 1. Finding IDs are
stable hashes of rule + subject, so resolution can be re-verified by a later REA run.

### Acceptance criteria (frozen in era-v1)

`benchmarks/acceptance.json`. All guards must pass **and** the predeclared
target must be met:

* protected paths unchanged; all tests pass;
* accuracy F1 does not drop; error rate does not increase; reliability does not drop;
* total benchmark time regression ≤ 30% (two identical era-v1 runs differed by 25.3%, almost all Hopper start-up variance);
* peak memory regression ≤ 20%;
* REA self-analysis findings (stable rules) not increased; REA covered every `src/` and `bin/` module;
* target: `accuracy_f1` +0.01, `startup_ms` −10%, or `finding_resolved`.

### Safety

Hard limits (`src/safety/policy.js`): ≤ 10 cycles, ≤ 50 REA self-analysis runs per
cycle, timeouts on every subprocess, one experiment at a time (lock file), no
parallel experiments, refusal under `CI`/`GITHUB_ACTIONS`, no force-push, and no
automatic publication.

## Initial experiment (3 cycles, 2026-10-13)

The implementer was Claude Code working interactively in the experiment worktree
(manual mode: `era improve propose` → edit/commit → `era improve evaluate`).
Every number below comes from `experiments/cycles/*/cycle.json`.

| # | Cycle | Base | Candidate (selected by) | Target result | Decision |
|---|---|---|---|---|---|
| 1 | `cycle-20261013T095936-14e2b8` | era-v1 | `B-js-commonjs-app`: infer CommonJS named exports from REA's semantic graph (planner) | F1 0.9559 → 0.9867 ✅ | **rejected**: self-analysis findings 7 → 9 |
| 2 | `cycle-20261013T101435-e55c7f` | era-v1 (+ operator commit) | `F-1026e8ec5f`: REA `resource_constraint` on `tests/self-analysis.test.js`; split self-analysis into size-balanced REA passes (operator) | finding absent ✅ | **accepted → era-v2** |
| 3 | `cycle-20261013T103029-c10c1f` | era-v2 | `B-js-commonjs-app` retried (cherry-pick of cycle 1's commit) (operator) | F1 0.9559 → 0.9867 ✅ | **accepted → era-v3** |

### Cycle 1: rejected

The change met its accuracy target, and tests, time and memory guards passed. The
candidate's REA self-analysis reported 9 findings against the baseline's 7. Both new
findings were `incomplete-analysis-coverage` (`tests/helpers.js`,
`tests/fixtures/fake-rea.mjs`): adding code to ERA pushed more of the test suite
past REA's fixed JavaScript result budget (`javascript_analysis_semantic_result_budget_bytes`
exhausted; raising `--max-heap-mb` to 2048 did not change the ~993 MB parent budget).
Per the frozen criteria, the change was rejected. `main` was not touched, and the branch
`experiment/cycle-20261013T095936-14e2b8` was kept for diagnostics.

### Cycle 2: accepted

The diagnosis of cycle 1 pointed at the highest-priority REA finding. The operator
selected it with `--finding` (the planner's tie-break would have picked a benchmark
gap caused by an REA limitation; see below). Each REA pass now contains the full
packed source plus a size-balanced group of ≤ 3 test files. REA runs per
self-analysis went from 2 to 5. Coverage became complete, findings went 7 → 6 (the
previously suppressed `untested-module` findings appeared), benchmark accuracy
was unchanged and time stayed within the noise guard (+13.7%).

### Cycle 3: accepted

The cycle-1 commit was cherry-picked onto era-v2. Accuracy rose 0.9559 → 0.9867,
time −0.4%, memory −0.2%, tests 64 → 66.

### What the experiment also revealed (open items)

* **Coverage regressed again in era-v3.** The candidate's self-analysis in cycle 3
  reported `incomplete-analysis-coverage` for `tests/self-analyze-passes.test.js`,
  `tests/helpers.js` and `tests/fixtures/fake-rea.mjs`. That suppressed the
  `untested-module` rule, so the "6 → 5 findings" in cycle 3 partly reflects
  suppressed findings, not fixed ones. The fixed three-files-per-pass grouping
  is not robust as the test suite grows. Next candidates: adaptive splitting until
  every pass is complete, and a stricter guard that treats new incomplete coverage
  as a regression.
* **Benchmark gaps caused by REA, not ERA:** `B-js-esm-app` (REA does not retain
  string literals passed directly as call arguments, so `wss://…` is not
  recovered) and `B-native-macho` (`/usr/lib/dyld` is reported as a dependency;
  ERA counts the `LC_LOAD_DYLINKER` entry as a linked library, which is fixable in ERA).
* `high-fan-out` in `src/cli.js` and `src/orchestration/cycle.js` remains open.
* The planner has no hypothesis template for `incomplete-analysis-coverage`
  (the proposal text falls back to the finding title).

## Running it yourself

```bash
era self-analyze                         # REA self-analysis report
era improve propose                      # or: --finding <id>
# implement + commit inside the printed worktree
era improve evaluate <cycle-id>
era history
era benchmark --versions era-v1,era-v2,era-v3
```

With an implementer command (unattended, bounded by `limits.maxCycles`):

```bash
era improve --cycles 1 --implementer './my-implementer.sh'
```

The command runs with `cwd` = experiment worktree and receives
`ERA_INSTRUCTIONS_FILE`, `ERA_PROPOSAL_FILE`, `ERA_WORKTREE` and `ERA_CYCLE_ID`.
Its changes are committed on the experiment branch. A headless Claude Code
invocation such as
`claude -p "$(cat "$ERA_INSTRUCTIONS_FILE")" --permission-mode acceptEdits`
can serve as the implementer. **That configuration was not exercised in this
release.** The implementer path is covered by tests with scripted commands only.
