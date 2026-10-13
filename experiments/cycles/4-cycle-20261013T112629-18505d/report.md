# ERA improvement cycle cycle-20261013T112629-18505d

- Status: **rejected**
- Base: era-v3 (`f02fdfce9684`), branch `experiment/cycle-20261013T112629-18505d`
- Finding: F-5dd92e0c8a — REA analysis of src/self_analysis/self-analyze.js is incomplete (resource_constraint) (analysis-accuracy)
- Hypothesis: REA analysis of src/self_analysis/self-analyze.js is incomplete (resource_constraint)
- Target: `{"metric":"finding_resolved","finding_id":"F-5dd92e0c8a"}` → finding F-5dd92e0c8a absent in candidate REA self-analysis
- Decision: rejected: all tests pass

## Guards

| Guard | Result | Detail |
|---|---|---|
| protected paths unchanged | pass | none changed |
| all tests pass | FAIL | 106 passed, 1 failed |
| no accuracy regression | pass | 0.9867 -> 0.9867 |
| no error-rate increase | pass | 0 -> 0 |
| no reliability regression | pass | 1 -> 1 |
| time regression ≤ 30% | pass | 33983 -> 38048 ms |
| memory regression ≤ 20% | pass | 408731648 -> 409976832 bytes |
| self-analysis findings not increased | pass | 26 -> 9 |
| self-analysis covers every source module | pass | complete |

## Benchmark comparison

| Metric | Baseline | Candidate |
|---|---|---|
| accuracy_f1 | 0.9867 | 0.9867 |
| precision | 0.9875 | 0.9875 |
| completeness_recall | 0.9867 | 0.9867 |
| total_median_wall_ms | 33983 | 38048 |
| total_median_cpu_s | 32.2700 | 32.1700 |
| max_rss_bytes | 408731648 | 409976832 |
| error_rate | 0 | 0 |
| reliability | 1 | 1 |
| rea_runs | 10 | 10 |
| tests passed | 104 | 106 |

## REA self-analysis

- Baseline: self-20261013T145141-666c54 — 26 findings, startup 235 ms

| Step | REA command | Status | Duration | Evidence |
|---|---|---|---|---|
| self-analysis:static-graph-1/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T145141-666c54/work/passes/pass-1` | succeeded | 7856 ms | `ev_3d33cb4610929361…` |
| self-analysis:static-graph-2/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T145141-666c54/work/passes/pass-2` | succeeded | 5827 ms | `ev_dfd8a63ff3a43e9d…` |
| self-analysis:static-graph-3/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T145141-666c54/work/passes/pass-3` | succeeded | 6082 ms | `ev_fdd420d525fc102d…` |
| self-analysis:static-graph-4/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T145141-666c54/work/passes/pass-4` | succeeded | 5999 ms | `ev_a2787e33e9586ef2…` |
| self-analysis:static-graph-5/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T145141-666c54/work/passes/pass-5` | succeeded | 6204 ms | `ev_8438b12af7763208…` |
| self-analysis:static-graph-6/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T145141-666c54/work/passes/pass-6` | succeeded | 5904 ms | `ev_21b7e1a13bf20502…` |
| self-analysis:runtime-help | `rea capture-process <era-repo>/.era/self-analyses/self-20261013T145141-666c54/help-scenario.json` | succeeded | 2173 ms | `ev_6d1203edf64d7ba8…` |

- Candidate: self-20261013T150323-e9d1ed — 9 findings, startup 212 ms

| Step | REA command | Status | Duration | Evidence |
|---|---|---|---|---|
| self-analysis:static-graph-1/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T150323-e9d1ed/work/passes/pass-1` | succeeded | 3280 ms | `ev_ae6326975d921193…` |
| self-analysis:static-graph-2/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T150323-e9d1ed/work/passes/pass-2` | succeeded | 3627 ms | `ev_b302ad130be40c76…` |
| self-analysis:static-graph-3/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T150323-e9d1ed/work/passes/pass-3` | succeeded | 3324 ms | `ev_08c8cad5cd28114d…` |
| self-analysis:static-graph-4/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T150323-e9d1ed/work/passes/pass-4` | succeeded | 3295 ms | `ev_c3f1a75490476e19…` |
| self-analysis:static-graph-5/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T150323-e9d1ed/work/passes/pass-5` | succeeded | 3804 ms | `ev_a245f1a7cafab674…` |
| self-analysis:static-graph-6/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T150323-e9d1ed/work/passes/pass-6` | succeeded | 2509 ms | `ev_5b54f8a3cc327d41…` |
| self-analysis:runtime-help | `rea capture-process <era-repo>/.era/self-analyses/self-20261013T150323-e9d1ed/help-scenario.json` | succeeded | 2078 ms | `ev_8dffce2776107fa6…` |

## Change

```
src/self_analysis/self-analyze.js | 122 +++++++++++++++++++++++++++-----------
 tests/self-analyze-passes.test.js |  83 +++++++++++++++++---------
 2 files changed, 141 insertions(+), 64 deletions(-)
```
