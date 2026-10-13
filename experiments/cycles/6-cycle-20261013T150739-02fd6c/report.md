# ERA improvement cycle cycle-20261013T150739-02fd6c

- Status: **integrated** → era-v4 (approved by David Nguyen (approved in chat))
- Base: era-v3 (`fa4bbdb856eb`), branch `experiment/cycle-20261013T150739-02fd6c`
- Finding: F-5dd92e0c8a — REA analysis of src/self_analysis/self-analyze.js is incomplete (resource_constraint) (analysis-accuracy)
- Hypothesis: REA analysis of src/self_analysis/self-analyze.js is incomplete (resource_constraint)
- Target: `{"metric":"finding_resolved","finding_id":"F-5dd92e0c8a"}` → finding F-5dd92e0c8a absent in candidate REA self-analysis
- Decision: accepted: all guards pass and target met

## Guards

| Guard | Result | Detail |
|---|---|---|
| protected paths unchanged | pass | none changed |
| all tests pass | pass | 107 passed, 0 failed |
| no accuracy regression | pass | 0.9867 -> 0.9867 |
| no error-rate increase | pass | 0 -> 0 |
| no reliability regression | pass | 1 -> 1 |
| time regression ≤ 30% | pass | 45402 -> 53563 ms |
| memory regression ≤ 20% | pass | 408748032 -> 408174592 bytes |
| self-analysis findings not increased | pass | 27 -> 9 |
| self-analysis covers every source module | pass | complete |

## Benchmark comparison

| Metric | Baseline | Candidate |
|---|---|---|
| accuracy_f1 | 0.9867 | 0.9867 |
| precision | 0.9875 | 0.9875 |
| completeness_recall | 0.9867 | 0.9867 |
| total_median_wall_ms | 45402 | 53563 |
| total_median_cpu_s | 32.3600 | 35 |
| max_rss_bytes | 408748032 | 408174592 |
| error_rate | 0 | 0 |
| reliability | 1 | 1 |
| rea_runs | 10 | 10 |
| tests passed | 104 | 107 |

## REA self-analysis

- Baseline: self-20261013T150917-a22327 — 27 findings, startup 211 ms

| Step | REA command | Status | Duration | Evidence |
|---|---|---|---|---|
| self-analysis:static-graph-1/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T150917-a22327/work/passes/pass-1` | succeeded | 6312 ms | `ev_fd7c4ccf10d352a2…` |
| self-analysis:static-graph-2/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T150917-a22327/work/passes/pass-2` | succeeded | 6046 ms | `ev_39748422d955eb40…` |
| self-analysis:static-graph-3/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T150917-a22327/work/passes/pass-3` | succeeded | 6054 ms | `ev_f494d603122a1b15…` |
| self-analysis:static-graph-4/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T150917-a22327/work/passes/pass-4` | succeeded | 6037 ms | `ev_533b50391c67909d…` |
| self-analysis:static-graph-5/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T150917-a22327/work/passes/pass-5` | succeeded | 6026 ms | `ev_baf7a79879aa4d00…` |
| self-analysis:static-graph-6/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T150917-a22327/work/passes/pass-6` | succeeded | 6227 ms | `ev_a15c1260f13a4a22…` |
| self-analysis:runtime-help | `rea capture-process <era-repo>/.era/self-analyses/self-20261013T150917-a22327/help-scenario.json` | succeeded | 2104 ms | `ev_c83284bae3c2afa9…` |

- Candidate: self-20261013T151801-8a1d2a — 9 findings, startup 213 ms

| Step | REA command | Status | Duration | Evidence |
|---|---|---|---|---|
| self-analysis:static-graph-1/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T151801-8a1d2a/work/passes/pass-1` | succeeded | 3596 ms | `ev_b3e429518b204c1c…` |
| self-analysis:static-graph-2/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T151801-8a1d2a/work/passes/pass-2` | succeeded | 3697 ms | `ev_c1ef7f620ebf11e5…` |
| self-analysis:static-graph-3/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T151801-8a1d2a/work/passes/pass-3` | succeeded | 3344 ms | `ev_2010b81175bb57ee…` |
| self-analysis:static-graph-4/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T151801-8a1d2a/work/passes/pass-4` | succeeded | 3260 ms | `ev_405a6d0d372f1c7a…` |
| self-analysis:static-graph-5/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T151801-8a1d2a/work/passes/pass-5` | succeeded | 3786 ms | `ev_2f55ddb0a7a78dec…` |
| self-analysis:static-graph-6/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T151801-8a1d2a/work/passes/pass-6` | succeeded | 2523 ms | `ev_75ba1b3cf1c19bd2…` |
| self-analysis:runtime-help | `rea capture-process <era-repo>/.era/self-analyses/self-20261013T151801-8a1d2a/help-scenario.json` | succeeded | 2121 ms | `ev_4db603c82874ce72…` |

## Change

```
src/self_analysis/self-analyze.js | 122 +++++++++++++++++++++++++++-----------
 tests/self-analyze-passes.test.js |  83 +++++++++++++++++---------
 2 files changed, 141 insertions(+), 64 deletions(-)
```
