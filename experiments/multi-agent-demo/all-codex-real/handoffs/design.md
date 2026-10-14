_Produced by the architecture agent (codex). Advisory: the task and the acceptance commands decide the outcome._

**Summary:** Add and export search(query) with case-insensitive name and tag matching, preserving catalog order. Existing unit tests pass; all three acceptance tests currently fail because search is missing.

### Approach
Treat query as a string and normalize it once with toLowerCase(). Match a product when its lowercased name or any lowercased tag includes the normalized query. Use literal substring matching, without trimming or regular expressions. An empty query naturally matches every product.

### Affected components
Add search to src/catalog.js and its CommonJS exports, preserving list(). Add tests/search.test.js using node:test and node:assert/strict.

### Data and flow
Filter the products returned by list(). This preserves catalog order, returns each matching product once, and follows the existing shallow-copy convention. No catalog mutation, sorting, new dependencies, or data schema changes are needed.

### Files to touch
- modify `src/catalog.js` — Implement search(query) and export it alongside list.
- create `tests/search.test.js` — Cover search behavior and compatibility with the existing catalog API.

### Steps
- Add search(query) using normalized substring matching against each product name and its tags.
- Export search alongside the existing list function.
- Add unit tests for mixed-case names and tags, partial matches, catalog order, unmatched queries, empty queries, duplicate prevention, and shallow-copy behavior.
- Run node --test tests/*.test.js and node --test acceptance/search.test.js.

### Risks
- Partial tag matching and empty-query behavior are unspecified; this design consistently applies substring matching to both names and tags, with an empty query returning all products.
- Non-string inputs are outside the requested contract; do not introduce coercion or additional validation.
- Returned products are shallow copies, matching list(); nested tag arrays remain shared.

### Additional acceptance criteria proposed (text only; ERA does not execute them)
- search is available from require('../src/catalog.js').
- search('mUg') returns products with IDs [1, 2] in that order.
- search('OFFICE') returns the product with ID 3.
- search('kit') returns products with IDs [1, 2] in catalog order.
- search('zzz') returns an empty array.
- search('') returns all three products in catalog order.
- search('e') returns IDs [1, 2, 3] once each despite matches across multiple fields.
- Changing a returned product's name does not change subsequent catalog results.
- node --test tests/*.test.js exits successfully.
- node --test acceptance/search.test.js exits successfully.

### Out of scope
- Changes to acceptance tests or catalog fixtures.
- Fuzzy matching, relevance ranking, tokenization, or locale-specific normalization.
- Deep-copying products or changing list behavior.
- New dependencies, indexing, or persistence.