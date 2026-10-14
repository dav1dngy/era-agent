// MOCK CODING AGENT (test fixture). A scripted stand-in for a real coding agent, so that Project Lab workflows can be
// tested deterministically without model calls. It is NOT an AI and its results are not evidence of any model capability.
// First call: records its pid in the private temp directory (TMPDIR, which survives a resume) and sleeps, so a test can
// kill or cancel the run. Later calls: the real fix.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const marker = join(process.env.TMPDIR, 'slow-marker');
if (!existsSync(marker)) {
  writeFileSync(marker, String(process.pid));
  await new Promise((r) => setTimeout(r, 120_000));
} else {
  const f = 'src/cart.js';
  writeFileSync(f, readFileSync(f, 'utf8').replace('sum + item.price,', 'sum + item.price * (item.quantity ?? 1),'));
}
