# ERA improvement cycle cycle-20261013T095936-14e2b8

- Status: **rejected**
- Base: era-v1 (`5bca48116081`), branch `experiment/cycle-20261013T095936-14e2b8`
- Finding: B-js-commonjs-app — Benchmark case js-commonjs-app scores F1 0.846 (analysis-accuracy)
- Hypothesis: Improving ERA's interpretation of REA Evidence for js-commonjs-app raises benchmark accuracy. Missing facts: export:src/main.js#run, export:src/config.js#parseConfig, export:src/config.js#DEFAULT_ENDPOINT, export:src/net.js#fetchStatus; unexpected facts: none.
- Target: `{"metric":"accuracy_f1","min_delta":0.01}` → accuracy F1 0.9559 -> 0.9867 (Δ 0.0308, need ≥ 0.01)
- Decision: rejected: self-analysis findings not increased

## Guards

| Guard | Result | Detail |
|---|---|---|
| protected paths unchanged | pass | none changed |
| all tests pass | pass | 64 passed, 0 failed |
| no accuracy regression | pass | 0.9559 -> 0.9867 |
| no error-rate increase | pass | 0 -> 0 |
| no reliability regression | pass | 1 -> 1 |
| time regression ≤ 30% | pass | 65734 -> 71435 ms |
| memory regression ≤ 20% | pass | 416612352 -> 412565504 bytes |
| self-analysis findings not increased | FAIL | 7 -> 9 |
| self-analysis covers every source module | pass | complete |

## Benchmark comparison

| Metric | Baseline | Candidate |
|---|---|---|
| accuracy_f1 | 0.9559 | 0.9867 |
| precision | 0.9875 | 0.9875 |
| completeness_recall | 0.9333 | 0.9867 |
| total_median_wall_ms | 65734 | 71435 |
| total_median_cpu_s | 41.7300 | 42.5000 |
| max_rss_bytes | 416612352 | 412565504 |
| error_rate | 0 | 0 |
| reliability | 1 | 1 |
| rea_runs | 10 | 10 |
| tests passed | 62 | 64 |

## REA self-analysis

- Baseline: self-20261013T095936-cdf446 — 7 findings, startup 265 ms

| Step | REA command | Status | Duration | Evidence |
|---|---|---|---|---|
| self-analysis:static-graph | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T095936-cdf446/work/artifact/package` | succeeded | 7367 ms | `ev_ad9398b7a587eca9…` |
| self-analysis:runtime-help | `rea capture-process <era-repo>/.era/self-analyses/self-20261013T095936-cdf446/help-scenario.json` | succeeded | 2423 ms | `ev_49c011b48af845ab…` |

- Candidate: self-20261013T101050-8fa562 — 9 findings, startup 314 ms

| Step | REA command | Status | Duration | Evidence |
|---|---|---|---|---|
| self-analysis:static-graph | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T101050-8fa562/work/artifact/package` | succeeded | 8275 ms | `ev_60973c1a05a3c2b4…` |
| self-analysis:runtime-help | `rea capture-process <era-repo>/.era/self-analyses/self-20261013T101050-8fa562/help-scenario.json` | succeeded | 7089 ms | `ev_1e4ea9c08fe40281…` |

## Change

```
src/analysis/facts.js  | 34 ++++++++++++++++++++++++++++++++++
 tests/analysis.test.js | 25 ++++++++++++++++++++++++-
 2 files changed, 58 insertions(+), 1 deletion(-)
```
