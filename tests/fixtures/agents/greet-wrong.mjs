// MOCK CODING AGENT (test fixture). A scripted stand-in for a real coding agent, so that Project Lab workflows can be
// tested deterministically without model calls. It is NOT an AI and its results are not evidence of any model capability.
// An implementation that does NOT match the specified behavior (wrong checksum seed).
import { writeFileSync } from 'node:fs';
writeFileSync('package.json', '{"name":"wrong","private":true}');
writeFileSync('greet.js', `const name = process.argv[2] ?? 'ERA';
let h = 5382;
for (const b of Buffer.from(name)) h = (Math.imul(h, 33) + b) >>> 0;
process.stdout.write(\`Hello, \${name}! checksum=\${h}\\n\`);
process.exitCode = Buffer.byteLength(name) > 64 ? 1 : 0;
`);
