# Troubleshooting

Start with `node bin/era.mjs status` (environment and provider state), `node bin/era.mjs studio doctor` (what Studio needs) and, in Studio,
*Tools → Run REA doctor*. Logs are under `.era/logs/` of a source checkout; Studio's audit log is in *Settings → Advanced*.

## Installation and launch

| Symptom | Cause and fix |
|---|---|
| A Studio command fails after following the CLI steps | The CLI tarball and the tag `v0.1.0` have no `apps/studio`. Clone the tag `v0.2.0` (or `main`) and run `npm ci --prefix apps/studio` ([installation](installation.md)). |
| "The access token was rejected" | The token changes with every launch. Restart `era studio serve` and open the new URL. |
| macOS says the app "cannot be opened" or is from an unidentified developer | The desktop build is **unsigned and not notarized** (a development build). An app you built yourself carries no quarantine flag and opens normally; a copy that was downloaded or transferred may be blocked. On recent macOS versions allow that one app under *System Settings → Privacy & Security → Open Anyway* (older versions: right-click → Open); this was not verified on a clean machine. Or run from source with `era studio app`. Do not disable Gatekeeper globally. |
| The desktop app cannot find `node` or `git` | Finder-launched apps get a minimal `PATH`; Studio imports your login shell's `PATH`. Start it from a terminal if your tools live elsewhere. |
| `REA: unavailable` | `npm ci` (REA is a dependency) or set `ERA_REA_BIN`; then `era status`. |

## Native analysis

| Symptom | Cause and fix |
|---|---|
| Ghidra shows unavailable | It needs a JDK 21 on `PATH` and `GHIDRA_INSTALL_DIR`; the desktop app imports `PATH` only, so start Studio from that shell. Check `era rea doctor`. |
| Native analysis hangs or times out | Hopper is a desktop app and stalls if the Mac sleeps or a dialog is open. Keep the Mac awake (`caffeinate`), close dialogs, retry; a partial report is not a complete analysis. |
| `This Hopper target is already open in REA session …` | An earlier REA process still holds it: `pgrep -fl "rea function"` and stop it. |
| Runtime capture refused | It executes the target and needs the macOS sandbox, or `--unsandboxed` for trusted binaries only. |

## Project Lab and agents

| Symptom | Cause and fix |
|---|---|
| An agent was not started | Read the message: missing per-provider consent (`--allow-remote`), no dollar cap (Codex), not signed in (`claude auth login`, `codex login`), or secret-looking content that appeared in the working copy. |
| Approval is refused | The working copy or the original changed after verification. Run `era project resume <id>` to verify again. |
| Rollback is refused | You changed files after approval. For Modify, ERA will not overwrite your edits; for Rebuild the destination must still match what ERA wrote, file for file (including `.git` and `build`). Remove the folder yourself once you are sure. |
| A run is stuck or interrupted | Open the project and resume or cancel it, or `era project resume|cancel <id>`. A lock prevents two runs on one project. |
| Commands fail only inside ERA | On macOS they run in a sandbox: no network, no reads of your home directory or other projects, no signalling other processes. Put what they need in the project; on other platforms they need Trusted execution. |
| The Git panel refuses a repository | The repository configures programs git would run (filters, drivers); without a sandbox ERA will not inspect it unless you enable Trusted execution. |

## Improvement Lab

| Symptom | Cause and fix |
|---|---|
| `Self-improvement must run from the stable branch "main"` | The Lab merges accepted cycles into `main`. Use a throwaway clone with its own `main`. |
| `REA run budget exceeded` | Baseline plus candidate self-analysis needs more runs than `limits.maxReaRunsPerCycle`; it is at the hard cap (50). See [Improvement Lab](improvement-lab.md). |
| `Another improvement run holds the lock` | Wait, or `era improve recover` if that process is gone. |
| `The stable branch moved since … was evaluated` | `era improve rebase <cycle>`, then `era improve evaluate <cycle>`. |
| An evaluation is `inconclusive` | A measurement failed on both sides (for example a Hopper timeout). Fix the environment and re-run the evaluation; no decision was made. |

More: [installation troubleshooting](installation.md#troubleshooting), [Studio notes](ERA_STUDIO.md#troubleshooting-and-limits), [what is verified](SUPPORT_AND_VALIDATION.md).
