# E3 (rejected): overlap module loading with fixPath and prewarm the REA probe

Hypothesis (REA + source evidence): `apps/studio/electron/main.cjs` runs `fixPath()` (a ~780 ms `zsh -ilc`, measured) and the
four ERA module imports strictly in series, and the first `/api/overview` pays a full `rea providers` probe. Overlapping the
imports with fixPath and starting the probe right after the control plane starts should shorten the time to a rendered shell.

Not run through the Improvement Lab: the Lab's REA self-analysis covers the packed CLI (`src/`, `bin/`), not `apps/studio/`,
and its protected acceptance metrics cannot see Electron-shell code. Evaluated manually with the same harness instead.

Result (`experiments/studio-baseline/measure.mjs --n 10 --only electron`, AC power, same machine state, `--smoke` wall time):

| Variant | median | mean | p95 (=max, n=10) |
|---|---|---|---|
| Baseline commit 68f0f20 (results-ab-baseline-commit-AC.json) | 4336 ms | 4705 | 7962 |
| After E1+E2 (results-before-E3.json) | 3103 ms | 3418 | 5793 |
| After E1+E2+E3 (results-after-E3.json) | 3099 ms | 3102 | 4157 |

Median unchanged (3103 -> 3099 ms); the mean and p95 differences are within the run-to-run noise seen here (individual runs
vary by >2 s). **No effect demonstrated, so the change was reverted** (`E3-electron-startup-rejected.patch`). The smoke test
measures to a rendered shell plus one API call; it does not isolate time-to-first-paint, which was not measured.
