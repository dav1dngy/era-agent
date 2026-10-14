# ERA Studio baseline (Phase 3B)

`measure.mjs` measures real processes on the checkout given by `--root` (default: cwd). Nothing is simulated or estimated.
`results-baseline.json` was produced on commit `eb41634` (no Studio code changed) with `--n 10`:

    node experiments/studio-baseline/measure.mjs --n 10 --out experiments/studio-baseline/results-baseline.json

Conditions: Apple M1, 8 CPU, 8 GB, macOS 27.0.1, Node 24.20.0, Electron 44.7.1, **on battery power**, with Claude and
ChatGPT/Codex desktop apps running (load average 3.5-4 at start/end). Absolute numbers are therefore noisy; compare only
runs of the same harness on the same machine state. `rea doctor` exits 1 on this machine because no IDA provider is
registered (expected; its latency is still measured).

Not measured: agent-orchestration overhead (no real coding agent was run; Project Lab desktop tests use a simulated agent),
UI frame/input responsiveness (no profiler run). Test reliability is recorded in the Phase 3B document.
