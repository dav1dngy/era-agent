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
| Sensitive operations | Integration into `main` requires `era improve approve` (TTY confirmation or `--yes`), is refused in CI, and requires main to be at the evaluated base. No force-push. No automatic publishing or deployment |
| Supply chain | Single runtime dependency (`rea-agents`, pinned) plus lockfile. `npm audit` and `npm audit signatures` in CI. SHA-pinned GitHub Actions with read-only default permissions. CodeQL. CycloneDX SBOM and build provenance in the release-validation workflow |

## Known limitations

* `sandbox-exec` is deprecated by Apple (still functional on macOS 27). The profile
  allows reads anywhere the user can read.
* Coding agents run with your user permissions inside the worktree, restricted
  only by their own mechanisms (Claude Code `acceptEdits`, Codex
  `workspace-write`). Review every change proposal before approving it.
* Hopper is a GUI application launched by REA outside ERA's process groups.
