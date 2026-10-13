// Product catalog (fixture project: the search function is missing).
const PRODUCTS = [
  { id: 1, name: 'Red Mug', tags: ['kitchen', 'ceramic'] },
  { id: 2, name: 'Blue Mug', tags: ['kitchen'] },
  { id: 3, name: 'Desk Lamp', tags: ['office'] },
];

function list() {
  return PRODUCTS.map((p) => ({ ...p }));
}

module.exports = { list };
