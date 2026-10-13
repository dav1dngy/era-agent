# ERA self-analysis self-20261013T095936-cdf446

- Artifact: npm pack tarball sha256 `bff60ffa0c07e2249483bf67851376a65d54c44506276f5b8fffe9e93b75f953` (29 files) + test suite
- Modules recovered by REA: 33; semantic unknowns: 4582; `era --help` runtime: 265 ms

## REA executions

| Step | REA command | Status | Duration | Evidence |
|---|---|---|---|---|
| self-analysis:static-graph | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T095936-cdf446/work/artifact/package` | succeeded | 7367 ms | `ev_ad9398b7a587eca9…` |
| self-analysis:runtime-help | `rea capture-process <era-repo>/.era/self-analyses/self-20261013T095936-cdf446/help-scenario.json` | succeeded | 2423 ms | `ev_49c011b48af845ab…` |

## Findings (7)

| ID | Area (priority) | Rule | Title |
|---|---|---|---|
| F-1026e8ec5f | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/self-analysis.test.js is incomplete (resource_constraint) |
| F-38486245a3 | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/evaluation.test.js is incomplete (resource_constraint) |
| F-39443e22ae | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/rea-client.test.js is incomplete (resource_constraint) |
| F-46215977a2 | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/safety.test.js is incomplete (resource_constraint) |
| F-92f014e1a8 | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/rea-integration.test.js is incomplete (resource_constraint) |
| F-1acab0d81c | orchestration (5) | high-fan-out | High local fan-out in src/cli.js (13 modules) |
| F-9658ff6752 | orchestration (5) | high-fan-out | High local fan-out in src/orchestration/cycle.js (11 modules) |
