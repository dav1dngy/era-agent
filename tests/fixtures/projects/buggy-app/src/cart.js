// Shopping cart helpers (fixture project with a known, reproducible bug).
function itemCount(items) {
  return items.reduce((sum, item) => sum + (item.quantity ?? 1), 0);
}

// BUG: the quantity of each line item is ignored.
function total(items) {
  return items.reduce((sum, item) => sum + item.price, 0);
}

module.exports = { itemCount, total };
