# ERA v0.2.0 — Independent Architecture, Security, QA and UX Audit

**Audit date:** 2026-10-14

**Audited revision:** `e62fe705d258b45e2408a0054abb6500b218c8cb`

**Branch:** `feature/era-v0.2.0`

**Package versions:** ERA and Studio `0.2.0-dev.1`; REA `6.4.0`

**Verdict:** **NOT READY** for a general v0.2.0 / enterprise release.

This report assesses the current local implementation, including seven unpublished commits. The working tree was clean at the start. A read-only remote-ref check confirmed that the published feature branch remained at `52dcf82ffc246fc85731af8505d33dcda767f187` and `main` at `a205541551b967b819f3ff8778f1cb4d151097d1`. Findings and line references refer to the audited revision, not the older development release.

Only this report was added to the original repository. Implementation, configuration, credentials, branches and releases were not changed. Tests, package builds and adversarial probes used disposable copies and synthetic projects. No real coding-agent generation request was made, no unmetered-provider setting was enabled in the user's configuration, and nothing was committed, merged or published.

## 1. Executive summary

ERA has substantial working functionality beyond a UI prototype. A fresh locked installation passed **306 of 307 tests, with one platform-specific skip and zero failures**. All **14 Electron desktop scenarios** passed. A newly built unsigned macOS application launched with the authenticated control plane and real REA available. A separately installed CLI package successfully analyzed a JavaScript fixture and produced 15 facts through its own installed REA dependency.

Nevertheless, independent adversarial checks established **five HIGH findings** affecting mandatory verification, rollback, agent exposure and host isolation. Passing the existing suite does not establish that approval and isolation cannot be bypassed. In particular, the final human approval step remains present, but a patch containing a protected-file modification can incorrectly be marked as verified and accepted for approval.

The report contains **0 CRITICAL, 5 HIGH, 8 MEDIUM and 3 LOW findings**. No critical vulnerability was established within this audit; this is not proof that none exists.

| ID | Severity | Finding | Detail |
|---|---|---|---|
| H01 | HIGH | Verification checks an obsolete diff; test-time protected changes can be approved | §3 |
| H02 | HIGH | Rebuild rollback deletes later user data in digest-excluded directories | §3 |
| H03 | HIGH | Commands can regenerate withheld instructions and credential files before agents run | §3 |
| H04 | HIGH | Read-only Git inspection executes repository-configured commands outside isolation | §3 |
| H05 | HIGH | macOS command sandbox permits unrelated-process signalling and broad host reads | §3 |
| M01 | MEDIUM | An unauthenticated malformed request terminates the control plane | §3 |
| M02 | MEDIUM | Existing terminals retain access after permissions are revoked | §3 |
| M03 | MEDIUM | Workspace terminal cannot read its own working copy | §4 |
| M04 | MEDIUM | Hosted CI and release validation omit the Studio runtime | §9 |
| M05 | MEDIUM | Main installation instructions do not lead to a Studio-capable checkout | §4 |
| M06 | MEDIUM | Current capability and handoff claims contradict one another | §4 |
| M07 | MEDIUM | Packaged Studio has no discoverable documentation entry point | §4 |
| M08 | MEDIUM | Improvement evidence archives cannot reconstruct the original evaluations | §7 |
| L01 | LOW | Missing user-facing screenshots and visual workflow documentation | §4 |
| L02 | LOW | Command palette lacks the shared modal's keyboard containment | §4 |
| L03 | LOW | Two reported production dependency entries remain affected by DOMPurify advisories | §3 |

Evidence terminology used throughout:

- **REAL EXECUTION:** the named local component actually ran during this audit. A real workflow can still use a simulated provider; this is stated explicitly.
- **MOCKED EXECUTION:** an engine, provider or response was substituted. This verifies orchestration contracts, not the substituted service.
- **UNVERIFIED FUNCTIONALITY:** not independently executed here, or only source/historical evidence was inspected.
- **FAILED EXECUTION / CONTROL:** a command failed or a promised boundary failed in a real isolated reproduction. These are distinguished from expected negative tests.
- **Historical evidence:** retained results from earlier work, examined but not represented as a fresh run.

## 2. Architecture assessment

The architecture is suitable for a local developer workbench. The ESM CLI delegates analysis to the unmodified REA subprocess interface. Project Lab and Improvement Lab share process, safety, logging and adapter infrastructure while retaining separate workflows and state. The Electron/Preact application is a client of the existing loopback control plane, with Monaco and xterm providing editing and terminal functions.

Useful design choices include dependency injection, explicit run states, bounded attempts, structured evidence, per-project locks, cancellation/watchdog support, and explicit approval. The distinction between REA observations, inferred facts and agent review output is materially better than treating an agent narrative as verified analysis.

The main weakness is inconsistent enforcement across lifecycle boundaries. Initial exposure filtering is not an invariant at every provider call. Verification decisions and final patch identities are computed at different times. A digest designed for source copying is reused to justify whole-directory deletion. Git inspection, terminal sessions and provider CLIs have different effective trust boundaries. These are architectural defects, not just missing UI confirmations.

