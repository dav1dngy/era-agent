# ERA Studio architecture

The existing platform decision is recorded in [ADR_ERA_STUDIO_PLATFORM.md](ADR_ERA_STUDIO_PLATFORM.md).
This implementation continues the Node/ESM monorepo without migrating the working CLI.

## Three layers

| Layer | Location | Responsibility |
|---|---|---|
| Presentation | `apps/studio/web` | Preact/htm views, original design tokens, Monaco editor/diff, xterm terminal, routing and user decisions |
| Desktop host | `apps/studio/electron` | Electron window, native picker, verified runtime PATH, narrowly scoped IPC, main-process authentication |
| Control plane | `src/control_plane` | Loopback HTTP API, settings, policy, audit, SSE, jobs and task sequencing |
| Execution | Existing `src/analysis`, `project_lab`, `agents`, `orchestration`, `rea_integration` | REA, coding agents, isolated workspaces, tests, evaluation, approvals and rollback |

Project operations run the existing CLI as supervised subprocesses, sharing file-based
state and Project Lab locks. Inline selection assistance invokes existing adapters on
private snapshots under the same project lock and cost ledger. The UI contains no
alternate evaluator, approval authority or workflow implementation.

Tasks map a reviewed natural-language request to supported operations. Composite
review→modify tasks advance only when the preceding job succeeds. Jobs publish real
queued/running/terminal states. Project progress reads actual step records; percentages
represent known stages, not an estimate of remaining time. Native analysis has no
invented percentage. SSE retains a bounded replay buffer and requests a full resync
when a reconnect misses retained events.

## State and boundaries

Studio stores settings, task records, job records and an audit trail under
`<stateDir>/studio`; Project Lab/analysis/Improvement Lab keep their existing formats.
The packaged host defaults outside the repository to Application Support. Development
launches honor the CLI state directory. External project sources remain external.
Per-project records and working copies never live inside the selected project.

Settings are validated atomically. Workspace roots use canonical filesystem paths,
including nonexistent tails and symlinks. New registrations, updates and file access
recheck those boundaries. Root/file permissions are enforced by the server. Original
editing and terminal use are separate opt-in capabilities.

Editor instances are keyed by project; open models cannot be reused across project
identities. Dirty state protects navigation and closes. The UI's approval eligibility
is advisory; the backend verifies the run, artifact hash and original/workspace integrity.
Historical reports are read by their exact run IDs.

## Build and lifecycle

The root package retains its existing runtime dependency on REA. Studio's optional
package owns Electron and web assets. No bundler/CDN is required. Packaging stages
an explicit source allowlist and runs `npm ci --omit=dev --ignore-scripts` with merged
locked runtime dependencies. The bundle is unpacked because supervised CLI and PTY
processes need real filesystem paths.

Electron's embedded Node runs ERA jobs/watchdogs in `ELECTRON_RUN_AS_NODE` mode;
external REA/project commands use the supported Node found on PATH. Child groups
are stopped on shutdown; queued jobs are interrupted rather than launched while
closing. Restarted jobs are not falsely reattached by PID alone. Terminal processes
are scoped and closed on host shutdown.

## Remaining engineering work

No debugger/LSP/plugin-host services are duplicated. Advanced rebuild behavior editing,
external MCP account management, native signed installers, formal accessibility review,
cross-platform sandboxing and enterprise identity/collaboration are future work.
A separate independent security review remains required before production claims.
