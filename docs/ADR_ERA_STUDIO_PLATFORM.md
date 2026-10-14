# ADR: ERA Studio platform

Status: accepted for v0.2.0 development (branch `feature/era-v0.2.0`). Date: 2026-10-14.

## Context

ERA is a zero-build, plain-ESM Node.js project with one runtime dependency (`rea-agents`). All
long-running work already runs as supervised CLI processes with file-based state (JSON/JSONL under
the state directory), cross-process locks, cancellation, resume, approvals bound to evaluated
artifacts, and a macOS sandbox for untrusted project code. ERA Studio must put a professional,
AI-native desktop UI on that backend without duplicating its logic, without weakening its safety
controls, and without dragging a heavy toolchain into a project whose CLI must keep working on its own.

Requirements that drive the decision: a real desktop app on macOS (Windows/Linux later); a code
editor, diffs, file explorer, terminal and Git status; a control plane the UI cannot bypass;
streaming of *real* backend state; an original design system; MCP/agent integration through the
existing adapters; free and open-source licensing compatible with the repository's MIT license;
maintainability by a small team.

## Evidence gathered for this decision

Measured on the development machine (macOS arm64, Node 24.20, npm 11, 2026-10-14), installing into
empty directories (`npm install`, no scripts approved):

| Stack | Command | Result |
|---|---|---|
| **Electron + Monaco + xterm.js + Preact + htm** | `npm install electron monaco-editor @xterm/xterm preact htm` | 20 packages, 7.5 s, 125 MB (Monaco is 102 MB of that; ERA needs ~25 MB of `min/`); Electron binary downloaded separately in 28 s: 308 MB on disk |
| **Eclipse Theia (minimal)** | `npm install @theia/core @theia/editor @theia/monaco @theia/terminal @theia/filesystem @theia/workspace @theia/navigator @theia/ai-core @theia/ai-chat @theia/electron` | 355 top-level packages, 283 MB, 58 s, **before** `theia build` (webpack of the frontend/backend); needs native modules (`keytar`, `native-keymap`, `node-pty`) that run `node-gyp` and must be rebuilt for Electron's ABI |

Package metadata from the npm registry (same day): Electron 44.7.1, MIT; Monaco 0.57.0, MIT; xterm.js 6.0.0,
MIT; CodeMirror 6, MIT; Theia 1.76.0, **EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0** (`@theia/core` declares 67 direct dependencies).
Not measured: Theia build time and runtime memory, VS Code extension host behavior, Windows/Linux builds.
Statements about those below are assessments, labeled as such.

## Options

### A. Eclipse Theia + Theia AI + ERA extensions

* **For:** a complete IDE out of the box (explorer, editors, terminal, search, SCM views, debug adapter
  support, extension model compatible with many VS Code extensions); Theia AI provides chat/agent
  scaffolding and MCP client support; designed for white-label products; Electron target included.
* **Against (measured):** 355 packages / 283 MB before building; native modules requiring a compiler
  toolchain and Electron rebuilds; a Theia application is built with its own CLI and webpack, which
  would make ERA a TypeScript/InversifyJS project with a build step the rest of the repository does not have.
* **Against (assessment):** the AI-native home workspace, Agent Command Center and approval center are
  *our* product surface and would be custom Theia widgets either way, so most of the unique work is not
  saved; Theia AI's agent abstractions overlap with (and would have to be mapped onto) ERA's existing
  adapters, locks and approval model, creating two orchestration systems; EPL-2.0 is compatible with
  distributing a combined application but adds notice/source obligations to a project that is
  currently pure MIT; upgrade churn across ~70 `@theia/*` packages is a real maintenance cost.
* **Security:** Theia's backend is a Node server with broad filesystem/terminal powers; confining it to ERA's
  permission model would mean fighting the platform instead of using it.

### B. React + TypeScript + Monaco + Electron

* **For:** the standard modern stack; mature editor (Monaco) and terminal (xterm.js); small footprint
  (measured); every piece MIT; complete control of UX and of the IPC/permission surface.
* **Against:** we implement file explorer, search, Git status, tabs, panels, terminal wiring ourselves;
  React + TypeScript adds a bundler/transpiler toolchain (Vite/esbuild, tsconfig) to a repository that
  has none; no debugger or language servers for free.

### C. VS Code extension architecture

* **For:** the largest IDE feature set, instant familiarity, trivial Git/terminal/debug.
* **Against (assessment):** it is not a standalone desktop application (users must install VS Code), the
  UI is constrained to webviews/tree views, there is no way to build the requested agent command center
  as the primary experience, and the extension host is a second runtime between UI and backend.
  Good as a *later companion client*, not as the product.

### D. Control plane in ERA core + build-free web workbench + Electron shell (selected)

A variant of B tuned to this repository: keep Node/ESM, add **no build step**, use established components
only where they replace large amounts of work, and make the UI a thin client of a loopback control plane
that the CLI can also start.

* **Control plane** (`src/control_plane/`, part of ERA core, zero UI dependencies): node:http server bound to
  127.0.0.1, per-launch bearer token, Host/Origin validation, JSON API + streaming events, settings and
  permission policy, audit log, job manager that runs existing CLI commands as supervised child processes
  (the execution plane) and derives progress from the backend's own state files.
* **Workbench** (`apps/studio/`): ES modules, Preact + htm (4 KB + 1 KB, MIT; no JSX, so no compiler),
  CSS design tokens (dark/light), **Monaco** for editing and diffs, **xterm.js** for the terminal view.
  Served locally from `node_modules`; nothing loaded from the network.
