# ERA development instructions

ERA reverse-engineers software through the REA engine (`rea-agents`, run as a subprocess; never modify or vendor it) and
improves itself through a controlled, human-approved cycle. Start with `docs/ERA_V020_HANDOFF.md` for current state.

## Commands

```bash
npm test             # node --test tests/*.test.js (about 3 min; run before and after changes)
npm run lint         # ESLint
npm run check        # syntax check + secret scan of tracked files
node bin/era.mjs status | agents      # environment and provider state
node bin/era.mjs studio serve --open  # Studio in a browser
cd apps/studio && npm run test:desktop  # Electron scenario tests
```

## Rules

- Branch `feature/era-v0.2.0`: commit checkpoints here. **Never merge into `main`, push, tag, publish or create a release
  unless the user explicitly asks, each time.**
- Do not fabricate: facts come from recorded REA runs; report only measured results. Always separate real provider/engine runs
  from mocked or simulated ones, and never describe mocked execution as real.
- Protected paths (`src/safety/`, `src/evaluation/`, `src/self_analysis/rules.js`, `benchmarks/datasets/`,
  `benchmarks/acceptance.json`) are never changed by an automated improvement cycle.
- ERA never stores or reads provider credentials. Remote providers need explicit per-project consent; do not enable
  unmetered agents silently. Claude Code is not signed in on this machine; Codex works (see handoff).
- Studio is a thin client of `src/control_plane`; put logic in the backend, not in `apps/studio/web`.
- Another session may edit this repo concurrently: check `git status` before committing and stage only your own files.
- Only analyze software you are authorized to analyze. See CONTRIBUTING.md for further ground rules.
