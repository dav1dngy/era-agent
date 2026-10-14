# ERA improvement cycle cycle-20261014T162426-0220c7

- Status: **awaiting-approval**
- Review: `git diff 9f3675863a9f...experiment/cycle-20261014T162426-0220c7` or `change.patch`; then `era improve approve cycle-20261014T162426-0220c7` or `era improve decline cycle-20261014T162426-0220c7`
- Base: era-v4 (`9f3675863a9f`), branch `experiment/cycle-20261014T162426-0220c7`
- Finding: F-6f84721171 — No test module imports src/control_plane/errors.js (test-coverage)
- Hypothesis: Adding a test that imports src/control_plane/errors.js closes a coverage gap REA found in the import graph.
- Target: `{"metric":"finding_resolved","finding_id":"F-6f84721171"}` → finding F-6f84721171 absent in candidate REA self-analysis
- Decision: accepted: all guards pass and target met

## Guards

| Guard | Result | Detail |
|---|---|---|
| protected paths unchanged | pass | none changed |
| all tests pass | pass | 178 passed, 0 failed |
| no baseline test removed, skipped or broken | pass | 177 baseline tests still pass |
| no accuracy regression | pass | 0.9867 -> 0.9867 |
| no error-rate increase | pass | 0 -> 0 |
| no reliability regression | pass | 1 -> 1 |
| time regression ≤ 30% | pass | 34317 -> 34299 ms |
| memory regression ≤ 20% | pass | 56295424 -> 56246272 bytes |
| self-analysis findings not increased | pass | 35 -> 34 |
| self-analysis evidence valid (supervisor-run REA) | pass | plan from evaluated-code |
| self-analysis covers every source module | pass | complete |

## Benchmark comparison

| Metric | Baseline | Candidate |
|---|---|---|
| accuracy_f1 | 0.9867 | 0.9867 |
| precision | 0.9875 | 0.9875 |
| completeness_recall | 0.9867 | 0.9867 |
| total_median_wall_ms | 34317 | 34299 |
| total_median_extract_ms | 442 | 425 |
| total_median_cpu_s | 0.2100 | 0.2000 |
| max_rss_bytes | 56295424 | 56246272 |
| error_rate | 0 | 0 |
| reliability | 1 | 1 |
| rea_runs | 10 | 10 |
| tests passed | 177 | 178 |

## REA self-analysis

- Baseline: self-20261014T163023-08f600 — 35 findings, startup 258 ms

