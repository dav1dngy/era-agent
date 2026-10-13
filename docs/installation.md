# Installation

## Requirements

| Requirement | Notes |
|---|---|
| macOS (arm64 verified) or Linux | macOS 27 arm64 is the verified host. On Linux, Mach-O inspection and Hopper decompilation are unavailable, but JavaScript, archive and process workflows are supported by REA there |
| Node.js `>=22.19` (REA needs `^22.19 \|\| ^24.11 \|\| >=26`) | verified with v24.20.0 |
| npm | to install dependencies |
| git | required for self-improvement (worktrees, tags) |
| Optional: Hopper Disassembler, Ghidra 12.1.x, or IDA Pro MCP | only for native decompilation (`era analyze <mach-o>` decompiles exported functions when `rea providers` reports one available) |

## Install from source

```bash
git clone https://github.com/dav1dngy/era-agent.git
cd era-agent
npm install          # installs rea-agents@6.4.0 (the REA engine)
npm test             # unit + REA integration tests
node bin/era.mjs --help
```

To put `era` on your PATH:

```bash
npm link
era status
```

## Using an existing REA installation

If REA is already installed (for example `npm install -g rea-agents@6.4.0`), ERA
uses it when `node_modules/.bin/rea` is absent. You can point ERA at a specific
binary instead:

```bash
export ERA_REA_BIN=/path/to/rea
era status
```

## Optional native decompilation

REA chooses a deep analysis provider automatically:

* **Hopper**: installed at `/Applications/Hopper Disassembler.app` (the demo works, with Hopper's demo limitations).
* **Ghidra**: set `GHIDRA_INSTALL_DIR` to an extracted Ghidra 12.1.x release (needs a JDK).
* **IDA Pro**: set `REA_IDA_MCP_CONFIG` (see REA's `docs/ida-provider.md`).

Check with `era status` (or `era rea providers`). `era rea doctor` gives REA's own
readiness report.

## Configuration

`era.config.json` in the working directory (all fields optional):

```json
{
  "stateDir": ".era",
  "rea": { "command": null, "timeoutMs": 600000, "measureResources": true },
  "analysis": { "maxDecompiledFunctions": 8 },
  "limits": { "maxCycles": 3, "maxReaRunsPerCycle": 12, "commandTimeoutMs": 900000 },
  "improvement": { "implementerCommand": null, "implementerTimeoutMs": 1800000 },
  "benchmark": { "repetitions": 3 }
}
```

Environment overrides: `ERA_REA_BIN`, `ERA_STATE_DIR` (see `.env.example`).
Limits are capped by hard limits in `src/safety/policy.js` (for example, at most 10
cycles and one parallel experiment).

## Verify the installation

```bash
era status
era analyze benchmarks/datasets/js-app
era analyze benchmarks/datasets/native-hello/hello
```
