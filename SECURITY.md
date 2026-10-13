# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's
[security advisory form](https://github.com/dav1dngy/era-agent/security/advisories/new).
Do not open a public issue. Vulnerabilities in the REA engine itself belong to
<https://github.com/morluto/rea>.

## Security model

ERA's practices are informed by the NIST Secure Software Development Framework,
OWASP guidance for agentic AI applications, least privilege and defense in depth.
**ERA has not been independently assessed or certified.**

| Area | Control |
|---|---|
| Authorization | Only analyze software you are authorized to analyze. All fixtures in this repository are authored for it |
| Untrusted artifacts | Static analysis only reads files (REA parses JavaScript as inert text). Analyzed content and REA output are data: prompts to models fence them as untrusted and say so explicitly, and ERA never executes instructions found in them |
| Executing targets | `--runtime` runs the target under a macOS `sandbox-exec` (Seatbelt) profile: all network denied, writes only to a per-analysis scratch directory. Without a sandbox (Linux) ERA refuses unless `--unsandboxed`. REA's own process capture is not a sandbox; git worktrees are not sandboxes |
| Command execution | Fixed argument vectors (no shell) for REA, git, tests and agents. The only shell commands are ones you configure yourself (`improvement.implementerCommand`, `reasoning.command.run`) |
| Filesystem | Writes stay in `.era/`, experiment worktrees and analysis scratch directories. Experiments cannot change protected evaluator paths |
| Network | ERA itself makes no network calls. REA's static analysis is offline. Remote reasoning providers need `reasoning.allowRemote: true` **and** `--allow-remote` per call. Coding agents use their own network access (they are cloud agents) |
| Secrets | ERA needs no credentials. Logs, and text sent to reasoning providers, are redacted (token, key and private-key patterns; sensitive keys). `node scripts/check.mjs` scans tracked files |
| Resource consumption | Timeouts on every subprocess. Process-group kill. A watchdog that ends any subprocess that outlives its deadline or its parent. Hard caps: 10 cycles, 50 REA self-analysis runs per cycle, $50 per cycle and $200 total agent spend, one experiment at a time |
| Improvement Lab candidates | Treated as untrusted. The stable supervisor runs REA and owns the evidence. Candidate tests, extraction, planning and CLI run in a sandbox (no network, no writes outside its checkout/temp, no reads of ERA state, ground truth or credential stores, scrubbed environment). Protected-path changes are rejected before execution. Approval merges only the evaluated commit. No sandbox → refused unless `--trust-candidate` |
| Project Lab (external projects) | The original project is never modified except by `era project approve`/`rollback`; a content digest is verified at the end of every run. Work happens in isolated copies. Build, test, acceptance commands, rebuilt behaviors and the reference executable run in the macOS sandbox (no network, writes confined, no reads of ERA state or other projects, scrubbed environment); without a sandbox they need `--trust-project`. Approval is bound to the verified diff. ERA's own installation is refused as a project, and git commands never leave the working copy. Coding agents `claude-code`/`codex` are **not** sandboxed by ERA (they use their own permission models; read-only modes for read-only roles, plus ERA's before/after check); `command` agents are confined to the working copy. **Multi-agent:** source code goes to a remote provider only with per-provider consent recorded in the ledger; credential-like files and agent instruction files are withheld from agent copies; secret-looking source content blocks remote transmission; provider CLIs get an allowlisted environment; read-only roles run on private snapshots; agents never run concurrently. Codex's own `workspace-write` sandbox was found to allow `$TMPDIR` and `/tmp` writes and is configured to exclude them. Claude Code's isolation is **not** validated against the real CLI |
| Sensitive operations | Integration into `main` requires `era improve approve` (TTY confirmation or `--yes`), is refused in CI, and requires main to be at the evaluated base. No force-push. No automatic publishing or deployment |
| Supply chain | Single runtime dependency (`rea-agents`, pinned) plus lockfile. `npm audit` and `npm audit signatures` in CI. SHA-pinned GitHub Actions with read-only default permissions. CodeQL. CycloneDX SBOM and build provenance in the release-validation workflow |

## Known limitations

* `sandbox-exec` is deprecated by Apple (still functional on macOS 27). The runtime
  profile allows reads anywhere the user can read: it is not a confidentiality
  sandbox. REA itself runs unsandboxed as trusted code.
* `era rea …` passthrough has none of ERA's protections (sandbox, watchdog,
  records, redaction).
* Process groups do not contain deliberately detached descendants or GUI
  providers launched by REA (Hopper).
* An independent audit (docs/ERA_INDEPENDENT_AUDIT.md) found 5 high and 9 medium
  issues. Their remediation (docs/audit-remediation.md) has not yet been
  re-reviewed independently.
* Coding agents run with your user permissions inside the worktree, restricted
  only by their own mechanisms (Claude Code `acceptEdits`, Codex
  `workspace-write`). Review every change proposal before approving it.
* Hopper is a GUI application launched by REA outside ERA's process groups.
