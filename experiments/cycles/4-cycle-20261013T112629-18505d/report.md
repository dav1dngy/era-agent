# ERA improvement cycle cycle-20261013T112629-18505d

- Status: **awaiting-approval**
- Review: `git diff 5004f964b449...experiment/cycle-20261013T112629-18505d` or `change.patch`; then `era improve approve cycle-20261013T112629-18505d` or `era improve decline cycle-20261013T112629-18505d`
- Base: era-v3 (`5004f964b449`), branch `experiment/cycle-20261013T112629-18505d`
- Finding: F-5dd92e0c8a — REA analysis of src/self_analysis/self-analyze.js is incomplete (resource_constraint) (analysis-accuracy)
- Hypothesis: REA analysis of src/self_analysis/self-analyze.js is incomplete (resource_constraint)
- Target: `{"metric":"finding_resolved","finding_id":"F-5dd92e0c8a"}` → finding F-5dd92e0c8a absent in candidate REA self-analysis
- Decision: accepted: all guards pass and target met

## Guards

| Guard | Result | Detail |
|---|---|---|
| protected paths unchanged | pass | none changed |
| all tests pass | pass | 104 passed, 0 failed |
| no accuracy regression | pass | 0.5931 -> 0.5931 |
| no error-rate increase | pass | 0.4 -> 0.4 |
| no reliability regression | pass | 0.6 -> 0.6 |
| time regression ≤ 30% | pass | 23109 -> 20583 ms |
| memory regression ≤ 20% | pass | 409239552 -> 410042368 bytes |
| self-analysis findings not increased | pass | 26 -> 7 |
| self-analysis covers every source module | pass | complete |

## Benchmark comparison

| Metric | Baseline | Candidate |
|---|---|---|
| accuracy_f1 | 0.5931 | 0.5931 |
| precision | 0.6000 | 0.6000 |
| completeness_recall | 0.5867 | 0.5867 |
| total_median_wall_ms | 23109 | 20583 |
| total_median_cpu_s | 28.5400 | 27.5200 |
| max_rss_bytes | 409239552 | 410042368 |
| error_rate | 0.4000 | 0.4000 |
| reliability | 0.6000 | 0.6000 |
| rea_runs | 10 | 10 |
| tests passed | 101 | 104 |

## REA self-analysis

- Baseline: self-20261013T112629-261b01 — 26 findings, startup 272 ms

| Step | REA command | Status | Duration | Evidence |
|---|---|---|---|---|
| self-analysis:static-graph-1/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T112629-261b01/work/passes/pass-1` | succeeded | 6923 ms | `ev_23a222980dd911ee…` |
| self-analysis:static-graph-2/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T112629-261b01/work/passes/pass-2` | succeeded | 6239 ms | `ev_f9b8cf9f9bea85e7…` |
| self-analysis:static-graph-3/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T112629-261b01/work/passes/pass-3` | succeeded | 6000 ms | `ev_52ec93e3a8e96e8e…` |
| self-analysis:static-graph-4/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T112629-261b01/work/passes/pass-4` | succeeded | 5892 ms | `ev_85a8e187d7870810…` |
| self-analysis:static-graph-5/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T112629-261b01/work/passes/pass-5` | succeeded | 6007 ms | `ev_fe1ee303f2052019…` |
| self-analysis:static-graph-6/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T112629-261b01/work/passes/pass-6` | succeeded | 5960 ms | `ev_baac17163bec6ef9…` |
| self-analysis:runtime-help | `rea capture-process <era-repo>/.era/self-analyses/self-20261013T112629-261b01/help-scenario.json` | succeeded | 2297 ms | `ev_88fb4f7b761df88f…` |

- Candidate: self-20261013T114655-530455 — 7 findings, startup 210 ms

| Step | REA command | Status | Duration | Evidence |
|---|---|---|---|---|
| self-analysis:static-graph-1/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T114655-530455/work/passes/pass-1` | succeeded | 3223 ms | `ev_9a3d3186908e491a…` |
| self-analysis:static-graph-2/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T114655-530455/work/passes/pass-2` | succeeded | 3572 ms | `ev_80d052252081d91d…` |
| self-analysis:static-graph-3/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T114655-530455/work/passes/pass-3` | succeeded | 3364 ms | `ev_2197ae334b0fde22…` |
| self-analysis:static-graph-4/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T114655-530455/work/passes/pass-4` | succeeded | 3224 ms | `ev_dd3b6f1dfdfcf28c…` |
| self-analysis:static-graph-5/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T114655-530455/work/passes/pass-5` | succeeded | 3733 ms | `ev_5f76793c7f9ccda3…` |
| self-analysis:static-graph-6/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T114655-530455/work/passes/pass-6` | succeeded | 2291 ms | `ev_f0cc7e6eaff63221…` |
| self-analysis:runtime-help | `rea capture-process <era-repo>/.era/self-analyses/self-20261013T114655-530455/help-scenario.json` | succeeded | 2024 ms | `ev_7bf04d3902d9fc28…` |

## Change

```
src/self_analysis/self-analyze.js | 122 +++++++++++++++++++++++++++-----------
 tests/self-analyze-passes.test.js |  83 +++++++++++++++++---------
 2 files changed, 141 insertions(+), 64 deletions(-)
```
