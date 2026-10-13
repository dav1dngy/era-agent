# Release checklist

Every item must be checked by a maintainer. Nothing in this repository
publishes automatically.

## Before tagging

- [ ] `main` is clean and every intended Improvement Lab cycle is `integrated`
      or `declined` (`era status` shows no cycle in progress or awaiting approval).
- [ ] `npm ci && npm test` passes on macOS with REA installed (real-REA, MCP and
      sandbox tests ran, not skipped).
- [ ] `ERA_SKIP_REA=1 npm test` passes on Linux (CI `unit-linux`).
- [ ] `npm run lint` and `node scripts/check.mjs` pass.
- [ ] `npm audit --omit=dev --audit-level=high` reports nothing blocking, and
      `npm audit signatures` passes.
- [ ] `bash scripts/clean-install-test.sh` passes in a fresh directory.
- [ ] Benchmarks re-run on a quiet host: `era benchmark --versions … --repetitions 3`
      and `era benchmark --rea-baseline`. Tables in README/docs updated from the JSON.
- [ ] `node scripts/export-experiments.mjs` run; `experiments/` updated.
- [ ] Docs describe only verified behaviour; limitations and open findings are current.
- [ ] `CHANGELOG.md` has an entry for the version; `package.json` version bumped
      (semantic versioning: breaking CLI/config changes → minor while < 1.0).
- [ ] `THIRD_PARTY_NOTICES.md` regenerated (`node scripts/third-party-notices.mjs`)
      and REA's MIT notice intact.

## Repository hygiene

- [ ] Secret scan of the full history: `git log --all -p | grep -E 'gh[pousr]_|sk-ant-|AKIA|PRIVATE KEY'`
      shows nothing.
- [ ] No personal data you do not want public: commit author emails
      (`git log --format='%ae' | sort -u`) and absolute paths in evidence files.
- [ ] The target repository does not already exist, or you intend to push to it.
      Never force-push.

## Release

- [ ] Push the tag. The `Release validation` workflow builds the package, the
      CycloneDX SBOM and the provenance attestation. Download its artifacts.
- [ ] Create the GitHub release by hand from `CHANGELOG.md`, attaching the
      tarball and SBOM from the workflow artifacts.
- [ ] Verify the release page, README rendering and installation instructions.
