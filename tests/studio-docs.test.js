// In-app documentation: the safe Markdown model, and the read-only documentation routes with their fixed allowlist.
//
// REAL   the parser run over every page the app can show, and the HTTP control plane for the routes.
import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyTarget, headingsOf, inlineText, parseInline, parseMarkdown, slugify, titleOf } from '../apps/studio/web/js/markdown-model.js';
import { DOC_SECTIONS } from '../src/control_plane/services/docs.js';
import { loadConfig } from '../src/core/config.js';
import { ReaClient } from '../src/rea_integration/rea-client.js';
import { createControlPlane } from '../src/control_plane/server.js';
import { FIXTURES, ROOT, tempDir } from './helpers.js';

const NESTED = (process.env.ERA_E2E_NESTED || process.env.ERA_SKIP_E2E) && 'nested evaluation or ERA_SKIP_E2E';
const test = (name, a, b) => {
  const opts = typeof a === 'function' ? {} : a;
  const fn = typeof a === 'function' ? a : b;
  return nodeTest(name, { ...opts, skip: opts.skip || NESTED || false }, fn);
};

// ---- parser

test('headings get stable unique ids and inline formatting is parsed', () => {
  const blocks = parseMarkdown('# Title with `code`\n\n## Same\n\n## Same\n\nSome **bold**, *em*, `code`, [link](https://example.org/x) and ![img](docs/assets/a.png).');
  assert.deepEqual(headingsOf(blocks).map((h) => h.id), ['title-with-code', 'same', 'same-1']);
  assert.equal(titleOf(blocks), 'Title with code');
  const para = blocks.at(-1);
  assert.deepEqual(para.inline.map((n) => n.type), ['text', 'strong', 'text', 'em', 'text', 'code', 'text', 'link', 'text', 'image', 'text']);
  assert.equal(slugify('Rebuild prerequisites!'), 'rebuild-prerequisites');
});

test('raw HTML and scripts are text, never nodes', () => {
  const blocks = parseMarkdown('<script>alert(1)</script> <img src=x onerror=alert(1)>\n\n<div onclick="x()">hi</div>');
  const types = JSON.stringify(blocks);
  assert.ok(!/"type":"(script|html|img)"/.test(types.replace(/"type":"image"/g, '')), types);
  assert.match(inlineText(blocks[0].inline), /<script>alert\(1\)<\/script>/, 'shown literally');
});

test('link targets are classified: only https, in-app pages and anchors can be links', () => {
  assert.equal(classifyTarget('https://example.org/a').kind, 'external');
  assert.equal(classifyTarget('http://example.org/a').kind, 'blocked');
  assert.equal(classifyTarget('javascript:alert(1)').kind, 'blocked');
  assert.equal(classifyTarget('data:text/html,x').kind, 'blocked');
  assert.equal(classifyTarget('file:///etc/passwd').kind, 'blocked');
  assert.equal(classifyTarget('//evil.example/x').kind, 'blocked');
  assert.deepEqual(classifyTarget('#heading'), { kind: 'anchor', anchor: 'heading' });
  assert.deepEqual(classifyTarget('project-lab.md#approval'), { kind: 'relative', path: 'project-lab.md', anchor: 'approval' });
});

test('fenced code keeps its text verbatim, including characters that look like Markdown', () => {
  const [code, after] = parseMarkdown('```bash\nnpm run x -- --a "*b*" | tee `c`\n# not a heading\n```\n\nafter');
  assert.deepEqual(code, { type: 'code', lang: 'bash', text: 'npm run x -- --a "*b*" | tee `c`\n# not a heading' });
  assert.equal(after.type, 'paragraph');
});

test('lists nest, number and continue across lines; tables parse with escaped pipes', () => {
  const [list, table] = parseMarkdown('1. first line\n   continued\n2. second\n   - nested a\n   - nested b\n\n| A | B |\n|---|---|\n| x \\| y | `z` |\n| 1 | 2 |');
  assert.equal(list.type, 'list');
  assert.equal(list.ordered, true);
  assert.equal(list.items.length, 2);
  assert.equal(inlineText(list.items[0].inline), 'first line continued');
  assert.equal(list.items[1].blocks[0].type, 'list');
  assert.equal(list.items[1].blocks[0].items.length, 2);
  assert.equal(table.type, 'table');
  assert.deepEqual(table.header.map(inlineText), ['A', 'B']);
  assert.equal(inlineText(table.rows[0][0]), 'x | y');
  assert.equal(table.rows.length, 2);
});

test('block quotes, rules and standalone images', () => {
  const blocks = parseMarkdown('> quoted **text**\n\n---\n\n![alt text](docs/assets/x.png)');
  assert.deepEqual(blocks.map((b) => b.type), ['quote', 'rule', 'image']);
  assert.equal(blocks[2].alt, 'alt text');
  assert.equal(parseInline('a_b_c and snake_case').map((n) => n.type).join(), 'text');
});

