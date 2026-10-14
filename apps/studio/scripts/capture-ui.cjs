'use strict';
// Runs inside the Electron app (see main.cjs --capture-ui): creates real states through the control plane, visits each view and saves a
// screenshot. Fixed window size and device scale make every image the same resolution.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { readFileSync, writeFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const WIDTH = 1440;
const HEIGHT = 900;

module.exports = async function captureUI({ win, controlPlane, repo }) {
  const out = process.env.ERA_STUDIO_CAPTURE_OUT;
  const demo = process.env.ERA_STUDIO_CAPTURE_DEMO;
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const lit = (v) => `JSON.parse(new TextDecoder().decode(Uint8Array.from(atob('${Buffer.from(JSON.stringify(v), 'utf8').toString('base64')}'), (c) => c.charCodeAt(0))))`;
  const api = async (method, url, body) => {
    const r = await fetch(new URL(url, controlPlane.url).href, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${controlPlane.token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await r.json();
    if (!r.ok) throw Error(`${r.status}: ${JSON.stringify(data)}`);
    return data;
  };
  const until = async (predicate, label, ms = 60_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await predicate()) return; await delay(120); }
    throw Error(`Timed out: ${label}`);
  };
  const dom = (expr, label) => until(() => js(expr), label);
  const go = async (hash, expr) => { await js(`location.hash = ${lit(hash)}`); await dom(expr, hash); };
  const click = async (label) => { await dom(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === ${lit(label)} && !b.disabled)`, label); await js(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${lit(label)} && !b.disabled).click()`); };
  const jobDone = async (kind) => {
    let job;
    await until(async () => { job = (await api('GET', '/api/jobs')).jobs.find((j) => j.kind === kind); return job && ['succeeded', 'failed', 'cancelled'].includes(job.status); }, kind, 180_000);
    assert.equal(job.status, 'succeeded', job.error);
    return job;
  };

  // Text that must never appear in a published screenshot.
  const user = os.userInfo().username;
  const forbidden = [
    [os.homedir(), 'the home directory'],
    ...(user && user.length > 2 ? [[new RegExp(`\\b${user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'), 'the user name']] : []),
    [/\/Users\/|\/home\//, 'a user directory path'],
    [/\b(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|Bearer\s+[A-Za-z0-9._-]{16,})/, 'a credential'],
    [controlPlane.token, 'the access token'],
  ];
  const captured = [];
  let scale = null;
  const shoot = async (file, { title, alt, route, mode, note = null, expect }) => {
    await dom(expect, `${file}: ready`);
    await dom("!document.querySelector('.toast')", `${file}: notifications gone`); // a toast would cover content
    await delay(500);
    const text = await js('document.body.innerText');
    for (const [needle, what] of forbidden) {
      const hit = typeof needle === 'string' ? text.includes(needle) : needle.test(text);
      assert.equal(hit, false, `${file}: the visible text contains ${what}`);
    }
    const image = await win.webContents.capturePage();
    const size = image.getSize();
    // A fixed 1440x900 window at the display's scale factor (2 on a Retina Mac): the same resolution for every image of a run.
    scale ??= size.width / WIDTH;
    assert.deepEqual([size.width, size.height], [WIDTH * scale, HEIGHT * scale], `${file}: unexpected capture size ${size.width}x${size.height}`);
    const png = image.toPNG();
    writeFileSync(path.join(out, file), png);
    captured.push({ file, title, alt, route, mode, width: size.width, height: size.height, bytes: png.length, sha256: createHash('sha256').update(png).digest('hex'), ...(note ? { note } : {}) });
    process.stdout.write(`CAPTURED ${file} (${size.width}x${size.height}, ${Math.round(png.length / 1024)} KB)\n`);
  };

  win.setContentSize(WIDTH, HEIGHT);
  await dom("!!document.querySelector('.shell')", 'application shell');
  await api('PUT', '/api/settings', { appearance: { theme: 'dark' }, mode: 'simple' });
  await dom("document.documentElement.dataset.theme === 'dark'", 'dark theme');
  assert.equal((await api('GET', '/api/overview')).rea.available, true, 'REA must be available for real analyses');

  // Real states: two projects (Modify, Review), a real REA analysis and real project runs; only the coding agent is a scripted stand-in.
  const source = path.join(demo, 'cart');
  await api('POST', '/api/projects', { id: 'cart', mode: 'modify', source, task: 'Fix the cart total to account for quantity', commands: { test: ['node --test tests/*.test.js'] }, acceptance: { commands: [{ name: 'quantity', command: 'node --test acceptance/cart-quantity.test.js', baseline: 'fail' }] }, team: { roles: { implementer: 'custom:fixture' } } });
  await api('POST', '/api/projects', { id: 'catalog', mode: 'review', source: path.join(demo, 'catalog'), task: 'Review the product catalog service', commands: { test: ['node --test tests/*.test.js'] } });
  await api('POST', '/api/projects/cart/ops/modify', {});
  await jobDone('project.modify');
  assert.equal((await api('GET', '/api/projects/cart')).latest_run.status, 'awaiting-approval');
  await api('POST', '/api/projects/catalog/ops/review', {});
  await until(async () => { const p = await api('GET', '/api/projects/catalog'); return p.latest_run && ['complete', 'failed'].includes(p.latest_run.status); }, 'review finished', 180_000);
  // REA analyzes a real JavaScript application: a copy of Studio's own web UI (26 files).
  const started = await api('POST', '/api/analysis', { target: path.join(demo, 'era-studio-web'), no_decompile: true });
  let analysisId;
  await until(async () => { const j = (await api('GET', `/api/jobs/${started.job.id}`)); if (j.status === 'failed') throw Error(j.error); analysisId = j.result?.analysis_id; return j.status === 'succeeded' && analysisId; }, 'analysis finished', 180_000);

  // The Improvement Lab works on a checkout of ERA (here a clone inside the demo workspace) and records real self-analyses.
  await api('PUT', '/api/settings', { workspaces: { improvementCheckout: path.join(demo, 'era-checkout') } });
  const selfJob = await api('POST', '/api/improvement/self-analyze', {});
  await until(async () => { const j = await api('GET', `/api/jobs/${selfJob.job.id}`); if (j.status === 'failed') throw Error(j.error); return j.status === 'succeeded'; }, 'self-analysis finished', 420_000);

  // 1 main workspace (Simple mode)
  await go('#/home', "!!document.querySelector('.dashboard-project-card') && document.body.textContent.includes('Your agents')");
  await shoot('01-main-workspace.png', { title: 'Main workspace', alt: 'ERA Studio main workspace: a task composer, the recent projects, the workspace status (control plane live, REA ready) and the agent list', route: '#/home', mode: 'simple', expect: "!!document.querySelector('.dashboard-project-card')" });
  // 2 project management
  await go('#/projects', "document.querySelectorAll('.project-card').length >= 2");
  await shoot('02-project-management.png', { title: 'Project management', alt: 'Projects page listing a Modify project awaiting approval and a Review project, with counters and search', route: '#/projects', mode: 'simple', expect: "document.querySelectorAll('.project-card').length >= 2" });

  await api('PUT', '/api/settings', { mode: 'advanced' });
  await dom("document.querySelector('.topbar .seg [aria-pressed=\"true\"]')?.textContent === 'Advanced' || !!document.querySelector('.sidebar [aria-label=\"Analysis\"]')", 'advanced mode');
  // 3 reverse-engineering analysis (real REA evidence)
  await go(`#/analysis/${analysisId}`, "document.querySelector('.tabs') && document.body.textContent.includes('succeeded')");
  await click('Structure');
  await shoot('03-reverse-engineering-analysis.png', { title: 'Reverse-engineering analysis', alt: 'Analysis of a JavaScript application with the original REA engine: status, report tabs and the relationship graph drawn from REA evidence', route: `#/analysis/<id>`, mode: 'advanced', note: 'Real REA 6.4.0 run on a JavaScript application (a copy of Studio\'s own web UI; decompilation skipped).', expect: "!!document.querySelector('svg.graph, .empty')" });
  // 4 Project Lab
  await go('#/lab', "document.body.textContent.includes('Project Lab') && document.querySelectorAll('.panel').length >= 3");
  await shoot('04-project-lab.png', { title: 'Project Lab', alt: 'Project Lab overview: Review, Modify and Rebuild with the projects and runs for each mode', route: '#/lab', mode: 'advanced', expect: "document.querySelectorAll('.panel').length >= 3" });
  // 5 multi-agent command center
  await go('#/agents', "document.body.textContent.includes('Simulated')");
  await shoot('05-multi-agent-command-center.png', { title: 'Multi-agent command center', alt: 'Agent command center with the provider list, each provider marked unavailable or simulated, and the role assignment', route: '#/agents', mode: 'advanced', note: 'Providers are shown as the controlled demo workspace configures them: Codex and Claude Code are pointed at commands that do not exist (so they are Unavailable) and a scripted stand-in is marked Simulated.', expect: "document.body.textContent.includes('Unavailable')" });
  // 6 IDE code editor
  await go('#/workbench/cart?file=src%2Fcart.js', "!!document.querySelector('.monaco-editor') && !!document.querySelector('[role=tab][title=\"source:src/cart.js\"]')");
  await shoot('06-ide-code-editor.png', { title: 'IDE: code editor', alt: 'The workbench with the file tree of the original project (read-only) and the Monaco code editor showing a JavaScript file', route: '#/workbench/<project>?file=src/cart.js', mode: 'advanced', expect: "!!document.querySelector('.monaco-editor .view-line')" });
  // 7 diff viewer and approval
  await go('#/projects/cart/review', "!!document.querySelector('.monaco-diff-editor')");
  await dom("window.monaco?.editor.getDiffEditors().some(e => e.getLineChanges()?.length > 0)", 'diff computed');
  await shoot('07-diff-viewer-and-approval.png', { title: 'IDE: diff viewer and approval', alt: 'Changes and approval: a verified one-file diff side by side in Monaco, the test results, and the Approve and Reject buttons', route: '#/projects/<project>/review', mode: 'advanced', note: 'The coding agent that produced this change is a scripted stand-in; the build, tests and verification are real.', expect: "!!document.querySelector('.monaco-diff-editor') && document.body.textContent.includes('Approve')" });
  // 8 improvement lab
  await go('#/improvement', "document.querySelector('h1')?.textContent === 'Improvement Lab'");
  await dom("document.body.textContent.includes('Self-analyses') && !document.body.textContent.includes('No ERA checkout')", 'checkout found');
  await delay(1200);
  await shoot('08-improvement-lab.png', { title: 'Improvement Lab', alt: 'Improvement Lab: the ERA checkout, its version tags, a real self-analysis of ERA by REA, and the controlled experiment cycles', route: '#/improvement', mode: 'advanced', expect: "document.querySelector('h1')?.textContent === 'Improvement Lab'" });
  // 9 settings and AI providers
  await go('#/settings/providers', "document.body.textContent.includes('never stores provider credentials')");
  await shoot('09-settings-ai-providers.png', { title: 'Settings: AI providers', alt: 'Settings, AI Providers: each provider with its state, version and description, and the note that ERA never stores provider credentials', route: '#/settings/providers', mode: 'advanced', expect: "document.body.textContent.includes('never stores provider credentials')" });
  // 10 documentation
  await go('#/docs/getting-started', "document.querySelector('.doc-body h2')?.textContent === 'Getting started'");
  await shoot('10-documentation.png', { title: 'Documentation', alt: 'The in-app Documentation section: eight topic sections on the left, the Getting started page rendered from the repository documentation, and the page outline', route: '#/docs/getting-started', mode: 'advanced', expect: "!!document.querySelector('.docs-nav') && !!document.querySelector('.doc-body table')" });

  const commit = (() => { try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(); } catch { return null; } })();
  writeFileSync(path.join(out, 'manifest.json'), `${JSON.stringify({
    generated_by: 'npm run capture:screenshots --prefix apps/studio',
    app: { name: 'ERA Studio', version: JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version, commit },
    platform: `${process.platform} ${process.arch}`,
    electron: process.versions.electron,
    resolution: `${WIDTH * scale}x${HEIGHT * scale} (a ${WIDTH}x${HEIGHT} window at device scale ${scale})`,
    theme: 'dark',
    real: 'The Electron application, the control plane, REA 6.4.0, the project commands, git and the verification are real, run on controlled fixture projects.',
    simulated: 'The coding agent is a scripted stand-in (no model was called). Providers appear exactly as the demo workspace configures them.',
    privacy: 'Visible text was checked against the home directory, the user name, user directory paths, credential patterns and the access token before each capture; fixture projects live under a neutral path. Images are unedited.',
    images: captured,
  }, null, 2)}\n`);
  process.stdout.write(`PASS captured ${captured.length} screenshots\n`);
  return 0;
};
