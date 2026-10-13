# ERA self-analysis self-20261013T150323-e9d1ed

- Artifact: npm pack tarball sha256 `1ec8424a87c0846a14488e65b89a3f2daa353430ded70b48b8a1729f7a5db940` (40 files) + test suite, analyzed in 6 REA passes
- Modules recovered by REA: 56; semantic unknowns: 5917; `era --help` runtime: 212 ms

## REA executions

| Step | REA command | Status | Duration | Evidence |
|---|---|---|---|---|
| self-analysis:static-graph-1/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T150323-e9d1ed/work/passes/pass-1` | succeeded | 3280 ms | `ev_ae6326975d921193…` |
| self-analysis:static-graph-2/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T150323-e9d1ed/work/passes/pass-2` | succeeded | 3627 ms | `ev_b302ad130be40c76…` |
| self-analysis:static-graph-3/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T150323-e9d1ed/work/passes/pass-3` | succeeded | 3324 ms | `ev_08c8cad5cd28114d…` |
| self-analysis:static-graph-4/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T150323-e9d1ed/work/passes/pass-4` | succeeded | 3295 ms | `ev_c3f1a75490476e19…` |
| self-analysis:static-graph-5/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T150323-e9d1ed/work/passes/pass-5` | succeeded | 3804 ms | `ev_a245f1a7cafab674…` |
| self-analysis:static-graph-6/6 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T150323-e9d1ed/work/passes/pass-6` | succeeded | 2509 ms | `ev_5b54f8a3cc327d41…` |
| self-analysis:runtime-help | `rea capture-process <era-repo>/.era/self-analyses/self-20261013T150323-e9d1ed/help-scenario.json` | succeeded | 2078 ms | `ev_8dffce2776107fa6…` |

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
