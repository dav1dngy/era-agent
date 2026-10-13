#!/usr/bin/env node
// Test double for the OpenAI Codex CLI (not a real agent).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
if (args[0] === '--version') {
  process.stdout.write('codex-cli 0.0.0-fake\n');
  process.exit(0);
}
const dir = args[args.indexOf('-C') + 1];
const last = args[args.indexOf('-o') + 1];
writeFileSync(join(dir, 'fake-codex-args.json'), JSON.stringify(args));
writeFileSync(join(dir, 'agent-change.txt'), 'changed by fake codex\n');
writeFileSync(last, 'fake codex finished');
process.stdout.write(JSON.stringify({ type: 'thread.started' }) + '\n' + JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 40, output_tokens: 7 } }) + '\n');
