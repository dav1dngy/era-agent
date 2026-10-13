# ERA self-analysis self-20261013T112629-261b01

- Artifact: npm pack tarball sha256 `a8e63746d78354d1fbe6c6a01a2b8caa181cd9e43cd511833da7baf25fb9dae0` (39 files) + test suite, analyzed in 6 REA passes
- Modules recovered by REA: 42; semantic unknowns: 3514; `era --help` runtime: 272 ms

## REA executions

| Step | REA command | Status | Duration | Evidence |
|---|---|---|---|---|
| self-analysis:static-graph-1/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T112629-261b01/work/passes/pass-1` | succeeded | 6923 ms | `ev_23a222980dd911ee…` |
| self-analysis:static-graph-2/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T112629-261b01/work/passes/pass-2` | succeeded | 6239 ms | `ev_f9b8cf9f9bea85e7…` |
| self-analysis:static-graph-3/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T112629-261b01/work/passes/pass-3` | succeeded | 6000 ms | `ev_52ec93e3a8e96e8e…` |
| self-analysis:static-graph-4/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T112629-261b01/work/passes/pass-4` | succeeded | 5892 ms | `ev_85a8e187d7870810…` |
| self-analysis:static-graph-5/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T112629-261b01/work/passes/pass-5` | succeeded | 6007 ms | `ev_fe1ee303f2052019…` |
| self-analysis:static-graph-6/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T112629-261b01/work/passes/pass-6` | succeeded | 5960 ms | `ev_baac17163bec6ef9…` |
| self-analysis:runtime-help | `rea capture-process <era-repo>/.era/self-analyses/self-20261013T112629-261b01/help-scenario.json` | succeeded | 2297 ms | `ev_88fb4f7b761df88f…` |

## Findings (26)

| ID | Area (priority) | Rule | Title |
|---|---|---|---|
| F-089b18a478 | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of src/reporting/table.js is incomplete (resource_constraint) |
| F-31965c9749 | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of src/self_analysis/rules.js is incomplete (resource_constraint) |
| F-361d8f6dee | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of src/rea_integration/rea-client.js is incomplete (resource_constraint) |
| F-38486245a3 | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/evaluation.test.js is incomplete (resource_constraint) |
| F-39443e22ae | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/rea-client.test.js is incomplete (resource_constraint) |
| F-3c6cdb09ec | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of src/safety/policy.js is incomplete (resource_constraint) |
| F-4203a18d7e | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/e2e-lab.test.js is incomplete (resource_constraint) |
| F-43b880d6f4 | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of src/reporting/dashboard.js is incomplete (resource_constraint) |
| F-46215977a2 | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/safety.test.js is incomplete (resource_constraint) |
| F-541a478e02 | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of src/safety/sandbox.js is incomplete (resource_constraint) |
| F-5dd92e0c8a | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of src/self_analysis/self-analyze.js is incomplete (resource_constraint) |
| F-60d8c2e082 | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/fixtures/fake-codex.mjs is incomplete (resource_constraint) |
| F-6253ddf2b5 | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/fixtures/fake-rea.mjs is incomplete (resource_constraint) |
| F-70b18255b4 | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/orchestration.test.js is incomplete (resource_constraint) |
| F-7805106064 | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/observability.test.js is incomplete (resource_constraint) |
| F-7d6ca995fe | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/analysis.test.js is incomplete (resource_constraint) |
| F-7edf4652d9 | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of src/safety/secrets.js is incomplete (resource_constraint) |
| F-856e89c830 | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/cli.test.js is incomplete (resource_constraint) |
| F-96439c2af2 | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/fixtures/fake-rea-engine.mjs is incomplete (resource_constraint) |
| F-9af5b1dd8a | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/helpers.js is incomplete (resource_constraint) |
| F-cc8d64f3f8 | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/core.test.js is incomplete (resource_constraint) |
| F-da26357866 | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/agents.test.js is incomplete (resource_constraint) |
| F-f47cb76ab7 | analysis-accuracy (1) | incomplete-analysis-coverage | REA analysis of tests/fixtures/fake-claude.mjs is incomplete (resource_constraint) |
| F-79b85988d7 | orchestration (5) | high-fan-out | High local fan-out in src/commands/info.js (10 modules) |
| F-9658ff6752 | orchestration (5) | high-fan-out | High local fan-out in src/orchestration/cycle.js (12 modules) |
| F-bc9c0440fd | error-handling (7) | spawn-without-error-listener | Child process spawned without an 'error' listener in tests/mcp.test.js |
