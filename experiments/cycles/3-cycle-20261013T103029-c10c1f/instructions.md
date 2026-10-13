# ERA improvement proposal

Work only inside: <era-repo>/.era/worktrees/cycle-20261013T103029-c10c1f

## Finding (B-js-commonjs-app, analysis-accuracy)
Benchmark case js-commonjs-app scores F1 0.846

Missing facts: export:src/main.js#run, export:src/config.js#parseConfig, export:src/config.js#DEFAULT_ENDPOINT, export:src/net.js#fetchStatus; unexpected facts: none.


## Hypothesis
Improving ERA's interpretation of REA Evidence for js-commonjs-app raises benchmark accuracy. Missing facts: export:src/main.js#run, export:src/config.js#parseConfig, export:src/config.js#DEFAULT_ENDPOINT, export:src/net.js#fetchStatus; unexpected facts: none.

## Acceptance target
{"metric":"accuracy_f1","min_delta":0.01}

## Constraints
- Do not modify protected paths: src/safety/, src/evaluation/, src/self_analysis/rules.js, benchmarks/datasets/, benchmarks/acceptance.json, tests/safety.test.js, tests/evaluation.test.js, tests/self-analysis.test.js
- Keep `node --test tests/*.test.js` passing.
- Commit your change on the current branch when finished.
