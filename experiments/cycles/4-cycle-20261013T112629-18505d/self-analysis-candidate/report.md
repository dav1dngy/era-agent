# ERA self-analysis self-20261013T114655-530455

- Artifact: npm pack tarball sha256 `3e22befaeeead210ee0c6ce03075607b1297a9e6ffbea782f3ea7aa40798bc98` (39 files) + test suite, analyzed in 6 REA passes
- Modules recovered by REA: 55; semantic unknowns: 5746; `era --help` runtime: 210 ms

## REA executions

| Step | REA command | Status | Duration | Evidence |
|---|---|---|---|---|
| self-analysis:static-graph-1/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T114655-530455/work/passes/pass-1` | succeeded | 3223 ms | `ev_9a3d3186908e491a…` |
| self-analysis:static-graph-2/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T114655-530455/work/passes/pass-2` | succeeded | 3572 ms | `ev_80d052252081d91d…` |
| self-analysis:static-graph-3/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T114655-530455/work/passes/pass-3` | succeeded | 3364 ms | `ev_2197ae334b0fde22…` |
| self-analysis:static-graph-4/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T114655-530455/work/passes/pass-4` | succeeded | 3224 ms | `ev_dd3b6f1dfdfcf28c…` |
| self-analysis:static-graph-5/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T114655-530455/work/passes/pass-5` | succeeded | 3733 ms | `ev_5f76793c7f9ccda3…` |
| self-analysis:static-graph-6/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T114655-530455/work/passes/pass-6` | succeeded | 2291 ms | `ev_f0cc7e6eaff63221…` |
| self-analysis:runtime-help | `rea capture-process <era-repo>/.era/self-analyses/self-20261013T114655-530455/help-scenario.json` | succeeded | 2024 ms | `ev_7bf04d3902d9fc28…` |

## Findings (7)

| ID | Area (priority) | Rule | Title |
|---|---|---|---|
| F-79b85988d7 | orchestration (5) | high-fan-out | High local fan-out in src/commands/info.js (10 modules) |
| F-9658ff6752 | orchestration (5) | high-fan-out | High local fan-out in src/orchestration/cycle.js (12 modules) |
| F-2c7f7ed193 | error-handling (7) | spawn-without-error-listener | Child process spawned without an 'error' listener in tests/e2e-lab.test.js |
| F-bc9c0440fd | error-handling (7) | spawn-without-error-listener | Child process spawned without an 'error' listener in tests/mcp.test.js |
| F-2fe456ef5b | test-coverage (10) | untested-module | No test module imports src/commands/lab.js |
| F-5907d881ba | test-coverage (10) | untested-module | No test module imports src/commands/info.js |
| F-e2748c026a | test-coverage (10) | untested-module | No test module imports src/commands/analysis.js |
