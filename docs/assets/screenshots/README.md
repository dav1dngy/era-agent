# ERA Studio screenshots

Unedited screenshots of the real ERA Studio application (dark theme, 1440x900 window at 2x, 2880x1800 PNG), produced by a repeatable process:

```bash
npm ci && npm ci --prefix apps/studio
npm run capture:screenshots --prefix apps/studio     # rewrites this folder, including manifest.json
```

The process builds a controlled demo workspace at a neutral path, launches the Electron app, creates real states through the control plane and saves each
view. **Real:** the app, the control plane, REA 6.4.0, the project commands and tests, git, verification, a real REA analysis and a real self-analysis of ERA.
**Simulated:** the coding agent (a scripted stand-in; no model was called), which the interface labels *Simulated*; Codex and Claude Code appear *Unavailable*
because the demo workspace points them at commands that do not exist. Nothing is retouched or composed.

Before each capture the visible text is checked for the home directory, the user name, user-directory paths, credential patterns and the access token; the
capture fails if any appears. Review the images yourself before publishing a new set. `manifest.json` lists every file with its SHA-256, size, route, mode and alt text.

| File | View |
|---|---|
| `01-main-workspace.png` | New Task: composer, recent projects, status, agents |
| `02-project-management.png` | Projects with counters, search and statuses |
| `03-reverse-engineering-analysis.png` | REA analysis of a JavaScript application (a copy of Studio's own web UI), structure graph from REA evidence |
| `04-project-lab.png` | Project Lab: Review, Modify and Rebuild with their runs |
| `05-multi-agent-command-center.png` | providers, capabilities, data exposure, cost model and team presets |
| `06-ide-code-editor.png` | workbench: read-only original project and the Monaco editor |
| `07-diff-viewer-and-approval.png` | verified diff in Monaco, test outcomes, Approve and Reject |
| `08-improvement-lab.png` | ERA checkout, version tags and a real self-analysis |
| `09-settings-ai-providers.png` | Settings, AI providers |
| `10-documentation.png` | the in-app Documentation section |

The Rebuild flow (prerequisite checklist, screenshot comparison) and the plan-approval step are not part of this set.
