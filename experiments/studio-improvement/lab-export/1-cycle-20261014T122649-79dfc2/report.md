# ERA improvement cycle cycle-20261014T122649-79dfc2

- Status: **rejected**
- Base: era-v4 (`0c98e0bb735e`), branch `experiment/cycle-20261014T122649-79dfc2`
- Finding: F-4159faffc3 — No test module imports src/control_plane/services/system.js (test-coverage)
- Hypothesis: Adding a test that imports src/control_plane/services/system.js closes a coverage gap REA found in the import graph.
- Target: `{"metric":"finding_resolved","finding_id":"F-4159faffc3"}` → finding F-4159faffc3 absent in candidate REA self-analysis
- Decision: rejected: no baseline test removed, skipped or broken

## Guards

| Guard | Result | Detail |
|---|---|---|
| protected paths unchanged | pass | none changed |
| all tests pass | pass | 170 passed, 0 failed |
| no baseline test removed, skipped or broken | FAIL | Monaco never opts into DOMPurify IN_PLACE mode (the precondition of both advisories) (skip) |
| no accuracy regression | pass | 0.9867 -> 0.9867 |
| no error-rate increase | pass | 0 -> 0 |
| no reliability regression | pass | 1 -> 1 |
| time regression ≤ 30% | pass | 36985 -> 36857 ms |
| memory regression ≤ 20% | pass | 56311808 -> 56295424 bytes |
| self-analysis findings not increased | pass | 37 -> 36 |
| self-analysis evidence valid (supervisor-run REA) | pass | plan from evaluated-code |
| self-analysis covers every source module | pass | complete |

## Benchmark comparison

| Metric | Baseline | Candidate |
|---|---|---|
| accuracy_f1 | 0.9867 | 0.9867 |
| precision | 0.9875 | 0.9875 |
| completeness_recall | 0.9867 | 0.9867 |
| total_median_wall_ms | 36985 | 36857 |
| total_median_extract_ms | 484 | 440 |
| total_median_cpu_s | 0.2300 | 0.2100 |
| max_rss_bytes | 56311808 | 56295424 |
| error_rate | 0 | 0 |
| reliability | 1 | 1 |
| rea_runs | 10 | 10 |
| tests passed | 167 | 170 |

## REA self-analysis

- Baseline: self-20261014T123346-918ce7 — 37 findings, startup 258 ms

