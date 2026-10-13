# ERA self-analysis self-20261013T102937-4d1d63

- Artifact: npm pack tarball sha256 `39f637a67f2bfb02aeffb8453de38c4cb713535c9714c090da27943807168180` (29 files) + test suite, analyzed in 4 REA passes
- Modules recovered by REA: 37; semantic unknowns: 3704; `era --help` runtime: 296 ms

## REA executions

| Step | REA command | Status | Duration | Evidence |
|---|---|---|---|---|
| self-analysis:static-graph-1/4 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T102937-4d1d63/work/passes/pass-1` | succeeded | 7764 ms | `ev_2be9663ebd314fe9…` |
| self-analysis:static-graph-2/4 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T102937-4d1d63/work/passes/pass-2` | succeeded | 7726 ms | `ev_07237b23aa2d418d…` |
| self-analysis:static-graph-3/4 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T102937-4d1d63/work/passes/pass-3` | succeeded | 8020 ms | `ev_0f34117bf6809e57…` |
| self-analysis:static-graph-4/4 | `rea analyze-javascript-application <era-repo>/.era/self-analyses/self-20261013T102937-4d1d63/work/passes/pass-4` | succeeded | 8143 ms | `ev_e2dd01446c7bc875…` |
| self-analysis:runtime-help | `rea capture-process <era-repo>/.era/self-analyses/self-20261013T102937-4d1d63/help-scenario.json` | succeeded | 4516 ms | `ev_8635111a2522e23f…` |

## Findings (6)

| ID | Area (priority) | Rule | Title |
|---|---|---|---|
| F-1acab0d81c | orchestration (5) | high-fan-out | High local fan-out in src/cli.js (13 modules) |
| F-9658ff6752 | orchestration (5) | high-fan-out | High local fan-out in src/orchestration/cycle.js (11 modules) |
| F-27b0279da0 | test-coverage (10) | untested-module | No test module imports src/orchestration/cycle.js |
| F-790acff3b3 | test-coverage (10) | untested-module | No test module imports src/improvement/modification.js |
| F-8723fc0684 | test-coverage (10) | untested-module | No test module imports src/reporting/dashboard.js |
| F-c04c3002fa | test-coverage (10) | untested-module | No test module imports src/reporting/table.js |
