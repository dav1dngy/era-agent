# Contributing to ERA

Thanks for helping! ERA is small and dependency-free apart from the REA engine.

## Development setup

```bash
npm install
npm test                 # unit + REA integration tests (integration skips without REA)
ERA_SKIP_REA=1 npm test  # unit tests only
npm run lint             # ESLint
node scripts/check.mjs   # syntax check + secret scan
bash scripts/clean-install-test.sh   # installation from a packed tarball
```

See docs/testing.md for which tests use the real REA engine and which use fakes.

## Ground rules

* **Do not fabricate.** Every analysis fact must come from a recorded REA
  execution. Benchmarks and reports must contain only measured values.
* **Protected paths** (`src/safety/`, `src/evaluation/`,
  `src/self_analysis/rules.js`, `benchmarks/datasets/`,
  `benchmarks/acceptance.json` and their tests) define how ERA judges itself.
  Changes there are welcome through normal pull requests, but they must never be
  made by an automated improvement cycle, and changes to acceptance criteria
  need a written rationale.
* Keep REA untouched. Upstream REA issues belong at <https://github.com/morluto/rea>.
* Only analyze software you are authorized to analyze. Fixtures must be authored
  for this repository.
* Match the surrounding style: ESM, `node:` built-ins, small modules,
  `node:test` tests.

## Pull requests

1. Add or update tests.
2. Run `npm test`, `npm run lint` and `node scripts/check.mjs`.
3. If behaviour changes, run `era benchmark` and include the table.
4. Update `CHANGELOG.md`.
