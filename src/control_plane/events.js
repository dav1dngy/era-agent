// Event bus and audit log for the control plane. Every status the UI shows comes from events published here
// (or from backend state files); nothing is synthesized in the browser.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { redact } from '../safety/secrets.js';

export class EventBus {
  constructor({ capacity = 2000 } = {}) {
    this.capacity = capacity;
    this.nextId = 1;
    this.buffer = [];
    this.subscribers = new Set();
  }

  publish(type, data = {}) {
    const event = { id: this.nextId++, type, at: new Date().toISOString(), data: redact(data) };
    this.buffer.push(event);
    if (this.buffer.length > this.capacity) this.buffer.shift();
    for (const sub of this.subscribers) sub(event);
    return event;
  }

  // Events after `lastId`; `complete: false` means the client missed events that are no longer buffered and must refetch state.
  since(lastId) {
    const first = this.buffer[0]?.id ?? this.nextId;
    if (lastId === null || lastId === undefined) return { events: [], complete: true };
    return { events: this.buffer.filter((e) => e.id > lastId), complete: lastId + 1 >= first || this.buffer.length === 0 };
  }

  subscribe(fn) {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }
}

// Append-only, redacted record of what the control plane did on behalf of the UI (who/what/result).
export class AuditLog {
  constructor(stateDir) {
    this.dir = join(stateDir, 'studio');
    this.file = join(this.dir, 'audit.jsonl');
  }

  record(action, detail = {}) {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const entry = { at: new Date().toISOString(), action, ...redact(detail) };
    appendFileSync(this.file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    return entry;
  }

  tail(limit = 200) {
    if (!existsSync(this.file)) return [];
    const lines = readFileSync(this.file, 'utf8').split('\n').filter(Boolean).slice(-limit);
    return lines.map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return { action: 'unreadable-entry' };
      }
    });
  }

  // Retention: drop job records older than the configured number of days.
  prune(days, jobsDir) {
    if (!existsSync(jobsDir)) return 0;
    const cutoff = Date.now() - days * 86_400_000;
    let removed = 0;
    for (const f of readdirSync(jobsDir)) {
      const p = join(jobsDir, f);
      if (statSync(p).mtimeMs < cutoff) {
        rmSync(p, { force: true });
        removed++;
      }
    }
    return removed;
  }
}