| Component | Actual implementation and evidence | Assessment / limit |
|---|---|---|
| ERA Core | Analysis, facts, reports, process limits, CLI and state records; fresh suite and clean-install analysis | Working; evidence is bounded by REA coverage and provider availability |
| REA integration | Pinned `rea-agents@6.4.0`, subprocess records, CLI passthrough and real MCP session tests | Genuine integration; no upstream engine modification found |
| Studio | Electron shell, dashboard, projects, Monaco/diff, search, Git, terminal, settings and analysis views | Working local workbench; terminal and Git defects below |
| Project Lab | Review / Modify / Rebuild, acceptance commands, isolated copies, preflight, resume and approval | Meaningful workflows; H01–H03 prevent a safe general-release claim |
| Multi-agent engineering | Sequential architect → implementer → reviewer roles, snapshots, bounded corrections, capability registry | Orchestration tested with fakes; real mixed-provider quality unverified |
| Claude Code adapter | Headless CLI, plan/acceptEdits modes, reported dollar cost and budget argument | Fresh authenticated generation unverified; historical signed-out failure only |
| Codex adapter | CLI execution, native read-only/workspace-write modes, image arguments, JSONL token accounting | Historical real runs retained; fresh availability/auth checked, no new generation |
| Improvement Lab | Propose/implement/evaluate/approve, stable evaluator, Git worktrees, version tags, rollback/recovery | Real Git lifecycle with mocked engine in end-to-end tests; limited analysis universe |
| Security architecture | Loopback token, Host/Origin checks, Electron separation, path checks, macOS profiles | Useful controls with confirmed gaps; not a multi-user security boundary |
| Tests | Unit, fixtures, real REA/MCP, sandbox and Electron coverage | Strong baseline; adversarial lifecycle cases are missing |
| CI/CD | Root-package tests/audits, CLI archive/SBOM/provenance workflow | Desktop dependency/runtime/distribution gap, M04 |
| Open-source readiness | MIT license, upstream attribution, notices, contribution/security documents | Reasonable foundation; instructions and release evidence need consolidation |

Maintainability is helped by the existing service boundaries; a framework rewrite is not indicated. Prioritize central invariants for candidate identity, per-invocation exposure, safe filesystem deletion, Git execution and terminal lifecycle. Error handling already covers many process failures, but the uncaught request parser in M01 shows why entry-point failures also need tests.

The original master prompt's enterprise IDE ambition is not the implemented support contract. There is no established debugger/LSP-management/extension ecosystem, collaborative editing, SSO or RBAC. Those omissions should be stated as scope limitations rather than silently treated as completed enterprise features.

## 3. Security assessment

### Controls that have useful evidence

The control plane binds loopback and uses a random per-launch token, constant-time token comparison, Host/Origin checks and JSON mutation requirements. Electron disables renderer Node access, enables context isolation, restricts navigation and permissions, and validates native IPC senders. Fresh launch evidence reported `injectedAuth:true`, `node:false`, REA available and a loopback backend.

Path checks reject ordinary traversal, metadata paths and symlink escapes. Settings and run records use private creation modes. Runtime/candidate tests demonstrate outside-write and network denial for their tested cases. Default direct editing, terminal access and unmetered-provider use are restricted. Existing tests also exercise stale-candidate/stale-source rejection, cancellation and interrupted-run recovery.

These successes do not cover every command path or lifecycle transition. A process running as the user can access local state; this application does not defend against an OS administrator or arbitrary same-user tampering. Provider CLIs additionally retain broad account-readable filesystem access, as already disclosed in `docs/ERA_STUDIO_SECURITY.md:72–76`. The new findings below go beyond merely restating that disclosed provider limitation.

### H01 — HIGH: protected changes made during verification can be approved

**Affected:** `src/project_lab/modify.js:185–192,227–255`; `src/project_lab/lab.js:338–348`. The same ordering appears in `src/project_lab/rebuild.js:369–398,410–425`.

**Cause:** Modify captures the changed-file list before running build/test/acceptance commands. `evaluateChange()` applies protected-path and size/count checks to that earlier list. Finalization calculates a new patch and hash but reuses the previous decision. Approval checks the new hash, so the hash does not prove that the final patch passed the guards.

**REAL EXECUTION — failed control:** an isolated manual Modify fixture protected `protected.txt`. A project test changed it only after `candidate.txt` had been added. Verification recorded only `candidate.txt`; finalization recorded both files, with `pass:true` and no reasons. Explicit approval succeeded and the original protected file contained the audit marker `CHANGED_DURING_TEST`.

**Impact:** project or generated test code can evade mandatory protected-path checks. This is not a demonstration of removing the human approval step: the reproduction explicitly approved the misleadingly verified result. Rebuild shares the code-ordering problem, but the direct reproduction was Modify.

**Correction:** bind test evidence, all change guards and approval to one immutable candidate state. Recompute and validate the complete diff after commands finish; reject mutation during verification or verify the resulting new snapshot again. Do not attach a new patch hash to an old decision.

**Verification:** tests that modify a protected file during verification must fail and remain unapprovable. Cover Modify and Rebuild, plus test-generated changes exceeding file-count/diff-size limits.

### H02 — HIGH: Rebuild rollback can destroy subsequent work

**Affected:** `src/project_lab/workspace.js:16–47`; `src/project_lab/lab.js:373–377,393–397`.

**Cause:** `treeDigest()` excludes `.git`, `build`, `dist`, `node_modules` and other directories. Rebuild rollback compares this filtered digest and then recursively deletes the entire destination, including excluded paths.

**REAL EXECUTION — failed control:** after a synthetic manual Rebuild passed acceptance and was approved, the audit created `.git/audit-unpublished-history` and `build/user-data`. The digest did not change. Rollback returned `restored:true` and deleted the destination and both added files.

**Impact:** ordinary post-approval work can be lost without a malicious agent or race. Initializing Git or storing later data in an excluded directory does not trigger the advertised modified-destination refusal.

**Correction:** use a complete manifest covering every path that deletion would affect, or remove only recorded generated outputs while preserving new content. Refuse destructive rollback on additions, removals or modifications. A source-copy exclusion policy is not a deletion-safety proof.

**Verification:** add and modify files in `.git`, `build`, `dist` and other excluded directories after approval. Rollback must refuse or preserve them. Include excluded files already present when the Rebuild was approved.

### H03 — HIGH: exposure filtering becomes stale before provider invocation

