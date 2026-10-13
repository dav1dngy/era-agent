# Benchmark methodology

## Datasets

`benchmarks/datasets/` (protected path) contains only fixtures authored for this
repository:

| Case | Target | REA operations |
|---|---|---|
| `js-commonjs-app` | `js-app/` (CommonJS) | `analyze-javascript-application` |
| `js-esm-app` | `esm-app/` (ES modules) | `analyze-javascript-application` |
| `native-macho` | `native-hello/hello` (clang -O1, arm64) | `inspect-macho`, `function` per exported symbol (Hopper) |
| `native-macho-runtime` | same binary, run with `bench` | `inspect-macho`, `function` ×2, `capture-process` (sandboxed) |
| `zip-archive` | `archive/js-app.zip` | `inspect-artifact` |

Ground truth (`truth/*.json`) was written by hand from the fixture sources and
checked with independent tools (`nm -gU`, `nm -u`, `otool -L`, `otool -tV`,
`strings`). It was never derived from REA output. Only categories present in a
truth file are scored, so new fact categories never change existing scores.

## Metrics

| Metric | Definition |
|---|---|
| Accuracy (F1), precision, completeness (recall) | per case over truth categories, then the mean over cases |
| Execution time | median wall time of `era analyze` per case over N repetitions, summed over cases |
| CPU time | median user+sys (`/usr/bin/time -l`) per case, summed |
| Peak memory | maximum resident set size over all runs (`/usr/bin/time -l`, macOS) |
| Error rate | failed runs / all runs |
| Reliability | fraction of cases whose N runs all succeeded with identical fact sets |
| REA executions per pass | REA runs per benchmark pass (from run records) |
| API cost | ERA's analysis and benchmarks make no model calls (cost $0). Coding-agent spending is recorded per cycle in the ledger |

## Identical conditions

* The **evaluator** (scoring, datasets, acceptance criteria) always comes from
  the stable checkout. The code under test runs only as a subprocess
  (`node <checkout>/bin/era.mjs analyze … --json`).
* Every version uses the same REA binary (`ERA_REA_BIN`), the same datasets and a
  fresh temporary state directory.
* `era benchmark --versions a,b,c` checks out each tag into a temporary worktree
  and runs them one after another on the same host.
* Runs are sequential. Concurrent load on the host distorts wall time, so do not
  benchmark while other heavy work runs. Hopper start-up dominates the native
  cases and is the main noise source. Two identical era-v1 runs differed by 25.3%
  in total wall time, so the acceptance guard allows a 30% time regression.

## ERA vs REA

`era benchmark --rea-baseline` also runs, per case, **the same REA command
sequence ERA issues** (including the sandbox wrapper and per-function
decompilation) directly through `rea`, without ERA, and reports ERA's overhead.
ERA's accuracy is not compared with REA's: REA returns Evidence, not
normalized facts, so "REA accuracy" is not defined on this benchmark.

## Reproduce

```bash
era benchmark --repetitions 3
era benchmark --versions era-v1,era-v2,era-v3 --repetitions 3 --out benchmarks/results/versions.json
era benchmark --rea-baseline --repetitions 3
```

Results are JSON with every per-case value. Tables in the documentation are
copied from those files.
