# Architecture

ERA is a Node.js (ESM, no runtime dependencies besides `rea-agents`) CLI built
around the original REA engine. ERA never re-implements reverse engineering.
Every analysis fact comes from a recorded REA execution.

```
bin/era.mjs → src/cli.js (parse, context, logging, signals)
   └─ lazily loaded command modules: src/commands/{analysis,lab,info}.js
        │
        ├─ Analysis Mode ─────────────── analysis/analyze.js ── detect.js · facts.js · report.js
        │                                  └─ safety/sandbox.js (runtime capture)
        ├─ Reasoning ─────────────────── agents/reasoning.js (none | command | claude-code)
        └─ Improvement Lab ───────────── orchestration/cycle.js ◄── safety/policy.js (limits, budget, locks)
                                           ├─ evaluation/self-eval.js ─► self_analysis/self-analyze.js + rules.js
                                           ├─ improvement/planner.js
                                           ├─ improvement/modification.js ─► agents/coding-agents.js
                                           │                                (manual | command | claude-code | codex)
                                           ├─ evaluation/{tests,benchmark,score,decision}.js ◄── benchmarks/acceptance.json
                                           ├─ orchestration/{versions,ledger,interrupt}.js
                                           └─ reporting/{table,dashboard}.js
                 all REA executions ──► rea_integration/rea-client.js ──► core/process.js ──► core/watchdog.mjs ──► `rea … --format json`
                 observability ────────► core/log.js (JSONL, redaction via safety/secrets.js)
```

## Project Lab (v0.2.0 development)

```
src/commands/project.js  (CLI, thin)  ──►  src/project_lab/lab.js  ProjectLab API  (injected: config, rea, log, createAgent)
                                              ├─ schema.js     validated project definitions; ERA's own tree refused
                                              ├─ store.js      per-project state: project.json, runs/, work/, ledger.jsonl
                                              ├─ context.js    checkpointed steps, command runner, agent invocation (budget, ledger)
                                              ├─ review.js · modify.js · rebuild.js   the three workflows
                                              ├─ detect.js · evidence.js · runner.js · workspace.js · report.js
                                              └─ reuses: agents/coding-agents.js, safety/{policy,candidate-sandbox,secrets}.js,
                                                 orchestration/{interrupt,ledger}.js, analysis/analyze.js, self_analysis passes, rea_integration
```

### Multi-agent layer

```
agents/coding-agents.js  adapters + capability registry (registerCodingAgent, agentCapabilities, custom:<name>)
agents/team.js           roles, presets (data), capability checks, remote-consent, detection  — no workflow logic
project_lab/team.js      architect → implementer → reviewer loop (prompts, hand-offs, validation, corrections)
project_lab/exposure.js  what an agent may see: credential/instruction-file withholding, secret-content scan
project_lab/context.js   agentFor(role), invokeAgent (consent, auth, one-at-a-time, read-only verification), snapshots, handoff
```

The workflow asks for *roles*; `team.roles` maps them to agent ids; the registry maps ids to adapters
and their capabilities. Reasoning providers (text-only) and REA stay separate layers. See
[multi-agent.md](multi-agent.md).

Project Lab and the Improvement Lab share infrastructure (agents, sandbox, locks, ledger,
REA client) but no state, and Project Lab refuses ERA's own tree as a project. The
interface to a graphical client is the `ProjectLab` class, `--json` output and the JSON/JSONL
files under `<stateDir>/projects/`. See [project-lab.md](project-lab.md).

## Components

