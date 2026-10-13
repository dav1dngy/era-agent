# ERA Multi-Agent Engineering

> Status: ERA v0.2.0 development (branch `feature/era-v0.2.0`), experimental. Real-provider
> evidence and its gaps are in [provider-validation.md](provider-validation.md); what the
> automated tests do and do not prove is in [multi-agent-testing.md](multi-agent-testing.md).

Multi-agent engineering lets ERA coordinate several coding agents inside one
[Project Lab](project-lab.md) *Modify* workflow: one agent designs, one implements, one
reviews independently. ERA itself runs the tests, decides, reports and asks for approval.
Roles are configuration. No provider name appears in the workflow code.

## Who does what

| Component | Default | Job |
|---|---|---|
| **REA** | the original engine | reverse engineering and **evidence** only (unchanged) |
| **Architecture agent** | Claude Code (`claude+codex`) | requirements analysis, technical design, extra acceptance criteria. Read-only |
| **Implementation agent** | OpenAI Codex (`claude+codex`) | code changes, bug fixes, tests, and *corrections* after review. The only role that may write |
| **Review agent** | Claude Code (`claude+codex`) | independent review of the verified diff. Read-only |
| **ERA (orchestrator)** | n/a | workflow, isolation, test execution, regression detection, review-finding validation, limits, reporting, approval |
| **User** | n/a | the request, acceptance criteria, authorization to send code to remote providers, final approval |

Layers that stay separate in the code: the reverse-engineering engine (`src/rea_integration`),
reasoning providers (`src/agents/reasoning.js`: text-only models, no filesystem; not part of
the team), coding-agent adapters and their capability registry (`src/agents/coding-agents.js`),
team/role resolution and consent (`src/agents/team.js`), the workflow (`src/project_lab/team.js`,
`modify.js`), and ERA as orchestrator (`src/project_lab/context.js`, `lab.js`).

## Choosing a team

```bash
era project create shop --source ~/code/shop --task "..." --team claude+codex --allow-remote claude-code,codex
era project create shop --source ~/code/shop --task "..." --team codex-only   --allow-remote codex
era project create shop --source ~/code/shop --task "..." --team claude-only  --allow-remote claude-code
era project create shop --source ~/code/shop --task "..." --architect claude-code --implementer custom:local --reviewer codex --allow-remote claude-code,codex
era project team shop        # roles, capabilities, availability and sign-in of each provider
```

| Choice | Roles |
|---|---|
| `claude-only` | Claude Code architect, implementer and reviewer |
| `codex-only` | Codex architect, implementer and reviewer |
| `claude+codex` | Claude Code architect and reviewer, Codex implementer |
| `custom` / explicit flags | any agent per role: `--architect`, `--implementer`, `--reviewer` |
| (no team) | the existing single `--agent`, unchanged |

Presets are data (`projectLab.presets` in `era.config.json` adds or overrides them). Using the
same provider for implementation and review is allowed and flagged in the report as *weaker
independence* (a fresh session that sees only the diff and the results, but the same model family).

Architect and reviewer are optional: with only an implementer you get the plain Project Lab flow.
Normal Analysis Mode (`era analyze`) never needs a coding agent.

## The workflow

```
user request
  → detect project, isolated working copy, baseline build/tests/acceptance      (ERA)
  → REA / static analysis                                                        (REA, ERA)
  → brief ──────────────► ARCHITECT  (read-only, snapshot of the baseline)
                           └─ design.md + proposed criteria ─► plan              (hand-off 1)
  → plan + design ──────► IMPLEMENTER (working copy; attempts bounded)
  → build, tests, acceptance, regression check                                   (ERA)
  → diff + ERA results ─► REVIEWER   (read-only, snapshot of the candidate)      (hand-off 2)
                           └─ findings validated by ERA against real files/lines/quotes
  → blocking findings ──► IMPLEMENTER corrects only those                        (hand-off 3)
  → ERA re-runs build, tests, acceptance, then review again (bounded)
  → final decision: tests pass AND no unresolved blocking finding                (ERA)
  → report + diff, then the user's approval applies it (reversible)              (user)
```

Properties:

* **Least context.** The architect gets the request, acceptance, detection, baseline summary,
  REA summary and file hints, but no diff. The implementer gets the plan and design. The reviewer
  gets the request, acceptance, design summary, ERA's verification results and the diff, and
  *not* the implementer's account of its work. No role receives ERA's state directory, other
  projects or credentials. (Verified by tests on the saved prompts.)
* **Explicit hand-offs.** Every artifact passed between roles is stored under
  `runs/<run>/handoffs/`, hashed (SHA-256) and listed in the run record, the ledger and the report.
* **No concurrent edits.** Agents never overlap: a second invocation while one runs is refused.
  Only the implementer writes to the working copy. Read-only roles work on private snapshots
  (`work/<run>.roles/…`) that are deleted afterwards.
* **Read-only is verified, not assumed.** Claude Code runs in `plan` mode and Codex in its
  `read-only` sandbox, and ERA additionally fingerprints the snapshot and the live working copy
  before and after: any change fails the run (`READ-ONLY VIOLATION`) and discards the output.
  Local command agents are also confined by ERA's macOS sandbox, which makes the directory read-only.
