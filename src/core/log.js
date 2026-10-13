// Structured JSONL logging. Each CLI invocation has an execution ID; related
// work (an analysis, an improvement cycle, nested era subprocesses) shares a
// correlation ID, inherited by child processes through ERA_CORRELATION_ID.
// Every record is redacted before it is written.
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { redact } from '../safety/secrets.js';
import { newId } from './util.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger({ stateDir, executionId = newId('exec'), correlationId = null, base = {}, env = process.env, sink = null } = {}) {
  const threshold = LEVELS[env.ERA_LOG_LEVEL ?? 'info'] ?? LEVELS.info;
  const disabled = env.ERA_LOG === 'off';
  const file = stateDir ? join(stateDir, 'logs', `era-${new Date().toISOString().slice(0, 10)}.jsonl`) : null;
  const write = (record) => {
    if (disabled) return;
    const line = `${JSON.stringify(redact(record))}\n`;
    if (sink) sink(line);
    if (!file) return;
    try {
      mkdirSync(join(stateDir, 'logs'), { recursive: true });
      appendFileSync(file, line);
    } catch {
      // logging must never break analysis
    }
  };
  const make = (fields) => ({
    executionId,
    get correlationId() {
      return fields.correlation_id ?? correlationId;
    },
    file,
    log(level, event, data = {}) {
      if ((LEVELS[level] ?? LEVELS.info) < threshold) return;
      write({ ts: new Date().toISOString(), level, event, execution_id: executionId, correlation_id: fields.correlation_id ?? correlationId ?? executionId, ...base, ...fields, ...data });
    },
    info(event, data) {
      this.log('info', event, data);
    },
    warn(event, data) {
      this.log('warn', event, data);
    },
    error(event, data) {
      this.log('error', event, data);
    },
    child(extra) {
      return make({ ...fields, ...extra });
    },
  });
  return make({});
}

// A logger that discards everything (default for library use and tests).
export const nullLogger = {
  executionId: null,
  correlationId: null,
  file: null,
  log() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return nullLogger;
  },
};
