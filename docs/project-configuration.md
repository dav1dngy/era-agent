# Project configuration

A project is one external software project (or reference) plus what to do with
it. Create it from flags, from a JSON file, or both (flags win):

```bash
era project create my-app --source ~/code/my-app --mode modify --task "Fix the login bug" \
    --agent claude-code --test "npm test --silent" --accept-fail "node --test extra/login.test.js"
era project create --config examples/project-lab/modify-project.json
```

Configuration is validated when the project is created **and again each time an
operation starts**. State is stored in `<stateDir>/projects/<id>/project.json`.

## Properties

| Property | Flag | Meaning |
|---|---|---|
| `id` | positional / `--id` | 1–63 chars of `a-z 0-9 - _`. Names the state directory |
| `mode` | `--mode` | default operation: `review` \| `modify` \| `rebuild` (any operation can be run on any project) |
| `source` | `--source` | the project to review or modify (must exist; never modified without approval) |
| `reference` | `--reference` | the authorized reference artifact for Rebuild (file or directory) |
| `destination` | `--destination` | where Rebuild writes the new project: must not exist or be empty, and must not overlap `source`/`reference` |
| `task` | `--task` | what to do. Required for Modify and Rebuild |
| `authorization` | `--authorization` | **Rebuild only, required**: why you may analyze the reference. Recorded in the run |
| `agent` | `--agent` | `manual` (default), `command`, `claude-code`, `codex`. Default can be set in `era.config.json` (`projectLab.agent`) |
| `agent_command` | `--agent-command` | shell command for the `command` agent; cwd is the working copy; receives `ERA_PHASE`, `ERA_READ_ONLY`, `ERA_INSTRUCTIONS_FILE` (the prompt), `ERA_WORKTREE` |
| `commands.build` | `--build` (repeatable) | build commands, run in the working copy |
| `commands.test` | `--test` (repeatable) | test commands. Their output is itemized to detect regressions |
| `commands.run` | `--run` | Rebuild: how to start the new implementation; behavior arguments are appended |
| `acceptance.criteria` | `--criteria` (repeatable) | human-readable criteria; shown to the agent and in the report |
| `acceptance.commands` | `--accept CMD`, `--accept-fail CMD` | commands that must pass after the change. `baseline: "fail"` (`--accept-fail`) means it must fail before (reproduces the problem), otherwise the run stops |
| `acceptance.behaviors` | `--config` only | Rebuild: see below |
| `protected` | `--protect` (repeatable) | globs (`*`, `**`, `?`) of files that must not change. `.git/**` and `.era/**` are always protected; Rebuild also protects `SPEC.md` |
| `limits.*` | `--max-cost`, `--timeout-ms`, `--max-attempts` | see below |
| `trust_project` | `--trust-project` | run project commands without the sandbox (needed where none exists). **Only for code you trust** |

If `commands.build`/`commands.test` are empty, ERA uses detected candidates whose
tool exists (for example `npm test --silent` from `package.json`), and the report
labels them `detected`.

### Limits (all validated; capped by hard limits)

| Property | Default | Meaning |
|---|---|---|
| `commandTimeoutMs` | 600000 | per project command |
| `agentTimeoutMs` | 1800000 | per coding-agent call |
| `maxAttempts` | 2 (1–5) | agent attempts per run; later attempts get the failure output |
| `maxCostUsd` | 5 | per run (metered agents) |
| `maxCostUsdTotal` | 20 | per project, all runs |
| `maxChangedFiles` | 200 | larger changes are rejected |
| `maxDiffBytes` | 2,000,000 | larger diffs are rejected |
| `maxCopyBytes` / `maxCopyFiles` | 200 MB / 20,000 | refuse to copy bigger projects |

Global defaults live in `era.config.json`:

```json
{ "projectLab": { "agent": null, "agentCommand": null, "budget": { "allowUnmeteredAgents": false } } }
```

### Rebuild behaviors

```json
"acceptance": {
  "behaviors": [
    { "name": "default", "args": [], "capture": "reference" },
    { "name": "alice", "args": ["alice"], "stdin": null, "capture": "reference" },
    { "name": "stated", "args": ["x"], "expect": { "stdout": "Hello, x! checksum=177693\n", "exit_code": 0 } }
  ]
}
```

* `capture: "reference"` runs the reference (an executable file) in the sandbox with
  these arguments/stdin and records stdout and exit code as the expectation.
* `expect` states the expectation yourself (from documentation or knowledge).
* The new implementation is started as `commands.run` + arguments; stdout is compared
  after normalizing line endings and trailing whitespace, and the exit code exactly.
* A Rebuild must have at least one acceptance check (`behaviors`, `acceptance.commands`
  or `commands.test`); otherwise it will not start.

### Statuses

Project/run status: `created`, `running`, `awaiting-implementation` (manual agent),
`awaiting-approval`, `rejected`, `failed`, `interrupted`, `cancelled`, `complete`
(review), `applied`, `rolled-back`. Approval: `none`, `pending`, `approved`,
`withdrawn`. `era project status <id>` always prints the next step.

## Common errors

| Message | Cause / fix |
|---|---|
| `source (…) is inside ERA's own installation` | Project Lab only works on external projects; use the Improvement Lab for ERA |
| `Acceptance command "…" is expected to fail at baseline … but passes` | the criteria do not reproduce the problem; fix the command or use `--accept` |
| `No sandbox is available for untrusted candidate code` | not on macOS: pass `--trust-project` only for trusted code |
| `Coding agent "…" cannot report its API cost` | set `projectLab.budget.allowUnmeteredAgents` or use a metered agent |
| `The original project changed since this run started` | someone edited the source during the run; re-run |
| `ISOLATION VIOLATION` | the original changed while a run was active; nothing is applied |
