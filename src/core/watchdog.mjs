#!/usr/bin/env node
// era-watchdog: runs one command and guarantees that it (and everything in its
// process group) neither outlives a deadline nor outlives the ERA process that
// started it. ERA's own timers live in the parent, so without this a parent
// that dies (or is killed) leaves REA calls running indefinitely; an orphaned,
// hung `rea function` then keeps REA's per-target Hopper session open and every
// later decompilation is refused.
//
// Usage: node watchdog.mjs <deadline-ms> <command> [args...]
// The watchdog is spawned as a process-group leader by src/core/process.js.
import { spawn } from 'node:child_process';

const [deadlineArg, command, ...args] = process.argv.slice(2);
const deadline = Number(deadlineArg);
const parent = process.ppid;
let stopping = false;

function killGroup(signal) {
  try {
    process.kill(-process.pid, signal);
  } catch {
    child?.kill(signal);
  }
}

function stop(reason, signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  process.stderr.write(`era-watchdog: ${reason}; terminating process group\n`);
  for (const s of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.removeAllListeners(s).on(s, () => {});
  killGroup(signal);
  setTimeout(() => killGroup('SIGKILL'), 2000).unref();
}

const child = spawn(command, args, { stdio: 'inherit' });
child.on('error', (err) => {
  process.stderr.write(`era-watchdog: failed to start ${command}: ${err.message}\n`);
  process.exit(127);
});
const timer = Number.isFinite(deadline) && deadline > 0 ? setTimeout(() => stop(`deadline of ${deadline} ms exceeded`), deadline) : null;
const orphanCheck = setInterval(() => {
  if (process.ppid !== parent) stop('parent process exited', 'SIGKILL');
}, 1000);
for (const s of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(s, () => stop(`received ${s}`, s));
child.on('exit', (code, signal) => {
  clearTimeout(timer);
  clearInterval(orphanCheck);
  if (signal) {
    process.removeAllListeners(signal);
    process.kill(process.pid, signal);
  } else process.exit(code ?? 1);
});
