# ERA Independent Technical Audit

**Date:** 2026-10-13 (Europe/Berlin)  
**Verdict:** **NOT READY** for the first public release in its current form.  
**Audited revision:** `5ce907f924fa3c56dc16440745d28c59a10a40c9`, branch `main`.  
**Internal checkpoint:** `era-v4` → `b3f6c24d90f90d4b0226e2992d53b066a7a4f766`.  
**Package version:** `0.1.0`, unreleased.  
**Method:** independent source review, Git inspection, actual execution of existing tests and benchmarks, examination of retained raw experiment evidence, and isolated adversarial probes. This is a technical audit, not a security certification.

## 1. Executive summary

ERA executes the real REA engine and delivers useful analysis orchestration, normalized results, experiment management, and measurement. It is not merely documentation around mocked functionality. The current macOS suite passes **107 tests, with 1 expected platform skip and no failures**. All **six real-REA integration tests** pass. Real MCP communication, native runtime sandbox enforcement, clean installation, and a fresh three-repetition benchmark also pass.

The Improvement Lab nevertheless does not enforce several central guarantees:

- Approval can merge changes made to the experiment branch **after evaluation**.
- The protected self-analysis evaluator accepts candidate-supplied fabricated evidence without executing or authenticating REA itself, even when the candidate process exits unsuccessfully.
- Candidate tests and code execute with host permissions before protected changes are rejected. A Git worktree is version isolation, not a security boundary.
- The decision policy can accept equally broken benchmarks and substantial test deletion.
- An imported analysis can cause unrelated local file content to be included in a reasoning-provider request.

These defects are release blockers. Passing the existing suite does not test these adversarial cases. There are also concurrency, budget enforcement, privacy, evidence retention, inference accuracy, Linux CI, and release packaging defects.

**Finding totals:** 0 CRITICAL, 5 HIGH, 9 MEDIUM, 1 LOW. Severity reflects demonstrated behavior and realistic impact; this audit did not establish a remotely exploitable critical vulnerability or discover a live credential.

The historical experiments have meaningful supporting evidence. All **49 raw-output manifest entries** across cycles 1–5 match retained local output hashes. For experiment 5, independently rerunning the stable rules on the raw outputs reproduces **27 → 9 findings**. Its candidate tarball digest matches, and all **56 staged focus files** match experiment commit `0d86a9e`. These checks support the recorded experiment, but do not make the current evaluator resistant to manipulation.

## 2. Scope, repository identity, and method

The initial working tree was clean. Inventory: **231 tracked files**, **35 source/entrypoint files** under `src/` and `bin/`, and **16 test files**. Review covered the source modules, test design and fixtures, package metadata and lockfile, three workflows, scripts, all development/validation documents, benchmark definitions/results, exported experiments, relevant local raw evidence, and reachable Git history. Upstream comparison used the installed REA 6.4.0 package, registry metadata, and the original repository.

There were 25 commits reachable through all local refs, five retained experiment branches, and four internal version tags. No Git remote was configured. Target repository identity is declared as `dav1dngy/era-agent` in package metadata; its hosting settings, access controls, branch protection, Actions execution, and publication status were not independently verified.

Relevant history:

| Commit | Significance |
|---|---|
| `009469e` | Initial ERA implementation / era-v1 |
| `8e14673` | Experiment 2 integrated as era-v2 |
| `f044185` | Experiment 3 integrated as era-v3 |
| `99cbe8f` | Approval gate, agents, sandbox, logging and MCP tests |
| `1b874d6` | Watchdog, experiment rebase and release tooling |
| `b7eafaf` | Mach-O integration test made independent of Hopper |
| `b3f6c24` | Experiment 5 integrated as era-v4 |
| `0ba3a43` | Experiment 5 approval/evidence export |
| `5ce907f` | Privacy/security preparation; audited HEAD |

HEAD is two commits beyond era-v4. `git diff era-v4 HEAD -- src bin package.json package-lock.json .github` is empty: runtime implementation and those configuration surfaces are the same. Export/privacy scripts and documentation differ. Internal `era-vN` tags are distinct from semantic package releases.

Execution host: Darwin arm64, Node **24.20.0**, npm **11.19.0**, installed REA **6.4.0**, with Hopper available. Tests and probes used temporary directories and disposable repositories. No implementation file was edited, no experiment was run against the real stable branch, and no Git publication, registration of agent clients, or paid model invocation was performed. The only requested repository addition is this report. Existing tests may write ignored local logs/state; audit-specific outputs were directed outside the repository.

Evidence labels below distinguish **executed**, **historical evidence verified**, **code inspection**, and **not exercised**. A synthetic exploit probe demonstrates acceptance behavior, not that previous experiments were malicious.

## 3. Architecture and enterprise engineering assessment

### Structure and separation of concerns

The design is a small Node ESM CLI: entrypoint → lazy command handlers → analysis/Lab services → REA and Git subprocesses. `ReaClient` centralizes ERA-managed REA invocations and their run records. Analysis detection, fact extraction, reporting, planning, evaluation, safety, agents, and orchestration have separate modules. REA remains an external dependency rather than a fork.

This is a reasonable foundation for a local experimental tool. Interfaces for coding agents and reasoning providers support substitution and fake-based contract tests. Structured logs carry execution and correlation IDs. Explicit argument arrays are used for normal engine and Git execution; shell execution is limited to configured command providers. Dashboard table values are HTML-escaped.

### SOLID and maintainability

