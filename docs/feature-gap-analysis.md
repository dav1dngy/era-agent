# Feature-gap analysis and implementation plan (development round 2)

Audit date: 2026-10-13. Baseline: `main` at `f2b7ec5` (era-v3 plus docs/CI).
Upstream: `morluto/rea` default branch `main`; latest release `rea-agents-6.4.0`
(2026-10-11). This is the version ERA pins.

## 1. Repository audit

| Item | Observed |
|---|---|
| Source | 2,309 lines in 21 ESM modules under `src/`, plus `bin/era.mjs` |
| Tests | 13 files, **72/72 passing** (69.9 s, including real-REA integration tests) |
| History | 7 commits on `main`; tags `era-v1`, `era-v2`, `era-v3`; 3 experiment branches kept |
| Improvement cycles | 3 decided (1 rejected, 2 accepted). `limits.maxCycles` = 3 is reached |
| REA integration | CLI subprocess (`rea … --format json`), resolved from config → `ERA_REA_BIN` → `node_modules/.bin/rea` → `PATH` |

### Defects found during the audit

1. **Process-tree leak on timeout (reliability, high).** During the
   era-v1/v2/v3 benchmark, `rea function _greet` (Hopper) hung. The benchmark's
   10-minute case timeout sent SIGTERM only to `/usr/bin/time`. The orphaned
   `era analyze` and `rea` processes kept stdout/stderr open, so the benchmark
   waited forever (observed: 12+ minutes without progress; orphans re-parented to
   PID 1). The same leak happens when an ERA parent is killed. Evidence:
   `ps` output during the audit, and the stuck run in the benchmark state directory.
2. **Stable-branch auto-merge.** `era improve evaluate` merges accepted
   experiments into `main` immediately. The round-2 requirements call for human
   approval first.
3. **No cancellation or interruption recovery.** SIGINT during an evaluation
   leaves the lock, the worktree and child processes behind.
