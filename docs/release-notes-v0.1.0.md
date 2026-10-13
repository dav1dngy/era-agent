# ERA v0.1.0 — release notes

**Reverse. Analyze. Evolve. Repeat.**

First public release of ERA (Evolve & Reverse Engineer Anything), an
independent open-source project built on the original
[Reverse Engineer Anything (REA)](https://github.com/morluto/rea) engine
(`rea-agents` 6.4.0, MIT). Experimental; verified on macOS 27 arm64 with Node 24.

## Highlights

* **Analysis Mode:** `era analyze` for JavaScript applications and single files,
  Mach-O binaries (structure plus Hopper decompilation of exported functions),
  ZIP archives, and sandboxed runtime capture. Every REA execution is
  recorded, REA Evidence is normalized into facts, and Markdown/JSON reports
  are written. `era explain` gives local explanations, with an opt-in model.
* **Full REA access:** `era rea …` forwards every REA command, including the MCP
  server (`era rea mcp`) and agent setup (`era rea setup`).
* **ERA Improvement Lab:** REA analyzes ERA itself. Findings become
  hypotheses, experiments run in git worktrees, and candidates are evaluated by
  a stable supervisor that owns all REA evidence, sandboxes candidate code, uses
  ground-truth benchmarks and baseline test inventories, and integrates only the
  exact evaluated commit after maintainer approval. Also: rebase, cancel,
  recover and rollback. Coding-agent adapters for Claude Code and Codex, with
  budgets.
* **Measurement:** hand-written ground truth, version comparison, ERA overhead
  versus direct REA, benchmark provenance.

## Evidence

* 5 improvement experiments (2 rejected, 3 integrated; the last one approved by
  the maintainer), with REA run records and digests in `experiments/`.
* Benchmark accuracy F1 0.956 (era-v1) → 0.987 (era-v4); error rate 0.
* Tests: 133 (132 pass, 1 platform skip) with real REA, MCP and sandbox tests.
* An independent technical audit (docs/ERA_INDEPENDENT_AUDIT.md) and its
  remediation (docs/audit-remediation.md).

## Known limitations

See README "Limitations" and docs/audit-remediation.md. In short: macOS-focused
(no Linux sandbox, so Lab evaluation fails closed there); headless agents
tested only against fakes; Lab benchmark facts come from candidate extraction
code (no ground-truth access); raw evidence is not published; the sandbox does
not restrict reads; small authored benchmark fixtures; no type checking.

## Requirements

Node.js `^22.19 || ^24.11 || >=26`, git. Optional: Hopper, Ghidra 12.1.x or IDA
for native decompilation.

```bash
git clone https://github.com/dav1dngy/era-agent.git && cd era-agent
npm install && npm test && npm link && era status
```
