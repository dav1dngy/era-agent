# ERA improvement cycle cycle-20261014T125204-f7ba8a

- Status: **awaiting-approval**
- Review: `git diff 0c98e0bb735e...experiment/cycle-20261014T125204-f7ba8a` or `change.patch`; then `era improve approve cycle-20261014T125204-f7ba8a` or `era improve decline cycle-20261014T125204-f7ba8a`
- Base: era-v4 (`0c98e0bb735e`), branch `experiment/cycle-20261014T125204-f7ba8a`
- Finding: F-84ffe6219c — No test module imports src/control_plane/jobs.js (test-coverage)
- Hypothesis: Adding a test that imports src/control_plane/jobs.js closes a coverage gap REA found in the import graph.
- Target: `{"metric":"finding_resolved","finding_id":"F-84ffe6219c"}` → finding F-84ffe6219c absent in candidate REA self-analysis
- Decision: accepted: all guards pass and target met

## Guards

| Guard | Result | Detail |
|---|---|---|
| protected paths unchanged | pass | none changed |
| all tests pass | pass | 173 passed, 0 failed |
| no baseline test removed, skipped or broken | pass | 166 baseline tests still pass |
| no accuracy regression | pass | 0.9867 -> 0.9867 |
| no error-rate increase | pass | 0 -> 0 |
| no reliability regression | pass | 1 -> 1 |
| time regression ≤ 30% | pass | 44391 -> 44257 ms |
| memory regression ≤ 20% | pass | 56410112 -> 56393728 bytes |
| self-analysis findings not increased | pass | 37 -> 36 |
| self-analysis evidence valid (supervisor-run REA) | pass | plan from evaluated-code |
| self-analysis covers every source module | pass | complete |

## Benchmark comparison

| Metric | Baseline | Candidate |
|---|---|---|
| accuracy_f1 | 0.9867 | 0.9867 |
| precision | 0.9875 | 0.9875 |
| completeness_recall | 0.9867 | 0.9867 |
| total_median_wall_ms | 44391 | 44257 |
| total_median_extract_ms | 561 | 440 |
| total_median_cpu_s | 0.2200 | 0.2200 |
| max_rss_bytes | 56410112 | 56393728 |
| error_rate | 0 | 0 |
| reliability | 1 | 1 |
| rea_runs | 10 | 10 |
| tests passed | 166 | 173 |

## REA self-analysis

- Baseline: self-20261014T125204-b261bb — 37 findings, startup 254 ms

| Step | REA command | Status | Duration | Evidence |
|---|---|---|---|---|
| supervised-self:pass-1/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-05bNer/pass-1` | succeeded | 3591 ms | `ev_2cdba5e187b912ea…` |
| supervised-self:pass-2/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-05bNer/pass-2` | succeeded | 3454 ms | `ev_ad1e07180c4a0159…` |
| supervised-self:pass-3/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-05bNer/pass-3` | succeeded | 3092 ms | `ev_b8004c38bbdff31f…` |
| supervised-self:pass-4/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-05bNer/pass-4` | succeeded | 3705 ms | `ev_44942c51f14b2485…` |
| supervised-self:pass-5/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-05bNer/pass-5` | succeeded | 3144 ms | `ev_caeb3e651f9e3d51…` |
| supervised-self:pass-6/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-05bNer/pass-6` | succeeded | 3333 ms | `ev_d14ed5ac31fae44a…` |
| supervised-self:pass-7/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-05bNer/pass-7` | succeeded | 3106 ms | `ev_21d9c705adc12682…` |
| supervised-self:pass-8/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-05bNer/pass-8` | succeeded | 3157 ms | `ev_e47716aa0c8f4acf…` |
| supervised-self:pass-9/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-05bNer/pass-9` | succeeded | 3278 ms | `ev_da2483355beb4c6a…` |
| supervised-self:pass-10/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-05bNer/pass-10` | succeeded | 3197 ms | `ev_8a033fdc60e86928…` |
| supervised-self:pass-11/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-05bNer/pass-11` | succeeded | 2922 ms | `ev_5e10da1258c8dffc…` |
| supervised-self:pass-12/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-05bNer/pass-12` | succeeded | 3215 ms | `ev_e14ff1d5d309f8bb…` |
| supervised-self:pass-13/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-05bNer/pass-13` | succeeded | 3209 ms | `ev_c87ac6410cd583ae…` |
| supervised-self:pass-14/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-05bNer/pass-14` | succeeded | 3278 ms | `ev_5d39bd1207586b4f…` |
| supervised-self:pass-15/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-05bNer/pass-15` | succeeded | 2324 ms | `ev_89db9f750cf4d6da…` |
| supervised-self:pass-16/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-05bNer/pass-16` | succeeded | 3250 ms | `ev_18a928577cb14911…` |
| supervised-self:pass-17/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-05bNer/pass-17` | succeeded | 3557 ms | `ev_2b5c75b443339454…` |
| supervised-self:pass-18/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-05bNer/pass-18` | succeeded | 3680 ms | `ev_b5275c4657597f35…` |
| supervised-self:pass-19/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-05bNer/pass-19` | succeeded | 3411 ms | `ev_f32376a20603d95f…` |
| supervised-self:pass-20/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-05bNer/pass-20` | succeeded | 3337 ms | `ev_08170b8fc1a466d3…` |
| supervised-self:pass-21/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-05bNer/pass-21` | succeeded | 3460 ms | `ev_7c7ba15ee7d5609f…` |
| supervised-self:pass-22/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-05bNer/pass-22` | succeeded | 3427 ms | `ev_7a37c0f62ddc77f3…` |
| supervised-self:runtime-help | `rea capture-process /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-05bNer/help-scenario.json` | succeeded | 2100 ms | `ev_de576fd2c5540ee3…` |