4. **Runtime capture is not sandboxed.** `--runtime` runs the target with full
   user permissions (REA's PTY capture is explicitly not a sandbox).
5. Open REA self-analysis findings in era-v3: incomplete REA coverage of three
   test files (fixed grouping is not adaptive), `high-fan-out` in `src/cli.js`
   and `src/orchestration/cycle.js`, and `/usr/lib/dyld` counted as a linked
   library (benchmark precision gap).

## 2. What REA already implements (do not re-implement)

| Capability | REA 6.4.0 | ERA's position |
|---|---|---|
| Reverse-engineering operations (127 CLI commands, 170 MCP tools) | ✅ | used, never re-implemented |
| MCP server (`rea mcp`) and readiness check (`rea mcp doctor`) | ✅ | reuse via `era rea mcp …` |
| Agent registration for Claude Code, Codex, Cursor, Gemini CLI, Grok Build, Copilot CLI, VS Code, Claude Desktop (`rea setup`) | ✅ | reuse via `era rea setup`; ERA adds no MCP registration code |
| Evidence ledger, evidence bundle export/import/compare, residual unknowns | ✅ | reuse; ERA stores raw Evidence unmodified |
| Native providers (Hopper/Ghidra/IDA), JS/Electron, archives, process capture, browser, Android, firmware | ✅ | ERA wraps a verified subset |
| Benchmarks against ground truth, self-analysis, improvement experiments, versioning/rollback | ❌ | **ERA-specific** |
| Normalized facts and analysis reports across REA operations | ❌ (REA returns Evidence) | ERA-specific |
| Coding-agent backends for modifying code | ❌ (REA is an analysis engine) | ERA-specific |

## 3. What ERA implements today

Analysis Mode (`analyze`, `inspect`, `rea` passthrough). Self-analysis via REA.
Improvement cycles (`propose`/`evaluate`/`abandon`/bounded `run` with a generic
implementer command). Benchmarks (`--versions`). Version tags and rollback.
Status, history and dashboard. Protected evaluator. Hard limits and CI refusal.

## 4. Gaps against the round-2 requirements

| # | Requirement | Status at audit | Plan |
|---|---|---|---|
| G1 | Human approval before stable integration | ❌ auto-merge | `awaiting-approval` state; `era improve approve` / `decline`; approval events in the ledger |
| G2 | Cancellation, interruption recovery | ❌ | signal handling that kills child process groups and records the interruption; `era improve cancel`, `era improve recover` |
| G3 | Process-tree timeouts | ❌ (defect 1) | spawn children in their own process group; kill the group; settle even if pipes stay open |
| G4 | Coding-agent backends | ⚠️ generic command only | adapters `manual`, `command`, `claude-code`, `codex` with availability probes, explicit sandbox/permission flags and cost reporting |
| G5 | API cost limits | ❌ | per-cycle and campaign budget; Claude Code reports `total_cost_usd`; agents that cannot report cost require explicit opt-in |
| G6 | AI reasoning provider separation | ❌ (ERA has no reasoning provider) | `era explain`: `none` (local deterministic, default), `command` (e.g. a local model), `claude-code`; remote providers need config opt-in **and** `--allow-remote` |
| G7 | Sandbox for untrusted executables | ❌ (defect 4) | macOS `sandbox-exec` profile for `--runtime`: no network, writes only to the analysis scratch directory; refuse runtime capture without a sandbox unless `--unsandboxed` |
| G8 | Structured logging and redaction | ❌ | JSONL log with execution/correlation IDs, ERA/REA versions, provider, durations, decisions; secret redaction |
| G9 | MCP compatibility tests | ❌ | real JSON-RPC handshake and `tools/list`/`tools/call` against `era rea mcp`, plus `era rea mcp doctor` |
| G10 | ERA vs REA baseline benchmark | ❌ | `era benchmark --rea-baseline`: direct REA execution of the same commands, then report ERA overhead |
| G11 | Lint, static analysis, pinned CI, SBOM, provenance, release validation | ⚠️ syntax check only | ESLint, SHA-pinned actions, CycloneDX SBOM, provenance attestation in a manual/tag release-validation workflow (no publishing) |
| G12 | Clean-environment installation test | ❌ | `scripts/clean-install-test.sh` (npm pack → fresh project → install → run) |
| G13 | End-to-end Improvement Lab tests (success, failure, rollback, interruption) | ⚠️ unit-level only | e2e tests on a temporary clone with a clearly labelled fake REA engine |
| G14 | Docs: THIRD_PARTY_NOTICES, testing, benchmark methodology, release checklist, Improvement Lab | ⚠️ partial | write/update |
| G15 | Type checking | ❌ | not adopted in this round (would add TypeScript tooling). Documented as open |

### Duplication check

* ERA's run records (`.era/runs/*/record.json`) hold process-level metadata
  (command line, exit status, timing, RSS) that REA's Evidence does not, and they
  keep REA's Evidence unmodified next to them. Not a duplicate.
* `era rea` is a passthrough, not a re-implementation.
* No ERA code duplicates REA's MCP registration. G9 tests REA's own server
  through ERA instead of building one.

### Refactoring needed

* `src/orchestration/cycle.js` takes on approval, cancellation and agent
  selection. Agent backends move to `src/agents/`, so the controller depends on
  an interface (`{ id, probe(), implement() }`), not on concrete CLIs.
* `src/cli.js` (high fan-out, flagged by REA): command handlers load their
  modules lazily (also an Improvement Lab candidate, measured by REA process capture).
* Coding agents and reasoning providers are injected through a registry, so
  tests substitute fakes without touching real CLIs.

## 5. Prioritized plan (small, tested commits)

1. G3 process-group timeouts (reliability defect) and tests.
2. G1/G2 approval gate, cancellation, recovery, ledger events, tests.
3. G4/G5 coding-agent adapters with budgets, tests with fake CLIs.
4. G8 structured logging and redaction.
5. G7 sandboxed runtime capture, tests that prove network and write denial.
6. G6 reasoning providers with data-egress controls.
7. G9 MCP tests; G10 REA-baseline benchmark.
8. G13 end-to-end Improvement Lab tests.
9. Improvement Lab campaign: up to three genuine REA-driven experiments, each
   ending in `awaiting-approval` for the maintainer. `limits.maxCycles` is raised
   from 3 to 6 for this second campaign.
10. G11/G12 CI, lint, SBOM, provenance, clean install; G14 docs; final validation.
