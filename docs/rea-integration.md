# REA integration

ERA executes the original REA CLI (`rea-agents`, <https://github.com/morluto/rea>)
as a subprocess. It does not vendor, patch or re-implement REA.

## Engine resolution

`src/rea_integration/rea-client.js` resolves the `rea` executable in this order:

1. `rea.command` in `era.config.json`
2. `ERA_REA_BIN`
3. `node_modules/.bin/rea` (the `rea-agents@6.4.0` dependency)
4. `rea` on `PATH`

`era status` shows which one is in use, along with REA's provider availability
(`rea providers`).

## What ERA runs

| ERA workflow | REA command(s) | Verified |
|---|---|---|
| JavaScript app directory / ASAR | `analyze-javascript-application <path>` | ✅ directories (ASAR not exercised) |
| Single JavaScript file | copied into `<analysis>/staged/`, then `analyze-javascript-application` on that directory (REA accepts only directories or `.asar`) | ✅ |
| Archive (ZIP, APK, IPA, JAR, MSIX, DMG) | `inspect-artifact <path>` | ✅ ZIP |
| Mach-O structure | `inspect-macho <path>` | ✅ |
| Mach-O decompilation (when a provider is available) | `function <path> <symbol> --snapshot <analysis>/provider.snapshot` per exported function | ✅ Hopper 6.6.0-demo |
| Mach-O runtime (`--runtime`) | `capture-process <scenario.json>` | ✅ |
| Self-analysis | `analyze-javascript-application` × N passes, `capture-process` of `era --help` | ✅ |
| Anything else | `era rea <any REA command>` (passthrough, inherited stdio) | ✅ |

Every call is made with `--format json`. NDJSON progress lines on stderr are
counted, and other stderr lines are kept as warnings. A non-zero exit, a REA error
envelope (`{"error","code",...}`), invalid JSON or a timeout mark the run as failed
or timed out, and analysis status becomes `partial` or `failed`.

## Run records

Each REA execution writes `.era/runs/<run_id>/record.json`:

```json
{
  "run_id": "rea-20261013T095112-ab12cd",
  "label": "decompile:_greet",
  "command": ["rea", "function", "/abs/hello", "_greet", "--snapshot", "…", "--format", "json"],
  "engine": { "package": "rea-agents", "version": "6.4.0" },
  "input": { "path": "/abs/hello", "kind": "file", "bytes": 33512, "sha256": "fd1fc2f0…" },
  "status": "succeeded",
  "exit_code": 0,
  "evidence_id": "ev_484fe263…",
  "operation": "analyze_function",
  "provider": { "id": "hopper", "name": "Hopper Disassembler", "version": "launcher-sha256:…" },
  "output_file": ".era/runs/<run_id>/output.json",
  "warnings": [],
  "errors": [],
  "resources": { "real_s": 5.3, "user_s": 0.6, "sys_s": 0.9, "max_rss_bytes": 401637376 }
}
```

`output.json` is REA's unmodified Evidence.

## Backward compatibility

`era rea …` forwards arguments unchanged to the resolved REA binary. That includes
`era rea mcp` / `era rea --mcp` (MCP server), `era rea doctor`, `era rea setup`,
and all 127 REA CLI commands. `tests/rea-integration.test.js` checks that
`era rea --version` matches `rea --version`, and that `era rea inspect-macho` and
`rea inspect-macho` produce the same Evidence ID.

## Facts derived from REA Evidence

`src/analysis/facts.js` turns Evidence into normalized `category:value` facts:

| Operation | Facts |
|---|---|
| `analyze_javascript_application` | `module:`, `entry:`, `import:a->b`, `external:`, `unresolved:`, `export:module#name`, `endpoint:` (URL string literals) |
| `inspect_macho` | `export:`, `import:`, `dependency:`, `arch:` |
| `analyze_function` | `function:`, `call:fn->callee`, `string:` |
| `inspect_artifact` | `member:` |
| `capture_process_scenario` | `exit:` |

Inferred facts are marked as such in the code. CommonJS export member names
(added in era-v3) are inferred from REA's semantic graph: program-scope binding
reads that directly follow a `module.exports` write.
