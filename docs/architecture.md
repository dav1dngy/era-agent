# Architecture

ERA is a Node.js (ESM, no runtime dependencies besides `rea-agents`) CLI built
around the original REA engine. ERA never re-implements reverse engineering.
Every analysis fact comes from a recorded REA execution.

```
                         bin/era.mjs → src/cli.js
                                   │
        ┌──────────────────────────┼──────────────────────────────┐
        │ Analysis Mode            │ Self-Improvement Mode         │
        ▼                          ▼                               │
 analysis/analyze.js        orchestration/cycle.js  ◄── safety/policy.js
  ├─ analysis/detect.js       ├─ evaluation/self-eval.js ─► self_analysis/self-analyze.js
  ├─ analysis/facts.js        │                              └─ self_analysis/rules.js
  └─ analysis/report.js       ├─ improvement/planner.js
        │                     ├─ git worktree ──► improvement/modification.js (implementer)
        │                     ├─ evaluation/tests.js
        │                     ├─ evaluation/benchmark.js ─► evaluation/score.js
        │                     ├─ evaluation/decision.js ◄── benchmarks/acceptance.json
        │                     └─ orchestration/versions.js + ledger.js
        ▼                          ▼
   rea_integration/rea-client.js  ──►  `rea <command> --format json`  (rea-agents 6.4.0)
```

## Components

| # | Component | Module | Responsibility |
|---|---|---|---|
| 1 | Reverse Engineering Core | `src/rea_integration/rea-client.js` | Resolves the `rea` binary, executes REA commands with timeouts, and records each run (command, input digest, engine version, exit status, Evidence ID, errors, warnings, progress events, wall time, CPU, max RSS) under `.era/runs/<run_id>/` |
| 2 | Analysis Orchestrator | `src/analysis/analyze.js`, `detect.js` | Classifies a target by magic bytes/layout and runs the matching REA workflow. For Mach-O it also decompiles exported functions when a deep provider is available |
| 3 | Self-Analysis Engine | `src/self_analysis/self-analyze.js` | Packs ERA with `npm pack`, stages size-balanced REA passes (package + test groups), runs REA's JavaScript analyzer and REA process capture of `era --help` |
| 4 | Improvement Planner | `src/improvement/planner.js` | Ranks REA-derived findings and benchmark accuracy gaps by the charter priorities and writes one hypothesis with a predeclared target metric |
| 5 | Code Modification Controller | `src/improvement/modification.js` | Runs a configured implementer command inside the experiment worktree only and commits its changes on the experiment branch |
| 6 | Testing Engine | `src/evaluation/tests.js` | Runs `node --test` (TAP) for a checkout and parses the summary |
| 7 | Benchmark Engine | `src/evaluation/benchmark.js`, `score.js` | Runs a checkout's `era analyze` on every dataset as a subprocess, then scores facts against hand-written ground truth with the evaluator's own scoring code |
| 8 | Version Manager | `src/orchestration/versions.js` | Experiment branches/worktrees, `--no-ff` promotion to `main`, annotated `era-vN` tags, non-destructive rollback |
| 9 | Recursive Improvement Controller | `src/orchestration/cycle.js` | propose → implement → evaluate → decide, bounded and logged to `.era/ledger.jsonl` |
| 10 | Reporting Engine | `src/analysis/report.js`, `src/reporting/` | Markdown analysis/cycle reports, benchmark tables, optional static HTML dashboard |
| 11 | Safety Controller | `src/safety/policy.js` | Hard limits, protected paths, CI refusal, single-writer lock, target path validation |

## Trust boundaries in self-improvement

The candidate code under evaluation is never trusted to judge itself:

* The **evaluator** (stable checkout process) owns tests, scoring, acceptance
  criteria and self-analysis rules. Those paths are protected
  (`PROTECTED_PATHS`). An experiment that touches them is rejected.
* The **candidate** runs only as subprocesses: its own `era analyze` for
  benchmarks and its own `era self-analyze` for REA self-analysis. Its REA
  Evidence is then re-scored with the stable rules, and the evaluator checks that
  REA covered every source module listed by `git ls-files src bin`.
* Benchmark ground truth lives in `benchmarks/datasets/truth/` and was written
  by hand from the fixture sources, verified with `nm`, `otool` and `strings`.

## State layout

```
.era/                       (git-ignored)
  runs/<run_id>/            record.json, output.json (raw REA Evidence), stderr.log
  analyses/<id>/            analysis.json, report.md, provider.snapshot
  self-analyses/<id>/       self-analysis.json, report.md, work/ (packed artifact, passes)
  cycles/<id>/              cycle.json, instructions.md, report.md
  worktrees/<id>/           experiment worktrees (removed after a decision)
  benchmarks/               benchmark result JSON
  ledger.jsonl              append-only cycle/rollback ledger
```
