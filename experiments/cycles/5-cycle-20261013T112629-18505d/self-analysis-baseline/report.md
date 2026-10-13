# ERA self-analysis self-20261013T145141-666c54

- Artifact: npm pack tarball sha256 `aabfcc38a0ba83e3ac76b725cb4e18c7e6824f86bbe45785a60a15bd5e733d00` (40 files) + test suite, analyzed in 6 REA passes
- Modules recovered by REA: 42; semantic unknowns: 3563; `era --help` runtime: 235 ms

## REA executions

| Step | REA command | Status | Duration | Evidence |
|---|---|---|---|---|
| self-analysis:static-graph-1/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T145141-666c54/work/passes/pass-1` | succeeded | 7856 ms | `ev_3d33cb4610929361…` |
| self-analysis:static-graph-2/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T145141-666c54/work/passes/pass-2` | succeeded | 5827 ms | `ev_dfd8a63ff3a43e9d…` |
| self-analysis:static-graph-3/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T145141-666c54/work/passes/pass-3` | succeeded | 6082 ms | `ev_fdd420d525fc102d…` |
| self-analysis:static-graph-4/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T145141-666c54/work/passes/pass-4` | succeeded | 5999 ms | `ev_a2787e33e9586ef2…` |
| self-analysis:static-graph-5/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T145141-666c54/work/passes/pass-5` | succeeded | 6204 ms | `ev_8438b12af7763208…` |
| self-analysis:static-graph-6/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T145141-666c54/work/passes/pass-6` | succeeded | 5904 ms | `ev_21b7e1a13bf20502…` |
| self-analysis:runtime-help | `rea capture-process <era-repo>/.era/self-analyses/self-20261013T145141-666c54/help-scenario.json` | succeeded | 2173 ms | `ev_6d1203edf64d7ba8…` |

## Findings (26)

| ID | Area (priority) | Rule | Title |
|---|---|---|---|
| F-089b18a478 | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of src/reporting/table.js is incomplete (resource_constraint) |
| F-20e04cb569 | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/self-analyze-passes.test.js is incomplete (resource_constraint) |
| F-31965c9749 | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of src/self_analysis/rules.js is incomplete (resource_constraint) |
| F-333e1a8039 | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of src/orchestration/versions.js is incomplete (resource_constraint) |
| F-361d8f6dee | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of src/rea_integration/rea-client.js is incomplete (resource_constraint) |
| F-38486245a3 | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/evaluation.test.js is incomplete (resource_constraint) |
| F-3c6cdb09ec | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of src/safety/policy.js is incomplete (resource_constraint) |
| F-4203a18d7e | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/e2e-lab.test.js is incomplete (resource_constraint) |
| F-43b880d6f4 | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of src/reporting/dashboard.js is incomplete (resource_constraint) |
| F-46215977a2 | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/safety.test.js is incomplete (resource_constraint) |
| F-541a478e02 | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of src/safety/sandbox.js is incomplete (resource_constraint) |
| F-5dd92e0c8a | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of src/self_analysis/self-analyze.js is incomplete (resource_constraint) |
| F-60d8c2e082 | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/fixtures/fake-codex.mjs is incomplete (resource_constraint) |
| F-6253ddf2b5 | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/fixtures/fake-rea.mjs is incomplete (resource_constraint) |
| F-7d6ca995fe | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/analysis.test.js is incomplete (resource_constraint) |
| F-7edf4652d9 | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of src/safety/secrets.js is incomplete (resource_constraint) |
| F-856e89c830 | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/cli.test.js is incomplete (resource_constraint) |
| F-96439c2af2 | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/fixtures/fake-rea-engine.mjs is incomplete (resource_constraint) |
| F-9af5b1dd8a | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/helpers.js is incomplete (resource_constraint) |
| F-cc8d64f3f8 | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/core.test.js is incomplete (resource_constraint) |
| F-d9da3c5ebc | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/mcp.test.js is incomplete (resource_constraint) |
| F-da26357866 | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/agents.test.js is incomplete (resource_constraint) |
| F-dbc4ff8e2d | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/sandbox.test.js is incomplete (resource_constraint) |
| F-f47cb76ab7 | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/fixtures/fake-claude.mjs is incomplete (resource_constraint) |
| F-79b85988d7 | orchestration (5) | high-fan-out | High local fan-out in src/commands/info.js (10 modules) |
| F-9658ff6752 | orchestration (5) | high-fan-out | High local fan-out in src/orchestration/cycle.js (12 modules) |
