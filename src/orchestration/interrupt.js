// Cancellation support for long-running operations. On SIGINT/SIGTERM every
// running child process group is terminated (a second signal escalates to
// SIGKILL) and the operation observes `check()` to stop before recording a
// decision based on killed subprocesses.
import { terminateAllChildren } from '../core/process.js';

export class InterruptedError extends Error {
  constructor(signal) {
    super(`Interrupted by ${signal}`);
    this.name = 'InterruptedError';
    this.signal = signal;
  }
}

export function createInterruptGuard(proc = process) {
  let signal = null;
  const handler = (sig) => {
    if (signal) {
      terminateAllChildren('SIGKILL');
      return;
    }
    signal = sig;
    terminateAllChildren('SIGTERM');
  };
  proc.on('SIGINT', handler);
  proc.on('SIGTERM', handler);
  return {
    get signal() {
      return signal;
    },
    check() {
      if (signal) throw new InterruptedError(signal);
    },
    dispose() {
      proc.off('SIGINT', handler);
      proc.off('SIGTERM', handler);
    },
  };
}
