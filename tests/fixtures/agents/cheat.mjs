// MOCK CODING AGENT (test fixture). A scripted stand-in for a real coding agent, so that Project Lab workflows can be
// tested deterministically without model calls. It is NOT an AI and its results are not evidence of any model capability.
// Fixes the bug and deletes the existing tests (so nothing "fails").
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
const f = 'src/cart.js';
writeFileSync(f, readFileSync(f, 'utf8').replace('sum + item.price,', 'sum + item.price * (item.quantity ?? 1),'));
rmSync('tests/cart.test.js');