| Step | REA command | Status | Duration | Evidence |
|---|---|---|---|---|
| supervised-self:pass-1/24 | `rea analyze-javascript-application <tmp>/era-supervised-8gkoWd/pass-1` | succeeded | 3819 ms | `ev_99535031d92ff270…` |
| supervised-self:pass-2/24 | `rea analyze-javascript-application <tmp>/era-supervised-8gkoWd/pass-2` | succeeded | 3637 ms | `ev_70494cbfc02b01bf…` |
| supervised-self:pass-3/24 | `rea analyze-javascript-application <tmp>/era-supervised-8gkoWd/pass-3` | succeeded | 3869 ms | `ev_54cc3abba101a182…` |
| supervised-self:pass-4/24 | `rea analyze-javascript-application <tmp>/era-supervised-8gkoWd/pass-4` | succeeded | 4444 ms | `ev_1897344b5d9cd321…` |
| supervised-self:pass-5/24 | `rea analyze-javascript-application <tmp>/era-supervised-8gkoWd/pass-5` | succeeded | 5093 ms | `ev_733fbf6318600556…` |
| supervised-self:pass-6/24 | `rea analyze-javascript-application <tmp>/era-supervised-8gkoWd/pass-6` | succeeded | 3583 ms | `ev_55ceb7c12b9b0259…` |
| supervised-self:pass-7/24 | `rea analyze-javascript-application <tmp>/era-supervised-8gkoWd/pass-7` | succeeded | 3285 ms | `ev_d2cd9b03d7b40d81…` |
| supervised-self:pass-8/24 | `rea analyze-javascript-application <tmp>/era-supervised-8gkoWd/pass-8` | succeeded | 3161 ms | `ev_0edf53a27adc5dec…` |
| supervised-self:pass-9/24 | `rea analyze-javascript-application <tmp>/era-supervised-8gkoWd/pass-9` | succeeded | 3212 ms | `ev_f6c7a7a198a345cc…` |
| supervised-self:pass-10/24 | `rea analyze-javascript-application <tmp>/era-supervised-8gkoWd/pass-10` | succeeded | 3115 ms | `ev_647b054f9d7717ff…` |
| supervised-self:pass-11/24 | `rea analyze-javascript-application <tmp>/era-supervised-8gkoWd/pass-11` | succeeded | 2900 ms | `ev_b1beecb5cf34d2d8…` |
| supervised-self:pass-12/24 | `rea analyze-javascript-application <tmp>/era-supervised-8gkoWd/pass-12` | succeeded | 3172 ms | `ev_0b182c72d16bf42e…` |
| supervised-self:pass-13/24 | `rea analyze-javascript-application <tmp>/era-supervised-8gkoWd/pass-13` | succeeded | 3249 ms | `ev_ae98ed414214573b…` |
| supervised-self:pass-14/24 | `rea analyze-javascript-application <tmp>/era-supervised-8gkoWd/pass-14` | succeeded | 3172 ms | `ev_980798b786bde0c6…` |
| supervised-self:pass-15/24 | `rea analyze-javascript-application <tmp>/era-supervised-8gkoWd/pass-15` | succeeded | 3095 ms | `ev_e01571d8b951807d…` |
| supervised-self:pass-16/24 | `rea analyze-javascript-application <tmp>/era-supervised-8gkoWd/pass-16` | succeeded | 3421 ms | `ev_52bccd58376b1bc1…` |
| supervised-self:pass-17/24 | `rea analyze-javascript-application <tmp>/era-supervised-8gkoWd/pass-17` | succeeded | 2426 ms | `ev_61e0821e787ac724…` |
| supervised-self:pass-18/24 | `rea analyze-javascript-application <tmp>/era-supervised-8gkoWd/pass-18` | succeeded | 3380 ms | `ev_fc794957925b4153…` |
| supervised-self:pass-19/24 | `rea analyze-javascript-application <tmp>/era-supervised-8gkoWd/pass-19` | succeeded | 3592 ms | `ev_c7888be6e46f044f…` |
| supervised-self:pass-20/24 | `rea analyze-javascript-application <tmp>/era-supervised-8gkoWd/pass-20` | succeeded | 3646 ms | `ev_fd9187e46c270255…` |
| supervised-self:pass-21/24 | `rea analyze-javascript-application <tmp>/era-supervised-8gkoWd/pass-21` | succeeded | 3725 ms | `ev_67a8b4b7ad8f84c3…` |
| supervised-self:pass-22/24 | `rea analyze-javascript-application <tmp>/era-supervised-8gkoWd/pass-22` | succeeded | 3500 ms | `ev_838098d33d271069…` |
| supervised-self:pass-23/24 | `rea analyze-javascript-application <tmp>/era-supervised-8gkoWd/pass-23` | succeeded | 3514 ms | `ev_bffb1f289e6619ce…` |
| supervised-self:pass-24/24 | `rea analyze-javascript-application <tmp>/era-supervised-8gkoWd/pass-24` | succeeded | 3559 ms | `ev_58357b9b955ab678…` |
| supervised-self:runtime-help | `rea capture-process <tmp>/era-supervised-8gkoWd/help-scenario.json` | succeeded | 2190 ms | `ev_7c4d5ed0de059657…` |

- Candidate: self-20261014T163540-cd9587 — 34 findings, startup 254 ms