| # | Component | Module | Responsibility |
|---|---|---|---|
| 1 | Reverse Engineering Core | `src/rea_integration/rea-client.js` | Resolves the `rea` binary, executes REA commands with timeouts, and records each run (command, input digest, engine version, exit status, Evidence ID, errors, warnings, progress events, wall time, CPU, max RSS) under `.era/runs/<run_id>/` |
| 2 | Analysis Orchestrator | `src/analysis/analyze.js`, `detect.js` | Classifies a target by magic bytes/layout and runs the matching REA workflow. For Mach-O it also decompiles exported functions when a deep provider is available |
| 3 | Self-Analysis Engine | `src/self_analysis/self-analyze.js` | Packs ERA with `npm pack`, stages size-balanced REA passes (package + test groups), runs REA's JavaScript analyzer and REA process capture of `era --help` |
| 4 | Improvement Planner | `src/improvement/planner.js` | Ranks REA-derived findings and benchmark accuracy gaps by the charter priorities and writes one hypothesis with a predeclared target metric |
| 5 | Code Modification Controller | `src/improvement/modification.js` | Runs a configured implementer command inside the experiment worktree only and commits its changes on the experiment branch |
| 6 | Testing Engine | `src/evaluation/tests.js` | Runs `node --test` (TAP) for a checkout and parses the summary |
| 7 | Benchmark Engine | `src/evaluation/benchmark.js`, `score.js` | Runs a checkout's `era analyze` on every dataset as a subprocess, then scores facts against hand-written ground truth with the evaluator's own scoring code |
| 8 | Version Manager | `src/orchestration/versions.js` | Experiment branches/worktrees, `--no-ff` promotion to `main`, annotated `era-vN` tags, non-destructive rollback |
| 9 | Recursive Improvement Controller | `src/orchestration/cycle.js` | propose → implement → evaluate → decide, bounded and logged to `.era/ledger.jsonl` |
| 10 | Reporting Engine | `src/analysis/report.js`, `src/reporting/` | Markdown analysis/cycle reports, benchmark tables, optional static HTML dashboard |
| 11 | Safety Controller | `src/safety/policy.js`, `sandbox.js`, `secrets.js` | Hard limits, API budgets, protected paths, CI refusal, single-writer lock, target path validation, runtime sandbox, secret redaction |
| 12 | Coding-agent integration | `src/agents/coding-agents.js` | `{ id, metered, probe(), implement(task) }` adapters: manual, command, claude-code, codex |
| 13 | AI reasoning integration | `src/agents/reasoning.js` | `{ id, remote, probe(), explain() }` providers with data-egress authorization |
| 14 | Logging and process control | `src/core/log.js`, `src/core/process.js`, `src/core/watchdog.mjs`, `src/orchestration/interrupt.js` | JSONL logs with execution/correlation IDs; process-group timeouts; parent-death and deadline watchdog; cancellation |

## Design decisions

* **CLI subprocess, not a library binding, for REA.** It keeps REA unmodified,
  records exact commands, and is the interface REA documents for scripting.
  REA's MCP server stays available unchanged (`era rea mcp`).
* **No framework, no database, no services.** ESM modules, `node:` built-ins,
  JSON/JSONL files under `.era/`, git for versions.
* **Dependency inversion where it pays.** The cycle controller depends on agent
  and provider interfaces chosen by configuration. The evaluator and the
  candidate communicate only through subprocess contracts (`era analyze --json`,
  `era self-analyze --json`).
* **Secure by default.** Manual coding agent, local reasoning provider, remote
  egress off, sandboxed runtime capture, unmetered agents refused, no merge without
  approval.

## Trust boundaries in self-improvement

The candidate code under evaluation is never trusted to judge itself:

* The **evaluator** (stable checkout process) owns tests, scoring, acceptance
  criteria and self-analysis rules. Those paths are protected
  (`PROTECTED_PATHS`). An experiment that touches them is rejected.
* The **candidate** runs only as subprocesses: its own `era analyze` for
  benchmarks and its own `era self-analyze` for REA self-analysis. Its REA
  Evidence is then re-scored with the stable rules, and the evaluator checks that
  REA covered every source module listed by `git ls-files src bin`.
* Benchmark ground truth lives in `benchmarks/datasets/truth/` and was written
  by hand from the fixture sources, verified with `nm`, `otool` and `strings`.

## State layout

```
.era/                       (git-ignored)
  runs/<run_id>/            record.json, output.json (raw REA Evidence), stderr.log
  analyses/<id>/            analysis.json, report.md, provider.snapshot
  self-analyses/<id>/       self-analysis.json, report.md, work/ (packed artifact, passes)
  cycles/<id>/              cycle.json, instructions.md, report.md
  worktrees/<id>/           experiment worktrees (removed after a decision)
  benchmarks/               benchmark result JSON
  logs/era-YYYY-MM-DD.jsonl structured logs
  improve.lock              single-writer lock (stale locks cleared by `era improve recover`)
  ledger.jsonl              append-only ledger: proposals, agent runs (cost), decisions,
                            approvals, rebases, interruptions, recoveries, rollbacks
```