* **Desktop shell:** Electron (`contextIsolation`, `sandbox`, no Node in the renderer, a three-function
  preload), which starts the control plane in-process and attaches the token to its own requests. The same
  UI also works in a browser tab via `era studio serve`, which is also how it can be tested.
* **Optional dependencies:** Electron/Monaco/xterm/Preact live in `apps/studio/package.json`; the root package
  (what the CLI users install) keeps its single dependency.

## Decision matrix

Scores 1 (poor) to 5 (strong); "M" = measured here, "A" = assessment.

| Criterion | A Theia | B React+TS+Electron | C VS Code ext. | D selected |
|---|---|---|---|---|
| 1 Existing Node.js compatibility | 3 A (TS/Inversify, own build) | 4 A | 3 A (extension host) | **5** A (same ESM, no build) |
| 2 IDE functionality | **5** A | 3 A | **5** A | 3 A (Monaco, explorer, diff, Git, terminal; no debugger/LSP) |
| 3 Desktop app support | 4 A | **5** A | 1 A | **5** A |
| 4 macOS integration | 4 A | 4 A | 4 A | 4 A (native dialogs, menus, Dock via Electron) |
| 5 Windows/Linux later | 4 A | 4 A | 4 A | 3 A (ERA's sandbox is macOS-only regardless; shell is portable) |
| 6 Code editing | **5** A | **5** A | **5** A | **5** A (Monaco) |
| 7 Git integration | 4 A | 2 A | **5** A | 3 A (status/diff/log through the control plane) |
| 8 Terminal | 4 A (node-pty, native) | 3 A | **5** A | 3 A (xterm.js + controlled, sandboxed session) |
| 9 Debugging | 4 A | 1 A | **5** A | 1 A (not implemented) |
| 10 Extension architecture | **5** A | 2 A | **5** A | 2 A (API is the extension point) |
| 11 MCP integration | 4 A (Theia AI) | 3 A | 4 A | 4 A (ERA already ships MCP via REA) |
| 12 AI-agent integration | 3 A (second agent model to map) | 4 A | 3 A | **5** A (existing adapters, no mapping) |
| 13 Multi-agent orchestration | 2 A | 4 A | 2 A | **5** A (ERA's own) |
| 14 UI customization | 3 A (widgets in a fixed shell) | **5** A | 2 A | **5** A |
| 15 Security architecture | 2 A (broad backend powers) | 4 A | 3 A | **5** A (single permissioned API) |
| 16 Performance | 3 A | 4 A | 4 A | 4 A |
| 17 Memory | 2 A | 3 A (Electron baseline) | 3 A | 3 A (Electron baseline) |
| 18 Maintenance complexity | 2 M/A (355 pkgs, native rebuilds) | 3 A (toolchain) | 4 A | **4** M/A (20 pkgs, no toolchain) |
| 19 Licensing compatibility | 3 M (EPL-2.0/GPL-CE) | **5** M (MIT) | **5** A | **5** M (MIT) |
| 20 Long-term OSS sustainability | 4 A (Eclipse Foundation) | 4 A | 3 A (depends on Microsoft marketplace terms) | 3 A (we own more code) |

Totals are deliberately not summed: the decision is driven by criteria 1, 12, 13, 15, 18 and 19, which are
where ERA's existing architecture matters most, and the cost paid is criteria 2, 7, 8, 9 (IDE depth).

## Decision

**Option D.** It reuses ERA's orchestration, adapters, locks and approvals unchanged; keeps the single
control point the security model needs; adds ~20 packages instead of ~355; needs no build tool; and
delivers the requested AI-native/command-center UX as first-class UI instead of widgets inside someone
else's shell. It does *not* match Theia's raw IDE feature set, and this ADR records that trade-off.

## Consequences and what is explicitly not delivered

* No debugger integration, no language servers beyond what Monaco bundles, no extension marketplace.
  Terminal is a controlled, sandboxed shell session (see ERA_STUDIO_SECURITY.md), not a general PTY host.
* We own the explorer/search/Git/diff UI. They are deliberately small and read-mostly.
* **Exit path:** the control plane is protocol-level (HTTP + streaming events, no UI assumptions), so a
  Theia extension or a VS Code extension can be added later as another client of the same API, without
  changing Project Lab, the Improvement Lab or the CLI. If users need debugging and language servers,
  that is the recommended next step, and this ADR should then be revisited with measurements of an actual
  Theia build.
* Maintenance cost: more UI code in-repo than with Theia; fewer moving dependencies; MIT throughout.

## Integration requirements

* Control plane must call existing modules (`ProjectLab`, `analyzeTarget`, Improvement Lab functions) or the
  existing CLI; it must not re-implement orchestration.
* Missing backend APIs found by the audit (Improvement Lab listing, analysis listing/graph data, job
  streaming) are added in `src/control_plane/` as thin readers over existing state files and as CLI jobs.
* Electron preload exposes only: directory picker, open-external (validated https URLs), app version.

## Security implications

Loopback-only listener with a random per-launch token; Host and Origin checks (DNS-rebinding and CSRF);
`Content-Type: application/json` required for mutations; strict input validation; filesystem access limited
to registered project roots with realpath checks; direct edits of original projects off by default; every
mutation and approval written to an audit log; approvals require an explicit confirmation field and the
SHA-256 of the evaluated artifact; no credentials are stored by Studio. Details: ERA_STUDIO_SECURITY.md.

## Revisit when

Users ask for debugging/LSP as a priority; the maintenance cost of our file/Git/terminal UI exceeds the cost
of a Theia build; or Theia AI offers a stable MCP-first agent API that maps cleanly onto ERA's adapters.
