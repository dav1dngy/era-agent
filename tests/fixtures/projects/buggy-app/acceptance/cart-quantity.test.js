// Reproduces the reported bug: the total must account for quantity.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { total } = require('../src/cart.js');

test('total multiplies price by quantity', () => {
  assert.equal(total([{ price: 5, quantity: 3 }, { price: 2 }]), 17);
});
