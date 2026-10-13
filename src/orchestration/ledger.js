// Append-only JSONL ledger of improvement cycles, decisions and rollbacks.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { redact } from '../safety/secrets.js';

export function ledgerPath(stateDir) {
  return join(stateDir, 'ledger.jsonl');
}

export function appendLedger(stateDir, event) {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const entry = redact({ at: new Date().toISOString(), ...event });
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

// Decided cycles, counted once each (a re-evaluated cycle is still one cycle).
export function decidedCycles(events) {
  const seen = new Map();
  for (const e of events) if (e.type === 'cycle-decided') seen.set(e.cycle_id, e);
  return [...seen.values()];
}

const STATE_EVENTS = new Set(['cycle-proposed', 'cycle-rebased', 'cycle-decided', 'cycle-abandoned', 'cycle-approved', 'cycle-declined']);

function lastStateEvents(events) {
  const last = new Map();
  for (const e of events) if (STATE_EVENTS.has(e.type)) last.set(e.cycle_id, e);
  return [...last.values()];
}

// Cycles still being worked on (proposed, rebased, or under evaluation).
export function pendingCycles(events) {
  return lastStateEvents(events).filter((e) => e.type === 'cycle-proposed' || e.type === 'cycle-rebased' || (e.type === 'cycle-decided' && e.status === 'inconclusive'));
}

// Evaluated cycles that passed all criteria and wait for a maintainer decision.
export function awaitingApproval(events) {
  return lastStateEvents(events).filter((e) => e.type === 'cycle-decided' && e.status === 'awaiting-approval');
}