**Affected:** `src/project_lab/steps.js:13–25`; `exposure.js:32–42`; `context.js:153–198,264–269`; `modify.js:150–171`.

**Cause:** credential/instruction withholding and secret scanning occur when the initial working copy is created. Baseline commands run afterwards and can recreate those files. `invokeAgent()` rechecks consent but does not re-filter/rescan the actual invocation filesystem. Role snapshots also copy the current workspace without the exposure filter.

**REAL workflow and commands / MOCKED provider — failed control:** an explicitly consented fake remote adapter recorded file presence and returned zero cost. The original `AGENTS.md` was correctly withheld. A baseline command regenerated it and created a synthetic `.env`. Both were visible at the provider boundary, while the exposure record still reported the instruction file withheld and no secret-content files. The run reached `awaiting-approval`.

**Impact:** commands can reintroduce automatically consumed agent instructions and build-generated credential files. This defeats the stated workspace filtering boundary. No real secret or remote transmission was used or demonstrated; the reproduction establishes availability to the adapter.

**Correction:** build a freshly filtered view and scan the exact content before every remote/instruction-reading invocation, including architect, implementer, reviewer, corrections and resumes. Fail closed for newly introduced sensitive content and record exposure per invocation. Account for later command execution and concurrent mutation. This must accompany, not replace, honest disclosure of provider-wide read access.

**Verification:** baseline and candidate commands should generate instruction files, credential filenames and synthetic secret-pattern content. Fake adapters must receive a sanitized view or not be invoked. Repeat between roles and after resume.

### H04 — HIGH: read-only Git inspection executes untrusted configuration

**Affected:** `src/control_plane/services/workbench.js:28–29,46–49`; UI trigger `apps/studio/web/js/views/workbench.js:38`.

**Cause:** the Git helper disables hooks and fsmonitor but still inherits repository-local executable configuration and the full process environment. `git status` may run configured clean/process filters while comparing modified tracked files.

**REAL EXECUTION — failed control:** a disposable existing Git repository had a configured clean filter that appended a harmless marker outside the project. The project had all execution/edit permissions false. Requesting `GET /api/projects/untrusted/git?root=source` returned HTTP 200 and wrote the outside marker three times.

**Prerequisite:** opening/importing an existing or archive-supplied repository containing malicious local Git configuration, then inspecting Git status. An ordinary remote `git clone` does not transfer the attacker's `.git/config`; that distinction limits the delivery scenario.

**Impact:** an ostensibly read-only operation executes repository-controlled commands with the user's privileges and inherited environment, bypassing project execution controls. Network access and sensitive access are potential consequences of that unsandboxed execution; the reproduction used only a marker.

**Correction:** make inspection safe against executable configuration and configuration inheritance. Use sanitized metadata inspection or a confined Git worker with a scrubbed environment, constrained reads, and denied external writes/network. Merely disabling hooks and fsmonitor is insufficient.

**Verification:** malicious clean/process-filter fixtures must not execute outside writes, access synthetic secret environment values or contact a test network endpoint through either HTTP or the Git panel. Ordinary status/diff must remain functional.

### H05 — HIGH: sandbox does not confine process control or general reads

**Affected:** `src/safety/candidate-sandbox.js:35–45`; equivalent runtime profile in `src/safety/sandbox.js:18–28`.

**Cause:** profiles start with `(allow default)` and deny selected network/file operations. They impose no boundary on signalling unrelated processes. File reads use a blacklist rather than a workspace/toolchain allowlist.

**REAL EXECUTION — failed control:** `runProjectCommand()` reported `macos-sandbox-exec`. A command inside it successfully terminated a separate audit-owned Node sentinel outside the sandbox with SIGTERM. A separate probe read synthetic content from an unrelated sibling project. No user process or private user data was targeted.

**Impact:** untrusted build/test code can interrupt other same-user work and read unrelated non-blacklisted project content. This is a local host-isolation failure, distinct from the already disclosed broad reads of external coding CLIs. It does not demonstrate root privilege escalation or defeat of every existing write/network restriction.

**Correction:** restrict signalling and relevant IPC; define explicit workspace/runtime/toolchain read access. If those guarantees cannot be maintained reliably with the current profile, use a stronger separate-user/container/VM boundary. Apply equivalent scrutiny to runtime-capture targets and retain protected-state denial.

**Verification:** an external audit sentinel must survive; unrelated synthetic project files must be unreadable. Commands must still manage their own children and access required tools. Existing network and outside-write denial tests must continue to pass.

### M01 — MEDIUM: malformed unauthenticated request crashes the server

**Affected:** `src/control_plane/server.js:337–339`.

**Cause/evidence:** `new URL(req.url, 'http://localhost')` runs outside the handler's `try` boundary. A raw request with a malformed absolute target (`http://[`) and no token terminated a disposable server with `ERR_INVALID_URL`, exit 1, on Node 24.20.0.

**Impact:** any process able to reach the loopback listener can cause local denial of service. A remote-browser delivery was not established.

**Correction:** validate/parse inside the guarded request boundary and return HTTP 400; error handling must not assume a valid URL.

**Verification:** malformed raw-socket requests should return 400, followed by a successful health request against the same process; disposable active jobs must remain supervised.

### M02 — MEDIUM: terminal access survives permission revocation

**Affected:** `src/control_plane/services/workbench.js:149–155`; settings update in `src/control_plane/server.js:138–145`.

**Cause/evidence:** policy and root checks occur when opening a terminal, not on its subsequent lifecycle. In a real HTTP test, a source terminal was opened with terminal/direct-edit permission. Both permissions were then disabled and allowed roots changed. Input still returned HTTP 200 and wrote an audit file into the previously allowed source.

**Impact:** settings no longer describe effective access. A previously opened process can retain write access after revocation. Source inspection also shows missing binding to later workspace editability transitions; that additional transition was not separately reproduced.

