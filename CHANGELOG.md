# Changelog

All notable changes to ERA. Versions `era-vN` are internal self-improvement
checkpoints (annotated git tags); `vX.Y.Z` are releases.

## v0.1.0 — 2026-10-13

First public release, corresponding to internal version **era-v3** plus
documentation, CI and test additions.

### Analysis mode
- `era analyze` reverse engineers JavaScript applications, archives and Mach-O
  binaries through REA (`rea-agents` 6.4.0), with recorded REA executions,
  normalized facts, and Markdown/JSON reports.
- Mach-O: structure via `inspect-macho`. Decompilation of exported functions via
  REA's deep provider (verified with Hopper 6.6.0-demo). Optional runtime capture
  (`--runtime`).
- `era inspect` (target classification and engine status) and `era rea …`
  (unchanged passthrough to every REA command, including `mcp`).

### Self-improvement mode
- `era self-analyze`: REA analysis of ERA's own packed artifact plus REA process
  capture of `era --help`, with coverage-aware rules.
- `era improve` (propose / evaluate / abandon / bounded run with an implementer
  command), `era benchmark` (including `--versions`), `era status`, `era history`,
  `era rollback`, `era dashboard`.
- Protected evaluator, ground-truth benchmarks, frozen acceptance criteria, hard
  limits, CI refusal.

### Improvement cycles (initial experiment)
- **cycle-20261013T095936-14e2b8: rejected.** CommonJS export inference
  raised accuracy but increased self-analysis findings (REA `resource_constraint`).
- **cycle-20261013T101435-e55c7f → era-v2:** REA self-analysis split into
  size-balanced passes, giving complete REA coverage of ERA.
- **cycle-20261013T103029-c10c1f → era-v3:** CommonJS named exports inferred
  from REA's semantic graph (retry of the rejected change). Benchmark F1 0.956 → 0.987.

### Operator maintenance (not produced by cycles)
- `era improve propose --finding <id>` operator selection (between era-v1 and era-v2).
