# ERA improvement cycle cycle-20261014T124035-5b4783

- Status: **awaiting-approval**
- Review: `git diff 0c98e0bb735e...experiment/cycle-20261014T124035-5b4783` or `change.patch`; then `era improve approve cycle-20261014T124035-5b4783` or `era improve decline cycle-20261014T124035-5b4783`
- Base: era-v4 (`0c98e0bb735e`), branch `experiment/cycle-20261014T124035-5b4783`
- Finding: F-4159faffc3 — No test module imports src/control_plane/services/system.js (test-coverage)
- Hypothesis: Adding a test that imports src/control_plane/services/system.js closes a coverage gap REA found in the import graph.
- Target: `{"metric":"finding_resolved","finding_id":"F-4159faffc3"}` → finding F-4159faffc3 absent in candidate REA self-analysis
- Decision: accepted: all guards pass and target met

## Guards

| Guard | Result | Detail |
|---|---|---|
| protected paths unchanged | pass | none changed |
| all tests pass | pass | 170 passed, 0 failed |
| no baseline test removed, skipped or broken | pass | 166 baseline tests still pass |
| no accuracy regression | pass | 0.9867 -> 0.9867 |
| no error-rate increase | pass | 0 -> 0 |
| no reliability regression | pass | 1 -> 1 |
| time regression ≤ 30% | pass | 90349 -> 90349 ms |
| memory regression ≤ 20% | pass | 56295424 -> 56229888 bytes |
| self-analysis findings not increased | pass | 37 -> 36 |
| self-analysis evidence valid (supervisor-run REA) | pass | plan from evaluated-code |
| self-analysis covers every source module | pass | complete |

## Benchmark comparison

| Metric | Baseline | Candidate |
|---|---|---|
| accuracy_f1 | 0.9867 | 0.9867 |
| precision | 0.9875 | 0.9875 |
| completeness_recall | 0.9867 | 0.9867 |
| total_median_wall_ms | 90349 | 90349 |
| total_median_extract_ms | 422 | 418 |
| total_median_cpu_s | 0.2000 | 0.1900 |
| max_rss_bytes | 56295424 | 56229888 |
| error_rate | 0 | 0 |
| reliability | 1 | 1 |
| rea_runs | 10 | 10 |
| tests passed | 166 | 170 |

## REA self-analysis

- Baseline: self-20261014T124035-39f286 — 37 findings, startup 253 ms

| Step | REA command | Status | Duration | Evidence |
|---|---|---|---|---|
| supervised-self:pass-1/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-JVXwgT/pass-1` | succeeded | 3503 ms | `ev_932b9467da3def65…` |
| supervised-self:pass-2/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-JVXwgT/pass-2` | succeeded | 3480 ms | `ev_97155d0a5d538c7a…` |
| supervised-self:pass-3/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-JVXwgT/pass-3` | succeeded | 3507 ms | `ev_7ce862cfcf641322…` |
| supervised-self:pass-4/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-JVXwgT/pass-4` | succeeded | 3807 ms | `ev_0c2948e333d7e750…` |
| supervised-self:pass-5/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-JVXwgT/pass-5` | succeeded | 3220 ms | `ev_4eaaca2a0f064e36…` |
| supervised-self:pass-6/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-JVXwgT/pass-6` | succeeded | 3382 ms | `ev_99fe840408f41edd…` |
| supervised-self:pass-7/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-JVXwgT/pass-7` | succeeded | 3204 ms | `ev_7b1a8eca13138caf…` |
| supervised-self:pass-8/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-JVXwgT/pass-8` | succeeded | 3139 ms | `ev_5c36504b183b57b5…` |
| supervised-self:pass-9/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-JVXwgT/pass-9` | succeeded | 3349 ms | `ev_a319e7732ecda955…` |
| supervised-self:pass-10/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-JVXwgT/pass-10` | succeeded | 3233 ms | `ev_f49bb758e277dafe…` |
| supervised-self:pass-11/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-JVXwgT/pass-11` | succeeded | 2952 ms | `ev_efdfb8b8bc899a82…` |
| supervised-self:pass-12/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-JVXwgT/pass-12` | succeeded | 3288 ms | `ev_52abf3fb904b930b…` |
| supervised-self:pass-13/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-JVXwgT/pass-13` | succeeded | 3274 ms | `ev_900b529cbc39c53a…` |
| supervised-self:pass-14/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-JVXwgT/pass-14` | succeeded | 3318 ms | `ev_2f96460e18af139f…` |
| supervised-self:pass-15/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-JVXwgT/pass-15` | succeeded | 2352 ms | `ev_4518b5013fbf12b7…` |
| supervised-self:pass-16/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-JVXwgT/pass-16` | succeeded | 3319 ms | `ev_46af4ad4169e2fd2…` |
| supervised-self:pass-17/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-JVXwgT/pass-17` | succeeded | 3574 ms | `ev_4929b4138fabcfd3…` |
| supervised-self:pass-18/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-JVXwgT/pass-18` | succeeded | 3707 ms | `ev_ad6a2e694e494ee6…` |
| supervised-self:pass-19/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-JVXwgT/pass-19` | succeeded | 3406 ms | `ev_02e3ee6e11dd734b…` |
| supervised-self:pass-20/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-JVXwgT/pass-20` | succeeded | 3421 ms | `ev_a4e3af96d550c261…` |
| supervised-self:pass-21/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-JVXwgT/pass-21` | succeeded | 3474 ms | `ev_03d35a18350a6f02…` |
| supervised-self:pass-22/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-JVXwgT/pass-22` | succeeded | 3467 ms | `ev_b6f65a245deaebed…` |
| supervised-self:runtime-help | `rea capture-process /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-JVXwgT/help-scenario.json` | succeeded | 2071 ms | `ev_3f49207acc2c024f…` |

