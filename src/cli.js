// ERA command-line interface: argument parsing, context (config, REA client,
// structured logger), signal handling and dispatch to lazily loaded command
// modules in src/commands/.
import { chmodSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './core/config.js';
import { createLogger } from './core/log.js';
import { ReaClient } from './rea_integration/rea-client.js';
import { SafetyError } from './safety/policy.js';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const VERSION = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')).version;

export const HELP = `ERA ${VERSION} — Evolve & Reverse Engineer Anything

Usage: era <command> [options]

Analysis mode (uses the REA engine):
  analyze <target>              Reverse engineer a target and write a report
      --runtime [--arg A]...    Also execute a Mach-O target under REA process capture
                                (inside a macOS sandbox: no network, writes only to scratch)
      --unsandboxed             Allow runtime capture without a sandbox (trusted binaries only)
      --no-decompile            Skip native decompilation even if a provider is available
      --json                    Print the analysis record as JSON
  inspect <target>              Classify a target and show the REA workflow ERA would run
  explain <analysis>            Explain an analysis (ID or analysis.json path)
      --provider none|command|claude-code   (default: reasoning.provider or none)
      --allow-remote            Authorize a remote provider for this call
  extract --manifest <file>     Compute facts from existing REA Evidence (no engine run)
  rea <rea-args...>             Run any original REA CLI command unchanged
                                (e.g. era rea doctor, era rea mcp, era rea setup)

ERA Project Lab (external, authorized projects; the original is never changed without approval):
  project create <id> --source DIR [--task T] [--mode review|modify|rebuild] [--agent A]
                [--build CMD]... [--test CMD]... [--accept CMD]... [--accept-fail CMD]...
                [--agent-command CMD] [--criteria TEXT]... [--review-plan] [--protect GLOB]... [--reference PATH --destination DIR
                --authorization TEXT --run CMD] [--config FILE.json] [--max-cost USD]
                Multi-agent: [--team claude-only|codex-only|claude+codex|custom]
                [--architect A] [--implementer A] [--reviewer A] [--review-rounds N] [--block-on high]
                [--allow-remote claude-code,codex] [--allow-secret-content]
  project team <id>             Roles, capabilities, availability and sign-in of the project's agents
  project check <id> [--op OP] Everything that would stop or weaken a run (agents, sign-in, spend cap, consent,
                                acceptance, destination, sandbox), before it starts. modify/rebuild run this first.
  project list                  Projects and their status
  project review <id>           Review: architecture, findings, evidence (read-only)
  project modify <id>           Modify: isolated change, tests, regression check, diff
  project rebuild <id>          Rebuild: reconstruct selected behavior of a reference
  project status <id>           State, spend and the next step
  project show <id> [--run R]   The full report of a run
  project approve <id> [--yes]  Apply the verified diff / write the destination
  project resume <id> [--approve-plan]  Continue an interrupted, failed or manual run; approves a plan that is waiting
  project cancel <id>           Cancel and remove the run's working copy
  project rollback <id>         Undo an approved change
  (add --json for machine-readable output; --trust-project only for trusted code)

ERA Studio (desktop/browser workbench over the same backend):
  studio serve [--port N] [--open]  Start the loopback control plane and print the (tokenized) URL
  studio app                    Open the Electron desktop shell (after npm install --prefix apps/studio)
  studio doctor                 Check what ERA Studio needs on this machine

ERA Improvement Lab (ERA improves itself):
  self-analyze                  Pack ERA, analyze it with REA, report findings
      --plan <dir> --json       Only print the REA pass plan for an artifact directory
  improve propose [--finding ID]  REA self-analysis + one experiment worktree
  improve implement <cycle> [--agent ID]  Run a coding agent in the worktree
  improve evaluate <cycle>      Test, benchmark and decide (never merges). Candidate code is
                                sandboxed and REA runs under the stable supervisor; without a
                                sandbox, evaluation requires --trust-candidate (trusted code only)
  improve show <cycle>          Print the reviewable change proposal
  improve approve <cycle> [--by NAME] [--yes]   Integrate into main and tag
  improve decline <cycle> [--reason TEXT]       Keep main unchanged
  improve rebase <cycle>        Merge the current main into an experiment for re-evaluation
  improve cancel <cycle>        Abandon a proposed experiment
  improve recover               Repair state after a crash or kill
  improve [--cycles N] [--agent ID]   Bounded propose -> implement -> evaluate loop
  agents                        Coding agents and reasoning providers on this host
  benchmark [--versions a,b]    Benchmark the checkout or tagged versions
      [--repetitions N] [--rea-baseline] [--json] [--out file]
  status                        ERA version, REA engine status and pending work
  history                       Cycles, decisions, approvals and rollbacks
  rollback <version>            Restore an earlier tagged version as a new commit
  dashboard [--out file]        Write a static HTML dashboard

Options: --help, --version
Environment: ERA_REA_BIN, ERA_STATE_DIR, ERA_LOG_LEVEL (debug|info|warn|error), ERA_LOG=off
`;

const VALUED = new Set(['cycles', 'repetitions', 'out', 'versions', 'implementer', 'finding', 'agent', 'provider', 'by', 'reason', 'manifest', 'plan', 'id', 'mode', 'source', 'reference', 'destination', 'task', 'run', 'authorization', 'config', 'max-cost', 'timeout-ms', 'max-attempts', 'agent-command', 'team', 'architect', 'reviewer', 'allow-remote', 'review-rounds', 'block-on', 'port']);
// Flags that may be given several times (collected into arrays).
const REPEATABLE = new Set(['arg', 'build', 'test', 'criteria', 'accept', 'accept-fail', 'protect']);

export function parseArgs(argv) {
  const positional = [];
  const flags = { arg: [], build: [], test: [], criteria: [], accept: [], 'accept-fail': [], protect: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (REPEATABLE.has(key) && next !== undefined) flags[key].push(argv[++i]);
      else if (VALUED.has(key) && next !== undefined) flags[key] = argv[++i];
      else flags[key] = true;
    } else positional.push(a);
  }
  return { positional, flags };
}

