#!/usr/bin/env node
// Test double for the Claude Code CLI (not a real agent). FAKE_AGENT_MODE: ok | fail | error-result.
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args[0] === '--version') {
  process.stdout.write('9.9.9 (Fake Claude Code)\n');
  process.exit(0);
}
const mode = process.env.FAKE_AGENT_MODE ?? 'ok';
writeFileSync('fake-claude-args.json', JSON.stringify(args));
if (mode === 'fail') process.exit(2);
writeFileSync('agent-change.txt', `changed by fake claude for ${process.env.ERA_CYCLE_ID}\n`);
process.stdout.write(JSON.stringify({ type: 'result', is_error: mode === 'error-result', result: 'done', total_cost_usd: 0.0123, usage: { input_tokens: 100, output_tokens: 20 } }) + '\n');
