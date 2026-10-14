# Changelog

All notable changes to ERA. Versions `era-vN` are internal self-improvement
checkpoints (annotated git tags); `vX.Y.Z` are releases.

## Unreleased (branch `feature/era-v0.2.0`, after v0.2.0-dev.1)

### Fixed
- **"Unknown run" race:** a status read while a run directory existed but its `run.json` was not yet published
  failed; such directories are now treated as runs still being created. Reproduced deterministically (half-created
  directory; a concurrent writer process) and verified to fail on the previous code.
- **`ENOTEMPTY` on interruption/cleanup:** temp-directory removal could throw while a descendant outside the process
  group still wrote into it, masking the real result. New never-throwing, retrying `removeTree()` is used by candidate
  tests, project commands, self-evaluation, benchmarks and working-copy removal; cleanup runs in `finally`.
- Code-scanning findings on PR #1: values are no longer interpolated into generated code in tests/UI scripts; project tool
  detection no longer builds a shell command (native PATH search).
- Desktop test compared the app version with a stale constant; it now reads the app's own `package.json`.

### Rebuild (usable) and screenshot-to-website
- Prerequisite checklist before any run (`era project check`, `GET /api/projects/:id/preflight`, Studio): agent installed
  and signed in, spending cap, consent, acceptance, destination, sandbox, renderer, image support; each with a fix. Start is
  refused with the whole list.
- Planning a REBUILD no longer crashes; reference/destination/commands/acceptance edited for an existing project are saved.
  Rebuild setup UI: behavior editor, acceptance and test commands, visual threshold.
- `allowUnmeteredAgents` is never enabled silently: Studio setting (default off, audited); not inherited from the environment.
- Screenshot rebuilds: content-validated PNG/JPEG/WebP, metadata stripped, passed to the agent as images (Codex native; Claude
  Code via its file tool, unvalidated), offline sandboxed render + visual score, copy and external-resource detection, side-by-side
  review. See `docs/screenshot-rebuild.md`.
- Optional plan-review gate (`--review-plan`, `--approve-plan`, Studio "Pause after planning") and a Plan & design view.
- Studio dependency advisories (Monaco/DOMPurify) analysed and tested as unreachable; not fixable by override.

## v0.2.0-dev.1 — 2026-10-14 (development prerelease)

Development preview from `feature/era-v0.2.0`; stable `main` and v0.1.0 remain
unchanged. Includes an unsigned macOS arm64 Studio build and a CLI npm tarball;
no npm registry publication. See `docs/release-notes-v0.2.0-dev.1.md` for validation
scope, installation requirements and known limitations. Screenshot-to-website
Rebuild is not implemented, and Rebuild still requires configured acceptance checks.
Studio's production dependency audit reports two low-severity findings involving
Monaco's transitive DOMPurify dependency (GHSA-p98j-92pf-mc4p and GHSA-6688-9rhm-gjv2).
They remain open in this preview; no breaking dependency update was applied.

### Release validation
- Isolate approval-fixture environment from CI flags while retaining CI refusal tests.
- Exclude unavailable native runtime capture only in disposable no-sandbox E2E fixtures;
  macOS retains the complete benchmark manifest and production safety is unchanged.
- Give Control Plane and Project Lab tests their own Git history, explicit fixture trust,
  mock-agent temporary directory and cooperative read-only behavior across platforms.
- `v0.2.0-dev.0` was tagged for validation but not published as a GitHub release.

### ERA Studio
- Graphite UI refresh: floating icon navigation, original line icons, a task dashboard
  with real activity/provider state, searchable project cards and matching editor panels.
  Dark/light and narrow-window layouts retain the existing workflow and permission controls.
- Local Electron desktop and browser workspaces with Simple/Advanced modes,
  original dark/light design, Monaco editing and side-by-side diffs, xterm terminal,
  project/task management, Git clone/status/diffs, history and settings.
- Loopback control plane with token/Host/Origin validation, real SSE events,
  supervised CLI jobs, provider status, REA evidence, Project Lab approvals/rollback
  and the existing Improvement Lab. No duplicated workflow engine.
- Desktop startup, real REA analysis and project review, simulated-agent modification,
  approval/rollback, UI components and packaged macOS launch are reproducibly tested.
