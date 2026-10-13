# Real provider validation (v0.2.0 development)

Date: 2026-10-13. Host: macOS arm64 (Darwin 27), Node 24.20.0. Everything below was observed
with the real CLIs; nothing is mocked unless a row says so. Raw evidence:
[`experiments/provider-validation/`](../experiments/provider-validation) (per provider, from
`node scripts/validate-providers.mjs`) and [`experiments/multi-agent-demo/`](../experiments/multi-agent-demo)
(real multi-agent runs). Paths in the evidence are anonymized.

## Availability

| Provider | Installed | Signed in | Result |
|---|---|---|---|
| **OpenAI Codex** `codex-cli 0.160.1` (ChatGPT app bundle) | yes | yes (ChatGPT login) | **validated** (8/8 checks) |
| **Claude Code** `2.1.260` | yes | **no** (`claude auth status` → `loggedIn: false`) | **unavailable: not validated** |

**Claude Code could not be exercised.** The standalone `claude` CLI on this machine is signed
out (`Not logged in · Please run /login`), so no real Claude Code run (write, read-only, review,
timeout, cost, cancellation) exists in this repository's evidence. ERA does not try to borrow
another surface's credentials. To validate it yourself:

```bash
claude auth login
node scripts/validate-providers.mjs claude-code     # writes experiments/provider-validation/claude-code.json
```

What *was* verified for Claude Code, for real: the adapter detects the CLI and its version,
detects that it is signed out, reports a clear fix, refuses to start it, and — if started anyway
— turns the provider's `is_error` result into a failed attempt with no cost. The Claude-specific
code paths that remain **untested against the real CLI**: `plan` mode for read-only roles,
`--max-budget-usd` enforcement, `total_cost_usd` parsing from a successful run, and Claude's
file edits under `acceptEdits`. They are exercised only against fake CLIs and scripted agents.
**Do not read the `claude+codex` or `claude-only` presets as validated.**

## Codex results

| Check | Result | Evidence |
|---|---|---|
| Authentication handling | pass | `codex login status` → "Logged in using ChatGPT"; ERA checks it before every first use |
| Real execution and **file modification** | pass | created `result.txt` = `ERA-OK` in a throwaway git repo (9.4 s, 37,161 input / 71 output tokens) |
| **Workspace isolation** | pass after a fix | see "Finding" below |
| Read-only mode | pass | `-s read-only` asked to create a file: refused ("this workspace is read-only"), file not created |
| Review output | pass | read-only review returned a parseable JSON array (`[]` for a trivial file) in ERA's format |
| **Timeout** | pass | killed at 20.0 s (`timed_out: true`), process group terminated by the watchdog, 0 leftover processes |
| **Cancellation** | pass | `era project cancel` while Codex worked: run `cancelled`, 2 processes referencing the working copy before, **0 after**, working copy removed, original untouched |
| **Cost reporting** | partial, by design | Codex reports token usage but **no dollar cost**. ERA records the tokens and treats Codex as *unmetered*: you must opt in (`allowUnmeteredAgents`), and ERA cannot cap its spend in dollars |
| Error recovery | pass | an unsupported model returned HTTP 400 → failed attempt with the provider's message, not success |

### Finding: Codex could write outside the working copy (fixed)

The first validation run asked Codex to also create `../escape.txt`. **It did** (`escape_file_created:
true`): Codex's `workspace-write` sandbox also allows `$TMPDIR` and `/tmp`, and the scratch
parent directory was inside `$TMPDIR`. For ERA this means a working copy under a temp directory
would have been writable one level up. Fix (in `src/agents/coding-agents.js`): the adapter now passes
`-c sandbox_workspace_write.exclude_tmpdir_env_var=true -c sandbox_workspace_write.exclude_slash_tmp=true`
for writing runs. After the fix the same request produced no file (`escape_file_created: false`,
canary intact), and the write task still passed. Side effect: commands the agent itself runs
that need a temp directory may fail inside Codex's sandbox; ERA's own verification runs
outside it, so ERA's decision is unaffected. Residual risk: Codex's sandbox is Codex's, not ERA's;
it was verified for this version and these paths only.

## Real multi-agent development runs

| Run | Real | Scripted/mock | Outcome |
|---|---|---|---|
| [`all-codex-real`](../experiments/multi-agent-demo/all-codex-real) | Codex as architect, implementer **and** reviewer, REA 6.4.0, ERA orchestration and tests | nothing | Task: add `search(query)` to a catalog project. Design (33 s) → implementation with tests (42 s) → review (11 s, 0 findings) → ERA re-ran the project's tests (2 → 8 passing) and the acceptance command → `awaiting-approval`. Token usage per role is in the ledger (Codex reports no dollar cost). **Not approved or applied** |
| [`hybrid-real-review`](../experiments/multi-agent-demo/hybrid-real-review) | Codex as reviewer, REA, ERA | the *implementer is a script* that plants an `eval` flaw | The real reviewer found "Shopper-supplied discount expressions execute arbitrary JavaScript" (high, `src/cart.js:12`); ERA verified the file, line and quote, treated it as blocking, requested a correction, re-ran the tests, and the second real review was clean |

I independently ran `node --test tests/*.test.js acceptance/*.test.js` in the verified working copy of this run
(11 of 11 pass: 8 project tests + 3 acceptance tests) and checked that the original project was byte-identical to the fixture afterwards. A first, earlier all-Codex run of the same task behaved the same way (9 passing tests, 0 review findings).

What these runs do **not** show: Codex generating a review finding on its *own* code in a
correction loop (the hybrid run shows the loop with a scripted implementer); any Claude Code
behavior; a multi-provider (`claude+codex`) run; behavior on large or unfamiliar codebases
(the tasks were tiny); repeatability (one run each; models are non-deterministic).

## Authentication and credentials handling, as implemented

* ERA never reads, copies or stores provider credentials. It asks the CLI (`claude auth status`,
  `codex login status`) and passes the CLI an allowlisted environment.
* A signed-out provider fails the run before any prompt is sent, with the command to fix it.

## Not validated

* Claude Code in any role (not signed in).
* Cost enforcement against a real metered agent (needs Claude Code or an API-billed agent).
* Linux (no ERA sandbox; Codex/Claude run under their own sandboxes only).
* Provider behavior under rate limiting or network loss (only a bad-model error was injected).
