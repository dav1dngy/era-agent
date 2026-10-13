# ERA self-analysis self-20261013T150917-a22327

- Artifact: npm pack tarball sha256 `1b7475a4722bd969235441d3343a0cdef8eef5f0e15d7400ef05542f33f66ada` (40 files) + test suite, analyzed in 6 REA passes
- Modules recovered by REA: 43; semantic unknowns: 3581; `era --help` runtime: 211 ms

## REA executions

| Step | REA command | Status | Duration | Evidence |
|---|---|---|---|---|
| self-analysis:static-graph-1/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T150917-a22327/work/passes/pass-1` | succeeded | 6312 ms | `ev_fd7c4ccf10d352a2…` |
| self-analysis:static-graph-2/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T150917-a22327/work/passes/pass-2` | succeeded | 6046 ms | `ev_39748422d955eb40…` |
| self-analysis:static-graph-3/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T150917-a22327/work/passes/pass-3` | succeeded | 6054 ms | `ev_f494d603122a1b15…` |
| self-analysis:static-graph-4/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T150917-a22327/work/passes/pass-4` | succeeded | 6037 ms | `ev_533b50391c67909d…` |
| self-analysis:static-graph-5/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T150917-a22327/work/passes/pass-5` | succeeded | 6026 ms | `ev_baf7a79879aa4d00…` |
| self-analysis:static-graph-6/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T150917-a22327/work/passes/pass-6` | succeeded | 6227 ms | `ev_a15c1260f13a4a22…` |
| self-analysis:runtime-help | `rea capture-process <era-repo>/.era/self-analyses/self-20261013T150917-a22327/help-scenario.json` | succeeded | 2104 ms | `ev_c83284bae3c2afa9…` |

## Findings (27)

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
| F-70b18255b4 | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/orchestration.test.js is incomplete (resource_constraint) |
| F-7d6ca995fe | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/analysis.test.js is incomplete (resource_constraint) |
| F-7edf4652d9 | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of src/safety/secrets.js is incomplete (resource_constraint) |
| F-856e89c830 | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/cli.test.js is incomplete (resource_constraint) |
| F-96439c2af2 | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/fixtures/fake-rea-engine.mjs is incomplete (resource_constraint) |
| F-9af5b1dd8a | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/helpers.js is incomplete (resource_constraint) |
| F-cc8d64f3f8 | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/core.test.js is incomplete (resource_constraint) |
| F-da26357866 | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/agents.test.js is incomplete (resource_constraint) |
| F-dbc4ff8e2d | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/sandbox.test.js is incomplete (resource_constraint) |
| F-f47cb76ab7 | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/fixtures/fake-claude.mjs is incomplete (resource_constraint) |
| F-79b85988d7 | orchestration (5) | high-fan-out | High local fan-out in src/commands/info.js (10 modules) |
| F-9658ff6752 | orchestration (5) | high-fan-out | High local fan-out in src/orchestration/cycle.js (12 modules) |
| F-bc9c0440fd | error-handling (7) | spawn-without-error-listener | Child process spawned without an 'error' listener in tests/mcp.test.js |
