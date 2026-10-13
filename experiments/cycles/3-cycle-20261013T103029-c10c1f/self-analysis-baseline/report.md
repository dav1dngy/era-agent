# ERA self-analysis self-20261013T103029-a610cc

- Artifact: npm pack tarball sha256 `39f637a67f2bfb02aeffb8453de38c4cb713535c9714c090da27943807168180` (29 files) + test suite, analyzed in 4 REA passes
- Modules recovered by REA: 37; semantic unknowns: 3704; `era --help` runtime: 315 ms

## REA executions

| Step | REA command | Status | Duration | Evidence |
|---|---|---|---|---|
| self-analysis:static-graph-1/4 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T103029-a610cc/work/passes/pass-1` | succeeded | 7407 ms | `ev_7d0a744f1460e79e…` |
| self-analysis:static-graph-2/4 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T103029-a610cc/work/passes/pass-2` | succeeded | 7377 ms | `ev_dc7d4fa7349624ee…` |
| self-analysis:static-graph-3/4 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T103029-a610cc/work/passes/pass-3` | succeeded | 5872 ms | `ev_50dc6e0c203eedb6…` |
| self-analysis:static-graph-4/4 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T103029-a610cc/work/passes/pass-4` | succeeded | 5765 ms | `ev_aa8fb5f3d1ca36c3…` |
| self-analysis:runtime-help | `rea capture-process <era-repo>/.era/self-analyses/self-20261013T103029-a610cc/help-scenario.json` | succeeded | 2657 ms | `ev_892bc9d89764aaee…` |

## Findings (6)

| ID | Area (priority) | Rule | Title |
|---|---|---|---|
| F-1acab0d81c | orchestration (5) | high-fan-out | High local fan-out in src/cli.js (13 modules) |
| F-9658ff6752 | orchestration (5) | high-fan-out | High local fan-out in src/orchestration/cycle.js (11 modules) |
| F-27b0279da0 | test-coverage (10) | untested-module | No test module imports src/orchestration/cycle.js |
| F-790acff3b3 | test-coverage (10) | untested-module | No test module imports src/improvement/modification.js |
| F-8723fc0684 | test-coverage (10) | untested-module | No test module imports src/reporting/dashboard.js |
| F-c04c3002fa | test-coverage (10) | untested-module | No test module imports src/reporting/table.js |
