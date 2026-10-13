# Examples

All targets are authored fixtures in `benchmarks/datasets/`.

```bash
# JavaScript application (CommonJS): modules, require graph, exports, endpoints
era analyze benchmarks/datasets/js-app

# ES modules application
era analyze benchmarks/datasets/esm-app --json | jq '.facts'

# Native Mach-O: structure + (with Hopper/Ghidra/IDA) decompiled exported functions
era analyze benchmarks/datasets/native-hello/hello

# Native Mach-O plus runtime capture (executes the target under REA's PTY capture)
era analyze benchmarks/datasets/native-hello/hello --runtime --arg demo

# Archive inventory
era analyze benchmarks/datasets/archive/js-app.zip

# Classify a target without analyzing it
era inspect benchmarks/datasets/native-hello/hello

# Any original REA command
era rea inspect-macho "$PWD/benchmarks/datasets/native-hello/hello" --format json
```

`sample-analysis-report.md` is the unedited report ERA wrote for the native fixture.
