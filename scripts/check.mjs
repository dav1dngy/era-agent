#!/usr/bin/env node
// Repository checks: JavaScript syntax and a secret scan over tracked files.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);
let failed = false;

for (const f of files.filter((f) => /\.(m|c)?js$/.test(f))) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) {
    failed = true;
    process.stderr.write(`syntax error: ${f}\n${r.stderr}`);
  }
}

const SECRET_PATTERNS = [
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['Anthropic API key', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['OpenAI-style key', /\bsk-[A-Za-z0-9]{40,}\b/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
];
for (const f of files) {
  let text;
  try {
    text = readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  for (const [name, re] of SECRET_PATTERNS) {
    if (re.test(text)) {
      failed = true;
      process.stderr.write(`possible secret (${name}) in ${f}\n`);
    }
  }
}

process.stdout.write(failed ? 'checks failed\n' : `checks passed (${files.length} tracked files)\n`);
process.exitCode = failed ? 1 : 0;
