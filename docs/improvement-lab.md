# ERA Improvement Lab

The Improvement Lab is ERA's controlled, evidence-driven system for improving
ERA's **own source code**. It does not modify, fine-tune or retrain any
foundation model.

## Roles

| Role | Responsibility | Implementations |
|---|---|---|
| Reverse-engineering engine | Performs every reverse-engineering operation | REA (`rea-agents`), always |
| Coding agent | Edits ERA's code inside an experiment worktree | `manual` (a human or an interactive agent such as Claude Code), `command` (any script), `claude-code` (`claude -p`), `codex` (`codex exec`) |
| Reasoning provider | Explains analysis results (`era explain`) | `none` (local, deterministic, default), `command` (for example a local model), `claude-code` (remote) |
| Maintainer | Approves or declines integration into `main` | a person |

Language models are never assumed to be coding agents: only adapters that run a
real agent CLI with file-editing tools are coding agents. `era agents` lists what
is available on the host.

## Workflow

```
era improve propose [--finding ID]
  1. stable version = current tag on clean main
  2. REA self-analysis: npm pack → byte-bounded passes → N × analyze-javascript-application
     + capture-process of `era --help` (stable rules applied to REA Evidence)
  3. planning benchmark (1 repetition)
  4. findings + benchmark gaps ranked by charter priority → one hypothesis + target metric
  5. git worktree add -b experiment/<cycle>

era improve implement <cycle> --agent claude-code|codex|command     (or edit manually)
  6. budget authorization (per-cycle and total USD; unmetered agents need opt-in)
  7. the agent runs with cwd = worktree; its changes are committed on the experiment branch

era improve evaluate <cycle>          (stable checkout; never merges)
  8. candidate identity recorded (commit, tree, patch digest); protected-path changes rejected unexecuted
  9. tests: baseline and candidate, sandboxed under identical conditions
 10. benchmarks: supervisor runs REA once per case/repetition; each version extracts facts (sandboxed, no ground truth)
 11. supervised REA self-analysis of baseline and candidate (validated plans, stable rules, coverage)
 12. decision against benchmarks/acceptance.json: invalid measurements → inconclusive;
     baseline-passing tests must still pass; → rejected (main untouched, branch kept) or awaiting-approval
     + change.patch and report.md (the reviewable change proposal)

era improve show <cycle>              review
era improve approve <cycle>           13. maintainer approval → merge --no-ff (Approved-by trailer) + tag era-vN
era improve decline <cycle>           13'. main unchanged
era rollback <era-vN>                 14. restore any earlier version as a new commit
```

`era improve --cycles N --agent <id>` runs steps 1–12 unattended, bounded by
`limits.maxCycles`. Accepted experiments still stop at awaiting-approval.

## Controls

| Control | Mechanism |
|---|---|
| Iteration limit | `limits.maxCycles` (decided cycles), hard cap 10 |
| Execution time | timeouts on every subprocess (REA, tests, benchmarks, agents); process-group kill |
| REA resource use | `limits.maxReaRunsPerCycle` (self-analysis runs), hard cap 50 |
| API cost | `improvement.budget.maxCostUsdPerCycle` / `maxCostUsdTotal` (hard caps $50 / $200). Claude Code receives `--max-budget-usd` and reports `total_cost_usd`; Codex reports tokens only and needs `allowUnmeteredAgents` |
| Parallelism | one experiment at a time (lock file), no parallel evaluations |
| Cancellation | SIGINT/SIGTERM kill child process groups; the cycle returns to `proposed` with no decision (`cycle-interrupted`); `era improve cancel` abandons it |
| Recovery | `era improve recover`: stale locks, cycles stuck in `evaluating`, missing worktrees, leftover benchmark worktrees |
| Regression detection | accuracy, error rate, reliability, time (≤ 30%), memory (≤ 20%), REA findings, REA coverage, all tests |
| Self-judgment | the evaluator, rules, datasets and criteria are protected paths; the candidate runs only as subprocesses |
| Stable-branch protection | no merge without `era improve approve`; approval needs a TTY confirmation or `--yes`, is refused in CI, and requires main to still be at the evaluated base |
| Audit trail | `.era/ledger.jsonl` (proposals, agent runs with cost, decisions, approvals, interruptions, recoveries, rollbacks) and `.era/logs/*.jsonl` |

## Isolation and evidence ownership

A git worktree isolates **code changes**. It is not a security sandbox.

* **Evaluation:** the stable supervisor runs every REA execution. Candidate
  code (tests, `era extract`, `era self-analyze --plan`, `era --help`) runs only
  under a sandbox-exec profile: no network, writes only to the candidate
  checkout and private temp, no reads of ERA state, ground truth or credential
  stores, and an environment without secret-looking variables. The baseline
  runs under identical conditions; tests that need REA, a nested sandbox or the
  end-to-end Lab are skipped on both sides. Without a sandbox, evaluation
  refuses unless `--trust-candidate`.
* **Self-analysis:** the candidate contributes only a plan. The supervisor
  checks that every file is analyzed exactly once with its committed bytes.
* **Approval** merges exactly the evaluated commit (commit, tree and patch
  digest re-checked).
* **Coding agents** run with your user permissions inside the worktree,
  limited only by their own mechanisms (Claude Code `acceptEdits`, Codex
  `-s workspace-write`).
* **Analyzed executables** run under the runtime sandbox
  (`era analyze --runtime`).

## Self-analysis approach and limits

ERA is JavaScript, so self-reverse-engineering uses REA's static JavaScript
application analyzer on ERA's **packed npm artifact** plus its tests, and REA's
process capture on the CLI. ERA has no compiled binaries of its own to
decompile. REA's analyzer has a fixed per-run result budget, so the artifact is
split into byte-bounded passes. Local imports that cross passes resolve to
one-line placeholder files. When REA reports `resource_constraint` for a file,
ERA records `incomplete-analysis-coverage` and suppresses absence-based rules,
because unavailable facts are not absence.

## Experiment record

See `docs/self-improvement.md` for every cycle run so far, including rejected ones.