| Principle / concern | Assessment |
|---|---|
| Single responsibility | Most modules are focused. The 371-line cycle controller combines state transitions, locking, policy, Git mutation, evaluation, persistence and report generation; extracting a state store and evaluation transaction would make invariants easier to enforce. |
| Open/closed and interface segregation | Small agent/provider interfaces are useful. Adding a backend still requires edits to hardcoded registries/switches, reasonable at this size. No need for a plugin framework merely to satisfy a principle. |
| Substitution | Fake adapters exercise the interface but cannot prove behavior of installed Claude Code/Codex versions. Optional cost fields weaken the meaning of “metered.” |
| Dependency inversion | Engine/agent boundaries exist, but protected evaluation imports mutable process and utility modules and trusts candidate-owned output. Architectural separation is not enforced isolation. |
| Data contracts | Plain JSON is used without systematic schemas, discriminated lifecycle states, or runtime validation. Corrupt state and malformed evidence can throw or fail open. |
| Persistence | Direct JSON writes and append-only-in-convention JSONL are simple, but not transactional, tamper-resistant or crash-atomic. Recovery does not establish exclusive ownership. |
| Error handling | Typed REA errors, timeouts, nonzero exits and partial analysis results are generally handled. Missing runtime evidence, failed self-analysis exit codes, and output-stream errors are exceptions. |
| Testing | Broad functional coverage across CLI, process groups, Git, sandbox and MCP. No measured line/branch coverage or coverage threshold was established; import-graph “untested module” findings are not execution coverage. |
| Dependencies | One direct production dependency hides a substantial transitive tree. Exact REA pin and lock integrity are positive. Current registry vulnerability/signature checks pass; that is not a proof against undisclosed vulnerabilities. |
| Developer experience | Clear CLI, source install, examples, config and troubleshooting. Packaged Analysis Mode works. Lab/benchmark commands require a source checkout with tests/datasets, which are excluded from the npm tarball. |

Avoid a rewrite. Repair trust boundaries and lifecycle invariants, then improve validation and documentation incrementally.

### Performance and operational limits

The analysis command probes native providers before normal JS/archive analyses unless `--no-decompile` is used (`src/commands/analysis.js:14`). This is unnecessary work for those targets. Earlier measurements report about 1.7 seconds overhead; this audit did not rerun the direct-REA overhead comparison. The fresh full benchmark is in section 7.

Native startup is noisy and the five authored fixtures are small. Scores do not establish enterprise-scale accuracy, throughput, large-archive resilience, or malicious-input robustness. No load/fuzz campaign was performed. State directories grow without a retention policy; benchmark runs delete detailed evidence immediately. Synchronous filesystem operations are acceptable for the present CLI but are a constraint for future concurrent or server use.

## 4. REA compatibility and attribution

