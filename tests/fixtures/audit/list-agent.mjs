// TEST FIXTURE for tests/audit-remediation.test.js. A mock coding agent (NOT an AI): prints every file it can see in its
// working directory (so a test can prove what an agent was exposed to), then creates candidate.txt; when candidate.txt
// already existed (a second attempt) it also creates second.txt.
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const skip = new Set(['.git', 'node_modules']);
const walk = (dir, base = '') =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (skip.has(e.name) ? [] : walk(join(dir, e.name), `${base}${e.name}/`)) : [`${base}${e.name}`]));
console.log(JSON.stringify({ files: walk('.').sort() }));
// A read-only role (ERA_READ_ONLY=1) must not write; without an OS sandbox nothing else would stop this fixture from doing so.
if (process.env.ERA_READ_ONLY === '1') process.exit(0);
const had = existsSync('candidate.txt');
writeFileSync('candidate.txt', 'new');
if (had) writeFileSync('second.txt', 'again');