| Step | REA command | Status | Duration | Evidence |
|---|---|---|---|---|
| supervised-self:pass-1/24 | `rea analyze-javascript-application <tmp>/era-supervised-4sFRr7/pass-1` | succeeded | 3115 ms | `ev_7c6fdb9f7bf0a032…` |
| supervised-self:pass-2/24 | `rea analyze-javascript-application <tmp>/era-supervised-4sFRr7/pass-2` | succeeded | 3551 ms | `ev_f5f1e4ef72450a99…` |
| supervised-self:pass-3/24 | `rea analyze-javascript-application <tmp>/era-supervised-4sFRr7/pass-3` | succeeded | 3157 ms | `ev_61af3161b788be63…` |
| supervised-self:pass-4/24 | `rea analyze-javascript-application <tmp>/era-supervised-4sFRr7/pass-4` | succeeded | 3776 ms | `ev_3db55d0a922830ee…` |
| supervised-self:pass-5/24 | `rea analyze-javascript-application <tmp>/era-supervised-4sFRr7/pass-5` | succeeded | 3142 ms | `ev_ced0de07863143c1…` |
| supervised-self:pass-6/24 | `rea analyze-javascript-application <tmp>/era-supervised-4sFRr7/pass-6` | succeeded | 3395 ms | `ev_32c3356c53e726cd…` |
| supervised-self:pass-7/24 | `rea analyze-javascript-application <tmp>/era-supervised-4sFRr7/pass-7` | succeeded | 3173 ms | `ev_8e2bf9c7566610f9…` |
| supervised-self:pass-8/24 | `rea analyze-javascript-application <tmp>/era-supervised-4sFRr7/pass-8` | succeeded | 3120 ms | `ev_e73d3a349624fccb…` |
| supervised-self:pass-9/24 | `rea analyze-javascript-application <tmp>/era-supervised-4sFRr7/pass-9` | succeeded | 3139 ms | `ev_669dff5db0ea5086…` |
| supervised-self:pass-10/24 | `rea analyze-javascript-application <tmp>/era-supervised-4sFRr7/pass-10` | succeeded | 3045 ms | `ev_52f5e50fb83462f8…` |
| supervised-self:pass-11/24 | `rea analyze-javascript-application <tmp>/era-supervised-4sFRr7/pass-11` | succeeded | 2866 ms | `ev_57851f8c83ba443d…` |
| supervised-self:pass-12/24 | `rea analyze-javascript-application <tmp>/era-supervised-4sFRr7/pass-12` | succeeded | 3145 ms | `ev_79b5ababf3e9c052…` |
| supervised-self:pass-13/24 | `rea analyze-javascript-application <tmp>/era-supervised-4sFRr7/pass-13` | succeeded | 3181 ms | `ev_e656c685388becbd…` |
| supervised-self:pass-14/24 | `rea analyze-javascript-application <tmp>/era-supervised-4sFRr7/pass-14` | succeeded | 3081 ms | `ev_592dc498ac64bd6a…` |
| supervised-self:pass-15/24 | `rea analyze-javascript-application <tmp>/era-supervised-4sFRr7/pass-15` | succeeded | 3036 ms | `ev_78321851712fb98e…` |
| supervised-self:pass-16/24 | `rea analyze-javascript-application <tmp>/era-supervised-4sFRr7/pass-16` | succeeded | 3478 ms | `ev_f1406bab047c69be…` |
| supervised-self:pass-17/24 | `rea analyze-javascript-application <tmp>/era-supervised-4sFRr7/pass-17` | succeeded | 2244 ms | `ev_ab953f6e3489dbbd…` |
| supervised-self:pass-18/24 | `rea analyze-javascript-application <tmp>/era-supervised-4sFRr7/pass-18` | succeeded | 3256 ms | `ev_b0a63c967a92d79a…` |
| supervised-self:pass-19/24 | `rea analyze-javascript-application <tmp>/era-supervised-4sFRr7/pass-19` | succeeded | 3450 ms | `ev_775333a4a60944ff…` |
| supervised-self:pass-20/24 | `rea analyze-javascript-application <tmp>/era-supervised-4sFRr7/pass-20` | succeeded | 3651 ms | `ev_430e62d573256b0c…` |
| supervised-self:pass-21/24 | `rea analyze-javascript-application <tmp>/era-supervised-4sFRr7/pass-21` | succeeded | 3580 ms | `ev_c570bae4e2854a95…` |
| supervised-self:pass-22/24 | `rea analyze-javascript-application <tmp>/era-supervised-4sFRr7/pass-22` | succeeded | 3369 ms | `ev_cd3b852c6e5b326e…` |
| supervised-self:pass-23/24 | `rea analyze-javascript-application <tmp>/era-supervised-4sFRr7/pass-23` | succeeded | 3348 ms | `ev_32228ea32152136d…` |
| supervised-self:pass-24/24 | `rea analyze-javascript-application <tmp>/era-supervised-4sFRr7/pass-24` | succeeded | 3387 ms | `ev_9991a8e181552042…` |
| supervised-self:runtime-help | `rea capture-process <tmp>/era-supervised-4sFRr7/help-scenario.json` | succeeded | 2225 ms | `ev_3f7bfbd2d8962873…` |

## Change

```
tests/control-plane-errors.test.js | 16 ++++++++++++++++
 1 file changed, 16 insertions(+)
```
