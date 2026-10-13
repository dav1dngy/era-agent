# Testing Project Lab

```bash
node --test tests/project-lab-unit.test.js tests/project-lab.test.js   # Project Lab only
npm test                                                               # everything
ERA_SKIP_E2E=1 npm test                                                # skip heavy workflow tests
```

## What is real and what is mocked

| Element | Status in tests |
|---|---|
| The target projects' own tests, builds and acceptance commands (`node --test`) | **Real**, executed inside the macOS sandbox (on Linux: trusted mode) |
| git, patch application, rollback, locking, signals (SIGKILL, SIGTERM), processes, the CLI | **Real** |
| REA | **Real** where marked: Review test (JavaScript application graph, genuine evidence IDs) and the Rebuild test (Mach-O structure of the reference). Skipped parts when REA is unavailable |
| The reference program in the Rebuild test | **Real**: the authored `hello` Mach-O (arm64, macOS only) executed in the sandbox |
| The reverse-engineering engine in most other tests | **Fake**: `tests/fixtures/fake-rea-engine.mjs` (regex import scanner). Not counted as REA executions |
| Coding agents | **Mock**: `tests/fixtures/agents/*.mjs` are scripts, not AI. They prove ERA's workflow, verification and safety logic, **not** the quality of any model. No model was called. One test injects a fake *metered* agent to exercise budgets |

## The six scenarios

| # | Scenario | Test(s) in `tests/project-lab.test.js` | Checks |
|---|---|---|---|
| 1 | Analyze and repair an application with a reproducible bug | `Test 1 (modify)` | acceptance fails at baseline, passes after; no regression; original untouched until approval; approval applies the diff, the project's own tests pass on the **original**; rollback restores it byte for byte |
| 2 | Implement a missing function in an external project | `Test 2 (modify)` | new `search` function and test added; rollback removes the added file |
| 3 | Reconstruct selected functionality from an authorized reference | `Test 3 (rebuild)` + 3 rebuild tests | expected output captured by really running the reference in the sandbox; REA evidence; spec excludes decompiled code; behavioral comparison; destination written only on approval; mismatching implementation rejected; copying the reference rejected; missing authorization/acceptance refused |
| 4 | Failed execution and rollback | `Test 4a`–`4g` | regression rejected after bounded retries; deleted tests detected; no-op, crashing and protected-file agents rejected; retry gets failure feedback; non-discriminating acceptance stops before any agent runs; approval refused if the original or the verified copy changed; rollback refuses after later edits |
| 5 | External project isolation | `Test 5a`–`5c` | a hostile agent cannot write to the original or elsewhere (sandbox), or is detected; ERA's own `src/` and `bin/` digests unchanged; project commands cannot read other projects' state and run without ERA's credentials; per-project state is independent |
| 6 | Existing ERA functionality | `Test 6`, plus the **whole existing suite** (Improvement Lab end-to-end tests, REA integration, MCP, sandbox, CLI contract) | unchanged commands and help; all pre-existing tests still pass |

Also covered: manual mode (pause, edit, resume), interruption by `SIGKILL` and
resume without repeating finished steps, cancellation of a running operation,
concurrent operation refusal, spending caps, refusal in CI, the CLI contract
(create → list → status → show → review → modify → approve with confirmation →
rollback → delete), and unit tests for validation, workspace isolation, parsers,
evidence validation and the decision logic.

## Bugs these tests found

* A nested `node --test` inherits `NODE_TEST_CONTEXT` and silently exits 0 without
  running tests: it made acceptance commands look passing. Project commands and
  agents now run without it. (The test suite's own helper had the same trap, so
  earlier "exit 0" assertions were vacuous until fixed.)
* Deleting a project's tests made the output list no tests, and the regression check
  was "not comparable", so the change was accepted. Now a change is rejected when the
  baseline listed passing tests and the new output lists none.
* Relative symlinks inside a project were skipped on macOS (`/var` vs `/private/var`).
* A trailing `**` glob did not match nested paths.
* Runs created in the same second could be ordered randomly; runs now carry a sequence number.

## Trying a real coding agent (not run for this release)

```bash
era project create demo --source ~/code/my-app --mode review --agent claude-code --max-cost 2
era project review demo           # read-only: Claude Code `plan` mode, Codex `read-only` sandbox
```

This spends money on your Claude Code account; the budget caps apply. Nothing in
this repository's automated tests does so.
