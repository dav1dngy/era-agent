# Baseline: original REA execution

Executed on 2026-10-13 on macOS 27.0.1 arm64 with Node v24.20.0 and
`rea-agents` 6.4.0 (`rea-version.txt`). Every file here is REA output, unedited except that local absolute paths were replaced with placeholders (`<era-repo>`, `<tmp>`, `~`) before publication; Evidence IDs and digests refer to the original bytes.

| Command | Input | Status | Wall time | Output |
|---|---|---|---|---|
| `rea inspect-macho <abs>/benchmarks/datasets/native-hello/hello --format json` | authored Mach-O, sha256 `fd1fc2f0…9492` | exit 0 | 13.9 s (first run, cold) | `inspect-macho.json` (Evidence `ev_853ce044…`) |
| `rea analyze-javascript-application <abs>/benchmarks/datasets/js-app --format json` | authored CommonJS app (directory) | exit 0 | 3.8 s | `analyze-js.json` (Evidence `ev_4d2ca9b2…`), progress in `analyze-js.stderr` |
| `rea capture-process process-scenario.json --format json` | the Mach-O, run with argument `baseline` | exit 0, target exit 0 | 4.0 s | `capture-process.json` |
| `rea inspect-artifact <abs>/benchmarks/datasets/archive/js-app.zip --format json` | authored ZIP | exit 0 | 1.0 s | `inspect-artifact.json` (Evidence `ev_2fd799f2…`) |
| `rea function <abs>/…/hello main --format json` | the Mach-O | **exit 1** `provider_unavailable` | — | `function-main.json` (error envelope) |
| `rea function <abs>/…/hello _greet --format json` | the Mach-O | exit 0 (Hopper 6.6.0-demo) | 16.4 s (cold Hopper launch) | `hopper/function-greet.json` (Evidence `ev_484fe263…`): pseudocode reconstructing the inlined djb2 checksum |

`*.time` files hold the shell `time` output and `*.stderr` the REA progress
stream. The ZIP was later moved from `benchmarks/datasets/js-app.zip` to
`benchmarks/datasets/archive/js-app.zip` (byte-identical).

Reproduce with:

```bash
rea inspect-macho "$PWD/benchmarks/datasets/native-hello/hello" --format json
rea analyze-javascript-application "$PWD/benchmarks/datasets/js-app" --format json
```
