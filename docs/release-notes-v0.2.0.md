# ERA v0.2.0

> **Released as v0.2.0.** The first version with ERA Studio, Project Lab and Multi-Agent Engineering. **v0.1.0 remains available** and unchanged. The desktop app is an **unsigned development build** and is **not attached**
> to this release; build it from source. Release commit: see the tag `v0.2.0`; the code was validated at `58c8fa7` and approved at `c4304f1`, and only the version number and release documentation changed after that.
> Hosted CI results are on [pull request #1](https://github.com/dav1dngy/era-agent/pull/1).

ERA is an open-source reverse-engineering agent built on the original [Reverse Engineer Anything (REA)](https://github.com/morluto/rea) engine. v0.2.0 is the first
version that contains **ERA Studio**, **Project Lab** and **Multi-Agent Engineering**. REA is unchanged (`rea-agents@6.4.0`, an unmodified dependency); everything
reverse-engineering related still comes from recorded REA executions.

## 1. What is new since v0.1.0

43 commits and 437 files (about 79,000 added lines, a large part being evidence under `experiments/` and screenshots under `docs/assets/`) since v0.1.0: `src/` +6,980 lines, `apps/studio/` 46 files, `tests/` 53 files, `docs/` 38 files.

| Area | What you get | Where |
|---|---|---|
| **ERA Studio** | A desktop (Electron) and browser workbench over the same backend as the CLI: dashboard, projects, REA analysis with evidence and structure, Monaco editor and side-by-side diff viewer, Git status, sandboxed terminal, Agent Command Center, Improvement Lab view, settings, and an offline **Documentation** section. | [Studio guide](ERA_STUDIO.md), [screenshots](assets/screenshots/README.md) |
| **Project Lab** | **Review** (read-only findings with evidence), **Modify** (isolated change, baseline, regression detection, a verified diff you approve) and **Rebuild** (reconstruct stated behavior of an authorized reference, including screenshot-to-website with visual scoring). Approval applies exactly the verified diff; rollback is refused if it would destroy later work. | [Project Lab](project-lab.md) |
| **Multi-Agent Engineering** | Architect, implementer and reviewer roles over Codex, Claude Code and custom command agents; presets; per-project consent; dollar caps where an agent reports cost; exposure filtering re-checked before every agent run; bounded correction rounds. | [Multi-agent](multi-agent.md), [providers](provider-configuration.md) |
| **Improvement Lab** | Unchanged workflow; its sandbox and read allowances were hardened, and its self-analysis pass size was raised from 50 KB to 60 KB so a cycle fits the 50-run REA cap again. Two Studio-backend improvements were accepted by the Lab in this cycle (REA status cache, faster job shutdown). | [Improvement Lab](improvement-lab.md), [Phase 3B](ERA_STUDIO_SELF_IMPROVEMENT.md) |
| **Security** | The independent audit's five HIGH, eight MEDIUM and three LOW findings were fixed or documented, each with a regression test that fails on the old code. | [remediation](ERA_V020_REMEDIATION.md) |
| **CLI and MCP** | All v0.1.0 commands and `era rea …` passthrough (including `era rea mcp`) keep working; new commands: `project …`, `studio …`, `agents`. | [README](../README.md) |

## 2. Install

Pick one ([installation](installation.md)): ERA with Studio (`main` or the tag `v0.2.0`), the CLI only (the tarball attached to this release), or a **locally built unsigned macOS app**.

```bash
git clone --branch v0.2.0 https://github.com/dav1dngy/era-agent.git && cd era-agent
npm ci && npm ci --prefix apps/studio
node bin/era.mjs studio doctor && node bin/era.mjs studio app
```

**Desktop app (macOS).** The only validated platform is macOS on Apple silicon. The app is an **unsigned, un-notarized development build**: there is no Developer ID signature,
no notarization and no auto-updater, and no signed production release exists. Build it with `npm run package --prefix apps/studio`; see [installation](installation.md#era-studio-desktop-application-macos) for the steps and the Gatekeeper note. Gatekeeper behavior was not verified on a clean machine.

## 3. Verified

Run on 2026-10-15 on macOS 27.0.1 arm64 (Apple M1), Node 24.20.0, Electron 44.7.1, REA 6.4.0, tested code revision `58c8fa7`:

| Check | Result | Real or mocked |
|---|---|---|
| `npm run lint`, `npm run check` | pass; 637 tracked files scanned | static |
| `npm test` | **345 tests: 344 pass, 0 fail, 1 skipped** (153 s); the skip is the "runtime without a sandbox" test, which cannot run on macOS | real git, processes, sandbox, REA and MCP; the Lab end-to-end suite uses a fake engine; coding agents are scripted |
| `npm run test:desktop --prefix apps/studio` | **17 of 17 scenario groups pass** | real Electron, control plane and REA; coding agent is a stand-in |
| `npm run package` and `npm run test:package` | pass: unsigned arm64 app, `ok:true`, renderer without Node, REA reachable, loopback only | real |
| the **extracted zip** launched from another folder | pass (`--smoke`, same checks) | real |
| `scripts/external-user-validation.sh` | **23 of 23 steps**: fresh clone, scrubbed environment, install, provider configuration, Studio, REA analysis, Project Lab task, diff, tests, approve, roll back, reject | real; scripted agent; clones the local checkout |
| `npm run clean-install-test` | pass: the packed CLI analyzed a fixture (15 facts) with its own REA | real |
| A real Improvement Lab cycle on the final sandbox code | accepted by the Lab (all guards pass, 178 tests); evidence in `experiments/remediation/` | real REA and sandbox, throwaway clone, not approved |
| `npm audit --omit=dev` | root: 0 vulnerabilities; Studio: 2 low (documented) | advisory database |
| `npm audit signatures` | pass | registry |

Two failures occurred on the way and were fixed rather than skipped: the Lab end-to-end test failed because the self-analysis needed 52 REA runs against a cap of 50 (pass size raised from 50 KB to 60 KB, cap unchanged), and the
documentation test caught a link to these missing release notes.

What is real, mocked, historical or unverified, per area and revision: [SUPPORT_AND_VALIDATION.md](SUPPORT_AND_VALIDATION.md).

## 4. Desktop application validation

The Electron scenarios launch the real application, authenticate through the injected token, open real projects, run real REA analyses and show real results, run
the project's own tests, show the diff, enforce the approval dialog, apply and roll back, and label unavailable and simulated providers. **The coding agent in those
scenarios is a scripted stand-in**; no model was called and the "coding-agent execution" shown is that stand-in's. Real Codex runs are recorded in
[provider-validation.md](provider-validation.md) (historical); Claude Code was never validated against the real CLI. The package build is launched from outside the
repository by `npm run test:package`, and an archive of it was extracted and launched from a different folder.

## 5. Independent audit

| | Audit of `e62fe70` | Now |
|---|---|---|
| HIGH (5) | approval of protected-file changes, rollback destroying later work, stale exposure filtering, Git configuration execution, sandbox signalling and reads | all fixed with failing-before regression tests |
| MEDIUM (8) | server crash, terminal revocation, working-copy terminal, CI, install instructions, status claims, in-app help, evidence reproducibility | all fixed; CI is **not yet run on a hosted runner** |
| LOW (3) | screenshots, palette keyboard behavior, DOMPurify advisories | fixed, fixed, and a documented exception tied to the shipped bundle |

The fixes were **not re-reviewed by an independent party**. Details, limits and the defects found afterwards: [ERA_V020_REMEDIATION.md](ERA_V020_REMEDIATION.md).

## 6. Security and privacy summary

* **Secrets and personal data:** `npm run check` scans every tracked file; `npm run check:history` scans every added line in every branch. Result for this candidate: 79 commits, one identity (the GitHub no-reply address), no credentials, no foreign e-mail addresses; 3 synthetic credential-shaped values under `tests/` (counted separately); **17 added lines with a local filesystem path (the account name) in 3 unpublished commits**, see section 9.
* **Dependencies:** root production audit reports 0 vulnerabilities; Studio production audit reports 2 low (two LOW advisories in Monaco's bundled DOMPurify 3.4.15, not fixable by an override, with a
  reachability test and a version-bound exception); registry signatures verified.
* **Execution:** on macOS project commands, terminals, the Git panel and Lab candidates run in a sandbox (no network, writes confined, no signalling other processes, no reads of the home
  directory or shared temp folders). There is no ERA sandbox on Linux. Coding-agent CLIs run under their own isolation and can read whatever your account can; authorizing a remote provider authorizes that.
* **Cloud transmission:** none by default. ERA has no telemetry and makes no network calls of its own (checked in the source: the only `fetch` calls are relative requests from the UI to its local control plane, and there is no analytics or telemetry code); remote providers need per-project consent, unmetered agents (Codex reports tokens, not dollars) are refused until you enable them.
* **Executable permissions:** only the intended scripts and one Mach-O test fixture are executable.
* **Not certified, not independently reviewed:** see [SECURITY.md](../SECURITY.md).

## 7. Known limitations

* macOS arm64 only for Studio; Windows and Linux Studio are unverified; unsigned and not notarized; no debugger, extension marketplace, collaboration, SSO or RBAC.
* Claude Code was never validated against the real CLI; no `claude+codex` team ran live; Codex has no dollar cap; real-provider evidence is small and historical.
* The Improvement Lab needs a branch named `main`, cannot evaluate `apps/studio/`, and is close to its 50-run REA cap (a cycle needs 2 x 21 = 42 of 50 runs).
* Native decompilation depends on Hopper/Ghidra/IDA, can time out, and needs the Mac awake; Ghidra needs a JDK 21 and `GHIDRA_INSTALL_DIR`.
* The terminal revocation kills the process group; a process that starts its own session escapes it.
* Screenshots cover ten views; the Rebuild checklist, screenshot comparison and plan approval are not captured. Keyboard behavior was verified; a screen-reader pass was not.
* Rebuild reconstructs *stated* behavior; it does not prove equivalence. Benchmarks use five small authored fixtures.

## 8. Artifacts

Attached to the GitHub release (built from the release commit with `npm pack` and `npm sbom`; the tarball is reproducible, `npm pack` at the tag gives the same checksum):

| File | What it is | SHA-256 |
|---|---|---|
| `era-agent-0.2.0.tgz` | the CLI package (no Studio): `bin/`, `src/`, `era.config.json`, README, LICENSE, THIRD_PARTY_NOTICES; no personal paths | `73a206c457e6444398faab78f0367d7a5fc8f63f4d1c7142621d45771dbdd63f` |
| `era-agent-0.2.0.cdx.json` | CycloneDX SBOM of the CLI's production dependencies | `5c2569919140d572e5a4a2fdae19efb9676b6b71f07eaec755b27e1c8976e0d4` |
| `era-studio-0.2.0.cdx.json` | CycloneDX SBOM of Studio's npm production dependencies (not the bundled Electron runtime) | `14145149fb2fbd144a429083a282f13a8f8283b429ab997a0d010ddf2fc479df` |
| `SHA256SUMS` | the checksums above (`shasum -a 256 -c SHA256SUMS`) | |

**Not attached: the macOS desktop app.** An unsigned build was produced and tested (it launches, including from an extracted archive), but it is only ad-hoc signed (`codesign -dv`: `Signature=adhoc`, no team identifier) and `spctl --assess` rejects it:
it has no Developer ID signature, is not notarized, and would trigger Gatekeeper warnings. Build it from source instead. No provenance attestation exists (the release-validation workflow did not run).

## 9. What is still open

1. **Git history:** three early commits on the branch contain a local filesystem path (the account name) in evidence files; there are no credentials. The maintainer accepted publishing the history as is.
2. **An independent review of the audit fixes**, ideally by someone who tries to bypass them.
3. **A signed and notarized desktop build** (Developer ID, notarization, a clean-machine test) if a distributed macOS app is wanted.
4. **Real-provider validation:** Claude Code and a live `claude+codex` team (needs your sign-in), and a metered-cost check.
5. **Hosted CI** runs on every pull request; the result for this release is on pull request #1. The Studio desktop job ran on a hosted runner for the first time on this release.
