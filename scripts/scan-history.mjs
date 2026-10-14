#!/usr/bin/env node
// Scans every line ever added in the Git history (all branches) for credentials, e-mail addresses and personal local paths.
//   node scripts/scan-history.mjs [--base REV]     --base: only commits after REV (for example the last published commit)
// Credential-shaped strings inside tests/ are counted as synthetic test values and reported separately; everywhere else they are findings.
// E-mail addresses at users.noreply.github.com and reserved example/test domains are ignored. Exit status 1 if there are findings.
import { execFileSync } from 'node:child_process';
import { SECRET_PATTERNS } from '../src/safety/secrets.js';
import { PERSONAL_PATH } from './anonymize.mjs';

const baseIdx = process.argv.indexOf('--base');
const range = baseIdx > 0 ? [`${process.argv[baseIdx + 1]}..HEAD`] : ['--all'];
const out = execFileSync('git', ['log', ...range, '-p', '-U0', '--no-color', '--format=@@commit %H %an <%ae>'], { encoding: 'utf8', maxBuffer: 1 << 30 });
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const BENIGN_EMAIL = /@(users\.noreply\.github\.com|(?:[a-z0-9-]+\.)*example\.(?:com|org|net|invalid|test)|[a-z0-9.-]*\.(?:invalid|test|local)|localhost)$|^git@github\.com$/i;
const findings = [];
const synthetic = [];
const identities = new Set();
let commit = null;
let file = null;
let commits = 0;
for (const line of out.split('\n')) {
  if (line.startsWith('@@commit ')) {
    commit = line.slice(9, 21);
    commits++;
    identities.add(line.split(' ').slice(2).join(' '));
    file = null;
  } else if (line.startsWith('+++ ')) file = line.slice(6);
  else if (line.startsWith('+') && !line.startsWith('+++')) {
    const text = line.slice(1);
    for (const [name, re] of SECRET_PATTERNS) {
      if (new RegExp(re.source).test(text)) (/^tests\//.test(file ?? '') ? synthetic : findings).push({ commit, file, kind: name });
    }
    for (const m of text.matchAll(EMAIL)) if (!BENIGN_EMAIL.test(m[0])) findings.push({ commit, file, kind: 'e-mail address', value: m[0] });
    if (PERSONAL_PATH.test(` ${text}`)) findings.push({ commit, file, kind: 'personal local path' });
  }
}
console.log(`scanned ${commits} commits (${baseIdx > 0 ? `after ${process.argv[baseIdx + 1]}` : 'all branches'})`);
console.log(`identities: ${[...identities].sort().join('; ')}`);
console.log(`synthetic credential-shaped test values (tests/): ${synthetic.length}`);
const byKind = new Map();
for (const f of findings) { const k = `${f.kind} ${f.commit} ${f.file}`; byKind.set(k, (byKind.get(k) ?? 0) + 1); }
for (const [k, n] of byKind) console.log(`FINDING ${k} (${n}x)`);
console.log(findings.length ? `${findings.length} finding(s) in ${new Set(findings.map((f) => f.commit)).size} commit(s)` : 'no findings');
process.exit(findings.length ? 1 : 0);