// ---- every page the app can show

test('every documentation page in the allowlist exists, parses and has a title and no unterminated code block', () => {
  for (const s of DOC_SECTIONS) {
    for (const rel of [s.file, ...s.related]) {
      const file = join(ROOT, rel);
      assert.ok(existsSync(file), `${rel} is listed for the in-app documentation but missing`);
      const text = readFileSync(file, 'utf8');
      const blocks = parseMarkdown(text);
      assert.ok(titleOf(blocks), `${rel} has no heading`);
      assert.equal((text.match(/^\s*```/gm) ?? []).length % 2, 0, `${rel} has an unterminated code fence`);
      assert.ok(blocks.length > 3, `${rel} parsed to almost nothing`);
    }
  }
});

test('relative links between documentation pages and images resolve inside the documentation allowlist', () => {
  const pages = new Set(DOC_SECTIONS.flatMap((s) => [s.file, ...s.related]));
  const bad = [];
  for (const s of DOC_SECTIONS) {
    for (const rel of [s.file, ...s.related]) {
      const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
      const walk = (nodes) => nodes.forEach((n) => {
        if (n.type === 'link') {
          const t = classifyTarget(n.target);
          if (t.kind === 'relative' && t.path.endsWith('.md')) {
            const target = join(dir, t.path).replace(/\\/g, '/');
            const norm = target.split('/').reduce((acc, part) => (part === '..' ? acc.slice(0, -1) : part === '.' || part === '' ? acc : [...acc, part]), []).join('/');
            if (!pages.has(norm) && !existsSync(join(ROOT, norm))) bad.push(`${rel} -> ${t.path} (missing file)`);
          }
        }
        if (n.children) walk(n.children);
      });
      const visit = (blocks) => blocks.forEach((b) => {
        if (b.inline) walk(b.inline);
        if (b.items) b.items.forEach((it) => { walk(it.inline); visit(it.blocks); });
        if (b.blocks) visit(b.blocks);
        if (b.rows) b.rows.flat().forEach(walk);
        if (b.type === 'image' && /^docs\/assets\//.test(join(dir, b.src))) { /* checked below */ }
      });
      visit(parseMarkdown(readFileSync(join(ROOT, rel), 'utf8')));
    }
  }
  assert.deepEqual(bad, []);
});

// ---- routes

async function plane() {
  const cwd = tempDir();
  writeFileSync(join(cwd, 'era.config.json'), '{}');
  const config = loadConfig(cwd, { ERA_STATE_DIR: join(cwd, 'state') });
  const rea = new ReaClient({ command: join(FIXTURES, 'fake-rea-engine.mjs'), stateDir: config.stateDirAbs, measureResources: false });
  const cp = await createControlPlane({ config, rea, version: 'test' });
  await cp.start();
  const get = (path, token = cp.token) => fetch(`${cp.url}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { cp, get };
}

test('documentation routes need the token and serve only allowlisted pages and images', async () => {
  const p = await plane();
  try {
    assert.equal((await p.get('/api/docs', null)).status, 401);
    const index = await (await p.get('/api/docs')).json();
    assert.equal(index.available, true);
    assert.deepEqual(index.sections.map((s) => s.title), ['Getting Started', 'Installation', 'Project Lab', 'Reverse Engineering', 'Multi-Agent Configuration', 'Improvement Lab', 'Security and Permissions', 'Troubleshooting']);
    const page = await (await p.get('/api/docs/page?name=docs%2Finstallation.md')).json();
    assert.match(page.text, /^# Installation/);
    // names outside the list: other repository files, traversal, absolute paths, secrets, state
    for (const name of ['package.json', 'docs/../package.json', '../etc/passwd', '/etc/passwd', 'docs/ERA_V020_HANDOFF.md', '.env', 'src/cli.js', 'docs/installation.md\0.png', '']) {
      assert.equal((await p.get(`/api/docs/page?name=${encodeURIComponent(name)}`)).status, 404, `page ${JSON.stringify(name)} must not be served`);
    }
    for (const name of ['docs/assets/../../package.json', 'docs/assets/x.svg', 'docs/installation.md', 'package.json', '/etc/hosts', 'docs/assets/%2e%2e/x.png']) {
      assert.equal((await p.get(`/api/docs/image?name=${encodeURIComponent(name)}`)).status, 404, `image ${JSON.stringify(name)} must not be served`);
    }
    const shot = 'docs/assets/screenshots/01-main-workspace.png';
    if (existsSync(join(ROOT, shot))) {
      const img = await p.get(`/api/docs/image?name=${encodeURIComponent(shot)}`);
      assert.equal(img.status, 200);
      assert.equal(img.headers.get('content-type'), 'image/png');
      assert.deepEqual([...new Uint8Array(await img.arrayBuffer()).slice(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
    }
  } finally {
    await p.cp.stop();
  }
});
