// Visual verification for screenshot rebuilds: renders the generated site in a locked-down Electron page and scores it
// against the reference screenshot (apps/studio/electron/visual-compare.cjs). The renderer process runs under ERA's
// sandbox profile (no network, writes only to its output directory). Chromium's own sandbox cannot be nested inside
// that profile, so it is disabled there; ERA's profile is what confines the process.
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProcess } from '../core/process.js';
import { removeTree } from '../core/util.js';
import { wrapCandidate } from '../safety/candidate-sandbox.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEFAULT_VISUAL = Object.freeze({ threshold: 0.75, entry: 'index.html', maxAssetSimilarity: 0.97, maxImageCoverage: 0.7 });

// Where is an Electron to render with? ERA Studio's own shell, or the one installed in apps/studio.
export function findRenderer(env = process.env) {
  if (env.ERA_RENDERER_DISABLE === '1') return null; // lets tests (and users) exercise the "no renderer" path
  if (env.ERA_RENDERER_BIN && existsSync(env.ERA_RENDERER_BIN)) return { command: env.ERA_RENDERER_BIN, appArgs: env.ERA_RENDERER_APP ? [env.ERA_RENDERER_APP] : [], source: 'ERA Studio shell' };
  const studio = join(ROOT, 'apps', 'studio');
  const pathTxt = join(studio, 'node_modules', 'electron', 'path.txt');
  if (existsSync(pathTxt)) {
    const bin = join(studio, 'node_modules', 'electron', 'dist', readFileSync(pathTxt, 'utf8').trim());
    if (existsSync(bin)) return { command: bin, appArgs: [studio], source: 'apps/studio/node_modules/electron' };
  }
  return null;
}

// External resources a page would load over the network. Plain links (<a href>) are fine: they are never fetched.
const EXTERNAL = [
  /<(?:script|img|iframe|source|video|audio|embed)\b[^>]*\bsrc\s*=\s*["']?\s*(?:https?:)?\/\//i,
  /<link\b[^>]*\bhref\s*=\s*["']?\s*(?:https?:)?\/\/[^>]*\brel\s*=\s*["']?(?:stylesheet|icon|preload|preconnect|prefetch)/i,
  /<link\b[^>]*\brel\s*=\s*["']?(?:stylesheet|icon|preload|preconnect|prefetch)[^>]*\bhref\s*=\s*["']?\s*(?:https?:)?\/\//i,
  /url\(\s*["']?\s*(?:https?:)?\/\//i,
  /@import\s+(?:url\()?\s*["']?\s*(?:https?:)?\/\//i,
];
const TEXT_FILE = /\.(html?|css|js|mjs|svg)$/i;

export function externalResourceFindings(dir, limit = 8) {
  const found = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isSymbolicLink() || ['.git', 'node_modules'].includes(e.name)) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (TEXT_FILE.test(e.name) && found.length < limit) {
        const text = readFileSync(p, 'utf8');
        if (EXTERNAL.some((re) => re.test(text))) found.push(p.slice(dir.length + 1));
      }
    }
  };
  walk(dir);
  return found;
}

export async function renderAndCompare({ renderer, htmlPath, referencePath, outDir, assetsDir, width = null, height = null, timeoutMs = 120_000, isolation, denyRead = [] }) {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'era-render-')));
  try {
    const args = [...renderer.appArgs, ...(isolation?.mode === 'sandbox' ? ['--no-sandbox'] : []), '--era-visual-compare', '--html', htmlPath, '--reference', referencePath, '--out', outDir, '--timeout', String(Math.max(10_000, timeoutMs - 5000)), ...(assetsDir ? ['--assets', assetsDir] : []), ...(width ? ['--width', String(width)] : []), ...(height ? ['--height', String(height)] : [])];
    const w = wrapCandidate(isolation, renderer.command, args, { writable: [outDir], readable: [dirname(htmlPath), dirname(referencePath), assetsDir].filter(Boolean), tmp, denyRead, env: { PATH: process.env.PATH, HOME: tmp, LANG: 'en_US.UTF-8' }, network: false });
    const r = await runProcess(w.command, w.args, { env: w.env, timeoutMs, watchdog: true });
    const file = join(outDir, 'result.json');
    if (existsSync(file)) {
      try {
        return JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        // fall through to the generic failure below
      }
    }
    return { ok: false, error: `the renderer produced no result (exit ${r.exitCode}${r.timedOut ? ', timed out' : ''}${r.signal ? `, ${r.signal}` : ''}): ${r.stderr.split('\n').filter((l) => l && !/sandbox_extension|console-message/.test(l)).slice(-2).join(' ').slice(0, 300)}` };
  } finally {
    removeTree(tmp);
  }
}

// What the score means, in words the implementing agent can act on.
export function visualHints(m) {
  const hints = [];
  if (m.edges < 0.6) hints.push('the structure of edges and text blocks differs: check section order, sizes, alignment and spacing');
  if (m.layout < 0.8) hints.push('the arrangement of light and dark regions differs: check backgrounds, section heights and column layout');
  if (m.color < 0.7) hints.push('the colors differ: match the background and accent colors shown in the screenshot');
  if (m.luminance < 0.7) hints.push('overall brightness differs: check the page background and text/background contrast');
  return hints;
}
