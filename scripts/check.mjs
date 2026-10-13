#!/usr/bin/env node
// Repository checks: JavaScript syntax and a secret scan over tracked files.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { SECRET_PATTERNS } from '../src/safety/secrets.js';
import { PERSONAL_PATH } from './anonymize.mjs';

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);
let failed = false;

for (const f of files.filter((f) => /\.(m|c)?js$/.test(f))) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) {
    failed = true;
    process.stderr.write(`syntax error: ${f}\n${r.stderr}`);
  }
}


for (const f of files) {
  let text;
  try {
    text = readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  if (PERSONAL_PATH.test(text)) {
    failed = true;
    process.stderr.write(`personal absolute path in ${f} (run node scripts/export-experiments.mjs or anonymize it)\n`);
  }
  for (const [name, re] of SECRET_PATTERNS) {
    if (new RegExp(re.source).test(text)) {
      failed = true;
      process.stderr.write(`possible secret (${name}) in ${f}\n`);
    }
  }
}

process.stdout.write(failed ? 'checks failed\n' : `checks passed (${files.length} tracked files)\n`);
process.exitCode = failed ? 1 : 0;