- Fixed canonical workspace restrictions, protected editor paths, per-project editor
  identity, unsaved-change handling, shutdown queues, selection exposure/cost accounting,
  old Node selection by the login shell and Electron watchdog subprocess execution.
- Reproducible unsigned macOS packaging with locked dependencies and attribution;
  installation, architecture, security and testing documentation. Debugger/LSP,
  enterprise identity and signed/notarized distribution remain out of scope for this build.

### ERA Project Lab
- `era project create|list|review|modify|rebuild|status|show|approve|cancel|resume|rollback|delete`:
  review, modify, repair, extend and reconstruct selected functionality of authorized
  **external** projects. Isolated, reversible working copies for git and non-git
  projects; the original is never changed without approval, and ERA's own installation
  is refused as a project.
- Review: capability detection, baseline, REA analysis (JavaScript), static checks,
  optional read-only agent review with validated findings, severity-ordered report.
- Modify: baseline and reproduction check, evidence-based plan, bounded agent
  attempts with failure feedback, regression detection (including deleted tests),
  protected files, reviewable diff, approval bound to the verified diff, rollback.
- Rebuild: REA evidence, sandboxed behavior capture from the reference, clean-room
  specification, behavioral acceptance, verbatim-copy check, approval-gated output.
- Per-project locks, ledger, spending/time/attempt limits; cancellation, interruption
  recovery and resume; machine-readable `--json` output and a programmatic API used by
  ERA Studio.
- Coding-agent adapters gain a prompt override, a read-only mode (Claude Code `plan`,
  Codex `read-only`), `ERA_PHASE`/`ERA_READ_ONLY` hints and complete output capture.

### Multi-agent engineering
- Modify can coordinate an architecture agent, an implementation agent and an independent review
  agent as configurable **roles** (`--team claude-only|codex-only|claude+codex|custom`, or
  `--architect/--implementer/--reviewer`); presets, third-party adapters and local `custom:<name>`
  command agents are configuration/registration, not code paths.
- Capability model and detection (`era agents`, `era project team`): read/write/execute, read-only
  mode (native or verified), automation, metering, remote transmission; roles are refused for agents
  lacking what they need. Authentication is checked before an agent starts.
- Explicit, hashed artifact hand-offs; least-context prompts; read-only roles work on private
  snapshots and ERA verifies they changed nothing; agents never run concurrently.
- Independent review: findings validated against real files/lines/quotes, bounded corrections,
  ERA re-runs build/tests/acceptance, unresolved blocking findings reject the run.
- Security: per-provider **consent** before source code goes to a remote provider; credential
  files and agent instruction files withheld from agent copies; secret-looking content blocks remote
  transmission; allowlisted environment for provider CLIs.
- `scripts/validate-providers.mjs`: real-provider validation with recorded evidence. **Codex validated;
  Claude Code could not be validated (not signed in).** See `docs/provider-validation.md`.

### Fixes found by the new tests and by real provider runs
- Codex's `workspace-write` sandbox allowed writes to `$TMPDIR` and `/tmp`, so a working copy's
  parent directory was writable (found by real validation); now excluded.
- Token usage was masked as `[REDACTED]` in the ledger (key name contained "token"); now `usage`.
- A stored team with a derived preset label (`single`/`custom`) could not be re-validated by `update`.

### Earlier fixes found by the Project Lab tests
- Sandboxed/agent child processes no longer inherit `NODE_TEST_CONTEXT` (a nested
  `node --test` silently exited 0 without running tests).
- Lock acquisition created the lock file empty before writing it, so a competing
  process could treat it as stale and also acquire; now created atomically with its
  content, and stale-lock takeover cannot remove a live lock.
- Relative in-project symlinks were skipped on macOS; trailing `**` globs; run ordering.
- At the initial Project Lab checkpoint only mock agents had been used; subsequent real
  Codex validation is recorded separately under Multi-agent engineering above.

## v0.1.0 — 2026-10-13

First public release: internal version **era-v4** plus the
independent-audit remediation below.

### Independent audit remediation (docs/audit-remediation.md)
- F01 approval bound to the evaluated commit/tree/patch; F02 supervisor-owned
  REA evidence (validated self-analysis plans, supervised benchmarks with
  `era extract`); F03 sandboxed candidate code with fail-closed isolation;
  F04 `era explain` never reads paths from imported analyses; F05 validity
  gates and baseline test inventory.
