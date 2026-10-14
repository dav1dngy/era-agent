// MOCK CODING AGENT (test fixture) for screenshot-to-website rebuilds. A script, NOT AI: it proves ERA hands the
// reference images to the agent (ERA_REFERENCE_IMAGES) and that ERA's verification accepts/rejects pages correctly.
// argv: <mode> <fixtureRoot>   modes: faithful | wrong | blank | embed | external | retry | blind
import { copyFileSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [mode, fixtures] = process.argv.slice(2);
const images = JSON.parse(process.env.ERA_REFERENCE_IMAGES ?? '[]');
const prompt = readFileSync(process.env.ERA_INSTRUCTIONS_FILE, 'utf8');
const page = (name) => cpSync(join(fixtures, name, 'index.html'), 'index.html');

if (mode === 'blind') {
  // Proves the images really arrive: read the first one and report its facts on stdout.
  const bytes = readFileSync(images[0].path);
  console.log(JSON.stringify({ saw: images.map((i) => `${i.name} ${i.width}x${i.height} ${i.mime}`), bytes: bytes.length, leaked_metadata: bytes.includes('SECRET-GPS'), original_name_visible: images.some((i) => /Berlin/.test(i.path)) }));
  page('page-a-variant');
} else if (mode === 'faithful') page('page-a-variant');
else if (mode === 'wrong') page('page-b');
else if (mode === 'blank') page('blank');
else if (mode === 'embed') {
  copyFileSync(images[0].path, 'shot.png');
  writeFileSync('index.html', '<!doctype html><html><head><meta charset="utf-8"><title>x</title><style>body{margin:0}img{width:100%;display:block}</style></head><body><p>Northwind Coffee</p><img src="shot.png" alt="Northwind Coffee"></body></html>');
} else if (mode === 'external') {
  page('page-a-variant');
  writeFileSync('index.html', readFileSync('index.html', 'utf8').replace('</head>', '<script src="https://cdn.example.com/lib.js"></script></head>'));
} else if (mode === 'retry') {
  // First attempt is wrong; the second only succeeds if ERA's feedback (the score and hints) reached the prompt.
  if (/ATTEMPT 2/.test(prompt) && /not similar enough to the screenshot: score/.test(prompt)) page('page-a-variant');
  else page('blank');
} else {
  console.error(`unknown mode ${mode}`);
  process.exit(2);
}
