# Testing

```bash
npm test                  # everything that can run on this host
ERA_SKIP_REA=1 npm test   # no real REA engine (unit + fake-engine tests only)
ERA_SKIP_E2E=1 npm test   # skip the end-to-end Improvement Lab scenarios
npm run lint              # ESLint (recommended rules)
node scripts/check.mjs    # syntax check + secret scan of tracked files
```

The suite uses Node's built-in `node:test` runner. It has no test-framework
dependencies.

## What runs against what

Every test file states which engine it uses. Tests that use a fake never count
as real REA executions.

| File | Engine | Covers |
|---|---|---|
| `core.test.js` | none | config, process runner (timeouts, process-group kill, escaped grandchildren, cancellation), `/usr/bin/time` parsing |
| `rea-client.test.js` | `fixtures/fake-rea.mjs` (fake) | run records, error envelopes, invalid JSON, timeouts, warnings, missing binary |
| `analysis.test.js` | recorded **real** REA Evidence (`fixtures/evidence/`) | target detection, workflows, fact extraction (JS, Mach-O, Hopper functions, archives, process), reports |
| `self-analysis.test.js` | synthetic + recorded real Evidence | self-analysis rules, coverage-aware suppression, planner ranking |
| `self-analyze-passes.test.js` | none | REA pass planning (byte budget, placeholders) |
| `evaluation.test.js` | none | scoring, TAP parsing, acceptance decisions |
| `safety.test.js` | none | hard limits, protected paths, CI refusal, locks, stale-lock recovery |
| `versions.test.js` | git | worktrees, promotion, tags, rollback (including deletions) |
| `orchestration.test.js` | git, fake REA | implementer controller, reports, dashboard, interrupt guard |
| `agents.test.js` | `fixtures/fake-claude.mjs`, `fake-codex.mjs` (fakes) | coding-agent adapters (flags, sandbox mode, cost/tokens, failures), budgets, reasoning providers and data-egress controls |
| `observability.test.js` | fake REA | redaction, JSONL logs, execution/correlation IDs |
| `cli.test.js` | fake REA | CLI contract: help, exit codes, errors, passthrough, explain, sandbox refusal |
| `sandbox.test.js` | sandbox-exec, **real REA** | probe binary: scratch writes allowed, outside writes and network denied, including through `era analyze --runtime` |
| `rea-integration.test.js` | **real REA** | passthrough equivalence, JS/Mach-O analysis, single files, REA self-analysis coverage |
| `mcp.test.js` | **real REA MCP server** | JSON-RPC `initialize`, `tools/list`, `tools/call analyze_javascript_application` through `era rea mcp`; `era rea mcp doctor` |
| `candidate-isolation.test.js` | sandbox-exec, **fake engine** | hostile candidate (outside write, local TCP, protected read, secret env) denied; forged or incomplete self-analysis plans invalid; failed candidate commands not trusted; fail-closed isolation (protected test) |
| `e2e-lab.test.js` | `fixtures/fake-rea-engine.mjs` (**fake engine**) on a repository copy | Improvement Lab end to end: awaiting-approval → approve → tag → rollback; protected-path rejection; SIGINT interruption; SIGKILL crash + `era improve recover` |

Real-REA tests skip automatically when `rea` cannot be started.

## Nested runs

`era improve evaluate` runs a checkout's test suite with `node --test`. When
that happens inside another `node --test` process (the e2e tests),
`NODE_TEST_CONTEXT` is removed so the nested suite runs standalone. The e2e
tests set `ERA_E2E_NESTED=1` and `ERA_SKIP_REA=1` for nested runs, so they do not
recurse and do not depend on a real engine.

## Clean-environment installation

`scripts/clean-install-test.sh` packs ERA, installs the tarball into an empty
project (which downloads `rea-agents` from npm), and runs `era --help`,
`era status` and `era analyze` on a fixture. The CI release-validation
workflow runs the same script.
