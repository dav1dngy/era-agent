# ERA self-analysis self-20261013T101435-2d3119

- Artifact: npm pack tarball sha256 `f4c842526c4a110a5c4a768eabc1218586143c8b816e798a840f242e0651ff19` (29 files) + test suite
- Modules recovered by REA: 33; semantic unknowns: 4596; `era --help` runtime: 292 ms

## REA executions

| Step | REA command | Status | Duration | Evidence |
|---|---|---|---|---|
| self-analysis:static-graph | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T101435-2d3119/work/artifact/package` | succeeded | 7602 ms | `ev_10c3a6f81fdfada5…` |
| self-analysis:runtime-help | `rea capture-process <era-repo>/.era/self-analyses/self-20261013T101435-2d3119/help-scenario.json` | succeeded | 4769 ms | `ev_964f5b4cb8a9da1d…` |

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
