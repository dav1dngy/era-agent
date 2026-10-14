// Requirement: search(query) finds products by name or tag, case-insensitively.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../src/catalog.js');

test('search by name is case-insensitive', () => {
  assert.deepEqual(catalog.search('mug').map((p) => p.id), [1, 2]);
});

test('search matches tags', () => {
  assert.deepEqual(catalog.search('OFFICE').map((p) => p.id), [3]);
});

test('search returns an empty list when nothing matches', () => {
  assert.deepEqual(catalog.search('zzz'), []);
});
