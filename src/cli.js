// ERA command-line interface: argument parsing, context (config, REA client,
// structured logger), signal handling and dispatch to lazily loaded command
// modules in src/commands/.
import { readFileSync } from 'node:fs';
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
  rea <rea-args...>             Run any original REA CLI command unchanged
                                (e.g. era rea doctor, era rea mcp, era rea setup)

ERA Improvement Lab:
  self-analyze                  Pack ERA, analyze it with REA, report findings
  improve propose [--finding ID]  REA self-analysis + one experiment worktree
  improve implement <cycle> [--agent ID]  Run a coding agent in the worktree
  improve evaluate <cycle>      Test, benchmark and decide (never merges)
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

const VALUED = new Set(['cycles', 'repetitions', 'out', 'versions', 'implementer', 'finding', 'agent', 'provider', 'by', 'reason']);

export function parseArgs(argv) {
  const positional = [];
  const flags = { arg: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (key === 'arg') flags.arg.push(argv[++i]);
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
  const config = loadConfig(process.cwd());
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
