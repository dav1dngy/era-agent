// Reverse Engineering Core: the only place ERA executes the original REA engine.
// Every invocation is recorded (command, input artifact, engine version, output,
// status, errors, warnings, timing, resources) under <stateDir>/runs/<run_id>/.
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { runProcess } from '../core/process.js';
import { newId, sha256File, fileInfo, writeJson, writeText } from '../core/util.js';
import { nullLogger } from '../core/log.js';
import { redactText } from '../safety/secrets.js';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// The rea-agents dependency may be nested (era-agent/node_modules) or hoisted
// next to era-agent when ERA is installed into another project.
export function dependencyReaBin() {
  try {
    const pkg = createRequire(import.meta.url).resolve('rea-agents/package.json');
    const bin = join(dirname(dirname(pkg)), '.bin', 'rea');
    if (existsSync(bin)) return bin;
  } catch {
    // not installed as a dependency
  }
  const nested = join(PACKAGE_ROOT, 'node_modules', '.bin', 'rea');
  return existsSync(nested) ? nested : null;
}

export function resolveReaCommand(configured, env = process.env) {
  if (configured) return { command: configured, source: 'config' };
  if (env.ERA_REA_BIN) return { command: env.ERA_REA_BIN, source: 'env:ERA_REA_BIN' };
  const local = dependencyReaBin();
  if (local) return { command: local, source: 'local-dependency' };
  return { command: 'rea', source: 'PATH' };
}

function splitStderr(stderr) {
  const progress = [];
  const warnings = [];
  for (const line of stderr.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('{"rea_progress"')) {
      try {
        progress.push(JSON.parse(trimmed).rea_progress);
        continue;
      } catch {
        // fall through: keep malformed progress as a warning
      }
    }
    warnings.push(trimmed);
  }
  return { progress, warnings };
}

export class ReaClient {
  constructor({ command = null, timeoutMs = 600_000, measureResources = true, stateDir, env = process.env, log = nullLogger } = {}) {
    const resolved = resolveReaCommand(command, env);
    this.command = resolved.command;
    this.commandSource = resolved.source;
    this.timeoutMs = timeoutMs;
    this.measureResources = measureResources;
    this.stateDir = stateDir;
    this.env = env;
    this.log = log;
    this._version = undefined;
    this.runCount = 0;
  }

  static fromConfig(config, log = nullLogger) {
    return new ReaClient({ ...config.rea, stateDir: config.stateDirAbs, log });
  }

  async version() {
    if (this._version !== undefined) return this._version;
    const r = await runProcess(this.command, ['--version'], { timeoutMs: 60_000, env: this.env });
    this._version = r.exitCode === 0 ? r.stdout.trim() : null;
    this._versionError = r.exitCode === 0 ? null : (r.spawnError ?? r.stderr.trim()) || `exit ${r.exitCode}`;
    return this._version;
  }

  async status() {
    const version = await this.version();
    if (!version) return { available: false, command: this.command, source: this.commandSource, error: this._versionError };
    const { record, result } = await this.run('providers', [], { label: 'status:providers', persist: false });
    const providers = (result?.analysis_provider_candidates ?? []).map((c) => ({
      id: c.provider?.id,
      name: c.provider?.name,
      status: c.availability?.status,
      reason: c.availability?.reason ?? null,
    }));
    return {
      available: true,
      command: this.command,
      source: this.commandSource,
      version,
      providers,
      decompiler_available: providers.some((p) => p.status === 'available'),
      probe_status: record.status,
    };
  }

  /**
   * Execute one REA CLI command and record it.
   * @param {string} subcommand REA CLI command, e.g. "inspect-macho"
   * @param {string[]} args positional args and options
   * @param {{ inputPath?: string, label?: string, timeoutMs?: number, persist?: boolean }} opts
   */
  async run(subcommand, args = [], opts = {}) {
    const { inputPath = null, label = subcommand, timeoutMs = this.timeoutMs, persist = true } = opts;
    const runId = newId('rea');
    const runDir = persist && this.stateDir ? join(this.stateDir, 'runs', runId) : null;
    if (runDir) mkdirSync(runDir, { recursive: true });
    const outputFile = runDir ? join(runDir, 'output.json') : null;
    const argv = [subcommand, ...args, '--format', 'json'];
    const startedAt = new Date().toISOString();
    const engineVersion = await this.version();

    const proc = await runProcess(this.command, argv, {
      timeoutMs,
      env: this.env,
      stdoutFile: outputFile,
      measureResources: this.measureResources,
      watchdog: true,
    });
    this.runCount += 1;

    const text = outputFile ? (existsSync(outputFile) ? readFileSync(outputFile, 'utf8') : '') : proc.stdout;
    let result = null;
    let parseError = null;
    try {
      result = !proc.outputError && text.trim() ? JSON.parse(text) : null;
    } catch (err) {
      parseError = `REA output is not valid JSON: ${err.message}`;
    }
    const { progress, warnings } = splitStderr(proc.stderr);
    const errors = [];
    if (proc.spawnError) errors.push(`failed to start REA (${this.command}): ${proc.spawnError}`);
    if (proc.timedOut) errors.push(`REA exceeded timeout of ${timeoutMs} ms`);
    if (proc.outputError) errors.push(`REA output aborted: ${proc.outputError}`);
    if (parseError) errors.push(parseError);
    if (result?.error) errors.push(`${result.code ?? 'error'}: ${result.message ?? result.error}`);
    if (proc.exitCode !== 0 && errors.length === 0) errors.push(`REA exited with code ${proc.exitCode}`);

    let input = null;
    if (inputPath) {
      const info = fileInfo(inputPath);
      input = {
        path: inputPath,
        kind: info.isDirectory ? 'directory' : info.isFile ? 'file' : 'missing',
        bytes: info.isFile ? info.bytes : null,
        sha256: info.isFile ? await sha256File(inputPath) : (result?.subject?.digest?.sha256 ?? null),
      };
    }

    const status = proc.timedOut ? 'timeout' : proc.exitCode === 0 && !parseError && !result?.error && !proc.outputError ? 'succeeded' : 'failed';
    const record = {
      run_id: runId,
      label,
      started_at: startedAt,
      duration_ms: Math.round(proc.durationMs),
      command: [this.command, ...argv],
      command_source: this.commandSource,
      engine: { package: 'rea-agents', version: engineVersion },
      input,
      status,
      exit_code: proc.exitCode,
      signal: proc.signal ?? null,
      evidence_id: result?.evidence_id ?? null,
      operation: result?.operation ?? null,
      provider: result?.provider ?? null,
      output_file: outputFile,
      output_bytes: proc.stdoutBytes,
      progress_events: progress.length,
      warnings: warnings.map(redactText),
      errors: errors.map(redactText),
      resources: proc.resources,
    };
    if (runDir) {
      writeJson(join(runDir, 'record.json'), record);
      writeText(join(runDir, 'stderr.log'), proc.stderr);
    }
    this.log.log(status === 'succeeded' ? 'info' : 'warn', 'rea.run', {
      run_id: runId,
      label,
      rea_command: subcommand,
      rea_version: engineVersion,
      operation: record.operation,
      provider: record.provider?.id ?? null,
      status,
      exit_code: proc.exitCode,
      duration_ms: record.duration_ms,
      evidence_id: record.evidence_id,
      input_sha256: input?.sha256 ?? null,
      errors,
      warnings: warnings.length,
      max_rss_bytes: proc.resources?.max_rss_bytes ?? null,
    });
    return { record, result };
  }
}
