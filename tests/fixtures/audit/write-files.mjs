// TEST FIXTURE for tests/audit-remediation.test.js. Not a coding agent and not part of ERA.
// Usage: node write-files.mjs [--when=FILE] name=content [name=content ...]
// Writes the files (creating directories) unless --when=FILE is given and FILE does not exist in the current directory.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const args = process.argv.slice(2);
const when = args.find((a) => a.startsWith('--when='))?.slice('--when='.length);
if (when && !existsSync(when)) process.exit(0);
for (const a of args.filter((x) => !x.startsWith('--'))) {
  const i = a.indexOf('=');
  const name = a.slice(0, i);
  mkdirSync(dirname(name) || '.', { recursive: true });
  writeFileSync(name, a.slice(i + 1));
}
