# ERA self-analysis self-20261013T151801-8a1d2a

- Artifact: npm pack tarball sha256 `b2f204b2856dbff05c1e893c771841926dbb26f44ddf2294f8f734626954c96b` (40 files) + test suite, analyzed in 6 REA passes
- Modules recovered by REA: 56; semantic unknowns: 5917; `era --help` runtime: 213 ms

## REA executions

| Step | REA command | Status | Duration | Evidence |
|---|---|---|---|---|
| self-analysis:static-graph-1/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T151801-8a1d2a/work/passes/pass-1` | succeeded | 3596 ms | `ev_b3e429518b204c1c…` |
| self-analysis:static-graph-2/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T151801-8a1d2a/work/passes/pass-2` | succeeded | 3697 ms | `ev_c1ef7f620ebf11e5…` |
| self-analysis:static-graph-3/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T151801-8a1d2a/work/passes/pass-3` | succeeded | 3344 ms | `ev_2010b81175bb57ee…` |
| self-analysis:static-graph-4/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T151801-8a1d2a/work/passes/pass-4` | succeeded | 3260 ms | `ev_405a6d0d372f1c7a…` |
| self-analysis:static-graph-5/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T151801-8a1d2a/work/passes/pass-5` | succeeded | 3786 ms | `ev_2f55ddb0a7a78dec…` |
| self-analysis:static-graph-6/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T151801-8a1d2a/work/passes/pass-6` | succeeded | 2523 ms | `ev_75ba1b3cf1c19bd2…` |
| self-analysis:runtime-help | `rea capture-process <era-repo>/.era/self-analyses/self-20261013T151801-8a1d2a/help-scenario.json` | succeeded | 2121 ms | `ev_4db603c82874ce72…` |

## Findings (9)

| ID | Area (priority) | Rule | Title |
|---|---|---|---|
| F-79b85988d7 | orchestration (5) | high-fan-out | High local fan-out in src/commands/info.js (10 modules) |
| F-9658ff6752 | orchestration (5) | high-fan-out | High local fan-out in src/orchestration/cycle.js (12 modules) |
| F-58e0ea7c53 | code-quality (6) | unreachable-module | Module not reachable from the CLI entrypoint: src/core/watchdog.mjs |
| F-2c7f7ed193 | error-handling (7) | spawn-without-error-listener | Child process spawned without an 'error' listener in tests/e2e-lab.test.js |
| F-bc9c0440fd | error-handling (7) | spawn-without-error-listener | Child process spawned without an 'error' listener in tests/mcp.test.js |
| F-2fe456ef5b | test-coverage (10) | untested-module | No test module imports src/commands/lab.js |
| F-5907d881ba | test-coverage (10) | untested-module | No test module imports src/commands/info.js |
| F-8e844c0b5b | test-coverage (10) | untested-module | No test module imports src/core/watchdog.mjs |
| F-e2748c026a | test-coverage (10) | untested-module | No test module imports src/commands/analysis.js |
