# ERA
## Evolve & Reverse Engineer Anything

**Autonomous Reverse Engineering & Recursive Self-Improvement**

ERA is an AI-powered reverse-engineering agent that analyzes software, verifies
its findings, and evolves its own implementation through controlled recursive
self-improvement.

ERA is built around the original **[Reverse Engineer Anything (REA)](https://github.com/morluto/rea)**
engine (`rea-agents` 6.4.0). Every reverse-engineering fact ERA reports comes from
a recorded REA execution. ERA adds an analysis orchestrator, ground-truth
benchmarks, and a bounded self-improvement loop: REA analyzes ERA itself,
findings become hypotheses, changes are tested in git worktrees, and only changes
that pass predefined criteria are merged.

> **Status: v0.1.0, experimental.** Read [Limitations](#limitations) before relying on it.

---

## What works (verified on macOS 27 arm64, Node 24, REA 6.4.0)

| Capability | Command | REA engine call | Status |
|---|---|---|---|
| JavaScript application analysis (modules, require/import graph, exports, entrypoints, URL literals) | `era analyze <dir>` | `analyze-javascript-application` | ✅ |
| Single JavaScript file | `era analyze <file.js>` | staged into a directory, then `analyze-javascript-application` | ✅ |
| Mach-O structure (exports, imports, linked libraries, architectures) | `era analyze <binary>` | `inspect-macho` | ✅ |
| Native decompilation of exported functions (pseudocode, call edges, strings) | `era analyze <binary>` | `function … --snapshot` | ✅ with Hopper 6.6.0-demo (needs Hopper, Ghidra or IDA) |
| Runtime capture of a native executable | `era analyze <binary> --runtime --arg …` | `capture-process` | ✅ |
| Archive inventory (ZIP) | `era analyze <file.zip>` | `inspect-artifact` | ✅ (APK/IPA/DMG routed but not exercised) |
| Every other REA command, including the MCP server | `era rea …` | passthrough | ✅ |
| REA self-analysis of ERA | `era self-analyze` | `analyze-javascript-application` × N + `capture-process` | ✅ |
| Improvement cycles with rollback | `era improve …`, `era rollback` | via self-analysis | ✅ 3 cycles run (1 rejected, 2 accepted) |
| Benchmarks vs. ground truth, across versions | `era benchmark [--versions …]` | via `era analyze` | ✅ |
| Status, history, static HTML dashboard | `era status`, `era history`, `era dashboard` | `providers` | ✅ |

Not supported in this release: ELF/PE analysis through `era analyze` (use
`era rea …` with the matching REA provider), Android, firmware, browser and
Electron runtime workflows (all available in REA, not wrapped by ERA).

## How ERA relates to REA

* REA is the **reverse-engineering engine**. ERA invokes its CLI with
  `--format json`, stores every run (command, input SHA-256, engine version, exit
  status, Evidence ID, errors, warnings, timing, peak memory) and the raw Evidence
  under `.era/runs/`.
* ERA is the **orchestrator**. It classifies targets, chooses REA workflows,
  normalizes Evidence into facts, writes reports, measures accuracy, and manages
  its own evolution.
* All REA capabilities stay available unchanged through `era rea <command>`,
  including `era rea mcp` and `era rea doctor`.
* ERA does not copy or modify REA code. REA is MIT-licensed. See [NOTICE.md](NOTICE.md).

Details: [docs/original-rea-analysis.md](docs/original-rea-analysis.md) ·
[docs/rea-integration.md](docs/rea-integration.md) ·
[docs/architecture.md](docs/architecture.md)

## Install

```bash
git clone https://github.com/dav1dngy/era-agent.git
cd era-agent
npm install        # installs the REA engine (rea-agents@6.4.0)
npm test
npm link           # optional: puts `era` on PATH
era status
```

Requirements: Node.js ≥ 22.19, git. Native decompilation additionally needs
Hopper, Ghidra 12.1.x (`GHIDRA_INSTALL_DIR`) or IDA Pro MCP. See
[docs/installation.md](docs/installation.md).

## Configure

Optional `era.config.json` in the working directory:

```json
{
  "rea": { "command": null, "timeoutMs": 600000, "measureResources": true },
  "analysis": { "maxDecompiledFunctions": 8 },
  "limits": { "maxCycles": 3, "maxReaRunsPerCycle": 12, "commandTimeoutMs": 900000 },
  "improvement": { "implementerCommand": null },
  "benchmark": { "repetitions": 3 }
}
```

`ERA_REA_BIN` selects a specific REA binary and `ERA_STATE_DIR` moves `.era/`.

## Analyze software

```bash
era analyze benchmarks/datasets/js-app
era analyze benchmarks/datasets/native-hello/hello
era analyze benchmarks/datasets/native-hello/hello --runtime --arg demo   # executes the target
era analyze benchmarks/datasets/archive/js-app.zip --json
era inspect path/to/target          # classification + REA/provider status only
```

Excerpt of a real report ([full report](examples/sample-analysis-report.md)):

```c
### _greet @ 0x100000460        (Hopper via REA, from clang -O1 code)
    r19 = arg0;
    r9 = *(int8_t *)arg0;
    if (r9 != 0x0) {
            r10 = r19 + 0x1;
            r8 = 0x1505;                       // 5381: djb2 hash seed
            do {
                    r8 = r8 + r8 * 0x20 + r9;  // h = h * 33 + c
                    ...
    printf("Hello, %s! checksum=%u\n", r19, r8);
    r0 = strlen(r19);
```

Static analysis reads files only. `--runtime` **executes** the target with
your permissions, and REA's process capture is not a sandbox.

## Self-analysis and improvement cycles

```bash
era self-analyze                     # npm-pack ERA, analyze it with REA, list findings
era improve propose [--finding ID]   # REA self-analysis + planning benchmark → one hypothesis + worktree
#   … implement and commit in .era/worktrees/<cycle> (Claude Code, a human, or --implementer) …
era improve evaluate <cycle>         # tests + benchmarks + REA self-analysis → accept or reject
era improve --cycles 1 --implementer './implement.sh'   # unattended, bounded
era history
era rollback era-v2                  # restores a version as a new commit (non-destructive)
```

An accepted change is merged into `main` with `--no-ff` and tagged `era-vN`. A
rejected change leaves `main` untouched and keeps its branch. The evaluator, the
self-analysis rules, the datasets and the acceptance criteria are protected
paths: an experiment that touches them is rejected. See
[docs/self-improvement.md](docs/self-improvement.md).

### Initial experiment: 3 cycles

| Cycle | Change | Target | Decision |
|---|---|---|---|
| 1 | Infer CommonJS named exports from REA's semantic graph | F1 0.956 → 0.987 ✅ | **Rejected**: REA self-analysis findings 7 → 9 (more files hit REA's `resource_constraint`) |
| 2 | Split REA self-analysis into size-balanced passes | REA coverage finding resolved ✅ | **Accepted → era-v2** |
| 3 | Retry cycle 1's change on top of era-v2 | F1 0.956 → 0.987 ✅ | **Accepted → era-v3** |

Evidence for each cycle (cycle records, REA run records, self-analysis reports,
ledger) is in [`experiments/cycles/`](experiments/cycles/). Baseline REA
executions are in [`experiments/baseline/`](experiments/baseline/).

## Benchmarks

BENCHMARK_TABLE_PLACEHOLDER

## Limitations

* **Experimental.** Three improvement cycles have been run. The implementer in
  those cycles was Claude Code working interactively. The unattended
  `--implementer` mode is tested only with scripted commands.
* **Native analysis** covers Mach-O only. Decompilation requires a deep
  provider; Hopper's public API does not expose full function body ranges.
* **REA limits observed:** CommonJS `module.exports = {…}` member names are
  inferred by ERA (marked as inference in code); string literals passed directly
  as call arguments are not retained by REA; REA's JavaScript result budget
  (~993 MB) can leave large inputs with `resource_constraint` (partial) coverage.
  ERA treats this as incomplete, not as absence.
* **Open self-analysis findings in era-v3:** some test files are again
  partially covered by REA (the fixed three-files-per-pass split is not adaptive),
  which suppresses absence-based rules, and `src/cli.js` / `src/orchestration/cycle.js`
  have high fan-out. See [docs/self-improvement.md](docs/self-improvement.md#what-the-experiment-also-revealed-open-items).
* Benchmark datasets are small authored fixtures (5 cases); scores are not
  representative of arbitrary software.
* ERA does not modify, retrain or fine-tune any foundation model.
  "Self-improvement" means changes to ERA's own source code.

## Safety

Only analyze software you are authorized to analyze. Analyzed artifacts are
treated as untrusted data. Self-improvement is hard-capped (≤ 10 cycles, one
experiment at a time, timeouts everywhere), refuses to run in CI, never
force-pushes and never publishes. See [SECURITY.md](SECURITY.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Run `npm test` and
`node scripts/check.mjs` before opening a pull request.

## License and attribution

ERA is MIT-licensed ([LICENSE](LICENSE)). It integrates and executes
**Reverse Engineer Anything** by morluto (<https://github.com/morluto/rea>),
MIT-licensed. The full notice is in [NOTICE.md](NOTICE.md).