- Candidate: self-20261014T145107-74fca6 — 36 findings, startup 251 ms

| Step | REA command | Status | Duration | Evidence |
|---|---|---|---|---|
| supervised-self:pass-1/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-3j7do3/pass-1` | succeeded | 3186 ms | `ev_5d5c0410d91b1a38…` |
| supervised-self:pass-2/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-3j7do3/pass-2` | succeeded | 3517 ms | `ev_de98dca20107eca3…` |
| supervised-self:pass-3/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-3j7do3/pass-3` | succeeded | 3163 ms | `ev_fa3f781535181959…` |
| supervised-self:pass-4/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-3j7do3/pass-4` | succeeded | 3784 ms | `ev_713357479003306c…` |
| supervised-self:pass-5/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-3j7do3/pass-5` | succeeded | 3229 ms | `ev_cdc4555df668b032…` |
| supervised-self:pass-6/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-3j7do3/pass-6` | succeeded | 4082 ms | `ev_99bd5f068499a22c…` |
| supervised-self:pass-7/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-3j7do3/pass-7` | succeeded | 5251 ms | `ev_5a9091e5c32e1226…` |
| supervised-self:pass-8/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-3j7do3/pass-8` | succeeded | 3551 ms | `ev_a6cb41ea3975b28b…` |
| supervised-self:pass-9/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-3j7do3/pass-9` | succeeded | 3643 ms | `ev_b58a5076e1d99932…` |
| supervised-self:pass-10/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-3j7do3/pass-10` | succeeded | 3425 ms | `ev_e17b8f296b1f69bb…` |
| supervised-self:pass-11/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-3j7do3/pass-11` | succeeded | 3040 ms | `ev_c2c0a982c4450fc2…` |
| supervised-self:pass-12/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-3j7do3/pass-12` | succeeded | 3396 ms | `ev_0d94e2f2caf6131e…` |
| supervised-self:pass-13/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-3j7do3/pass-13` | succeeded | 3308 ms | `ev_ea2532e9d5683481…` |
| supervised-self:pass-14/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-3j7do3/pass-14` | succeeded | 3421 ms | `ev_75461bb9a593219c…` |
| supervised-self:pass-15/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-3j7do3/pass-15` | succeeded | 2654 ms | `ev_63e00b041d7c7d24…` |
| supervised-self:pass-16/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-3j7do3/pass-16` | succeeded | 4409 ms | `ev_533dc4273bba0e94…` |
| supervised-self:pass-17/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-3j7do3/pass-17` | succeeded | 5689 ms | `ev_8e503ccb3f040289…` |
| supervised-self:pass-18/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-3j7do3/pass-18` | succeeded | 6764 ms | `ev_4d1442fc47e43f53…` |
| supervised-self:pass-19/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-3j7do3/pass-19` | succeeded | 4004 ms | `ev_0201e65761134ea1…` |
| supervised-self:pass-20/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-3j7do3/pass-20` | succeeded | 3416 ms | `ev_8e505b13a7609b89…` |
| supervised-self:pass-21/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-3j7do3/pass-21` | succeeded | 3377 ms | `ev_049cc912d762e396…` |
| supervised-self:pass-22/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-3j7do3/pass-22` | succeeded | 3500 ms | `ev_6641b0b375b73a4c…` |
| supervised-self:runtime-help | `rea capture-process /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-3j7do3/help-scenario.json` | succeeded | 2165 ms | `ev_74846350cbd4bc35…` |

## Change

```
src/control_plane/jobs.js        |   9 ++-
 tests/control-plane-jobs.test.js | 116 +++++++++++++++++++++++++++++++++++++++
 2 files changed, 124 insertions(+), 1 deletion(-)
```
