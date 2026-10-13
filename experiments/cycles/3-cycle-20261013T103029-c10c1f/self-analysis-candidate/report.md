# ERA self-analysis self-20261013T104238-c18e7b

- Artifact: npm pack tarball sha256 `de51450af37bb0e4f4dd3b05df136cba9c8a741190cc9b87f63ae3b3fddb91a7` (29 files) + test suite, analyzed in 4 REA passes
- Modules recovered by REA: 37; semantic unknowns: 3747; `era --help` runtime: 265 ms

## REA executions

| Step | REA command | Status | Duration | Evidence |
|---|---|---|---|---|
| self-analysis:static-graph-1/4 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T104238-c18e7b/work/passes/pass-1` | succeeded | 5568 ms | `ev_318759a0f9728ed6…` |
| self-analysis:static-graph-2/4 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T104238-c18e7b/work/passes/pass-2` | succeeded | 5469 ms | `ev_2b89299e50b3df23…` |
| self-analysis:static-graph-3/4 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T104238-c18e7b/work/passes/pass-3` | succeeded | 5418 ms | `ev_7f64b9af05a6a957…` |
| self-analysis:static-graph-4/4 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T104238-c18e7b/work/passes/pass-4` | succeeded | 5483 ms | `ev_26915f6ddd967655…` |
| self-analysis:runtime-help | `rea capture-process <era-repo>/.era/self-analyses/self-20261013T104238-c18e7b/help-scenario.json` | succeeded | 2809 ms | `ev_8cac22f444c5305c…` |

## Findings (5)

| ID | Area (priority) | Rule | Title |
|---|---|---|---|
| F-20e04cb569 | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/self-analyze-passes.test.js is incomplete (resource_constraint) |
| F-6253ddf2b5 | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/fixtures/fake-rea.mjs is incomplete (resource_constraint) |
| F-9af5b1dd8a | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/helpers.js is incomplete (resource_constraint) |
| F-1acab0d81c | orchestration (5) | high-fan-out | High local fan-out in src/cli.js (13 modules) |
| F-9658ff6752 | orchestration (5) | high-fan-out | High local fan-out in src/orchestration/cycle.js (11 modules) |
