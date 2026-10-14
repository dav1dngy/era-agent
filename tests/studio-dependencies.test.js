// Records WHY the two low-severity Monaco/DOMPurify advisories (GHSA-p98j-92pf-mc4p, GHSA-6688-9rhm-gjv2) are not
// reachable in ERA Studio, and fails if that analysis stops being true (for example after a Monaco upgrade).
//   * Both advisories need DOMPurify's IN_PLACE mode. Monaco's prebuilt bundle contains DOMPurify's own code but no caller that
//     passes IN_PLACE, so the vulnerable path is not taken by Monaco.
//   * Even if markup got through, Studio's Content-Security-Policy has no 'unsafe-inline' for scripts, so inline event
//     handlers (the XSS vector described) do not run.
// This is an analysis of the shipped bundle, not a fix: the vulnerable DOMPurify version is bundled inside Monaco and cannot
// be replaced by an npm override. Upgrade Monaco when a release bundles a patched DOMPurify.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './helpers.js';

const MONACO = join(ROOT, 'apps', 'studio', 'node_modules', 'monaco-editor', 'min', 'vs');
const present = existsSync(MONACO);
// Like every test that starts a server: skipped inside the Improvement Lab's sandboxed candidate evaluations (no network there).
const NESTED = (process.env.ERA_E2E_NESTED || process.env.ERA_SKIP_E2E) && 'nested evaluation or ERA_SKIP_E2E';

test('Monaco never opts into DOMPurify IN_PLACE mode (the precondition of both advisories)', { skip: !present && 'monaco-editor is not installed' }, () => {
  const files = readdirSync(MONACO, { recursive: true }).filter((f) => String(f).endsWith('.js'));
  const bundled = files.filter((f) => readFileSync(join(MONACO, String(f)), 'utf8').includes('afterSanitizeAttributes'));
  assert.ok(bundled.length >= 1, 'the bundle that contains DOMPurify was found');
  for (const f of bundled) {
    const text = readFileSync(join(MONACO, String(f)), 'utf8');
    const uses = text.match(/IN_PLACE/g) ?? [];
    // exactly one occurrence: DOMPurify's own config reader. A caller passing IN_PLACE would add another.
    assert.equal(uses.length, 1, `${f}: IN_PLACE appears ${uses.length} times; re-evaluate the advisories before shipping this Monaco version`);
    assert.match(text, /\.version="3\.4\.\d+"/, 'the bundled DOMPurify version is known');
  }
});

test('Studio\'s Content-Security-Policy forbids inline script (event handlers) and remote script', { skip: NESTED || false }, async () => {
  const { createControlPlane } = await import('../src/control_plane/server.js');
  const { loadConfig } = await import('../src/core/config.js');
  const { tempDir } = await import('./helpers.js');
  const cwd = tempDir();
  const config = loadConfig(cwd, { ERA_STATE_DIR: join(cwd, 'state') });
  const cp = await createControlPlane({ config, rea: { status: async () => ({ available: false }) }, version: 'test' });
  await cp.start();
  try {
    const res = await fetch(`${cp.url}/`);
    const csp = res.headers.get('content-security-policy');
    const script = /script-src ([^;]+)/.exec(csp)[1];
    assert.ok(!script.includes("'unsafe-inline'") && !script.includes("'unsafe-eval'"), script);
    assert.ok(/^'self'( 'sha256-[A-Za-z0-9+/=]+')*$/.test(script), `script sources are only self and the import-map hash: ${script}`);
    assert.match(csp, /connect-src 'self'/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /default-src 'self'/);
  } finally {
    await cp.stop();
  }
});

// The exception is tied to the exact artifact. A different Monaco or bundled DOMPurify means the analysis above must be redone;
// a patched DOMPurify means the exception must be removed. (Audit L03, docs/ERA_V020_REMEDIATION.md.)
const EXCEPTION = { monaco: '0.57.0', dompurify: '3.4.15', patched: [3, 4, 16] };
const atLeast = (version, min) => { const v = version.split('.').map(Number); for (let i = 0; i < 3; i++) { if (v[i] !== min[i]) return v[i] > min[i]; } return true; };

test('the DOMPurify advisory exception matches the Monaco bundle that ships, and ends when a patched one does', { skip: !present && 'monaco-editor is not installed' }, () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'apps', 'studio', 'node_modules', 'monaco-editor', 'package.json'), 'utf8'));
  assert.equal(pkg.version, EXCEPTION.monaco, `Monaco is ${pkg.version}, the recorded exception covers ${EXCEPTION.monaco}: re-run the reachability analysis (this file and the "hover Markdown" desktop scenario) and update or remove the exception`);
  const files = readdirSync(MONACO, { recursive: true }).filter((f) => String(f).endsWith('.js') && readFileSync(join(MONACO, String(f)), 'utf8').includes('afterSanitizeAttributes'));
  assert.ok(files.length >= 1);
  for (const f of files) {
    const bundled = /\.version="(3\.\d+\.\d+)"/.exec(readFileSync(join(MONACO, String(f)), 'utf8'))?.[1];
    assert.ok(bundled, `${f}: the bundled DOMPurify version could not be read`);
    assert.equal(atLeast(bundled, EXCEPTION.patched), false, `${f} bundles DOMPurify ${bundled}, which contains the fix: remove the exception and the advisory notes`);
    assert.equal(bundled, EXCEPTION.dompurify, `${f} bundles DOMPurify ${bundled}, the exception covers ${EXCEPTION.dompurify}`);
  }
  const lock = JSON.parse(readFileSync(join(ROOT, 'apps', 'studio', 'package-lock.json'), 'utf8'));
  assert.equal(lock.packages['node_modules/monaco-editor'].version, EXCEPTION.monaco);
  assert.equal(lock.packages['node_modules/dompurify'].version, EXCEPTION.dompurify);
});