const COMMANDS = {
  analyze: () => import('./commands/analysis.js'),
  inspect: () => import('./commands/analysis.js'),
  explain: () => import('./commands/analysis.js'),
  project: () => import('./commands/project.js'),
  studio: () => import('./commands/studio.js'),
  extract: () => import('./commands/analysis.js'),
  'self-analyze': () => import('./commands/lab.js'),
  improve: () => import('./commands/lab.js'),
  agents: () => import('./commands/lab.js'),
  benchmark: () => import('./commands/info.js'),
  status: () => import('./commands/info.js'),
  history: () => import('./commands/info.js'),
  rollback: () => import('./commands/info.js'),
  dashboard: () => import('./commands/info.js'),
};

export async function main(argv) {
  const [command, ...rest] = argv;
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(HELP);
    return 0;
  }
  if (command === '--version' || command === 'version') {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  let config;
  try {
    config = loadConfig(process.cwd());
  } catch (err) {
    process.stderr.write(`era: ${err.message}\n`);
    return 1;
  }
  // Raw evidence, logs and the ledger are private to the user.
  mkdirSync(config.stateDirAbs, { recursive: true, mode: 0o700 });
  try {
    chmodSync(config.stateDirAbs, 0o700);
  } catch {
    // not ours to change
  }
  const log = createLogger({ stateDir: config.stateDirAbs, correlationId: process.env.ERA_CORRELATION_ID || null, base: { era_version: VERSION } });
  if (!process.env.ERA_CORRELATION_ID) process.env.ERA_CORRELATION_ID = log.executionId;
  const rea = ReaClient.fromConfig(config, log);
  const ctx = { config, rea, log, version: VERSION };
  if (command === 'rea') {
    const { cmdRea } = await import('./commands/analysis.js');
    return cmdRea(ctx, rest);
  }
  const load = COMMANDS[command];
  if (!load) {
    process.stderr.write(`era: unknown command "${command}". Run \`era --help\`.\n`);
    return 2;
  }
  const args = parseArgs(rest);
  if (args.flags.help) {
    process.stdout.write(HELP);
    return 0;
  }
  const started = Date.now();
  log.info('command.start', { command, args: rest });
  try {
    const mod = await load();
    const code = (await mod.run(command, ctx, args)) ?? 0;
    log.info('command.end', { command, status: code === 0 ? 'succeeded' : 'failed', exit_code: code, duration_ms: Date.now() - started });
    return code;
  } catch (err) {
    const interrupted = err.name === 'InterruptedError';
    const prefix = err instanceof SafetyError ? 'era: safety: ' : 'era: ';
    process.stderr.write(`${prefix}${err.message}\n`);
    log.error('command.end', { command, status: interrupted ? 'interrupted' : 'failed', error: err.message, error_name: err.name, duration_ms: Date.now() - started });
    if (interrupted) return 130;
    return err.code === 'unsupported_target' ? 3 : 1;
  }
}
