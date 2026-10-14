// MOCK CODING AGENT (test fixture). A scripted stand-in for a real coding agent, so that Project Lab workflows can be
// tested deterministically without model calls. It is NOT an AI and its results are not evidence of any model capability.
// Implements the specified greeting/checksum behavior from SPEC.md in the working copy (independent code).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const spec = readFileSync('SPEC.md', 'utf8');
if (!spec.includes('Required behavior')) process.exit(5);
writeFileSync('package.json', JSON.stringify({ name: 'greeter', version: '1.0.0', private: true, scripts: { test: 'node --test tests/*.test.js' } }, null, 2));
writeFileSync('greet.js', `'use strict';
// djb2-style checksum, 32-bit unsigned.
function checksum(text) {
  let h = 5381;
  for (const byte of Buffer.from(text, 'utf8')) h = (Math.imul(h, 33) + byte) >>> 0;
  return h;
}
function greet(name) {
  return { line: \`Hello, \${name}! checksum=\${checksum(name)}\\n\`, code: Buffer.byteLength(name) > 64 ? 1 : 0 };
}
if (require.main === module) {
  const name = process.argv[2] ?? 'ERA';
  const { line, code } = greet(name);
  process.stdout.write(line);
  process.exitCode = code;
}
module.exports = { checksum, greet };
`);
mkdirSync('tests', { recursive: true });
writeFileSync('tests/greet.test.js', `const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checksum, greet } = require('../greet.js');
test('checksum of the empty string is the seed', () => assert.equal(checksum(''), 5381));
test('greet reports a long name with a non-zero code', () => assert.equal(greet('x'.repeat(65)).code, 1));
`);
