// Bounded child-process execution shared by the REA client, test runner and
// benchmark engine. Every run has a timeout; nothing is left in the background.
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';

const TIME_BIN = '/usr/bin/time';
const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;

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
      child = spawn(file, argv, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      resolvePromise({ exitCode: null, signal: null, timedOut: false, durationMs: 0, stdout: '', stderr: '', stdoutBytes: 0, resources: null, spawnError: err.message });
      return;
    }
    const sink = stdoutFile ? createWriteStream(stdoutFile) : null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      const parsed = wrap ? parseTimeOutput(stderr) : { stderr, resources: null };
      const done = () => resolvePromise({ ...result, durationMs, stdout, stdoutBytes, stderr: parsed.stderr, resources: parsed.resources });
      if (sink) sink.end(done);
      else done();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2000).unref();
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
    if (input !== null) child.stdin.end(input);
    else child.stdin.end();
  });
}