- Candidate: self-20261014T124855-cb134f — 36 findings, startup 244 ms

| Step | REA command | Status | Duration | Evidence |
|---|---|---|---|---|
| supervised-self:pass-1/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-VdEpu3/pass-1` | succeeded | 3105 ms | `ev_49aa6b8e1d227ab0…` |
| supervised-self:pass-2/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-VdEpu3/pass-2` | succeeded | 3431 ms | `ev_e0a0deb65b27f410…` |
| supervised-self:pass-3/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-VdEpu3/pass-3` | succeeded | 3127 ms | `ev_879293ca274faa8f…` |
| supervised-self:pass-4/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-VdEpu3/pass-4` | succeeded | 3764 ms | `ev_6d2d37d9bfaa5f40…` |
| supervised-self:pass-5/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-VdEpu3/pass-5` | succeeded | 3140 ms | `ev_2486de6c7ca0bac8…` |
| supervised-self:pass-6/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-VdEpu3/pass-6` | succeeded | 3347 ms | `ev_61656ec1aff36e38…` |
| supervised-self:pass-7/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-VdEpu3/pass-7` | succeeded | 3149 ms | `ev_914e7e49b149607a…` |
| supervised-self:pass-8/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-VdEpu3/pass-8` | succeeded | 3119 ms | `ev_3c62ff65381fdb4a…` |
| supervised-self:pass-9/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-VdEpu3/pass-9` | succeeded | 3284 ms | `ev_1a5ce2fe4e60d036…` |
| supervised-self:pass-10/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-VdEpu3/pass-10` | succeeded | 3181 ms | `ev_5cdbcdd2944784f7…` |
| supervised-self:pass-11/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-VdEpu3/pass-11` | succeeded | 2929 ms | `ev_87b5e029e3fff275…` |
| supervised-self:pass-12/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-VdEpu3/pass-12` | succeeded | 3228 ms | `ev_6fed43aae7a3099a…` |
| supervised-self:pass-13/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-VdEpu3/pass-13` | succeeded | 3236 ms | `ev_2231f3e33f3257ad…` |
| supervised-self:pass-14/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-VdEpu3/pass-14` | succeeded | 3250 ms | `ev_cf1a105db43962ce…` |
| supervised-self:pass-15/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-VdEpu3/pass-15` | succeeded | 2451 ms | `ev_80c2a95982e0f396…` |
| supervised-self:pass-16/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-VdEpu3/pass-16` | succeeded | 3267 ms | `ev_81ebdf606c454409…` |
| supervised-self:pass-17/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-VdEpu3/pass-17` | succeeded | 3516 ms | `ev_b851992d86d4a506…` |
| supervised-self:pass-18/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-VdEpu3/pass-18` | succeeded | 3691 ms | `ev_513ec11db1abde28…` |
| supervised-self:pass-19/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-VdEpu3/pass-19` | succeeded | 3344 ms | `ev_2727305302e70c38…` |
| supervised-self:pass-20/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-VdEpu3/pass-20` | succeeded | 3414 ms | `ev_5d8e03ff2d69b119…` |
| supervised-self:pass-21/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-VdEpu3/pass-21` | succeeded | 3375 ms | `ev_42db3afea5d16137…` |
| supervised-self:pass-22/22 | `rea analyze-javascript-application /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-VdEpu3/pass-22` | succeeded | 3424 ms | `ev_4ed477e1333405c9…` |
| supervised-self:runtime-help | `rea capture-process /private/var/folders/qs/62vwljv134s880r5cx9mbnlc0000gn/T/era-supervised-VdEpu3/help-scenario.json` | succeeded | 2083 ms | `ev_56ca088b58044472…` |

## Change

```
src/rea_integration/rea-client.js  | 27 ++++++++++-
 tests/control-plane-system.test.js | 94 ++++++++++++++++++++++++++++++++++++++
 2 files changed, 119 insertions(+), 2 deletions(-)
```
