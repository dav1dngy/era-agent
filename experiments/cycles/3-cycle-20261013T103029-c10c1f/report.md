# ERA improvement cycle cycle-20261013T103029-c10c1f

- Status: **accepted** → era-v3
- Base: era-v2 (`817ea7a5de4a`), branch `experiment/cycle-20261013T103029-c10c1f`
- Finding: B-js-commonjs-app — Benchmark case js-commonjs-app scores F1 0.846 (analysis-accuracy)
- Hypothesis: Improving ERA's interpretation of REA Evidence for js-commonjs-app raises benchmark accuracy. Missing facts: export:src/main.js#run, export:src/config.js#parseConfig, export:src/config.js#DEFAULT_ENDPOINT, export:src/net.js#fetchStatus; unexpected facts: none.
- Target: `{"metric":"accuracy_f1","min_delta":0.01}` → accuracy F1 0.9559 -> 0.9867 (Δ 0.0308, need ≥ 0.01)
- Decision: accepted: all guards pass and target met

## Guards

| Guard | Result | Detail |
|---|---|---|
| protected paths unchanged | pass | none changed |
| all tests pass | pass | 66 passed, 0 failed |
| no accuracy regression | pass | 0.9559 -> 0.9867 |
| no error-rate increase | pass | 0 -> 0 |
| no reliability regression | pass | 1 -> 1 |
| time regression ≤ 30% | pass | 67023 -> 66726 ms |
| memory regression ≤ 20% | pass | 408993792 -> 408371200 bytes |
| self-analysis findings not increased | pass | 6 -> 5 |
| self-analysis covers every source module | pass | complete |

## Benchmark comparison

| Metric | Baseline | Candidate |
|---|---|---|
| accuracy_f1 | 0.9559 | 0.9867 |
| precision | 0.9875 | 0.9875 |
| completeness_recall | 0.9333 | 0.9867 |
| total_median_wall_ms | 67023 | 66726 |
| total_median_cpu_s | 45.0700 | 40.3000 |
| max_rss_bytes | 408993792 | 408371200 |
| error_rate | 0 | 0 |
| reliability | 1 | 1 |
| rea_runs | 10 | 10 |
| tests passed | 64 | 66 |

## REA self-analysis

- Baseline: self-20261013T103029-a610cc — 6 findings, startup 315 ms

| Step | REA command | Status | Duration | Evidence |
|---|---|---|---|---|
| self-analysis:static-graph-1/4 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T103029-a610cc/work/passes/pass-1` | succeeded | 7407 ms | `ev_7d0a744f1460e79e…` |
| self-analysis:static-graph-2/4 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T103029-a610cc/work/passes/pass-2` | succeeded | 7377 ms | `ev_dc7d4fa7349624ee…` |
| self-analysis:static-graph-3/4 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T103029-a610cc/work/passes/pass-3` | succeeded | 5872 ms | `ev_50dc6e0c203eedb6…` |
| self-analysis:static-graph-4/4 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T103029-a610cc/work/passes/pass-4` | succeeded | 5765 ms | `ev_aa8fb5f3d1ca36c3…` |
| self-analysis:runtime-help | `rea capture-process <era-repo>/.era/self-analyses/self-20261013T103029-a610cc/help-scenario.json` | succeeded | 2657 ms | `ev_892bc9d89764aaee…` |

- Candidate: self-20261013T104238-c18e7b — 5 findings, startup 265 ms

| Step | REA command | Status | Duration | Evidence |
|---|---|---|---|---|
| self-analysis:static-graph-1/4 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T104238-c18e7b/work/passes/pass-1` | succeeded | 5568 ms | `ev_318759a0f9728ed6…` |
| self-analysis:static-graph-2/4 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T104238-c18e7b/work/passes/pass-2` | succeeded | 5469 ms | `ev_2b89299e50b3df23…` |
| self-analysis:static-graph-3/4 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T104238-c18e7b/work/passes/pass-3` | succeeded | 5418 ms | `ev_7f64b9af05a6a957…` |
| self-analysis:static-graph-4/4 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T104238-c18e7b/work/passes/pass-4` | succeeded | 5483 ms | `ev_26915f6ddd967655…` |
| self-analysis:runtime-help | `rea capture-process <era-repo>/.era/self-analyses/self-20261013T104238-c18e7b/help-scenario.json` | succeeded | 2809 ms | `ev_8cac22f444c5305c…` |

## Change

```
src/analysis/facts.js  | 34 ++++++++++++++++++++++++++++++++++
 tests/analysis.test.js | 25 ++++++++++++++++++++++++-
 2 files changed, 58 insertions(+), 1 deletion(-)
```