**Correction:** terminate affected terminal process trees on permission/root and run-state transitions. Recheck input as defense in depth; input rejection alone does not stop already running background commands.

**Verification:** after revocation completes, input must be refused and a previously running audit command must be unable to write. Test root removal and workspace transition to running/applied states.

### L03 — LOW: known bundled dependency advisories remain

**Affected:** `apps/studio/package-lock.json`, Monaco 0.57.0's bundled DOMPurify 3.4.15, and `tests/studio-dependencies.test.js`.

**Evidence:** fresh production audits reported zero root vulnerabilities and two LOW Studio package entries: DOMPurify and its dependent Monaco. This is not two independent demonstrated Studio exploits. The advisory mechanisms require DOMPurify `IN_PLACE` use; the inspected bundle regression test found no such caller, and the suite verified the restrictive script CSP. The primary advisories identify DOMPurify 3.4.16 as patched. [GHSA-p98j-92pf-mc4p](https://github.com/advisories/GHSA-p98j-92pf-mc4p), [GHSA-6688-9rhm-gjv2](https://github.com/advisories/GHSA-6688-9rhm-gjv2).

**Impact:** a known vulnerable component remains in the dependency/bundle inventory. Exploitability in the present Studio use was not established. A text-occurrence test is useful regression evidence, not a general proof against XSS.

**Correction:** use a compatible Monaco release with a patched embedded sanitizer when available, or document a maintained exception tied to the exact artifact and reachability evidence. Do not assume an npm override replaces code already embedded in Monaco's bundle, or blindly accept a forced downgrade.

**Verification:** inspect the shipped bundle, rerun production audit and non-skipped reachability/CSP tests, and exercise untrusted hover/Markdown rendering after any upgrade. This LOW issue is not the basis of the NOT READY verdict.

## 4. ERA Studio, documentation and UX assessment

**REAL EXECUTION:** all 14 desktop scenarios passed on a clean snapshot. They cover Electron launch/authentication, dashboard state/search, project context, real REA review, simulated-agent Modify with real project tests, Monaco diff and editing, cancelled/explicit approval, rollback, UI-triggered analysis, history, provider labels, responsive navigation, light theme and backend authorization. Screenshot Rebuild is covered by the separate integration suite, not by those 14 scenario names.

A fresh unsigned arm64 package also built and passed its smoke check outside the development working directory. This proves local packaging and launch; it does not prove signed/notarized distribution, Gatekeeper acceptance or installation on a clean machine.

The audit visually inspected freshly captured `home-empty-dark.png` and `workbench-dark.png` from the isolated desktop run. The graphite layout has a coherent hierarchy, a useful empty-project action, visible provider states, and a recognizable editor. The captures represent real UI using controlled fixtures; provider generation in those scenarios is simulated. They do not establish formal contrast compliance, screen-reader usability or parity with the earlier external design reference.

### M03 — MEDIUM: working-copy terminal cannot read project files

**Affected:** `src/control_plane/services/workbench.js:118`; coverage gap at `tests/control-plane.test.js:450`.

**Cause/evidence:** the terminal profile denies reads of the entire state directory, which contains the selected working copy. A real HTTP-opened `root=workspace` terminal returned `sandboxed:true`, but reading its own `fixture.txt` failed with `Operation not permitted`. The existing terminal test exercises a source terminal instead.

**Impact:** a central IDE workflow—reading/building/testing the isolated copy in a terminal—is unusable despite a successful open response.

**Correction:** allow the selected workspace and private terminal scratch reads while denying other project state, ledgers, settings and credentials. Preserve write confinement.

**Verification:** open an actual awaiting-implementation workspace terminal and read/build/test its fixture. Access to another project's state and outside writes must still fail.

### M05 — MEDIUM: source-install instructions select the wrong product state

**Affected:** `README.md:74–87,203–215`; `docs/installation.md:13–22`; `docs/ERA_STUDIO.md:16–25`; `package.json:10–17`.

**Evidence/impact:** the generic instructions clone the default branch, while subsequent Studio commands assume `apps/studio`. The remote default/main revision was verified as v0.1.0 and has no Studio tree. The CLI npm package also omits Studio. A newcomer following that route cannot launch the advertised interface; the seven audited local commits are not remotely installable yet.

**Correction:** separate stable CLI, versioned Studio source checkout and desktop-artifact installation. Specify the exact available branch/tag, required Node/Python/native-provider setup, verification, state locations and upgrade/recovery steps. State clearly that the CLI archive does not include Studio.

**Verification:** follow every documented route from a temporary fresh checkout/profile without relying on global tools, existing state or credentials. Confirm the intended version, UI launch where applicable and a real REA smoke run.

### M06 — MEDIUM: conflicting current capability and validation claims

**Affected:** `README.md:256–261,319–321`; `docs/project-lab.md:9–13`; `docs/ERA_V020_HANDOFF.md:1–12,134–156`; `docs/ERA_STUDIO_TESTING.md:10–33`.

**Evidence/impact:** one README passage records real Codex validation while another says both coding adapters have only fake validation. Project Lab's opening says no real agent ran. The handoff begins with Phase 3B not started and later records completion. Historical testing pages are linked as the main validation result. Readers and subsequent agents can confuse released dev.1, unpublished changes, historical tests and unsupported capabilities.

**Correction:** place the current revision/status at the top of the handoff and maintain one capability/evidence matrix with date, platform, revision and REAL/MOCKED/UNVERIFIED/FAILED labels. Link historical documents explicitly. Preserve old release notes at their historical scope.

**Verification:** trace each current feature claim to a revision-specific test or retained run. Search for contradictory phase, provider, screenshot, approval and release statements.

### M07 — MEDIUM: help is absent from the packaged user journey

**Affected:** `apps/studio/web/js/app.js:11–20,87–105`; `apps/studio/electron/main.cjs:131–139`; `apps/studio/scripts/package-mac.cjs:19,36–40`; `src/control_plane/server.js:316–334`.

**Evidence/impact:** no Help/Documentation route, palette command or native Help menu was found. Packaging does not include the guides, and static serving does not expose repository documentation. Settings and preflight do provide local explanations of costs, consent and prerequisites, but users have no discoverable in-app route to the comprehensive documentation or offline guide for these workflows.

**Correction:** add Getting started/Help and context links from preflight, settings and approval views. Bundle a concise offline setup/security guide and use versioned HTTPS documentation links for longer material.

**Verification:** from an offline clean installation, a keyboard user should reach setup, cost policy, Rebuild prerequisites, approval/rollback and troubleshooting without opening the source repository.

### L01 — LOW: no published visual workflow guide

**Affected:** `README.md:203–222`, `docs/ERA_STUDIO.md`, `docs/ERA_STUDIO_TESTING.md:74–80`.

**Evidence/impact:** README/docs have no embedded product screenshots or annotated Studio workflow guide. Textual workflow diagrams exist in the Project Lab and self-improvement documentation. Tracked experiment PNGs demonstrate screenshot-rebuild experiments, not an onboarding guide. Actual application captures are under ignored validation output. New users lack a visual preview connecting the documented stages to the interface they will use.

**Correction:** publish genuine sanitized captures for first launch, project setup, Rebuild prerequisites, screenshot comparison, Monaco diff, plan approval, change approval/rollback and settings. Include version/date/platform, real/simulated labels, meaningful alt text and a short workflow diagram.

**Verification:** reproduce captures from controlled fixtures at the release revision; check for private paths, tokens and misleading states. No fake screenshots were generated in this audit.

### L02 — LOW: command palette keyboard behavior is incomplete

**Affected:** `apps/studio/web/js/app.js:98–105`; compare the shared modal in `apps/studio/web/js/ui.js:24–45`.

**Evidence:** source inspection finds `role="dialog"`/`aria-modal="true"` and input focus, but no equivalent Tab containment/focus restoration. Arrow/Enter/Escape handling is local to the input. **Runtime keyboard/screen-reader reproduction remains UNVERIFIED.**

**Impact:** keyboard users may move behind the modal or lose their previous focus position.

**Correction:** reuse the shared accessible modal behavior, including background inertness/focus restoration, and expose command selection with appropriate accessible relationships.

**Verification:** test Tab/Shift+Tab containment, arrows/Enter selection and Escape returning focus to the invoking control; include a screen-reader pass.

### Documentation completeness and recommended structure

The audit read `CLAUDE.md`, the architecture, handoff, Studio/security/testing, Project Lab, multi-agent, Improvement Lab and release documents. `ENTERPRISE_READINESS.md` does not exist. `AGENTS.md` also does not exist; neither file was fabricated. The older `docs/release-readiness.md` is explicitly a v0.1.0 historical document and cannot stand in for current v0.2.0 assurance. A relative-file-link scan of 39 non-experiment Markdown files found no missing targets; it did not validate HTTP links or fragment anchors.

The README's Modify/Codex examples should explain remote consent and the default unmetered refusal before invocation. Native-provider guidance should distinguish a shell's PATH from other environment variables: the desktop helper imports PATH, not every `.zshrc` export such as `GHIDRA_INSTALL_DIR`.

Recommended organization, for a later documentation change:

```text
README.md                           product scope, release status, genuine screenshot, install choices
docs/index.md                       documentation entry point
docs/getting-started/                requirements, CLI install, Studio install, first project, providers/costs
docs/studio/                        navigation, editor/diffs/terminal, Review/Modify, Rebuild/screenshots,
                                    plan/approval/rollback, settings/troubleshooting
docs/reference/                     CLI, configuration, support-and-validation matrix
docs/security/                      trust boundaries, permissions/consent/secrets, sandbox/provider limits
docs/development/                   architecture, tests, contribution and release process
docs/releases/                      version-specific notes, with historical scope preserved
docs/assets/<release>/              genuine sanitized captures and capture manifest
docs/audits/                        dated findings and remediation status
```

MIT licensing, upstream attribution, contribution instructions, private vulnerability reporting and third-party notices are present. No attribution blocker was established. Signing, distribution support and reproducibility gaps remain separate from license hygiene.

## 5. Project Lab assessment

Review, Modify and Rebuild are implemented workflows, not placeholder screens. They detect projects, create working copies, run commands, collect evidence, write reports, record attempts and require explicit application. Acceptance checks, plan review, source/candidate identity checks and manual resume paths have meaningful automated coverage. Fresh desktop testing verified the normal Modify/apply/rollback path using a simulated coding agent and real project commands; the CLI/integration suite covers additional workflows.

Rebuild is constrained reconstruction against stated acceptance criteria. It is not evidence of general semantic equivalence to arbitrary software. Screenshot input validation, metadata removal, offline rendering, visual scoring and anti-picture-copy checks are implemented and executed by the integration tests. Perceptual similarity is an acceptance signal, not a proof of behavior or accessibility.

Historical `experiments/screenshot-rebuild/result.json` records a real Codex image run scoring 0.9271 and a later blind control scoring 0.1048. The first supposed no-image control scored 0.9614 but is explicitly invalid: Codex found the reference image elsewhere on disk. That invalid control must not be presented as independent success. One synthetic page and a heuristic threshold do not establish broad screenshot reconstruction quality.

The normal guards are useful, but H01 invalidates the assertion that every approved final patch passed protected-path checks; H02 invalidates the assertion that rollback always preserves later work; H03 invalidates static exposure-record guarantees after commands execute. These defects need backend corrections and adversarial regressions, not extra confirmation dialogs.

## 6. Multi-agent and coding-adapter assessment

The implemented team model is sequential role orchestration: architect, implementer and reviewer, with snapshots, evidence validation, bounded correction rounds and explicit capability/consent checks. It does not run competing writers concurrently. Assigning different roles to the same provider does not by itself prove independent judgments. Review findings are checked for structure/locations/quotes, which improves traceability but cannot establish their semantic correctness.

**MOCKED EXECUTION:** adapter and multi-agent tests cover argument construction, read-only verification, consent, spending refusals, corrective loops, failures and role handoffs. **REAL supporting execution:** Git, local commands and macOS isolation run in many of those tests. The tests do not establish real Claude+Codex end-to-end quality or model independence.

**Codex:** the fresh availability probe found `codex-cli 0.160.1` signed in. Historical `experiments/provider-validation/codex.json` records actual write/read-only/review, timeout and other adapter checks. No new generation was requested. The adapter reports tokens and `cost_usd:null`; there is no enforceable ERA dollar cap for this provider. The default unmetered refusal is therefore appropriate and was not disabled for the user's setup. Tokens alone are not a billing measurement.

**Claude Code:** the current audit process could not resolve `claude` on its PATH (`ENOENT`). Historical `experiments/provider-validation/claude-code.json` records CLI 2.1.260 available but signed out, with successful handling of that failure and the generation checks skipped. These are different environment observations, not evidence of a newly authenticated provider. The adapter passes `--max-budget-usd` and parses reported dollar costs, but a fresh authenticated task, cancellation under load and real mixed-provider budget behavior remain unverified.

Built-in provider CLIs run directly under their own isolation rather than the generic command adapter's outer wrapper. Their broad reads are a declared limitation. H03 additionally demonstrates a correctable failure in ERA's own per-workspace filtering. Third-party capability declarations and cost reports are trusted integration inputs, not independent attestation.

## 7. Improvement Lab assessment

The Lab has a real control loop and a stable evaluator: protected evaluator/ground-truth paths, candidate identity, test inventory/regression checks, baseline/candidate benchmarking, supervised REA self-analysis, bounded attempts, locks, explicit promotion and recovery. Fresh end-to-end tests exercise real disposable Git worktrees, approval, tagging, rollback and interruption with a **fake REA engine**. Real REA self-analysis and MCP are separately tested.

Its current scope is narrower than Studio-wide recursive improvement. `src/orchestration/versions.js:6,63–66` requires branch `main`. `src/self_analysis/self-analyze.js:23–34,64–73` stages the npm artifact plus JavaScript tests; the package allowlist omits `apps/studio`. Thus “every source module” coverage means the selected CLI/backend universe, not the full desktop product. Standalone REA analyses of Electron/web are recorded separately and have partial coverage; they are not Lab acceptance evidence for the whole UI.

The Phase 3B archives establish the following:

- E1 and E2 have `evaluation.accepted:true` and status **`awaiting-approval`**, not integrated. They were evaluated in a temporary clone, then their implementation/test patches were manually applied to the feature branch in `74b1f93` and `43d3536`.
- Archived patch hashes match candidate identities; stable Git patch IDs match those implementation/test changes. This supports the manual-application account. It does not establish an `era improve approve` event or integrated-version rollback for those cycles.
- Their targets were import-graph test-coverage findings for `system.js` and `jobs.js`, not GUI performance metrics. Each separately reduced findings from 37 to 36 against the same baseline; there is no combined E1+E2 archived Lab evaluation.
- Archived nested evaluations ran 296/300/303 total tests with **130 skips** each. Passing those selected tests is different evidence from the fresh full suite's 307/306/1 result.
- E3 was a reverted manual Electron experiment, not a rejected Lab cycle.

The changes themselves are sensible: successful REA status probes are cached and concurrent probes shared (`src/rea_integration/rea-client.js:88–102`); shutdown waits for actual exit within the existing grace window (`src/control_plane/jobs.js:257–273`). New tests exercise those behaviors. Cache freshness and a bounded fallback matter more than expanding the optimization without measurements.

Historical measurements show warm overview/tools medians of 891→2.2 ms and 905→1.7 ms. The matched-AC Electron smoke comparison is 4336→3103 ms for the combined E1+E2 state, ten samples per state. E2's 1503→29 ms result is a cooperative-child shutdown microtest, not application quit latency. E3's 3103→3099 ms is no demonstrated meaningful improvement. These figures were inspected, not rerun as independent performance benchmarks. Battery/AC differences, shared-machine noise, small samples, smoke versus first paint, and missing real-agent overhead measurements limit broader claims.

### M08 — MEDIUM: archived evaluations are not fully reproducible

**Affected:** `experiments/studio-improvement/E1-rea-status-cache/`, `E2-job-shutdown/`, performance evidence and `docs/ERA_STUDIO_SELF_IMPROVEMENT.md`.

**Evidence:** the original temporary base/candidate commits are absent from this repository's object database. Raw self-analysis paths are replaced with `<tmp>` without the corresponding output bundles/hashes or complete ledger. E2's inconclusive attempts survive as narrative summaries, including a Hopper timeout and stale-lock failure. Measurement JSON contains samples/environment but no embedded commit/tree/dirty-state identity.

**Impact:** patch/application correspondence can be independently checked, but exact original clone trees and raw REA evaluations cannot be reconstructed from tracked archives alone. This is an evidence-retention limitation, not evidence of fabrication. A successful retry does not diagnose the earlier intermittent failure.

**Correction:** retain a sanitized manifest with base/candidate trees or a Git bundle, immutable run IDs, raw-output hashes and a documented retention/retrieval policy, ledger events, rejected/inconclusive attempts and measurement revision metadata. Preserve the actual approval status.

**Verification:** on a new machine, reconstruct the candidate from the archived base/patch, verify hashes, replay the selected checks, and reconcile report decisions with ledger events. If raw artifacts must remain private, make their access and verification procedure explicit.

## 8. REA compatibility and genuine additional capabilities

The installed upstream package is `rea-agents@6.4.0`; its README/package metadata were inspected alongside the official project. Upstream already supplies native/application/runtime inspection, evidence, CLI/MCP access and agent setup. ERA should not claim those as its own novel engine capabilities. The comparison is anchored to the installed 6.4.0 package rather than assuming the moving upstream default branch has identical behavior. [Official REA project](https://github.com/morluto/rea).

**REAL EXECUTION:** the suite checks matching passthrough version and Mach-O Evidence identity, JavaScript analysis, single-file staging, Mach-O structural inspection without decompilation, supervised self-analysis, sandboxed runtime capture and a genuine MCP initialize/list/call session. The fresh CLI archive resolved REA from its installed dependency and returned 15 fixture facts. This supports retained compatibility for those interfaces; it is not exhaustive validation of every upstream command/provider.

ERA's independently evidenced additions are the persistent orchestration layer, normalized reports/provenance, guarded experiment lifecycle, external-project Review/Modify/Rebuild workflows, approval/rollback UI and integrated desktop workbench. These are genuine capabilities. Automated safety and broad enterprise readiness remain constrained by this report's findings. No evidence establishes a superior reverse-engineering engine or arbitrary reconstruction accuracy relative to REA.

Native-provider status needs qualification. With explicit Ghidra/JDK environment settings, `rea doctor --format json` recognized Ghidra 12.1.4, JDK 21 and Hopper as healthy. The overall audit-wide doctor still exited 1: it reported missing IDA registration and stale installed skill/client registrations. A plain-shell clean-install status saw Ghidra unavailable. No registration or environment repair was performed. Native decompilation quality, Hopper timeout behavior and all external-client registrations were not freshly validated by actual decompilation/client sessions.

## 9. Test results, effectiveness and CI/CD

### Fresh execution ledger

Environment: macOS 27.0.1, Apple arm64, Node 24.20.0, npm 11.19.0; Electron 44.7.1 with embedded Node 24.21.0. Original tracked files remained untouched. A local clone at the exact audited HEAD had its remote removed and received fresh root and Studio `npm ci` installations.

| Check | Result | Evidence classification and limits |
|---|---|---|
| Root and Studio locked installation | Both passed | REAL registry/local installation, not a clean OS/user account |
| `npm test` after clean installation | **307 total; 306 passed; 0 failed; 1 skipped; 191.1 s** | Mixed real/mocked suite; distinctions above |
| Skip | Non-macOS “runtime without sandbox” test | Expected on a host with the macOS sandbox; no blanket REA skip |
| `npm run lint` / `npm run check` | Passed | Static checks; not proof of security |
| `npm run test:desktop --prefix apps/studio` | **14/14 passed** | Real Electron/control plane/REA; simulated coding agent |
| `npm run package --prefix apps/studio` | Passed | Fresh unsigned local arm64 app |
| `npm run test:package --prefix apps/studio` | Passed, exit 0 | Real packaged launch, authentication, renderer Node disabled, REA reachable |
| `npm run clean-install-test` | Passed, 15 facts | Real independently installed CLI archive and REA |
| Root production `npm audit` | 0 vulnerabilities reported | Advisory database result, not an application penetration test |
| Studio production `npm audit` | 2 LOW package entries | L03; no fresh Studio exploit established |
| Registry signature audit | Passed | Dependency registry signatures; not desktop signing |
| `era agents` | Codex available/signed in; Claude unresolved on audit PATH | Real availability/auth probes only |
| `era studio doctor` | Listed prerequisites passed | Local host check |
| Explicit-env `era rea doctor --format json` | Exit 1 overall; Ghidra/Hopper healthy | REAL diagnostic; registration drift/optional IDA gaps remain |
| H01/H02/H04/H05, M01–M03 probes | Promised controls/functionality failed as described | REAL isolated fixtures; only audit-owned files/processes |
| H03 exposure probe | Withheld files reached adapter boundary | REAL workflow/commands; MOCKED remote adapter, no transmission |
| Authenticated Claude generation, live mixed-provider team | Not run | UNVERIFIED |
| New Codex generation, broad provider confinement | Not run | Historical evidence inspected; not freshly certified |
| Windows/Linux Studio, signing/notarization, clean-machine UX, formal accessibility | Not run | UNVERIFIED |

The initial test setup reused dependencies through symlinks. That first run produced 303 passes, three fixture-copy errors and one skip: the e2e helper's `git ls-files -co` included the Studio dependency symlink and `cpSync` refused to copy its directory without recursive mode. The audit corrected its temporary environment with actual locked installs and reran the full suite without source changes. The final result above is the clean-install run; the initial harness failure is retained rather than presented as a product regression. An initial convenience command named a nonexistent root Studio test script; the correct documented prefix command was then used successfully.

The tests provide meaningful evidence: many assert actual files, evidence IDs, process outcomes and refusal behavior. The uncovered cases concern transitions and adversarial command effects, not just missing line coverage. Add tests around exactly those boundaries. Do not respond by weakening sandbox checks, enabling unmetered providers globally, or increasing timeouts to hide failures. Time and memory regression gates use small fixture workloads and noisy shared-host measurements; they do not establish production scalability.

### M04 — MEDIUM: CI does not validate the desktop artifact

**Affected:** `.github/workflows/ci.yml:27,37,68`; `.github/workflows/release-validation.yml:28–40`; `tests/studio-dependencies.test.js:15–20`; `tests/screenshot-rebuild.test.js:28`.

**Evidence/impact:** hosted workflows install/audit the root package and pack/attest the CLI. They do not install Studio dependencies, run Electron scenarios, build the desktop app or smoke-test the distributed app. Monaco checks explicitly skip without its package; renderer tests skip without Electron. A green CLI pipeline therefore does not cover those Studio paths.

**Correction:** add required macOS Studio installation, production audit, non-skipped dependency/reachability and renderer checks, Electron scenarios, package build and packaged smoke. Produce a desktop SBOM/provenance record tied to the exact artifact, separate from CLI provenance. Define supported platforms explicitly.

**Verification:** execute on a fresh runner, prove relevant checks ran rather than skipped, deliberately break a desktop check on an isolated test branch to confirm the gate fails, and reconcile artifact version/revision/checksum with workflow output. This audit inspected workflows and ran their relevant local components; it did not launch or publish a new hosted release.

### Evidence location and retention

Fresh audit logs and genuine screenshots were produced outside the original repository in the disposable directory `<TMPDIR>/era-independent-audit-5o7gvg2b/`. Relevant files are `evidence/npm-test-clean.log`, `desktop.log`, `clean-install.log`, `package.log`, `package-smoke.log`, `root-audit.json`, `studio-audit.json`, `agents.log`, `studio-doctor.log`, `rea-doctor.json`, and the clone's `apps/studio/out/validation/desktop-tests.json`/PNGs. The desktop manifest is timestamped `2026-10-14T15:37:00.040Z`.

The H01–H03 synthetic reproduction summary is `<TMPDIR>/era-phase5-project-cokMAa/results.json`; its local harness is `/tmp/era-phase5-project-repros.mjs`. Their essential observations are included in the finding text so the verdict does not depend on persistent availability of temporary files. These temporary artifacts were not added to the repository because this audit authorized only the report. Preserve a sanitized evidence bundle separately if long-term release attestation is required.

## 10. Release blockers

1. **H01:** final verification must cover the exact patch offered for approval, including command-generated changes.
2. **H02:** destructive rollback must preserve later user data and history.
3. **H04/H05:** untrusted project inspection/execution must not escape the declared host boundary through Git configuration or process signalling.
4. **H03:** exposure filtering must hold at each provider boundary, not only at initial copy time.
5. **M01/M02:** malformed local requests and permission revocation must not invalidate supervision or access policy.
6. **M03/M04:** the working-copy terminal and a required Studio release-validation path must work before advertising the desktop workflow as supported.
7. Consolidate current installation/support evidence, retain reproducible evaluation records, and define the distribution contract. Unsigned local launch is insufficient evidence for a signed, broadly distributed enterprise product.

For a deliberately limited local development prerelease, signing and some documentation improvements can be labeled limitations. The five HIGH findings still require correction before claiming safe handling of untrusted projects or protected enterprise workflows. Lack of SSO/RBAC is a support-scope limitation for this local application; adding those features would not fix the verified local failures.

## 11. Prioritized fixes for Claude Code

Continue from the audited branch after reading `CLAUDE.md`, this report and the updated handoff. Inspect `git status` before edits and preserve concurrent work. Keep the existing architecture and reproduce each failure with synthetic fixtures. The following is a remediation plan, not authorization from this audit to publish changes.

| Priority | Required work | Completion evidence |
|---|---|---|
| **P0.1** | Fix H01 in Modify/Rebuild final-state verification and approval binding | Protected and oversized test-time changes reject; unchanged valid candidates still approve |
| **P0.2** | Fix H02 with deletion-complete manifests or conservative generated-file removal | New/changed Git and excluded-directory data survives or causes refusal |
| **P0.3** | Fix H04 safe Git inspection and H05 process/read confinement | No filter escape; external sentinel survives; unrelated synthetic content unreadable; normal tooling works |
| **P0.4** | Fix H03 using current, filtered, scanned invocation views and per-call exposure records | All role/resume/correction fake-adapter canaries withheld or blocked |
| **P1.1** | Fix M01 guarded HTTP parsing and M02 terminal revocation/lifecycle | Malformed requests leave server alive; revoked sessions cannot continue writing |
| **P1.2** | Fix M03 workspace terminal permissions without broadening other-state access | Real workspace read/build/test succeeds; other-state and outside-write checks fail |
| **P1.3** | Add M04 desktop CI/package gates and artifact-specific evidence | Fresh runner executes non-skipped Studio checks and verifies packaged artifact |
| **P1.4** | Resolve M05/M06 and M08 installation/status/evidence inconsistencies | Fresh installation walkthrough; revision-specific capability matrix; reconstructable experiment records |
| **P2.1** | Address M07/L01/L02 help, genuine screenshots and keyboard behavior | Offline help walkthrough, real capture manifest, keyboard/screen-reader validation |
| **P2.2** | Resolve or formally track L03 at the shipped-bundle level | Patched compatible bundle or maintained reachability exception with tests |

After the P0/P1 corrections, rerun targeted adversarial regressions, the full suite, real REA/MCP, desktop scenarios, clean CLI installation and packaged smoke on the exact candidate revision. Obtain separate explicit authorization before any real provider validation that requires sign-in or an unmetered/cost-policy change. Retain provider/model/version, usage, result and limitation metadata. Do not describe mocked mixed-agent results as live-provider validation.

## 12. Final release-readiness verdict

**NOT READY.**

ERA is a functional local development system with real REA compatibility and meaningful added orchestration/desktop capabilities. It is not ready for the requested general v0.2.0 enterprise release because independently reproduced security and data-loss defects violate its core approval, isolation, exposure and rollback promises.

The successful 306/307 suite, 14/14 desktop run, clean CLI install and packaged launch establish a useful development baseline. They do not override the five HIGH findings. Release readiness should be reassessed after the prioritized fixes and adversarial verification on the exact intended release artifact. No implementation change or publication was performed as part of this audit.
