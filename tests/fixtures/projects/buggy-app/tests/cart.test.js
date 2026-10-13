const { test } = require('node:test');
const assert = require('node:assert/strict');
const { itemCount, total } = require('../src/cart.js');

test('itemCount sums quantities', () => {
  assert.equal(itemCount([{ price: 2, quantity: 2 }, { price: 3 }]), 3);
});

test('total of single-quantity items', () => {
  assert.equal(total([{ price: 2 }, { price: 3 }]), 5);
});

test('total of an empty cart is zero', () => {
  assert.equal(total([]), 0);
});
