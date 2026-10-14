# ERA v0.2.0, release candidate 1 (`0.2.0-rc.1`)

> **Status: release candidate. Nothing has been published.** No tag, GitHub release, npm package or push was made for this version. The stable release remains
> **v0.1.0**. The release candidate commit is `@@COMMIT@@` on branch `feature/era-v0.2.0`. Publishing needs your explicit approval; the open decisions are in section 9.

ERA is an open-source reverse-engineering agent built on the original [Reverse Engineer Anything (REA)](https://github.com/morluto/rea) engine. v0.2.0 is the first
version that contains **ERA Studio**, **Project Lab** and **Multi-Agent Engineering**. REA is unchanged (`rea-agents@6.4.0`, an unmodified dependency); everything
reverse-engineering related still comes from recorded REA executions.

## 1. What is new since v0.1.0

@@STATS@@

| Area | What you get | Where |
|---|---|---|
| **ERA Studio** | A desktop (Electron) and browser workbench over the same backend as the CLI: dashboard, projects, REA analysis with evidence and structure, Monaco editor and side-by-side diff viewer, Git status, sandboxed terminal, Agent Command Center, Improvement Lab view, settings, and an offline **Documentation** section. | [Studio guide](ERA_STUDIO.md), [screenshots](assets/screenshots/README.md) |
| **Project Lab** | **Review** (read-only findings with evidence), **Modify** (isolated change, baseline, regression detection, a verified diff you approve) and **Rebuild** (reconstruct stated behavior of an authorized reference, including screenshot-to-website with visual scoring). Approval applies exactly the verified diff; rollback is refused if it would destroy later work. | [Project Lab](project-lab.md) |
| **Multi-Agent Engineering** | Architect, implementer and reviewer roles over Codex, Claude Code and custom command agents; presets; per-project consent; dollar caps where an agent reports cost; exposure filtering re-checked before every agent run; bounded correction rounds. | [Multi-agent](multi-agent.md), [providers](provider-configuration.md) |
| **Improvement Lab** | Unchanged workflow; its sandbox and read allowances were hardened, and its self-analysis pass size was raised from 50 KB to 60 KB so a cycle fits the 50-run REA cap again. Two Studio-backend improvements were accepted by the Lab in this cycle (REA status cache, faster job shutdown). | [Improvement Lab](improvement-lab.md), [Phase 3B](ERA_STUDIO_SELF_IMPROVEMENT.md) |
| **Security** | The independent audit's five HIGH, eight MEDIUM and three LOW findings were fixed or documented, each with a regression test that fails on the old code. | [remediation](ERA_V020_REMEDIATION.md) |
| **CLI and MCP** | All v0.1.0 commands and `era rea …` passthrough (including `era rea mcp`) keep working; new commands: `project …`, `studio …`, `agents`. | [README](../README.md) |

## 2. Install

Three different things; pick one ([installation](installation.md)): the stable CLI (`main`, **no Studio**), the v0.2.0 development line with Studio, or a **locally built unsigned macOS app**.

```bash
git clone --branch feature/era-v0.2.0 https://github.com/dav1dngy/era-agent.git && cd era-agent
npm ci && npm ci --prefix apps/studio
node bin/era.mjs studio doctor && node bin/era.mjs studio app
```

**Desktop app (macOS).** The only validated platform is macOS on Apple silicon. The app is an **unsigned, un-notarized development build**: there is no Developer ID signature,
no notarization and no auto-updater, and no signed production release exists. Build it with `npm run package --prefix apps/studio` or use the zip attached to a release
candidate and verify its checksum first; see [installation](installation.md#era-studio-desktop-application-macos) for the steps and the Gatekeeper note. Gatekeeper behavior was not verified on a clean machine.

## 3. Verified

@@TESTS@@

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

* **Secrets and personal data:** `npm run check` scans every tracked file; `npm run check:history` scans every added line in every branch. Result for this candidate: @@HISTORY@@
* **Dependencies:** root production audit @@AUDIT_ROOT@@; Studio production audit @@AUDIT_STUDIO@@ (two LOW advisories in Monaco's bundled DOMPurify 3.4.15, not fixable by an override, with a
  reachability test and a version-bound exception); registry signatures verified.
* **Execution:** on macOS project commands, terminals, the Git panel and Lab candidates run in a sandbox (no network, writes confined, no signalling other processes, no reads of the home
  directory or shared temp folders). There is no ERA sandbox on Linux. Coding-agent CLIs run under their own isolation and can read whatever your account can; authorizing a remote provider authorizes that.
* **Cloud transmission:** none by default. ERA has no telemetry and makes no network calls of its own; remote providers need per-project consent, unmetered agents (Codex reports tokens, not dollars) are refused until you enable them.
* **Executable permissions:** only the intended scripts and one Mach-O test fixture are executable.
* **Not certified, not independently reviewed:** see [SECURITY.md](../SECURITY.md).

## 7. Known limitations

* macOS arm64 only for Studio; Windows and Linux Studio are unverified; unsigned and not notarized; no debugger, extension marketplace, collaboration, SSO or RBAC.
* Claude Code was never validated against the real CLI; no `claude+codex` team ran live; Codex has no dollar cap; real-provider evidence is small and historical.
* The Improvement Lab needs a branch named `main`, cannot evaluate `apps/studio/`, and is close to its 50-run REA cap (a cycle needs @@LABRUNS@@ runs).
* Native decompilation depends on Hopper/Ghidra/IDA, can time out, and needs the Mac awake; Ghidra needs a JDK 21 and `GHIDRA_INSTALL_DIR`.
* The terminal revocation kills the process group; a process that starts its own session escapes it.
* Screenshots cover ten views; the Rebuild checklist, screenshot comparison and plan approval are not captured. Keyboard behavior was verified; a screen-reader pass was not.
* Rebuild reconstructs *stated* behavior; it does not prove equivalence. Benchmarks use five small authored fixtures.

## 8. Artifacts

@@ARTIFACTS@@

## 9. Before this can be published

1. **Your decision on Git history.** `npm run check:history` finds local filesystem paths (the account name) in three **unpublished** commits (`86baf91`, `68f0f20`, `74b1f93`); the working tree was cleaned afterwards. Pushing the branch publishes them. Options: accept (no credentials are involved), squash the unpublished commits into one before pushing (loses per-commit history and the commit references in the docs), or rewrite those three commits (changes every later commit id).
2. **A green hosted CI run** for the desktop job, which could not be executed here.
3. **An independent look at the audit fixes**, ideally by someone who tries to bypass them.
4. **Whether to ship an unsigned desktop build** at all. If a distributed macOS app is intended, it needs Developer ID signing, notarization and a clean-machine test.
5. **Optional, with your authorization:** a real Claude Code sign-in and a live `claude+codex` run; a metered-cost check.

Then, and only on your explicit instruction: open the pull request ([pull-request-v0.2.0.md](pull-request-v0.2.0.md)), merge it, tag `v0.2.0` (bump `package.json` from `0.2.0-rc.1`) and create the GitHub release.
