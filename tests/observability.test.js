import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '../src/core/log.js';
import { redact, redactText, containsSecret } from '../src/safety/secrets.js';
import { runEra, tempDir, FAKE_REA } from './helpers.js';

test('redaction masks sensitive keys and secret-looking values', () => {
  const r = redact({ api_key: 'abc', nested: { Authorization: 'Bearer x', note: 'token ghp_' + 'a'.repeat(36) }, list: ['AKIA' + 'B'.repeat(16)], count: 3 });
  assert.equal(r.api_key, '[REDACTED]');
  assert.equal(r.nested.Authorization, '[REDACTED]');
  assert.match(r.nested.note, /\[REDACTED:GitHub token\]/);
  assert.match(r.list[0], /\[REDACTED:AWS access key\]/);
  assert.equal(r.count, 3);
  assert.equal(containsSecret('sk-ant-' + 'x'.repeat(30)), true);
  assert.equal(redactText('plain text'), 'plain text');
});

test('logger writes redacted JSONL with execution and correlation IDs', () => {
  const lines = [];
  const log = createLogger({ stateDir: null, correlationId: 'corr-1', base: { era_version: '0.1.0' }, env: {}, sink: (l) => lines.push(JSON.parse(l)) });
  log.info('rea.run', { status: 'succeeded', password: 'hunter2' });
  log.child({ correlation_id: 'cycle-9' }).warn('cycle.decided', { status: 'rejected' });
  assert.equal(lines[0].execution_id, log.executionId);
  assert.equal(lines[0].correlation_id, 'corr-1');
  assert.equal(lines[0].password, '[REDACTED]');
  assert.equal(lines[1].correlation_id, 'cycle-9');
  assert.equal(lines[1].level, 'warn');
});

test('log level and ERA_LOG=off are honoured', () => {
  const lines = [];
  createLogger({ env: { ERA_LOG_LEVEL: 'warn' }, sink: (l) => lines.push(l) }).info('x');
  createLogger({ env: { ERA_LOG: 'off' }, sink: (l) => lines.push(l) }).error('y');
  assert.equal(lines.length, 0);
});

test('CLI invocations are logged with REA run events (fake REA)', () => {
  const state = tempDir();
  const r = runEra(['status', '--json'], { cwd: tempDir(), env: { ERA_STATE_DIR: state, ERA_REA_BIN: FAKE_REA, ERA_CORRELATION_ID: '' } });
  assert.equal(r.status, 0, r.stderr);
  const file = join(state, 'logs', `era-${new Date().toISOString().slice(0, 10)}.jsonl`);
  assert.ok(existsSync(file));
  const events = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(events.map((e) => e.event), ['command.start', 'rea.run', 'command.end']);
  assert.ok(events.every((e) => e.execution_id === events[0].execution_id && e.era_version));
  assert.equal(events[1].rea_version, '9.9.9-fake');
  assert.equal(events[2].status, 'succeeded');
});

test('ledger entries, agent prompts and agent output tails are redacted (audit F08)', async () => {
  const { appendLedger, readLedger } = await import('../src/orchestration/ledger.js');
  const { agentPrompt, commandAgent } = await import('../src/agents/coding-agents.js');
  const key = ['sk', 'ant', 'x'.repeat(30)].join('-');
  const dir = tempDir();
  appendLedger(dir, { type: 'note', detail: `found ${key}` });
  assert.ok(!JSON.stringify(readLedger(dir)).includes(key));
  const instructions = join(dir, 'i.md');
  writeFileSync(instructions, `finding quotes ${key}`);
  assert.ok(!agentPrompt({ worktree: dir, instructionsFile: instructions }).includes(key));
  const r = await commandAgent(`echo ${key}`).implement({ worktree: dir, instructionsFile: instructions, proposalFile: instructions, cycleId: 'c', timeoutMs: 10_000 });
  assert.ok(!r.stdout_tail.includes(key));
});

test('the ERA state directory is private to the user', () => {
  const state = join(tempDir(), 'state');
  runEra(['status', '--json'], { cwd: tempDir(), env: { ERA_STATE_DIR: state, ERA_REA_BIN: FAKE_REA } });
  assert.equal(statSync(state).mode & 0o777, 0o700);
});