Registry metadata identifies `rea-agents@6.4.0` with upstream commit `a56f7bb668ab23fec8d33f7af353ac7ed2fe1895`. Its registry integrity equals the lockfile integrity. ERA invokes the original installed engine. Upstream already provides CLI and MCP workflows, native providers, JS/Electron inspection, artifact inspection, process capture, agent setup, and evidence facilities. Those are inherited capabilities, not ERA inventions. See the [version-pinned upstream README](https://github.com/morluto/rea/blob/a56f7bb668ab23fec8d33f7af353ac7ed2fe1895/README.md).

| Capability | Audit result |
|---|---|
| Original CLI passthrough | Actual execution: engine version matches; direct and wrapped Mach-O inspection return equal Evidence IDs and target digests. Arguments/stdin/stdout are forwarded. All individual upstream commands were not exhaustively tested. |
| JavaScript directory/single-file workflows | Actual execution through REA, including real import facts and single-file staging. |
| Mach-O structure | Actual execution through REA; integration test uses `--no-decompile` to avoid provider flakiness. |
| Native decompilation | Actual Hopper-backed execution in the fresh benchmark; recorded fixture evidence also inspected. Ghidra/IDA not exercised. |
| ZIP inventory | Actual execution in the fresh benchmark. Other archive extensions and ASAR are routed but not independently exercised here. |
| Native runtime capture | Actual REA capture under the macOS sandbox; write/network probes pass. |
| MCP server | Actual JSON-RPC initialize, tools/list and analyze-JavaScript tools/call through `era rea mcp`; MCP doctor passes. The test requires at least 150 tools and specific names; it does not assert the documented exact count of 170. |
| Claude Code / Codex as MCP clients | Protocol-level compatibility is supported by the real generic MCP session. Actual client registration and interactive client sessions were not exercised. Upstream supplies setup. |
| Claude Code / Codex as coding agents | Fake CLI adapter tests pass. They verify flags/parsing, not actual model execution or permissions. No paid model call was made. |
| Remote reasoning | Opt-in logic and local command/fake boundaries tested. No live remote reasoning invocation. |
| ELF/PE, .NET, Android, firmware, browser/Electron runtime | Upstream workflows may be reached through passthrough; ERA's high-level analysis mode does not implement general routing for them. Not exercised. |

`era rea mcp` exposes **REA's tools**, not a new ERA MCP server for the Improvement Lab. Likewise `era rea setup` forwards setup to REA. Passthrough intentionally bypasses ERA-managed run recording and the ERA runtime sandbox; users must not assume `era rea capture-process` has the protections of `era analyze --runtime`.

REA's MIT text is preserved verbatim in `THIRD_PARTY_NOTICES.md`, confirmed against the installed LICENSE. ERA has its own MIT license and clear upstream attribution. No copied or vendored REA implementation was identified in ERA source. This supports the attribution review, not blanket clearance of commercial provider/demo terms. The upstream [license](https://github.com/morluto/rea/blob/a56f7bb668ab23fec8d33f7af353ac7ed2fe1895/LICENSE) remains the source for REA's terms.

There is intentional overlap in engine status, evidence storage and workflow wrappers. ERA adds process metadata and normalized facts; it should describe this as integration rather than imply REA lacks evidence/reporting concepts. The CommonJS export inference is genuinely new ERA logic, with an accuracy defect described in F12.

## 5. Improvement Lab assessment and experiment evidence

| Required property | Assessment |
|---|---|
| Real self-analysis | Confirmed in the real integration test and historical raw outputs. The pipeline packs source, stages multiple JS passes and captures packaged CLI help through REA. |
| Proposal generation | Implemented deterministic rule/ranking/hypothesis pipeline; not an LLM planner. Evidence-derived findings and benchmark gaps supply candidates. |
| Coding-agent integration | Manual workflow historically evidenced; headless adapters fake-tested only. |
| Worktree isolation | Actual Git worktrees and branches work. They isolate checkouts, not host access or Git common metadata. F03 applies. |
| Automated tests | Real Node test execution exists. Candidate-owned test suite and shared helpers are insufficiently protected; F05 applies. |
| Reproducible benchmarks | Fixed authored targets/truth and repeated measurements exist. Raw run retention and revision/environment provenance are insufficient; F09 applies. |
| Acceptance | Frozen stable criteria and guards exist, but evidence authentication and validity checks fail open (F02/F05). |
| Rejection | Actual historical rejections in cycles 1 and 4; fake-engine end-to-end rejection test passes. |
| Rollback | Disposable Git tests confirm restoring a tagged tree as a new commit, including deleting files added later. The real stable checkout was not rolled back. |
| Stable protection | Clean-main/base checks and explicit promotion exist. Candidate branch drift, unrestricted candidate processes and concurrency undermine them. |
| Human approval | Current CLI requires interactive confirmation or `--yes`; this is a local workflow acknowledgement, not authenticated identity/RBAC. The approver name can be supplied. F01 applies. |

### Historical results, checked against artifacts

| Cycle | Recorded outcome | Findings | Tests: baseline → candidate | Accuracy F1 | Raw-output hash matches |
|---|---|---|---|---|---|
| 1 | Rejected | 7 → 9 | 62 → 64 passed | 0.955883 → 0.986652 | 4/4 |
| 2 | Accepted, era-v2 | 7 → 6 | 62 → 64 passed | 0.955883 → 0.955883 | 7/7 |
| 3 | Accepted, era-v3 | 6 → 5 | 64 → 66 passed | 0.955883 → 0.986652 | 10/10 |
| 4 | Latest evaluation rejected | 26 → 9 | 104 passed/1 failed/1 skipped → 106 passed/1 failed/1 skipped | 0.986652 → 0.986652 | 14/14 |
| 5 | Integrated, approval recorded, era-v4 | 27 → 9 | 104 passed/1 failed/1 skipped → 107 passed/0 failed/1 skipped | 0.986652 → 0.986652 | 14/14 |

The final benchmark records for these cycles report error rate zero. Experiment 4's earlier evaluation was explicitly documented as having invalid native benchmarks on both sides; a later evaluation rejected it. F05 explains why identical benchmark failures can pass today's relative guards.

Cycles 2 and 3 predate the approval gate and were automatically integrated. Cycle 1 was rejected, so README's wording that “cycles 1–3 ... were merged automatically” is overbroad. Experiment 5 contains an approval event and matching merge/tag; the files establish an approval record, not independent authentication of the human behind it.

For experiment 5 specifically:

- All seven baseline and seven candidate records indicate successful actual REA operations and have matching local raw-output hashes.
- Reapplying current stable `runRules` to those raw outputs yields exactly the recorded finding IDs: 27 baseline and 9 candidate.
- The retained candidate tarball matches digest `b2f204b2856dbff05c1e893c771841926dbb26f44ddf2294f8f734626954c96b`.
- All 56 candidate focus files are byte-identical to the corresponding files at experiment commit `0d86a9e`.
- The baseline test failure was the self-analysis coverage test; the candidate fixed it. The headline “104 → 107, 0 failed” must distinguish candidate success from the failing baseline.

These are substantial consistency checks. Historic TAP/benchmark aggregates were not all independently regenerated at their original revisions, and the retained records are unsigned local artifacts. Public exports contain hashes rather than the full raw self-analysis outputs, so a public clone alone cannot repeat all checks above. Anonymized evidence retains original IDs/digests that cannot authenticate the redacted bytes; this is documented in the release-readiness report and must remain explicit.

## 6. Findings and security review

Severity: **CRITICAL** = demonstrated immediate catastrophic compromise; **HIGH** = substantial trust-boundary, integrity or disclosure defect; **MEDIUM** = consequential control/reliability/release defect; **LOW** = documentation or minor maintenance defect. No CRITICAL finding was established.

### F01 — HIGH — Approval is not bound to the evaluated experiment commit

**Component:** `src/orchestration/cycle.js:259`, `src/orchestration/versions.js:105`.

**Technical explanation:** Evaluation saves a branch name and results, but no enforced immutable candidate commit/tree binding. Approval checks stable HEAD against `base_commit`, then merges the current `cycle.branch`. It does not verify the branch still points to the evaluated candidate or recheck its protected-file diff.

**Impact:** A normal follow-up commit or compromised agent can add unevaluated changes, including protected evaluator changes, after approval readiness was recorded. The maintainer may approve a saved patch while different code is integrated.

**Verification performed:** In a disposable repository, seeded an awaiting-approval record representing an evaluated branch, advanced only the experiment branch, then invoked the real `approveCycle`. Result: `integrated`, and stable contents were the unevaluated version. No real ERA branch was changed.

**Required solution:** Record candidate commit, tree and patch digest after all candidate execution; require exact equality under an exclusive lock at approval, validate acceptance/evidence bindings, and merge that immutable commit. Any branch movement must invalidate evaluation.

**Fix verification:** Evaluate A, add B to the experiment branch, approve: must refuse and leave stable HEAD/tag/state unchanged. Include a protected-file B and a branch move during evaluation.

### F02 — HIGH — Candidate-supplied self-analysis evidence is trusted

**Component:** `src/evaluation/self-eval.js:20–44`, `src/self_analysis/rules.js:42,137`, `src/evaluation/benchmark.js:18–38`.

**Technical explanation:** `evaluateSelf` parses the candidate's stdout without requiring exit 0 or absence of timeout/signal. It loads arbitrary candidate-nominated `output_file` paths and trusts claimed successful operations. There is no authenticated engine execution, evidence schema/digest-to-source verification, or requirement for successful runtime capture. Coverage is only the presence of module names in merged graphs, which can also come from placeholders. Benchmark facts likewise originate from candidate JSON.

**Impact:** A candidate can invent, replay or omit evidence, remove findings by failing runtime capture, claim source coverage without analysis, or return benchmark answers without running REA.

**Verification performed:** A disposable candidate printed a handcrafted report and graph containing its tracked module names, exited **7**, and used a nonexistent REA command. The evaluator returned a report with `missing_modules: []` and no runtime measurement. REA was never invoked. This proves evaluator acceptance of a forged report, not a full malicious promotion.

**Required solution:** Have the stable supervisor own engine invocation and immutable evidence storage, validate process success and schemas, bind inputs to candidate content digests, and require each source file to be analyzed as real focus content. Treat missing/incomplete required runtime/static evidence as invalid evaluation. Verify benchmark facts against supervisor-owned evidence and prevent truth-file access by candidate processes where feasible.

**Fix verification:** Reject forged/replayed paths, wrong source digests, nonzero exits with valid JSON, omitted/failed capture, placeholder-only coverage, and candidate JSON that claims success without an engine record.

### F03 — HIGH — Unapproved candidate code executes with host authority

**Component:** `src/orchestration/cycle.js:155–185`, `src/evaluation/tests.js:12–18`, `src/evaluation/self-eval.js:20–23`, `src/evaluation/benchmark.js:18–25`, `src/agents/coding-agents.js:17–18`.

**Technical explanation:** Candidate tests, CLI and packaged help execute as ordinary host subprocesses with inherited environment and unrestricted filesystem/network permissions. Protected changes are checked only in the final decision, after candidate execution. Worktrees share Git metadata. The narrow native-target sandbox is not used for Lab candidate evaluation.

**Impact:** Accidental or injected candidate code can modify stable files, Git refs, evaluator state or credentials before rejection or human approval. A coding agent's own sandbox does not protect the separate subsequent evaluation process.

**Verification method:** Source inspection of spawn options and evaluation order. Probes executed only benign disposable candidates; no real credentials or stable files were accessed. Protected-path helper checks confirm mutable process/engine/orchestration modules and most tests are not protected.

**Required solution:** Reject prohibited changes before execution. Run candidate evaluation in an OS-enforced isolated environment with a sanitized environment, private writable state, immutable evaluator/tests/inputs, no stable checkout/Git metadata write access and default-denied network. If that cannot ship now, disable automated/untrusted Lab execution and explicitly gate it as trusted-code execution until isolation is delivered.

**Fix verification:** Disposable malicious candidates must fail to write a stable sentinel, alter common Git refs, access a synthetic credential, or contact a local test endpoint. Fail closed when isolation is unavailable.

### F04 — HIGH — Imported analysis can disclose unrelated local files to a provider

**Component:** `src/commands/analysis.js:43–58`.

**Technical explanation:** `era explain` accepts an arbitrary analysis JSON path, then reads the JSON's unrestricted `report_path` and includes its contents in the provider prompt. An attacker can choose a different local file or a symlink. Remote opt-in authorizes the explanation request, but does not establish that this unrelated file is part of the selected analysis.

**Impact:** A shared/crafted analysis can cause private documents or credentials to be sent to an authorized remote provider. Token-pattern redaction cannot sanitize arbitrary private text.

**Verification performed:** Used a synthetic private document and a crafted analysis in temporary storage. A local `cat` reasoning provider received that document through the real explain command, exit 0. No remote provider or actual private data was used.

**Required solution:** Validate imported analysis schemas and provenance. Derive report content from validated facts or constrain canonical report paths to the selected analysis bundle with symlink-safe checks. Make any external attachment an explicit separate user selection.

**Fix verification:** Reject absolute unrelated paths, parent traversal and symlink escapes; assert synthetic outside content never reaches provider stdin.

### F05 — HIGH — Acceptance permits invalid benchmarks and erosion of tests

**Component:** `src/evaluation/decision.js:41–58`, `src/evaluation/tests.js:18`, `src/safety/policy.js:17–26`.

**Technical explanation:** Benchmark guards are relative: equally bad baseline/candidate error rates and reliability pass. Baseline test success is not required or classified. Candidate tests only need exit 0, no reported failures and at least one pass; most existing tests and shared fixtures/helpers can be deleted or weakened without a protected-path rejection.

**Impact:** A finding reduction can be accepted with broken benchmark workflows or far fewer safety checks. This weakens the claimed independent validation contract. Baseline defects sometimes are legitimate repair targets, as cycle 5 demonstrates, but need explicit classification rather than silent disregard.

**Verification performed:** Called the real decision function with baseline/candidate error rate **0.4**, reliability **0.6**, an invalid baseline test result, candidate pass count **1** versus baseline **100**, and a resolved finding. Result: **accepted**, every guard passed. Historical cycle 4 documents the same relative-benchmark problem.

**Required solution:** Add absolute validity gates for required cases and measurements; invalid infrastructure results should be inconclusive. Run a trusted baseline test inventory against candidates and require separate review for test removal/weakening. Permit documented baseline bug fixes only when unrelated required tests/benchmarks remain valid.

**Fix verification:** Equal failures must not pass; deleting/skipping baseline tests must not improve acceptance; a genuine repair of a specifically identified baseline defect must still be possible with full evidence.

### F06 — MEDIUM — Single-writer and crash-recovery guarantees are incomplete

**Component:** `src/safety/policy.js:103–135`, `src/orchestration/cycle.js:116,259,284–336`, `src/core/util.js:27–35`, `src/commands/info.js:111`.

**Technical explanation:** Lock acquisition is check-then-write rather than exclusive creation. Several mutators, including implementation and rollback, do not participate in the lock. `recoverState` proceeds even if `clearStaleLock` finds a live holder, and resets evaluating cycles. JSON writes and multi-step merge/tag/ledger updates are not atomic transactions.

**Impact:** Concurrent commands can interfere with evaluation, overspend budgets, alter branch state, delete active benchmark worktrees, or leave an integrated tree with incomplete state after a crash.

**Verification performed:** With a live lock owned by the probe, called real recovery on a disposable evaluating cycle: it changed the cycle to `proposed`. Other race/crash windows were identified by inspection, not stress-tested.

**Required solution:** Exclusive lock creation with ownership token, guarded state transitions for every mutator, revalidation inside the lock, refusal to recover a live owner, atomic file replacement and an idempotent promotion/recovery journal.

**Fix verification:** Competing processes must yield one owner; live recovery must refuse; injected failures after merge/tag/state writes must recover without duplicate integration or lost decisions.

### F07 — MEDIUM — Advertised hard execution and cost limits are not enforced end to end

**Component:** `src/safety/policy.js:35–72`, `src/orchestration/cycle.js:34–41,112–135`, `src/agents/coding-agents.js:66–100`, `src/commands/lab.js:56–68`.

**Technical explanation:** `limits.commandTimeoutMs` is calculated but never passed to the relevant evaluation calls. REA-run budget accounting happens after a complete self-analysis, not before dispatch, and re-evaluation/rebase can repeat work. Per-cycle dollar caps apply per invocation, allowing repeated implement calls to exceed the cycle cap. Missing/non-finite/negative cost reports are not conservatively reconciled; missing cost contributes nothing to the total. Implementation does not call the CI refusal guard. Config/CLI numeric values, including benchmark repetitions, lack consistent validation.

**Impact:** Work and spending can exceed described limits; an existing cycle can invoke a coding agent in CI despite the broad “self-improvement disabled in CI” claim.

**Verification method:** Call-site review and parser probe: a successful Claude JSON result with no cost parses as `isError: false, cost: null`. No paid execution was performed.

**Required solution:** Centralize dispatch limits; reserve budget atomically before each launch, account cumulatively per cycle and campaign, hold unknown spending until reconciled, check CI on all mutation/agent paths, and validate positive bounded integer repetitions/deadlines.

**Fix verification:** Test repeated implement calls, missing/negative/non-finite costs, interruption before cost reporting, CI implement, a one-run REA cap and a short configured deadline. None may exceed the declared policy.

### F08 — MEDIUM — Coding prompts and persisted/exported state bypass redaction

**Component:** `src/agents/coding-agents.js:27–38,95–101`, `src/orchestration/cycle.js:134–135`, `src/orchestration/ledger.js:10–14`, `scripts/export-experiments.mjs:15`.

**Technical explanation:** Coding prompts append finding/instruction text without `redactText`. Agent output tails are saved to cycle JSON unredacted. Run records/stderr and ledger are not passed through the structured logger's redactor. The export helper anonymizes paths but does not redact secrets. Files use default filesystem permissions. Prompt warnings are advisory; the agent-prompt test named “fences” only verifies warning phrases and does not establish injection resistance.

**Impact:** Secret-bearing analyzed text or agent output may reach a model, local state or a publication export despite broad redaction claims. Default shared-host permissions may expose sensitive artifacts.

**Verification performed:** A synthetic API-key-shaped canary was preserved verbatim by `agentPrompt`. No actual key was used. Current published-tree/history scans were clean (see below).

**Required solution:** Separate private immutable raw evidence from sanitized display/export data; use restrictive state permissions, redact at every model/export boundary, include generic sensitive assignments/URLs where appropriate, and test the entire data path. Preserve redaction/digest provenance. Do not treat textual fences as a sandbox.

**Fix verification:** Synthetic secrets in findings, output tails, stderr and exports must not leave the intended private evidence store; state must be owner-only. Include prompt-delimiter injection cases without granting tools beyond the isolated worktree.

### F09 — MEDIUM — Benchmark evidence is discarded and provenance is incomplete

**Component:** `src/evaluation/benchmark.js:46–103,140`, `scripts/export-experiments.mjs`, `benchmarks/results/`.

**Technical explanation:** Benchmark runs retain summaries but delete temporary analysis/run outputs and omit individual repetition samples, exact source revision, dirty state, dataset digests and full environment/provider identity. CLI labels use the nearest version tag, so audited HEAD is called era-v4 despite being two commits later. Public experiment exports omit raw self-analysis outputs.

**Impact:** Public reviewers cannot independently recompute medians/fact scoring or authenticate all successful-experiment claims from a clone. Regression investigation and attribution to exact builds are weakened.

**Verification method:** Inspected benchmark cleanup and the fresh result schema. Verified historical hashes only because local raw files were available. Those files are absent from the public export format.

**Required solution:** Retain per-repetition facts, run records and content-addressed evidence with commit/tree, configuration, dataset, engine and provider identifiers. Produce a redacted public evidence bundle with separate raw/redacted digests and explicit transformation metadata. Preserve privacy rather than publishing local raw files unchanged.

**Fix verification:** A clean clone plus published audit bundle must recompute all aggregate values and trace each fact to a verifiable engine output without accessing the author's local state.

### F10 — MEDIUM — Linux test job contains an unconditional macOS path assertion

**Component:** `tests/sandbox.test.js:21–25`, `.github/workflows/ci.yml:39–54`.

**Technical explanation:** The platform-independent profile-format test requires a writable path beginning with the macOS canonical temporary-directory prefix. The Linux job runs it with ordinary Linux temporary paths; only subsequent execution tests are platform-skipped.

**Impact:** The advertised Linux CI lane fails independently of real REA availability; nested Lab evaluations on Linux inherit that failure.

**Verification method:** Source review and a Linux-style path assertion probe reproduced the mismatch. No Linux runner was available/executed in this audit; this is not reported as a completed Linux CI run.

**Required solution:** Assert against the actual canonical scratch path, not a platform-specific prefix. Separate platform-neutral profile tests from platform-specific execution tests.

**Fix verification:** Run `ERA_SKIP_REA=1 npm test` on a real Linux runner and the full suite on macOS.

### F11 — MEDIUM — Release packaging fails because the output directory is absent

**Component:** `.github/workflows/release-validation.yml:31–34`.

**Technical explanation:** The workflow runs `npm pack --pack-destination dist` without creating `dist`; no tracked directory or earlier workflow step creates it.

**Impact:** A clean release-validation job fails before the SBOM, clean-install and provenance artifacts are produced.

**Verification performed:** Executed the same pack operation against a nonexistent temporary destination using npm 11.19.0: exit **254**, **ENOENT**. The existing clean-install script passes because it creates its temporary destination first.

**Required solution:** Create the output directory explicitly before pack/SBOM generation; validate the complete job from a fresh checkout.

**Fix verification:** In a checkout without `dist`, execute package → SBOM → clean installation → artifact checks successfully. Verify attestation on the real authorized GitHub workflow before claiming it exists.

### F12 — MEDIUM — Inferred CommonJS exports are incorrect and presented as ordinary facts

**Component:** `src/analysis/facts.js:23–54,81`, `src/analysis/report.js:47–53`.

**Technical explanation:** The heuristic treats binding reads following a `module.exports` write as named exports. It uses value-binding names for renamed keys and can infer names for a function assigned as the default export. Those strings are combined with observed facts without inference/confidence metadata in JSON/reports. The code comment acknowledges limitations but users do not receive that distinction per fact.

**Impact:** Incorrect API reconstructions and misleading accuracy claims outside the narrow authored CommonJS benchmark.

**Verification performed:** Real REA analysis of `module.exports = { publicName: internal }` through ERA's extractor produced `export:index.js#internal` and `#default`, not `#publicName`.

**Required solution:** Only infer supported forms with evidence establishing the property key, or mark uncertain results as hypotheses. Carry per-fact provenance and observed/inferred status into JSON/reports. Add held-out renamed/default/computed/spread export cases.

**Fix verification:** The real-REA renamed-key fixture must report the correct key or an explicit unknown, never an unqualified wrong export.

### F13 — MEDIUM — Declared Node support exceeds the pinned engine's supported range

**Component:** `package.json:24–25`, `docs/installation.md:9`.

**Technical explanation:** ERA declares `>=22.19.0`; REA 6.4.0 declares `^22.19.0 || ^24.11.0 || >=26.0.0`. ERA therefore advertises compatibility with versions such as Node 23, Node 25 and early Node 24 that its required engine excludes.

**Impact:** Unsupported installations are presented as supported; runtime behavior may fail despite satisfying ERA's own engine constraint.

**Verification method:** Compared installed and registry package metadata with ERA metadata. Alternate Node versions were not executed.

**Required solution:** Align the declared range/documentation with the supported intersection and test its supported minimums.

**Fix verification:** Engine-range checks reject excluded versions, and supported minimum versions pass package/CLI smoke tests.

### F14 — MEDIUM — Process containment and output limits are narrower than claimed

**Component:** `src/core/process.js:66–145`, `src/core/watchdog.mjs`, `src/commands/analysis.js:67–75`.

**Technical explanation:** With `stdoutFile`, output is written without a byte ceiling or backpressure handling, then read fully for JSON parsing. The output stream has no error listener. Process groups cannot contain deliberately detached descendants; the existing escaped-grandchild test explicitly kills its survivor itself. Passthrough bypasses the watchdog, and external GUI providers have separate lifetimes.

**Impact:** Large/malformed engine output can exhaust disk/memory or crash recording on stream errors. Claims that every subprocess is bounded and nothing survives are too broad for hostile candidates or passthrough operations.

**Verification method:** Source inspection plus existing passing timeout/orphan tests, including their explicit survivor cleanup. No disk exhaustion or uncontrolled-process stress test was run.

**Required solution:** Enforce output quotas, honor write backpressure, handle stream failures with cleanup, and constrain hostile descendants through the OS isolation in F03. Document passthrough/GUI lifetime exceptions accurately.

**Fix verification:** A bounded synthetic output flood and a failing output sink must terminate cleanly and record failure. Detached child probes must be cleaned up by the isolation boundary or explicitly excluded from the contract.

### F15 — LOW — Release documentation overstates or mislabels evidence

**Component:** `README.md`, `CHANGELOG.md`, `docs/release-readiness.md`, `experiments/baseline/README.md`, `examples/README.md`.

**Technical explanation:** README says four experiments despite five records and describes cycles 1–3 as merged although cycle 1 was rejected. CHANGELOG still describes era-v3 as the candidate. Some anonymized outputs are called “unedited.” The previous release-readiness report says only independent review remains. Exact support, redaction, isolation and hard-limit claims require the qualifications established above.

**Impact:** Reviewers can mistake old aggregates, transformed artifacts or fake adapter tests for current comprehensive validation.

**Required solution:** Update all release-facing docs after fixes, distinguish package version/commit/internal tag, date benchmark runs, explicitly label original versus redacted artifacts and real versus fake execution, and link this audit with remediation status.

**Fix verification:** Review every release claim against an exact command result or artifact. No unchecked claim should be described as verified.

### Security controls that passed, and remaining boundaries

- Real sandbox probes confirmed scratch writes allowed, outside writes denied, and network denied. A separate synthetic canary probe confirmed **reads outside scratch are allowed**, consistent with SECURITY.md. This is not a confidentiality sandbox. Captured output could contain readable host secrets; use an isolated host/environment for hostile binaries until a read allowlist exists.
- Remote reasoning requires both configuration opt-in and a per-call flag. This does not mitigate F04 or govern coding-agent network access.
- Raw REA parsing is generally performed as inert static analysis, but native providers/parser dependencies still execute with their own privileges. Malicious archive/parser fuzzing was not performed.
- No credentials were printed or copied into this report. A regex scan covered the current tracked tree and reachable historical blob contents across 25 commits / 516 reachable object entries. It found **no matches for the configured secret patterns, no personal home-directory path matches, and no unexpected email addresses** under the scan's classification. Author/committer emails were neutral/no-reply; all four tagger addresses were no-reply.
- Standard system paths, fixture paths and neutral placeholders remain intentionally. A regex scan cannot prove absence of arbitrary personal data, unknown credential formats, or sensitive strings in binary/debug data. Ignored local `.era` content and external pre-rewrite backups must not be published; unreachable objects/reflogs and external backups were not included in this publication scan.
- The repository scan does not check email addresses itself and scans only tracked current files. CI needs a full-history secret/privacy lane and a scan of the actual package/evidence exports before release.

## 7. Test and validation results

### Commands actually executed on audited HEAD

| Validation | Result | What it proves / does not prove |
|---|---|---|
| `npm test` | **108 total; 107 passed; 0 failed; 1 skipped; 90.667 s** | Includes actual REA, MCP, sandbox and disposable Git runs. Also includes fakes/recorded fixtures. |
| Six tests in `tests/rea-integration.test.js` | **6/6 passed in the full run** | Version passthrough, equal Mach-O Evidence, JS application, Mach-O structure, current-source self-analysis coverage, single JS file. |
| `tests/mcp.test.js` | **2/2 passed** | Real generic MCP client session/tool call and MCP doctor. Not real Claude/Codex UI sessions. |
| Sandbox tests | **3/3 passed** | Profile formatting, actual direct OS sandbox, and sandboxed capture via actual REA. |
| End-to-end Lab tests | Passed | Fake REA engine; real disposable Git/process/state operations. Approval, rejection, rebase, rollback, SIGINT, SIGKILL recovery. |
| Coding/reasoning adapter tests | Passed | Fake CLIs/local commands; no genuine model execution. |
| `npm run lint` | Passed | ESLint configured rules. |
| `npm run check` | Passed, 231 tracked files | Syntax and current tracked-file regex secret/path scan. |
| `npm ls --omit=dev` | Passed | Direct dependency resolves to REA 6.4.0. |
| `npm audit --json` | **0 known vulnerabilities**, including dev graph | Registry snapshot at audit time; not a comprehensive supply-chain security guarantee. |
| `npm audit signatures` | **212 verified registry signatures; 48 verified attestations** | Dependency registry provenance, not ERA release attestation. |
| `bash scripts/clean-install-test.sh` | Passed | Fresh tarball installation, help/version/status and actual JS analysis; resolves locally installed REA, 15 facts. |
| Fresh benchmark, 3 repetitions | **15/15 successful analyses**, all deterministic | Real REA including Hopper/native/runtime/ZIP. Metrics below. |
| Isolated negative/security probes | Defects reproduced | F01, F02, F04, F05, F06, F08, F11, F12; Linux-path mismatch and sandbox read boundary also checked. |

The single skipped full-suite test is “runtime capture without a sandbox needs --unsandboxed,” skipped because this macOS host has a sandbox. No real-REA integration test was skipped.

Not executed: Linux/Windows CI, remote GitHub Actions/CodeQL, live headless model adapters, provider setup changes, Ghidra/IDA, broad fuzzing, alternate supported Node versions, and a full historical-version benchmark replay. No numerical statement about line/branch coverage is made.

### Fresh benchmark

Executed after the test suite completed:

```sh
ERA_STATE_DIR=<audit-state> node bin/era.mjs benchmark --repetitions 3 --out <audit-output>/benchmark.json
```

Actual revision: `5ce907f`; result label: `era-v4` (nearest tag). Completed at **17:39:25 Europe/Berlin** on the audit date. This run measures the current checkout only. It is not an ERA-versus-REA comparison or a controlled historical speedup experiment.

| Case | Successful repetitions | F1 | Median wall time (ms) | REA analysis runs per repetition |
|---|---:|---:|---:|---:|
| CommonJS app | 3/3 | 1.000000 | 3,381 | 1 |
| ESM app | 3/3 | 0.965517 | 3,359 | 1 |
| Native Mach-O | 3/3 | 0.967742 | 13,319 | 3 |
| Native Mach-O + runtime | 3/3 | 1.000000 | 18,373 | 4 |
| ZIP archive | 3/3 | 1.000000 | 2,402 | 1 |

Aggregate F1 **0.9866518354**, precision **0.9875**, recall **0.9866666667**, sum of median wall times **40,834 ms**, sum of median CPU times **35.45 s**, peak RSS **403,439,616 bytes** (384.8 MiB), error rate **0**, reliability **1**. Ten recorded analysis operations per pass gives 30 across three repetitions; version/provider probes are additional and not counted by that field.

Known fixture differences reproduced: ESM misses a WebSocket endpoint literal; native static facts count the Mach-O dynamic loader as a library dependency. Runtime case scoring only covers its selected truth categories, so its F1 of 1 does not validate all decompilation facts. A fresh renamed-export probe outside the benchmark exposed F12.

The runtime and native results support that actual engine operations work now. They do not invalidate known Hopper flakiness or establish sustained reliability on arbitrary software. Native GUI state and ordinary host activity were not fully controlled, so no speedup claim is justified against earlier runs.

### Audit-output fingerprints

Raw audit logs were retained outside the repository rather than published with local paths. These SHA-256 values identify the outputs inspected in this session; a hash alone is not a public reproducibility bundle.

| Output | SHA-256 |
|---|---|
| Full test log | `4a853e9d0a286077f365f7600d3156f4d47a46f8c74084e187a3e63df31294a7` |
| Fresh benchmark JSON | `366da113b1e1b9a226c86b95a043865f32fb2d85e58a42f3344aa5d219101a7b` |
| Registry vulnerability report | `9c900444c411b7957c5b8b9f1d3ed11705e94a2cfd7747b535b9993b490812d9` |
| Registry signature log | `47a6f2479b2969c77360bc7221fc2135eac6ae2a9df34fa6f3eabae4e7da73aa` |
| Clean-install log | `57c2756640b5fcf6f7f597a0b684b8ff9997d73573ec90f644778937fdaa7ee8` |

## 8. Confirmed ERA advantages over direct REA use

1. One high-level command selects a supported workflow and produces combined normalized facts and a report, including staging individual JS files.
2. ERA-managed run records add command, status, timing and resource information around original REA Evidence.
3. macOS runtime capture has a tested network/write restriction wrapper, with the read-access limitation stated above.
4. Authored ground-truth scoring and version/overhead comparison infrastructure provide measurable regression signals.
5. The Lab provides explicit hypotheses, experiment branches/worktrees, decisions, reviewable patches, approval records and Git rollback.
6. Multi-pass self-analysis resolves real REA output-budget limitations on ERA's own source; experiment 5 evidence supports that improvement.
7. CommonJS inference improves the authored shorthand-object fixture, though broader correctness and provenance need F12.

No evidence establishes that ERA's reverse-engineering engine is more capable than REA's: it is the same engine. ERA is not proven faster, universally more accurate, securely autonomous, or a foundation-model self-training system. Its recursive improvement changes application source through an externally supplied human/agent implementation step.

## 9. Known limitations and required fixes for Claude Code

The current release is experimental and macOS-focused. Linux has no runtime sandbox; the benchmark manifest includes macOS native fixtures. The adapters are not proven against real models, and client-specific MCP setup is not tested. ERA has no enterprise RBAC, authenticated approvals, tamper-evident audit service, confidential sandbox, generalized target routing, type checking, or large representative benchmark corpus. These can be explicit scope limits rather than reasons for a wholesale rewrite.

Implement the following in small reviewable changes, preserving working Analysis Mode:

| Priority | Required change | Acceptance before release |
|---|---|---|
| P0 | **F01:** bind evaluation and approval to immutable candidate/base trees | Branch drift/protected-change adversarial tests refuse promotion. |
| P0 | **F02/F03:** establish trusted evidence production and isolate candidate execution | Forged evidence, missing capture and outside writes cannot pass. If isolation is deferred, disable untrusted/automated Lab execution and narrow the release scope explicitly. |
| P0 | **F04:** constrain imported analysis attachments | Crafted report paths and symlinks cannot send outside data to any provider. |
| P0 | **F05:** enforce valid benchmarks and trusted regression tests | Equal benchmark failure, test deletion and mandatory-test skipping cannot produce acceptance; legitimate baseline repairs remain supported. |
| P1 | **F06:** transactional single-writer lifecycle | Concurrent implement/evaluate/recover/approve/rollback and crash-injection tests pass. |
| P1 | **F07:** enforce dispatch/spend policy and CI refusal consistently | Cumulative budgets, unknown costs, REA counts and configured timeouts have executable negative tests. |
| P1 | **F08/F14:** secure model/export boundaries and bound process output | Synthetic secrets stay private; stream errors/output floods terminate cleanly; process guarantees match enforcement. |
| P1 | **F10/F11/F13:** repair Linux test, release directory creation and Node support range | Clean Linux/macOS jobs, fresh release packaging and supported-minimum runtime checks pass. |
| P1 | **F09:** export verifiable sanitized evidence | Independent reconstruction of benchmark aggregates and experiment provenance from the release bundle succeeds. |
| P1 | **F12:** correct or qualify CommonJS inference | Renamed/default export cases return correct observations or explicit uncertainty. |
| P2 | **F15:** reconcile release documentation and claims | Docs identify exact revision, real/fake tests, evidence transformations and remaining scope limits. |
| P2 | Remove unnecessary provider probes; add representative held-out fixtures and measured coverage | Report any performance/accuracy improvement only from new comparable measurements. |

All P0 items block the current advertised release. P1 items must be fixed or the affected capability explicitly removed/disabled from the initial release and its claims. Passing macOS tests alone is not an acceptable waiver for broken promised release/CI controls. Real model adapter smoke tests remain necessary before calling those adapters production-verified; otherwise retain their experimental/unverified designation.

## 10. Release readiness verdict

**NOT READY.** Analysis Mode and the recorded self-improvement experiments are substantive and reproducible in important respects. The outstanding issues are enforcement defects, not missing marketing material or a need to restart development.

Before the first public release, complete the prioritized corrections, rerun the existing suite plus the adversarial cases above, rerun supported-platform CI and clean release validation, and have an independent reviewer verify the corrected trust boundaries and exact release commit. Publication remains a separate maintainer decision. This audit did not modify implementation files or publish ERA.
