# Contributing to ERA

Thanks for helping! ERA core is small and dependency-free apart from the REA engine; the optional Studio
client has its own desktop/UI dependencies.

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

## ERA Studio development

```bash
npm ci --prefix apps/studio
node bin/era.mjs studio app --dev
node --test tests/control-plane.test.js tests/studio-ui-model.test.js
npm run test:desktop --prefix apps/studio
npm run package --prefix apps/studio
npm run test:package --prefix apps/studio
node scripts/third-party-notices.mjs
```

The desktop test uses genuine Electron, Monaco, REA and project tests, with a clearly
simulated coding agent on disposable fixtures. It never approves a user's project.
Screenshots/results go to ignored `apps/studio/out/validation`. The package test runs
the generated app outside the repository with temporary state. Build from locked
sources; never include local state or credentials. Keep the CLI independent of UI
packages. See `docs/ERA_STUDIO_TESTING.md` for remaining validation gaps.
