# Installation

## Requirements

| Requirement | Notes |
|---|---|
| macOS (arm64 verified) or Linux | macOS 27 arm64 is the verified host. On Linux, Mach-O inspection, Hopper decompilation and the runtime sandbox are unavailable; JavaScript and archive workflows work |
| Node.js `^22.19 \|\| ^24.11 \|\| >=26` (the range of the pinned REA engine) | verified with v24.20.0 only |
| npm | to install dependencies |
| git | required for self-improvement (worktrees, tags) |
| Optional: Hopper Disassembler, Ghidra 12.1.x, or IDA Pro MCP | only for native decompilation (`era analyze <mach-o>` decompiles exported functions when `rea providers` reports one available) |

## Choose what to install

| Route | What you get | Contains ERA Studio |
|---|---|---|
| ERA with Studio (v0.2.0): the default branch `main` or the tag `v0.2.0` | CLI plus ERA Studio (desktop shell and browser) | yes |
| CLI only: the `era-agent-0.2.0.tgz` attached to the release, or the tag `v0.1.0` | the `era` command line | **no** |
| Local desktop build: `npm run package --prefix apps/studio` | an unsigned macOS arm64 `ERA Studio.app` | yes |

Neither the CLI tarball nor the tag `v0.1.0` contains `apps/studio`. No signed or notarized desktop download is published.

## Install from source

```bash
git clone --branch v0.1.0 https://github.com/dav1dngy/era-agent.git      # the previous, CLI-only release
cd era-agent
npm install          # installs rea-agents@6.4.0 (the REA engine)
npm test             # unit + REA integration tests
node bin/era.mjs --help
```

For ERA with Studio (v0.2.0) clone that tag instead and install both dependency sets:

```bash
git clone --branch v0.2.0 https://github.com/dav1dngy/era-agent.git && cd era-agent
npm ci && npm ci --prefix apps/studio
node bin/era.mjs studio doctor && node bin/era.mjs studio app
```

State lives in `.era/` of a source checkout (CLI and `studio app`) or
in the packaged app's own data folder under `~/Library/Application Support/` (its `state` subfolder); delete it to reset. To upgrade, `git pull`, `npm ci` and
`npm ci --prefix apps/studio`; if a run is interrupted use `era project resume <id>` or `era improve recover`.

To put `era` on your PATH:

```bash
npm link
era status
```

## ERA Studio desktop application (macOS)

| | Development build (what exists) | Signed and notarized production release (does **not** exist yet) |
|---|---|---|
| Signature | none (unsigned); not notarized | Developer ID signature, hardened runtime, Apple notarization |
| Where it comes from | built by you with `npm run package --prefix apps/studio`; **no prebuilt app is attached to the v0.2.0 release** | a download that macOS opens without a warning |
| Gatekeeper | a build you made yourself opens normally; a copy that was downloaded or transferred may be blocked (see below) | accepted |
| Platform | macOS on Apple silicon (arm64) is the only validated one | not applicable |
| Updates | none (no auto-updater) | not applicable |

Nothing in this repository claims or implies a signed or notarized build. Treat the desktop app as a development build.

**Build and install it yourself**

```bash
git clone --branch v0.2.0 https://github.com/dav1dngy/era-agent.git && cd era-agent
npm ci && npm ci --prefix apps/studio
npm run package --prefix apps/studio                    # builds apps/studio/out/ERA Studio-darwin-arm64/ERA Studio.app
npm run test:package --prefix apps/studio               # launches it outside the repository and checks authentication, isolation and REA
cp -R "apps/studio/out/ERA Studio-darwin-arm64/ERA Studio.app" /Applications/
open -a "ERA Studio"
```

The app still needs Node.js (22.19+ or 24.11+), Git and Python 3 on your machine, and optional native decompilers and coding-agent CLIs; it imports your login shell's
`PATH` (not other variables such as `GHIDRA_INSTALL_DIR`). It keeps its own state in its data folder under `~/Library/Application Support/`.

**A downloaded or transferred copy of the app**

The v0.2.0 release does not include a desktop app; if you receive a copy of one you built elsewhere, verify its checksum against the one the sender gave you, then:

If macOS refuses to open it (it is unsigned), allow that single app under *System Settings → Privacy & Security → Open Anyway* (older macOS: right-click → Open).
This was not verified on a clean machine. Do not disable Gatekeeper globally. Uninstall by deleting the app and its data folder.

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
