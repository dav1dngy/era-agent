const { test } = require('node:test');
const assert = require('node:assert/strict');
const { list } = require('../src/catalog.js');

test('list returns every product', () => {
  assert.equal(list().length, 3);
});

test('list returns copies', () => {
  list()[0].name = 'changed';
  assert.equal(list()[0].name, 'Red Mug');
});
