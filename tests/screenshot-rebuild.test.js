// Screenshot-to-website rebuild tests.
//
// REAL   image validation/metadata stripping, the Electron renderer (apps/studio, run under ERA's sandbox profile on macOS),
//        the visual scoring, copy/external-resource detection, git/patches, approval, the Project Lab workflow, the CLI.
// MOCK   the coding agents (tests/fixtures/agents/screenshot-agent.mjs): scripts, NOT AI. They prove the plumbing
//        (images reach the agent, bad pages are rejected, feedback drives a second attempt), not model quality.
//        Real provider evidence is in docs/provider-validation.md (scripts/validate-screenshot-rebuild.mjs).
// The renderer tests skip (with the reason) when no Electron is installed (npm install in apps/studio).
import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../src/core/config.js';
import { ReaClient } from '../src/rea_integration/rea-client.js';
import { createProjectLab } from '../src/project_lab/lab.js';
import { assertRebuildCriteria } from '../src/project_lab/rebuild.js';
import { findRenderer, renderAndCompare } from '../src/project_lab/visual.js';
import { candidateIsolation } from '../src/safety/candidate-sandbox.js';
import { sandboxAvailable } from '../src/safety/sandbox.js';
import { chunk, makePng } from './image-fixtures.js';
import { FIXTURES, tempDir } from './helpers.js';

const NESTED = (process.env.ERA_E2E_NESTED || process.env.ERA_SKIP_E2E) && 'nested evaluation or ERA_SKIP_E2E';
delete process.env.CI;
delete process.env.GITHUB_ACTIONS;
const RENDERER = findRenderer();
const SANDBOX = sandboxAvailable();
const test = (name, opts, fn) => nodeTest(name, { ...(typeof opts === 'function' ? {} : opts), skip: NESTED || (typeof opts === 'object' && opts.needsRenderer && !RENDERER && 'no Electron renderer installed (npm install in apps/studio)') || false }, typeof opts === 'function' ? opts : fn);
const needs = { needsRenderer: true };

const AGENT = join(FIXTURES, 'agents', 'screenshot-agent.mjs');
const SITES = join(FIXTURES, 'screenshot');
const FAKE_ENGINE = join(FIXTURES, 'fake-rea-engine.mjs');
const agent = (mode, caps = { images: 'env' }) => ({ command: `node ${AGENT} ${mode} ${SITES}`, capabilities: caps });

function newLab(extra = {}) {
  const cwd = tempDir();
  const config = loadConfig(cwd, { ERA_STATE_DIR: join(cwd, 'state') });
  config.projectLab = { ...config.projectLab, budget: { ...config.projectLab.budget, allowUnmeteredAgents: true }, customAgents: { faithful: agent('faithful'), wrong: agent('wrong'), blank: agent('blank'), embed: agent('embed'), external: agent('external'), retry: agent('retry'), blind: agent('blind'), 'no-eyes': agent('faithful', { images: 'none' }) }, ...extra };
  return createProjectLab({ config, rea: new ReaClient({ command: FAKE_ENGINE, stateDir: config.stateDirAbs, measureResources: false }) });
}

// A real screenshot: the real renderer renders the reference page; its capture is the "screenshot".
let referenceShot = null;
async function reference() {
  if (referenceShot) return referenceShot;
  const dir = tempDir();
  const dummy = join(dir, 'dummy.png');
  writeFileSync(dummy, makePng(1280, 720));
  const iso = SANDBOX ? candidateIsolation() : { mode: 'trusted', mechanism: 'none' };
  const r = await renderAndCompare({ renderer: RENDERER, htmlPath: join(SITES, 'page-a', 'index.html'), referencePath: dummy, outDir: join(dir, 'out'), width: 1280, height: 720, isolation: iso });
  assert.equal(r.ok, true, r.error);
  referenceShot = join(dir, 'out', 'rendered.png');
  return referenceShot;
}

const project = (ref, over = {}) => ({ id: 'site', mode: 'rebuild', reference: ref, destination: join(tempDir(), 'new-site'), task: 'Recreate the Northwind Coffee landing page from the screenshot as a static website', authorization: 'The screenshot is of a page I designed and own.', team: { roles: { implementer: 'custom:faithful' } }, trust_project: !SANDBOX, ...over });

