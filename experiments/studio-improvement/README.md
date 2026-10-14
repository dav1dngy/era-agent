# Studio improvement evidence (Phase 3B), and how to reconstruct it

## What is here

| Path | Content |
|---|---|
| `E1-rea-status-cache/`, `E2-job-shutdown/` | Lab report, `change.patch` and `cycle.json` of each **accepted** cycle; E1 also holds its rejected first attempt. `E2-job-shutdown/attempts.md` lists its two inconclusive attempts. |
| `E3-electron-startup-rejected.*` | A manual (non-Lab) experiment that showed no effect and was reverted. |
| `lab-clone.bundle` | Thin Git bundle of the throwaway Lab clone: its `main` (base commit `0c98e0b`) and the three experiment branches. Prerequisite: commit `68f0f20` of this repository. |
| `lab-export/` | Output of `scripts/export-experiments.mjs` for the clone: cycle records and reports, self-analysis reports, REA run records and the SHA-256 of every raw REA output (the raw outputs, about 2.7 GB, were not committed), and `ledger.jsonl`. |

## Approval status (what was NOT done)

Cycles 2 (E1) and 3 (E2) are `awaiting-approval` in the clone's ledger: `era improve approve` was never run, no `era-vN` tag exists for
them, and nothing was merged. Their `change.patch` files were applied to `feature/era-v0.2.0` by hand (commits `74b1f93`, `43d3536`);
the patch hashes match the evaluated candidates (verified below). Cycle 1 (first E1 attempt) is `rejected` because of an environment
difference between baseline and candidate, not the code (see `E1-rea-status-cache/first-attempt-rejected-report.md`).

## Reconstruct and verify (any machine with this repository)

```bash
git clone . /tmp/verify && cd /tmp/verify
git fetch /path/to/lab-clone.bundle 'refs/heads/*:refs/lab/*'
base=$(git rev-parse refs/lab/main)
git diff $base...refs/lab/experiment/cycle-20261014T124035-5b4783 | shasum -a 256   # E1
git diff $base...refs/lab/experiment/cycle-20261014T125204-f7ba8a | shasum -a 256   # E2
```

Expected: the `patch_sha256` values in `E1-rea-status-cache/cycle.json` and `E2-job-shutdown/cycle.json`
(E1 `9d52abc4…866fc1`, E2 `c0ba1750…c964`). This was run on 2026-10-14 and matched. `git bundle verify lab-clone.bundle` checks the bundle itself.
Raw REA outputs are referenced by hash in `lab-export/*/rea-runs`; they are private to the machine that ran the evaluation.

## Revision each measurement was taken at

The measurement JSON files do not embed a revision, so it is recorded here (`measure.mjs --n 10`, same machine):

| File | Code state |
|---|---|
| `../studio-baseline/results-baseline.json` | `eb41634` (no Studio code changed); machine on battery |
| `../studio-baseline/results-ab-baseline-commit-AC.json` | `68f0f20` in a separate worktree; AC power |
| `../studio-baseline/results-after-E1.json` | `68f0f20` plus the E1 patch (uncommitted at the time, committed as `74b1f93`) |
| `../studio-baseline/results-before-E3.json` | `43d3536` (E1 and E2 applied) |
| `../studio-baseline/results-after-E3.json` | `43d3536` plus the E3 patch (kept as `E3-electron-startup-rejected.patch`, reverted) |
