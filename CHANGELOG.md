# Changelog

All notable changes to ERA. Versions `era-vN` are internal self-improvement
checkpoints (annotated git tags); `vX.Y.Z` are releases.

## v0.1.0 — unreleased

First public release candidate: internal version **era-v4** plus the
independent-audit remediation below. Not yet published.

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
