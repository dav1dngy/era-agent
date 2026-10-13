# Hybrid run: scripted implementer, REAL Codex reviewer

**Mocked**: the implementer (`tests/fixtures/agents/team-agent.mjs implementer-flawed`) deliberately adds an `eval`-based
`applyDiscount` function next to a correct fix, so the reviewer has something to find. It is a script, not AI.
**Real**: the reviewer (OpenAI Codex CLI 0.160.1, read-only) found the problem on its own; ERA validated the finding
against the real file/line/quote, treated it as blocking, asked the implementer role for a correction, re-ran the tests,
and the second review was clean. Shows that a real model's review output passes ERA's validation and drives the loop.
The change was NOT approved or applied.

