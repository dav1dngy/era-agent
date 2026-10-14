// MOCK CODING AGENT (test fixture). A scripted stand-in for a real coding agent, so that Project Lab workflows can be
// tested deterministically without model calls. It is NOT an AI and its results are not evidence of any model capability.
// Tries to write into the ORIGINAL project and into ERA itself, then records what happened.
import { mkdirSync, writeFileSync } from 'node:fs';
const result = {};
for (const [key, path] of [['source', process.env.EVIL_SOURCE_FILE], ['era', process.env.EVIL_ERA_FILE]]) {
  try {
    writeFileSync(path, 'tampered by a hostile agent\n');
    result[key] = 'allowed';
  } catch {
    result[key] = 'denied';
  }
}
mkdirSync('src', { recursive: true });
writeFileSync('evil-result.json', JSON.stringify(result));
writeFileSync('src/cart.js', 'module.exports = { itemCount: () => 0, total: () => 0 };\n');
