# Support and validation matrix

What is verified, on which platform and revision, and how. Revision `02cc35a` (code identical to the latest checkpoint; later commits change documentation only), 2026-10-15,
macOS 27.0.1 arm64, Node 24.20.0, Electron 44.7.1, REA 6.4.0. Details and commands: [ERA_V020_REMEDIATION.md](ERA_V020_REMEDIATION.md).

Labels: **REAL** it ran for real on this revision; **MOCKED** a service was replaced by a fake or scripted stand-in (the orchestration is verified, not the stand-in);
**HISTORICAL** a dated earlier run, recorded but not repeated; **UNVERIFIED** not run; **FAILED** a control did not hold when tested (none open at this revision).

| Area | Label | Evidence | Limits |
|---|---|---|---|
| ERA CLI and core analysis | REAL | `npm test` 335 tests (334 pass, 1 skipped); installed CLI analyzed a fixture (15 facts) | JavaScript, archives and Mach-O; coverage is bounded by REA's |
| REA integration and MCP | REAL | real `rea-agents` 6.4.0 subprocess; a real MCP initialize, list and call session | no claim beyond the tested commands; ERA adds no engine capability |
| Native decompilation | REAL for Mach-O structure; **UNVERIFIED** for decompilation quality | Hopper and Ghidra 12.1.4 report healthy in `rea doctor` (Ghidra needs JDK 21 on `PATH` and `GHIDRA_INSTALL_DIR`) | Hopper needs the Mac awake and can time out; IDA not installed |
| ERA Studio, desktop | REAL | 17 of 17 Electron scenario groups; packaged unsigned arm64 app launches | coding agent in the scenarios is **MOCKED**; macOS arm64 only; unsigned, not notarized |
| ERA Studio, browser mode | REAL (same control plane and UI) | `era studio serve`, authenticated HTTP tests | |
| Studio on Windows or Linux | **UNVERIFIED** | not run | not supported |
| Project Lab: Review, Modify, Rebuild | REAL for commands, git, sandbox, patching, approval and rollback; **MOCKED** coding agents | 105 Project Lab, multi-agent and screenshot tests plus 18 audit regression tests | |
| Screenshot rebuild | REAL rendering and scoring; agent **MOCKED** in tests; **HISTORICAL** real Codex run (similarity 0.9271 with the image, 0.1048 blind control, one synthetic page) | `experiments/screenshot-rebuild/`, [provider-validation.md](provider-validation.md) | not a general accuracy claim |
| Codex adapter | **HISTORICAL** real runs (write, read-only, review, timeout) | [provider-validation.md](provider-validation.md) | tokens only, no dollar cap; no new generation on this revision |
| Claude Code adapter | **UNVERIFIED** against the real CLI | adapter logic is tested with scripted CLIs | the CLI was signed out when last probed |
| Multi-agent (architect, implementer, reviewer) | **MOCKED** roles; real isolation and handoffs | multi-agent tests | no live `claude+codex` run; one provider in several roles is not independent review |
| Improvement Lab | REAL end to end with real REA and sandbox, in a throwaway clone (4 cycles on this line, 3 accepted); the end-to-end suite uses a fake engine | `experiments/studio-improvement/`, `experiments/remediation/` | approval and tagging were not run on this repository; the Lab needs a branch named `main`, cannot evaluate `apps/studio/`, and is at its REA-run hard cap |
| Security fixes H01-H05, M01-M03 | REAL | `tests/audit-remediation.test.js`, `tests/audit-control-plane.test.js` fail on the previous code | macOS sandbox only; see the limits in the remediation document |
| In-app Documentation (eight sections rendered from the repository pages), keyboard-contained palette | REAL | desktop scenarios, route and parser tests, native key events | no screen-reader pass |
| CI desktop job, release validation | **UNVERIFIED** on a hosted runner | workflow YAML parses; commands run locally | first hosted run pending |
| Signing, notarization, clean-machine install | **UNVERIFIED** | not done | an unsigned development build only |
| Screenshots in the documentation | REAL, ten captures | [gallery and process](assets/screenshots/README.md), [manifest](assets/screenshots/manifest.json) | the coding agent in them is a stand-in; Rebuild checklist, screenshot comparison and plan approval not captured |
| Independent review of the fixes | **UNVERIFIED** | none | required before a release claim |

Historical records that stay as written: [ERA_STUDIO_TESTING.md](ERA_STUDIO_TESTING.md), [release-notes-v0.2.0-dev.1.md](release-notes-v0.2.0-dev.1.md), [release-readiness.md](release-readiness.md).