- F06 exclusive ownership-token locks, atomic state, journaled integration;
  F07 cumulative and conservative spend accounting, pre-dispatch REA budget,
  configured timeouts; F08 redaction at every model/export boundary, 0700
  state; F09 benchmark provenance and per-repetition samples.
- F10 Linux-safe test; F11 release `dist/`; F12 source-verified CommonJS
  inference with per-fact provenance; F13 Node range aligned with REA; F14
  output quota, backpressure and stream errors; F15 docs.
- Provider probe only for Mach-O targets.

### Round 2: ERA Improvement Lab, security and release engineering
- **Approval gate:** accepted experiments wait in `awaiting-approval`;
  `era improve approve|decline|show|rebase`. Approval needs a TTY confirmation
  or `--yes`, is refused in CI, and requires main at the evaluated base
  (Approved-by trailer, ledger event).
- **Coding agents:** `manual`, `command`, `claude-code`, `codex` adapters
  (`era improve implement`, `era agents`), with per-cycle and total API budgets
  and hard caps.
- **Reasoning providers:** `era explain` with a local deterministic default;
  remote providers need config opt-in and `--allow-remote`; prompts fence
  untrusted content and redact secrets.
- **Sandboxed runtime capture** (`sandbox-exec`: no network, writes only to
  scratch); refused without a sandbox unless `--unsandboxed`.
- **Reliability fixes from real runs:** process-group timeouts; a watchdog so
  no subprocess outlives its deadline or its parent (an orphaned, hung
  Hopper-backed REA call had blocked all native decompilation); cancellation
  and `era improve recover`; nested test runs no longer inherit
  `NODE_TEST_CONTEXT`; the hoisted `rea-agents` dependency is resolved.
- **Observability:** JSONL logs with execution/correlation IDs and redaction.
- **Measurement:** `era benchmark --rea-baseline` (ERA overhead against direct
  REA execution of the same commands).
- **QA:** real MCP session tests through `era rea mcp`; sandbox probe tests;
  fake-engine end-to-end Improvement Lab tests (approval, rejection, rebase,
  rollback, interruption, crash recovery); ESLint; clean-install test.
- **CI/release:** SHA-pinned actions, least-privilege permissions, CodeQL,
  npm audit and signatures, release-validation workflow with CycloneDX SBOM
  and build provenance (no publishing).
- **Docs:** feature-gap analysis, Improvement Lab, testing, benchmark
  methodology, release checklist, validation report, THIRD_PARTY_NOTICES.md
  (replaces NOTICE.md).
- **Campaign 2, experiment 4** (`cycle-20261013T112629-18505d`): byte-bounded
  REA self-analysis passes with import placeholders. See docs/self-improvement.md.

### Round 1

#### Analysis mode
- `era analyze` reverse engineers JavaScript applications, archives and Mach-O
  binaries through REA (`rea-agents` 6.4.0), with recorded REA executions,
  normalized facts, and Markdown/JSON reports.
- Mach-O: structure via `inspect-macho`. Decompilation of exported functions via
  REA's deep provider (verified with Hopper 6.6.0-demo). Optional runtime capture
  (`--runtime`).
- `era inspect` (target classification and engine status) and `era rea …`
  (unchanged passthrough to every REA command, including `mcp`).

#### Self-improvement mode
- `era self-analyze`: REA analysis of ERA's own packed artifact plus REA process
  capture of `era --help`, with coverage-aware rules.
- `era improve` (propose / evaluate / abandon / bounded run with an implementer
  command), `era benchmark` (including `--versions`), `era status`, `era history`,
  `era rollback`, `era dashboard`.
- Protected evaluator, ground-truth benchmarks, frozen acceptance criteria, hard
  limits, CI refusal.

#### Improvement cycles (initial experiment)
- **cycle-20261013T095936-14e2b8: rejected.** CommonJS export inference
  raised accuracy but increased self-analysis findings (REA `resource_constraint`).
- **cycle-20261013T101435-e55c7f → era-v2:** REA self-analysis split into
  size-balanced passes, giving complete REA coverage of ERA.
- **cycle-20261013T103029-c10c1f → era-v3:** CommonJS named exports inferred
  from REA's semantic graph (retry of the rejected change). Benchmark F1 0.956 → 0.987.

#### Operator maintenance (not produced by cycles)
- `era improve propose --finding <id>` operator selection (between era-v1 and era-v2).
