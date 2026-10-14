# Getting started

ERA reverse-engineers software through the REA engine and lets a coding agent change or rebuild a project inside an **isolated copy**. Your
original files change only after you approve a verified diff, and an approved change can be rolled back. ERA Studio is the desktop and browser
workbench for all of it; the same functions are available from the `era` command line.

## 1. Install

Pick the route that fits ([installation](installation.md) has the details): the stable CLI (`main`, no Studio), the development line with ERA Studio
(`feature/era-v0.2.0`), or a locally built, **unsigned** macOS app. No signed or notarized download exists yet.

```bash
git clone --branch feature/era-v0.2.0 https://github.com/dav1dngy/era-agent.git && cd era-agent
npm ci && npm ci --prefix apps/studio
node bin/era.mjs studio doctor        # what Studio needs on this machine
node bin/era.mjs studio app           # desktop shell; `studio serve --open` for the browser
```

Requirements: Node.js 22.19+ (or 24.11+), Git, and Python 3 for the terminal. REA is a dependency. Native decompilers (Ghidra, Hopper, IDA) and
coding agents (Codex, Claude Code) are separate installations; ERA needs no API keys and never stores provider credentials.

## 2. Your first project

1. **Projects → New project** (or describe the task on the New Task page). Choose a mode: **Review** (read-only analysis), **Modify** (change your
   code) or **Rebuild** (reconstruct behavior of an authorized reference).
2. Add the checks that decide success: test commands and acceptance checks. A change is accepted only when they pass and nothing that passed before fails.
3. Pick who does the work. With no agent configured, ERA pauses and you edit the isolated copy yourself (`manual`).
4. Start the run. ERA copies the project, runs the baseline, analyses it with REA, lets the agent work, verifies, and stops at *awaiting approval*.
5. **Changes & approval** shows the exact diff, the test outcomes and the risks. Approve to apply it, or reject; roll back later if needed
   ([approval and rollback](project-lab.md#approval-and-rollback)).

## 3. Cost, consent and privacy

* Remote coding agents (Codex, Claude Code) receive project content only with **your consent per project and provider**; credential-like files and
  agent instruction files are withheld, and this is re-checked before every agent run ([spending and consent](provider-configuration.md#spending-and-consent)).
* Codex reports tokens, not dollars, so ERA cannot enforce a dollar cap on it and refuses to run it until you enable *Settings → Execution → Allow
  agents without a dollar cap*. That setting is off by default.
* A provider's command-line tool can read any file your account can read; authorizing a provider authorizes that exposure
  ([security](ERA_STUDIO_SECURITY.md)).

## 4. Where to go next

| I want to… | Read |
|---|---|
| analyze a binary, app or archive | [reverse engineering](rea-integration.md) |
| change or rebuild a project safely | [Project Lab](project-lab.md), [configuration](project-configuration.md) |
| use more than one agent | [multi-agent engineering](multi-agent.md), [providers](provider-configuration.md) |
| let ERA improve itself under review | [Improvement Lab](improvement-lab.md) |
| understand the security limits | [security and permissions](ERA_STUDIO_SECURITY.md) |
| fix a problem | [troubleshooting](troubleshooting.md) |
| see what is verified | [support and validation](SUPPORT_AND_VALIDATION.md) |
