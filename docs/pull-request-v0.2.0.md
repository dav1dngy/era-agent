# Pull request: ERA v0.2.0 (release candidate 1)

> **Prepared, not opened.** Nothing was pushed. The branch `feature/era-v0.2.0` exists locally with every commit after `52dcf82` (the remote branch) not yet on GitHub.
> Do not push or open this pull request without deciding the history question in [release-notes-v0.2.0.md](release-notes-v0.2.0.md#9-before-this-can-be-published).

**Base:** `main` (v0.1.0) · **Head:** `feature/era-v0.2.0` @ `the tip of the branch (tested code: `58c8fa7`)` · **Version:** `0.2.0-rc.1` (becomes `0.2.0` only at release)

## Summary

Adds ERA Studio (desktop and browser workbench), Project Lab (Review, Modify, Rebuild with approval and rollback) and Multi-Agent Engineering to ERA, on top of the
unchanged REA engine. Includes the fixes for an independent security and quality audit, real documentation and screenshots, and release-preparation tooling. The v0.1.0 CLI,
`era rea …` passthrough and MCP keep working.

## What to review, in this order

1. `docs/release-notes-v0.2.0.md`, `docs/SUPPORT_AND_VALIDATION.md`, `docs/ERA_V020_REMEDIATION.md`: claims, evidence and limits.
2. Security-sensitive code: `src/project_lab/{modify,rebuild,lab,context,exposure,workspace}.js` (final-state verification, manifest rollback, per-invocation exposure),
   `src/safety/{sandbox,candidate-sandbox}.js` (**protected paths**, changed manually, see the remediation note), `src/control_plane/{server,jobs}.js` and `services/{workbench,docs}.js`.
3. `apps/studio/` (the UI, `scripts/` for the desktop tests and the screenshot process).
4. The regression tests that reproduce each audit finding: `tests/audit-remediation.test.js`, `tests/audit-control-plane.test.js`.

## Test plan (results in the release notes)

- [x] `npm run lint`, `npm run check`, `npm run check:history`
- [x] `npm test` (real REA, MCP, sandbox and the Improvement Lab end to end; scripted agents)
- [x] `npm run test:desktop --prefix apps/studio` (real Electron; coding agent simulated)
- [x] `npm run package` and `npm run test:package` (unsigned arm64 app); the extracted archive launched from another folder
- [x] `bash scripts/external-user-validation.sh` (fresh clone, scrubbed environment, 23 steps)
- [x] `npm run clean-install-test`, `npm audit` (root clean; Studio: two documented LOW advisories), `npm audit signatures`
- [ ] hosted CI (the new `studio-desktop-macos` job has never run on a hosted runner)
- [ ] independent re-review of the audit fixes
- [ ] real Claude Code and `claude+codex` validation (needs sign-in and your authorization)

## Risks

* **Unsigned desktop build.** Do not describe it as a production release. No signed or notarized artifact exists.
* **Protected paths changed by hand** (`src/safety/`, `src/evaluation/`): the sandbox now denies signalling and home/temp reads; four evaluation call sites got explicit read allowances. A real Lab cycle was run on the final code to confirm the Lab still works.
* **Improvement Lab capacity:** the self-analysis pass size changed from 50 KB to 60 KB to fit the 50-run REA cap; the cap itself was not changed.
* **History:** three unpublished commits contain a local filesystem path (see the release notes).
* **Size:** 41 commits against `main` (43 since the v0.1.0 tag), 437 files, about 79k added lines (a large part is evidence under `experiments/` and screenshots under `docs/assets/`). A squash merge keeps `main` readable.

## Commands (not run)

```bash
git push -u origin feature/era-v0.2.0          # publishes the history; decide the history question first
gh pr create --base main --head feature/era-v0.2.0 --title "ERA v0.2.0 (release candidate 1)" --body-file docs/pull-request-v0.2.0.md
```
