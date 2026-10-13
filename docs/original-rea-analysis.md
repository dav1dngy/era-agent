# Original REA analysis

This document records what was verified about the original **Reverse Engineer
Anything** (REA) engine before ERA was built around it. Everything below was
observed on the development host on 2026-10-13. It is not copied from REA's
marketing claims.

## Identity

| Item | Observed value |
|---|---|
| Package | `rea-agents` **6.4.0**, installed globally under nvm (`…/lib/node_modules/rea-agents`) |
| Source repository | <https://github.com/morluto/rea> (`package.json` → `repository.url`) |
| CLI | `rea` → `scripts/rea.mjs` (127 commands; `rea --help`) |
| MCP server | `rea mcp` registered in the Claude Code config as server `rea`; 170 MCP tools, 6 prompts (`binary_session` → `server_identity.catalog`) |
| Agent skill | `reverse-engineer-anything` (skill version 37) in `~/.claude/skills` |
| Language / runtime | Node.js ESM. Requires Node `^22.19.0 \|\| ^24.11.0 \|\| >=26.0.0` |
| License | **MIT**, Copyright (c) 2026 morluto. Modification and redistribution are permitted if the notice is kept (see [NOTICE.md](../NOTICE.md)) |
| Unpacked size | 7.8 MB package; 93 MB installed with dependencies |

ERA does not vendor or modify REA source code. It depends on `rea-agents@6.4.0`
and executes REA's CLI, so REA's license obligations reduce to keeping the
copyright and permission notice. That is done in `NOTICE.md`.

## Host environment