test('a faithful page passes: the real renderer scores it against the screenshot and approval writes the new project', needs, async () => {
  const lab = newLab();
  lab.create(project(await reference()));
  const { run } = await lab.rebuild('site');
  assert.equal(run.status, 'awaiting-approval', run.error ?? JSON.stringify(run.results.finalize?.reasons));
  const fin = run.results.finalize;
  assert.equal(fin.pass, true);
  assert.ok(fin.visual.score >= 0.75 && fin.visual.score < 1, `score ${fin.visual.score}`);
  assert.equal(fin.visual.passed, true);
  assert.ok(existsSync(join(lab.store.runDir('site', run.run_id), fin.visual.rendered)), 'the rendering is stored for review');
  assert.ok(existsSync(join(lab.store.runDir('site', run.run_id), fin.visual.reference)));
  assert.equal(run.results.evidence.available, false);
  assert.match(run.results.evidence.reason, /REA is not applicable to screenshots/);
  assert.equal(fin.screenshot.images[0].width > 0, true);
  const dest = lab.get('site').destination;
  assert.equal(existsSync(dest), false, 'nothing is written before approval');
  await lab.approve('site', { by: 'test' });
  assert.ok(existsSync(join(dest, 'index.html')));
  assert.ok(!existsSync(join(dest, '.git')));
});

test('the agent really receives the image (metadata removed, neutral name), only through the declared capability', needs, async () => {
  const dir = tempDir();
  mkdirSync(dir, { recursive: true });
  const shot = join(dir, 'Berlin Trip (private).png');
  copyFileSync(await reference(), shot);
  // add an EXIF-style text chunk carrying a secret
  const buf = readFileSync(shot);
  const ihdrEnd = 8 + 8 + 13 + 4;
  writeFileSync(shot, Buffer.concat([buf.subarray(0, ihdrEnd), chunk('tEXt', Buffer.from('GPS\0SECRET-GPS-52.52,13.40')), buf.subarray(ihdrEnd)]));
  assert.ok(readFileSync(shot).includes('SECRET-GPS'));
  const lab = newLab();
  lab.create(project(shot, { team: { roles: { implementer: 'custom:blind' } } }));
  const { run } = await lab.rebuild('site');
  const said = JSON.parse(readFileSync(join(lab.store.runDir('site', run.run_id), 'agent', 'implementer-rebuild-1.txt'), 'utf8').trim().split('\n')[0]);
  assert.equal(said.saw.length, 1);
  assert.match(said.saw[0], /^reference-1\.png \d+x\d+ image\/png$/);
  assert.equal(said.leaked_metadata, false, 'EXIF/text metadata was removed before the agent saw the file');
  assert.equal(said.original_name_visible, false, 'the personal file name was not passed on');
  assert.ok(run.results.reference.images[0].metadata_removed.includes('tEXt'));
  assert.equal(run.results.finalize.screenshot.images[0].metadata_removed_bytes > 0, true);
});

test('an agent that cannot look at images is refused before anything runs', async () => {
  const lab = newLab();
  const shot = join(tempDir(), 's.png');
  writeFileSync(shot, makePng(800, 600));
  lab.create(project(shot, { team: { roles: { implementer: 'custom:no-eyes' } }, commands: { test: ['true'] } }));
  const { run } = await lab.rebuild('site');
  assert.equal(run.status, 'failed');
  assert.match(run.error, /cannot look at images/);
});

for (const [mode, expect] of [['wrong', /not similar enough to the screenshot: score/], ['blank', /not similar enough/], ['embed', /copy of the reference screenshot/], ['external', /load resources over the network/]]) {
  test(`a "${mode}" page is rejected by verification`, needs, async () => {
    const lab = newLab();
    lab.create(project(await reference(), { team: { roles: { implementer: `custom:${mode}` } }, limits: { maxAttempts: 1 } }));
    const { run } = await lab.rebuild('site');
    assert.equal(run.status, 'rejected', run.error);
    assert.match(run.results.finalize.reasons.join(' '), expect);
    assert.equal(existsSync(lab.get('site').destination), false);
    await assert.rejects(lab.approve('site', { by: 'test' }), /no run awaiting approval|did not pass/i);
  });
}

test('a page that passes only by embedding a picture of the screenshot is caught by perceptual copy detection', needs, async () => {
  // Re-encoded copy: same picture, different bytes (hash comparison alone would miss it).
  const lab = newLab({ customAgents: { sneaky: { command: `node -e "const fs=require('fs');const im=JSON.parse(process.env.ERA_REFERENCE_IMAGES)[0];const b=fs.readFileSync(im.path);fs.writeFileSync('picture.png',Buffer.concat([b,Buffer.from('padding')]));fs.writeFileSync('index.html','<html><body style=margin:0><div style=\\"height:720px;background:url(picture.png) 0 0/100% 100%\\"></div></body></html>')"`, capabilities: { images: 'env' } } } });
  lab.create(project(await reference(), { team: { roles: { implementer: 'custom:sneaky' } }, limits: { maxAttempts: 1 } }));
  const { run } = await lab.rebuild('site');
  assert.equal(run.status, 'rejected');
  assert.match(run.results.finalize.reasons.join(' '), /nearly identical to the reference screenshot|single picture covers most of the page/);
});

