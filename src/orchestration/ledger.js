// Append-only JSONL ledger of improvement cycles, decisions and rollbacks.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function ledgerPath(stateDir) {
  return join(stateDir, 'ledger.jsonl');
}

export function appendLedger(stateDir, event) {
  mkdirSync(stateDir, { recursive: true });
  const entry = { at: new Date().toISOString(), ...event };
  appendFileSync(ledgerPath(stateDir), `${JSON.stringify(entry)}\n`);
  return entry;
}

export function readLedger(stateDir) {
  const file = ledgerPath(stateDir);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function decidedCycles(events) {
  return events.filter((e) => e.type === 'cycle-decided');
}

// Cycles still being worked on (proposed or under evaluation).
export function pendingCycles(events) {
  const closed = new Set(events.filter((e) => e.type === 'cycle-decided' || e.type === 'cycle-abandoned').map((e) => e.cycle_id));
  return events.filter((e) => e.type === 'cycle-proposed' && !closed.has(e.cycle_id));
}

// Evaluated cycles that passed all criteria and wait for a maintainer decision.
export function awaitingApproval(events) {
  const resolved = new Set(events.filter((e) => e.type === 'cycle-approved' || e.type === 'cycle-declined').map((e) => e.cycle_id));
  return events.filter((e) => e.type === 'cycle-decided' && e.status === 'awaiting-approval' && !resolved.has(e.cycle_id));
}
