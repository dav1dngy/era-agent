// MOCK CODING AGENT (test fixture). A scripted stand-in for a real coding agent, so that Project Lab workflows can be
// tested deterministically without model calls. It is NOT an AI and its results are not evidence of any model capability.
// Fixes the reported bug but breaks existing behavior (itemCount ignores quantity).
import { readFileSync, writeFileSync } from 'node:fs';
const f = 'src/cart.js';
const s = readFileSync(f, 'utf8').replace('sum + item.price,', 'sum + item.price * (item.quantity ?? 1),').replace('sum + (item.quantity ?? 1)', 'sum + 1');
writeFileSync(f, s);