| Tool | Version / status |
|---|---|
| macOS | 27.0.1 (26A434), arm64 |
| Node.js / npm | v24.20.0 (nvm) |
| Python | 3.14.8 (not required by ERA) |
| Git | 2.54.0 (Apple Git-157) |
| GitHub CLI | 2.100.0, authenticated as `dav1dngy` (keyring) |
| clang / otool / nm / lldb | Xcode command-line tools present |
| Java | `/usr/bin/java` stub present (no JDK verified) |
| Ghidra | **not installed** (`GHIDRA_INSTALL_DIR` unset) |
| Hopper Disassembler | **6.6.0-demo** at `/Applications/Hopper Disassembler.app` (REA's MCP session first reported `executable_missing`; the CLI `rea providers` and actual runs confirm it is available) |
| IDA Pro MCP | **not configured** (`REA_IDA_MCP_CONFIG` unset) |
| JADX, apktool, adb, Binwalk/Unblob, pwntools | not installed |

## Interfaces

1. **CLI**: `rea <command> [args] --format json`. JSON goes to stdout and NDJSON
   progress (`{"rea_progress":…}`) to stderr. Failures exit non-zero with a typed
   envelope `{"error","code","category","message","remediation","details"}`.
2. **MCP**: `rea mcp` (stdio). The same operations are available as MCP tools, with
   inline Evidence, retained-evidence paging (`inspect_analysis_view`) and
   evidence-bundle export.
3. **Agent skill**: routing instructions for agents (`reverse-engineer-anything`).

ERA integrates through interface 1. It is scriptable and records exact commands.
It reproduces the evidence the MCP tools return: `tests/rea-integration.test.js`
checks that `era rea inspect-macho` and direct `rea inspect-macho` produce the
same `evidence_id`.

## Capabilities verified on this host

`binary_session` reported per-tool availability. 59 tools were available without a
target, about 60 more require an open target (`open_binary`), and about 50 need a
missing provider (ADB, JEB, apktool, JADX, firmware tools, pwntools, EVM on Linux).
The following were **executed successfully** during the baseline
(`experiments/baseline/`):

| REA command | Target | Result |
|---|---|---|
| `inspect-macho` | authored arm64 Mach-O (`benchmarks/datasets/native-hello/hello`) | exports, imports, linked libraries, segments, load commands, UUID, build metadata |
| `analyze-javascript-application` | authored CommonJS app (`benchmarks/datasets/js-app`) | application graph (modules, require edges, exports, entrypoint) and semantic graph (bindings, call sites, literals, listener registrations, 44 residual unknowns) |
| `inspect-artifact` | authored ZIP (`benchmarks/datasets/archive/js-app.zip`) | content-addressed member inventory with verified hashes |
| `capture-process` | the authored Mach-O, run under a PTY | exit status, terminal frames, filesystem snapshot comparison, manifest timing |

| `function <binary> _greet` (Hopper) | pseudocode, assembly, basic blocks, callees, referenced strings/names. Hopper recovered the inlined djb2 checksum loop (`r8 = 0x1505; r8 = r8 + r8 * 0x20 + c`) from `-O1` code |

One run **failed**, and the failure is recorded: `rea function <binary> main` returned
`provider_unavailable`. The procedure is named `_main` in Mach-O and auto provider
selection had not yet bound Hopper. Re-running with the Mach-O symbol name
`_greet`/`_main` succeeded through Hopper (`experiments/baseline/hopper/`).

Not exercised: browser/CDP tools (no browser target was opened), Electron
runtime capture, .NET/managed analysis (no PE fixture), Android, firmware, EVM
and crash-core tools (missing providers or Linux-only).

## Supported target formats (per REA's README, filtered by this host)

| Target | REA support | On this host |
|---|---|---|
| Native Mach-O structure | `inspect-macho` (native macOS utilities) | ✅ verified |
| Native decompilation (Mach-O) | Hopper / Ghidra / IDA | ✅ verified with Hopper 6.6.0-demo (Ghidra/IDA not configured) |
| JavaScript / Electron / ASAR | built-in static analyzer | ✅ verified (directory) |
| Archives (ZIP/APK/IPA/MSIX/DMG) | built-in artifact graph | ✅ verified (ZIP) |
| Process behaviour | PTY capture (Linux/macOS) | ✅ verified |
| .NET assemblies | static, no provider needed | ⚠️ available, not exercised |
| Websites / Electron runtime | needs a Chrome-family browser/CDP | ⚠️ available, not exercised |
| Android, JEB, firmware, ELF layout, EVM, crash cores | external tools / Linux | ❌ not available |

## Configuration

* Provider selection: `GHIDRA_INSTALL_DIR`, `REA_IDA_MCP_CONFIG`, Hopper at
  `/Applications/Hopper Disassembler.app`, `REA_ADB_PATH`, `REA_APKTOOL_COMMAND`,
  `REA_JEB_MCP_URL`, `REA_BROWSER_EXECUTABLE`.
* Per-command options: for example `--max-heap-mb` and `--analysis-timeout-ms` for
  JavaScript analysis, and `--integrity-policy`.
* `rea setup` / `rea doctor` handle agent registration and readiness checks.
* Permissions: static analysis reads files only. Runtime capture runs the target
  with the current user's permissions and is **not a sandbox** (REA's own
  description of `capture_process_scenario`).

## Observed limitations that affect ERA

1. **Native decompilation depends on Hopper's demo build**: Hopper's public
   Python API does not expose complete function body ranges (REA reports
   `body.available: false`), and demo-mode restrictions apply. ERA decompiles
   exported functions only when `rea providers` reports a deep provider.
2. **JavaScript result budget**: when REA analyzed ERA itself (≈35 JS files plus
   test fixtures), it returned `resource_constraint` for some files ("Expanded
   application relationships … exceed the parent's result budget") and marked
   graph coverage `partial`. ERA's self-analysis rules treat this as incomplete
   coverage, not as absence (see [self-improvement.md](self-improvement.md)).
3. **CommonJS export names**: for `module.exports = { a, b }`, REA reports a single
   `default` export binding and no named members.
4. **Call-argument literals**: string literals passed directly as call arguments
   (for example `createClient('wss://…')`) were not retained in the semantic
   graph, so endpoints written that way are not recovered.

## Conclusion

REA is installed, licensed for modification and redistribution, and executes
real reverse-engineering operations on this host for Mach-O structure, native
decompilation (Hopper), JavaScript applications, archives and process behaviour. ERA is built on those
verified capabilities and passes everything else through unchanged (`era rea …`).