* **Reviews cannot be bluffed or forged.** A finding counts only if its file, line and quoted code
  exist. A finding whose quote is not found is kept but never blocks. A reviewer that returns no
  JSON array fails the run (it is never counted as "no problems").
* **Bounded corrections.** `team.review.rounds` (0 to 3, default 1) corrections, each re-verified by
  ERA. A correction that breaks the build or tests ends the run as rejected, with the reasons.
  `team.review.block_on` (`critical|high|medium|none`, default `high`) sets what blocks.
* **The user's approval is unchanged**: bound to the diff's SHA-256 and the original's digest.
  Agents have no access to the approval mechanism.

Manual implementer: you edit the working copy; the reviewer still reports findings, but no
automatic corrections happen. Rebuild and Review modes use the implementer (Rebuild) or reviewer
(Review) role; the architect/reviewer loop is a Modify feature.

## Capability detection

Each adapter declares capabilities, and `era agents` / `era project team <id>` show them with
live availability and sign-in status:

| Capability | Meaning |
|---|---|
| `read`, `write`, `execute` | can inspect files, edit files, run commands |
| `readOnlyMode` | `native` (the CLI enforces it), `verified` (ERA checks nothing changed), `none` |
| `automated` | runs without a human (`manual` does not) |
| `metered` | reports a dollar cost ERA can enforce |
| `remote` | sends project content to an external service |
| `readsInstructionFiles` | loads `AGENTS.md` / `CLAUDE.md`-style files from its directory |

A role requires capabilities (architect and reviewer: `read`, `automated` and a read-only mode; implementer:
`read`, `write`). A team that assigns an agent lacking them is rejected when the project is
created, with the reason. A language model that cannot edit files or run commands can therefore
only be given roles it can fill. Third-party adapters register with `registerCodingAgent(id,
{ create, capabilities })`; local command agents are declared in configuration (see
[provider-configuration.md](provider-configuration.md)).

## Security

| Concern | Control |
|---|---|
| Private source sent to remote AI | Providers marked `remote` (Claude Code, Codex, any adapter that says so) need **explicit consent per provider** (`--allow-remote claude-code,codex`, stored in `exposure.remote_consent`, recorded in the ledger). It is checked before a run exists, again when the working copy is made, and again before each agent call. No wildcard, never inferred |
| Credentials in the project | Credential-like files (`.env*`, `*.pem`, `*.key`, `id_*`, `.npmrc`, `.netrc`, `credentials*`, tfstate, …) are **withheld from the working copy** when a remote provider is involved, and listed in the report. Secret-looking *content* in other files (API keys, tokens, private-key blocks) **blocks** remote transmission unless `exposure.allow_secret_content` is set. Secret values are never recorded |
| Credentials in the environment | Provider CLIs receive an **allowlisted** environment (their own `CLAUDE*`/`ANTHROPIC_*`/`CODEX_*`/`OPENAI_*`, `PATH`, `HOME`, locale, proxies). Cloud keys, registry tokens and CI variables are not passed |
| Prompt injection from analyzed code | Every prompt states that project content is data. Files that agent CLIs load as instructions (`AGENTS.md`, `CLAUDE.md`, `.claude/`, `.codex/`, `.cursorrules`, …) are **withheld** from agent working copies (`exposure.keep_instruction_files` to override). Architect output is treated as advice (paths sanitized, criteria never executed); reviewer output is validated before it can matter; neither can change acceptance commands |
| Writes outside the workspace | Implementer: Claude `acceptEdits` / Codex `workspace-write` with `$TMPDIR` and `/tmp` writes disabled (a gap found by real testing, see provider validation), `command` agents inside ERA's sandbox. Read-only roles: native read-only modes + ERA's fingerprint check + snapshots |
| ERA state and approvals | Project commands and command agents cannot read ERA's state or other projects (sandbox deny-read). Provider CLIs are **not** sandboxed by ERA (they have their own models), so a malicious provider binary is out of scope |
| Cost and time | Per-run and per-project spend caps for metered agents, refusal of unmetered agents unless `projectLab.budget.allowUnmeteredAgents`, per-call timeouts with process-group kills, bounded attempts and correction rounds |
| Authentication | Checked before an agent is started (`claude auth status`, `codex login status`); a signed-out provider fails the run with the fix, and spends nothing |

Known limits: ERA cannot stop a remote provider from retaining what it receives (read its terms);
the secret scan is pattern-based; Claude Code's and Codex's own permission systems are trusted
for what they cover; Linux has no ERA sandbox (see [project-lab.md](project-lab.md#limitations)).

## State

Everything extends Project Lab's plain-JSON state, so a future ERA Studio can read it:

```
projects/<id>/project.json     + team {preset, roles, review}, exposure {remote_consent, …}
projects/<id>/ledger.jsonl     + remote-consent, exposure-recorded, handoff, role-violation;
                                 implementer-started/finished carry role, phase, cost, tokens
runs/<run>/run.json            + team, exposure, handoffs[], results.architecture, results.review-N, …
runs/<run>/handoffs/*          architect-brief.md, design.md, review-input-N.diff, review-N.json
```
