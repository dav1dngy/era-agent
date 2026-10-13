# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's
[security advisory form](https://github.com/dav1dngy/era-agent/security/advisories/new).
Do not open a public issue. Vulnerabilities in the REA engine itself should go to
<https://github.com/morluto/rea>.

## Operational safety model

* **Authorized targets only.** ERA and REA are for lawful reverse engineering of
  software you are allowed to analyze.
* **Static analysis does not execute targets.** `era analyze` without `--runtime`
  only reads files (REA parses JavaScript as inert text).
* **Runtime capture executes the target** with your user permissions. It is
  **not a sandbox**. Use `--runtime` only on trusted binaries, or inside a VM.
* **Analyzed artifacts are untrusted data.** Strings or instructions found in
  analyzed files are never executed or followed.
* **Self-improvement is bounded:** hard caps on cycles (10), REA runs per cycle
  (50), timeouts and parallelism (1); one experiment at a time (lock file);
  experiments run in git worktrees and never touch `main` until accepted.
  Protected evaluator paths cannot be changed by an experiment. Self-improvement
  refuses to run when `CI` or `GITHUB_ACTIONS` is set.
* **No credentials.** ERA needs no API keys. The optional implementer command
  runs with your environment, so configure it deliberately.
* ERA does not modify or retrain any foundation model's weights; "self-improvement"
  refers only to changes to ERA's own source code.
