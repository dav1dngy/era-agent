// Bounded child-process execution shared by the REA client, test runner and
// benchmark engine. Every run has a timeout; nothing is left in the background.
// Each child leads its own process group so a timeout or cancellation kills the
// whole tree (REA, era subprocesses, /usr/bin/time wrappers), not just the
// direct child. A run settles shortly after the direct child exits even if an
// escaped grandchild still holds the output pipes.
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';

const TIME_BIN = '/usr/bin/time';
const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;
const KILL_GRACE_MS = 2000;
const PIPE_DRAIN_MS = 1000;

const active = new Set();

function killGroup(child, signal) {
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // already gone
    }
  }
}

// Terminates every running child process group (used on SIGINT/SIGTERM).
export function terminateAllChildren(signal = 'SIGTERM') {
  for (const child of active) killGroup(child, signal);
  return active.size;
}

export function activeChildCount() {
  return active.size;
}

export function resourceWrapperAvailable() {
  return process.platform === 'darwin' && existsSync(TIME_BIN);
}

// Parses and strips the trailing `/usr/bin/time -l` block (macOS format).
export function parseTimeOutput(stderr) {
  const m = /^\s*([\d.]+) real\s+([\d.]+) user\s+([\d.]+) sys\s*$/m.exec(stderr);
  if (!m) return { stderr, resources: null };
  const rss = /^\s*(\d+)\s+maximum resident set size/m.exec(stderr.slice(m.index));
  return {
    stderr: stderr.slice(0, m.index),
    resources: {
      real_s: Number(m[1]),
      user_s: Number(m[2]),
      sys_s: Number(m[3]),
      max_rss_bytes: rss ? Number(rss[1]) : null,
    },
  };
}

export function runProcess(command, args, options = {}) {
  const {
    cwd = process.cwd(),
    env = process.env,
    timeoutMs = 600_000,
    stdoutFile = null,
    measureResources = false,
    input = null,
  } = options;
  const wrap = measureResources && resourceWrapperAvailable();
  const file = wrap ? TIME_BIN : command;
  const argv = wrap ? ['-l', command, ...args] : args;

  return new Promise((resolvePromise) => {
    const started = process.hrtime.bigint();
    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let timedOut = false;
    let settled = false;
    let child;
    try {
      child = spawn(file, argv, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    } catch (err) {
      resolvePromise({ exitCode: null, signal: null, timedOut: false, durationMs: 0, stdout: '', stderr: '', stdoutBytes: 0, resources: null, spawnError: err.message });
      return;
    }
    active.add(child);
    const sink = stdoutFile ? createWriteStream(stdoutFile) : null;
    let drainTimer = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      active.delete(child);
      clearTimeout(timer);
      clearTimeout(drainTimer);
      child.stdout.destroy();
      child.stderr.destroy();
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      const parsed = wrap ? parseTimeOutput(stderr) : { stderr, resources: null };
      const done = () => resolvePromise({ ...result, durationMs, stdout, stdoutBytes, stderr: parsed.stderr, resources: parsed.resources });
      if (sink) sink.end(done);
      else done();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child, 'SIGTERM');
      setTimeout(() => killGroup(child, 'SIGKILL'), KILL_GRACE_MS).unref();
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (sink) sink.write(chunk);
      else if (stdout.length < MAX_CAPTURE_BYTES) stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < MAX_CAPTURE_BYTES) stderr += chunk;
    });
    child.on('error', (err) => finish({ exitCode: null, signal: null, timedOut, spawnError: err.message }));
    child.on('close', (code, signal) => finish({ exitCode: code, signal, timedOut, spawnError: null }));
    child.on('exit', (code, signal) => {
      // Escaped grandchildren may keep the pipes open: settle anyway, and make
      // sure nothing from this process group outlives the run.
      drainTimer = setTimeout(() => {
        killGroup(child, 'SIGKILL');
        finish({ exitCode: code, signal, timedOut, spawnError: null });
      }, PIPE_DRAIN_MS);
    });
    if (input !== null) child.stdin.end(input);
    else child.stdin.end();
  });
}
