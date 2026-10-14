# ERA Studio captures (v0.2.0 development build)

Genuine, unedited screenshots of the Electron application from the desktop scenario run of 2026-10-14 (macOS 27.0.1 arm64, Electron 44.7.1,
app code of commit `ece7dbc`). **Real:** the Electron app, the control plane and REA 6.4.0, on a controlled fixture project. **Simulated:** the
coding agent (a scripted stand-in; no model was called), which is why providers are labeled Unavailable or Simulated. `manifest.json` lists
each file with its SHA-256, alt text and, for image 4, the crop that removes a temporary path.

| File | Shows |
|---|---|
| `01-first-launch-dark.png` | first launch: New Task, status, agents |
| `02-projects-dark.png` | project list and counters |
| `03-workbench-monaco-dark.png` | workbench with the Monaco editor |
| `04-review-diff-approval-dark.png` | verified diff with Approve and Reject |

**Not yet captured:** Rebuild prerequisites, screenshot comparison, plan approval, rollback and settings pages. They will be added from the same
scenario run; no mock-ups are published in their place. Regenerate all captures with `npm run test:desktop --prefix apps/studio`
(images appear in `apps/studio/out/validation/`) and review each for private paths and tokens before publishing.
