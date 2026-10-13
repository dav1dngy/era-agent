// MOCK CODING AGENT (test fixture). A scripted stand-in for a real coding agent, so that Project Lab workflows can be
// tested deterministically without model calls. It is NOT an AI and its results are not evidence of any model capability.
// First attempt: a useless change. A retry (its prompt says "ATTEMPT 2") carries the failure feedback: then the real fix.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
const prompt = readFileSync(process.env.ERA_INSTRUCTIONS_FILE, 'utf8');
if (!prompt.includes('ATTEMPT 2')) {
  appendFileSync('src/cart.js', '\n// attempted fix\n');
} else {
  if (!prompt.includes('Acceptance command failed')) {
    console.error('retry prompt lacks the failure feedback');
    process.exit(4);
  }
  const f = 'src/cart.js';
  writeFileSync(f, readFileSync(f, 'utf8').replace('sum + item.price,', 'sum + item.price * (item.quantity ?? 1),'));
}
