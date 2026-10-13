# Testing multi-agent engineering

```bash
node --test tests/multi-agent.test.js                 # mocked-agent orchestration tests (fast, no model calls)
node scripts/validate-providers.mjs [claude-code|codex]   # REAL provider CLIs; spends your provider quota
npm test                                               # everything
```

## What is real and what is mocked

| Element | Status |
|---|---|
| ERA's orchestration code: roles, hand-offs, snapshots, read-only verification, review validation, corrections, re-verification, consent, exposure filters, capability checks, ledger, report | **Real** in every test |
| The project's own tests, builds, acceptance commands, git, patches, approval, rollback, cancellation, the CLI | **Real** |
| The coding agents in `tests/multi-agent.test.js` | **Mock.** `tests/fixtures/agents/team-agent.mjs` is a script that plays a role. It is not AI. These tests prove ERA's logic, **not** that Claude Code or Codex behave well |
| The reverse-engineering engine in these tests | **Fake** (`tests/fixtures/fake-rea-engine.mjs`) |
| Claude Code and Codex | **Real only in** `scripts/validate-providers.mjs` and the real demo run; results and their gaps in [provider-validation.md](provider-validation.md). A provider that is not signed in is reported as unavailable, never replaced by a mock |

## What the mocked tests prove

| Requirement | Test |
|---|---|
| Full pipeline: architect → implementer → review → correction → re-verification → approval → rollback | `team workflow: …` |
| Each role gets only the context it needs; project content is labeled untrusted | `each role receives only the context its job needs` |
| Bounded corrections; unresolved blocking findings reject | `a reviewer that keeps reporting…`, `block_on "none"…` |
| Review findings cannot be fabricated or bluff a block | `findings with invented files or quotes…`, `…no findings array fails closed` |
| A correction that breaks tests is rejected | `a correction that breaks the tests…` |
| Read-only roles cannot modify anything (sandbox, and ERA's own detection) | `a read-only reviewer/architect that writes…`, `in the sandbox…`, `…review mode…` |
| No concurrent agents | `two agents never run at the same time` |
| Consent before remote transmission; recorded; checked before any run exists | `remote providers need explicit consent…` |
| Credential files and instruction files withheld; secret content blocks | `credential files and agent instruction files are withheld…` |
| Provider environment allowlist | `provider CLIs get an allowlisted environment…` |
| Signed-out agent refused before start | `an agent that is not signed in is refused…` |
| Presets, explicit roles, capability checks, third-party registration | `presets, explicit roles…`, `third-party adapters…` |
| Cancellation removes role copies, leaves the original untouched | `cancelling while the architect runs…` |
| CLI surface and listing; Analysis Mode without agents | `CLI: team flags…`, `Analysis Mode needs no coding agent` |

## What only real providers can show

`scripts/validate-providers.mjs` runs, per provider that is installed and signed in: a real file
modification in a throwaway git repo; a request to write *outside* the working copy (isolation);
read-only mode; a real review in ERA's JSON format validated against the code; a timeout that
must kill the provider and leave no process behind; cost/token reporting; a deliberately bad model
(error recovery); and cancellation through `era project cancel`. For a provider that is installed
but signed out it records the adapter's real failure behavior and marks everything else skipped.
Evidence is written to `experiments/provider-validation/<provider>.json`.