| Step | REA command | Status | Duration | Evidence |
|---|---|---|---|---|
| supervised-self:pass-1/22 | `rea analyze-javascript-application <tmp>/era-supervised-Vnwk9x/pass-1` | succeeded | 3434 ms | `ev_fe949d3b39ceb1a4…` |
| supervised-self:pass-2/22 | `rea analyze-javascript-application <tmp>/era-supervised-Vnwk9x/pass-2` | succeeded | 3931 ms | `ev_9092224aca109f0e…` |
| supervised-self:pass-3/22 | `rea analyze-javascript-application <tmp>/era-supervised-Vnwk9x/pass-3` | succeeded | 3247 ms | `ev_5224d203b3a0a786…` |
| supervised-self:pass-4/22 | `rea analyze-javascript-application <tmp>/era-supervised-Vnwk9x/pass-4` | succeeded | 3977 ms | `ev_a11869e81bcb4b7c…` |
| supervised-self:pass-5/22 | `rea analyze-javascript-application <tmp>/era-supervised-Vnwk9x/pass-5` | succeeded | 3326 ms | `ev_b0b0184d6b9c0866…` |
| supervised-self:pass-6/22 | `rea analyze-javascript-application <tmp>/era-supervised-Vnwk9x/pass-6` | succeeded | 3443 ms | `ev_288b42478ea1172c…` |
| supervised-self:pass-7/22 | `rea analyze-javascript-application <tmp>/era-supervised-Vnwk9x/pass-7` | succeeded | 3249 ms | `ev_96666adb32f08d06…` |
| supervised-self:pass-8/22 | `rea analyze-javascript-application <tmp>/era-supervised-Vnwk9x/pass-8` | succeeded | 3228 ms | `ev_a26db102f72708fd…` |
| supervised-self:pass-9/22 | `rea analyze-javascript-application <tmp>/era-supervised-Vnwk9x/pass-9` | succeeded | 3456 ms | `ev_fc07e371b70f81fc…` |
| supervised-self:pass-10/22 | `rea analyze-javascript-application <tmp>/era-supervised-Vnwk9x/pass-10` | succeeded | 3321 ms | `ev_5df33526c85f66c1…` |
| supervised-self:pass-11/22 | `rea analyze-javascript-application <tmp>/era-supervised-Vnwk9x/pass-11` | succeeded | 3066 ms | `ev_c280942900aa830d…` |
| supervised-self:pass-12/22 | `rea analyze-javascript-application <tmp>/era-supervised-Vnwk9x/pass-12` | succeeded | 3355 ms | `ev_e3a57856c039c639…` |
| supervised-self:pass-13/22 | `rea analyze-javascript-application <tmp>/era-supervised-Vnwk9x/pass-13` | succeeded | 3371 ms | `ev_e9da8cd44c36528c…` |
| supervised-self:pass-14/22 | `rea analyze-javascript-application <tmp>/era-supervised-Vnwk9x/pass-14` | succeeded | 3379 ms | `ev_e8ae04e754b3b678…` |
| supervised-self:pass-15/22 | `rea analyze-javascript-application <tmp>/era-supervised-Vnwk9x/pass-15` | succeeded | 2405 ms | `ev_9b99a8074198a627…` |
| supervised-self:pass-16/22 | `rea analyze-javascript-application <tmp>/era-supervised-Vnwk9x/pass-16` | succeeded | 3351 ms | `ev_347b2f7c561a3619…` |
| supervised-self:pass-17/22 | `rea analyze-javascript-application <tmp>/era-supervised-Vnwk9x/pass-17` | succeeded | 3647 ms | `ev_755596ee15f6e342…` |
| supervised-self:pass-18/22 | `rea analyze-javascript-application <tmp>/era-supervised-Vnwk9x/pass-18` | succeeded | 3756 ms | `ev_e10d819c10ffe369…` |
| supervised-self:pass-19/22 | `rea analyze-javascript-application <tmp>/era-supervised-Vnwk9x/pass-19` | succeeded | 3477 ms | `ev_7b96f4d1f899526b…` |
| supervised-self:pass-20/22 | `rea analyze-javascript-application <tmp>/era-supervised-Vnwk9x/pass-20` | succeeded | 3480 ms | `ev_119bacc6f6f638a0…` |
| supervised-self:pass-21/22 | `rea analyze-javascript-application <tmp>/era-supervised-Vnwk9x/pass-21` | succeeded | 3399 ms | `ev_c90fa707f3f85830…` |
| supervised-self:pass-22/22 | `rea analyze-javascript-application <tmp>/era-supervised-Vnwk9x/pass-22` | succeeded | 3447 ms | `ev_eede0dcba7e51fa5…` |
| supervised-self:runtime-help | `rea capture-process <tmp>/era-supervised-Vnwk9x/help-scenario.json` | succeeded | 2120 ms | `ev_f11f29efd5619b6c…` |

- Candidate: self-20261014T123848-9fcff1 — 36 findings, startup 252 ms

