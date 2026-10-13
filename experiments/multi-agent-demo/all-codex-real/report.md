# Project modification: catalog-real

- Run: `run-20261013T222103-42fcf7` (modify) — status **awaiting-approval**
- Source: `<scratch>/real-demo2/catalog-app`
- Task: Add a search(query) function to src/catalog.js that finds products by name or tag, case-insensitively, and returns the matching products in catalog order. Add unit tests for it under tests/.
- Coding agent: codex; cost reported: none (unmetered or no agent)

## Baseline

- test: `node --test tests/*.test.js` → exit 0
- acceptance: `node --test acceptance/search.test.js` → exit 1 _(acceptance)_

## Analysis

- REA analyzed 3 modules in 1 pass(es); evidence IDs `ev_13800405e462fe44a…`.
- 0 static finding(s) of severity low or above (see `era project review` for the full list).

## Plan

See `plan.md` (2 relevant file hint(s)).

## Team

| Role | Agent |
|---|---|
| architect | codex |
| implementer | codex |
| reviewer | codex |

Review independence: same provider as the implementer (fresh session, sees only the diff and results).

### Data exposure

- Source code was made available to remote provider(s): codex (authorized by the user: codex).
- Withheld from agents: nothing needed withholding.

### Architecture

By `codex`: Add and export search(query) with case-insensitive name and tag matching, preserving catalog order. Existing unit tests pass; all three acceptance tests currently fail because search is missing.

2 file(s) planned; full design in `handoffs/design.md`.

### Independent review

Reviewer `codex`; blocking threshold: high; correction rounds used: 0.

- Round 1: 0 finding(s) accepted, 0 rejected as unverifiable, 0 blocking.

No unresolved blocking findings.

### Hand-offs

| From | To | Artifact | sha256 |
|---|---|---|---|
| era | architect | `handoffs/architect-brief.md` | `67d6c5760956…` |
| architect | implementer | `handoffs/design.md` | `858e3ce96859…` |
| implementer | reviewer | `handoffs/review-input-1.diff` | `6f814676b434…` |
| reviewer | implementer | `handoffs/review-1.json` | `6e956e274cea…` |

## Attempts

- Attempt 1 (codex): **passed verification**

## Decision

**Accepted for review**: every acceptance check passed and no regression was detected. Nothing has been applied to the original project.

## Verification after the change

- test: `node --test tests/*.test.js` → exit 0
- acceptance: `node --test acceptance/search.test.js` → exit 0 _(acceptance)_

- Tests: 2 passed / 0 failed at baseline → 8 passed / 0 failed now.

## Change

- Files changed: 2 (M src/catalog.js, A tests/search.test.js)
```
src/catalog.js       | 12 ++++++++++--
 tests/search.test.js | 36 ++++++++++++++++++++++++++++++++++++
 2 files changed, 46 insertions(+), 2 deletions(-)
```
- Reviewable diff: `<scratch>/real-demo2/state/projects/catalog-real/runs/run-20261013T222103-42fcf7/change.patch` (sha256 `6f814676b4341ae7…`)

Approve with `era project approve catalog-real` to apply the diff to the original project (reversible with `era project rollback catalog-real`).