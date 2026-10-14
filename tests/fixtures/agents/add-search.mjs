// MOCK CODING AGENT (test fixture). A scripted stand-in for a real coding agent, so that Project Lab workflows can be
// tested deterministically without model calls. It is NOT an AI and its results are not evidence of any model capability.
import { readFileSync, writeFileSync } from 'node:fs';
const f = 'src/catalog.js';
let s = readFileSync(f, 'utf8');
s = s.replace('module.exports = { list };', `function search(query) {
  const q = String(query).toLowerCase();
  return list().filter((p) => p.name.toLowerCase().includes(q) || p.tags.some((t) => t.toLowerCase().includes(q)));
}

module.exports = { list, search };`);
writeFileSync(f, s);
writeFileSync('tests/search.test.js', `const { test } = require('node:test');
const assert = require('node:assert/strict');
const { search } = require('../src/catalog.js');

test('search finds by name', () => assert.equal(search('lamp').length, 1));
`);
