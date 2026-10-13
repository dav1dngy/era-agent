// Ground-truth scoring (protected path). Only fact categories present in the
// ground truth are scored, so adding new fact categories never changes scores
// of existing datasets.
const categoryOf = (fact) => fact.slice(0, fact.indexOf(':'));

function prf(tp, predicted, expected) {
  const precision = predicted === 0 ? (expected === 0 ? 1 : 0) : tp / predicted;
  const recall = expected === 0 ? 1 : tp / expected;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

export function scoreFacts(predicted, truth) {
  const truthSet = new Set(truth);
  const categories = [...new Set(truth.map(categoryOf))].sort();
  const scoped = [...new Set(predicted)].filter((f) => categories.includes(categoryOf(f)));
  const tp = scoped.filter((f) => truthSet.has(f));
  const perCategory = {};
  for (const c of categories) {
    const p = scoped.filter((f) => categoryOf(f) === c);
    const t = truth.filter((f) => categoryOf(f) === c);
    perCategory[c] = prf(p.filter((f) => truthSet.has(f)).length, p.length, t.length);
  }
  return {
    ...prf(tp.length, scoped.length, truthSet.size),
    per_category: perCategory,
    missing: truth.filter((f) => !scoped.includes(f)),
    unexpected: scoped.filter((f) => !truthSet.has(f)),
  };
}
