# Installation

## Requirements

| Requirement | Notes |
|---|---|
| macOS (arm64 verified) or Linux | macOS 27 arm64 is the verified host. On Linux, Mach-O inspection, Hopper decompilation and the runtime sandbox are unavailable; JavaScript and archive workflows work |
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

`era.config.json` in the working directory (all fields optional). The values below are this repository's configuration; built-in defaults differ only in `limits.maxCycles` (3) and `limits.maxReaRunsPerCycle` (12):

```json
{
  "stateDir": ".era",
  "rea": { "command": null, "timeoutMs": 600000, "measureResources": true },
  "analysis": { "maxDecompiledFunctions": 8 },
  "limits": { "maxCycles": 6, "maxReaRunsPerCycle": 40, "commandTimeoutMs": 900000 },
  "improvement": {
    "agent": null,
    "implementerCommand": null,
    "implementerTimeoutMs": 1800000,
    "budget": { "maxCostUsdPerCycle": 5, "maxCostUsdTotal": 20, "allowUnmeteredAgents": false }
  },
  "agents": { "claude-code": { "command": "claude", "model": null }, "codex": { "command": null, "model": null } },
  "reasoning": { "provider": "none", "allowRemote": false, "command": { "run": null, "remote": true } },
  "benchmark": { "repetitions": 3 }
}
```

* `improvement.agent`: `manual` (default), `command`, `claude-code` or `codex`.
  `era agents` shows what is installed. Codex is found on `PATH` or inside the
  ChatGPT app bundle.
* `reasoning.provider`: `none` explains locally without a model. A `command`
  provider receives the prompt on stdin, for example a local model:
  `{ "run": "ollama run llama3", "remote": false }`.
* Environment: `ERA_REA_BIN`, `ERA_STATE_DIR`, `ERA_LOG_LEVEL`
  (`debug|info|warn|error`), `ERA_LOG=off`. See `.env.example`.

All limits are capped by hard limits in `src/safety/policy.js`.

## MCP clients (Claude Code, Codex, Cursor, …)

REA ships the MCP server and the client registration. ERA reuses both:

```bash
era rea setup --dry-run      # show which agent clients REA would configure
era rea setup                # register REA's MCP server with detected clients
era rea mcp doctor           # validate MCP startup and tool listing
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `REA: unavailable` in `era status` | run `npm install`, or set `ERA_REA_BIN` |
| `provider_unavailable` / decompilation skipped | install Hopper, or set `GHIDRA_INSTALL_DIR`; check `era rea providers` |
| `This Hopper target is already open in REA session …` | a REA process from an earlier crash still holds the session: find it with `pgrep -fl "rea function"` and stop it (ERA's watchdog prevents new orphans) |
| `Another improvement run holds the lock` | wait, or run `era improve recover` if that process is gone |
| `The stable branch moved since … was evaluated` | `era improve rebase <cycle>`, then `era improve evaluate <cycle>` |
| `Runtime capture executes the target, and no sandbox is available` | use macOS, or pass `--unsandboxed` for trusted binaries only |

## Verify the installation

```bash
era status
era analyze benchmarks/datasets/js-app
era analyze benchmarks/datasets/native-hello/hello
```