| Step | REA command | Status | Duration | Evidence |
|---|---|---|---|---|
| supervised-self:pass-1/22 | `rea analyze-javascript-application <tmp>/era-supervised-cxPc4R/pass-1` | succeeded | 3192 ms | `ev_0c074d23f4b8442a…` |
| supervised-self:pass-2/22 | `rea analyze-javascript-application <tmp>/era-supervised-cxPc4R/pass-2` | succeeded | 3455 ms | `ev_c768bb281dbc9fa7…` |
| supervised-self:pass-3/22 | `rea analyze-javascript-application <tmp>/era-supervised-cxPc4R/pass-3` | succeeded | 3272 ms | `ev_ccd7bb7429498f5c…` |
| supervised-self:pass-4/22 | `rea analyze-javascript-application <tmp>/era-supervised-cxPc4R/pass-4` | succeeded | 3854 ms | `ev_0603ac18ca5e3340…` |
| supervised-self:pass-5/22 | `rea analyze-javascript-application <tmp>/era-supervised-cxPc4R/pass-5` | succeeded | 3182 ms | `ev_e16e3d724f3f1f2c…` |
| supervised-self:pass-6/22 | `rea analyze-javascript-application <tmp>/era-supervised-cxPc4R/pass-6` | succeeded | 3384 ms | `ev_4928c232f4bb80ff…` |
| supervised-self:pass-7/22 | `rea analyze-javascript-application <tmp>/era-supervised-cxPc4R/pass-7` | succeeded | 3260 ms | `ev_a70dd04e50097a6d…` |
| supervised-self:pass-8/22 | `rea analyze-javascript-application <tmp>/era-supervised-cxPc4R/pass-8` | succeeded | 3272 ms | `ev_4af7913b9a293d5f…` |
| supervised-self:pass-9/22 | `rea analyze-javascript-application <tmp>/era-supervised-cxPc4R/pass-9` | succeeded | 3414 ms | `ev_3f527c7d98f3256c…` |
| supervised-self:pass-10/22 | `rea analyze-javascript-application <tmp>/era-supervised-cxPc4R/pass-10` | succeeded | 3314 ms | `ev_7a0f971bac27c55c…` |
| supervised-self:pass-11/22 | `rea analyze-javascript-application <tmp>/era-supervised-cxPc4R/pass-11` | succeeded | 3023 ms | `ev_8d1eb6ef82242c15…` |
| supervised-self:pass-12/22 | `rea analyze-javascript-application <tmp>/era-supervised-cxPc4R/pass-12` | succeeded | 3317 ms | `ev_9c56ced63841b190…` |
| supervised-self:pass-13/22 | `rea analyze-javascript-application <tmp>/era-supervised-cxPc4R/pass-13` | succeeded | 3222 ms | `ev_a61e978899721d58…` |
| supervised-self:pass-14/22 | `rea analyze-javascript-application <tmp>/era-supervised-cxPc4R/pass-14` | succeeded | 3399 ms | `ev_ad32ed36ca766272…` |
| supervised-self:pass-15/22 | `rea analyze-javascript-application <tmp>/era-supervised-cxPc4R/pass-15` | succeeded | 2539 ms | `ev_96c3bb2a15af284d…` |
| supervised-self:pass-16/22 | `rea analyze-javascript-application <tmp>/era-supervised-cxPc4R/pass-16` | succeeded | 3383 ms | `ev_df6fa74854c00cd0…` |
| supervised-self:pass-17/22 | `rea analyze-javascript-application <tmp>/era-supervised-cxPc4R/pass-17` | succeeded | 3642 ms | `ev_d3220b51376ac8f4…` |
| supervised-self:pass-18/22 | `rea analyze-javascript-application <tmp>/era-supervised-cxPc4R/pass-18` | succeeded | 3731 ms | `ev_b72276388cb52aa2…` |
| supervised-self:pass-19/22 | `rea analyze-javascript-application <tmp>/era-supervised-cxPc4R/pass-19` | succeeded | 3521 ms | `ev_ffc32c56a3e603fc…` |
| supervised-self:pass-20/22 | `rea analyze-javascript-application <tmp>/era-supervised-cxPc4R/pass-20` | succeeded | 3424 ms | `ev_24cd81b0436828b1…` |
| supervised-self:pass-21/22 | `rea analyze-javascript-application <tmp>/era-supervised-cxPc4R/pass-21` | succeeded | 3495 ms | `ev_90caa1a14ec1dea6…` |
| supervised-self:pass-22/22 | `rea analyze-javascript-application <tmp>/era-supervised-cxPc4R/pass-22` | succeeded | 3527 ms | `ev_4413dd5c09426c88…` |
| supervised-self:runtime-help | `rea capture-process <tmp>/era-supervised-cxPc4R/help-scenario.json` | succeeded | 2113 ms | `ev_aea640331c449c38…` |

## Change

```
src/rea_integration/rea-client.js  | 27 ++++++++++-
 tests/control-plane-system.test.js | 94 ++++++++++++++++++++++++++++++++++++++
 2 files changed, 119 insertions(+), 2 deletions(-)
```