test('failure feedback (score and hints) drives a second attempt', needs, async () => {
  const lab = newLab();
  lab.create(project(await reference(), { team: { roles: { implementer: 'custom:retry' } }, limits: { maxAttempts: 2 } }));
  const { run } = await lab.rebuild('site');
  assert.equal(run.status, 'awaiting-approval', run.error ?? JSON.stringify(run.results.finalize?.reasons));
  assert.equal(run.attempts.length, 2);
  assert.equal(run.attempts[0].pass, false);
  assert.equal(run.attempts[1].pass, true);
});

test('without a renderer a screenshot rebuild refuses to start unless another acceptance check exists', async () => {
  process.env.ERA_RENDERER_DISABLE = '1';
  try {
    assert.equal(findRenderer(), null);
    const shot = join(tempDir(), 's.png');
    writeFileSync(shot, makePng(800, 600));
    // criteria: pure function
    const base = { acceptance: { behaviors: [], commands: [], criteria: [], visual: null }, commands: { test: [], run: null } };
    assert.throws(() => assertRebuildCriteria(base, { screenshot: true, renderer: null }), /cannot be verified here/);
    assert.doesNotThrow(() => assertRebuildCriteria({ ...base, commands: { test: ['npm test'], run: null } }, { screenshot: true, renderer: null }));
    assert.doesNotThrow(() => assertRebuildCriteria(base, { screenshot: true, renderer: { command: 'x' } }));
    assert.throws(() => assertRebuildCriteria({ ...base, acceptance: { ...base.acceptance, behaviors: [{ name: 'b', capture: 'reference', args: [] }] } }, { screenshot: true, renderer: { command: 'x' } }), /cannot be captured from it/);
    // through the real workflow
    const lab = newLab();
    lab.create(project(shot, { team: { roles: { implementer: 'custom:faithful' } } }));
    const { run } = await lab.rebuild('site');
    assert.equal(run.status, 'failed');
    assert.match(run.error, /cannot be verified here/);
    // with a user-supplied acceptance command the run proceeds, and says plainly that no visual comparison was made
    lab.update('site', { acceptance: { commands: [{ name: 'has-page', command: 'test -f index.html' }] } });
    const ok = await lab.rebuild('site');
    assert.equal(ok.run.status, 'awaiting-approval', ok.run.error ?? JSON.stringify(ok.run.results.finalize?.reasons));
    assert.match(ok.run.results.finalize.warnings.join(' '), /Visual comparison was NOT performed/);
    assert.equal(ok.run.results.finalize.visual, null);
  } finally {
    delete process.env.ERA_RENDERER_DISABLE;
  }
});

test('the renderer blocks network access and file access outside the site', needs, async () => {
  const dir = tempDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), '<!doctype html><html><body><h1>Hello</h1><img src="https://example.com/x.png"><link rel="stylesheet" href="file:///etc/hosts"><script>fetch("http://127.0.0.1:9/ping").catch(()=>{})</script></body></html>');
  const shot = join(dir, 'ref.png');
  writeFileSync(shot, makePng(800, 600));
  const iso = SANDBOX ? candidateIsolation() : { mode: 'trusted', mechanism: 'none' };
  const r = await renderAndCompare({ renderer: RENDERER, htmlPath: join(dir, 'index.html'), referencePath: shot, outDir: join(dir, 'out'), width: 800, height: 600, isolation: iso });
  assert.equal(r.ok, true, r.error);
  const blocked = r.blocked_requests.join(' ');
  assert.match(blocked, /example\.com/);
  assert.match(blocked, /etc\/hosts/);
  assert.match(blocked, /127\.0\.0\.1:9/);
});

test('scores separate identical, faithful, different and blank pages (calibration of the default threshold)', needs, async () => {
  const ref = await reference();
  const iso = SANDBOX ? candidateIsolation() : { mode: 'trusted', mechanism: 'none' };
  const score = async (site) => (await renderAndCompare({ renderer: RENDERER, htmlPath: join(SITES, site, 'index.html'), referencePath: ref, outDir: join(tempDir(), 'o'), width: 1280, height: 720, isolation: iso })).score;
  const [same, variant, other, blank] = [await score('page-a'), await score('page-a-variant'), await score('page-b'), await score('blank')];
  assert.ok(same > 0.99, `identical ${same}`);
  assert.ok(variant > 0.8 && variant < same, `faithful ${variant}`);
  assert.ok(other < 0.3, `different ${other}`);
  assert.ok(blank < 0.3, `blank ${blank}`);
});
