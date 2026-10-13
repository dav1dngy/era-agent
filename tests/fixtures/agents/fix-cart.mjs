// MOCK CODING AGENT (test fixture). A scripted stand-in for a real coding agent, so that Project Lab workflows can be
// tested deterministically without model calls. It is NOT an AI and its results are not evidence of any model capability.
import { readFileSync, writeFileSync } from 'node:fs';
const f = 'src/cart.js';
const s = readFileSync(f, 'utf8').replace('sum + item.price,', 'sum + item.price * (item.quantity ?? 1),').replace('// BUG: the quantity of each line item is ignored.\n', '');
writeFileSync(f, s);
