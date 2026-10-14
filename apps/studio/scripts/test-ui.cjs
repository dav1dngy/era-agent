'use strict';
const assert = require('node:assert/strict');
const { writeFileSync, readFileSync } = require('node:fs');
const path = require('node:path');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
module.exports = async function testUI({ win, controlPlane, repo }) {
  const checks = [];
  const out = process.env.ERA_STUDIO_TEST_OUT;
  const source = process.env.ERA_STUDIO_TEST_SOURCE;
  const original = readFileSync(path.join(source, 'src/cart.js'), 'utf8');
  const js = (code) => win.webContents.executeJavaScript(code, true);
  // Values reach the page as base64 of their JSON text and are decoded there: only [A-Za-z0-9+/=] is ever spliced into code.
  const lit = (v) => `JSON.parse(new TextDecoder().decode(Uint8Array.from(atob('${Buffer.from(JSON.stringify(v), 'utf8').toString('base64')}'), (c) => c.charCodeAt(0))))`;
  // Test-setup requests are made by this (main-process) script with the control plane's token, so no code string is built
  // from values. Page-driven requests, which use the injected authentication, are exercised by the UI scenarios themselves.
  const api = async (method, url, body) => {
    const r = await fetch(new URL(url, controlPlane.url).href, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${controlPlane.token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await r.json();
    if (!r.ok) throw Error(`${r.status}: ${JSON.stringify(data)}`);
    return data;
  };
  const until = async (predicate, label, ms = 30_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await predicate()) return; await delay(100); }
    throw Error(`Timed out: ${label}`);
  };
  const dom = (expr, label) => until(() => js(expr), label);
  const go = async (hash, expr) => { await js(`location.hash = ${lit(hash)}`); await dom(expr, hash); };
  const click = async (label) => { await dom(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === ${lit(label)} && !b.disabled)`, label); await js(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${lit(label)} && !b.disabled).click()`); };
  const check = (name) => { checks.push({ name, ok: true }); process.stdout.write(`PASS ${name}\n`); };
  const screenshot = async (name) => { await delay(200); writeFileSync(path.join(out, `${name}.png`), (await win.webContents.capturePage()).toPNG()); };
  const finishedJob = async (kind) => {
    let job;
    await until(async () => { job = (await api('GET', '/api/jobs')).jobs.find((j) => j.kind === kind); return job && ['succeeded', 'failed', 'cancelled'].includes(job.status); }, kind, 100_000);
    assert.equal(job.status, 'succeeded', job.error);
    return job;
  };
  try {
    await dom("!!document.querySelector('.shell')", 'desktop startup');
    assert.equal(await js("typeof require === 'undefined' && typeof process === 'undefined' && window.eraDesktop.injectedAuth"), true);
    assert.equal((await fetch(`${controlPlane.url}/api/overview`)).status, 401, 'outside requests receive no injected token');
    // The version the app reports must be the one in its own package.json (a stale build would differ).
    assert.equal((await js('window.eraDesktop.version()')).app, JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version);
    assert.equal(win.webContents.getLastWebPreferences().sandbox, true);
    check('Desktop launch, sandbox, isolated preload and authenticated API');
    assert.equal((await api('GET', '/api/overview')).rea.available, true, JSON.stringify((await api('GET', '/api/overview')).rea));
    await screenshot('home-empty-dark');

    await api('POST', '/api/projects', { id: 'cart', mode: 'modify', source, task: 'Fix the cart total to account for quantity', commands: { test: ['node --test tests/*.test.js'] }, acceptance: { commands: [{ name: 'quantity', command: 'node --test acceptance/cart-quantity.test.js', baseline: 'fail' }] }, team: { roles: { implementer: 'custom:fixture' } } });
    await dom("!!document.querySelector('.dashboard-project-card')", 'recent project appears');
    await screenshot('home-dark');
    await go('#/projects', "!!document.querySelector('.project-card')");
    await screenshot('projects-dark');
    await js("{const i=document.querySelector('[aria-label=\"Search projects\"]'); i.value='does-not-exist'; i.dispatchEvent(new Event('input',{bubbles:true}));}");
    await dom("!document.querySelector('.project-card')", 'project search filters results');
    await js("{const i=document.querySelector('[aria-label=\"Search projects\"]'); i.value='cart'; i.dispatchEvent(new Event('input',{bubbles:true}));}");
    await dom("!!document.querySelector('.project-card')", 'project search finds results');
    await click('Open project');
    await dom("document.querySelector('h1')?.textContent === 'cart'", 'project card opens real project');
    check('Dashboard project cards and project search use live project state');
    await click('Advanced');
    await dom("!![...document.querySelectorAll('button')].find(b => b.textContent === 'Open in workbench')", 'advanced');
    await click('Simple');
    assert.equal(await js("document.querySelector('select[aria-label=\"Current project\"]').value"), 'cart');
    // The click saves the setting asynchronously; wait for the saved state instead of reading it at once.
    await until(async () => (await api('GET', '/api/settings')).settings.mode === 'simple', 'simple mode saved');
    check('Open project and switch presentation mode without losing project context');

    await click('Run review');
    await finishedJob('project.review');
    assert.equal((await api('GET', '/api/projects/cart')).latest_run.status, 'complete');
    const reviewed = await api('GET', '/api/projects/cart/runs/latest');
    assert.ok(reviewed.report.includes('REA'));
    assert.ok(controlPlane.ctx.lab.store.latestRun('cart').results.analysis.rea.ran, 'review must contain real REA evidence');
    assert.equal(readFileSync(path.join(source, 'src/cart.js'), 'utf8'), original);
    check('Project Lab review with real REA and unchanged original');
    await click('Run modify');
    await finishedJob('project.modify');
    const detail = await api('GET', '/api/projects/cart/runs/latest');
    assert.equal(detail.run.status, 'awaiting-approval');
    assert.equal(detail.finalize.pass, true);
    assert.equal(readFileSync(path.join(source, 'src/cart.js'), 'utf8'), original);
    check('Isolated Modify workflow with simulated coding agent and real project tests');

    await click('Review and approve');
    await dom("!!document.querySelector('.monaco-diff-editor')", 'Monaco diff');
    await dom("window.monaco?.editor.getDiffEditors().some(e => e.getLineChanges()?.length > 0)", 'computed real diff');
    assert.equal(await js("window.monaco.editor.getDiffEditors()[0].getModel().original.getValue() !== window.monaco.editor.getDiffEditors()[0].getModel().modified.getValue()"), true);
    await dom("document.body.textContent.includes('passing')", 'verification results');
    await screenshot('review-dark');
    await click('Approve');
    await dom("!!document.querySelector('[role=dialog]')", 'approval dialog');
    await click('Cancel');
    assert.equal(readFileSync(path.join(source, 'src/cart.js'), 'utf8'), original);
    await click('Approve');
    await click('Approve and apply');
    await until(async () => (await api('GET', '/api/projects/cart')).latest_run.status === 'applied', 'approval');
    assert.notEqual(readFileSync(path.join(source, 'src/cart.js'), 'utf8'), original);
    check('Monaco diff, test results, cancelled approval and explicit apply');
    await click('Roll back');
    await dom("!!document.querySelector('[role=dialog]')", 'rollback dialog');
    await js("[...document.querySelectorAll('[role=dialog] button')].find(b => b.textContent.trim() === 'Roll back').click()");
    await until(async () => (await api('GET', '/api/projects/cart')).latest_run.status === 'rolled-back', 'rollback');
    assert.equal(readFileSync(path.join(source, 'src/cart.js'), 'utf8'), original);
    check('Rollback restores the original fixture');

    await click('Advanced');
    await go('#/workbench/cart?file=src%2Fcart.js', "!!document.querySelector('.monaco-editor')");
    await dom("!!document.querySelector('[role=tab][title=\"source:src/cart.js\"]')", 'editor file');
    await screenshot('workbench-dark');
    check('Workbench loads project file in real Monaco');

    // Reachability evidence for the Monaco/DOMPurify advisories (docs/ERA_V020_REMEDIATION.md, L03): untrusted hover Markdown with
    // HTML goes through the sanitizer bundled in Monaco. Nothing may execute and no event-handler attribute or script may survive.
    await js(`(() => {
      const m = window.monaco;
      window.__xss = 0;
      m.languages.registerHoverProvider('javascript', { provideHover: () => ({ contents: [{ value: '<img src=x onerror="window.__xss=1"><b onclick="window.__xss=2">bold</b><script>window.__xss=3</script><a href="javascript:window.__xss=4">link</a>', supportHtml: true }] }) });
      const editor = m.editor.getEditors()[0];
      editor.focus();
      editor.setPosition({ lineNumber: 1, column: 1 });
      editor.trigger('test', 'editor.action.showHover', {});
    })()`);
    await dom("!!document.querySelector('.monaco-hover') && document.querySelector('.monaco-hover').textContent.includes('bold')", 'untrusted hover Markdown is rendered');
    await delay(500);
    assert.equal(await js('window.__xss'), 0, 'no injected script ran');
    assert.equal(await js("!!document.querySelector('.monaco-hover [onerror], .monaco-hover [onclick], .monaco-hover script, .monaco-hover a[href^=\"javascript:\"]')"), false, 'no active content survives sanitization');
    check('Untrusted hover Markdown is sanitized in the real Monaco renderer');

    await go('#/analysis', "document.querySelector('h1')?.textContent === 'Analysis'");
    await js(`{const i=document.querySelector('[aria-label="Analysis target path"]'); i.value=${lit(source)}; i.dispatchEvent(new Event('input',{bubbles:true}));}`);
    await click('Inspect target');
    await click('Start analysis');
    const analysis = await finishedJob('analysis');
    assert.equal(analysis.result.status, 'succeeded');
    const report = await api('GET', `/api/analyses/${analysis.result.analysis_id}`);
    assert.ok(report.facts.length);
    check('Genuine REA analysis started from the UI produces stored evidence');

    await api('PUT', '/api/settings', { workspaces: { improvementCheckout: repo } });
    await go('#/improvement', "document.querySelector('h1')?.textContent.includes('Improvement')");
    assert.equal((await api('GET', '/api/improvement')).checkout.available, true);
    check('Improvement Lab reads real checkout history');
    await go('#/agents', "document.body.textContent.includes('Unavailable') && document.body.textContent.includes('Simulated')");
    check('Unavailable providers and simulated agent are visibly distinguished');
    await api('PUT', '/api/settings', { appearance: { theme: 'light' } });
    await go('#/home', "!!document.querySelector('.home')");
    await dom("document.documentElement.dataset.theme === 'light'", 'light theme');
    await screenshot('home-light');
    await api('PUT', '/api/settings', { appearance: { theme: 'dark' } });
    await dom("document.documentElement.dataset.theme === 'dark'", 'restore dark theme');
    win.setSize(1024, 768);
    await dom("window.innerWidth <= 1024", 'narrow desktop window');
    assert.equal(await js("document.querySelector('.dashboard').scrollWidth <= document.querySelector('.workspace').clientWidth"), true, 'dashboard fits the narrow desktop');
    await screenshot('home-narrow-dark');
    await js("document.querySelector('[aria-label=\"Toggle sidebar\"]').click()");
    await dom("!document.querySelector('.frame.collapsed')", 'expanded navigation');
    assert.equal(await js("document.querySelector('.dashboard').scrollWidth <= document.querySelector('.workspace').clientWidth"), true, 'dashboard fits expanded navigation');
    await screenshot('home-expanded-dark');
    await js("document.querySelector('[aria-label=\"Search commands and projects\"]').click()");
    await dom("!!document.querySelector('.palette [aria-label=\"Command\"]')", 'header command search');
    await js("document.querySelector('[aria-label=\"Command\"]').dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true}))");
    await dom("!document.querySelector('.palette')", 'command palette closes');
    win.setSize(1440, 900);
    check('Responsive dashboard, expandable navigation and command search');

    // Command palette keyboard behavior (real key events): focus moves in, Tab and outside focus cannot leave, arrows move the
    // active option, Escape returns focus to the control that opened it.
    const press = async (keyCode) => { win.webContents.sendInputEvent({ type: 'keyDown', keyCode }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode }); await delay(150); };
    win.webContents.focus();
    await js("document.querySelector('[aria-label=\"Search commands and projects\"]').focus()");
    await js("document.querySelector('[aria-label=\"Search commands and projects\"]').click()");
    await dom("document.activeElement?.getAttribute('aria-label') === 'Command'", 'focus moves into the command palette');
    await press('Tab');
    await press('Tab');
    assert.equal(await js("!!document.activeElement?.closest('.palette')"), true, 'Tab must not leave the palette');
    await js("document.querySelector('.sidebar-brand').focus()");
    await dom("document.activeElement?.getAttribute('aria-label') === 'Command'", 'focus is pulled back from the page behind the palette');
    const first = await js("document.querySelector('[aria-label=\"Command\"]').getAttribute('aria-activedescendant')");
    await press('Down');
    assert.notEqual(await js("document.querySelector('[aria-label=\"Command\"]').getAttribute('aria-activedescendant')"), first, 'the arrow key moves the active option');
    assert.equal(await js("document.querySelector('[aria-label=\"Command\"]').getAttribute('role')"), 'combobox');
    await press('Escape');
    await dom("!document.querySelector('.palette')", 'Escape closes the palette');
    assert.equal(await js("document.activeElement?.getAttribute('aria-label')"), 'Search commands and projects', 'focus returns to the invoking control');
    check('Command palette is keyboard-contained and restores focus');

    // Documentation: the repository's own pages, rendered in the app from the control plane (one copy of the text).
    const sections = ['Getting Started', 'Installation', 'Project Lab', 'Reverse Engineering', 'Multi-Agent Configuration', 'Improvement Lab', 'Security and Permissions', 'Troubleshooting'];
    assert.equal(await js("!!document.querySelector('.sidebar [aria-label=\"Documentation\"]')"), true, 'Documentation is in the navigation');
    await js("document.querySelector('.sidebar [aria-label=\"Documentation\"]').click()");
    await dom("document.querySelector('h1')?.textContent === 'Documentation' && document.querySelector('.doc-body h2')?.textContent === 'Getting started'", 'documentation opens on Getting started');
    assert.deepEqual(await js("[...document.querySelectorAll('.docs-nav > div > .docs-nav-item')].map((a) => a.textContent)"), sections, 'all eight sections are listed');
    for (const [id, expect] of [['installation', 'Choose what to install'], ['project-lab', 'Rebuild prerequisites'], ['reverse-engineering', 'Engine resolution'], ['multi-agent', 'Who does what'], ['improvement-lab', 'Isolation and evidence ownership'], ['security', 'Controls added after the independent v0.2.0 audit'], ['troubleshooting', 'Native analysis']]) {
      await go(`#/docs/${id}`, `document.body.textContent.includes(${lit(expect)})`);
    }
    // The Settings categories share the navigation item style with the sidebar; the collapsed sidebar (the default) must not hide them.
    await go('#/settings/providers', "!!document.querySelector('.settings-nav')");
    if (!(await js("document.querySelector('.frame').classList.contains('collapsed')"))) await js("document.querySelector('[aria-label=\"Toggle sidebar\"]').click()");
    await dom("document.querySelector('.frame').classList.contains('collapsed')", 'sidebar collapsed (the default state of a fresh app)');
    assert.equal(await js("[...document.querySelectorAll('.settings-nav .nav-item .label')].length >= 8 && [...document.querySelectorAll('.settings-nav .nav-item .label')].every((l) => l.offsetWidth > 0 && l.textContent.trim().length > 0)"), true, 'every Settings category is visible');
    await go('#/docs/project-lab?h=approval-and-rollback', "!!document.getElementById('doc-h-approval-and-rollback')");
    assert.equal(await js("document.querySelectorAll('.doc-table').length >= 1 && document.querySelectorAll('.doc-table th').length >= 2"), true, 'tables render');
    assert.equal(await js("[...document.querySelectorAll('.doc-body a')].every((a) => a.getAttribute('href').startsWith('#') || a.getAttribute('href').startsWith('https://'))"), true, 'every link is an in-app page or an https link');
    await go('#/docs/getting-started?doc=docs%2FERA_STUDIO.md', "document.querySelectorAll('img.doc-image').length >= 1");
    await dom("[...document.querySelectorAll('img.doc-image')].some((i) => i.complete && i.naturalWidth > 100)", 'documentation screenshots load through the control plane');
    assert.equal(await js("performance.getEntriesByType('resource').every((r) => new URL(r.name).origin === location.origin || r.name.startsWith('blob:'))"), true, 'the documentation needs no external resource');
    await js("document.querySelector('[aria-label=\"Search commands and projects\"]').click()");
    await js("(() => { const i = document.querySelector('[aria-label=\"Command\"]'); i.focus(); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'rollback'); i.dispatchEvent(new Event('input', { bubbles: true })); })()");
    await dom("document.querySelector('#palette-list')?.textContent.includes('Documentation: Approval and rollback')", 'the palette finds the documentation topic');
    await press('Enter');
    await dom("!document.querySelector('.palette') && !!document.getElementById('doc-h-approval-and-rollback')", 'the palette opens the topic');
    await go('#/home', "!!document.querySelector('.home')");
    check('Documentation section renders the repository pages from the control plane, offline');

    // Exercise shared components against inert, hostile report text in the actual browser runtime.
    const safe = await js(`(async () => { const {html,render}=await import('/js/html.js'); const {Md,Btn}=await import('/js/ui.js'); const host=document.createElement('div'); document.body.append(host); render(html\`<div><\${Md} text=\${'<img src=x onerror="window.pwned=1">'} /><\${Btn} kind="primary" class="right">Test<//></div>\`,host); const ok=!host.querySelector('img') && !window.pwned && host.querySelector('button').classList.contains('primary'); render(null,host); host.remove(); return ok; })()`);
    assert.equal(safe, true);
    check('Light theme and component rendering escape untrusted content');
    const denied = await js("fetch('/api/projects/cart/file?root=source', {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:'src/cart.js',content:'unsafe'})}).then(r=>r.status)");
    assert.equal(denied, 403);
    check('Renderer cannot bypass backend original-file authorization');
    writeFileSync(path.join(out, 'desktop-tests.json'), JSON.stringify({ date: new Date().toISOString(), checks, rea: 'real installed CLI', coding_agent: 'simulated fixture', signed: false }, null, 2));
    return 0;
  } catch (e) {
    process.stderr.write(`${e.stack}\n`);
    await screenshot('failure').catch(() => {});
    writeFileSync(path.join(out, 'desktop-tests.json'), JSON.stringify({ checks, failure: e.message }, null, 2));
    return 1;
  }
};
