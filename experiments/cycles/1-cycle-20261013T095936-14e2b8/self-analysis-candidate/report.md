# ERA self-analysis self-20261013T101050-8fa562

- Artifact: npm pack tarball sha256 `17c597ba5d41b1c87280334a81a2670c511b3c3d4df55176989475cdc5dc7d80` (29 files) + test suite
- Modules recovered by REA: 31; semantic unknowns: 4641; `era --help` runtime: 314 ms

## REA executions

| Step | REA command | Status | Duration | Evidence |
|---|---|---|---|---|
| self-analysis:static-graph | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T101050-8fa562/work/artifact/package` | succeeded | 8275 ms | `ev_60973c1a05a3c2b4…` |
| self-analysis:runtime-help | `rea capture-process <era-repo>/.era/self-analyses/self-20261013T101050-8fa562/help-scenario.json` | succeeded | 7089 ms | `ev_1e4ea9c08fe40281…` |

## Findings (9)

| ID | Area (priority) | Rule | Title |
|---|---|---|---|
| F-1026e8ec5f | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/self-analysis.test.js is incomplete (resource_constraint) |
| F-38486245a3 | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/evaluation.test.js is incomplete (resource_constraint) |
| F-39443e22ae | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/rea-client.test.js is incomplete (resource_constraint) |
| F-46215977a2 | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/safety.test.js is incomplete (resource_constraint) |
| F-6253ddf2b5 | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/fixtures/fake-rea.mjs is incomplete (resource_constraint) |
| F-92f014e1a8 | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/rea-integration.test.js is incomplete (resource_constraint) |
| F-9af5b1dd8a | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/helpers.js is incomplete (resource_constraint) |
| F-1acab0d81c | orchestration (5) | high-fan-out | High local fan-out in src/cli.js (13 modules) |
| F-9658ff6752 | orchestration (5) | high-fan-out | High local fan-out in src/orchestration/cycle.js (11 modules) |
