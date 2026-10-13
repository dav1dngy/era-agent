# Provider configuration

How to set up the coding agents that can fill ERA's multi-agent roles. Check the result with
`era agents` (all providers, capabilities, availability, sign-in) and `era project team <id>`.

## Claude Code

```bash
claude auth login            # sign in once; ERA never handles your credentials
claude auth status           # ERA reads this: {"loggedIn": true, …}
```

```json
{ "agents": { "claude-code": { "command": "claude", "model": null } } }
```

* ERA runs `claude -p <prompt> --output-format json --permission-mode acceptEdits` (implementer) or
  `plan` (architect, reviewer) in the role's directory, with `--max-budget-usd` from the remaining
  budget. Cost is read from the JSON result (`total_cost_usd`), so Claude Code is **metered**.
* `ANTHROPIC_API_KEY` works instead of a login; it is passed through the allowlisted environment.
* A standalone `claude` can be signed out even if another Claude Code surface on the same machine
  is signed in; ERA checks the standalone CLI it will run.

## OpenAI Codex

```bash
codex login                  # sign in with ChatGPT or an API key
codex login status
```

```json
{ "agents": { "codex": { "command": null, "model": null } } }
```

* `command: null` looks for `codex` on `PATH`, then in the ChatGPT/Codex desktop app bundles.
* ERA runs `codex exec -C <dir> -s workspace-write|read-only --skip-git-repo-check --ephemeral --json`,
  with `$TMPDIR` and `/tmp` removed from the writable set. Codex reports token usage but no dollar
  cost, so it is **unmetered**: set `projectLab.budget.allowUnmeteredAgents: true` to use it, which
  means ERA cannot cap its spend in dollars (your ChatGPT/API plan limits apply).

## Custom command agents

Any program that edits files in its working directory can fill a role. Declare it once:

```json
{
  "projectLab": {
    "customAgents": {
      "lint-fixer": { "command": "node ./tools/agent.mjs", "remote": false },
      "cloud-bot":  { "command": "./cloud-agent.sh", "remote": true,
                      "capabilities": { "readsInstructionFiles": true } }
    }
  }
}
```

Use them as `custom:lint-fixer` anywhere an agent id is accepted (`--implementer custom:lint-fixer`).
The command runs with the role's directory as cwd and receives `ERA_PHASE`, `ERA_READ_ONLY`
(`1` for architect/reviewer), `ERA_INSTRUCTIONS_FILE` (the prompt), `ERA_WORKTREE`. It runs inside
ERA's macOS sandbox (writes only to its directory; read-only roles cannot write at all). Declare
`"remote": true` if it sends anything off the machine, so consent is required. A role's output goes
to stdout: JSON object (architect), JSON array (reviewer).

## Presets and overrides

```json
{
  "projectLab": {
    "presets": { "thorough": { "architect": "claude-code", "implementer": "codex", "reviewer": "codex" } },
    "agentOverrides": { "codex": { "metered": false } }
  }
}
```

## Third-party adapters

In code: `registerCodingAgent('acme', { create(config) { return { id, metered, probe(), auth?(), implement(task) } }, capabilities: { remote: true, readOnlyMode: 'verified' } })`.
`implement(task)` receives `{ worktree, prompt, readOnly, phase, timeoutMs, budgetUsd, wrapCommand }`
and returns `{ ok, exit_code, timed_out, duration_ms, cost_usd, cost_reported, tokens, stdout_tail,
stderr_tail, output }`. An adapter may add `auth()` returning `{ authenticated, detail }`.

## Spending and consent

| Setting | Where | Meaning |
|---|---|---|
| `--allow-remote A,B` | `era project create/modify/…` | authorize these providers to receive the project's source (stored on the project, recorded in the ledger) |
| `--allow-secret-content` | `era project create` | permit sending files that contain secret-looking text |
| `--max-cost USD` | `era project create` | per-run cap for metered agents |
| `projectLab.budget.allowUnmeteredAgents` | `era.config.json` | allow agents that cannot report a dollar cost |
| `--review-rounds N`, `--block-on LEVEL` | `era project create` | correction rounds (0–3) and the blocking severity |
